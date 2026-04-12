"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ordersApi } from "@/lib/api";
import Cookies from "js-cookie";

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  items: OrderItem[];
}

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!Cookies.get("access_token")) {
      router.push("/login");
      return;
    }
    ordersApi.getOrders()
      .then(res => setOrders(res.data.orders))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="max-w-3xl mx-auto px-4 py-8 text-gray-500">Loading orders...</div>
  );

  if (orders.length === 0) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">
      No orders yet.
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Your orders</h1>

      <div className="space-y-4">
        {orders.map(order => (
          <div key={order.id} className="bg-white rounded-xl border border-gray-100 p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-xs text-gray-400 font-mono">{order.id}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {new Date(order.created_at).toLocaleDateString("en-GB", {
                    day: "numeric", month: "long", year: "numeric"
                  })}
                </p>
              </div>
              <div className="text-right">
                <span className={`inline-block text-xs px-3 py-1 rounded-full font-medium ${
                  order.status === "confirmed"
                    ? "bg-green-50 text-green-700"
                    : "bg-gray-100 text-gray-600"
                }`}>
                  {order.status}
                </span>
                <p className="text-lg font-bold text-gray-900 mt-1">
                  ${Number(order.total_amount).toFixed(2)}
                </p>
              </div>
            </div>

            <div className="border-t border-gray-50 pt-4 space-y-2">
              {order.items?.map((item, i) => (
                <div key={i} className="flex justify-between text-sm text-gray-600">
                  <span>{item.name} × {item.quantity}</span>
                  <span>${(Number(item.price) * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}