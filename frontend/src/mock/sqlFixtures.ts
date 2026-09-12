export interface UserRow {
  n: string;
  email: string;
  plan: string;
  mrr: string;
  created: string;
  status: string;
}

// Transcribed verbatim from the Claude Design handoff's DCLogic.renderVals().
const rawRows: [string, string, string, string, string, string][] = [
  ["1", "dana.okafor@lumen.co", "pro", "89.00", "2025-01-04 14:22", "active"],
  ["2", "s.tanaka@brightfold.jp", "team", "240.00", "2024-08-19 07:51", "active"],
  ["3", "mmalone@carter-greaves.com", "pro", "89.00", "2025-03-27 16:08", "past_due"],
  ["5", "w.adeyemi@finchmark.org", "starter", "19.00", "2025-06-11 11:40", "active"],
  ["6", "priya.nair@ostara.dev", "team", "240.00", "2023-12-02 18:33", "canceled"],
  ["7", "lucas.ferreira@vantabl.com", "pro", "89.00", "2025-02-14 10:05", "active"],
  ["8", "e.soderberg@kvarn.se", "enterprise", "1,280.00", "2022-09-30 08:12", "active"],
  ["9", "hqureshi@meridianlabs.io", "starter", "19.00", "2025-07-23 21:47", "trialing"],
  ["10", "ana.ruiz@cobalt-partners.es", "team", "240.00", "2024-04-08 13:19", "active"],
  ["11", "t.novak@brnoworks.cz", "pro", "89.00", "2025-05-16 06:58", "canceled"],
  ["12", "jules.mercier@atelier9.fr", "starter", "19.00", "2025-08-01 15:26", "active"],
  ["13", "kwame.asante@nsoro.gh", "team", "240.00", "2024-10-21 09:03", "active"],
  ["14", "fiona.byrne@drumlin.ie", "pro", "89.00", "2025-09-09 12:44", "trialing"],
  ["15", "o.petrova@sever.lv", "starter", "19.00", "2023-06-14 17:35", "canceled"],
  ["16", "marco.rossi@lagoveneto.it", "team", "240.00", "2025-04-02 08:27", "active"],
];

export const USER_ROWS: UserRow[] = rawRows.map(
  ([n, email, plan, mrr, created, status]) => ({ n, email, plan, mrr, created, status }),
);

// row 4 shown separately in the design (mid-edit, plan -> enterprise)
export const EDITED_ROW: UserRow = {
  n: "4",
  email: "rafael.m@northwind.io",
  plan: "enterprise",
  mrr: "1,280.00",
  created: "2024-11-02 09:14",
  status: "active",
};

export const USER_COLUMNS = [
  { name: "id", type: "uuid" },
  { name: "email", type: "text" },
  { name: "plan_id", type: "uuid" },
  { name: "mrr", type: "numeric" },
  { name: "created_at", type: "timestamptz" },
  { name: "canceled_at", type: "timestamptz" },
  { name: "status", type: "text" },
];

export const OTHER_TABLES = [
  "accounts",
  "events",
  "invoices",
  "plan_changes",
  "plans",
  "sessions",
  "workspaces",
];

export const SNIPPETS = [
  { id: "s1", name: "Churn by plan", sql: "select p.name, date_trunc('month', u.canceled_at) …", used: "2 h ago" },
  { id: "s2", name: "MRR by plan tier", sql: "select plan_tier, sum(mrr) from public.users group by 1 …", used: "yesterday" },
  { id: "s3", name: "Slow queries", sql: "select query, mean_exec_time from pg_stat_statements …", used: "5 days ago" },
  { id: "s4", name: "Table sizes", sql: "select relname, pg_size_pretty(pg_total_relation_size(c.oid)) …", used: "2 weeks ago" },
];

export const DEFAULT_QUERY = `-- monthly churn by plan, last 6 months
select  p.name as plan,
        date_trunc('month', u.canceled_at) as month,
        count(distinct u.id) as churned
from    public.users u
join    public.plans p on p.id = u.plan_id
where   u.canceled_at >= now() - interval '6 months'
group by 1, 2
order by 2 desc, 3 desc
limit   200;
`;

export const AUTOCOMPLETE_SUGGESTIONS = [
  { label: "plans", detail: "table · public" },
  { label: "plan_changes", detail: "table" },
  { label: "plan_id", detail: "column · uuid" },
  { label: "plan_tier", detail: "column · text" },
];
