import { create } from 'zustand';

export type EntityType = 'model' | 'study' | 'dataset' | 'feature' | 'strategy';

export interface EntityState {
  activeEntity: { type: EntityType; id: string; name: string } | null;
  setEntity: (type: EntityType, id: string, name: string) => void;
  clearEntity: () => void;
}

export const useEntityStore = create<EntityState>((set) => ({
  activeEntity: null,
  setEntity: (type, id, name) => set({ activeEntity: { type, id, name } }),
  clearEntity: () => set({ activeEntity: null }),
}));
