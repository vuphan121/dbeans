import { useEffect, useState, type ReactNode } from "react";
import { KeyRound, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSecretsStore } from "@/state/secrets";
import { ApiError } from "@/lib/api";

export default function Secrets() {
  const { secrets, loaded, loadSecrets, addSecret, editSecret, removeSecret } = useSecretsStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loaded) loadSecrets();
  }, [loaded, loadSecrets]);

  function startCreate() {
    setEditingId("__new__");
    setName("");
    setValue("");
    setError(null);
  }

  function startEdit(id: string, currentName: string) {
    setEditingId(id);
    setName(currentName);
    setValue("");
    setError(null);
  }

  function cancelForm() {
    setEditingId(null);
    setName("");
    setValue("");
    setError(null);
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId === "__new__") {
        if (!value) {
          setError("Value is required.");
          setSaving(false);
          return;
        }
        await addSecret(name.trim(), value);
      } else if (editingId) {
        await editSecret(editingId, { name: name.trim(), value: value || undefined });
      }
      cancelForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save secret.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg-app">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <div className="text-[13px] font-medium text-text-secondary">Secrets</div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 justify-center overflow-y-auto py-8">
        <div className="flex w-[660px] flex-col gap-8">
          <div className="text-[12.5px] text-text-faint">
            Named values (like environment variables) that any job can reference as{" "}
            <code className="rounded bg-bg-inset px-1 py-0.5 font-mono text-text-tertiary">{"{{name}}"}</code> in its
            SQL, URL, headers, or body — resolved at run time, the same way{" "}
            <code className="rounded bg-bg-inset px-1 py-0.5 font-mono text-text-tertiary">{"{{date}}"}</code> is.
            Values are write-only: once saved, a secret can be renamed or overwritten, but never viewed again.
          </div>

          <Section
            title="Vault"
            action={
              editingId ? null : (
                <button onClick={startCreate} className="text-[12px] text-text-tertiary hover:text-text-primary">
                  + Add secret
                </button>
              )
            }
          >
            <div className="flex flex-col">
              {editingId === "__new__" && (
                <SecretForm
                  name={name}
                  value={value}
                  isNew
                  saving={saving}
                  error={error}
                  onNameChange={setName}
                  onValueChange={setValue}
                  onSave={handleSave}
                  onCancel={cancelForm}
                />
              )}

              {secrets.length === 0 && editingId !== "__new__" && (
                <div className="px-4 py-6 text-center text-[12px] text-text-faint">
                  No secrets yet — jobs can only use {"{{date}}"} until you add one.
                </div>
              )}

              {secrets.map((secret, i) =>
                editingId === secret.id ? (
                  <SecretForm
                    key={secret.id}
                    name={name}
                    value={value}
                    saving={saving}
                    error={error}
                    onNameChange={setName}
                    onValueChange={setValue}
                    onSave={handleSave}
                    onCancel={cancelForm}
                  />
                ) : (
                  <div
                    key={secret.id}
                    className={`flex items-center justify-between px-4 py-3 ${
                      i < secrets.length - 1 || editingId ? "border-b border-border-faint" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <KeyRound size={13} className="text-text-faint" />
                      <div className="font-mono text-[12.5px] text-text-primary">{secret.name}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-[11px] text-text-faint">
                        added {new Date(secret.createdAt).toLocaleDateString()}
                      </div>
                      <button
                        onClick={() => startEdit(secret.id, secret.name)}
                        className="text-text-faint hover:text-text-secondary"
                        title="Rename or rotate value"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => removeSecret(secret.id)}
                        className="text-text-faint hover:text-error-text"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ),
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function SecretForm({
  name,
  value,
  isNew,
  saving,
  error,
  onNameChange,
  onValueChange,
  onSave,
  onCancel,
}: {
  name: string;
  value: string;
  isNew?: boolean;
  saving: boolean;
  error: string | null;
  onNameChange: (v: string) => void;
  onValueChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-border-faint px-4 py-3.5">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Name">
          <Input mono value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. CHESSLAB_BACKEND_URL" />
        </Field>
        <Field label={isNew ? "Value" : "New value (leave blank to keep current)"}>
          <input
            type="password"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={isNew ? "" : "unchanged"}
            className="h-[34px] w-full rounded-[7px] border border-border-input bg-bg-inset px-[11px] font-mono text-[12.5px] text-text-primary placeholder:text-text-quiet outline-none"
          />
        </Field>
      </div>
      {error && <div className="text-[11.5px] text-error-text">{error}</div>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X size={12} />
          Cancel
        </Button>
        <Button variant="secondary" size="sm" onClick={onSave} disabled={!name.trim() || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[12px] font-medium text-text-tertiary">{label}</div>
      {children}
    </div>
  );
}
