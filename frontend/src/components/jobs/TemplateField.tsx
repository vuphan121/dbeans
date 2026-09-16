import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { templateHighlight } from "@/components/workbench/templateHighlight";

// Same bordered/rounded/padded look as Input/textarea (see index.css's
// --color-* design tokens) so this reads as an ordinary text field except
// for the {{...}} coloring — referencing the CSS variables directly (rather
// than sqlEditorTheme.ts's hardcoded per-theme hex values) means this one
// theme object already follows light/dark without any JS branching.
const fieldTheme = EditorView.theme({
  "&": {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "12.5px",
    color: "var(--color-text-primary)",
    backgroundColor: "var(--color-bg-inset)",
    border: "1px solid var(--color-border-input)",
    borderRadius: "7px",
  },
  "&.cm-focused": {
    outline: "none",
    borderColor: "var(--color-border-focus)",
    boxShadow: "0 0 0 2px rgba(255,255,255,0.04)",
  },
  ".cm-content": { padding: "7px 11px", caretColor: "var(--color-text-primary)" },
  ".cm-scroller": { fontFamily: "'JetBrains Mono', monospace", lineHeight: "20px" },
  ".cm-placeholder": { color: "var(--color-text-quiet)" },
  // {{date}} vs {{secretName}} — see templateHighlight.ts and index.css's
  // --color-template-var* tokens (kept separate from sqlEditorTheme.ts's own
  // copies, which branch light/dark in JS rather than via CSS variables).
  ".cm-template-var": {
    color: "var(--color-template-var)",
    backgroundColor: "var(--color-template-var-bg)",
    borderRadius: "4px",
    padding: "1px 2px",
    fontWeight: "600",
  },
  ".cm-template-var-secret": {
    color: "var(--color-template-var-secret)",
    backgroundColor: "var(--color-template-var-secret-bg)",
    borderRadius: "4px",
    padding: "1px 2px",
    fontWeight: "600",
  },
});

// Strips newlines from any inserted text (typed or pasted) — for the
// single-line URL field, matching a plain <input>'s native inability to
// hold multiple lines (CodeMirror has no such built-in limit on its own).
const singleLineFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  let sawNewline = false;
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.toString().includes("\n")) sawNewline = true;
  });
  if (!sawNewline) return tr;
  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString().replace(/\n/g, "") });
  });
  return [{ changes, selection: tr.selection, effects: tr.effects, scrollIntoView: tr.scrollIntoView }];
});

export function TemplateField({
  value,
  onChange,
  placeholder,
  singleLine,
  minHeight,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  singleLine?: boolean;
  minHeight?: string;
}) {
  const extensions = useMemo(() => {
    const ext: Extension[] = [templateHighlight, fieldTheme, EditorView.lineWrapping];
    if (placeholder) ext.push(placeholderExt(placeholder));
    if (singleLine) {
      ext.push(singleLineFilter);
      ext.push(keymap.of([{ key: "Enter", run: () => true }]));
    }
    return ext;
  }, [placeholder, singleLine]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme="none"
      extensions={extensions}
      basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
      minHeight={minHeight ?? (singleLine ? "34px" : undefined)}
    />
  );
}
