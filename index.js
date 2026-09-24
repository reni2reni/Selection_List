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
        if (!block) return false;
        const type = String(block.type || "").toLowerCase();
        if (/selection[_-]?list|list[_-]?selection/.test(type)) return true;

        let text = "";
        try { text += " " + String(block.toString?.() || ""); } catch (_) {}
        try {
            for (const input of block.inputList || []) {
                for (const field of input?.fieldRow || []) {
                    try {
                        text += " " + String(field.getText?.() ?? field.getValue?.() ?? "");
                    } catch (_) {}
                }
            }
        } catch (_) {}
        return /選択リスト|selection\s*list/i.test(text);
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

    function extractSelectionItemNames(block) {
        const result = [];
        const seen = new Set();

        // Selection List implementations commonly keep their entries in one of these arrays.
        extractArrayProperty(block,
            ["itemNames", "items", "listItems", "selectionItems", "options", "choices", "values"],
            result, seen);

        // Some versions expose item names through named fields/inputs.
        try {
            for (const input of block.inputList || []) {
                for (const field of input?.fieldRow || []) {
                    if (!field) continue;
                    const fieldName = String(field.name || "").toUpperCase();
                    if (!/(ITEM|OPTION|CHOICE|SELECTION|LIST|VALUE|NAME|TEXT)/.test(fieldName)) continue;
                    let value = "";
                    try { value = field.getText?.() ?? ""; } catch (_) {}
                    if (!value) {
                        try { value = field.getValue?.() ?? ""; } catch (_) {}
                    }
                    addUnique(result, seen, value);
                }
            }
        } catch (_) {}

        // Fallback: inspect descendant blocks whose type/name suggests a list item.
        try {
            const descendants = typeof block.getDescendants === "function"
                ? block.getDescendants(false) || []
                : [];
            for (const child of descendants) {
                const type = String(child?.type || "").toLowerCase();
                if (!/(selection|list|option|choice|item)/.test(type)) continue;
                for (const input of child.inputList || []) {
                    for (const field of input?.fieldRow || []) {
                        let value = "";
                        try { value = field?.getText?.() ?? ""; } catch (_) {}
                        if (!value) {
                            try { value = field?.getValue?.() ?? ""; } catch (_) {}
                        }
                        addUnique(result, seen, value);
                    }
                }
            }
        } catch (_) {}

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
