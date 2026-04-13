import axios from "axios";
import Cookies from "js-cookie";

const AUTH_URL = "http://localhost:8001";
const PRODUCTS_URL = "http://localhost:8002";
const ORDERS_URL = "http://localhost:8003";
const USERS_URL = "http://localhost:8004";

function authHeaders() {
  const token = Cookies.get("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const authApi = {
  register: async (data: { email: string; password: string; full_name: string; role: string }) => {
    const res = await axios.post(`${AUTH_URL}/auth/register`, data);
    Cookies.set("access_token", res.data.accessToken, { expires: 1 });
    Cookies.set("refresh_token", res.data.refreshToken, { expires: 7 });
    return res;
  },

  login: async (data: { email: string; password: string }) => {
    const res = await axios.post(`${AUTH_URL}/auth/login`, data);
    Cookies.set("access_token", res.data.accessToken, { expires: 1 });
    Cookies.set("refresh_token", res.data.refreshToken, { expires: 7 });
    return res;
  },

  logout: async () => {
    const refreshToken = Cookies.get("refresh_token");
    await axios.post(`${AUTH_URL}/auth/logout`, { refreshToken });
    Cookies.remove("access_token");
    Cookies.remove("refresh_token");
  },

  me: () =>
    axios.get(`${AUTH_URL}/auth/me`, { headers: authHeaders() }),
};

export const productsApi = {
  list: (params?: { page?: number; limit?: number; category?: string }) =>
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

  checkout: (data: object) =>
    axios.post(`${ORDERS_URL}/orders/checkout`, data, { headers: authHeaders() }),

  getOrders: () =>
    axios.get(`${ORDERS_URL}/orders`, { headers: authHeaders() }),

  getOrder: (id: string) =>
    axios.get(`${ORDERS_URL}/orders/${id}`, { headers: authHeaders() }),
};

export const usersApi = {
  me: () =>
    axios.get(`${USERS_URL}/users/me`, { headers: authHeaders() }),

  updateProfile: (data: object) =>
    axios.put(`${USERS_URL}/users/me`, data, { headers: authHeaders() }),

  createSellerProfile: (data: object) =>
    axios.post(`${USERS_URL}/users/seller`, data, { headers: authHeaders() }),

  getSeller: (id: string) =>
    axios.get(`${USERS_URL}/users/sellers/${id}`),
};



const SEARCH_URL = "http://localhost:8005";

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

  index: () =>
    axios.post(`${SEARCH_URL}/search/index`),
};


const RECOMMEND_URL = "http://localhost:8006";

export const recommendApi = {
  forUser: (userId: string) =>
    axios.get(`${RECOMMEND_URL}/recommend/user/${userId}`),

  similar: (productId: string) =>
    axios.get(`${RECOMMEND_URL}/recommend/similar/${productId}`),

  popular: () =>
    axios.get(`${RECOMMEND_URL}/recommend/popular`),
};


const FORECAST_URL = "http://localhost:8007";

export const analyticsApi = {
  getSellerAnalytics: () =>
    axios.get(`${ORDERS_URL}/seller/analytics`, { headers: authHeaders() }),
};

export const forecastApi = {
  getForecast: (userId: string) =>
    axios.get(`${FORECAST_URL}/forecast/${userId}`),

  train: (sellerId?: string) =>
    axios.post(`${FORECAST_URL}/forecast/train`, null, {
      params: sellerId ? { seller_id: sellerId } : {},
    }),
};