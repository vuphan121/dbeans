import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

// Highlights Jinja-style {{date}} / {{date-1}} placeholders (scheduled-job
// SQL only substitutes these at run time — see backend/internal/api/jobs.go
// renderJobTemplate) so they read as "this is a variable", not literal SQL.
// Harmless to leave active in the regular workbench editor too: ordinary
// queries never contain this syntax, so it simply never matches there.
const templateVarMatcher = new MatchDecorator({
  regexp: /\{\{\s*\w+\s*([+-]\s*\d+)?\s*\}\}/g,
  decoration: Decoration.mark({ class: "cm-template-var" }),
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
