// Mirrors backend/internal/api/jobs.go's renderJobTemplate exactly, so
// AddJob's "Test query" button previews the same substitution a real
// scheduled run would do, rather than sending the literal {{date}} text
// to Postgres and erroring. Supports {{date}}/{{datetime}} plus an optional
// day offset, e.g. {{date-1}} (yesterday) or {{date+7}} (a week out).
const TEMPLATE_VAR_PATTERN = /\{\{\s*(\w+)\s*([+-]\s*\d+)?\s*\}\}/g;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function renderJobTemplate(sql: string, now: Date = new Date()): string {
  return sql.replace(TEMPLATE_VAR_PATTERN, (match, name: string, offset?: string) => {
    const offsetDays = offset ? parseInt(offset.replace(/\s+/g, ""), 10) : 0;
    const t = new Date(now);
    t.setUTCDate(t.getUTCDate() + offsetDays);
    switch (name.toLowerCase()) {
      case "date":
        return formatDate(t);
      case "datetime":
        return formatDateTime(t);
      default:
        return match;
    }
  });
}
