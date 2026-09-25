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

    function getFieldOptionPairs(field) {
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
                let display = "";
                let value = "";
                if (Array.isArray(option)) {
                    display = normalize(option[0]);
                    value = normalize(option[1]);
                } else if (option && typeof option === "object") {
                    display = normalize(option.text || option.label || option.displayName || option.name || option.value);
                    value = normalize(option.value || option.name || option.text || option.label || option.displayName);
                } else {
                    display = normalize(option);
                    value = display;
                }
                if (!display && !value) continue;
                const key = `${display}\\u0000${value}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ display: display || value, value: value || display });
            }
        }
        return out;
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

    function yieldToUI() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    function createLoadingStatus(total) {
        const wrap = document.createElement("div");
        wrap.setAttribute("data-selection-list-plugin", "loading-status");
        Object.assign(wrap.style, {
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: "360px",
            padding: "18px 20px",
            background: "rgba(20, 26, 28, .96)",
            color: "#fff",
            border: "1px solid #4b5a5d",
            borderRadius: "6px",
            boxShadow: "0 6px 24px rgba(0,0,0,.55)",
            zIndex: "2147483647",
            fontFamily: "sans-serif",
            pointerEvents: "none"
        });
        const title = document.createElement("div");
        title.className = "selection-list-loading-title";
        title.style.marginBottom = "10px";
        title.style.fontSize = "14px";
        const bar = document.createElement("div");
        Object.assign(bar.style, { height: "8px", background: "#303b3d", borderRadius: "4px", overflow: "hidden" });
        const fill = document.createElement("div");
        Object.assign(fill.style, { height: "100%", width: "0%", background: "#4da3ff", transition: "width .08s linear" });
        bar.appendChild(fill);
        const count = document.createElement("div");
        count.className = "selection-list-loading-count";
        count.style.marginTop = "8px";
        count.style.fontSize = "12px";
        count.style.textAlign = "center";
        wrap.append(title, bar, count);
        document.body.appendChild(wrap);
        wrap._title = title;
        wrap._fill = fill;
        wrap._count = count;
        wrap._total = total;
        return wrap;
    }

    function updateLoadingStatus(el, done, total) {
        if (!el) return;
        const pct = total ? Math.min(100, Math.round(done * 100 / total)) : 100;
        const ja = getPortalLanguage() === "ja";
        el._title.textContent = ja ? "読み込み中…" : "Loading…";
        el._fill.style.width = pct + "%";
        el._count.textContent = ja ? `${done} / ${total} 件 (${pct}%)` : `${done} / ${total} items (${pct}%)`;
    }

    function removeLoadingStatus(el) {
        try { el?.remove?.(); } catch (_) {}
    }

    async function buildClipboard(block, names) {
        const MAX_ITEMS_PER_ARRAY = 256;
        const pos = getBlockPosition(block);
        const x = Number(pos.x.toFixed(6));
        const itemType = normalize(block?.type) || "MapsItem";
        const group = getFieldText(block, "VALUE-0");
        const chunks = [];
        const total = names.length;

        let processed = 0;
        for (let offset = 0, chunkIndex = 0; offset < names.length; offset += MAX_ITEMS_PER_ARRAY, chunkIndex++) {
            const chunk = names.slice(offset, offset + MAX_ITEMS_PER_ARRAY);
            const variable = names.length > MAX_ITEMS_PER_ARRAY
                ? findGlobalVariable(block, chunkIndex + 1)
                : findGlobalVariable(block);
            const blocks = [];
            const sourceIds = [];
            const shouldCollapse = total > MAX_ITEMS_PER_ARRAY;
            const connections = [];
            let y = Number((pos.y + chunkIndex * 53 * Math.min(chunk.length, 256)).toFixed(6));
            let previousId = null;

            for (let localIndex = 0; localIndex < chunk.length; localIndex++) {
                const name = chunk[localIndex];
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
                if (previousId) {
                    const previous = blocks[blocks.length - 1];
                    previous.next = { block: setBlock };
                    connections.push({ from: previousId, to: setId });
                }
                blocks.push(setBlock);
                sourceIds.push(setId);
                previousId = setId;
                processed++;
            }

            const subroutineNumber = chunkIndex + 1;
            const subroutineName = `SUB_${getBaseVariableName(block)}_${String(subroutineNumber).padStart(2, "0")}`;
            const firstBlock = blocks[0] || null;
            const subroutineId = makeId("Sub", subroutineNumber);
            const subroutineBlock = {
                type: "subroutineBlock",
                id: subroutineId,
                collapsed: shouldCollapse,
                extraState: {
                    subroutineName,
                    parameters: []
                },
                fields: {
                    SUBROUTINE_NAME: subroutineName
                },
                inputs: {
                    ACTIONS: firstBlock ? { block: firstBlock } : {}
                },
                _bf6Position: { x, y: Number(y.toFixed(6)) }
            };

            // The individual SetVariableAtIndex blocks are now nested inside
            // a collapsed subroutine so a large selection list does not flood
            // the workspace when the clipboard payload is pasted.
            chunks.push({
                blocks: [subroutineBlock],
                sourceIds: [subroutineId],
                connections: [],
                variableName: variable.name,
                subroutineName,
                itemCount: chunk.length
            });
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
                count: c.itemCount || 0,
                subroutine: c.subroutineName || ""
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
        const payload = await buildClipboard(block, names);
        const text = JSON.stringify(payload, null, 2);
        const ok = await copyToClipboard(text);
        if (!ok) {
            alert(ja ? "クリップボードへのコピーに失敗しました。" : "Failed to copy to clipboard.");
            return;
        }
        if (names.length > 256) {
            const count = Math.ceil(names.length / 256);
            alert(ja
                ? `${names.length}個の選択肢を256個ずつ${count}個の配列変数に分割し、それぞれを折りたたんだサブルーチンに入れてクリップボードへコピーしました。`
                : `Copied ${names.length} options split into ${count} array variables, with each chunk wrapped in a collapsed subroutine.`);
        } else {
            alert(ja
                ? `${names.length}個の選択肢を配列変数「${findGlobalVariable(block).name}」へ入れる展開したサブルーチンをクリップボードにコピーしました。`
                : `Copied ${names.length} blocks for array variable "${findGlobalVariable(block).name}" inside an expanded subroutine to the clipboard.`);
        }
    }

    function createTextArrayClipboard(block, names) {
        const MAX_ITEMS_PER_ARRAY = 256;
        const pos = getBlockPosition(block);
        const x = Number(pos.x.toFixed(6));
        const base = getBaseVariableName(block);
        const group = getFieldText(block, "VALUE-0");
        const chunks = [];
        for (let offset = 0, chunkIndex = 0; offset < names.length; offset += MAX_ITEMS_PER_ARRAY, chunkIndex++) {
            const chunk = names.slice(offset, offset + MAX_ITEMS_PER_ARRAY);
            const variableName = names.length > MAX_ITEMS_PER_ARRAY
                ? `${base}_TEXT_${chunkIndex + 1}`
                : `${base}_TEXT`;
            const variable = findNamedGlobalVariable(variableName);
            const setBlocks = [];
            let previousId = null;

            chunk.forEach((name, localIndex) => {
                const setId = makeId("SetText", offset + localIndex);
                const refId = makeId("TextVar", offset + localIndex);
                const numId = makeId("TextNum", offset + localIndex);
                const textId = makeId("Text", offset + localIndex);
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
                                        id: variable.id || makeId("TextVarId", chunkIndex),
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
                                type: "Text",
                                id: textId,
                                fields: { TEXT: name }
                            }
                        }
                    },
                    _bf6Position: { x, y: Number((pos.y + localIndex * 53).toFixed(6)) }
                };
                if (previousId) setBlocks[setBlocks.length - 1].next = { block: setBlock };
                setBlocks.push(setBlock);
                previousId = setId;
            });

            const subroutineNumber = chunkIndex + 1;
            const subroutineName = `SUB_${base}_TEXT${String(subroutineNumber).padStart(2, "0")}`;
            const subroutineId = makeId("SubText", subroutineNumber);
            chunks.push({
                subroutine: {
                    type: "subroutineBlock",
                    id: subroutineId,
                    collapsed: names.length > MAX_ITEMS_PER_ARRAY,
                    extraState: { subroutineName, parameters: [] },
                    fields: { SUBROUTINE_NAME: subroutineName },
                    inputs: { ACTIONS: setBlocks[0] ? { block: setBlocks[0] } : {} },
                    _bf6Position: { x, y: Number((pos.y + chunkIndex * 53 * 256).toFixed(6)) }
                },
                sourceId: subroutineId,
                variableName: variable.name,
                count: chunk.length,
                subroutineName
            });
        }

        return {
            _bf6MultiBlockClipboard: 1,
            blocks: chunks.map(c => c.subroutine),
            sourceIds: chunks.map(c => c.sourceId),
            connections: [],
            _selectionListChunks: chunks.map((c, i) => ({
                index: i + 1,
                variable: c.variableName,
                count: c.count,
                subroutine: c.subroutineName
            }))
        };
    }

    function findNamedGlobalVariable(name) {
        const ws = getWorkspace();
        try {
            const vars = ws?.getAllVariables?.() || [];
            const hit = vars.find(v => normalize(v?.name).toUpperCase() === normalize(name).toUpperCase() && normalize(v?.type || "Global") === "Global");
            if (hit) return { id: hit.getId?.() || hit.id || "", name: hit.name, type: "Global" };
        } catch (_) {}
        return { id: "", name, type: "Global" };
    }

    // TYPE-A: reusable loader subroutine + data subroutine(s).
    function getTypeAEnumName(block) {
        const type = normalize(block?.type || "");
        const base = type.endsWith("Item") ? type.slice(0, -4) : type;
        return `Enum_${base || "Selection"}`;
    }

    function makeVariableReference(variable, prefix = "ARef") {
        return {
            type: "variableReferenceBlock",
            id: makeId(prefix, Date.now()),
            extraState: { isObjectVar: false },
            fields: {
                OBJECTTYPE: "Global",
                VAR: {
                    id: variable?.id || makeId(prefix + "Var", Date.now()),
                    name: variable?.name || "Append",
                    type: "Global"
                }
            }
        };
    }

    function makeGetVariable(variable, prefix = "AGet") {
        return {
            type: "GetVariable",
            id: makeId(prefix, Date.now()),
            inputs: { "VALUE-0": { block: makeVariableReference(variable, prefix + "Ref") } }
        };
    }

    function makeSetVariable(variable, valueBlock, prefix = "ASet") {
        return {
            type: "SetVariable",
            id: makeId(prefix, Date.now()),
            inputs: {
                "VALUE-0": { block: makeVariableReference(variable, prefix + "Ref") },
                "VALUE-1": { block: valueBlock }
            }
        };
    }

    function buildTypeALoader(block, japanese) {
        const originalType = normalize(block?.type) || "SelectionItem";
        const base = originalType.endsWith("Item") ? originalType.slice(0, -4) : originalType;
        const subroutineName = `TO_${base}${japanese ? "_J" : ""}`;
        const parameterType = "String";
        const appendVariable = findNamedGlobalVariable("Append");
        const argument = {
            type: "subroutineArgumentBlock",
            id: makeId("Arg", Date.now()),
            fields: { ARGUMENT_INDEX: "0" }
        };
        const appendToArray = {
            type: "AppendToArray",
            id: makeId("Append", Date.now()),
            inputs: {
                "VALUE-0": { block: makeGetVariable(appendVariable, "AppendGet") },
                "VALUE-1": { block: argument }
            }
        };
        return {
            type: "subroutineBlock",
            id: makeId("Loader", Date.now()),
            extraState: {
                subroutineName,
                parameters: [{ types: parameterType, name: "type" }]
            },
            fields: { SUBROUTINE_NAME: subroutineName },
            inputs: { ACTIONS: { block: makeSetVariable(appendVariable, appendToArray, "LoaderSet") } }
        };
    }

    function buildTypeAItemArgument(block, name, japanese) {
        if (japanese) {
            return {
                type: "Text",
                id: makeId("JText", Date.now()),
                fields: { TEXT: name }
            };
        }
        return {
            type: normalize(block?.type) || "SelectionItem",
            id: makeId("TypeAItem", Date.now()),
            fields: {
                "VALUE-0": getFieldText(block, "VALUE-0"),
                "VALUE-1": name
            }
        };
    }

    function buildTypeAClipboard(block, names, japanese = false) {
        const MAX_ITEMS_PER_ARRAY = 256;
        const pos = getBlockPosition(block);
        const x = Number(pos.x.toFixed(6));
        const base = getBaseVariableName(block);
        const originalType = normalize(block?.type) || "SelectionItem";
        const itemBase = originalType.endsWith("Item") ? originalType.slice(0, -4) : originalType;
        const appendVariable = findNamedGlobalVariable("Append");
        const loader = buildTypeALoader(block, japanese);
        const loaderName = loader.extraState.subroutineName;
        const chunks = [];

        for (let offset = 0, chunkIndex = 0; offset < names.length; offset += MAX_ITEMS_PER_ARRAY, chunkIndex++) {
            const chunk = names.slice(offset, offset + MAX_ITEMS_PER_ARRAY);
            const suffix = String(chunkIndex + 1).padStart(2, "0");
            const outputName = `${itemBase}${names.length > MAX_ITEMS_PER_ARRAY ? suffix : ""}${japanese ? "_J" : ""}`;
            const outputVariable = findNamedGlobalVariable(outputName);

            const initOutput = makeSetVariable(outputVariable, {
                type: "EmptyArray",
                id: makeId("Empty", chunkIndex)
            }, "InitArray");
            const initAppend = makeSetVariable(appendVariable, {
                type: "EmptyArray",
                id: makeId("EmptyAppend", chunkIndex)
            }, "InitAppend");
            initOutput.next = { block: initAppend };

            let tail = initAppend;
            chunk.forEach((name, localIndex) => {
                const instance = {
                    type: "subroutineInstanceBlock",
                    id: makeId("Call", offset + localIndex),
                    extraState: {
                        subroutineName: loaderName,
                        parameters: [{
                            types: "String",
                            name: "type"
                        }]
                    },
                    fields: { SUBROUTINE_NAME: loaderName },
                    inputs: {
                        "PARAM-0": { block: buildTypeAItemArgument(block, name, japanese) }
                    }
                };
                tail.next = { block: instance };
                tail = instance;
            });
            tail.next = {
                block: makeSetVariable(
                    outputVariable,
                    makeGetVariable(appendVariable, "FinalGet"),
                    "FinalSet"
                )
            };

            const dataName = `${itemBase}${names.length > MAX_ITEMS_PER_ARRAY ? suffix : ""}${japanese ? "_J" : ""}`;
            chunks.push({
                type: "subroutineBlock",
                id: makeId("DataSub", chunkIndex),
                collapsed: false,
                extraState: { subroutineName: dataName, parameters: [] },
                fields: { SUBROUTINE_NAME: dataName },
                inputs: { ACTIONS: { block: initOutput } },
                _bf6Position: { x, y: Number((pos.y + chunkIndex * 53 * 20).toFixed(6)) }
            });
        }

        return {
            _bf6MultiBlockClipboard: 1,
            blocks: [loader, ...chunks],
            sourceIds: [loader.id, ...chunks.map(b => b.id)],
            connections: [],
            _selectionListTypeA: {
                loader: loaderName,
                parameterType: "String",
                maxItemsPerArray: MAX_ITEMS_PER_ARRAY,
                itemCount: names.length
            }
        };
    }

    async function createTypeA(block, names, japanese = false) {
        const payload = buildTypeAClipboard(block, names, japanese);
        const count = Math.ceil(names.length / 256);
        await copyPayloadAndAlert(block, payload,
            getPortalLanguage() === "ja"
                ? `TYPE-Aで${names.length}個を読み込み用サブルーチン方式で${count}個の配列サブルーチンにしてクリップボードへコピーしました。`
                : `Copied ${names.length} items as TYPE-A using a loader subroutine and ${count} array subroutine(s).`);
    }

    async function createTypeAJapanese(block, names) {
        const progressBar = names.length > 256 ? createLoadingStatus(names.length) : null;
        if (progressBar) updateLoadingStatus(progressBar, 0, names.length);
        const translated = await translateNames(names, progressBar);
        if (progressBar) removeLoadingStatus(progressBar);
        await createTypeA(block, translated, true);
    }

    async function copyPayloadAndAlert(block, payload, message) {
        const text = JSON.stringify(payload, null, 2);
        const ok = await copyToClipboard(text);
        if (!ok) {
            alert(getPortalLanguage() === "ja" ? "クリップボードへのコピーに失敗しました。" : "Failed to copy to clipboard.");
            return false;
        }
        alert(message);
        return true;
    }

    async function createParallel(block, names) {
        const payload = await buildClipboard(block, names);
        const count = Math.ceil(names.length / 256);
        await copyPayloadAndAlert(block, payload,
            getPortalLanguage() === "ja"
                ? `${names.length}個を256個ずつ${count}個のサブルーチンに分けてクリップボードへコピーしました。`
                : `Copied ${names.length} items into ${count} collapsed subroutines (256 per array).`);
    }

    async function createTextArray(block, names) {
        const payload = createTextArrayClipboard(block, names);
        const count = Math.ceil(names.length / 256);
        await copyPayloadAndAlert(block, payload,
            getPortalLanguage() === "ja"
                ? `${names.length}個の名称をテキスト配列として${count}個の折りたたみサブルーチンにしてクリップボードへコピーしました。`
                : `Copied ${names.length} names as text arrays in ${count} collapsed subroutines.`);
    }

    async function translateTextBatch(text) {
        const endpoint = "https://translate.googleapis.com/translate_a/single";
        const url = endpoint + "?client=gtx&sl=auto&tl=ja&dt=t&q=" + encodeURIComponent(text);
        const response = await fetch(url, { method: "GET", credentials: "omit" });
        if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("Unexpected translation response");
        return data[0].map(part => Array.isArray(part) ? String(part[0] || "") : "").join("");
    }

    async function translateNames(names, progressBar = null) {
        const unique = [...new Set(names.map(normalize).filter(Boolean))];
        const translated = new Map();
        const cacheKey = "selectionListTranslationCache_v1";
        let cache = {};
        try { cache = JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch (_) { cache = {}; }

        const pending = [];
        for (const name of unique) {
            if (cache && typeof cache[name] === "string" && cache[name]) translated.set(name, cache[name]);
            else pending.push(name);
        }

        const BATCH_CHARS = 1200;
        const batches = [];
        let batch = [];
        let length = 0;
        for (const name of pending) {
            const extra = name.length + 1;
            if (batch.length && length + extra > BATCH_CHARS) {
                batches.push(batch);
                batch = [];
                length = 0;
            }
            batch.push(name);
            length += extra;
        }
        if (batch.length) batches.push(batch);

        const progressTotal = pending.length;
        let progressDone = 0;
        if (progressBar) {
            updateLoadingStatus(progressBar, 0, progressTotal);
            await yieldToUI();
        }

        const translateOneBatch = async sourceBatch => {
            const source = sourceBatch.join("\n");
            try {
                const result = await translateTextBatch(source);
                const parts = result.split(/\r?\n/);
                if (parts.length === sourceBatch.length) {
                    sourceBatch.forEach((name, i) => {
                        const value = String(parts[i] || name).trim();
                        translated.set(name, value || name);
                        cache[name] = value || name;
                    });
                    progressDone += sourceBatch.length;
                    if (progressBar) { updateLoadingStatus(progressBar, progressDone, progressTotal); await yieldToUI(); }
                    return;
                }
            } catch (_) {}

            // If a batch response cannot be mapped 1:1, retry the batch entries
            // individually. This is only a fallback; normal operation stays batched.
            for (const name of sourceBatch) {
                try {
                    const value = String(await translateTextBatch(name)).trim() || name;
                    translated.set(name, value);
                    cache[name] = value;
                } catch (_) {
                    translated.set(name, name);
                    cache[name] = name;
                }
                progressDone++;
                if (progressBar) { updateLoadingStatus(progressBar, progressDone, progressTotal); await yieldToUI(); }
            }
        };

        // A small amount of concurrency keeps large lists practical without
        // hammering the public translation endpoint with hundreds of requests.
        for (let i = 0; i < batches.length; i += 3) {
            await Promise.all(batches.slice(i, i + 3).map(translateOneBatch));
        }

        try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch (_) {}
        return names.map(name => translated.get(normalize(name)) || normalize(name));
    }


    function extractSelectionItemPairs(block) {
        const result = [];
        const seen = new Set();
        if (!block) return result;
        const fields = getAllFields(block);
        const fieldResults = [];
        for (const field of fields) {
            const options = getFieldOptionPairs(field);
            if (!isLikelySelectionField(field, options.map(o => o.display)) || !options.length) continue;
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
        for (const entry of fieldResults) {
            for (const option of entry.options) {
                const original = normalize(option.value || option.display);
                const display = normalize(option.display || option.value);
                if (!original && !display) continue;
                const key = `${original}\\u0000${display}`;
                if (seen.has(key)) continue;
                seen.add(key);
                result.push({ original, display });
            }
        }
        return result;
    }

    async function createJapaneseTextArray(block, names) {
        const progressBar = names.length > 256 ? createLoadingStatus(names.length) : null;
        if (progressBar) updateLoadingStatus(progressBar, 0, names.length);
        const translated = await translateNames(names, progressBar);
        // 完了時は表示更新を待たず、アラートを出す直前に即時で消す。
        if (progressBar) removeLoadingStatus(progressBar);
        const MAX_ITEMS_PER_ARRAY = 256;
        const pos = getBlockPosition(block);
        const x = Number(pos.x.toFixed(6));
        const base = getBaseVariableName(block);
        const chunks = [];

        for (let offset = 0, chunkIndex = 0; offset < translated.length; offset += MAX_ITEMS_PER_ARRAY, chunkIndex++) {
            const chunk = translated.slice(offset, offset + MAX_ITEMS_PER_ARRAY);
            const variableName = translated.length > MAX_ITEMS_PER_ARRAY
                ? `${base}_TEXT_J_${chunkIndex + 1}`
                : `${base}_TEXT_J`;
            const variable = findNamedGlobalVariable(variableName);
            const setBlocks = [];
            chunk.forEach((name, localIndex) => {
                const setBlock = {
                    type: "SetVariableAtIndex",
                    id: makeId("SetJa", offset + localIndex),
                    inputs: {
                        "VALUE-0": { block: {
                            type: "variableReferenceBlock",
                            id: makeId("JaVar", offset + localIndex),
                            extraState: { isObjectVar: false },
                            fields: {
                                OBJECTTYPE: "Global",
                                VAR: { id: variable.id || makeId("JaVarId", chunkIndex), name: variable.name, type: "Global" }
                            }
                        }},
                        "VALUE-1": { block: {
                            type: "Number",
                            id: makeId("JaNum", offset + localIndex),
                            fields: { NUM: localIndex }
                        }},
                        "VALUE-2": { block: {
                            type: "Text",
                            id: makeId("JaText", offset + localIndex),
                            fields: { TEXT: name }
                        }}
                    },
                    _bf6Position: { x, y: Number((pos.y + localIndex * 53).toFixed(6)) }
                };
                if (setBlocks.length) setBlocks[setBlocks.length - 1].next = { block: setBlock };
                setBlocks.push(setBlock);
            });
            const subroutineNumber = chunkIndex + 1;
            const subroutineName = `SUB_${base}_TEXT_J${String(subroutineNumber).padStart(2, "0")}`;
            const subroutineId = makeId("SubJa", subroutineNumber);
            chunks.push({
                subroutine: {
                    type: "subroutineBlock",
                    id: subroutineId,
                    collapsed: names.length > MAX_ITEMS_PER_ARRAY,
                    extraState: { subroutineName, parameters: [] },
                    fields: { SUBROUTINE_NAME: subroutineName },
                    inputs: { ACTIONS: setBlocks[0] ? { block: setBlocks[0] } : {} },
                    _bf6Position: { x, y: Number((pos.y + chunkIndex * 53 * 256).toFixed(6)) }
                },
                sourceId: subroutineId,
                variableName: variable.name,
                count: chunk.length,
                subroutineName
            });
        }

        return {
            _bf6MultiBlockClipboard: 1,
            blocks: chunks.map(c => c.subroutine),
            sourceIds: chunks.map(c => c.sourceId),
            connections: [],
            _selectionListChunks: chunks.map((c, i) => ({ index: i + 1, variable: c.variableName, count: c.count, subroutine: c.subroutineName }))
        };
    }

    async function createJapaneseArray(block, names) {
        const payload = await createJapaneseTextArray(block, names);
        const count = Math.ceil(names.length / 256);
        await copyPayloadAndAlert(block, payload,
            getPortalLanguage() === "ja"
                ? `${names.length}個を日本語名へ翻訳し、${count}個の折りたたみサブルーチンとしてクリップボードへコピーしました。`
                : `Translated ${names.length} names to Japanese and copied them into ${count} subroutine(s).`);
    }

    function exportTextFile(block, names) {
        const group = getFieldText(block, "VALUE-0") || getBaseVariableName(block);
        const filename = `${group}_list.txt`;
        const text = names.join("\r\n") + "\r\n";
        try {
            const blob = new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            alert(getPortalLanguage() === "ja"
                ? `${names.length}個の名称を「${filename}」へ出力しました。`
                : `Exported ${names.length} names to "${filename}".`);
        } catch (_) {
            alert(getPortalLanguage() === "ja" ? "テキストファイルの出力に失敗しました。" : "Failed to export the text file.");
        }
    }


    function sortJapaneseListPairs(pairs) {
        return [...pairs].sort((a, b) => {
            const aa = normalize(a.japanese || a.original);
            const bb = normalize(b.japanese || b.original);
            const aLatin = /^[A-Za-z0-9]/.test(aa);
            const bLatin = /^[A-Za-z0-9]/.test(bb);
            if (aLatin !== bLatin) return aLatin ? -1 : 1;
            return aa.localeCompare(bb, "ja", { numeric: true, sensitivity: "base" });
        });
    }

    function buildJListSelectBlock(block, originalName) {
        const type = normalize(block?.type);
        const group = getFieldText(block, "VALUE-0") || type;
        return {
            type,
            id: makeId("JList", Date.now()),
            fields: {
                "VALUE-0": group,
                "VALUE-1": normalize(originalName)
            }
        };
    }

    async function openJListSelect(block, pairs) {
        removeJListSelectPanel();

        const overlay = document.createElement("div");
        overlay.setAttribute("data-selection-list-plugin", "jlist-overlay");
        Object.assign(overlay.style, {
            position: "fixed", inset: "0", zIndex: "2147483646",
            background: "transparent", display: "block",
            padding: "0", boxSizing: "border-box", pointerEvents: "none"
        });

        const panel = document.createElement("div");
        panel.setAttribute("data-selection-list-plugin", "jlist-panel");
        const JLIST_LAYOUT_KEY = "selection_list_jlistselect_layout_v1";
        let savedLayout = null;
        try { savedLayout = JSON.parse(localStorage.getItem(JLIST_LAYOUT_KEY) || "null"); } catch (_) {}
        const defaultWidth = Math.max(420, Math.round(window.innerWidth * 0.5));
        const defaultHeight = Math.max(300, window.innerHeight - 24);
        const initialWidth = Number.isFinite(savedLayout?.width) ? Math.max(420, Math.min(savedLayout.width, window.innerWidth - 8)) : defaultWidth;
        const initialHeight = Number.isFinite(savedLayout?.height) ? Math.max(300, Math.min(savedLayout.height, window.innerHeight - 8)) : defaultHeight;
        const initialLeft = Number.isFinite(savedLayout?.left) ? Math.max(0, Math.min(savedLayout.left, window.innerWidth - initialWidth)) : Math.round((window.innerWidth - initialWidth) / 2);
        const initialTop = Number.isFinite(savedLayout?.top) ? Math.max(0, Math.min(savedLayout.top, window.innerHeight - initialHeight)) : 0;
        Object.assign(panel.style, {
            width: `${initialWidth}px`, height: `${initialHeight}px`, maxWidth: "none", maxHeight: "none",
            left: `${initialLeft}px`, top: `${initialTop}px`,
            display: "flex", flexDirection: "column", boxSizing: "border-box",
            background: "#15191b", color: "#f2f2f2",
            border: "1px solid #3a4648",
            pointerEvents: "auto",
            boxShadow: "0 0 28px rgba(0,0,0,.65)", overflow: "hidden", fontFamily: "Arial, sans-serif", position: "fixed", margin: "0"
        });
        const saveLayout = () => {
            const r = panel.getBoundingClientRect();
            try { localStorage.setItem(JLIST_LAYOUT_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })); } catch (_) {}
        };

        const header = document.createElement("div");
        Object.assign(header.style, { flex: "0 0 auto", padding: "12px 16px 10px", borderBottom: "1px solid #394447", background: "#1d2426" });

        const titleRow = document.createElement("div");
        Object.assign(titleRow.style, { display: "flex", alignItems: "center", gap: "10px", marginBottom: "9px" });
        const title = document.createElement("div");
        const blockTypeName = normalize(block?.type || "");
        title.textContent = blockTypeName ? `List → JlistSelect  |  ${blockTypeName}` : "List → JlistSelect";
        title.title = blockTypeName || "List → JlistSelect";
        Object.assign(title.style, { fontSize: "18px", fontWeight: "700", flex: "1", cursor: "move", userSelect: "none", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });

        const displayButton = document.createElement("button");
        displayButton.type = "button";
        Object.assign(displayButton.style, {
            flex: "0 0 auto", height: "30px", padding: "0 11px", border: "1px solid #4a595c",
            borderRadius: "4px", background: "#20282a", color: "#d7dddd", fontSize: "12px",
            cursor: "pointer", whiteSpace: "nowrap"
        });

        const countLabel = document.createElement("div");
        Object.assign(countLabel.style, { fontSize: "12px", color: "#aab6b9" });
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.textContent = "✕";
        Object.assign(closeButton.style, {
            flex: "0 0 auto", width: "32px", height: "30px", padding: "0", border: "1px solid #4a595c",
            borderRadius: "4px", background: "#20282a", color: "#d7dddd", fontSize: "17px", lineHeight: "28px", cursor: "pointer"
        });
        closeButton.title = "Close";
        closeButton.addEventListener("mouseenter", () => closeButton.style.background = "#3a2424");
        closeButton.addEventListener("mouseleave", () => closeButton.style.background = "#20282a");
        closeButton.addEventListener("click", () => removeJListSelectPanel());
        titleRow.appendChild(title);
        titleRow.appendChild(displayButton);
        titleRow.appendChild(countLabel);
        titleRow.appendChild(closeButton);

        const search = document.createElement("input");
        search.type = "search";
        Object.assign(search.style, {
            width: "100%", boxSizing: "border-box", padding: "9px 11px", border: "1px solid #4a595c",
            borderRadius: "3px", outline: "none", background: "#0e1213", color: "#fff", fontSize: "15px"
        });
        search.addEventListener("focus", () => search.style.borderColor = "#789096");
        search.addEventListener("blur", () => search.style.borderColor = "#4a595c");
        header.appendChild(titleRow);
        header.appendChild(search);

        const list = document.createElement("div");
        Object.assign(list.style, { flex: "1 1 auto", minHeight: "0", overflowY: "auto", overflowX: "hidden", padding: "4px 0 24px", background: "#111516" });
        const empty = document.createElement("div");
        empty.textContent = "No matching list items.";
        Object.assign(empty.style, { padding: "24px 18px", color: "#9da9ac", display: "none" });
        list.appendChild(empty);

        const rows = [];
        let displayMode = "jaen"; // jaen: Japanese left / English right, enja: English left / Japanese right
        const sortedPairs = () => {
            const copy = [...pairs];
            if (displayMode === "enja") {
                return copy.sort((a, b) => normalize(a.original || a.display).localeCompare(normalize(b.original || b.display), "en", { numeric: true, sensitivity: "base" }));
            }
            return copy.sort((a, b) => {
                const aa = normalize(a.japanese || a.original || a.display);
                const bb = normalize(b.japanese || b.original || b.display);
                const aLatin = /^[A-Za-z0-9]/.test(aa), bLatin = /^[A-Za-z0-9]/.test(bb);
                if (aLatin !== bLatin) return aLatin ? -1 : 1;
                return aa.localeCompare(bb, "ja", { numeric: true, sensitivity: "base" });
            });
        };

        const modeLabels = {
            jaen: "Display: Japanese | English",
            enja: "Display: English | Japanese"
        };
        const modePlaceholders = {
            jaen: "Search Japanese / original name…",
            enja: "Search original name / Japanese…"
        };
        const updateDisplay = () => {
            displayButton.textContent = modeLabels[displayMode];
            search.placeholder = modePlaceholders[displayMode];
            const q = normalize(search.value).toLocaleLowerCase(displayMode === "enja" ? "en" : "ja");
            const sorted = sortedPairs();
            rows.forEach(row => row.el.remove());
            rows.length = 0;
            for (const pair of sorted) {
                const original = normalize(pair.original || pair.display);
                const japanese = normalize(pair.japanese || original);
                const row = document.createElement("div");
                Object.assign(row.style, { display: "flex", alignItems: "center", minHeight: "42px", padding: "7px 16px", boxSizing: "border-box", borderBottom: "1px solid #273032", cursor: "pointer", gap: "14px" });
                const left = document.createElement("div");
                const right = document.createElement("div");
                if (displayMode === "jaen") {
                    left.textContent = japanese;
                    right.textContent = original;
                } else {
                    left.textContent = original;
                    right.textContent = japanese;
                }
                Object.assign(left.style, { flex: "1 1 50%", minWidth: "0", fontSize: "15px", fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
                Object.assign(right.style, { flex: "1 1 50%", minWidth: "0", fontSize: "15px", color: "#d1d9da", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
                row.appendChild(left); row.appendChild(right);
                row.addEventListener("mouseenter", () => row.style.background = "#263235");
                row.addEventListener("mouseleave", () => row.style.background = "transparent");
                row.addEventListener("click", async () => {
                    const payload = buildJListSelectBlock(block, original);
                    const ok = await copyToClipboard(JSON.stringify(payload, null, 2));
                    if (ok) {
                        row.style.background = "#345047";
                        setTimeout(() => { if (row.isConnected) row.style.background = "transparent"; }, 180);
                    } else {
                        alert(getPortalLanguage() === "ja" ? "クリップボードへのコピーに失敗しました。" : "Failed to copy to clipboard.");
                    }
                });
                list.appendChild(row);
                const searchText = `${japanese} ${original}`;
                rows.push({ el: row, searchText: searchText.toLocaleLowerCase(displayMode === "enja" ? "en" : "ja") });
            }
            let visible = 0;
            for (const row of rows) {
                const hit = !q || row.searchText.includes(q);
                row.el.style.display = hit ? "flex" : "none";
                if (hit) visible++;
            }
            empty.style.display = visible ? "none" : "block";
            countLabel.textContent = `${sorted.length} items`;
        };

        displayButton.addEventListener("mouseenter", () => displayButton.style.background = "#303b3d");
        displayButton.addEventListener("mouseleave", () => displayButton.style.background = "#20282a");
        displayButton.addEventListener("click", () => {
            displayMode = displayMode === "jaen" ? "enja" : "jaen";
            updateDisplay();
            search.focus();
        });
        search.addEventListener("input", updateDisplay);

        // Dedicated bottom resize strip so the bottom-right corner is easy to grab.
        const resizeStrip = document.createElement("div");
        Object.assign(resizeStrip.style, { position: "absolute", left: "0", right: "0", bottom: "0", height: "24px", zIndex: "5", background: "rgba(35,44,46,.96)", borderTop: "1px solid #394447", boxSizing: "border-box" });
        const resizeHandle = document.createElement("div");
        Object.assign(resizeHandle.style, { position: "absolute", right: "2px", bottom: "2px", width: "24px", height: "20px", cursor: "nwse-resize", background: "linear-gradient(135deg, transparent 0 45%, #657477 46% 52%, transparent 53% 62%, #657477 63% 69%, transparent 70%)" });
        resizeStrip.appendChild(resizeHandle);
        panel.style.paddingBottom = "24px";
        panel.appendChild(resizeStrip);

        let dragging = false, dragStartX = 0, dragStartY = 0, panelStartX = 0, panelStartY = 0;
        const startDrag = event => {
            if (event.button !== 0 || event.target === closeButton || event.target === displayButton) return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            dragStartX = event.clientX; dragStartY = event.clientY; panelStartX = rect.left; panelStartY = rect.top;
            panel.style.position = "fixed"; panel.style.left = `${rect.left}px`; panel.style.top = `${rect.top}px`; panel.style.margin = "0";
            panel.style.width = `${rect.width}px`; panel.style.height = `${rect.height}px`; panel.style.maxWidth = "none"; panel.style.maxHeight = "none";
            event.preventDefault();
        };
        const moveDrag = event => { if (dragging) { panel.style.left = `${panelStartX + event.clientX - dragStartX}px`; panel.style.top = `${panelStartY + event.clientY - dragStartY}px`; } };
        const endDrag = () => { if (dragging) saveLayout(); dragging = false; };
        titleRow.addEventListener("mousedown", startDrag);
        document.addEventListener("mousemove", moveDrag, true); document.addEventListener("mouseup", endDrag, true);

        let resizing = false, resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;
        const startResize = event => {
            if (event.button !== 0) return;
            resizing = true; const rect = panel.getBoundingClientRect();
            resizeStartX = event.clientX; resizeStartY = event.clientY; resizeStartW = rect.width; resizeStartH = rect.height;
            panel.style.position = "fixed"; panel.style.left = `${rect.left}px`; panel.style.top = `${rect.top}px`; panel.style.margin = "0";
            panel.style.width = `${rect.width}px`; panel.style.height = `${rect.height}px`; panel.style.maxWidth = "none"; panel.style.maxHeight = "none";
            event.preventDefault(); event.stopPropagation();
        };
        const moveResize = event => { if (resizing) { panel.style.width = `${Math.max(420, resizeStartW + event.clientX - resizeStartX)}px`; panel.style.height = `${Math.max(300, resizeStartH + event.clientY - resizeStartY)}px`; } };
        const endResize = () => { if (resizing) saveLayout(); resizing = false; };
        resizeHandle.addEventListener("mousedown", startResize);
        document.addEventListener("mousemove", moveResize, true); document.addEventListener("mouseup", endResize, true);

        overlay._jlistCleanup = () => {
            document.removeEventListener("mousemove", moveDrag, true); document.removeEventListener("mouseup", endDrag, true);
            document.removeEventListener("mousemove", moveResize, true); document.removeEventListener("mouseup", endResize, true);
            document.removeEventListener("keydown", jListEscapeHandler, true);
        };
        panel.appendChild(header); panel.appendChild(list); overlay.appendChild(panel); document.body.appendChild(overlay);
        updateDisplay();
        search.focus();
    }

    function jListEscapeHandler(event) {
        // JlistSelect is intentionally closed only by its top-right X button.
    }

    function removeJListSelectPanel() {
        document.querySelectorAll('[data-selection-list-plugin="jlist-overlay"]').forEach(el => {
            try { el._jlistCleanup?.(); } catch (_) {}
            el.remove();
        });
        document.removeEventListener("keydown", jListEscapeHandler, true);
    }

    async function openJListSelectFromContext() {
        const block = getCurrentContextBlock();
        if (!block) {
            alert(getPortalLanguage() === "ja" ? "右クリックしたブロックを取得できませんでした。" : "Could not get the context block.");
            return;
        }
        const pairs = extractSelectionItemPairs(block);
        if (!pairs.length) {
            alert(getPortalLanguage() === "ja" ? "選択リストの候補を取得できませんでした。" : "No selection-list options could be found on this block.");
            return;
        }
        const originals = pairs.map(p => normalize(p.original || p.display)).filter(Boolean);
        const progressBar = originals.length > 256 ? createLoadingStatus(originals.length) : null;
        if (progressBar) updateLoadingStatus(progressBar, 0, originals.length);
        try {
            const translated = await translateNames(originals, progressBar);
            if (progressBar) removeLoadingStatus(progressBar);
            const translatedMap = new Map();
            originals.forEach((name, i) => translatedMap.set(normalize(name), translated[i] || name));
            const translatedPairs = pairs.map(pair => ({
                original: normalize(pair.original || pair.display),
                japanese: translatedMap.get(normalize(pair.original || pair.display)) || normalize(pair.original || pair.display)
            }));
            await openJListSelect(block, translatedPairs);
        } catch (error) {
            if (progressBar) removeLoadingStatus(progressBar);
            console.error("Selection_List JlistSelect failed", error);
            alert(getPortalLanguage() === "ja" ? "日本語リストの作成に失敗しました。" : "Failed to create the Japanese list.");
        }
    }

    async function exportTranslatedTextFile(block, names) {
        const progressBar = names.length > 256 ? createLoadingStatus(names.length) : null;
        if (progressBar) updateLoadingStatus(progressBar, 0, names.length);
        const translated = await translateNames(names, progressBar);
        // 完了時は表示更新を待たず、アラートを出す直前に即時で消す。
        if (progressBar) removeLoadingStatus(progressBar);
        const group = getFieldText(block, "VALUE-0") || getBaseVariableName(block);
        const filename = `${group}_list_EJ.txt`;
        const text = names.map((name, i) => `${name},${translated[i] || name}`).join("\r\n") + "\r\n";
        try {
            const blob = new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            alert(getPortalLanguage() === "ja"
                ? `${names.length}個を「英語","日本語」形式で「${filename}」へ出力しました。`
                : `Exported ${names.length} names as English/Japanese pairs to "${filename}".`);
        } catch (_) {
            alert(getPortalLanguage() === "ja" ? "翻訳付きテキストファイルの出力に失敗しました。" : "Failed to export the translated text file.");
        }
    }

    function menuItem(label, onClick, indent = false) {
        const item = document.createElement("div");
        item.className = "selection-list-plugin-menu-item";
        item.setAttribute("data-selection-list-plugin", "item");
        Object.assign(item.style, {
            padding: "5px 18px",
            paddingLeft: indent ? "32px" : "18px",
            whiteSpace: "nowrap",
            background: "rgb(22, 29, 30)",
            color: "#ffffff",
            cursor: "pointer",
            fontSize: "15px",
            lineHeight: "1.3",
            borderTop: "1px solid #3a4648"
        });
        const labelEl = document.createElement("span");
        labelEl.className = "selection-list-plugin-menu-label";
        labelEl.textContent = label;
        item.appendChild(labelEl);
        item.addEventListener("mouseenter", () => item.style.background = "rgb(48, 60, 62)");
        item.addEventListener("mouseleave", () => item.style.background = "rgb(22, 29, 30)");
        item.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            try { onClick(); } catch (e) { console.error("Selection_List action failed", e); }
        }, true);
        return item;
    }

    function menuItemTypeChoice(label, typeAAction, typeBAction) {
        const item = document.createElement("div");
        item.className = "selection-list-plugin-menu-item";
        item.setAttribute("data-selection-list-plugin", "type-choice");
        Object.assign(item.style, {
            padding: "5px 18px",
            whiteSpace: "nowrap",
            background: "rgb(22, 29, 30)",
            color: "#ffffff",
            cursor: "pointer",
            fontSize: "15px",
            lineHeight: "1.3",
            borderTop: "1px solid #3a4648",
            position: "relative"
        });

        const labelEl = document.createElement("span");
        labelEl.textContent = `${label}  ›`;
        item.appendChild(labelEl);

        let child = null;
        const removeChild = () => {
            if (child) {
                child.remove();
                child = null;
            }
        };
        const makeChoice = (text, action) => {
            const choice = document.createElement("div");
            choice.textContent = text;
            Object.assign(choice.style, {
                padding: "5px 18px",
                minWidth: "95px",
                whiteSpace: "nowrap",
                background: "rgb(22, 29, 30)",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: "15px",
                lineHeight: "1.3",
                borderTop: "1px solid #3a4648"
            });
            choice.addEventListener("mouseenter", () => choice.style.background = "rgb(48, 60, 62)");
            choice.addEventListener("mouseleave", () => choice.style.background = "rgb(22, 29, 30)");
            choice.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                try { action(); } catch (e) { console.error("Selection_List TYPE action failed", e); }
            }, true);
            return choice;
        };

        item.addEventListener("mouseenter", () => {
            item.style.background = "rgb(48, 60, 62)";
            if (child) return;
            child = document.createElement("div");
            child.setAttribute("data-selection-list-plugin", "type-choice-panel");
            Object.assign(child.style, {
                position: "absolute",
                left: "100%",
                top: "-1px",
                minWidth: "95px",
                padding: "2px 0",
                background: "rgb(22, 29, 30)",
                border: "1px solid #3a4648",
                boxShadow: "0 3px 14px rgba(0,0,0,.45)",
                zIndex: "2147483647"
            });
            child.appendChild(makeChoice("TYPE-A", typeAAction));
            child.appendChild(makeChoice("TYPE-B", typeBAction));
            item.appendChild(child);
        });
        item.addEventListener("mouseleave", event => {
            item.style.background = "rgb(22, 29, 30)";
            if (child && event.relatedTarget && child.contains(event.relatedTarget)) return;
            removeChild();
        });
        return item;
    }

    function getCurrentContextBlock() {
        return lastContextBlock || getBlockFromId(lastContextBlockId);
    }

    function getNamesOrAlert() {
        const block = getCurrentContextBlock();
        if (!block) {
            alert(getPortalLanguage() === "ja" ? "右クリックしたブロックを取得できませんでした。" : "Could not get the context block.");
            return null;
        }
        const names = extractSelectionItems(block);
        if (!names.length) {
            alert(getPortalLanguage() === "ja" ? "選択リストの候補を取得できませんでした。" : "No selection-list options could be found on this block.");
            return null;
        }
        return { block, names };
    }

    let floatingMenuObserver = null;
    let lastContextMenuX = 0;
    let lastContextMenuY = 0;

    function isSelectionListBlock(block) {
        if (!block) return false;
        const type = normalize(block.type);
        if (/Item$/i.test(type)) {
            const names = extractSelectionItems(block);
            if (names.length >= 2) return true;
        }
        try {
            const fields = getAllFields(block);
            for (const field of fields) {
                const options = getFieldOptions(field);
                const name = normalize(field?.name).toLowerCase();
                const ctor = normalize(field?.constructor?.name).toLowerCase();
                if (options.length >= 2 && (name === "value-1" || ctor.includes("dropdown"))) return true;
            }
        } catch (_) {}
        return false;
    }

    function removeFloatingMenu() {
        document.querySelectorAll('[data-selection-list-plugin="floating-root"]').forEach(el => el.remove());
        if (floatingMenuObserver) {
            try { floatingMenuObserver.disconnect(); } catch (_) {}
            floatingMenuObserver = null;
        }
    }

    function createFloatingMenu(anchor, clientX, clientY) {
        removeFloatingMenu();

        const panel = document.createElement("div");
        panel.setAttribute("data-selection-list-plugin", "floating-root");
        const px = Number.isFinite(clientX) ? clientX : 0;
        const py = Number.isFinite(clientY) ? clientY : 0;

        Object.assign(panel.style, {
            // Fixed coordinates are based on the cursor position when
            // Selection List receives hover, with a 26px horizontal offset.
            // Because the panel remains a descendant of Selection List, the
            // parent hover state stays active while entering any of the three
            // entries.
            position: "fixed",
            left: `${Math.max(0, Math.round(px + 26))}px`,
            top: `${Math.max(0, Math.round(py))}px`,
            minWidth: "190px",
            background: "rgb(22, 29, 30)",
            color: "#fff",
            border: "1px solid #3a4648",
            boxShadow: "0 3px 14px rgba(0,0,0,.45)",
            zIndex: "2147483647",
            padding: "2px 0",
            display: "flex",
            flexDirection: "column",
            pointerEvents: "auto"
        });

        // Build all three entries before attaching the panel. This avoids
        // PORTAL's MutationObserver reacting between individual insertions.
        const entries = [
            menuItem("List → JlistSelect", async (event) => {
                try {
                    event?.preventDefault?.();
                    event?.stopPropagation?.();
                    event?.stopImmediatePropagation?.();
                } catch (_) {}
                setTimeout(() => {
                    openJListSelectFromContext().catch(error => {
                        console.error("Selection_List JlistSelect failed", error);
                    });
                }, 0);
            }),
            menuItemTypeChoice("List → array",
                async () => {
                    const data = getNamesOrAlert();
                    if (!data) return;
                    await createTypeA(data.block, data.names, false);
                    removeFloatingMenu();
                },
                async () => {
                    const data = getNamesOrAlert();
                    if (!data) return;
                    await createParallel(data.block, data.names);
                    removeFloatingMenu();
                }
            ),
            menuItemTypeChoice("ListName → array",
                async () => {
                    const data = getNamesOrAlert();
                    if (!data) return;
                    await createTypeA(data.block, data.names, false);
                    removeFloatingMenu();
                },
                async () => {
                    const data = getNamesOrAlert();
                    if (!data) return;
                    await createTextArray(data.block, data.names);
                    removeFloatingMenu();
                }
            ),
            menuItemTypeChoice("ListName → array (J)",
                async () => {
                    const data = getNamesOrAlert();
                    if (!data) return;
                    await createTypeAJapanese(data.block, data.names);
                    removeFloatingMenu();
                },
                async () => {
                    const data = getNamesOrAlert();
                    if (!data) return;
                    await createJapaneseArray(data.block, data.names);
                    removeFloatingMenu();
                }
            ),
            menuItem("ListName → File", () => {
                const data = getNamesOrAlert();
                if (!data) return;
                exportTextFile(data.block, data.names);
                removeFloatingMenu();
            }),
            menuItem("ListName → File (E,J)", async () => {
                const data = getNamesOrAlert();
                if (!data) return;
                await exportTranslatedTextFile(data.block, data.names);
                removeFloatingMenu();
            })
        ];
        entries.forEach(entry => panel.appendChild(entry));

        // Keep the three-item panel as a child of Selection List itself.
        // This is important: moving the pointer from Selection List into the
        // three entries must still count as hovering the parent item, so
        // PORTAL does not close its Options menu. All three entries are added
        // before attachment so PORTAL never sees a partially-built submenu.
        anchor.appendChild(panel);
        return panel;
    }

    function addSelectionListMenu(submenu) {
        if (!submenu || !submenu.isConnected) return;
        if (submenu.querySelector('[data-selection-list-plugin="root"]')) return;

        const root = document.createElement("div");
        root.className = "selection-list-plugin-root";
        root.setAttribute("data-selection-list-plugin", "root");
        Object.assign(root.style, {
            padding: "5px 18px",
            whiteSpace: "nowrap",
            background: "rgb(22, 29, 30)",
            color: "#ffffff",
            cursor: "pointer",
            fontSize: "15px",
            lineHeight: "1.3",
            borderTop: "1px solid #3a4648",
            marginTop: "3px",
            position: "relative"
        });

        const title = document.createElement("span");
        title.textContent = "Selection List  ›";
        root.appendChild(title);

        let submenuOpen = false;

        root.addEventListener("mouseenter", event => {
            root.style.background = "rgb(48,60,62)";
            if (!submenuOpen) {
                submenuOpen = true;
                createFloatingMenu(root, event.clientX, event.clientY);
            }
        });

        root.addEventListener("mouseleave", event => {
            root.style.background = "rgb(22,29,30)";
            // Keep the submenu alive while the pointer is over the floating panel.
            const panel = document.querySelector('[data-selection-list-plugin="floating-root"]');
            if (panel && event.relatedTarget && panel.contains(event.relatedTarget)) return;
            submenuOpen = false;
            removeFloatingMenu();
        });

        // Hover only, matching PORTAL's native Options behavior. If the parent
        // menu is rebuilt, re-create the three entries from the current cursor.
        root.addEventListener("mousemove", event => {
            const panel = document.querySelector('[data-selection-list-plugin="floating-root"]');
            if (!submenuOpen || !panel) {
                submenuOpen = true;
                createFloatingMenu(root, event.clientX, event.clientY);
            }
        });

        submenu.appendChild(root);
    }

    function scan() {
        const block = getCurrentContextBlock();
        const eligible = isSelectionListBlock(block);
        const submenus = document.querySelectorAll(".bf6-experience-manager-options-submenu");
        if (!eligible) {
            submenus.forEach(submenu => submenu.querySelector('[data-selection-list-plugin="root"]')?.remove());
            removeFloatingMenu();
            return;
        }
        for (const submenu of submenus) addSelectionListMenu(submenu);
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver(scan);
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
        scan();
    }

    document.addEventListener("contextmenu", event => {
        try {
            lastContextMenuX = Number.isFinite(event.clientX) ? event.clientX : 0;
            lastContextMenuY = Number.isFinite(event.clientY) ? event.clientY : 0;
            const blockEl = event.target?.closest?.("g.blocklyDraggable");
            const id = blockEl?.getAttribute?.("data-id") || blockEl?.dataset?.id || null;
            lastContextBlockId = id ? String(id) : null;
            lastContextBlock = getBlockFromId(lastContextBlockId);
            removeFloatingMenu();
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
