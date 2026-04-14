"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { recommendApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

interface Product {
  id: string;
  name: string;
  price: number;
  store_name: string;
  category_name: string;
  stock_quantity: number;
}

export default function HomePage() {
  const { user } = useAuthStore();
  const [recommended, setRecommended] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        let res;
        if (user) {
          res = await recommendApi.forUser(user.id);
          setRecommended(res.data.recommendations);
        } else {
          res = await recommendApi.popular();
          setRecommended(res.data.recommendations);
        }
      } catch {
        setRecommended([]);
      } finally {
        setLoading(false);
      }
    };
    fetchRecommendations();
  }, [user]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl text-white p-8 mb-16 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Smart Marketplace</h1>
        <p className="text-lg md:text-xl text-blue-100 mb-6">
          Discover products tailored to you, powered by intelligent recommendations
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link
            href="/products"
            className="bg-white text-blue-600 px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition"
          >
            Browse Products
          </Link>
          <Link
            href="/search"
            className="border border-white text-white px-6 py-3 rounded-lg font-medium hover:bg-white/10 transition"
          >
            Search
          </Link>
        </div>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {[
          { title: "Smart Search", desc: "Elasticsearch-powered search with fuzzy matching and filters", icon: "🔍" },
          { title: "Personalised Picks", desc: "ML recommendations based on your purchase history", icon: "🎯" },
          { title: "Seller Analytics", desc: "Dashboard with sales forecasting for marketplace sellers", icon: "📊" },
        ].map((f) => (
          <div key={f.title} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm text-center">
            <div className="text-3xl mb-2">{f.icon}</div>
            <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
            <p className="text-gray-500 text-sm">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Recommended products */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          {user ? "Recommended for you" : "Featured products"}
        </h2>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 animate-pulse">
                <div className="bg-gray-200 h-48 rounded-lg mb-4" />
                <div className="bg-gray-200 h-4 rounded mb-2" />
                <div className="bg-gray-200 h-4 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {recommended.map(product => (
              <Link key={product.id} href={`/products/${product.id}`}>
                <div className="bg-white rounded-xl overflow-hidden border border-gray-100 hover:shadow-lg transition-shadow cursor-pointer group">
                  <div className="bg-gray-100 h-48 overflow-hidden">
                    <img
                      src={`https://picsum.photos/seed/${product.id}/400/300`}
                      alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="p-4">
                    <h3 className="font-medium text-gray-900 truncate">{product.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{product.store_name}</p>
                    {product.category_name && (
                      <span className="inline-block text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full mt-1">
                        {product.category_name}
                      </span>
                    )}
                    <div className="flex justify-between items-center mt-3">
                      <span className="text-blue-600 font-semibold text-lg">
                        ${Number(product.price).toFixed(2)}
                      </span>
                      <span className="text-xs text-gray-400">{product.stock_quantity} left</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}