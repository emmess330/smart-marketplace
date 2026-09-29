import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import Cookies from "js-cookie";
import { useAuthStore } from "@/lib/store";

// Dynamically determine API base URL
let baseURL = "http://localhost";
if (typeof window !== "undefined") {
  const hostname = window.location.hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    baseURL = `http://${hostname}`;
  }
}

const AUTH_URL = `${baseURL}:8001`;
const PRODUCTS_URL = `${baseURL}:8002`;
const ORDERS_URL = `${baseURL}:8003`;
const USERS_URL = `${baseURL}:8004`;
const SEARCH_URL = `${baseURL}:8005`;
const RECOMMEND_URL = `${baseURL}:8006`;
const FORECAST_URL = `${baseURL}:8007`;

export interface ShippingAddress {
  full_name: string;
  line1: string;
  line2?: string;
  city: string;
  postal_code: string;
  country: string; // ISO 3166-1 alpha-2, e.g. "GB"
}

function authHeaders() {
  const token = Cookies.get("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Both cookies live as long as the refresh token (7 days). The access token
// inside expires after an hour and is renewed by the interceptor below, so
// the cookie's lifetime is not the token's.
function setTokens(accessToken: string, refreshToken: string) {
  Cookies.set("access_token", accessToken, { expires: 7 });
  Cookies.set("refresh_token", refreshToken, { expires: 7 });
}

function clearTokens() {
  Cookies.remove("access_token");
  Cookies.remove("refresh_token");
}

// One refresh at a time: requests that hit a 401 together share it. The
// server rotates refresh tokens, so parallel refreshes would all but one fail.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = Cookies.get("refresh_token");
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${AUTH_URL}/auth/refresh`, { refreshToken });
    setTokens(res.data.accessToken, res.data.refreshToken);
    return res.data.accessToken;
  } catch {
    // Another tab may have rotated the token first; its new tokens are in the
    // shared cookies, so use those rather than logging out.
    const latest = Cookies.get("refresh_token");
    return latest && latest !== refreshToken ? Cookies.get("access_token") ?? null : null;
  }
}

type RetryableConfig = InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean };

// On a 401 for a request that sent a token, refresh once and retry it. Guarded
// so hot reload doesn't register the interceptor twice.
const globalWithFlag = globalThis as typeof globalThis & { __authRefreshInterceptor?: boolean };
if (typeof window !== "undefined" && !globalWithFlag.__authRefreshInterceptor) {
  globalWithFlag.__authRefreshInterceptor = true;
  axios.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const headers = AxiosHeaders.from(config?.headers ?? {});
    if (
      error.response?.status !== 401 || !config || config._retriedAfterRefresh ||
      !headers.has("Authorization")
    ) {
      throw error;
    }
    config._retriedAfterRefresh = true;

    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null;
    });
    const accessToken = await refreshing;
    if (!accessToken) {
      clearTokens();
      useAuthStore.getState().logout();
      throw error;
    }
    headers.set("Authorization", `Bearer ${accessToken}`);
    config.headers = headers;
    return axios(config);
  });
}

export const authApi = {
  register: async (data: { email: string; password: string; full_name: string; role: string }) => {
    const res = await axios.post(`${AUTH_URL}/auth/register`, data);
    setTokens(res.data.accessToken, res.data.refreshToken);
    return res;
  },

  login: async (data: { email: string; password: string }) => {
    const res = await axios.post(`${AUTH_URL}/auth/login`, data);
    setTokens(res.data.accessToken, res.data.refreshToken);
    return res;
  },

  logout: async () => {
    const refreshToken = Cookies.get("refresh_token");
    await axios.post(`${AUTH_URL}/auth/logout`, { refreshToken });
    clearTokens();
  },

  me: () =>
    axios.get(`${AUTH_URL}/auth/me`, { headers: authHeaders() }),
};

export const productsApi = {
  list: (params?: { page?: number; limit?: number; category?: string; seller_id?: string }) =>
    axios.get(`${PRODUCTS_URL}/products`, { params }),

  get: (id: string) =>
    axios.get(`${PRODUCTS_URL}/products/${id}`),

  create: (data: object) =>
    axios.post(`${PRODUCTS_URL}/products`, data, { headers: authHeaders() }),

  update: (id: string, data: object) =>
    axios.put(`${PRODUCTS_URL}/products/${id}`, data, { headers: authHeaders() }),

  delete: (id: string) =>
    axios.delete(`${PRODUCTS_URL}/products/${id}`, { headers: authHeaders() }),

  categories: () =>
    axios.get(`${PRODUCTS_URL}/categories`),

  // Get products for the authenticated seller (requires backend endpoint)
  getSellerProducts: () =>
    axios.get(`${PRODUCTS_URL}/seller/products`, { headers: authHeaders() }),
};

export const ordersApi = {
  getCart: () =>
    axios.get(`${ORDERS_URL}/cart`, { headers: authHeaders() }),

  addToCart: (product_id: string, quantity: number) =>
    axios.post(`${ORDERS_URL}/cart`, { product_id, quantity }, { headers: authHeaders() }),

  updateCartItem: (id: string, quantity: number) =>
    axios.put(`${ORDERS_URL}/cart/${id}`, { quantity }, { headers: authHeaders() }),

  removeFromCart: (id: string) =>
    axios.delete(`${ORDERS_URL}/cart/${id}`, { headers: authHeaders() }),

  // The shipping address was attached to the payment intent; only its id is sent.
  checkout: (stripePaymentId: string) =>
    axios.post(
      `${ORDERS_URL}/orders/checkout`,
      { stripe_payment_id: stripePaymentId },
      { headers: authHeaders() },
    ),

  getOrders: () =>
    axios.get(`${ORDERS_URL}/orders`, { headers: authHeaders() }),

  getOrder: (id: string) =>
    axios.get(`${ORDERS_URL}/orders/${id}`, { headers: authHeaders() }),

  createPaymentIntent: (shippingAddress: ShippingAddress) =>
    axios.post(
      `${ORDERS_URL}/orders/create-payment-intent`,
      { shipping_address: shippingAddress },
      { headers: authHeaders() },
    ),
};

export const usersApi = {
  me: () =>
    axios.get(`${USERS_URL}/users/me`, { headers: authHeaders() }),

  updateProfile: (data: object) =>
    axios.put(`${USERS_URL}/users/me`, data, { headers: authHeaders() }),

  // Becoming a seller returns a fresh token pair carrying the seller role.
  createSellerProfile: async (data: object) => {
    const res = await axios.post(`${USERS_URL}/users/seller`, data, { headers: authHeaders() });
    setTokens(res.data.accessToken, res.data.refreshToken);
    return res;
  },

  getSeller: (id: string) =>
    axios.get(`${USERS_URL}/users/sellers/${id}`),
};

export const searchApi = {
  search: (params: {
    q?: string;
    category?: string;
    min_price?: number;
    max_price?: number;
    page?: number;
    limit?: number;
  }) => axios.get(`${SEARCH_URL}/search`, { params }),

  suggest: (q: string) =>
    axios.get(`${SEARCH_URL}/search/suggest`, { params: { q } }),
};

export const recommendApi = {
  forUser: (userId: string) =>
    axios.get(`${RECOMMEND_URL}/recommend/user/${userId}`, { headers: authHeaders() }),

  similar: (productId: string) =>
    axios.get(`${RECOMMEND_URL}/recommend/similar/${productId}`),

  popular: () =>
    axios.get(`${RECOMMEND_URL}/recommend/popular`),
};

export const analyticsApi = {
  getSellerAnalytics: () =>
    axios.get(`${ORDERS_URL}/seller/analytics`, { headers: authHeaders() }),
};

export const forecastApi = {
  getForecast: (userId: string) =>
    axios.get(`${FORECAST_URL}/forecast/${userId}`, { headers: authHeaders() }),

  train: (sellerId?: string) =>
    axios.post(`${FORECAST_URL}/forecast/train`, null, {
      params: sellerId ? { seller_id: sellerId } : {},
      headers: authHeaders(),
    }),
};