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
                ? `${names.length}個の選択肢を配列変数「${findGlobalVariable(block).name}」へ入れる折りたたみサブルーチンをクリップボードにコピーしました。`
                : `Copied ${names.length} blocks for array variable "${findGlobalVariable(block).name}" inside a collapsed subroutine to the clipboard.`);
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
                    collapsed: true,
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
                    collapsed: true,
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
                : `Translated ${names.length} names to Japanese and copied them into ${count} collapsed subroutines.`);
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
