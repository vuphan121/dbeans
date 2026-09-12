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

export interface SavedConnection {
  id: string;
  name: string;
  engine: Engine;
  dsn: string; // human-readable summary shown in lists
  lastUsed: string;
  fields: ConnectionFields;
  layout: CardLayout;
}
