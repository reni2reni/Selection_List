/* global BF2042Portal, _Blockly */
(function () {
    "use strict";

    // Selection_List: BF2042 Portal の「選択リスト」ブロックから項目名をテキスト出力する独立プラグイン
    const plugin = BF2042Portal.Plugins.getPlugin("Selection_List");
    let observer = null;
    let lastContextBlockId = null;
    let lastContextBlock = null;

    function getPortalLanguage() {
        const candidates = [
            document && document.documentElement ? document.documentElement.lang : "",
            typeof navigator !== "undefined" ? navigator.language : ""
        ];
        const lang = candidates.find(v => typeof v === "string" && v.trim()) || "";
        return lang.toLowerCase().startsWith("ja") ? "ja" : "en";
    }

    function getBlockFromId(id) {
        if (!id) return null;
        try {
            const ws = _Blockly?.getMainWorkspace?.();
            if (ws?.getBlockById) return ws.getBlockById(String(id));
        } catch (_) {}
        return null;
    }

    function isSelectionListBlock(block) {
        // まずはブロック種類の判定を行わず、どのブロック上でも
        // 「オプション > Selection List」を表示する。
        // 実際の選択リスト構造の判定は、後で対象ブロックの構造が
        // 確定してから追加する。
        return !!block;
    }

    function getFieldValue(block, fieldName) {
        try {
            const field = typeof block.getField === "function" ? block.getField(fieldName) : null;
            if (field) {
                const value = typeof field.getValue === "function" ? field.getValue() :
                    (typeof field.getText === "function" ? field.getText() : "");
                if (value != null && String(value).trim() !== "") return String(value).trim();
            }
        } catch (_) {}

        try {
            for (const input of block.inputList || []) {
                for (const field of input?.fieldRow || []) {
                    if (String(field?.name || '') !== fieldName) continue;
                    const value = typeof field.getValue === "function" ? field.getValue() :
                        (typeof field.getText === "function" ? field.getText() : "");
                    if (value != null && String(value).trim() !== "") return String(value).trim();
                }
            }
        } catch (_) {}
        return "";
    }

    function getSelectionListName(block) {
        return getFieldValue(block, "VALUE-0");
    }

    function getSelectionItemName(block) {
        return getFieldValue(block, "VALUE-1");
    }

    function cleanName(value) {
        if (value === null || value === undefined) return "";
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            const s = String(value).trim();
            return s;
        }
        return "";
    }

    function addUnique(list, seen, value) {
        const s = cleanName(value);
        if (!s || seen.has(s)) return;
        seen.add(s);
        list.push(s);
    }

    function valueFromObject(obj) {
        if (obj === null || obj === undefined) return "";
        if (typeof obj !== "object") return cleanName(obj);
        const keys = ["name", "displayName", "label", "text", "title", "value", "option", "choice", "itemName"];
        for (const key of keys) {
            const value = cleanName(obj[key]);
            if (value) return value;
        }
        return "";
    }

    function extractArrayProperty(block, names, result, seen) {
        for (const name of names) {
            let value;
            try { value = block[name]; } catch (_) { value = undefined; }
            if (!Array.isArray(value)) continue;
            for (const item of value) {
                addUnique(result, seen, valueFromObject(item));
            }
            if (result.length) return true;
        }
        return false;
    }

    function getBlockDefinitions() {
        try {
            const getter = BF2042Portal?.Startup?.getBlockDefinitions;
            if (typeof getter === "function") return getter();
        } catch (_) {}
        try {
            const host = window.__BF2042_PLUGIN_HOST__;
            if (host && host.definitions != null) return host.definitions;
        } catch (_) {}
        return null;
    }

    function normalizeText(value) {
        if (value === null || value === undefined) return "";
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return String(value).trim();
        }
        return "";
    }

    function definitionType(def) {
        if (!def || typeof def !== "object") return "";
        return normalizeText(def.type || def.blockType || def.id || def.kind);
    }

    function categoryText(def) {
        if (!def || typeof def !== "object") return "";
        const parts = [];
        for (const key of ["category", "categoryName", "toolboxCategory", "group", "groupName", "menu", "menuName", "parentCategory"]) {
            if (def[key] != null) parts.push(normalizeText(def[key]));
        }
        return parts.join(" ");
    }

    function isSelectionCategory(text) {
        const s = String(text || "").toLowerCase();
        return /選択リスト|selection\s*list|selectionlist/.test(s);
    }

    function addCandidateValue(result, seen, value) {
        const s = normalizeText(value);
        if (!s || seen.has(s)) return;
        seen.add(s);
        result.push(s);
    }

    function collectOptionStrings(value, result, seen) {
        if (value == null) return;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (Array.isArray(item)) {
                    // Blocklyの dropdown options: [[表示名, 値], ...]
                    if (item.length >= 2) {
                        addCandidateValue(result, seen, item[0]);
                    }
                    continue;
                }
                collectOptionStrings(item, result, seen);
            }
            return;
        }
        if (typeof value !== "object") return;

        for (const key of ["options", "choices", "items", "values", "list", "elements", "entries"]) {
            if (Array.isArray(value[key])) collectOptionStrings(value[key], result, seen);
        }
    }

    function collectDefinitionFields(def, result, seen) {
        if (!def || typeof def !== "object") return;

        // fields: {"VALUE-0":"SoldierStateBool", "VALUE-1":"IsAISoldier"}
        if (def.fields && typeof def.fields === "object" && !Array.isArray(def.fields)) {
            addCandidateValue(result, seen, def.fields["VALUE-1"]);
        }

        // Blockly JSON / definition variants.
        for (const container of [def.args0, def.inputs, def.inputList, def.fields]) {
            if (!container) continue;
            if (Array.isArray(container)) {
                for (const item of container) {
                    if (!item || typeof item !== "object") continue;
                    const name = normalizeText(item.name || item.field || item.fieldName);
                    if (name === "VALUE-1") {
                        addCandidateValue(result, seen, item.value);
                        addCandidateValue(result, seen, item.text);
                        addCandidateValue(result, seen, item.default);
                    }
                    if (name === "VALUE-0") {
                        // VALUE-0 is the list name, not an item name.
                    }
                    collectOptionStrings(item, result, seen);
                }
            } else if (typeof container === "object") {
                addCandidateValue(result, seen, container["VALUE-1"]);
            }
        }

        // Generic option containers.
        for (const key of ["options", "choices", "items", "values", "list", "elements", "entries"]) {
            if (def[key] != null) collectOptionStrings(def[key], result, seen);
        }
    }

    function walkDefinitions(value, visitor, path = [], seenObjects = new Set()) {
        if (value === null || value === undefined) return;
        if (typeof value !== "object") return;
        if (seenObjects.has(value)) return;
        seenObjects.add(value);

        visitor(value, path);
        if (Array.isArray(value)) {
            value.forEach((item, index) => walkDefinitions(item, visitor, path.concat(index), seenObjects));
        } else {
            for (const [key, child] of Object.entries(value)) {
                if (key === "parent" || key === "workspace" || key === "svgRoot") continue;
                if (child && typeof child === "object") {
                    walkDefinitions(child, visitor, path.concat(key), seenObjects);
                }
            }
        }
    }

    function getToolboxCategoryName(block) {
        // 選択中ブロックの type を基準に、PORTALのToolbox DOMから
        // 「選択リスト」カテゴリ配下に存在するかも確認する。
        const type = normalizeText(block?.type);
        if (!type) return "";
        try {
            const toolbox = document.querySelector(".blocklyToolboxDiv");
            if (!toolbox) return "";
            const categories = toolbox.querySelectorAll("[role='treeitem'], .blocklyTreeRow, .blocklyToolboxCategory");
            for (const category of categories) {
                const text = normalizeText(category.textContent);
                if (!isSelectionCategory(text)) continue;
                if (category.querySelector(`[data-type="${CSS.escape(type)}"]`)) return text;
                if (category.querySelector(`[type="${CSS.escape(type)}"]`)) return text;
            }
        } catch (_) {}
        return "";
    }

    function extractSelectionItemNames(block) {
        const result = [];
        const seen = new Set();
        const selectedType = normalizeText(block?.type);
        if (!selectedType) return result;

        const definitions = getBlockDefinitions();

        // まずPORTAL本体が保持している Frostbite Block Definitions を検索する。
        // ワークスペース上の「今ある1個」ではなく、Toolboxに登録されている
        // 同一ブロック定義をすべて対象にするのがポイント。
        if (definitions != null) {
            walkDefinitions(definitions, (def) => {
                const type = definitionType(def);
                if (type !== selectedType) return;

                // 選択リストカテゴリ由来の定義を優先。
                // category情報が無い形式もあるため、type一致なら候補として扱う。
                const category = categoryText(def);
                if (category && !isSelectionCategory(category)) return;
                collectDefinitionFields(def, result, seen);
            });
        }

        // もし定義データにcategory情報が無い場合、Toolbox上の選択リストカテゴリを
        //確認できれば、type一致の定義結果をそのまま採用する。
        // さらに、定義側の形式が特殊だった場合に備えて、ワークスペース上の同型ブロックも補完する。
        const ws = block.workspace || _Blockly?.getMainWorkspace?.();
        const blocks = ws?.getAllBlocks?.(false) || [];
        for (const candidate of blocks) {
            if (!candidate || normalizeText(candidate.type) !== selectedType) continue;
            const itemName = getSelectionItemName(candidate);
            if (itemName) addCandidateValue(result, seen, itemName);
        }

        return result;
    }

    function downloadSelectionList() {
        const block = lastContextBlock || getBlockFromId(lastContextBlockId);
        const ja = getPortalLanguage() === "ja";

        if (!block || !isSelectionListBlock(block)) {
            alert(ja
                ? "選択リストブロック上で「オプション」→「Selection List」を実行してください。"
                : "Run Options → Selection List on a Selection List block.");
            return;
        }

        const names = extractSelectionItemNames(block);
        if (!names.length) {
            alert(ja
                ? "選択リストの項目名を取得できませんでした。"
                : "No selection list item names could be found.");
            return;
        }

        const text = names.join("\n") + "\n";
        const blob = new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "Selection_List.txt";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function addSelectionListItem(submenu) {
        if (!submenu || !submenu.isConnected) return;
        if (submenu.querySelector('[data-selection-list-plugin="1"]')) return;

        const block = lastContextBlock || getBlockFromId(lastContextBlockId);
        if (!isSelectionListBlock(block)) return;

        const isJa = getPortalLanguage() === "ja";
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
            downloadSelectionList();
        }, true);

        submenu.appendChild(item);
    }

    function scan() {
        const submenus = document.querySelectorAll(".bf6-experience-manager-options-submenu");
        for (const submenu of submenus) addSelectionListItem(submenu);
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver(() => scan());
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
        scan();
    }

    document.addEventListener("contextmenu", event => {
        try {
            const target = event.target;
            const blockEl = target?.closest?.("g.blocklyDraggable");
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
