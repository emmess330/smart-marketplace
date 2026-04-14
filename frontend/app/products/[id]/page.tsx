"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { productsApi, ordersApi, recommendApi } from "@/lib/api";
import { useAuthStore, useCartStore } from "@/lib/store";
import Cookies from "js-cookie";

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  store_name: string;
  category_name: string;
  stock_quantity: number;
  tags: string[];
}

interface SimilarProduct {
  id: string;
  name: string;
  price: number;
  store_name: string;
  category_name: string;
  stock_quantity: number;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { increment } = useCartStore();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [similar, setSimilar] = useState<SimilarProduct[]>([]);

  useEffect(() => {
    productsApi.get(id)
      .then(res => setProduct(res.data.product))
      .finally(() => setLoading(false));

    recommendApi.similar(id)
      .then(res => setSimilar(res.data.similar))
      .catch(() => setSimilar([]));
  }, [id]);

  const handleAddToCart = async () => {
    if (!Cookies.get("access_token")) {
      router.push("/login");
      return;
    }
    setAdding(true);
    try {
      await ordersApi.addToCart(id, quantity);
      increment();
      setMessage("Added to cart!");
      setTimeout(() => setMessage(""), 3000);
    } catch {
      setMessage("Failed to add to cart.");
    } finally {
      setAdding(false);
    }
  };

  if (loading) return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-gray-200 h-96 rounded-xl" />
        <div className="space-y-4">
          <div className="bg-gray-200 h-8 rounded w-3/4" />
          <div className="bg-gray-200 h-6 rounded w-1/4" />
          <div className="bg-gray-200 h-24 rounded" />
        </div>
      </div>
    </div>
  );

  if (!product) return (
    <div className="max-w-5xl mx-auto px-4 py-16 text-center text-gray-500">
      Product not found.
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <button
        onClick={() => router.back()}
        className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block"
      >
        ← Back
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-gray-100 rounded-xl overflow-hidden">
          <img
            src={`https://picsum.photos/seed/${product.id}/600/400`}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        </div>

        <div>
          <p className="text-sm text-gray-500 mb-1">{product.store_name}</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{product.name}</h1>

          {product.category_name && (
            <span className="inline-block bg-blue-50 text-blue-700 text-xs px-3 py-1 rounded-full mb-4">
              {product.category_name}
            </span>
          )}

          <p className="text-3xl font-bold text-blue-600 mb-4">
            ${Number(product.price).toFixed(2)}
          </p>

          <p className="text-gray-600 mb-6 leading-relaxed">
            {product.description || "No description provided."}
          </p>

          <p className="text-sm text-gray-500 mb-4">
            {product.stock_quantity > 0
              ? `${product.stock_quantity} in stock`
              : <span className="text-red-500">Out of stock</span>
            }
          </p>

          {product.stock_quantity > 0 && (
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center border border-gray-200 rounded-lg">
                <button
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-l-lg"
                >
                  -
                </button>
                <span className="px-4 py-2 text-sm font-medium">{quantity}</span>
                <button
                  onClick={() => setQuantity(q => Math.min(product.stock_quantity, q + 1))}
                  className="px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-r-lg"
                >
                  +
                </button>
              </div>

              <button
                onClick={handleAddToCart}
                disabled={adding}
                className="flex-1 bg-blue-600 text-white py-2 px-6 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {adding ? "Adding..." : "Add to Cart"}
              </button>
            </div>
          )}

          {message && (
            <p className={`text-sm mt-2 ${message.includes("Failed") ? "text-red-500" : "text-green-600"}`}>
              {message}
            </p>
          )}

          {product.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {product.tags.map((tag: string) => (
                <span key={tag} className="bg-gray-100 text-gray-600 text-xs px-3 py-1 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {similar.length > 0 && (
        <div className="mt-16">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Similar products</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {similar.map(p => (
              <Link key={p.id} href={`/products/${p.id}`}>
                <div className="bg-white rounded-xl overflow-hidden border border-gray-100 hover:shadow-md transition-shadow cursor-pointer group">
                  <div className="bg-gray-100 h-36 overflow-hidden">
                    <img
                      src={`https://picsum.photos/seed/${p.id}/300/200`}
                      alt={p.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="p-3">
                    <h3 className="font-medium text-gray-900 truncate text-sm">{p.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{p.store_name}</p>
                    <p className="text-blue-600 font-semibold mt-2">
                      ${Number(p.price).toFixed(2)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}