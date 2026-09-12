import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/Switch";
import type { KafkaMessage } from "@/mock/kafkaFixtures";

const COLUMNS = "70px 90px 170px 160px 1fr";

export function MessagesPane({
  messages,
  liveTail,
  onToggleLiveTail,
}: {
  messages: KafkaMessage[];
  liveTail: boolean;
  onToggleLiveTail: () => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-faint px-4">
        <span className="text-[11.5px] text-text-faint">{messages.length} messages loaded</span>
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-text-muted">Live tail</span>
          <Switch checked={liveTail} onCheckedChange={onToggleLiveTail} />
        </div>
      </div>

      <div
        style={{ gridTemplateColumns: COLUMNS }}
        className="grid h-[30px] shrink-0 items-center border-b border-border-default bg-bg-inset px-1 font-mono text-[10.5px] font-medium text-text-muted"
      >
        <div className="px-2.5">partition</div>
        <div className="px-2.5">offset</div>
        <div className="px-2.5">timestamp</div>
        <div className="px-2.5">key</div>
        <div className="px-2.5">value</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={`${m.partition}-${m.offset}`} className="border-b border-border-faint">
            <div
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{ gridTemplateColumns: COLUMNS }}
              className="grid h-[30px] cursor-pointer items-center px-1 font-mono text-[11.5px] text-text-secondary hover:bg-bg-hover/40"
            >
              <div className="flex items-center gap-1 px-2.5 text-text-muted">
                {expanded === i ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {m.partition}
              </div>
              <div className="px-2.5 text-text-muted">{m.offset}</div>
              <div className="px-2.5 text-text-muted">{m.timestamp}</div>
              <div className="truncate px-2.5">{m.key ?? <span className="text-text-disabled">null</span>}</div>
              <div className="truncate px-2.5 text-text-muted">{m.value}</div>
            </div>
            {expanded === i && (
              <div className="flex flex-col gap-2 bg-bg-inset px-4 py-3 font-mono text-[11.5px]">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-text-quiet">Value</div>
                  <pre className="whitespace-pre-wrap break-all text-text-secondary">{m.value}</pre>
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-text-quiet">Headers</div>
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(m.headers).map(([k, v]) => (
                      <div key={k} className="text-text-faint">
                        {k}: <span className="text-text-secondary">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
