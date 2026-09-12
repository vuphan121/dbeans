export type RedisType = "string" | "hash" | "list" | "set" | "zset";

export interface RedisHashField {
  field: string;
  value: string;
}

export interface RedisZMember {
  member: string;
  score: number;
}

export type RedisValue =
  | { type: "string"; value: string }
  | { type: "hash"; fields: RedisHashField[] }
  | { type: "list"; items: string[] }
  | { type: "set"; members: string[] }
  | { type: "zset"; members: RedisZMember[] };

export interface RedisKeyEntry {
  key: string;
  ttl: number | null; // seconds remaining, null = no expiry
  value: RedisValue;
}

export const REDIS_KEYS: RedisKeyEntry[] = [
  {
    key: "session:9f3a1c2e",
    ttl: 1740,
    value: { type: "string", value: '{"userId":"u_4821","ip":"10.0.4.9","mfa":true}' },
  },
  {
    key: "session:7bb02aa1",
    ttl: 612,
    value: { type: "string", value: '{"userId":"u_1092","ip":"10.0.4.31","mfa":false}' },
  },
  {
    key: "user:4821:profile",
    ttl: null,
    value: {
      type: "hash",
      fields: [
        { field: "email", value: "dana.okafor@lumen.co" },
        { field: "plan", value: "pro" },
        { field: "created_at", value: "2025-01-04T14:22:00Z" },
        { field: "locale", value: "en-US" },
      ],
    },
  },
  {
    key: "user:1092:profile",
    ttl: null,
    value: {
      type: "hash",
      fields: [
        { field: "email", value: "s.tanaka@brightfold.jp" },
        { field: "plan", value: "team" },
        { field: "created_at", value: "2024-08-19T07:51:00Z" },
        { field: "locale", value: "ja-JP" },
      ],
    },
  },
  {
    key: "queue:emails:pending",
    ttl: null,
    value: {
      type: "list",
      items: [
        '{"to":"w.adeyemi@finchmark.org","template":"invoice_due"}',
        '{"to":"o.petrova@sever.lv","template":"welcome"}',
        '{"to":"kwame.asante@nsoro.gh","template":"password_reset"}',
      ],
    },
  },
  {
    key: "cache:homepage:html",
    ttl: 45,
    value: { type: "string", value: "<!doctype html>\n<html>\n  <!-- 41 KB cached render -->\n</html>" },
  },
  {
    key: "tags:plans:enterprise",
    ttl: null,
    value: { type: "set", members: ["acct_northwind", "acct_kvarn", "acct_meridian"] },
  },
  {
    key: "leaderboard:global",
    ttl: null,
    value: {
      type: "zset",
      members: [
        { member: "acct_northwind", score: 128400 },
        { member: "acct_kvarn", score: 98200 },
        { member: "acct_ostara", score: 71050 },
        { member: "acct_atelier9", score: 40300 },
      ],
    },
  },
  {
    key: "rate_limit:api:10.0.4.9",
    ttl: 12,
    value: { type: "string", value: "37" },
  },
];
