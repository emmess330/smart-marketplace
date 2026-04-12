"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useAuthStore, useCartStore } from "@/lib/store";
import { authApi } from "@/lib/api";
import Cookies from "js-cookie";

export default function Navbar() {
  const { user, setUser, setLoading, logout } = useAuthStore();
  const { itemCount } = useCartStore();

  useEffect(() => {
    const token = Cookies.get("access_token");
    if (token) {
      authApi.me()
        .then(res => setUser(res.data.user))
        .catch(() => setUser(null));
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogout = async () => {
    await authApi.logout();
    logout();
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="text-xl font-bold text-blue-600">
            SmartMarket
          </Link>

          <div className="flex items-center gap-6">
            <Link href="/products" className="text-gray-600 hover:text-gray-900 text-sm">
              Browse
            </Link>

            <Link href="/cart" className="relative text-gray-600 hover:text-gray-900 text-sm">
              Cart
              {itemCount > 0 && (
                <span className="absolute -top-2 -right-3 bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </Link>

            {user ? (
              <div className="flex items-center gap-4">
                {user.role === "seller" && (
                  <Link href="/seller/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
                    Dashboard
                  </Link>
                )}
                <Link href="/orders" className="text-sm text-gray-600 hover:text-gray-900">
                  Orders
                </Link>
                <span className="text-sm text-gray-600">{user.full_name}</span>
                <button
                  onClick={handleLogout}
                  className="text-sm text-red-500 hover:text-red-700"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">
                  Login
                </Link>
                <Link
                  href="/register"
                  className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}