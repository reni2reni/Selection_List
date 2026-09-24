/* global BF2042Portal, _Blockly */
(function () {
    "use strict";

    // Selection_List
    // 選択中ブロックの「選択リスト」フィールドそのものから、
    // 現在値ではなく dropdown の全候補を取得して保存する。
    const plugin = BF2042Portal.Plugins.getPlugin("Selection_List");
    let observer = null;
    let lastContextBlockId = null;
    let lastContextBlock = null;

    function getPortalLanguage() {
        const candidates = [
            document?.documentElement?.lang || "",
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

    function normalize(value) {
        if (value === null || value === undefined) return "";
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return String(value).trim();
        }
        return "";
    }

    function addUnique(out, seen, value) {
        const s = normalize(value);
        if (!s || seen.has(s)) return;
        seen.add(s);
        out.push(s);
    }

    // Blockly FieldDropdown / Portal custom dropdown の候補を取得する。
    function getFieldOptions(field) {
        if (!field) return [];
        const candidates = [];

        // 標準Blockly API。useCache=false が重要で、現在選択中の値ではなく
        // dropdown generator を再評価する。
        try {
            if (typeof field.getOptions === "function") {
                const value = field.getOptions(false);
                if (Array.isArray(value)) candidates.push(value);
            }
        } catch (_) {}

        // カスタムFieldが getOptions を公開していない場合の補完。
        for (const key of ["options_", "options", "menuGenerator_", "menuGenerator", "choices", "values"]) {
            try {
                const value = field[key];
                if (Array.isArray(value)) candidates.push(value);
                else if (typeof value === "function") {
                    try {
                        const generated = value.call(field);
                        if (Array.isArray(generated)) candidates.push(generated);
                    } catch (_) {}
                }
            } catch (_) {}
        }

        const out = [];
        const seen = new Set();
        for (const list of candidates) {
            for (const option of list) {
                if (Array.isArray(option)) {
                    // Blockly dropdown: [displayText, value]
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

        // 重複除去
        return [...new Set(fields)];
    }

    function getFieldCurrentValue(field) {
        try {
            if (typeof field.getValue === "function") return normalize(field.getValue());
        } catch (_) {}
        try {
            if (typeof field.getText === "function") return normalize(field.getText());
        } catch (_) {}
        return "";
    }

    function isLikelySelectionField(field, options) {
        if (!field || options.length < 2) return false;

        const name = normalize(field.name).toLowerCase();
        const ctor = normalize(field.constructor?.name).toLowerCase();
        const text = normalize(field.getText?.()).toLowerCase();

        // Selection List item の VALUE-1 はこのパターン。
        if (name === "value-1") return true;
        if (ctor.includes("dropdown")) return true;

        // Portal側のカスタムselection fieldを広めに許容。
        if (/selection|list|item|enum|type/.test(name)) return true;
        if (/dropdown|select|selection|enum/.test(ctor)) return true;
        if (text && options.includes(text) && options.length >= 2) return true;

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
            if (!isLikelySelectionField(field, options)) continue;
            if (!options.length) continue;
            fieldResults.push({ field, options });
        }

        // まず VALUE-1 / Dropdown 系を優先。
        fieldResults.sort((a, b) => {
            const an = normalize(a.field?.name).toLowerCase();
            const bn = normalize(b.field?.name).toLowerCase();
            const ap = an === "value-1" || normalize(a.field?.constructor?.name).toLowerCase().includes("dropdown") ? 0 : 1;
            const bp = bn === "value-1" || normalize(b.field?.constructor?.name).toLowerCase().includes("dropdown") ? 0 : 1;
            return ap - bp;
        });

        for (const entry of fieldResults) {
            for (const option of entry.options) addUnique(result, seen, option);
        }

        return result;
    }

    function downloadSelectionList() {
        const block = lastContextBlock || getBlockFromId(lastContextBlockId);
        const ja = getPortalLanguage() === "ja";

        if (!block) {
            alert(ja ? "右クリックしたブロックを取得できませんでした。" : "Could not get the context block.");
            return;
        }

        const names = extractSelectionItems(block);
        if (!names.length) {
            alert(ja
                ? "このブロックから選択リストの候補を取得できませんでした。"
                : "No selection-list options could be found on this block.");
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
