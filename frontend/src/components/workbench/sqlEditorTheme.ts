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
  templateVar: "#d7b8f3",
  templateVarBg: "rgba(199,146,234,0.14)",
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
  templateVar: "#7c3aed",
  templateVarBg: "rgba(124,58,237,0.09)",
};

function buildTheme(c: typeof dark) {
  const editorTheme = EditorView.theme(
    {
      "&": { backgroundColor: c.bg, color: c.fg, height: "100%", outline: "none" },
      ".cm-content": { fontFamily: "'JetBrains Mono', monospace", fontSize: "12.5px", lineHeight: "22px", padding: "14px 18px" },
      ".cm-scroller": { fontFamily: "'JetBrains Mono', monospace" },
      // paddingTop is what makes CodeMirror size each gutter row to match
      // .cm-content's actual 22px line height — without it, gutter rows
      // fall back to a smaller unstyled metric and drift out of sync down
      // the file. But CodeMirror also adds its own compensating margin-top
      // to the first row equal to this same value (expecting the gutter to
      // have none of its own), so with both present the whole column ends
      // up one padding-amount too far down. Cancel that with an equal
      // negative margin-top on the container — it only shifts the column's
      // starting position, not the (correct) per-row spacing.
      ".cm-gutters": {
        backgroundColor: c.gutterBg,
        color: c.gutterFg,
        border: "none",
        paddingTop: "14px",
        marginTop: "-14px",
      },
      // Must match .cm-content's lineHeight exactly — otherwise each gutter
      // line renders at the browser's default line-height for its own font
      // size instead, and the mismatch compounds down the file until line
      // numbers visibly drift away from the code lines they label.
      ".cm-lineNumbers .cm-gutterElement": {
        fontSize: "11.5px",
        lineHeight: "22px",
        fontFamily: "'JetBrains Mono', monospace",
      },
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
      ".cm-tooltip-autocomplete ul": {
        fontFamily: "'JetBrains Mono', monospace",
        maxHeight: "180px",
        overflowY: "auto",
      },
      ".cm-tooltip-autocomplete ul li": { padding: "0", height: "28px", display: "flex", alignItems: "center" },
      ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: c.tooltipHeaderBg },
      // Scheduled-job date placeholders like {{date}} — see templateHighlight.ts.
      ".cm-template-var": {
        color: c.templateVar,
        backgroundColor: c.templateVarBg,
        borderRadius: "4px",
        padding: "1px 2px",
        fontWeight: "600",
      },
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
