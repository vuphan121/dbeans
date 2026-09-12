import { WorkbenchShell } from "./WorkbenchShell";
import { TopicBrowser } from "./kafka/TopicBrowser";
import { MessagesPane } from "./kafka/MessagesPane";
import { ProducePane } from "./kafka/ProducePane";
import { useKafkaStore } from "@/state/kafka";
import { cn } from "@/lib/utils";
import type { SavedConnection } from "@/lib/types";

export function KafkaWorkbench({
  connection,
  onOpenPalette,
}: {
  connection: SavedConnection;
  onOpenPalette: () => void;
}) {
  const { selectedTopic, messages, activeTab, setActiveTab, liveTail, toggleLiveTail, produce } = useKafkaStore();
  const topicMessages = selectedTopic ? (messages[selectedTopic] ?? []) : [];

  return (
    <WorkbenchShell
      onOpenPalette={onOpenPalette}
      sidebar={<TopicBrowser />}
      topBarCenter={
        <div className="flex items-center gap-2 px-3.5 text-[12.5px] text-text-muted">
          <span className="font-mono text-[11px] text-text-faint">Kafka</span>
          <span className="text-text-secondary">{connection.name}</span>
        </div>
      }
    >
      {selectedTopic ? (
        <>
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-faint px-3">
            <TabButton active={activeTab === "messages"} onClick={() => setActiveTab("messages")}>
              Messages
            </TabButton>
            <TabButton active={activeTab === "produce"} onClick={() => setActiveTab("produce")}>
              Produce
            </TabButton>
            <span className="ml-auto font-mono text-[11px] text-text-faint">{selectedTopic}</span>
          </div>
          {activeTab === "messages" ? (
            <MessagesPane messages={topicMessages} liveTail={liveTail} onToggleLiveTail={toggleLiveTail} />
          ) : (
            <ProducePane onSend={(msg) => produce(selectedTopic, msg)} />
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">
          Select a topic to inspect it
        </div>
      )}
    </WorkbenchShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors",
        active ? "bg-bg-hover text-text-primary" : "text-text-faint hover:text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}
