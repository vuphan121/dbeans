import { create } from "zustand";
import type { CardLayout, CheckMode, ScheduledJob } from "@/lib/types";
import { useAuthStore } from "@/state/auth";
import { FIELD_CENTER, GRID_UNIT, snapToGrid } from "@/lib/canvasBounds";
import * as api from "@/lib/api";

const CARD_W = GRID_UNIT * 7; // 280
const CARD_H = GRID_UNIT * 4; // 160
const GAP = GRID_UNIT;

const CENTER_FILL_ORDER: [number, number][] = [
  [0, 0],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [2, 0], [-2, 0], [0, 2], [0, -2],
  [2, 1], [-2, 1], [2, -1], [-2, -1],
  [1, 2], [-1, 2], [1, -2], [-1, -2],
];

function nextLayout(existingCount: number): CardLayout {
  const [colOffset, rowOffset] =
    CENTER_FILL_ORDER[existingCount] ?? [(existingCount % 5) - 2, 3 + Math.floor(existingCount / 5)];
  return {
    x: snapToGrid(FIELD_CENTER.x + colOffset * (CARD_W + GAP) - CARD_W / 2),
    y: snapToGrid(FIELD_CENTER.y + rowOffset * (CARD_H + GAP) - CARD_H / 2),
    width: CARD_W,
    height: CARD_H,
  };
}

export interface NewJobInput {
  name: string;
  connectionId: string;
  sql: string;
  cronExpr: string;
  dependsOn: string[];
  retryLimit: number;
  retryDelaySeconds: number;
  checkMode: CheckMode;
}

interface JobsState {
  jobs: ScheduledJob[];
  loaded: boolean;
  loadJobs: () => Promise<void>;
  addJob: (input: NewJobInput) => Promise<void>;
  editJob: (id: string, input: NewJobInput) => Promise<void>;
  removeJob: (id: string) => void;
  toggleEnabled: (id: string) => void;
  updateLayout: (id: string, layout: CardLayout) => void;
  runNow: (id: string) => Promise<void>;
}

export const useJobsStore = create<JobsState>()((set, get) => ({
  jobs: [],
  loaded: false,

  loadJobs: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const jobs = await api.listJobs(token);
      set({ jobs, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  addJob: async (input) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    const job: ScheduledJob = {
      id: `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ...input,
      enabled: true,
      layout: nextLayout(get().jobs.length),
      lastStatus: "never_run",
    };
    const created = await api.createJob(token, job);
    set((s) => ({ jobs: [...s.jobs, created] }));
  },

  editJob: async (id, input) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    const existing = get().jobs.find((j) => j.id === id);
    if (!existing) return;
    const updated: ScheduledJob = { ...existing, ...input };
    await api.updateJob(token, updated);
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? updated : j)) }));
  },

  removeJob: (id) => {
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    const token = useAuthStore.getState().token;
    if (token) api.deleteJob(token, id).catch(() => {});
  },

  toggleEnabled: (id) => {
    const token = useAuthStore.getState().token;
    const job = get().jobs.find((j) => j.id === id);
    if (!token || !job) return;
    const updated = { ...job, enabled: !job.enabled };
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? updated : j)) }));
    api.updateJob(token, updated).catch(() => {});
  },

  updateLayout: (id, layout) => {
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, layout } : j)) }));
    const token = useAuthStore.getState().token;
    if (token) api.updateJobLayout(token, id, layout).catch(() => {});
  },

  runNow: async (id) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    const run = await api.runJobNow(token, id);
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id ? { ...j, lastStatus: run.status, lastRunAt: run.finishedAt ?? j.lastRunAt } : j,
      ),
    }));
  },
}));
