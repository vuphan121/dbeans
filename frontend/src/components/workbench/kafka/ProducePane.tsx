import { useState, type ReactNode } from "react";
import { Plus, X, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function ProducePane({
  onSend,
}: {
  onSend: (msg: { partition: number; key: string | null; value: string; headers: Record<string, string> }) => Promise<void>;
}) {
  const [partition, setPartition] = useState("0");
  const [key, setKey] = useState("");
  const [value, setValue] = useState('{\n  \n}');
  const [headers, setHeaders] = useState<[string, string][]>([["content-type", "application/json"]]);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    try {
      await onSend({
        partition: Number(partition) || 0,
        key: key.trim() || null,
        value,
        headers: Object.fromEntries(headers.filter(([k]) => k.trim())),
      });
      setSent(true);
      window.setTimeout(() => setSent(false), 1800);
    } catch {
      // The workbench header displays the API error.
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Partition">
          <Input mono value={partition} onChange={(e) => setPartition(e.target.value)} />
        </Field>
        <Field label="Key (optional)">
          <Input mono value={key} onChange={(e) => setKey(e.target.value)} placeholder="null" />
        </Field>
      </div>

      <Field label="Value">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={8}
          className="w-full resize-y rounded-[8px] border border-border-input bg-bg-inset p-3 font-mono text-[12.5px] leading-[1.6] text-text-primary outline-none focus:border-border-focus"
        />
      </Field>

      <Field label="Headers">
        <div className="flex flex-col gap-2">
          {headers.map(([hk, hv], i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                mono
                className="h-8 flex-1 text-[11.5px]"
                value={hk}
                placeholder="key"
                onChange={(e) => {
                  const next = [...headers];
                  next[i] = [e.target.value, hv];
                  setHeaders(next);
                }}
              />
              <Input
                mono
                className="h-8 flex-1 text-[11.5px]"
                value={hv}
                placeholder="value"
                onChange={(e) => {
                  const next = [...headers];
                  next[i] = [hk, e.target.value];
                  setHeaders(next);
                }}
              />
              <button
                onClick={() => setHeaders(headers.filter((_, hi) => hi !== i))}
                className="flex h-8 w-8 items-center justify-center text-text-quiet hover:text-error-dim"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setHeaders([...headers, ["", ""]])}
            className="flex w-fit items-center gap-1.5 text-[11.5px] text-text-faint hover:text-text-secondary"
          >
            <Plus size={11} /> Add header
          </button>
        </div>
      </Field>

      <div className="mt-1 flex items-center gap-3">
        <Button variant="primary" size="md" disabled={sending} onClick={() => void handleSend()}>
          <Send size={12} /> {sending ? "Sending…" : "Send"}
        </Button>
        {sent && <span className="text-[12px] text-success-text">Message produced</span>}
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
