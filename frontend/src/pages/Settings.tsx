import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useSettingsStore } from "@/state/settings";
import { useAuthStore } from "@/state/auth";
import { comboLabel } from "@/lib/platform";
import { getJobsTickInfo, API_URL } from "@/lib/api";

export default function Settings() {
  const navigate = useNavigate();
  const { theme, setTheme } = useSettingsStore();
  const { username, lock, token } = useAuthStore();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [tickUrl, setTickUrl] = useState<string | null>(null);
  const [tickUrlError, setTickUrlError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    getJobsTickInfo(token)
      .then((info) => {
        if (!info.secret) {
          setTickUrlError("CRON_SECRET isn't set on the backend yet — add it to backend/.env and restart the server.");
          return;
        }
        setTickUrl(`${API_URL}${info.path}?secret=${info.secret}`);
      })
      .catch(() => setTickUrlError("Couldn't load the tick URL."));
  }, [token]);

  function copyTickUrl() {
    if (!tickUrl) return;
    navigator.clipboard.writeText(tickUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

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
            <Row title="Theme" subtitle="Dark is the default." last>
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
            </div>
          </Section>

          <Section
            title="Scheduled jobs"
            action={
              <button onClick={() => navigate("/jobs")} className="text-[12px] text-text-tertiary hover:text-text-primary">
                Open board →
              </button>
            }
          >
            <div className="flex flex-col gap-3 p-4">
              {tickUrlError ? (
                <div className="rounded-[7px] border border-error-border bg-error-bg px-3 py-2 text-[11.5px] text-error-text">
                  {tickUrlError}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 overflow-x-auto rounded-[7px] border border-border-input bg-bg-inset px-[11px] py-2 font-mono text-[11.5px] text-text-secondary whitespace-nowrap">
                    {tickUrl ?? "Loading…"}
                  </div>
                  <Button variant="secondary" size="sm" onClick={copyTickUrl} disabled={!tickUrl}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              )}
            </div>
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
