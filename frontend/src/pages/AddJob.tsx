import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Select } from "@/components/ui/Select";
import { useConnectionsStore } from "@/state/connections";
import { useJobsStore } from "@/state/jobs";
import { useAuthStore } from "@/state/auth";
import { useSettingsStore } from "@/state/settings";
import { runQuery, ApiError } from "@/lib/api";
import { SQL_ENGINES, type CheckMode, type HttpRequestJobConfig, type JobType } from "@/lib/types";
import { SqlEditor } from "@/components/workbench/SqlEditor";
import { JobRunCalendar } from "@/components/jobs/JobRunCalendar";
import { DependsOnPicker } from "@/components/jobs/DependsOnPicker";
import { renderJobTemplate } from "@/lib/jobTemplate";

const CRON_PRESETS = [
  { label: "Every 15 min", value: "*/15 * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
];

const CHECK_MODE_OPTIONS: { value: CheckMode; label: string }[] = [
  { value: "none", label: "None — success if the query runs without error" },
  { value: "fail_if_no_rows", label: "Fail if the query returns no rows" },
  { value: "fail_if_rows", label: "Fail if the query returns any rows" },
];

const JOB_TYPE_LABELS: Record<JobType, string> = {
  query: "scheduled query",
  http_request: "HTTP request",
};

const WEBHOOK_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value, label: value }));

