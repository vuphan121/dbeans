import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL, type SQLNamespace } from "@codemirror/lang-sql";
import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { darkSqlTheme, lightSqlTheme } from "./sqlEditorTheme";
import { templateHighlight } from "./templateHighlight";
import { useSchemaStore } from "@/state/schema";

export function SqlEditor({
  value,
  onChange,
  theme,
  fontSize,
  onRun,
  connectionId,
}: {
  value: string;
  onChange: (v: string) => void;
  theme: "dark" | "light";
  fontSize: number;
  onRun: () => void;
  connectionId: string;
}) {
  const schema = useSchemaStore((s) => s.byConnectionId[connectionId]?.schema);

  // @codemirror/lang-sql's own schema-aware completion combines keyword
  // completion (so "sel" suggests SELECT, etc.) with table/column
  // completion built from this namespace — far more capable than hand-
  // rolling a prefix matcher, and it already supports the standard
  // arrow-key/mouse-wheel picker navigation.
  const sqlNamespace = useMemo(() => {
    const namespace: SQLNamespace = {};
    for (const group of schema?.schemas ?? []) {
      const tables: Record<string, string[]> = {};
      for (const table of group.tables) {
        tables[table.name] = table.columns.map((c) => c.name);
      }
      namespace[group.name] = tables;
    }
    return namespace;
  }, [schema]);

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema: sqlNamespace, defaultSchema: "public" }),
      autocompletion({ activateOnTyping: true }),
      templateHighlight,
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRun();
              return true;
            },
          },
          // acceptCompletion is a no-op (returns false, falling through to
          // normal Tab behavior) when no completion is open/selected — it's
          // specifically designed to be safe to bind directly to Tab.
          { key: "Tab", run: acceptCompletion },
        ]),
      ),
    ],
    [onRun, sqlNamespace],
  );

  return (
    <div style={{ fontSize }} className="h-full">
      <CodeMirror
        value={value}
        onChange={onChange}
        height="100%"
        style={{ height: "100%" }}
        theme={theme === "dark" ? darkSqlTheme : lightSqlTheme}
        extensions={extensions}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
      />
    </div>
  );
}
