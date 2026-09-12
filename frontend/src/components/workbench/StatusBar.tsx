export function StatusBar({
  rows,
  ms,
  connectionName,
  schema,
}: {
  rows: number;
  ms: number;
  connectionName: string;
  schema: string;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-3.5 border-b border-border-subtle bg-bg-surface px-3.5 font-mono text-[11px] text-text-faint">
      <span className="text-text-secondary">{rows} rows</span>
      <span className="text-border-control">│</span>
      <span>{ms} ms</span>
      <span className="text-border-control">│</span>
      <span>{connectionName}</span>
      <span className="text-border-control">│</span>
      <span>{schema}</span>
      <span className="ml-auto">UTF-8 · UTC</span>
    </div>
  );
}
