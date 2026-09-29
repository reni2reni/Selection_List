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
        // 本体を変更せず、ブラウザ標準のクリップボードへ書き込む。
        // 中身は本体の copy-block と同じ Blockly serialization 形式なので、
        // 本体の通常のPaste処理でそのまま扱える。
        const value = String(text ?? "");
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch (_) {}
        try {
            const ta = document.createElement("textarea");
            ta.value = value;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            ta.style.top = "0";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return !!ok;
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

    function copyViaPortalNative(block, names, targetFieldName = "VALUE-1") {
        const ws = getWorkspace();
        const Blockly = _Blockly || window.Blockly;
        if (!ws || !Blockly?.serialization?.blocks?.append || !block || !Array.isArray(names) || !names.length) return false;

        const tempBlocks = [];
        let eventsDisabled = false;
        try {
            if (Blockly.Events?.disable) {
                Blockly.Events.disable();
                eventsDisabled = true;
            }

            const base = cloneJson(Blockly.serialization.blocks.save(block));
            if (!base) return false;
            try { if (base.next) delete base.next; } catch (_) {}

            for (let i = 0; i < names.length; i++) {
                const data = cloneJson(base);
                if (!data) continue;
                const wanted = normalize(names[i]);
                let changed = false;
                if (data.fields && Object.prototype.hasOwnProperty.call(data.fields, targetFieldName)) {
                    data.fields[targetFieldName] = wanted;
                    changed = true;
                }
                const walkFields = obj => {
                    if (!obj || typeof obj !== "object") return;
                    if (Array.isArray(obj)) { obj.forEach(walkFields); return; }
                    if (obj.fields && typeof obj.fields === "object" && Object.prototype.hasOwnProperty.call(obj.fields, targetFieldName)) {
                        obj.fields[targetFieldName] = wanted;
                        changed = true;
                    }
                    for (const v of Object.values(obj)) walkFields(v);
                };
                if (!changed) walkFields(data);
                remapSerializedIds(data, `JListNative${i}`);

                // 一時ブロックは画面外へ置き、貼り付け位置は本体側に任せる。
                try {
                    if (data.x !== undefined) delete data.x;
                    if (data.y !== undefined) delete data.y;
                    if (data._bf6Position) delete data._bf6Position;
                } catch (_) {}

                const created = Blockly.serialization.blocks.append(data, ws);
                if (created) tempBlocks.push(created);
            }

            if (!tempBlocks.length) return false;

            // ここが重要：プラグイン独自のJSONクリップボードではなく、
            // 本体が通常の「Copy」で使っている copy-block 経路を呼び出す。
            window.dispatchEvent(new CustomEvent("bf6-experience-manager-action", {
                detail: {
                    action: "copy-block",
                    blockId: tempBlocks[0].id,
                    selectedBlockIds: tempBlocks.map(b => String(b.id))
                }
            }));
            return true;
        } catch (error) {
            console.error("[Selection_List] native copy failed", error);
            return false;
        } finally {
            for (const temp of tempBlocks) {
                try { temp.dispose?.(true, true); } catch (_) {}
            }
            if (eventsDisabled && Blockly.Events?.enable) Blockly.Events.enable();
            try { ws.resizeContents?.(); } catch (_) {}
        }
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

    function shouldKeepTranslationToken(token) {
        return /^[A-Za-z]$/.test(String(token || '').trim());
    }

    // Translation corrections: apply these AFTER the translation service.
    // Add known BF6 identifiers / terminology here instead of changing the
    // translator itself. Exact matches take priority over API results.
    const TRANSLATION_CORRECTIONS = {
        "OnPlayerDeployed": "オンプレイヤーデプロイド",
    };

    function applyTranslationCorrection(original, translated) {
        const source = normalize(original);
        if (Object.prototype.hasOwnProperty.call(TRANSLATION_CORRECTIONS, source)) {
            return TRANSLATION_CORRECTIONS[source];
        }
        return normalize(translated) || source;
    }

    async function translateNames(names, progressBar = null) {
        const unique = [...new Set(names.map(normalize).filter(Boolean))];
        const translated = new Map();

        // Selection-list names such as:
        //   CarSedan_01_Door_RearRight
        // must NOT be sent to the translator as one phrase.  Each "_"-
        // separated component is translated independently and then the
        // original separators are restored.
        const cacheKey = "selectionListTranslationCache_v2_parts";
        let cache = {};
        try { cache = JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch (_) { cache = {}; }

        const partsForName = name => String(name).split("_");
        const partKeys = new Set();
        for (const name of unique) {
            for (const part of partsForName(name)) {
                if (part && !shouldKeepTranslationToken(part)) partKeys.add(part);
            }
        }

        const pendingParts = [];
        for (const part of partKeys) {
            if (typeof cache[part] === "string" && cache[part]) {
                continue;
            }
            pendingParts.push(part);
        }

        const progressTotal = pendingParts.length;
        let progressDone = 0;
        if (progressBar) {
            updateLoadingStatus(progressBar, 0, progressTotal);
            await yieldToUI();
        }

        // Translate individual "_" components.  Batching is still used for
        // efficiency, but every component is separated by a newline so the
        // translation endpoint never sees the original compound identifier.
        const BATCH_CHARS = 1200;
        const batches = [];
        let batch = [];
        let length = 0;
        for (const part of pendingParts) {
            const extra = part.length + 1;
            if (batch.length && length + extra > BATCH_CHARS) {
                batches.push(batch);
                batch = [];
                length = 0;
            }
            batch.push(part);
            length += extra;
        }
        if (batch.length) batches.push(batch);

        const translateOneBatch = async sourceBatch => {
            try {
                const source = sourceBatch.join("\n");
                const result = await translateTextBatch(source);
                const parts = result.split(/\r?\n/);

                if (parts.length === sourceBatch.length) {
                    sourceBatch.forEach((part, i) => {
                        const value = String(parts[i] || part).trim() || part;
                        cache[part] = applyTranslationCorrection(part, value);
                    });
                    progressDone += sourceBatch.length;
                    if (progressBar) {
                        updateLoadingStatus(progressBar, progressDone, progressTotal);
                        await yieldToUI();
                    }
                    return;
                }
            } catch (_) {}

            // If newline mapping is unreliable, retry each component alone.
            for (const part of sourceBatch) {
                try {
                    const value = String(await translateTextBatch(part)).trim() || part;
                    cache[part] = applyTranslationCorrection(part, value);
                } catch (_) {
                    cache[part] = part;
                }
                progressDone++;
                if (progressBar) {
                    updateLoadingStatus(progressBar, progressDone, progressTotal);
                    await yieldToUI();
                }
            }
        };

        // A small amount of concurrency keeps large lists practical.
        for (let i = 0; i < batches.length; i += 3) {
            await Promise.all(batches.slice(i, i + 3).map(translateOneBatch));
        }

        // Reassemble each original identifier with "_" unchanged.
        for (const name of unique) {
            const translatedParts = partsForName(name).map(part => {
                if (!part) return "";
                if (shouldKeepTranslationToken(part)) return part;
                return applyTranslationCorrection(part, typeof cache[part] === "string" && cache[part] ? cache[part] : part);
            });
            translated.set(name, translatedParts.join("_"));
        }

        try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch (_) {}

        return names.map(name => translated.get(normalize(name)) || normalize(name));
    }

    // EVENTTYPE identifiers are usually CamelCase (e.g. OnPlayerEnterCapturePoint).
    // Keep the original identifier for display/copy, but insert spaces at word
    // boundaries only for the translation request so the translator can
    // understand the individual English words.
    function splitCamelCaseForTranslation(value) {
        const text = normalize(value);
        if (!text) return "";
        return text
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/([A-Za-z])([0-9]+)/g, "$1 $2")
            .replace(/([0-9]+)([A-Za-z])/g, "$1 $2")
            .replace(/\s+/g, " ")
            .trim();
    }

    async function translateEventTypeNames(names, progressBar = null) {
        const unique = [...new Set(names.map(normalize).filter(Boolean))];
        const translated = new Map();
        for (const name of unique) {
            if (shouldKeepTranslationToken(name)) translated.set(name, name);
        }
        const cacheKey = "selectionListTranslationCache_v3_eventtype_camel";
        let cache = {};
        try { cache = JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch (_) { cache = {}; }

        const pending = unique.filter(name => !shouldKeepTranslationToken(name) && (typeof cache[name] !== "string" || !cache[name]));
        const total = pending.length;
        let done = 0;
        if (progressBar) {
            updateLoadingStatus(progressBar, 0, total);
            await yieldToUI();
        }

        const BATCH_CHARS = 1200;
        const batches = [];
        let batch = [];
        let length = 0;
        for (const name of pending) {
            const source = splitCamelCaseForTranslation(name);
            const extra = source.length + 1;
            if (batch.length && length + extra > BATCH_CHARS) {
                batches.push(batch);
                batch = [];
                length = 0;
            }
            batch.push({ name, source });
            length += extra;
        }
        if (batch.length) batches.push(batch);

        const translateBatch = async sourceBatch => {
            try {
                const source = sourceBatch.map(item => item.source).join("\n");
                const result = await translateTextBatch(source);
                const parts = result.split(/\r?\n/);
                if (parts.length === sourceBatch.length) {
                    sourceBatch.forEach((item, i) => {
                        const value = String(parts[i] || "").trim();
                        cache[item.name] = applyTranslationCorrection(item.name, value || item.name);
                    });
                    done += sourceBatch.length;
                    if (progressBar) {
                        updateLoadingStatus(progressBar, done, total);
                        await yieldToUI();
                    }
                    return;
                }
            } catch (_) {}

            for (const item of sourceBatch) {
                try {
                    const value = String(await translateTextBatch(item.source)).trim();
                    cache[item.name] = applyTranslationCorrection(item.name, value || item.name);
                } catch (_) {
                    cache[item.name] = applyTranslationCorrection(item.name, item.name);
                }
                done++;
                if (progressBar) {
                    updateLoadingStatus(progressBar, done, total);
                    await yieldToUI();
                }
            }
        };

        for (let i = 0; i < batches.length; i += 3) {
            await Promise.all(batches.slice(i, i + 3).map(translateBatch));
        }

        for (const name of unique) {
            if (!translated.has(name)) translated.set(name, applyTranslationCorrection(name, cache[name] || name));
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

    // BF6 ExperienceManager本体のコピー処理と同じく、Blocklyの標準シリアライズ結果を
    // ベースにする。本体そのものは変更せず、プラグイン側で同じブロックデータを生成する。
    function cloneJson(value) {
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
    }

    function remapSerializedIds(root, seed) {
        const idMap = new Map();
        const makeUniqueId = oldId => {
            const key = String(oldId || "");
            if (!key) return makeId(seed, idMap.size);
            if (!idMap.has(key)) idMap.set(key, makeId(seed, idMap.size));
            return idMap.get(key);
        };
        const visit = value => {
            if (!value || typeof value !== "object") return;
            if (Array.isArray(value)) { value.forEach(visit); return; }
            if (Object.prototype.hasOwnProperty.call(value, "id")) value.id = makeUniqueId(value.id);
            for (const child of Object.values(value)) visit(child);
        };
        visit(root);
        return root;
    }

    function buildJListSelectBlock(block, originalName, copyIndex = 0, targetFieldName = "VALUE-1") {
        const Blockly = getWorkspace() ? (_Blockly || window.Blockly) : (_Blockly || window.Blockly);
        let data = null;
        try {
            data = cloneJson(Blockly?.serialization?.blocks?.save?.(block));
        } catch (_) {}
        if (!data) {
            const type = normalize(block?.type);
            const group = getFieldText(block, "VALUE-0") || type;
            data = { type, id: makeId("JList", Date.now() + copyIndex), fields: { "VALUE-0": group, "VALUE-1": normalize(originalName) } };
        }

        // 本体の copy-block と同じく next はコピー対象から外す。
        try { if (data && data.next) delete data.next; } catch (_) {}

        // 選択リストの値だけを差し替え、他のフィールド・extraState・mutation等は本体の
        // シリアライズ結果をそのまま維持する。
        const wanted = normalize(originalName);
        let changed = false;
        if (data.fields && Object.prototype.hasOwnProperty.call(data.fields, targetFieldName)) {
            data.fields[targetFieldName] = wanted;
            changed = true;
        }
        const walkFields = obj => {
            if (!obj || typeof obj !== "object") return;
            if (Array.isArray(obj)) { obj.forEach(walkFields); return; }
            if (obj.fields && typeof obj.fields === "object" && Object.prototype.hasOwnProperty.call(obj.fields, targetFieldName)) {
                obj.fields[targetFieldName] = wanted;
                changed = true;
            }
            for (const v of Object.values(obj)) walkFields(v);
        };
        if (!changed) walkFields(data);
        return remapSerializedIds(data, `JList${copyIndex}`);
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
        const ruleMode = isRuleBlock(block);
        const ruleEventType = ruleMode ? getRuleEventType(block) : "";
        title.textContent = ruleMode
            ? `List → JlistSelect  |  EVENTTYPE: ${ruleEventType} イベントタイプのみの検索`
            : (blockTypeName ? `List → JlistSelect  |  ${blockTypeName}` : "List → JlistSelect");
        title.title = ruleMode ? `EVENTTYPE: ${ruleEventType}` : (blockTypeName || "List → JlistSelect");
        Object.assign(title.style, { fontSize: "18px", fontWeight: "700", flex: "1", cursor: "move", userSelect: "none", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });

        const displayButton = document.createElement("button");
        displayButton.type = "button";
        Object.assign(displayButton.style, {
            flex: "0 0 auto", height: "30px", padding: "0 11px", border: "1px solid #4a595c",
            borderRadius: "4px", background: "#20282a", color: "#d7dddd", fontSize: "12px",
            cursor: "pointer", whiteSpace: "nowrap"
        });

        const countLabel = document.createElement("div");
        Object.assign(countLabel.style, { fontSize: "12px", color: "#aab6b9", minWidth: "120px", textAlign: "right" });

        const copySelectedButton = document.createElement("button");
        copySelectedButton.type = "button";
        copySelectedButton.textContent = "Copy selected (0)";
        Object.assign(copySelectedButton.style, {
            flex: "0 0 auto", height: "30px", padding: "0 11px", border: "1px solid #4a595c",
            borderRadius: "4px", background: "#20282a", color: "#d7dddd", fontSize: "12px",
            cursor: "pointer", whiteSpace: "nowrap", opacity: "0.55"
        });
        copySelectedButton.title = "Copy selected items. Shift+click = range, Ctrl/Cmd+click = individual selection.";
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
        titleRow.appendChild(copySelectedButton);
        titleRow.appendChild(countLabel);
        titleRow.appendChild(closeButton);

        let panelCollapsed = false;
        let titleClickStartX = 0;
        let titleClickStartY = 0;
        let titleClickMoved = false;
        const setPanelCollapsed = collapsed => {
            panelCollapsed = !!collapsed;
            search.style.display = panelCollapsed ? "none" : "";
            list.style.display = panelCollapsed ? "none" : "";
            resizeStrip.style.display = panelCollapsed ? "none" : "";
            titleRow.style.marginBottom = panelCollapsed ? "0" : "9px";
            // 折りたたみ時はタイトルバーだけの高さにする。
            if (panelCollapsed) {
                panel.dataset.expandedHeight = panel.style.height || "";
                panel.style.height = "auto";
                panel.style.minHeight = "0";
                panel.style.maxHeight = "none";
            } else {
                panel.style.minHeight = "";
                const savedHeight = panel.dataset.expandedHeight;
                if (savedHeight) panel.style.height = savedHeight;
            }
        };
        titleRow.addEventListener("mousedown", event => {
            titleClickStartX = event.clientX;
            titleClickStartY = event.clientY;
            titleClickMoved = false;
        }, true);
        titleRow.addEventListener("mousemove", event => {
            if (Math.abs(event.clientX - titleClickStartX) > 4 || Math.abs(event.clientY - titleClickStartY) > 4) {
                titleClickMoved = true;
            }
        }, true);
        titleRow.addEventListener("click", event => {
            if (titleClickMoved) return;
            if (event.target === closeButton || event.target === displayButton || event.target === copySelectedButton) return;
            // タイトル文字部分をクリックしたら、タイトルバーだけ残して折りたたむ／再表示。
            setPanelCollapsed(!panelCollapsed);
        }, false);

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
        const selectedOriginals = new Set();
        let lastSelectedOriginal = null;
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
            jaen: ruleMode ? `EVENTTYPE: ${ruleEventType} のみ検索…` : "Search Japanese / original name…",
            enja: ruleMode ? `Search only EVENTTYPE: ${ruleEventType}…` : "Search original name / Japanese…"
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
                Object.assign(row.style, { display: "flex", alignItems: "center", minHeight: "42px", padding: "7px 16px", boxSizing: "border-box", borderBottom: "1px solid #273032", cursor: "pointer", gap: "14px", userSelect: "none" });
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
                const refreshRowSelection = () => {
                    const selected = selectedOriginals.has(original);
                    row.style.background = selected ? "#2459a6" : "transparent";
                    row.style.color = selected ? "#ffffff" : "";
                    left.style.color = selected ? "#ffffff" : "";
                    right.style.color = selected ? "#eaf2ff" : "#d1d9da";
                    row.setAttribute("aria-selected", selected ? "true" : "false");
                };
                row._selectionOriginal = original;
                row._refreshSelection = refreshRowSelection;
                row.addEventListener("mouseenter", () => {
                    if (!selectedOriginals.has(original)) row.style.background = "#263235";
                });
                row.addEventListener("mouseleave", () => {
                    refreshRowSelection();
                });
                row.addEventListener("click", async (event) => {
                    const isRange = event.shiftKey;
                    const isToggle = event.ctrlKey || event.metaKey;
                    if (isRange || isToggle) {
                        const visibleRows = rows.filter(r => r.el.style.display !== "none");
                        const clickedIndex = visibleRows.findIndex(r => r.original === original);
                        if (isRange && lastSelectedOriginal !== null) {
                            const anchorIndex = visibleRows.findIndex(r => r.original === lastSelectedOriginal);
                            if (anchorIndex >= 0 && clickedIndex >= 0) {
                                const start = Math.min(anchorIndex, clickedIndex);
                                const end = Math.max(anchorIndex, clickedIndex);
                                for (let i = start; i <= end; i++) selectedOriginals.add(visibleRows[i].original);
                            } else {
                                selectedOriginals.add(original);
                            }
                        } else if (isToggle) {
                            if (selectedOriginals.has(original)) selectedOriginals.delete(original);
                            else selectedOriginals.add(original);
                        }
                        lastSelectedOriginal = original;
                        rows.forEach(r => r._refreshSelection?.());
                        updateSelectedCount();
                        return;
                    }

                    selectedOriginals.clear();
                    selectedOriginals.add(original);
                    lastSelectedOriginal = original;
                    rows.forEach(r => r._refreshSelection?.());
                    updateSelectedCount();

                    const ok = copyViaPortalNative(block, [original], isRuleBlock(block) ? "EVENTTYPE" : "VALUE-1");
                    if (ok) {
                        row.style.background = "#345047";
                        setTimeout(() => { if (row.isConnected) row._refreshSelection?.(); }, 180);
                    } else {
                        alert(getPortalLanguage() === "ja" ? "クリップボードへのコピーに失敗しました。" : "Failed to copy to clipboard.");
                    }
                });
                list.appendChild(row);
                const searchText = `${japanese} ${original}`;
                rows.push({ el: row, original, searchText: searchText.toLocaleLowerCase(displayMode === "enja" ? "en" : "ja"), _refreshSelection: refreshRowSelection });
                refreshRowSelection();
            }
            let visible = 0;
            for (const row of rows) {
                const hit = !q || row.searchText.includes(q);
                row.el.style.display = hit ? "flex" : "none";
                if (hit) visible++;
            }
            empty.style.display = visible ? "none" : "block";
            countLabel.textContent = `${sorted.length} items`;
            updateSelectedCount();
        };

        function updateSelectedCount() {
            const selectedCount = selectedOriginals.size;
            copySelectedButton.textContent = `Copy selected (${selectedCount})`;
            copySelectedButton.style.opacity = selectedCount ? "1" : "0.55";
            copySelectedButton.style.cursor = selectedCount ? "pointer" : "default";
            countLabel.textContent = `${rows.length ? sortedPairs().length : 0} items · ${selectedCount} selected`;
            rows.forEach(r => r._refreshSelection?.());
        }

        copySelectedButton.addEventListener("mouseenter", () => {
            if (selectedOriginals.size) copySelectedButton.style.background = "#303b3d";
        });
        copySelectedButton.addEventListener("mouseleave", () => copySelectedButton.style.background = "#20282a");
        copySelectedButton.addEventListener("click", async () => {
            if (!selectedOriginals.size) return;
            const selected = sortedPairs().filter(pair => selectedOriginals.has(normalize(pair.original || pair.display)));
            if (!selected.length) return;

            // 複数コピーも本体の通常Copy処理を利用する。
            // Selection_List独自の _bf6MultiBlockClipboard は生成しない。
            const names = selected.map(pair => normalize(pair.original || pair.display));
            const ok = copyViaPortalNative(block, names, isRuleBlock(block) ? "EVENTTYPE" : "VALUE-1");
            if (ok) {
                copySelectedButton.textContent = `COPY済み (${selected.length})`;
                setTimeout(() => updateSelectedCount(), 1000);
            } else {
                alert(getPortalLanguage() === "ja" ? "本体のコピー処理を呼び出せませんでした。" : "Could not invoke the portal's native copy handler.");
            }
        });

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
        const ruleMode = isRuleBlock(block);
        const pairs = ruleMode ? extractRuleEventTypePairs(block) : extractSelectionItemPairs(block);
        if (!pairs.length) {
            alert(getPortalLanguage() === "ja" ? "対象ブロックの候補を取得できませんでした。" : "No list options could be found on this block.");
            return;
        }
        const originals = pairs.map(p => normalize(p.original || p.display)).filter(Boolean);
        const progressBar = !ruleMode && originals.length > 256 ? createLoadingStatus(originals.length) : null;
        if (progressBar) updateLoadingStatus(progressBar, 0, originals.length);
        try {
            const translated = ruleMode
                ? await translateEventTypeNames(originals, progressBar)
                : await translateNames(originals, progressBar);
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
            alert(getPortalLanguage() === "ja" ? "JListSelectの表示に失敗しました。" : "Failed to open JListSelect.");
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

    function getCurrentContextBlock() {
        return lastContextBlock || getBlockFromId(lastContextBlockId);
    }

    // Rule blocks: use the current EVENTTYPE only (e.g. OnPlayerDeployed).
    // This keeps the plugin focused on the event currently configured on the rule block.
    function isRuleBlock(block) {
        if (!block) return false;
        try {
            const field = block.getField?.("EVENTTYPE");
            return !!field;
        } catch (_) { return false; }
    }

    function getRuleEventType(block) {
        return getFieldText(block, "EVENTTYPE");
    }

    function extractRuleEventTypePairs(block) {
        if (!block) return [];
        const field = block.getField?.("EVENTTYPE");
        if (!field) return [];

        // EVENTTYPE は現在選択されている値ではなく、Blockly の
        // ドロップダウンが持っている「全イベント候補」を取得する。
        // 本体の FieldDropdown / menuGenerator が公開している候補を最優先で使う。
        const raw = [];
        try {
            if (typeof field.getOptions === "function") {
                const options = field.getOptions(false);
                if (Array.isArray(options)) raw.push(...options);
            }
        } catch (_) {}
        for (const key of ["options_", "options", "menuGenerator_", "menuGenerator", "choices", "values"]) {
            try {
                const value = field[key];
                if (Array.isArray(value)) raw.push(...value);
                else if (typeof value === "function") {
                    const generated = value.call(field);
                    if (Array.isArray(generated)) raw.push(...generated);
                }
            } catch (_) {}
        }

        const result = [];
        const seen = new Set();
        for (const option of raw) {
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
            value = value || display;
            display = display || value;
            if (!value || seen.has(value)) continue;
            seen.add(value);
            result.push({ original: value, display, japanese: value });
        }

        // 本体のフィールド実装によって候補が getOptions() から取れない場合の保険。
        // この場合だけ現在値を1件として返す。
        if (!result.length) {
            const eventType = getRuleEventType(block);
            if (eventType) result.push({ original: eventType, display: eventType, japanese: eventType });
        }
        return result;
    }

    function getContextListData() {
        const block = getCurrentContextBlock();
        if (!block) return null;
        if (isRuleBlock(block)) {
            const pairs = extractRuleEventTypePairs(block);
            if (!pairs.length) return null;
            return { block, names: pairs.map(p => p.original), pairs, rule: true, eventType: getRuleEventType(block) };
        }
        const names = extractSelectionItems(block);
        if (!names.length) return null;
        return { block, names, pairs: extractSelectionItemPairs(block), rule: false };
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
        if (isRuleBlock(block)) return true;
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
        const ruleMode = isRuleBlock(getCurrentContextBlock());
        const entries = ruleMode ? [
            menuItem("List → JlistSelect", async (event) => {
                try {
                    event?.preventDefault?.();
                    event?.stopPropagation?.();
                    event?.stopImmediatePropagation?.();
                } catch (_) {}
                setTimeout(() => {
                    openJListSelectFromContext().catch(error => console.error("Selection_List JlistSelect failed", error));
                }, 0);
            }),
            menuItem("ListName → File", () => {
                const data = getContextListData();
                if (!data) return;
                exportTextFile(data.block, data.names);
                removeFloatingMenu();
            }),
            menuItem("ListName → File (E,J)", async () => {
                const data = getContextListData();
                if (!data) return;
                await exportTranslatedTextFile(data.block, data.names);
                removeFloatingMenu();
            })
        ] : [
            menuItem("List → JlistSelect", async (event) => {
                try {
                    event?.preventDefault?.();
                    event?.stopPropagation?.();
                    event?.stopImmediatePropagation?.();
                } catch (_) {}
                setTimeout(() => {
                    openJListSelectFromContext().catch(error => console.error("Selection_List JlistSelect failed", error));
                }, 0);
            }),
            menuItem("List → array", async () => {
                const data = getNamesOrAlert();
                if (!data) return;
                await createParallel(data.block, data.names);
                removeFloatingMenu();
            }),
            menuItem("ListName → array", async () => {
                const data = getNamesOrAlert();
                if (!data) return;
                await createTextArray(data.block, data.names);
                removeFloatingMenu();
            }),
            menuItem("ListName → array (J)", async () => {
                const data = getNamesOrAlert();
                if (!data) return;
                await createJapaneseArray(data.block, data.names);
                removeFloatingMenu();
            }),
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

    // ============================================================
    // Japanese popup translation for Blockly flyout + native Help
    // Based on the existing working translation functions above.
    // IMPORTANT: does not modify the actual Blockly block label.
    // ============================================================
    const MENU_JA_KEY = "selectionListMenuJapaneseEnabled_v1";
    let menuJapaneseEnabled = true;
    try {
        const saved = localStorage.getItem(MENU_JA_KEY);
        if (saved !== null) menuJapaneseEnabled = saved !== "0";
    } catch (_) {}

    function saveMenuJapaneseSetting() {
        try { localStorage.setItem(MENU_JA_KEY, menuJapaneseEnabled ? "1" : "0"); } catch (_) {}
    }

    const helpOriginalText = new WeakMap();
    const helpTranslatedText = new WeakMap();
    let helpRunTimer = null;
    let helpRunning = false;

    const popupOriginal = new WeakMap();
    let hoverPopup = null;
    let hoverToken = 0;
    let hoverTimer = null;

    function isVisibleElement(el) {
        if (!el || !el.isConnected) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 2 && r.height > 2;
    }

    function splitCamelWords(value) {
        return splitCamelCaseForTranslation(value);
    }

    async function translateForDisplay(source) {
        const text = normalize(source);
        if (!text) return "";
        if (shouldKeepTranslationToken(text)) return text;

        // 1. 既知の修正辞書にあれば即座にそれを返す
        const corrected = applyTranslationCorrection(text, "");
        if (corrected && corrected !== text) return corrected;

        // 2. キャメルケースを空白で分解（例: "OnPlayerDeployed" -> "On Player Deployed"）
        //    これをしないとGoogle翻訳が1単語として無視し、英語のまま返してきます
        const spaced = splitCamelWords(text);

        try {
            const translated = await translateTextBatch(spaced || text);
            return applyTranslationCorrection(text, translated);
        } catch (_) {
            return text;
        }
    }

    function ensureHoverPopup() {
        if (hoverPopup?.isConnected) return hoverPopup;
        const el = document.createElement("div");
        el.id = "selection-list-japanese-hover-popup";
        Object.assign(el.style, {
            position: "fixed",
            zIndex: "2147483647",
            display: "none",
            maxWidth: "520px",
            minWidth: "160px",
            padding: "12px 18px",
            borderRadius: "8px",
            background: "rgba(20,20,20,.96)",
            color: "#fff",
            fontSize: "24px",
            fontWeight: "700",
            lineHeight: "1.35",
            textAlign: "center",
            whiteSpace: "normal",
            wordBreak: "break-word",
            boxSizing: "border-box",
            pointerEvents: "none",
            boxShadow: "0 5px 22px rgba(0,0,0,.45)"
        });
        document.body.appendChild(el);
        hoverPopup = el;
        return el;
    }

    function positionHoverPopup(target) {
        const popup = ensureHoverPopup();
        const r = target.getBoundingClientRect();
        // Always prefer ABOVE the block. If there is not enough room, clamp
        // into the viewport rather than moving it below unless unavoidable.
        const pw = Math.min(520, Math.max(160, window.innerWidth - 24));
        popup.style.maxWidth = `${pw}px`;
        popup.style.left = "0px";
        popup.style.top = "0px";
        const pr = popup.getBoundingClientRect();
        let left = r.left + (r.width - pr.width) / 2;
        let top = r.top - pr.height - 12;
        left = Math.max(12, Math.min(left, window.innerWidth - pr.width - 12));
        if (top < 12) top = 12;
        popup.style.left = `${Math.round(left)}px`;
        popup.style.top = `${Math.round(top)}px`;
    }

    function hideHoverPopup() {
        hoverToken++;
        if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
        }
        if (hoverPopup) hoverPopup.style.display = "none";
    }

    function getFlyoutBlockFromTarget(target) {
        if (!(target instanceof Element)) return null;
        // 左メニュー内のブロック、またはドラッグ可能なブロック要素を確実に取得
        return target.closest('g.blocklyDraggable, [data-id]');
    }

    function getFlyoutBlockText(block) {
        if (!block) return "";
        const texts = [...block.querySelectorAll("text, .blocklyText")];
        const values = texts
            .map(el => normalize(el.textContent))
            .filter(v => v && !shouldKeepTranslationToken(v));
        if (values.length) return values.join(" ");
        return normalize(block.textContent);
    }

    async function showBlockJapanesePopup(block) {
        const source = getFlyoutBlockText(block);
        if (!source) return;

        const token = ++hoverToken;
        const popup = ensureHoverPopup();
        popup.textContent = "日本語化中…";
        popup.style.display = "block";
        positionHoverPopup(block);

        // Give the browser a paint opportunity before the network request.
        await yieldToUI();
        if (token !== hoverToken || !block.isConnected) return;

        const translated = await Promise.race([
            translateForDisplay(source),
            new Promise(resolve => setTimeout(() => resolve(""), 5000))
        ]);

        if (token !== hoverToken || !block.isConnected) return;
        popup.textContent = translated && translated !== source
            ? translated
            : splitCamelWords(source);
        positionHoverPopup(block);
    }

    function bindBlockHoverPopup() {
        if (window.__selectionListBlockHoverPopupBound) return;
        window.__selectionListBlockHoverPopupBound = true;

        document.addEventListener("pointerover", event => {
            const block = getFlyoutBlockFromTarget(event.target);
            if (!block) return;
            const related = event.relatedTarget;
            if (related instanceof Node && block.contains(related)) return;

            hideHoverPopup();
            const token = ++hoverToken;
            hoverTimer = setTimeout(() => {
                hoverTimer = null;
                if (token === hoverToken) showBlockJapanesePopup(block);
            }, 60);
        }, true);

        document.addEventListener("pointerout", event => {
            const block = getFlyoutBlockFromTarget(event.target);
            if (!block) return;
            const related = event.relatedTarget;
            if (related instanceof Node && block.contains(related)) return;
            hideHoverPopup();
        }, true);

        window.addEventListener("scroll", hideHoverPopup, true);
        window.addEventListener("resize", hideHoverPopup);
    }

    function findNativeHelpDialog() {
        // Portalの右側スライドパネル・ヘルプドロワーを捕捉
        const candidates = [...document.querySelectorAll(
            'aside, section, [role="dialog"], [aria-modal="true"], [class*="sidebar" i], [class*="drawer" i], [class*="panel" i], [class*="help" i], [class*="Help"]'
        )].filter(isVisibleElement);

        for (const el of candidates) {
            const text = normalize(el.innerText || el.textContent || "");
            // ヘルプ画面の文章によく含まれる英語単語を検知
            if (/(Description|Inputs|Outputs|Returns|Usage|Help|説明)/i.test(text)) {
                return el;
            }
        }
        return null;
    }

    function collectHelpTextNodes(root) {
        if (!root) return [];
        const out = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const p = node.parentElement;
            if (!p) continue;
            if (/^(SCRIPT|STYLE|CODE|PRE|TEXTAREA|INPUT|BUTTON|OPTION)$/.test(p.tagName)) continue;
            if (p.closest("code,pre,textarea,input,button,.blocklyBlock,.blocklyFlyout,.blocklyWorkspace")) continue;
            const text = normalize(node.nodeValue);
            if (!text || text.length > 500) continue;
            if (/^[\d\s\-_/.:,()[\]{}]+$/.test(text)) continue;
            out.push(node);
        }
        return out;
    }

    async function translateHelpNode(node) {
        if (!node?.isConnected) return;
        if (!helpOriginalText.has(node)) helpOriginalText.set(node, node.nodeValue);
        const source = normalize(helpOriginalText.get(node));
        if (!source) return;

        const cached = helpTranslatedText.get(node);
        if (cached && cached.source === source) {
            node.nodeValue = cached.value;
            return;
        }

        const translated = await translateForDisplay(source);
        if (node.isConnected && translated && translated !== source) {
            node.nodeValue = translated;
            helpTranslatedText.set(node, { source, value: translated });
        }
    }

    async function translateNativeHelp() {
        if (helpRunning || !menuJapaneseEnabled) return;
        const dialog = findNativeHelpDialog();
        if (!dialog) return;

        helpRunning = true;
        try {
            const nodes = collectHelpTextNodes(dialog);
            // Work in small batches so Help never freezes the page.
            for (let i = 0; i < nodes.length; i += 4) {
                await Promise.all(nodes.slice(i, i + 4).map(translateHelpNode));
                await yieldToUI();
            }
        } finally {
            helpRunning = false;
        }
    }

    function scheduleHelpTranslation() {
        if (helpRunTimer) clearTimeout(helpRunTimer);
        helpRunTimer = setTimeout(async () => {
            helpRunTimer = null;
            await translateNativeHelp();
            // Help content can be rendered after the menu click. One bounded retry.
            setTimeout(() => translateNativeHelp(), 700);
        }, 150);
    }

    function bindJapaneseMenuTranslation() {
        if (window.__selectionListJapaneseMenuBoundV2) return;
        window.__selectionListJapaneseMenuBoundV2 = true;
        bindBlockHoverPopup();

        document.addEventListener("click", event => {
            const target = event.target?.closest?.('[role="menuitem"], button, [aria-label], li, div, span');
            if (!target) return;
            const text = normalize(target.innerText || target.textContent || target.getAttribute?.("aria-label") || "");
            if (text === "Help" || text === "ヘルプ") scheduleHelpTranslation();
        }, true);

        document.addEventListener("contextmenu", () => {
            [0, 100, 250].forEach(delay => setTimeout(addMenuJapaneseToggle, delay));
        }, true);
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
        bindJapaneseMenuTranslation();
        startObserver();
        scan();
    };
})();
