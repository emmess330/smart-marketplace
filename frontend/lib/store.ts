import { create } from "zustand";
import Cookies from "js-cookie";

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface AuthStore {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => {
    Cookies.remove("access_token");
    Cookies.remove("refresh_token");
    set({ user: null });
  },
  isAuthenticated: () => !!get().user,
}));

interface CartStore {
  itemCount: number;
  setItemCount: (count: number) => void;
  increment: () => void;
  decrement: () => void;
}

export const useCartStore = create<CartStore>((set, get) => ({
  itemCount: 0,
  setItemCount: (count) => set({ itemCount: count }),
  increment: () => set({ itemCount: get().itemCount + 1 }),
  decrement: () => set({ itemCount: Math.max(0, get().itemCount - 1) }),
}));