import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Colors transcribed from the dc.html SQL syntax sample (both themes).
const dark = {
  bg: "#0d0d0f",
  fg: "#c9c9d0",
  gutterBg: "#0d0d0f",
  gutterFg: "#3a3a42",
  gutterActive: "#8b8b93",
  cursor: "#ededef",
  selection: "#26262b",
  keyword: "#ffffff",
  fn: "#ededef",
  string: "#9a9aa2",
  number: "#a1a1a8",
  comment: "#5c5c64",
  tooltipBg: "#141417",
  tooltipBorder: "#2a2a2f",
  tooltipHeaderBg: "#1c1c20",
};

const light = {
  bg: "#ffffff",
  fg: "#3f3f46",
  gutterBg: "#ffffff",
  gutterFg: "#c9c9ce",
  gutterActive: "#5f5f68",
  cursor: "#18181b",
  selection: "#e6e6e9",
  keyword: "#09090b",
  fn: "#18181b",
  string: "#71717a",
  number: "#5f5f68",
  comment: "#a1a1a8",
  tooltipBg: "#ffffff",
  tooltipBorder: "#e4e4e7",
  tooltipHeaderBg: "#f2f2f3",
};

function buildTheme(c: typeof dark) {
  const editorTheme = EditorView.theme(
    {
      "&": { backgroundColor: c.bg, color: c.fg, height: "100%", outline: "none" },
      ".cm-content": { fontFamily: "'JetBrains Mono', monospace", fontSize: "12.5px", lineHeight: "22px", padding: "14px 18px" },
      ".cm-scroller": { fontFamily: "'JetBrains Mono', monospace" },
      ".cm-gutters": { backgroundColor: c.gutterBg, color: c.gutterFg, border: "none", paddingTop: "14px" },
      ".cm-lineNumbers .cm-gutterElement": { fontSize: "11.5px", fontFamily: "'JetBrains Mono', monospace" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: c.gutterActive },
      ".cm-activeLine": { backgroundColor: "transparent" },
      "&.cm-focused .cm-cursor": { borderLeftColor: c.cursor },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: c.selection },
      ".cm-tooltip-autocomplete": {
        backgroundColor: c.tooltipBg,
        border: `1px solid ${c.tooltipBorder}`,
        borderRadius: "8px",
        overflow: "hidden",
        boxShadow: "0 12px 32px rgba(0,0,0,.35)",
      },
      ".cm-tooltip-autocomplete ul": { fontFamily: "'JetBrains Mono', monospace", maxHeight: "180px" },
      ".cm-tooltip-autocomplete ul li": { padding: "0", height: "28px", display: "flex", alignItems: "center" },
      ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: c.tooltipHeaderBg },
    },
    { dark: c === dark },
  );

  const highlight = syntaxHighlighting(
    HighlightStyle.define([
      { tag: t.keyword, color: c.keyword, fontWeight: "600" },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: c.fn, fontWeight: "500" },
      { tag: t.string, color: c.string },
      { tag: t.number, color: c.number },
      { tag: t.comment, color: c.comment },
      { tag: t.operator, color: c.keyword, fontWeight: "600" },
      { tag: [t.name, t.propertyName], color: c.fg },
    ]),
  );

  return [editorTheme, highlight];
}

export const darkSqlTheme = buildTheme(dark);
export const lightSqlTheme = buildTheme(light);
