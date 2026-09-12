import type { Engine } from "@/lib/types";

const SCHEME: Partial<Record<Engine, string>> = {
  postgres: "postgresql",
  mysql: "mysql",
  redis: "redis",
};

const SSL_MODES = ["disable", "prefer", "require", "verify-ca"] as const;

export interface ConnectionStringFields {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  sslMode?: (typeof SSL_MODES)[number];
  dbIndex?: number;
}

/** Only Postgres, MySQL, and Redis have a well-defined single-URI form. */
export function supportsConnectionString(engine: Engine): boolean {
  return engine in SCHEME;
}

export function buildConnectionString(engine: Engine, fields: ConnectionStringFields): string {
  const scheme = SCHEME[engine];
  if (!scheme) return "";

  const userPart = fields.user
    ? `${encodeURIComponent(fields.user)}${fields.password ? `:${encodeURIComponent(fields.password)}` : ""}@`
    : fields.password && engine === "redis"
      ? `:${encodeURIComponent(fields.password)}@`
      : "";
  const host = fields.host || "";
  const port = fields.port ? `:${fields.port}` : "";
  const path = engine === "redis" ? (fields.dbIndex ? `/${fields.dbIndex}` : "") : fields.database ? `/${fields.database}` : "";
  const query = engine !== "redis" && fields.sslMode ? `?sslmode=${fields.sslMode}` : "";

  return `${scheme}://${userPart}${host}${port}${path}${query}`;
}

/** Returns null when the string can't be parsed as a URI at all (e.g. still mid-typing). */
export function parseConnectionString(engine: Engine, raw: string): ConnectionStringFields | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!url.hostname) return null;

  const result: ConnectionStringFields = { host: url.hostname };
  if (url.port) result.port = Number(url.port);
  if (url.username) result.user = decodeURIComponent(url.username);
  if (url.password) result.password = decodeURIComponent(url.password);

  const path = url.pathname.replace(/^\//, "");
  if (engine === "redis") {
    if (path) result.dbIndex = Number(path) || 0;
  } else if (path) {
    result.database = path;
  }

  const sslMode = url.searchParams.get("sslmode");
  if (sslMode && (SSL_MODES as readonly string[]).includes(sslMode)) {
    result.sslMode = sslMode as (typeof SSL_MODES)[number];
  }

  return result;
}
