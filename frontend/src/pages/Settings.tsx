import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { EngineTag } from "@/components/ui/Badge";
import { useSettingsStore } from "@/state/settings";
import { useConnectionsStore } from "@/state/connections";
import { useSnippetsStore } from "@/state/snippets";
import { useAuthStore } from "@/state/auth";
import { comboLabel } from "@/lib/platform";

export default function Settings() {
  const navigate = useNavigate();
  const {
    theme,
    setTheme,
    editorFontSize,
    setEditorFontSize,
    compactGrid,
    setCompactGrid,
    autoLockMinutes,
    setAutoLockMinutes,
  } = useSettingsStore();
  const { connections, removeConnection } = useConnectionsStore();
  const { snippets, removeSnippet } = useSnippetsStore();
  const { username, lock } = useAuthStore();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMessage, setPwMessage] = useState<string | null>(null);

  function handleUpdatePassword() {
    // Login is real (backend + Postgres), but there's no change-password
    // endpoint yet — this is the next piece of account settings to wire up.
    setPwMessage("Password changes aren't wired up yet — coming with account settings.");
    setCurrentPw("");
    setNewPw("");
  }

  function handleSignOut() {
    lock();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-full flex-col bg-bg-app">
      <header className="flex h-12 items-center justify-between border-b border-border-subtle px-4">
        <div className="flex items-center gap-2.5">
          <button onClick={() => navigate(-1)} className="text-text-faint hover:text-text-secondary">
            <ArrowLeft size={14} />
          </button>
          <div className="text-[13px] font-semibold text-text-primary">Settings</div>
        </div>
        <div className="rounded-[5px] border border-border-strong px-[7px] py-1 font-mono text-[11px] text-text-faint">
          {comboLabel(",")}
        </div>
      </header>

      <div className="flex flex-1 justify-center overflow-y-auto py-8">
        <div className="flex w-[660px] flex-col gap-8">
          <Section title="Appearance">
            <Row title="Theme" subtitle="Dark is the default.">
              <SegmentedControl
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                  { value: "system", label: "System" },
                ]}
              />
            </Row>
            <Row title="Editor font size" subtitle="JetBrains Mono">
              <Select
                value={String(editorFontSize)}
                onChange={(v) => setEditorFontSize(Number(v))}
                options={["12", "13", "14", "15", "16"].map((n) => ({ value: n, label: `${n} px` }))}
              />
            </Row>
            <Row title="Compact grid rows" subtitle="Fit more rows per screen." last>
              <Switch checked={compactGrid} onCheckedChange={setCompactGrid} />
            </Row>
          </Section>

          <Section title="Security">
            <div className="flex flex-col gap-3.5 p-4">
              <Row title="Signed in" subtitle={username ?? ""}>
                <Button variant="secondary" size="sm" onClick={handleSignOut}>
                  Sign out
                </Button>
              </Row>
              <div className="h-px bg-border-faint" />
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Current password">
                  <input
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    className="h-[34px] rounded-[7px] border border-border-input bg-bg-inset px-[11px] font-mono text-[12.5px] tracking-[0.14em] text-text-primary outline-none"
                  />
                </Field>
                <Field label="New password">
                  <input
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="at least 12 characters"
                    className="h-[34px] rounded-[7px] border border-border-input bg-bg-inset px-[11px] font-mono text-[12.5px] text-text-primary placeholder:text-text-quiet outline-none"
                  />
                </Field>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-[11.5px] text-text-faint">Changing this re-encrypts every stored credential.</div>
                <Button variant="secondary" size="sm" onClick={handleUpdatePassword} disabled={!currentPw || !newPw}>
                  Update password
                </Button>
              </div>
              {pwMessage && <div className="text-[11.5px] text-text-faint">{pwMessage}</div>}
              <div className="h-px bg-border-faint" />
              <Row title="Auto-lock" subtitle="Lock dbeans after inactivity.">
                <Select
                  value={String(autoLockMinutes)}
                  onChange={(v) => setAutoLockMinutes(Number(v))}
                  options={[5, 15, 30, 60].map((n) => ({ value: String(n), label: `${n} minutes` }))}
                />
              </Row>
            </div>
          </Section>

          <Section
            title="Connections"
            action={
              <button onClick={() => navigate("/connections/new")} className="text-[12px] text-text-tertiary hover:text-text-primary">
                + Add
              </button>
            }
          >
            {connections.map((c) => (
              <div key={c.id} className="flex h-[46px] items-center gap-3 border-b border-border-faint px-3.5 last:border-b-0">
                <EngineTag engine={c.engine} size={24} />
                <div className="text-[12.5px] font-medium text-text-primary">{c.name}</div>
                <div className="font-mono text-[11px] text-text-faint">{c.dsn}</div>
                <div className="ml-auto flex gap-3.5 text-[11.5px] text-text-muted">
                  <button className="hover:text-text-primary">Edit</button>
                  <button onClick={() => removeConnection(c.id)} className="text-error-dim hover:text-error-text">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </Section>

          <Section
            title="Snippets"
            action={<span className="text-[12px] text-text-tertiary">+ New snippet</span>}
          >
            {snippets.map((s) => (
              <div key={s.id} className="flex h-11 items-center gap-3 border-b border-border-faint px-3.5 last:border-b-0">
                <div className="w-[170px] shrink-0 truncate text-[12.5px] font-medium text-text-primary">{s.name}</div>
                <div className="flex-1 truncate font-mono text-[11px] text-text-faint">{s.sql}</div>
                <button onClick={() => removeSnippet(s.id)} className="shrink-0 text-[11px] text-text-quiet hover:text-error-dim">
                  {s.used}
                </button>
              </div>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">{title}</div>
        {action}
      </div>
      <div className="overflow-hidden rounded-[9px] border border-border-default">{children}</div>
    </div>
  );
}

function Row({
  title,
  subtitle,
  children,
  last,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between px-4 py-3.5 ${last ? "" : "border-b border-border-faint"}`}>
      <div className="flex flex-col gap-0.5">
        <div className="text-[13px] font-medium text-text-primary">{title}</div>
        <div className="text-[11.5px] text-text-faint">{subtitle}</div>
      </div>
      {children}
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
