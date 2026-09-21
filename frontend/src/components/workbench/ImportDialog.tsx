import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { errorMessage, importTableRows } from "@/lib/api";
import { CsvError, parseCsv } from "@/lib/csv";
import type { ColumnInfo, ImportResult } from "@/lib/types";
import { useAuthStore } from "@/state/auth";
import { Actions, Check, Confirm, Modal } from "./DataDialogs";

// Must match the backend's maxImportRows: one import is one atomic request.
const MAX_ROWS = 10_000;
const PREVIEW_ROWS = 5;
// The "don't import this column" choice. Not "": Radix Select reserves the empty
// string for "nothing selected" and rejects an item that uses it.
const SKIP = "__skip__";

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

// A column the import can't write to: the database assigns its value itself.
const isDatabaseAssigned = (c: ColumnInfo) => !!c.isGenerated || !!c.isIdentity;
// A column every row must supply: NOT NULL with nothing to fall back on.
const isRequired = (c: ColumnInfo) => !c.nullable && c.defaultValue == null && !isDatabaseAssigned(c);

// Matches each CSV column to the table column with the same name, ignoring
// case and punctuation ("Created At" -> created_at). Each table column is used
// at most once; anything unmatched is left on Skip for the user to decide.
function autoMap(header: string[], targets: ColumnInfo[]): string[] {
  const used = new Set<string>();
  return header.map((cell) => {
    const match = targets.find((c) => !used.has(c.name) && normalize(c.name) === normalize(cell));
    if (!match) return SKIP;
    used.add(match.name);
    return match.name;
  });
}

