"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ordersApi } from "@/lib/api";
import { useCartStore } from "@/lib/store";
import Cookies from "js-cookie";

interface CartItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  store_name: string;
  stock_quantity: number;
  images?: (string | { url: string })[];
}

function getImageUrl(item: CartItem): string | null {
  if (item.images && item.images.length > 0) {
    const first = item.images[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "url" in first) return first.url;
  }
  return null;
}

export default function CartPage() {
  const router = useRouter();
  const { setItemCount } = useCartStore();
  const [items, setItems] = useState<CartItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const handleUnauthorized = () => {
    Cookies.remove("access_token");
    Cookies.remove("refresh_token");
    setItemCount(0);
    router.push("/login");
  };

  useEffect(() => {
    if (!Cookies.get("access_token")) {
      router.push("/login");
      return;
    }
    fetchCart();
  }, []);

  const fetchCart = async () => {
    try {
      setError("");
      const res = await ordersApi.getCart();
      setItems(res.data.items);
      setTotal(res.data.total);
      setItemCount(res.data.item_count);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError("Failed to load your cart. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      setError("");
      await ordersApi.removeFromCart(id);
      await fetchCart();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      setError("Failed to remove item. Please try again.");
    }
  };

  const handleQuantityChange = async (id: string, quantity: number) => {
    if (quantity < 1) return;
    try {
      setError("");
      await ordersApi.updateCartItem(id, quantity);
      await fetchCart();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = axios.isAxiosError(err)
        ? err.response?.data as { error?: string } | undefined
        : undefined;
      setError(data?.error || "Failed to update item quantity. Please try again.");
    }
  };

  const handleCheckout = () => {
    router.push("/checkout");
  };

  if (loading) return (
    <div className="max-w-3xl mx-auto px-4 py-8 text-gray-500">Loading cart...</div>
  );

  if (items.length === 0) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <p className="text-gray-500 mb-4">Your cart is empty.</p>
      <Link href="/products" className="text-blue-600 hover:underline text-sm">
        Browse products
      </Link>
    </div>
  );

  const hasStockIssue = items.some(item => item.quantity > item.stock_quantity);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Your cart</h1>

      {error && (
        <p className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </p>
      )}

      <div className="space-y-4 mb-8">
        {items.map(item => {
          const imageUrl = getImageUrl(item);
          return (
            <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="bg-gray-100 rounded-lg w-16 h-16 flex items-center justify-center text-gray-400 text-xs flex-shrink-0">
                {imageUrl ? (
                  <img src={imageUrl} alt={item.name} className="w-full h-full object-cover rounded-lg" />
                ) : (
                  'Img'
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{item.name}</p>
                <p className="text-sm text-gray-500">{item.store_name}</p>
                <p className={`text-xs mt-1 ${item.quantity > item.stock_quantity ? "text-red-500" : "text-gray-400"}`}>
                  {item.stock_quantity > 0 ? `${item.stock_quantity} in stock` : "Out of stock"}
                </p>
                <p className="text-blue-600 font-semibold text-sm mt-1">
                  ${Number(item.price).toFixed(2)}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center border border-gray-200 rounded-lg">
                  <button
                    onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                    className="px-2 py-1 text-gray-600 hover:bg-gray-50 rounded-l-lg text-sm"
                  >
                    -
                  </button>
                  <span className="px-3 py-1 text-sm">{item.quantity}</span>
                  <button
                    onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                    disabled={item.quantity >= item.stock_quantity}
                    className="px-2 py-1 text-gray-600 hover:bg-gray-50 rounded-r-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>

                <p className="font-semibold text-gray-900 w-20 text-right">
                  ${(Number(item.price) * item.quantity).toFixed(2)}
                </p>

                <button
                  onClick={() => handleRemove(item.id)}
                  className="text-red-400 hover:text-red-600 text-sm"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex justify-between items-center mb-4">
          <span className="text-gray-600">Total</span>
          <span className="text-2xl font-bold text-gray-900">${Number(total).toFixed(2)}</span>
        </div>
        <button
          onClick={handleCheckout}
          disabled={hasStockIssue}
          className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Proceed to Checkout
        </button>
        {hasStockIssue && (
          <p className="text-sm text-red-500 text-center mt-3">
            Reduce item quantities to match available stock before checkout.
          </p>
        )}
      </div>
    </div>
  );
}