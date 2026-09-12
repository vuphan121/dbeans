import { useState } from "react";
import { Trash2, Plus, X } from "lucide-react";
import { useRedisStore } from "@/state/redis";
import type { RedisKeyEntry, RedisValue } from "@/mock/redisFixtures";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function KeyEditor({ entry }: { entry: RedisKeyEntry }) {
  const { updateValue, setTtl, deleteKey } = useRedisStore();
  const [ttlDraft, setTtlDraft] = useState(entry.ttl != null ? String(entry.ttl) : "");

  function commitTtl() {
    const n = ttlDraft.trim() === "" ? null : Number(ttlDraft);
    setTtl(entry.key, Number.isFinite(n) ? n : null);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border-faint px-5 py-4">
        <div className="flex flex-1 flex-col gap-1 overflow-hidden">
          <div className="truncate font-mono text-[14px] font-medium text-text-primary">{entry.key}</div>
          <div className="flex items-center gap-2 text-[11px] text-text-faint">
            <span className="rounded-[4px] bg-bg-hover px-1.5 py-0.5 font-mono text-text-tertiary">
              {entry.value.type}
            </span>
            <span>TTL</span>
            <input
              value={ttlDraft}
              onChange={(e) => setTtlDraft(e.target.value)}
              onBlur={commitTtl}
              onKeyDown={(e) => e.key === "Enter" && commitTtl()}
              placeholder="no expiry"
              className="w-20 rounded-[4px] border border-border-input bg-bg-inset px-1.5 py-0.5 font-mono text-[11px] text-text-secondary outline-none"
            />
            <span>s</span>
          </div>
        </div>
        <Button variant="danger" size="sm" onClick={() => deleteKey(entry.key)}>
          <Trash2 size={12} /> Delete
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <ValueEditor value={entry.value} onChange={(v) => updateValue(entry.key, v)} />
      </div>
    </div>
  );
}

function ValueEditor({ value, onChange }: { value: RedisValue; onChange: (v: RedisValue) => void }) {
  switch (value.type) {
    case "string":
      return (
        <textarea
          value={value.value}
          onChange={(e) => onChange({ type: "string", value: e.target.value })}
          rows={10}
          className="w-full resize-y rounded-[8px] border border-border-input bg-bg-inset p-3 font-mono text-[12.5px] leading-[1.6] text-text-primary outline-none focus:border-border-focus"
        />
      );
    case "hash":
      return (
        <RowTable
          rows={value.fields.map((f) => [f.field, f.value] as [string, string])}
          leftLabel="field"
          rightLabel="value"
          onChange={(rows) => onChange({ type: "hash", fields: rows.map(([field, val]) => ({ field, value: val })) })}
        />
      );
    case "list":
      return (
        <IndexedList
          items={value.items}
          onChange={(items) => onChange({ type: "list", items })}
        />
      );
    case "set":
      return <MemberChips members={value.members} onChange={(members) => onChange({ type: "set", members })} />;
    case "zset":
      return (
        <RowTable
          rows={value.members.map((m) => [m.member, String(m.score)] as [string, string])}
          leftLabel="member"
          rightLabel="score"
          onChange={(rows) =>
            onChange({
              type: "zset",
              members: rows.map(([member, score]) => ({ member, score: Number(score) || 0 })),
            })
          }
        />
      );
  }
}

function RowTable({
  rows,
  leftLabel,
  rightLabel,
  onChange,
}: {
  rows: [string, string][];
  leftLabel: string;
  rightLabel: string;
  onChange: (rows: [string, string][]) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-border-default">
      <div className="grid grid-cols-[1fr_1fr_28px] border-b border-border-faint bg-bg-inset px-3 py-1.5 font-mono text-[10.5px] text-text-quiet">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
        <span />
      </div>
      {rows.map(([a, b], i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_28px] items-center gap-2 border-b border-border-faint px-3 py-1.5 last:border-b-0">
          <Input
            className="h-7 text-[11.5px]"
            value={a}
            onChange={(e) => {
              const next = [...rows];
              next[i] = [e.target.value, b];
              onChange(next);
            }}
          />
          <Input
            className="h-7 text-[11.5px]"
            value={b}
            onChange={(e) => {
              const next = [...rows];
              next[i] = [a, e.target.value];
              onChange(next);
            }}
          />
          <button
            onClick={() => onChange(rows.filter((_, ri) => ri !== i))}
            className="flex h-7 w-7 items-center justify-center text-text-quiet hover:text-error-dim"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...rows, ["", ""]])}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[11.5px] text-text-faint hover:bg-bg-hover"
      >
        <Plus size={11} /> Add row
      </button>
    </div>
  );
}

function IndexedList({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-border-default">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 border-b border-border-faint px-3 py-1.5 last:border-b-0">
          <span className="w-6 shrink-0 font-mono text-[10.5px] text-text-quiet">{i}</span>
          <Input
            className="h-7 flex-1 text-[11.5px]"
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            onClick={() => onChange(items.filter((_, ri) => ri !== i))}
            className="flex h-7 w-7 items-center justify-center text-text-quiet hover:text-error-dim"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, ""])}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[11.5px] text-text-faint hover:bg-bg-hover"
      >
        <Plus size={11} /> Add item
      </button>
    </div>
  );
}

function MemberChips({ members, onChange }: { members: string[]; onChange: (m: string[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => (
          <span
            key={m}
            className="flex items-center gap-1.5 rounded-full border border-border-input bg-bg-inset px-2.5 py-1 font-mono text-[11px] text-text-secondary"
          >
            {m}
            <button onClick={() => onChange(members.filter((x) => x !== m))} className="text-text-quiet hover:text-error-dim">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          className="h-7 flex-1 text-[11.5px]"
          value={draft}
          placeholder="new member"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onChange([...members, draft.trim()]);
              setDraft("");
            }
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (draft.trim()) {
              onChange([...members, draft.trim()]);
              setDraft("");
            }
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
