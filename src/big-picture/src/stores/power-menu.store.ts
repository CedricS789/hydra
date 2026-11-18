import { create } from "zustand";

interface PowerMenuState {
  visible: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const usePowerMenuStore = create<PowerMenuState>()((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
  toggle: () => set((state) => ({ visible: !state.visible })),
}));
