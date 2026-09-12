import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ChevronDown, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ENGINES, type Engine, type ConnectionFields } from "@/lib/types";
import { useConnectionsStore } from "@/state/connections";
import { EngineIcon } from "@/components/EngineIcon";
import { buildConnectionString, parseConnectionString, supportsConnectionString } from "@/lib/connectionString";

type TestState = "idle" | "testing" | "pass" | "fail";

const SQL_ENGINE_LIST: Engine[] = ["postgres", "mysql", "sqlite"];
const NOSQL_ENGINE_LIST: Engine[] = ["redis", "kafka"];

export default function AddConnection() {
  const navigate = useNavigate();
  const addConnection = useConnectionsStore((s) => s.addConnection);

  const [engine, setEngine] = useState<Engine>("postgres");
  const [name, setName] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testState, setTestState] = useState<TestState>("idle");
  const [connectionString, setConnectionString] = useState("");

  // SQL fields
  const [host, setHost] = useState("");
  const [port, setPort] = useState(String(ENGINES.postgres.defaultPort));
  const [database, setDatabase] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sslMode, setSslMode] = useState<"disable" | "prefer" | "require" | "verify-ca">("require");
  const [sshTunnel, setSshTunnel] = useState(false);
  const [connectTimeout, setConnectTimeout] = useState("10");
  const [readOnly, setReadOnly] = useState(false);

  // Redis fields
  const [redisDbIndex, setRedisDbIndex] = useState("0");
  const [redisTls, setRedisTls] = useState(true);

  // Kafka fields
  const [brokers, setBrokers] = useState("");
  const [saslUsername, setSaslUsername] = useState("");
  const [saslPassword, setSaslPassword] = useState("");
  const [kafkaTls, setKafkaTls] = useState(true);

  function selectEngine(e: Engine) {
    setEngine(e);
    setTestState("idle");
    setConnectionString("");
    if (e !== "sqlite" && "defaultPort" in ENGINES[e]) {
      setPort(String(ENGINES[e].defaultPort ?? ""));
    }
  }

  // Two-way sync between the individual fields and the single connection
  // string: editing a field rebuilds the string, editing the string
  // reparses it back into the fields.
  function syncString(overrides: {
    host?: string;
    port?: string;
    database?: string;
    user?: string;
    password?: string;
    sslMode?: typeof sslMode;
    redisDbIndex?: string;
  } = {}) {
    if (!supportsConnectionString(engine)) return;
    const h = overrides.host ?? host;
    const p = overrides.port ?? port;
    if (engine === "redis") {
      setConnectionString(
        buildConnectionString("redis", {
          host: h,
          port: Number(p) || undefined,
          password: overrides.password ?? password,
          dbIndex: Number(overrides.redisDbIndex ?? redisDbIndex) || 0,
        }),
      );
      return;
    }
    setConnectionString(
      buildConnectionString(engine, {
        host: h,
        port: Number(p) || undefined,
        database: overrides.database ?? database,
        user: overrides.user ?? user,
        password: overrides.password ?? password,
        sslMode: overrides.sslMode ?? sslMode,
      }),
    );
  }

  function onHostChange(v: string) {
    setHost(v);
    syncString({ host: v });
  }
  function onPortChange(v: string) {
    setPort(v);
    syncString({ port: v });
  }
  function onDatabaseChange(v: string) {
    setDatabase(v);
    syncString({ database: v });
  }
  function onUserChange(v: string) {
    setUser(v);
    syncString({ user: v });
  }
  function onPasswordChange(v: string) {
    setPassword(v);
    syncString({ password: v });
  }
  function onSslModeChange(v: typeof sslMode) {
    setSslMode(v);
    syncString({ sslMode: v });
  }
  function onRedisDbIndexChange(v: string) {
    setRedisDbIndex(v);
    syncString({ redisDbIndex: v });
  }

  function onConnectionStringChange(v: string) {
    setConnectionString(v);
    const parsed = parseConnectionString(engine, v);
    if (!parsed) return;
    if (parsed.host !== undefined) setHost(parsed.host);
    if (parsed.port !== undefined) setPort(String(parsed.port));
    if (engine === "redis") {
      if (parsed.password !== undefined) setPassword(parsed.password);
      if (parsed.dbIndex !== undefined) setRedisDbIndex(String(parsed.dbIndex));
    } else {
      if (parsed.database !== undefined) setDatabase(parsed.database);
      if (parsed.user !== undefined) setUser(parsed.user);
      if (parsed.password !== undefined) setPassword(parsed.password);
      if (parsed.sslMode !== undefined) setSslMode(parsed.sslMode);
    }
  }

  function runTest() {
    setTestState("testing");
    window.setTimeout(() => {
      // Believable demo behavior: a host/broker was actually entered, so we
      // "succeed" — there's no real backend to test against yet.
      const target = engine === "kafka" ? brokers : host;
      setTestState(target.trim() ? "pass" : "fail");
    }, 900);
  }

  function buildFields(): ConnectionFields {
    if (engine === "redis") {
      return {
        engine: "redis",
        host,
        port: Number(port),
        password,
        dbIndex: Number(redisDbIndex),
        tls: redisTls,
      };
    }
    if (engine === "kafka") {
      return { engine: "kafka", brokers, saslUsername, saslPassword, tls: kafkaTls };
    }
    return {
      engine,
      host,
      port: Number(port),
      database,
      user,
      password,
      sslMode,
      sshTunnel,
      connectTimeoutSeconds: Number(connectTimeout),
      readOnly,
    };
  }

  function buildDsn(): string {
    if (engine === "kafka") return brokers;
    if (engine === "sqlite") return database;
    return `${host}:${port}/${engine === "redis" ? redisDbIndex : database}`;
  }

  const canSave = name.trim().length > 0;

  function handleSave() {
    if (!canSave) return;
    addConnection(name.trim(), buildFields(), buildDsn());
    navigate("/connections");
  }

  const isSql = SQL_ENGINE_LIST.includes(engine);

  return (
    <div className="flex h-full items-center justify-center bg-bg-app p-8">
      <div className="flex w-[620px] max-h-full flex-col gap-5 overflow-y-auto rounded-xl border border-border-strong bg-bg-app p-8">
        <div className="text-[16px] font-semibold tracking-[-0.01em] text-text-primary">New connection</div>

        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium text-text-tertiary">Engine</div>
          <div className="grid grid-cols-3 gap-2">
            {[...SQL_ENGINE_LIST, ...NOSQL_ENGINE_LIST].map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => selectEngine(e)}
                className={`flex h-[60px] flex-col items-center justify-center gap-1.5 rounded-[8px] border transition-colors ${
                  engine === e ? "border-inverse-bg bg-bg-raised" : "border-border-strong hover:bg-bg-hover"
                }`}
              >
                <div
                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-[6px] ${
                    engine === e ? "bg-bg-active text-text-primary" : "bg-bg-hover text-text-muted"
                  }`}
                >
                  <EngineIcon engine={e} size={16} />
                </div>
                <div className={`text-[12px] font-medium ${engine === e ? "text-text-primary" : "text-text-muted"}`}>
                  {ENGINES[e].label}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          {supportsConnectionString(engine) && (
            <Field label="Connection string">
              <Input
                mono
                value={connectionString}
                onChange={(e) => onConnectionStringChange(e.target.value)}
                placeholder={
                  engine === "redis"
                    ? "redis://:password@host:6379/0"
                    : `${engine === "mysql" ? "mysql" : "postgresql"}://user:password@host:5432/database`
                }
              />
            </Field>
          )}

          <Field label="Name">
            <Input
              mono
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. my-app · production"
            />
          </Field>

          {isSql && (
            <>
              <div className="grid grid-cols-[1fr_110px] gap-2.5">
                <Field label="Host">
                  <Input mono value={host} onChange={(e) => onHostChange(e.target.value)} placeholder="db.example.com" />
                </Field>
                <Field label="Port">
                  <Input mono value={port} onChange={(e) => onPortChange(e.target.value)} />
                </Field>
              </div>
              {engine !== "sqlite" ? (
                <Field label="Database">
                  <Input mono value={database} onChange={(e) => onDatabaseChange(e.target.value)} placeholder="my_app_production" />
                </Field>
              ) : (
                <Field label="File path">
                  <Input mono value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="~/data/app.sqlite" />
                </Field>
              )}
              {engine !== "sqlite" && (
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="User">
                    <Input mono value={user} onChange={(e) => onUserChange(e.target.value)} placeholder="app_user" />
                  </Field>
                  <Field label="Password">
                    <div className="flex h-[34px] items-center justify-between rounded-[7px] border border-border-input bg-bg-inset px-[11px]">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => onPasswordChange(e.target.value)}
                        className="w-full bg-transparent font-mono text-[12.5px] tracking-[0.14em] text-text-primary outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="shrink-0 text-[11px] text-text-faint hover:text-text-secondary"
                      >
                        {showPassword ? "hide" : "show"}
                      </button>
                    </div>
                  </Field>
                </div>
              )}
            </>
          )}

          {engine === "redis" && (
            <>
              <div className="grid grid-cols-[1fr_110px] gap-2.5">
                <Field label="Host">
                  <Input mono value={host} onChange={(e) => onHostChange(e.target.value)} placeholder="cache.example.com" />
                </Field>
                <Field label="Port">
                  <Input mono value={port} onChange={(e) => onPortChange(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Password (optional)">
                  <Input
                    mono
                    type="password"
                    value={password}
                    onChange={(e) => onPasswordChange(e.target.value)}
                  />
                </Field>
                <Field label="DB index">
                  <Input mono value={redisDbIndex} onChange={(e) => onRedisDbIndexChange(e.target.value)} />
                </Field>
              </div>
              <ToggleRow
                title="TLS"
                subtitle="Encrypt the connection to this Redis host"
                checked={redisTls}
                onChange={setRedisTls}
              />
            </>
          )}

          {engine === "kafka" && (
            <>
              <Field label="Bootstrap brokers">
                <Input mono value={brokers} onChange={(e) => setBrokers(e.target.value)} placeholder="host1:9092,host2:9092" />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="SASL username (optional)">
                  <Input mono value={saslUsername} onChange={(e) => setSaslUsername(e.target.value)} />
                </Field>
                <Field label="SASL password (optional)">
                  <Input
                    mono
                    type="password"
                    value={saslPassword}
                    onChange={(e) => setSaslPassword(e.target.value)}
                  />
                </Field>
              </div>
              <ToggleRow
                title="TLS"
                subtitle="Encrypt the connection to these brokers"
                checked={kafkaTls}
                onChange={setKafkaTls}
              />
            </>
          )}
        </div>

        {isSql && (
          <div className="overflow-hidden rounded-[8px] border border-border-default">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className={`flex w-full items-center justify-between px-[13px] py-[11px] ${
                advancedOpen ? "border-b border-border-faint bg-bg-inset" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                {advancedOpen ? (
                  <ChevronDown size={11} className="text-text-tertiary" />
                ) : (
                  <ChevronRight size={11} className="text-text-faint" />
                )}
                <span className={`text-[12.5px] font-medium ${advancedOpen ? "text-text-primary" : "text-text-secondary"}`}>
                  Advanced &amp; SSL
                </span>
              </div>
              {!advancedOpen && <span className="text-[11px] text-text-quiet">SSL mode, tunnel, timeout</span>}
            </button>
            {advancedOpen && (
              <div className="flex flex-col gap-3.5 px-[13px] py-3.5">
                <div className="flex flex-col gap-1.5">
                  <div className="text-[12px] font-medium text-text-tertiary">SSL mode</div>
                  <SegmentedControl
                    value={sslMode}
                    onChange={onSslModeChange}
                    options={[
                      { value: "disable", label: "disable" },
                      { value: "prefer", label: "prefer" },
                      { value: "require", label: "require" },
                      { value: "verify-ca", label: "verify-ca" },
                    ]}
                  />
                </div>
                <ToggleRow
                  title="SSH tunnel"
                  subtitle="Reach the host through a bastion"
                  checked={sshTunnel}
                  onChange={setSshTunnel}
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Connect timeout">
                    <Input mono value={connectTimeout} onChange={(e) => setConnectTimeout(e.target.value)} />
                  </Field>
                  <Field label="Read-only">
                    <button
                      type="button"
                      onClick={() => setReadOnly((v) => !v)}
                      className="flex h-[34px] items-center justify-between rounded-[7px] border border-border-input bg-bg-inset px-[11px] text-left"
                    >
                      <span className="text-[12.5px] text-text-muted">{readOnly ? "on" : "off"}</span>
                      <ChevronDown size={10} className="text-text-quiet" />
                    </button>
                  </Field>
                </div>
              </div>
            )}
          </div>
        )}

        {testState !== "idle" && (
          <div
            className={`flex items-start gap-2 rounded-[8px] border px-[13px] py-[11px] ${
              testState === "pass"
                ? "border-success-border bg-success-bg"
                : testState === "fail"
                  ? "border-error-border bg-error-bg"
                  : "border-border-default"
            }`}
          >
            {testState === "testing" && (
              <>
                <Loader2 size={13} className="mt-0.5 animate-spin text-text-tertiary" />
                <div className="text-[12.5px] text-text-secondary">Testing…</div>
              </>
            )}
            {testState === "pass" && (
              <>
                <Check size={13} className="mt-0.5 text-success-dot" />
                <div className="text-[12.5px] text-success-text">
                  Connected — {ENGINES[engine].label} · 41 ms
                  {isSql ? " · 14 schemas" : engine === "redis" ? " · db reachable" : " · brokers reachable"}
                </div>
              </>
            )}
            {testState === "fail" && (
              <>
                <AlertCircle size={13} className="mt-0.5 text-error-dot" />
                <div className="flex flex-col gap-0.5">
                  <div className="text-[12.5px] text-error-text">Connection failed after {connectTimeout || 10}s</div>
                  <div className="font-mono text-[11px] text-error-dim">
                    ETIMEDOUT {isSql || engine === "redis" ? `${host}:${port}` : brokers} — host unreachable
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <Button variant="secondary" size="md" onClick={runTest} disabled={testState === "testing"}>
            {testState === "testing" ? "Testing…" : "Test connection"}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="md" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button variant="primary" size="md" onClick={handleSave} disabled={!canSave} title={canSave ? undefined : "Give this connection a name first"}>
              Save connection
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[12px] font-medium text-text-tertiary">{label}</div>
      {children}
    </div>
  );
}

function ToggleRow({
  title,
  subtitle,
  checked,
  onChange,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-0.5">
        <div className="text-[12.5px] font-medium text-text-primary">{title}</div>
        <div className="text-[11px] text-text-faint">{subtitle}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
