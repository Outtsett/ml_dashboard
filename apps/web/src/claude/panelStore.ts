/**
 * Whether the Claude panel is open, how wide, and which conversation it shows.
 * One store so the top bar's button, the keyboard shortcut and the panel agree.
 * Width and the last conversation survive a reload (a per-viewer convenience).
 */

import { create } from "zustand";

const STORAGE_KEY = "claude-panel-v1";
const MIN_WIDTH = 360;
const MAX_WIDTH = 1100;

function load(): { width: number; activeKey: string | null } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { width?: number; activeKey?: string | null };
      return { width: clampWidth(parsed.width ?? 520), activeKey: parsed.activeKey ?? null };
    }
  } catch {
    // storage blocked — defaults below
  }
  return { width: 520, activeKey: null };
}

function save(width: number, activeKey: string | null): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ width, activeKey }));
  } catch {
    // a convenience only
  }
}

export function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

interface ClaudePanelState {
  open: boolean;
  width: number;
  activeKey: string | null;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
  setActiveKey: (key: string | null) => void;
}

const initial = typeof window === "undefined" ? { width: 520, activeKey: null } : load();

export const useClaudePanel = create<ClaudePanelState>((set, get) => ({
  open: false,
  width: initial.width,
  activeKey: initial.activeKey,
  toggle: () => set({ open: !get().open }),
  setOpen: (open) => set({ open }),
  setWidth: (width) => {
    const next = clampWidth(width);
    set({ width: next });
    save(next, get().activeKey);
  },
  setActiveKey: (activeKey) => {
    set({ activeKey });
    save(get().width, activeKey);
  },
}));
