/* global BF2042Portal, _Blockly */
(function () {
    "use strict";

    const plugin = BF2042Portal.Plugins.getPlugin("Selection_List");
    let observer = null;
    let lastContextBlockId = null;
    let lastContextBlock = null;

    function getPortalLanguage() {
        const lang = (document?.documentElement?.lang || navigator?.language || "").toLowerCase();
        return lang.startsWith("ja") ? "ja" : "en";
    }

    function getWorkspace() {
        try { return _Blockly?.getMainWorkspace?.() || null; } catch (_) { return null; }
    }

    function getBlockFromId(id) {
        if (!id) return null;
        try { return getWorkspace()?.getBlockById?.(String(id)) || null; } catch (_) { return null; }
    }

    function normalize(value) {
        if (value === null || value === undefined) return "";
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
        return "";
    }

    function addUnique(out, seen, value) {
        const s = normalize(value);
        if (!s || seen.has(s)) return;
        seen.add(s);
        out.push(s);
    }

    function getFieldOptions(field) {
        if (!field) return [];
        const candidates = [];
        try {
            if (typeof field.getOptions === "function") {
                const value = field.getOptions(false);
                if (Array.isArray(value)) candidates.push(value);
            }
        } catch (_) {}

        for (const key of ["options_", "options", "menuGenerator_", "menuGenerator", "choices", "values"]) {
            try {
                const value = field[key];
                if (Array.isArray(value)) candidates.push(value);
                else if (typeof value === "function") {
                    const generated = value.call(field);
                    if (Array.isArray(generated)) candidates.push(generated);
                }
            } catch (_) {}
        }

        const out = [];
        const seen = new Set();
        for (const list of candidates) {
            for (const option of list) {
                if (Array.isArray(option)) {
                    // Blockly dropdown pair: [displayText, value]
                    addUnique(out, seen, option[0]);
                } else if (option && typeof option === "object") {
                    addUnique(out, seen, option.text);
                    addUnique(out, seen, option.label);
                    addUnique(out, seen, option.name);
                    addUnique(out, seen, option.displayName);
                    if (!out.length) addUnique(out, seen, option.value);
                } else {
                    addUnique(out, seen, option);
                }
            }
        }
        return out;
    }

    function getAllFields(block) {
        const fields = [];
        if (!block) return fields;
        try {
            if (Array.isArray(block.inputList)) {
                for (const input of block.inputList) {
                    if (Array.isArray(input?.fieldRow)) {
                        for (const field of input.fieldRow) if (field) fields.push(field);
                    }
                }
            }
        } catch (_) {}
        try {
            if (typeof block.getFields === "function") {
                const value = block.getFields();
                if (Array.isArray(value)) fields.push(...value);
            }
        } catch (_) {}
        return [...new Set(fields)];
    }

    function isLikelySelectionField(field, options) {
        if (!field || options.length < 2) return false;
        const name = normalize(field.name).toLowerCase();
        const ctor = normalize(field.constructor?.name).toLowerCase();
        const text = normalize(field.getText?.()).toLowerCase();
        if (name === "value-1") return true;
        if (ctor.includes("dropdown")) return true;
        if (/selection|list|item|enum|type/.test(name)) return true;
        if (/dropdown|select|selection|enum/.test(ctor)) return true;
        if (text && options.some(v => normalize(v).toLowerCase() === text)) return true;
        return false;
    }

    function extractSelectionItems(block) {
        const result = [];
        const seen = new Set();
        if (!block) return result;
        const fields = getAllFields(block);
        const fieldResults = [];
        for (const field of fields) {
            const options = getFieldOptions(field);
            if (!isLikelySelectionField(field, options) || !options.length) continue;
            fieldResults.push({ field, options });
        }
        fieldResults.sort((a, b) => {
            const an = normalize(a.field?.name).toLowerCase();
            const bn = normalize(b.field?.name).toLowerCase();
            const ac = normalize(a.field?.constructor?.name).toLowerCase();
            const bc = normalize(b.field?.constructor?.name).toLowerCase();
            const ap = an === "value-1" || ac.includes("dropdown") ? 0 : 1;
            const bp = bn === "value-1" || bc.includes("dropdown") ? 0 : 1;
            return ap - bp;
        });
        for (const entry of fieldResults) for (const option of entry.options) addUnique(result, seen, option);
        return result;
    }

    function getFieldText(block, fieldName) {
        try {
            const field = block?.getField?.(fieldName);
            if (field) {
                const value = typeof field.getText === "function" ? field.getText() : field.getValue?.();
                return normalize(value);
            }
        } catch (_) {}
        return "";
    }

    // MapsItem -> MAP, while allowing an existing Global variable to win.
    function variableNameCandidates(block) {
        const group = getFieldText(block, "VALUE-0");
        const type = normalize(block?.type || "");
        const out = [];
        if (group) {
            const singular = group.endsWith("s") && group.length > 1 ? group.slice(0, -1) : group;
            out.push(singular.toUpperCase());
            out.push(group.toUpperCase());
        }
        if (type.endsWith("Item")) {
            const base = type.slice(0, -4);
            out.push(base.toUpperCase());
        }
        if (type === "MapsItem") out.unshift("MAP");
        return [...new Set(out.filter(Boolean))];
    }

    function getBaseVariableName(block) {
        const group = getFieldText(block, "VALUE-0");
        const type = normalize(block?.type || "");
        const out = [];
        if (group) {
            const singular = group.endsWith("s") && group.length > 1 ? group.slice(0, -1) : group;
            out.push(singular.toUpperCase());
            out.push(group.toUpperCase());
        }
        if (type.endsWith("Item")) {
            const base = type.slice(0, -4);
            out.push(base.toUpperCase());
        }
        if (type === "MapsItem") out.unshift("MAP");
        return [...new Set(out.filter(Boolean))][0] || "MAP";
    }

    function variableNameCandidates(block, suffix = "") {
        const base = getBaseVariableName(block);
        const names = [];
        if (suffix) {
            names.push(`${base}_${suffix}`);
            names.push(`${base}${suffix}`);
        } else {
            names.push(base);
        }
        return names;
    }

    function findGlobalVariable(block, suffix = "") {
        const ws = getWorkspace();
        const candidates = variableNameCandidates(block, suffix);
        try {
            const vars = ws?.getAllVariables?.() || [];
            for (const candidate of candidates) {
                const hit = vars.find(v => normalize(v?.name).toUpperCase() === candidate.toUpperCase() && normalize(v?.type || "Global") === "Global");
                if (hit) return { id: hit.getId?.() || hit.id || "", name: hit.name, type: "Global" };
            }
        } catch (_) {}
        return { id: "", name: candidates[0] || "MAP", type: "Global" };
    }

    function makeId(prefix, index) {
        // BF-style IDs do not need to be cryptographically random for clipboard import.
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+=[]{};:,.?";
        let s = prefix + String(index) + "_";
        for (let i = 0; i < 18; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s.slice(0, 22);
    }

    function getBlockPosition(block) {
        try {
            const xy = block?.getRelativeToSurfaceXY?.();
            if (xy && Number.isFinite(xy.x) && Number.isFinite(xy.y)) return { x: xy.x, y: xy.y };
        } catch (_) {}
        return { x: 300, y: 300 };
    }

    function buildClipboard(block, names) {
        const MAX_ITEMS_PER_ARRAY = 256;
        const pos = getBlockPosition(block);
        const x = Number(pos.x.toFixed(6));
        const itemType = normalize(block?.type) || "MapsItem";
        const group = getFieldText(block, "VALUE-0");
        const chunks = [];

        for (let offset = 0, chunkIndex = 0; offset < names.length; offset += MAX_ITEMS_PER_ARRAY, chunkIndex++) {
            const chunk = names.slice(offset, offset + MAX_ITEMS_PER_ARRAY);
            const variable = names.length > MAX_ITEMS_PER_ARRAY
                ? findGlobalVariable(block, chunkIndex + 1)
                : findGlobalVariable(block);
            const blocks = [];
            const sourceIds = [];
            const connections = [];
            let y = Number((pos.y + chunkIndex * 53 * Math.min(chunk.length, 256)).toFixed(6));
            let previousId = null;

            chunk.forEach((name, localIndex) => {
                const setId = makeId("SetVar", offset + localIndex);
                const refId = makeId("VarRef", offset + localIndex);
                const numId = makeId("Num", offset + localIndex);
                const itemId = makeId("Item", offset + localIndex);
                const setBlock = {
                    type: "SetVariableAtIndex",
                    id: setId,
                    inputs: {
                        "VALUE-0": {
                            block: {
                                type: "variableReferenceBlock",
                                id: refId,
                                extraState: { isObjectVar: false },
                                fields: {
                                    OBJECTTYPE: "Global",
                                    VAR: {
                                        id: variable.id || makeId("Var", chunkIndex),
                                        name: variable.name,
                                        type: "Global"
                                    }
                                }
                            }
                        },
                        "VALUE-1": {
                            block: {
                                type: "Number",
                                id: numId,
                                fields: { NUM: localIndex }
                            }
                        },
                        "VALUE-2": {
                            block: {
                                type: itemType,
                                id: itemId,
                                fields: {
                                    "VALUE-0": group,
                                    "VALUE-1": name
                                }
                            }
                        }
                    },
                    _bf6Position: { x, y: Number((y + localIndex * 53).toFixed(6)) }
                };
                blocks.push(setBlock);
                sourceIds.push(setId);
                if (previousId) connections.push({ from: previousId, to: setId });
                previousId = setId;
            });

            chunks.push({ blocks, sourceIds, connections, variableName: variable.name });
        }

        const blocks = chunks.flatMap(c => c.blocks);
        const sourceIds = chunks.flatMap(c => c.sourceIds);
        const connections = chunks.flatMap(c => c.connections);
        return {
            _bf6MultiBlockClipboard: 1,
            blocks,
            sourceIds,
            connections,
            _selectionListChunks: chunks.map((c, i) => ({
                index: i + 1,
                variable: c.variableName,
                count: c.blocks.length
            }))
        };
    }

    async function copyToClipboard(text) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            ta.style.top = "-9999px";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return ok;
        } catch (_) {
            return false;
        }
    }

    async function createAndCopy() {
        const block = lastContextBlock || getBlockFromId(lastContextBlockId);
        const ja = getPortalLanguage() === "ja";
        if (!block) {
            alert(ja ? "右クリックしたブロックを取得できませんでした。" : "Could not get the context block.");
            return;
        }
        const names = extractSelectionItems(block);
        if (!names.length) {
            alert(ja ? "このブロックから選択リストの候補を取得できませんでした。" : "No selection-list options could be found on this block.");
            return;
        }
        const payload = buildClipboard(block, names);
        const text = JSON.stringify(payload, null, 2);
        const ok = await copyToClipboard(text);
        if (!ok) {
            alert(ja ? "クリップボードへのコピーに失敗しました。" : "Failed to copy to clipboard.");
            return;
        }
        if (names.length > 256) {
            const count = Math.ceil(names.length / 256);
            alert(ja
                ? `${names.length}個の選択肢を256個ずつ${count}個の配列変数に分割してクリップボードへコピーしました。`
                : `Copied ${names.length} options split into ${count} array variables (max 256 each) to the clipboard.`);
        } else {
            alert(ja
                ? `${names.length}個の選択肢を配列変数「${findGlobalVariable(block).name}」へ入れるブロックをクリップボードにコピーしました。`
                : `Copied ${names.length} blocks for array variable "${findGlobalVariable(block).name}" to the clipboard.`);
        }
    }

    function addSelectionListItem(submenu) {
        if (!submenu || !submenu.isConnected) return;
        if (submenu.querySelector('[data-selection-list-plugin="1"]')) return;

        const item = document.createElement("div");
        item.className = "bf6-options-menu-item";
        item.setAttribute("data-selection-list-plugin", "1");
        Object.assign(item.style, {
            padding: "5px 18px",
            whiteSpace: "nowrap",
            background: "rgb(22, 29, 30)",
            color: "#ffffff",
            cursor: "pointer",
            fontSize: "15px",
            lineHeight: "1.3",
            borderTop: "1px solid #3a4648",
            marginTop: "3px"
        });
        const label = document.createElement("span");
        label.className = "bf6-options-menu-label";
        label.textContent = "Selection List";
        item.appendChild(label);
        item.addEventListener("mouseenter", () => item.style.background = "rgb(48, 60, 62)");
        item.addEventListener("mouseleave", () => item.style.background = "rgb(22, 29, 30)");
        item.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            createAndCopy();
        }, true);
        submenu.appendChild(item);
    }

    function scan() {
        const submenus = document.querySelectorAll(".bf6-experience-manager-options-submenu");
        for (const submenu of submenus) addSelectionListItem(submenu);
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver(scan);
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
        scan();
    }

    document.addEventListener("contextmenu", event => {
        try {
            const blockEl = event.target?.closest?.("g.blocklyDraggable");
            const id = blockEl?.getAttribute?.("data-id") || blockEl?.dataset?.id || null;
            lastContextBlockId = id ? String(id) : null;
            lastContextBlock = getBlockFromId(lastContextBlockId);
            setTimeout(scan, 0);
        } catch (_) {
            lastContextBlockId = null;
            lastContextBlock = null;
        }
    }, true);

    plugin.initializeWorkspace = async function () {
        startObserver();
        scan();
    };
})();
