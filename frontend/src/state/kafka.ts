import { create } from "zustand";
import { listKafkaMessages, listKafkaTopics, produceKafkaMessage } from "@/lib/api";
import type { KafkaMessage, KafkaTopic } from "@/lib/types";

interface KafkaState {
  connectionId: string | null; token: string | null; topics: KafkaTopic[];
  messages: Record<string, KafkaMessage[]>; selectedTopic: string | null;
  activeTab: "messages" | "produce"; liveTail: boolean; loading: boolean; error: string | null;
  load: (token: string, connectionId: string) => Promise<void>;
  select: (topic: string) => Promise<void>; refreshMessages: () => Promise<void>;
  setActiveTab: (tab: "messages" | "produce") => void; toggleLiveTail: () => void;
  produce: (topic: string, msg: Omit<KafkaMessage, "offset" | "timestamp">) => Promise<void>;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Kafka operation failed";

export const useKafkaStore = create<KafkaState>()((set, get) => ({
  connectionId: null, token: null, topics: [], messages: {}, selectedTopic: null,
  activeTab: "messages", liveTail: false, loading: false, error: null,
  load: async (token, connectionId) => {
    set({ token, connectionId, topics: [], messages: {}, selectedTopic: null, loading: true, error: null });
    try {
      const topics = await listKafkaTopics(token, connectionId); if (get().connectionId !== connectionId) return;
      const selectedTopic = topics[0]?.name ?? null; set({ topics, selectedTopic, loading: false });
      if (selectedTopic) await get().refreshMessages();
    } catch (error) { if (get().connectionId === connectionId) set({ loading: false, error: errorMessage(error) }); }
  },
  select: async (selectedTopic) => { set({ selectedTopic, activeTab: "messages", error: null }); await get().refreshMessages(); },
  refreshMessages: async () => {
    const { token, connectionId, selectedTopic } = get(); if (!token || !connectionId || !selectedTopic) return;
    try {
      const entries = await listKafkaMessages(token, connectionId, selectedTopic);
      if (get().selectedTopic === selectedTopic) set((state) => ({ messages: { ...state.messages, [selectedTopic]: entries }, error: null }));
    } catch (error) { set({ error: errorMessage(error) }); }
  },
  setActiveTab: (activeTab) => set({ activeTab }),
  toggleLiveTail: () => set((state) => ({ liveTail: !state.liveTail })),
  produce: async (topic, msg) => {
    const { token, connectionId } = get(); if (!token || !connectionId) return;
    try { await produceKafkaMessage(token, connectionId, topic, msg); set({ error: null }); await get().refreshMessages(); }
    catch (error) { set({ error: errorMessage(error) }); throw error; }
  },
}));
