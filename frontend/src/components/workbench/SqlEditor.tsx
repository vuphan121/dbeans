import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { darkSqlTheme, lightSqlTheme } from "./sqlEditorTheme";
import { AUTOCOMPLETE_SUGGESTIONS, OTHER_TABLES, USER_COLUMNS } from "@/mock/sqlFixtures";

const schemaCompletions = [
  ...OTHER_TABLES.map((name) => ({ label: name, detail: "table" })),
  { label: "users", detail: "table" },
  ...USER_COLUMNS.map((c) => ({ label: c.name, detail: `column · ${c.type}` })),
  ...AUTOCOMPLETE_SUGGESTIONS,
];

const schemaSource: CompletionSource = (context) => {
  const word = context.matchBefore(/[\w]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const text = word.text.toLowerCase();
  const options = schemaCompletions
    .filter((c) => c.label.toLowerCase().startsWith(text))
    .map((c) => ({
      label: c.label,
      detail: c.detail,
      type: c.detail.startsWith("table") ? "class" : c.detail.startsWith("column") ? "property" : "keyword",
    }));
  if (!options.length) return null;
  return { from: word.from, options };
};

export function SqlEditor({
  value,
  onChange,
  theme,
  fontSize,
  onRun,
}: {
  value: string;
  onChange: (v: string) => void;
  theme: "dark" | "light";
  fontSize: number;
  onRun: () => void;
}) {
  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL }),
      autocompletion({ override: [schemaSource], activateOnTyping: true }),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRun();
              return true;
            },
          },
        ]),
      ),
    ],
    [onRun],
  );

  return (
    <div style={{ fontSize }} className="h-full">
      <CodeMirror
        value={value}
        onChange={onChange}
        height="100%"
        theme={theme === "dark" ? darkSqlTheme : lightSqlTheme}
        extensions={extensions}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
      />
    </div>
  );
}
