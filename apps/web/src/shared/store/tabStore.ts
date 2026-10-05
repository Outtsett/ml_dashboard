import { create } from 'zustand';
import { EntityType } from '../contexts/EntityContext';

export interface Tab {
  id: string;
  title: string;
  type: EntityType | 'route';
  path?: string; // Original URL it belongs to
}

export interface TabState {
  openTabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  closeAll: () => void;
}

export const useTabStore = create<TabState>((set) => ({
  openTabs: [],
  activeTabId: null,
  
  openTab: (tab) => set((state) => {
    const exists = state.openTabs.find(t => t.id === tab.id);
    if (exists) {
      return { activeTabId: tab.id };
    }
    return {
      openTabs: [...state.openTabs, tab],
      activeTabId: tab.id
    };
  }),

  closeTab: (id) => set((state) => {
    const newTabs = state.openTabs.filter(t => t.id !== id);
    let newActive = state.activeTabId;
    
    if (state.activeTabId === id) {
      newActive = newTabs.at(-1)?.id ?? null; // fall back to the right-most remaining tab
    }
    
    return {
      openTabs: newTabs,
      activeTabId: newActive
    };
  }),

  setActiveTab: (id) => set({ activeTabId: id }),
  closeAll: () => set({ openTabs: [], activeTabId: null }),
}));
