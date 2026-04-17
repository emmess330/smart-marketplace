"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthStore, useCartStore } from "@/lib/store";
import { authApi } from "@/lib/api";
import Cookies from "js-cookie";

export default function Navbar() {
  const { user, setUser, setLoading, logout } = useAuthStore();
  const { itemCount } = useCartStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    setMobileMenuOpen(false);
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="text-xl font-bold text-blue-600">
            SmartMarket
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.target as HTMLFormElement).querySelector("input");
                if (input?.value) {
                  window.location.href = `/search?q=${encodeURIComponent(input.value)}`;
                }
              }}
              className="flex-1 max-w-md"
            >
              <input
                type="text"
                placeholder="Search products..."
                className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </form>

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
                  <>
                    <Link href="/seller/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
                      Dashboard
                    </Link>
                    <Link href="/seller/products" className="text-sm text-gray-600 hover:text-gray-900">
                      My Products
                    </Link>
                  </>
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

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-gray-100 space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.target as HTMLFormElement).querySelector("input");
                if (input?.value) {
                  window.location.href = `/search?q=${encodeURIComponent(input.value)}`;
                  setMobileMenuOpen(false);
                }
              }}
              className="mb-3"
            >
              <input
                type="text"
                placeholder="Search products..."
                className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </form>

            <Link href="/products" className="block text-gray-600 hover:text-gray-900 text-sm py-1" onClick={() => setMobileMenuOpen(false)}>
              Browse
            </Link>
            <Link href="/cart" className="block text-gray-600 hover:text-gray-900 text-sm py-1" onClick={() => setMobileMenuOpen(false)}>
              Cart {itemCount > 0 && `(${itemCount})`}
            </Link>

            {user ? (
              <>
                {user.role === "seller" && (
                  <>
                    <Link href="/seller/dashboard" className="block text-gray-600 hover:text-gray-900 text-sm py-1" onClick={() => setMobileMenuOpen(false)}>
                      Dashboard
                    </Link>
                    <Link href="/seller/products" className="block text-gray-600 hover:text-gray-900 text-sm py-1" onClick={() => setMobileMenuOpen(false)}>
                      My Products
                    </Link>
                  </>
                )}
                <Link href="/orders" className="block text-gray-600 hover:text-gray-900 text-sm py-1" onClick={() => setMobileMenuOpen(false)}>
                  Orders
                </Link>
                <span className="block text-gray-600 text-sm py-1">{user.full_name}</span>
                <button onClick={handleLogout} className="block text-red-500 hover:text-red-700 text-sm py-1">
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="block text-gray-600 hover:text-gray-900 text-sm py-1" onClick={() => setMobileMenuOpen(false)}>
                  Login
                </Link>
                <Link href="/register" className="block bg-blue-600 text-white text-sm px-4 py-2 rounded-lg text-center" onClick={() => setMobileMenuOpen(false)}>
                  Sign up
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}