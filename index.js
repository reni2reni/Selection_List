/* global BF2042Portal */
(function () {
    "use strict";

    // Block_Catalog: BF2042 Portal のブロック定義をテキスト出力する独立プラグイン
    const plugin = BF2042Portal.Plugins.getPlugin("Block_Catalog");
    let observer = null;
    let registeredSubmenu = null;

    function getPortalLanguage() {
        const candidates = [
            document && document.documentElement ? document.documentElement.lang : "",
            typeof navigator !== "undefined" ? navigator.language : ""
        ];
        const lang = candidates.find(v => typeof v === "string" && v.trim()) || "";
        return lang.toLowerCase().startsWith("ja") ? "ja" : "en";
    }

    function catalogValue(obj, keys) {
        if (!obj || typeof obj !== "object") return "";
        for (const key of keys) {
            const value = obj[key];
            if (typeof value === "string" && value.trim()) return value.trim();
        }
        return "";
    }

    function formatBlockCatalog(definitions) {
        const seen = new WeakSet();
        const lines = [
            "PORTAL Block Catalog",
            "Generated: " + new Date().toLocaleString(),
            "",
            "親子関係はインデントで表します。",
            "名前 / type / id は定義データから取得できたものを表示します。",
            ""
        ];
        const nameKeys = ["name", "displayName", "label", "title", "text", "blockName", "categoryName", "menuName"];
        const typeKeys = ["type", "blockType", "kind"];
        const idKeys = ["id", "blockId", "definitionId"];

        const isBlockish = (obj) => {
            if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
            const hasType = !!catalogValue(obj, typeKeys);
            const hasBlock = ["block", "inputs", "fields", "output", "previousStatement", "nextStatement", "message0", "args0"]
                .some(k => Object.prototype.hasOwnProperty.call(obj, k));
            return hasType || hasBlock;
        };

        function nodeTitle(value, key) {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                const n = catalogValue(value, nameKeys);
                const t = catalogValue(value, typeKeys);
                const id = catalogValue(value, idKeys);
                if (n || t || id) {
                    const parts = [];
                    if (n) parts.push(n);
                    if (t && t !== n) parts.push("type=" + t);
                    if (id && id !== t && id !== n) parts.push("id=" + id);
                    return parts.join(" | ");
                }
            }
            return String(key);
        }

        function walk(value, label, depth) {
            const pad = "  ".repeat(depth);
            if (value === null || value === undefined || typeof value !== "object") {
                lines.push(pad + "└─ " + label + ": " + String(value));
                return;
            }
            if (seen.has(value)) {
                lines.push(pad + "└─ " + label + " [循環参照]");
                return;
            }
            seen.add(value);

            if (Array.isArray(value)) {
                lines.push(pad + "├─ " + label + " [" + value.length + " items]");
                value.forEach((child, i) => walk(child, "[" + i + "]", depth + 1));
                return;
            }

            const title = nodeTitle(value, label);
            const marker = isBlockish(value) ? "◆ " : "";
            lines.push(pad + "├─ " + marker + title);
            const keys = Object.keys(value);
            for (const key of keys) {
                if (["name", "displayName", "label", "title", "type", "blockType", "kind", "id", "blockId", "definitionId"].includes(key)) continue;
                const child = value[key];
                if (child && typeof child === "object") walk(child, key, depth + 1);
            }
        }

        if (Array.isArray(definitions)) {
            lines.push("=== Definitions ===");
            definitions.forEach((v, i) => walk(v, "[" + i + "]", 0));
        } else if (definitions && typeof definitions === "object") {
            for (const key of Object.keys(definitions)) walk(definitions[key], key, 0);
        } else {
            lines.push(String(definitions));
        }
        return lines.join("\n") + "\n";
    }

    function getDefinitions() {
        try {
            const definitions = BF2042Portal?.Startup?.getBlockDefinitions?.();
            if (definitions !== undefined && definitions !== null) return definitions;
        } catch (_) {}
        return undefined;
    }

    function downloadCatalog() {
        const definitions = getDefinitions();
        const ja = getPortalLanguage() === "ja";
        if (definitions === undefined || definitions === null) {
            const message = ja
                ? "ブロック定義がまだ取得できません。ページを再読み込みしてから再度実行してください。"
                : "Block definitions are not available yet. Reload the page and try again.";
            alert(message);
            return;
        }

        const text = formatBlockCatalog(definitions);
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "PORTAL_Block_Catalog.txt";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function addCatalogItem(submenu) {
        if (!submenu || !submenu.isConnected) return;
        if (submenu.querySelector('[data-bf6-block-catalog-plugin="1"]')) return;

        const isJa = getPortalLanguage() === "ja";
        const item = document.createElement("div");
        item.className = "bf6-options-menu-item";
        item.setAttribute("data-bf6-block-catalog-plugin", "1");
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
        label.textContent = isJa ? "ブロック一覧をテキスト出力" : "Export Block List";
        item.appendChild(label);

        item.addEventListener("mouseenter", () => item.style.background = "rgb(48, 60, 62)");
        item.addEventListener("mouseleave", () => item.style.background = "rgb(22, 29, 30)");
        item.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            downloadCatalog();
        }, true);

        submenu.appendChild(item);
        registeredSubmenu = submenu;
    }

    function scan() {
        const submenus = document.querySelectorAll(".bf6-experience-manager-options-submenu");
        for (const submenu of submenus) addCatalogItem(submenu);
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver(() => scan());
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
        scan();
    }

    plugin.initializeWorkspace = async function () {
        startObserver();
        scan();
    };
})();
