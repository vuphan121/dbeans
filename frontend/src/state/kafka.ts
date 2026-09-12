import { create } from "zustand";
import { KAFKA_MESSAGES, KAFKA_TOPICS, type KafkaMessage } from "@/mock/kafkaFixtures";

interface KafkaState {
  topics: typeof KAFKA_TOPICS;
  messages: Record<string, KafkaMessage[]>;
  selectedTopic: string | null;
  activeTab: "messages" | "produce";
  liveTail: boolean;
  select: (topic: string) => void;
  setActiveTab: (tab: "messages" | "produce") => void;
  toggleLiveTail: () => void;
  produce: (topic: string, msg: Omit<KafkaMessage, "offset" | "timestamp">) => void;
}

export const useKafkaStore = create<KafkaState>()((set, get) => ({
  topics: KAFKA_TOPICS,
  messages: KAFKA_MESSAGES,
  selectedTopic: KAFKA_TOPICS[0]?.name ?? null,
  activeTab: "messages",
  liveTail: false,

  select: (topic) => set({ selectedTopic: topic, activeTab: "messages" }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleLiveTail: () => set((s) => ({ liveTail: !s.liveTail })),

  produce: (topic, msg) => {
    const existing = get().messages[topic] ?? [];
    const nextOffset = (existing[0]?.offset ?? 0) + 1;
    const entry: KafkaMessage = {
      ...msg,
      offset: nextOffset,
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 23),
    };
    set({ messages: { ...get().messages, [topic]: [entry, ...existing] } });
  },
}));
