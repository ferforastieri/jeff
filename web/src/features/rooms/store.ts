import { create } from "zustand";

interface RoomsUI {
  open: boolean;
  roomId: string | null;
  openRooms: (roomId?: string) => void;
  close: () => void;
  select: (roomId: string | null) => void;
}

export const useRoomsUI = create<RoomsUI>((set) => ({
  open: false,
  roomId: null,
  openRooms: (roomId) => set({ open: true, roomId: roomId ?? null }),
  close: () => set({ open: false }),
  select: (roomId) => set({ roomId }),
}));
