import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

// Highlights Jinja-style {{...}} placeholders (scheduled-job SQL/HTTP config
// only substitutes these at run time — see backend/internal/api/jobs.go
// renderJobTemplate) so they read as "this is a variable", not literal
// SQL/text. Harmless to leave active in the regular workbench editor too:
// ordinary queries never contain this syntax, so it simply never matches
// there.
//
// Two kinds share the {{...}} syntax but get distinct colors so it's visible
// at a glance which is which: the built-in date placeholders (date/datetime,
// matched case-insensitively, same as renderJobTemplate's own check) vs. a
// user-defined secret name from the vault (anything else — not cross-checked
// against real secret names here, so a typo'd/unknown name still gets
// styled as "this looks like a secret reference").
const dateTokenPattern = /^\{\{\s*(date|datetime)\s*([+-]\s*\d+)?\s*\}\}$/i;

const templateVarMatcher = new MatchDecorator({
  regexp: /\{\{\s*\w+\s*([+-]\s*\d+)?\s*\}\}/g,
  decoration: (match) => Decoration.mark({ class: dateTokenPattern.test(match[0]) ? "cm-template-var" : "cm-template-var-secret" }),
});

export const templateHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = templateVarMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = templateVarMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);
