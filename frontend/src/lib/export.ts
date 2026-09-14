import type { QueryResult } from "@/lib/types";

function download(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | null): string {
  if (value === null) return "";
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// Exports every fetched row (result.rows), not just the current page — the
// grid's pagination is a client-side slice of an already-fully-fetched
// result set, so "export" means the whole thing the query returned.
export function downloadCsv(result: QueryResult, filename: string) {
  const header = result.columns.map((c) => csvCell(c.name)).join(",");
  const lines = result.rows.map((row) => row.map(csvCell).join(","));
  download(filename, [header, ...lines].join("\n"), "text/csv;charset=utf-8");
}

export function downloadJson(result: QueryResult, filename: string) {
  const objects = result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col.name, row[i]])),
  );
  download(filename, JSON.stringify(objects, null, 2), "application/json;charset=utf-8");
}
