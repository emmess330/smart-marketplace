"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
}

export default function CartPage() {
  const router = useRouter();
  const { setItemCount } = useCartStore();
  const [items, setItems] = useState<CartItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!Cookies.get("access_token")) {
      router.push("/login");
      return;
    }
    fetchCart();
  }, []);

  const fetchCart = async () => {
    try {
      const res = await ordersApi.getCart();
      setItems(res.data.items);
      setTotal(res.data.total);
      setItemCount(res.data.item_count);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    await ordersApi.removeFromCart(id);
    fetchCart();
  };

  const handleQuantityChange = async (id: string, quantity: number) => {
    if (quantity < 1) return;
    await ordersApi.updateCartItem(id, quantity);
    fetchCart();
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Your cart</h1>

      <div className="space-y-4 mb-8">
        {items.map(item => (
          <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-4">
            <div className="bg-gray-100 rounded-lg w-16 h-16 flex items-center justify-center text-gray-400 text-xs flex-shrink-0">
              Img
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{item.name}</p>
              <p className="text-sm text-gray-500">{item.store_name}</p>
              <p className="text-blue-600 font-semibold text-sm mt-1">
                ${Number(item.price).toFixed(2)}
              </p>
            </div>

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
                className="px-2 py-1 text-gray-600 hover:bg-gray-50 rounded-r-lg text-sm"
              >
                +
              </button>
            </div>

            <p className="font-semibold text-gray-900 w-20 text-right">
              ${(Number(item.price) * item.quantity).toFixed(2)}
            </p>

            <button
              onClick={() => handleRemove(item.id)}
              className="text-red-400 hover:text-red-600 text-sm ml-2"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex justify-between items-center mb-4">
          <span className="text-gray-600">Total</span>
          <span className="text-2xl font-bold text-gray-900">${Number(total).toFixed(2)}</span>
        </div>
        <button
          onClick={handleCheckout}
          className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-medium"
        >
          Proceed to Checkout
        </button>
      </div>
    </div>
  );
}