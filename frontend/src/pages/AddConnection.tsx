import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ChevronDown, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ENGINES, type Engine, type ConnectionFields } from "@/lib/types";
import { useConnectionsStore } from "@/state/connections";

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

  // SQL fields
  const [host, setHost] = useState("db.internal.acme.dev");
  const [port, setPort] = useState(String(ENGINES.postgres.defaultPort));
  const [database, setDatabase] = useState("acme_production");
  const [user, setUser] = useState("app_readwrite");
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
  const [brokers, setBrokers] = useState("localhost:9092");
  const [saslUsername, setSaslUsername] = useState("");
  const [saslPassword, setSaslPassword] = useState("");
  const [kafkaTls, setKafkaTls] = useState(true);

  function selectEngine(e: Engine) {
    setEngine(e);
    setTestState("idle");
    if (e !== "sqlite" && "defaultPort" in ENGINES[e]) {
      setPort(String(ENGINES[e].defaultPort ?? ""));
    }
  }

  function runTest() {
    setTestState("testing");
    window.setTimeout(() => {
      // Believable demo behavior: local/known-good hosts pass, anything else
      // fails with a plausible network error — there's no real backend yet.
      const looksReachable = /localhost|127\.0\.0\.1|internal|acme/.test(
        engine === "kafka" ? brokers : host,
      );
      setTestState(looksReachable ? "pass" : "fail");
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

  function handleSave() {
    const finalName = name.trim() || buildDsn();
    addConnection(finalName, buildFields(), buildDsn());
    navigate("/connections");
  }

  const isSql = SQL_ENGINE_LIST.includes(engine);

  return (
    <div className="flex h-full items-center justify-center bg-bg-app p-8">
      <div className="flex w-[620px] max-h-full flex-col gap-5 overflow-y-auto rounded-xl border border-border-strong bg-bg-app p-8">
        <div className="flex flex-col gap-1">
          <div className="text-[16px] font-semibold tracking-[-0.01em] text-text-primary">
            New connection
          </div>
          <div className="text-[12px] text-text-faint">
            Credentials are encrypted with your master password.
          </div>
        </div>

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
                  className={`flex h-[22px] w-[22px] items-center justify-center rounded-[6px] font-mono text-[10px] font-semibold ${
                    engine === e ? "bg-bg-active text-text-primary" : "bg-bg-hover text-text-muted"
                  }`}
                >
                  {ENGINES[e].tag}
                </div>
                <div className={`text-[12px] font-medium ${engine === e ? "text-text-primary" : "text-text-muted"}`}>
                  {ENGINES[e].label}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label="Name">
            <Input mono value={name} onChange={(e) => setName(e.target.value)} placeholder={buildDsn()} />
          </Field>

          {isSql && (
            <>
              <div className="grid grid-cols-[1fr_110px] gap-2.5">
                <Field label="Host">
                  <Input mono value={host} onChange={(e) => setHost(e.target.value)} />
                </Field>
                <Field label="Port">
                  <Input mono value={port} onChange={(e) => setPort(e.target.value)} />
                </Field>
              </div>
              {engine !== "sqlite" ? (
                <Field label="Database">
                  <Input mono value={database} onChange={(e) => setDatabase(e.target.value)} />
                </Field>
              ) : (
                <Field label="File path">
                  <Input mono value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="~/data/app.sqlite" />
                </Field>
              )}
              {engine !== "sqlite" && (
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="User">
                    <Input mono value={user} onChange={(e) => setUser(e.target.value)} />
                  </Field>
                  <Field label="Password">
                    <div className="flex h-[34px] items-center justify-between rounded-[7px] border border-border-input bg-bg-inset px-[11px]">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
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
                  <Input mono value={host} onChange={(e) => setHost(e.target.value)} />
                </Field>
                <Field label="Port">
                  <Input mono value={port} onChange={(e) => setPort(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Password (optional)">
                  <Input
                    mono
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Field label="DB index">
                  <Input mono value={redisDbIndex} onChange={(e) => setRedisDbIndex(e.target.value)} />
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
                    onChange={setSslMode}
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
            <Button variant="primary" size="md" onClick={handleSave}>
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
