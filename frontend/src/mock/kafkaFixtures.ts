export interface KafkaTopic {
  name: string;
  partitions: number;
  approxMessages: string;
}

export interface KafkaMessage {
  partition: number;
  offset: number;
  timestamp: string;
  key: string | null;
  value: string;
  headers: Record<string, string>;
}

export const KAFKA_TOPICS: KafkaTopic[] = [
  { name: "billing.invoice.created", partitions: 6, approxMessages: "2.1M" },
  { name: "billing.payment.failed", partitions: 3, approxMessages: "48.2K" },
  { name: "users.signup", partitions: 6, approxMessages: "912K" },
  { name: "users.plan_changed", partitions: 3, approxMessages: "204K" },
  { name: "analytics.pageview", partitions: 12, approxMessages: "41.9M" },
];

export const KAFKA_MESSAGES: Record<string, KafkaMessage[]> = {
  "billing.invoice.created": [
    {
      partition: 2,
      offset: 184213,
      timestamp: "2025-09-09 12:44:01.203",
      key: "acct_drumlin",
      value: '{"invoiceId":"inv_9f21","amount":89.00,"currency":"USD"}',
      headers: { "content-type": "application/json", "source": "billing-service" },
    },
    {
      partition: 0,
      offset: 184212,
      timestamp: "2025-09-09 12:41:47.998",
      key: "acct_sever",
      value: '{"invoiceId":"inv_9f20","amount":19.00,"currency":"USD"}',
      headers: { "content-type": "application/json", "source": "billing-service" },
    },
    {
      partition: 4,
      offset: 184211,
      timestamp: "2025-09-09 12:40:02.511",
      key: "acct_lagoveneto",
      value: '{"invoiceId":"inv_9f19","amount":240.00,"currency":"USD"}',
      headers: { "content-type": "application/json", "source": "billing-service" },
    },
  ],
  "billing.payment.failed": [
    {
      partition: 1,
      offset: 5021,
      timestamp: "2025-09-09 11:02:14.442",
      key: "acct_cartergreaves",
      value: '{"invoiceId":"inv_8e01","reason":"insufficient_funds"}',
      headers: { "content-type": "application/json" },
    },
  ],
  "users.signup": [
    {
      partition: 3,
      offset: 91021,
      timestamp: "2025-09-09 09:14:55.001",
      key: "u_4821",
      value: '{"email":"dana.okafor@lumen.co","plan":"pro"}',
      headers: { "content-type": "application/json" },
    },
    {
      partition: 5,
      offset: 91020,
      timestamp: "2025-09-09 08:47:12.774",
      key: "u_1092",
      value: '{"email":"s.tanaka@brightfold.jp","plan":"team"}',
      headers: { "content-type": "application/json" },
    },
  ],
  "users.plan_changed": [
    {
      partition: 0,
      offset: 3312,
      timestamp: "2025-09-08 16:08:30.120",
      key: "u_3390",
      value: '{"from":"pro","to":"enterprise"}',
      headers: { "content-type": "application/json" },
    },
  ],
  "analytics.pageview": [
    {
      partition: 7,
      offset: 8842011,
      timestamp: "2025-09-09 12:44:59.998",
      key: null,
      value: '{"path":"/pricing","referrer":"google"}',
      headers: { "content-type": "application/json" },
    },
  ],
};
