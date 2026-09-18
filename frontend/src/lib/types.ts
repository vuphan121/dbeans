export type Engine = "postgres" | "mysql" | "sqlite" | "redis" | "kafka";

export const SQL_ENGINES: Engine[] = ["postgres", "mysql", "sqlite"];

export interface EngineMeta {
  id: Engine;
  label: string;
  tag: string; // short monospace tag shown in tiles/badges, e.g. "Pg"
  defaultPort?: number;
}

export const ENGINES: Record<Engine, EngineMeta> = {
  postgres: { id: "postgres", label: "Postgres", tag: "Pg", defaultPort: 5432 },
  mysql: { id: "mysql", label: "MySQL", tag: "My", defaultPort: 3306 },
  sqlite: { id: "sqlite", label: "SQLite", tag: "Sq" },
  redis: { id: "redis", label: "Redis", tag: "Rd", defaultPort: 6379 },
  kafka: { id: "kafka", label: "Kafka", tag: "Kf", defaultPort: 9092 },
};

export interface SqlConnectionFields {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: "disable" | "prefer" | "require" | "verify-ca";
  sshTunnel: boolean;
  connectTimeoutSeconds: number;
  readOnly: boolean;
}

export interface RedisConnectionFields {
  host: string;
  port: number;
  password: string;
  dbIndex: number;
  tls: boolean;
}

export interface KafkaConnectionFields {
  brokers: string; // comma-separated broker list
  saslUsername: string;
  saslPassword: string;
  tls: boolean;
}

export type ConnectionFields =
  | ({ engine: "postgres" | "mysql" | "sqlite" } & SqlConnectionFields)
  | ({ engine: "redis" } & RedisConnectionFields)
  | ({ engine: "kafka" } & KafkaConnectionFields);

export interface CardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ConnectionStatus = "unknown" | "online" | "offline";

export interface SavedConnection {
  id: string;
  name: string;
  engine: Engine;
  dsn: string; // human-readable summary shown in lists
  lastUsed: string;
  fields: ConnectionFields;
  layout: CardLayout;
  status?: ConnectionStatus;
  lastCheckedAt?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  isPrimaryKey?: boolean;
  /** Which real table this query-result column came from, if any (empty for computed expressions/joins spanning multiple tables). */
  sourceSchema?: string;
  sourceTable?: string;
  nullable?: boolean;
  defaultValue?: string;
  isIdentity?: boolean;
  isGenerated?: boolean;
  enumValues?: string[];
  references?: { schema: string; table: string; column: string };
}

export interface TableInfo {
  name: string;
  kind: "table" | "view";
  columns: ColumnInfo[];
}

export interface SchemaGroup {
  name: string;
  tables: TableInfo[];
}

export interface ForeignKeyInfo {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

export interface ConnectionSchema {
  database: string;
  schemas: SchemaGroup[];
  foreignKeys: ForeignKeyInfo[];
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: (string | null)[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  command: string;
}

export type DataFilterOperator = "eq" | "neq" | "contains" | "starts-with" | "ends-with" | "gt" | "gte" | "lt" | "lte" | "is-null" | "not-null";

export interface DataFilter {
  id: string;
  column: string;
  operator: DataFilterOperator;
  value: string;
}

export interface TableDataPage {
  columns: ColumnInfo[];
  rows: (string | null)[][];
  total: number;
  page: number;
  pageSize: number;
}

export interface DataSort {
  column: string;
  direction: "asc" | "desc";
}

export type RedisType = "string" | "hash" | "list" | "set" | "zset";
export type RedisValue =
  | { type: "string"; value: string }
  | { type: "hash"; fields: { field: string; value: string }[] }
  | { type: "list"; items: string[] }
  | { type: "set"; members: string[] }
  | { type: "zset"; members: { member: string; score: number }[] };

export interface RedisKeyEntry {
  key: string;
  ttl: number | null;
  value: RedisValue;
}

export interface KafkaTopic {
  name: string;
  partitions: number;
  approxMessages: number;
}

export interface KafkaMessage {
  partition: number;
  offset: number;
  timestamp: string;
  key: string | null;
  value: string;
  headers: Record<string, string>;
}

export type CheckMode = "none" | "fail_if_no_rows" | "fail_if_rows";
export type JobStatus = "never_run" | "success" | "failed" | "blocked";
export type JobType = "query" | "http_request";

export interface HttpRequestJobConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  body: string;
  /** If set, also fail the job when this top-level response JSON field is a non-empty array. */
  failOnNonEmptyArrayField?: string;
  /** Overrides the default request timeout (seconds) for this job. */
  timeoutSeconds?: number;
}

export interface ScheduledJob {
  id: string;
  jobType: JobType;
  connectionId: string;
  name: string;
  sql: string;
  config: Partial<HttpRequestJobConfig>;
  cronExpr: string;
  enabled: boolean;
  dependsOn: string[];
  retryLimit: number;
  retryDelaySeconds: number;
  checkMode: CheckMode;
  layout: CardLayout;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus: JobStatus;
}

// Write-only by design — the API never echoes a value back once saved,
// only ever the name (see docs/ARCHITECTURE.md §4).
export interface Secret {
  id: string;
  name: string;
  createdAt: string;
}

export interface JobRun {
  id: number;
  jobId: string;
  status: "success" | "failed" | "blocked";
  attempts: number;
  rowsAffected?: number;
  error?: string;
  triggeredBy: "tick" | "manual" | "backfill";
  runDate: string; // "YYYY-MM-DD" — the logical date this run represents
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface JobRunCalendarDay {
  date: string; // "YYYY-MM-DD"
  status: "success" | "failed" | "blocked";
  runCount: number;
}
