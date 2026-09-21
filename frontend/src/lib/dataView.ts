import type { ColumnInfo, DataFilterOperator, DataViewConfig } from "@/lib/types";

export const PAGE_SIZES = [50, 100, 250];
export const DEFAULT_PAGE_SIZE = 100;

export const OPERATORS: { value: DataFilterOperator; label: string }[] = [
  { value: "eq", label: "equals" }, { value: "neq", label: "does not equal" }, { value: "contains", label: "contains" },
  { value: "starts-with", label: "starts with" }, { value: "ends-with", label: "ends with" }, { value: "gt", label: "greater than" },
  { value: "gte", label: "at least" }, { value: "lt", label: "less than" }, { value: "lte", label: "at most" },
  { value: "is-null", label: "is null" }, { value: "not-null", label: "is not null" },
];

const OPERATOR_VALUES = new Set<string>(OPERATORS.map((o) => o.value));

export const EMPTY_VIEW: DataViewConfig = { filters: [], sorts: [], pageSize: DEFAULT_PAGE_SIZE, columnOrder: [], hiddenColumns: [] };

// A remembered or saved view can be older than the table it is applied to —
// columns get renamed and dropped — so anything that no longer fits is
// discarded rather than sent to the server as a filter/sort it would reject.
// Never throws, and tolerates whatever shape old or hand-edited storage holds.
export function sanitizeViewConfig(input: Partial<DataViewConfig> | null | undefined, columns: ColumnInfo[]): DataViewConfig {
  const names = new Set(columns.map((c) => c.name));
  const config = input ?? {};
  const filters = (Array.isArray(config.filters) ? config.filters : []).filter(
    (f) => !!f && names.has(f.column) && OPERATOR_VALUES.has(f.operator) && typeof f.value === "string",
  ).map(({ column, operator, value }) => ({ column, operator, value }));
  const sorts = (Array.isArray(config.sorts) ? config.sorts : []).filter(
    (s) => !!s && names.has(s.column) && (s.direction === "asc" || s.direction === "desc"),
  ).map(({ column, direction }) => ({ column, direction }));
  const pageSize = PAGE_SIZES.includes(config.pageSize as number) ? (config.pageSize as number) : DEFAULT_PAGE_SIZE;
  // Keep the saved order for columns that still exist; new columns go last.
  const ordered = (Array.isArray(config.columnOrder) ? config.columnOrder : []).filter((n, i, all) => names.has(n) && all.indexOf(n) === i);
  const columnOrder = ordered.length ? ordered.concat(columns.map((c) => c.name).filter((n) => !ordered.includes(n))) : [];
  // A view that hides every column would render an empty grid; drop it.
  const hidden = (Array.isArray(config.hiddenColumns) ? config.hiddenColumns : []).filter((n, i, all) => names.has(n) && all.indexOf(n) === i);
  const hiddenColumns = hidden.length >= names.size ? [] : hidden;
  return { filters, sorts, pageSize, columnOrder, hiddenColumns };
}
