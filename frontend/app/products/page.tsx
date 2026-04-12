"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { productsApi } from "@/lib/api";

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  store_name: string;
  category_name: string;
  stock_quantity: number;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    setLoading(true);
    productsApi.list({ page, limit: 12 })
      .then(res => {
        setProducts(res.data.products);
        setTotalPages(res.data.pagination.pages || 1);
      })
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 animate-pulse">
            <div className="bg-gray-200 h-48 rounded-lg mb-4" />
            <div className="bg-gray-200 h-4 rounded mb-2" />
            <div className="bg-gray-200 h-4 rounded w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">All Products</h1>

      {products.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          No products yet. Be the first to list one!
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.map(product => (
            <Link key={product.id} href={`/products/${product.id}`}>
              <div className="bg-white rounded-xl p-4 border border-gray-100 hover:shadow-md transition-shadow cursor-pointer">
                <div className="bg-gray-100 h-48 rounded-lg mb-4 flex items-center justify-center text-gray-400 text-sm">
                  No image
                </div>
                <h3 className="font-medium text-gray-900 truncate">{product.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{product.store_name}</p>
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

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}