// Imports rows from a CSV file into the table being browsed: pick a file, map
// its columns to the table's, dry-run the insert to see every problem, then
// commit it as one all-or-nothing transaction.
export function ImportDialog({
  connectionId,
  schema,
  table,
  columns,
  onClose,
  onImported,
}: {
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnInfo[];
  onClose: () => void;
  onImported: (rows: number) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<string[][] | null>(null);
  const [delimiter, setDelimiter] = useState(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [emptyAsNull, setEmptyAsNull] = useState(true);
  const [mapping, setMapping] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const targets = useMemo(() => columns.filter((c) => !isDatabaseAssigned(c)), [columns]);
  const header = useMemo(() => (parsed ? (hasHeader ? parsed[0] : parsed[0].map((_, i) => `Column ${i + 1}`)) : []), [parsed, hasHeader]);
  const dataRows = useMemo(() => (parsed ? (hasHeader ? parsed.slice(1) : parsed) : []), [parsed, hasHeader]);

  // Every row must be as wide as the first: a short or long row means the file
  // is misquoted or has a stray delimiter, and guessing would corrupt data.
  const raggedRows = useMemo(() => {
    const width = parsed?.[0].length ?? 0;
    return dataRows.flatMap((row, i) => (row.length !== width ? [i + 1] : []));
  }, [parsed, dataRows]);

  const mappedTargets = mapping.filter((m) => m !== SKIP);
  const duplicateTargets = mappedTargets.filter((m, i) => mappedTargets.indexOf(m) !== i);
  const missingRequired = targets.filter((c) => isRequired(c) && !mappedTargets.includes(c.name));
  const tooManyRows = dataRows.length > MAX_ROWS;

  const problem = !parsed
    ? ""
    : dataRows.length === 0
      ? "The file has no data rows."
      : tooManyRows
        ? `This file has ${dataRows.length.toLocaleString()} rows; an import holds at most ${MAX_ROWS.toLocaleString()}. Split it and import in parts.`
        : raggedRows.length
          ? `${raggedRows.length.toLocaleString()} row${raggedRows.length === 1 ? " has" : "s have"} a different number of values than the first line (first: row ${raggedRows.slice(0, 5).join(", ")}). Check for a stray delimiter or unclosed quote.`
          : mappedTargets.length === 0
            ? "Map at least one column."
            : duplicateTargets.length
              ? `${duplicateTargets[0]} is mapped from more than one file column.`
              : missingRequired.length
                ? `${missingRequired.map((c) => c.name).join(", ")} ${missingRequired.length === 1 ? "is" : "are"} required (NOT NULL, no default) and must be mapped.`
                : "";

  function resetOutcome() {
    setResult(null);
    setError("");
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setResult(null);
    try {
      const { rows, delimiter: found } = parseCsv(await file.text());
      if (rows.length === 0) throw new CsvError("The file is empty.");
      setFileName(file.name);
      setParsed(rows);
      setDelimiter(found);
      setMapping(autoMap(rows[0], targets));
      setHasHeader(true);
    } catch (err) {
      setParsed(null);
      setFileName("");
      setError(err instanceof CsvError ? err.message : "Could not read that file.");
    }
  }

  function toggleHeader(next: boolean) {
    if (!parsed) return;
    setHasHeader(next);
    setMapping(autoMap(next ? parsed[0] : parsed[0].map((_, i) => `Column ${i + 1}`), targets));
    resetOutcome();
  }

  // The rows sent to the server: only mapped columns, in mapping order, with
  // empty cells turned into NULL when asked (an empty string is not a valid
  // value for most non-text columns).
  const built = useMemo(() => {
    const picked = mapping.flatMap((target, index) => (target === SKIP ? [] : [{ target, index }]));
    return {
      columns: picked.map((p) => p.target),
      rows: dataRows.map((row) => picked.map(({ index }) => (emptyAsNull && row[index] === "" ? null : row[index]))),
    };
  }, [mapping, dataRows, emptyAsNull]);

  async function run(dryRun: boolean) {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await importTableRows(token, connectionId, { schema, table, columns: built.columns, rows: built.rows, dryRun });
      setConfirming(false);
      if (outcome.ok && !dryRun) {
        onImported(outcome.rowsInserted);
        return;
      }
      setResult(outcome);
    } catch (err) {
      setConfirming(false);
      setError(errorMessage(err, "The import failed."));
    } finally {
      setBusy(false);
    }
  }

  const preview = built.rows.slice(0, PREVIEW_ROWS);
  const previewColumns = built.columns;
  const validated = result?.ok && result.dryRun;
  const canRun = !!parsed && !problem && !busy;

  return (
    <Modal title={`Import CSV into ${schema}.${table}`} onClose={onClose} locked={busy}>
      <div className="max-h-[62vh] space-y-4 overflow-y-auto p-5">
        <div className="flex items-center gap-3">
          <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" className="hidden" onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ""; }} />
          <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}><FileUp size={13} /> {parsed ? "Choose a different file" : "Choose CSV file"}</Button>
          {parsed && <span className="min-w-0 truncate text-[12px] text-text-muted">{fileName} · {dataRows.length.toLocaleString()} rows · delimiter {delimiter === "\t" ? "tab" : `"${delimiter}"`}</span>}
        </div>

        {!parsed && !error && <p className="text-[12px] leading-5 text-text-faint">Choose a comma-, semicolon-, tab-, or pipe-separated file (up to {MAX_ROWS.toLocaleString()} rows). You'll map its columns to this table and check every row before anything is written. Rows are inserted in one transaction: if any row fails, none are.</p>}

        {parsed && (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Check label="First row is a header" checked={hasHeader} onChange={toggleHeader} />
              <Check label="Treat empty values as NULL" checked={emptyAsNull} onChange={(v) => { setEmptyAsNull(v); resetOutcome(); }} />
            </div>

            <div className="overflow-hidden rounded-[8px] border border-border-default">
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-3 border-b border-border-default bg-bg-inset px-3 py-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-ghost"><span>File column</span><span>Example</span><span>Import into</span></div>
              <div className="max-h-[210px] overflow-y-auto">
                {header.map((cell, index) => (
                  <div key={index} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-3 border-b border-border-faint px-3 py-1.5 last:border-b-0">
                    <span className="truncate font-mono text-[11.5px] text-text-secondary" title={cell}>{cell || <em className="text-text-ghost">(blank)</em>}</span>
                    <span className="truncate font-mono text-[11px] text-text-ghost" title={dataRows[0]?.[index]}>{dataRows[0]?.[index] ?? ""}</span>
                    <Select
                      value={mapping[index] ?? SKIP}
                      onChange={(value) => { setMapping((current) => current.map((m, i) => (i === index ? value : m))); resetOutcome(); }}
                      options={[{ value: SKIP, label: "Skip this column" }, ...targets.map((c) => ({ value: c.name, label: `${c.name}${isRequired(c) ? " *" : ""}` }))]}
                      className="h-7 w-full font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-text-faint">* required — NOT NULL with no default. Generated and identity columns are filled by the database and can't be imported into.</p>

            {preview.length > 0 && previewColumns.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-ghost">Preview · first {preview.length} of {dataRows.length.toLocaleString()} rows</div>
                <div className="overflow-x-auto rounded-[8px] border border-border-default">
                  <table className="w-full border-collapse font-mono text-[11px]">
                    <thead className="bg-bg-inset text-left text-text-muted"><tr>{previewColumns.map((c) => <th key={c} className="whitespace-nowrap border-b border-r border-border-default px-2.5 py-1.5 font-medium last:border-r-0">{c}</th>)}</tr></thead>
                    <tbody className="text-text-secondary">{preview.map((row, r) => <tr key={r}>{row.map((v, i) => <td key={i} className={`max-w-[180px] truncate whitespace-nowrap border-b border-r border-border-faint px-2.5 py-1.5 last:border-r-0 ${v === null ? "italic text-text-ghost" : ""}`}>{v ?? "null"}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {problem && <div className="rounded-[7px] border border-error-border bg-error-bg px-3 py-2 text-[11.5px] text-error-text">{problem}</div>}
        {error && <div className="rounded-[7px] border border-error-border bg-error-bg px-3 py-2 text-[11.5px] text-error-text">{error}</div>}

        {validated && (
          <div className="flex items-center gap-2 rounded-[7px] border border-border-default bg-bg-inset px-3 py-2 text-[12px] text-text-secondary"><CheckCircle2 size={14} /> All {result.rowsInserted.toLocaleString()} rows passed. Nothing has been written yet.</div>
        )}
        {result && !result.ok && (
          <div className="rounded-[7px] border border-error-border bg-error-bg px-3 py-2.5 text-[11.5px] text-error-text">
            <div className="font-medium">{result.dryRun ? "These rows would fail" : "Import failed — nothing was written"}</div>
            <ul className="mt-1.5 space-y-1 font-mono text-[11px]">
              {result.errors?.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}
            </ul>
            {result.moreErrors && <div className="mt-1.5">More rows may fail. Fix these, then validate again.</div>}
          </div>
        )}
      </div>
      <Actions>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="secondary" onClick={() => void run(true)} disabled={!canRun}>{busy && !confirming ? <Loader2 size={12} className="animate-spin" /> : null} Validate</Button>
        <Button variant="primary" onClick={() => setConfirming(true)} disabled={!canRun}>Import {dataRows.length ? dataRows.length.toLocaleString() : ""} rows</Button>
      </Actions>
      {confirming && (
        <Confirm
          title={`Import ${dataRows.length.toLocaleString()} rows?`}
          body={`This inserts the rows into ${schema}.${table} in one transaction. If any row fails, none are written. It can't be undone from here.`}
          confirm="Import"
          tone="primary"
          loading={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void run(false)}
        />
      )}
    </Modal>
  );
}