export default function AddJob() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isEditing = !!id;
  const typeFromUrl = searchParams.get("type") === "http_request" ? "http_request" : searchParams.get("type") === "query" ? "query" : null;
  const connections = useConnectionsStore((s) => s.connections);
  const jobs = useJobsStore((s) => s.jobs);
  const addJob = useJobsStore((s) => s.addJob);
  const editJob = useJobsStore((s) => s.editJob);
  const token = useAuthStore((s) => s.token);
  const { theme, editorFontSize } = useSettingsStore();
  const resolvedTheme =
    theme === "system" ? ((document.documentElement.getAttribute("data-theme") as "dark" | "light" | null) ?? "dark") : theme;

  const existing = useMemo(() => jobs.find((j) => j.id === id), [jobs, id]);
  const sqlConnections = useMemo(() => connections.filter((c) => SQL_ENGINES.includes(c.engine)), [connections]);

  const [name, setName] = useState(existing?.name ?? "");
  const [jobType, setJobType] = useState<JobType>(existing?.jobType ?? typeFromUrl ?? "query");
  const [connectionId, setConnectionId] = useState(existing?.connectionId ?? sqlConnections[0]?.id ?? "");
  const [sql, setSql] = useState(existing?.sql ?? "");
  const [requestUrl, setRequestUrl] = useState(existing?.config.url ?? "");
  const [requestMethod, setRequestMethod] = useState<HttpRequestJobConfig["method"]>(existing?.config.method ?? "POST");
  const [requestHeaders, setRequestHeaders] = useState(
    Object.keys(existing?.config.headers ?? {}).length > 0 ? JSON.stringify(existing?.config.headers, null, 2) : "{}",
  );
  const [requestBody, setRequestBody] = useState(existing?.config.body ?? "");
  const [failOnField, setFailOnField] = useState(existing?.config.failOnNonEmptyArrayField ?? "");
  const [timeoutSeconds, setTimeoutSeconds] = useState(existing?.config.timeoutSeconds ? String(existing.config.timeoutSeconds) : "");
  const [cronExpr, setCronExpr] = useState(existing?.cronExpr ?? CRON_PRESETS[0].value);
  const [dependsOn, setDependsOn] = useState<string[]>(existing?.dependsOn ?? []);
  const [retryLimit, setRetryLimit] = useState(String(existing?.retryLimit ?? 0));
  const [retryDelaySeconds, setRetryDelaySeconds] = useState(String(existing?.retryDelaySeconds ?? 30));
  const [checkMode, setCheckMode] = useState<CheckMode>(existing?.checkMode ?? "none");
  const [saving, setSaving] = useState(false);

  const [testState, setTestState] = useState<"idle" | "testing" | "pass" | "fail">("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    if (!isEditing && !typeFromUrl) {
      navigate("/jobs", { replace: true });
    }
  }, [isEditing, typeFromUrl, navigate]);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setJobType(existing.jobType);
      setConnectionId(existing.connectionId);
      setSql(existing.sql);
      setRequestUrl(existing.config.url ?? "");
      setRequestMethod(existing.config.method ?? "POST");
      setRequestHeaders(Object.keys(existing.config.headers ?? {}).length > 0 ? JSON.stringify(existing.config.headers, null, 2) : "{}");
      setRequestBody(existing.config.body ?? "");
      setFailOnField(existing.config.failOnNonEmptyArrayField ?? "");
      setTimeoutSeconds(existing.config.timeoutSeconds ? String(existing.config.timeoutSeconds) : "");
      setCronExpr(existing.cronExpr);
      setDependsOn(existing.dependsOn);
      setRetryLimit(String(existing.retryLimit));
      setRetryDelaySeconds(String(existing.retryDelaySeconds));
      setCheckMode(existing.checkMode);
    }
  }, [existing]);

  const otherJobs = jobs.filter((j) => j.id !== id);
  const hasAction = jobType === "query" ? Boolean(connectionId && sql.trim()) : requestUrl.trim().length > 0;
  const canSave = name.trim().length > 0 && cronExpr.trim().length > 0 && hasAction;

  function toggleDependency(depId: string) {
    setDependsOn((prev) => (prev.includes(depId) ? prev.filter((d) => d !== depId) : [...prev, depId]));
  }

  async function testQuery() {
    if (!connectionId || !sql.trim() || !token) return;
    setTestState("testing");
    try {
      const result = await runQuery(token, connectionId, renderJobTemplate(sql));
      setTestMessage(`${result.rowCount} row${result.rowCount === 1 ? "" : "s"} · ${result.durationMs} ms`);
      setTestState("pass");
    } catch (err) {
      setTestMessage(err instanceof ApiError ? err.message : "Failed to run query");
      setTestState("fail");
    }
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    let config: Partial<HttpRequestJobConfig> = {};
    if (jobType === "http_request") {
      try {
        const parsed = JSON.parse(requestHeaders || "{}") as unknown;
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.values(parsed).some((value) => typeof value !== "string")) {
          throw new Error("Headers must be a JSON object whose values are strings");
        }
        config = {
          url: requestUrl.trim(),
          method: requestMethod,
          headers: parsed as Record<string, string>,
          body: requestBody,
          failOnNonEmptyArrayField: failOnField.trim() || undefined,
          timeoutSeconds: Number(timeoutSeconds) || undefined,
        };
      } catch (err) {
        setTestState("fail");
        setTestMessage(err instanceof Error ? err.message : "Headers must be valid JSON");
        setSaving(false);
        return;
      }
    }
    const input = {
      name: name.trim(),
      jobType,
      connectionId: jobType === "query" ? connectionId : "",
      sql: jobType === "query" ? sql : "",
      config,
      cronExpr: cronExpr.trim(),
      dependsOn,
      retryLimit: Number(retryLimit) || 0,
      retryDelaySeconds: Number(retryDelaySeconds) || 0,
      checkMode: jobType === "query" ? checkMode : "none" as CheckMode,
    };
    try {
      if (isEditing && id) {
        await editJob(id, input);
      } else {
        await addJob(input);
      }
      navigate("/jobs");
    } catch (err) {
      setTestState("fail");
      setTestMessage(err instanceof ApiError ? err.message : "Failed to save job");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg-app p-8">
      <div className="flex max-h-full w-[680px] flex-col gap-5 overflow-y-auto rounded-xl border border-border-strong bg-bg-app p-8">
        <div className="text-[16px] font-semibold tracking-[-0.01em] text-text-primary">
          {isEditing ? `Edit ${JOB_TYPE_LABELS[jobType]}` : `New ${JOB_TYPE_LABELS[jobType]}`}
        </div>

        <Field label="Name">
          <Input mono value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. nightly churn rollup" />
        </Field>

        {jobType === "query" ? (
          <>
            <Field label="Connection">
              {sqlConnections.length === 0 ? (
                <div className="rounded-[7px] border border-border-input bg-bg-inset px-[11px] py-2 text-[12px] text-text-faint">
                  No SQL connections yet — add one first.
                </div>
              ) : (
                <Select
                  value={connectionId}
                  onChange={setConnectionId}
                  options={sqlConnections.map((c) => ({ value: c.id, label: c.name }))}
                />
              )}
            </Field>

            <Field label="SQL query">
              <div className="h-[180px] overflow-hidden rounded-[7px] border border-border-input">
                <SqlEditor
                  value={sql}
                  onChange={setSql}
                  theme={resolvedTheme}
                  fontSize={editorFontSize}
                  onRun={testQuery}
                  connectionId={connectionId}
                />
              </div>
            </Field>

            <div className="flex items-center justify-between">
              <Button variant="secondary" size="sm" onClick={testQuery} disabled={!connectionId || !sql.trim() || testState === "testing"}>
                {testState === "testing" ? "Running…" : "Test query"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Field label="URL">
              <Input mono value={requestUrl} onChange={(e) => setRequestUrl(e.target.value)} placeholder="https://api.example.com/tasks/run" />
            </Field>
            <Field label="HTTP method">
              <Select value={requestMethod} onChange={(value) => setRequestMethod(value as HttpRequestJobConfig["method"])} options={WEBHOOK_METHOD_OPTIONS} />
            </Field>
            <Field label="Headers (JSON)">
              <textarea
                value={requestHeaders}
                onChange={(e) => setRequestHeaders(e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={'{\n  "Authorization": "Bearer …"\n}'}
                className="w-full resize-y rounded-[7px] border border-border-input bg-bg-inset px-[11px] py-2 font-mono text-[12px] leading-relaxed text-text-primary outline-none focus:border-border-focus"
              />
            </Field>
            <Field label="Request body (optional)">
              <textarea
                value={requestBody}
                onChange={(e) => setRequestBody(e.target.value)}
                rows={6}
                spellCheck={false}
                placeholder={'{\n  "date": "{{date}}"\n}'}
                className="w-full resize-y rounded-[7px] border border-border-input bg-bg-inset px-[11px] py-2 font-mono text-[12px] leading-relaxed text-text-primary outline-none focus:border-border-focus"
              />
            </Field>
            <Field label="Fail if response field is a non-empty array (optional)">
              <Input
                mono
                value={failOnField}
                onChange={(e) => setFailOnField(e.target.value)}
                placeholder="e.g. failed"
              />
              <div className="text-[11px] text-text-faint">
                Catches a 2xx response that still reports partial failures, e.g. {"{ \"failed\": [...] }"}.
              </div>
            </Field>
            <Field label="Request timeout in seconds (optional)">
              <Input
                mono
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(e.target.value.replace(/\D/g, ""))}
                placeholder="20 (default)"
              />
              <div className="text-[11px] text-text-faint">Raise this for a slow or cold-starting endpoint.</div>
            </Field>
          </>
        )}

        <div className="min-h-4">
          {testState !== "idle" && testState !== "testing" && (
            <div className={`flex items-center gap-1.5 text-[11.5px] ${testState === "pass" ? "text-success-text" : "text-error-text"}`}>
              {testState === "pass" ? <Check size={12} /> : <AlertCircle size={12} />}
              {testMessage}
            </div>
          )}
        </div>

        <Field label="Schedule (cron expression)">
          <div className="flex flex-col gap-2">
            <Input mono value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder="*/15 * * * *" />
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setCronExpr(p.value)}
                  className="rounded-[5px] border border-border-strong px-2 py-1 text-[11px] text-text-faint hover:bg-bg-hover hover:text-text-secondary"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </Field>

        {otherJobs.length > 0 && (
          <Field label="Depends on">
            <DependsOnPicker
              jobs={otherJobs.map((j) => ({ id: j.id, name: j.name }))}
              selected={dependsOn}
              onToggle={toggleDependency}
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Retry attempts on failure">
            <Input mono value={retryLimit} onChange={(e) => setRetryLimit(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Delay between retries (seconds)">
            <Input mono value={retryDelaySeconds} onChange={(e) => setRetryDelaySeconds(e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>

        {jobType === "query" && (
          <Field label="Check">
            <Select value={checkMode} onChange={(v) => setCheckMode(v as CheckMode)} options={CHECK_MODE_OPTIONS} className="w-full" />
          </Field>
        )}

        {isEditing && existing && (
          <ToggleRow
            title="Enabled"
            checked={existing.enabled}
            onChange={() => useJobsStore.getState().toggleEnabled(existing.id)}
          />
        )}

        {isEditing && existing && (
          <Field label="Runs">
            <JobRunCalendar jobId={existing.id} />
          </Field>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={() => navigate("/jobs")}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {isEditing ? "Save changes" : "Create job"}
          </Button>
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
  subtitle?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-0.5">
        <div className="text-[12.5px] font-medium text-text-primary">{title}</div>
        {subtitle && <div className="text-[11px] text-text-faint">{subtitle}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
