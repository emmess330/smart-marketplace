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
      <div className="text-center mb-16">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Smart Marketplace
        </h1>
        <p className="text-xl text-gray-500 mb-8">
          Discover products tailored to you, powered by intelligent recommendations
        </p>
        <div className="flex justify-center gap-4">
          <Link
            href="/products"
            className="bg-blue-600 text-white px-8 py-3 rounded-lg text-lg hover:bg-blue-700 inline-block"
          >
            Browse Products
          </Link>
          <Link
            href="/search"
            className="border border-gray-200 text-gray-700 px-8 py-3 rounded-lg text-lg hover:bg-gray-50 inline-block"
          >
            Search
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {[
          { title: "Smart Search", desc: "Elasticsearch-powered search with fuzzy matching and filters" },
          { title: "Personalised Picks", desc: "ML recommendations based on your purchase history" },
          { title: "Seller Analytics", desc: "Dashboard with sales forecasting for marketplace sellers" },
        ].map((f) => (
          <div key={f.title} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
            <p className="text-gray-500 text-sm">{f.desc}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          {user ? "Recommended for you" : "Featured products"}
        </h2>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 animate-pulse">
                <div className="bg-gray-200 h-40 rounded-lg mb-4" />
                <div className="bg-gray-200 h-4 rounded mb-2" />
                <div className="bg-gray-200 h-4 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {recommended.map(product => (
              <Link key={product.id} href={`/products/${product.id}`}>
                <div className="bg-white rounded-xl p-4 border border-gray-100 hover:shadow-md transition-shadow cursor-pointer">
                  <div className="bg-gray-100 h-40 rounded-lg mb-4 flex items-center justify-center text-gray-400 text-sm">
                    No image
                  </div>
                  <h3 className="font-medium text-gray-900 truncate">{product.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">{product.store_name}</p>
                  {product.category_name && (
                    <span className="inline-block text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full mt-1">
                      {product.category_name}
                    </span>
                  )}
                  <div className="flex justify-between items-center mt-3">
                    <span className="text-blue-600 font-semibold">
                      ${Number(product.price).toFixed(2)}
                    </span>
                    <span className="text-xs text-gray-400">{product.stock_quantity} left</span>
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