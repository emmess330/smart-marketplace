"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { searchApi } from "@/lib/api";

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  store_name: string;
  category_name: string;
  stock_quantity: number;
  score: number;
}

interface Category {
  key: string;
  doc_count: number;
}

export default function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get("category") || "");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; price: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const doSearch = useCallback(async (q: string, cat: string, min: string, max: string, pg: number) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page: pg, limit: 12 };
      if (q) params.q = q;
      if (cat) params.category = cat;
      if (min) params.min_price = Number(min);
      if (max) params.max_price = Number(max);

      const res = await searchApi.search(params);
      setProducts(res.data.products);
      setTotal(res.data.pagination.total);
      setTotalPages(res.data.pagination.pages || 1);
      if (res.data.aggregations?.categories) {
        setCategories(res.data.aggregations.categories);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q = searchParams.get("q") || "";
    const cat = searchParams.get("category") || "";
    setQuery(q);
    setSelectedCategory(cat);
    doSearch(q, cat, minPrice, maxPrice, 1);
    setPage(1);
  }, [searchParams]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (selectedCategory) params.set("category", selectedCategory);
    router.push(`/search?${params.toString()}`);
  };

  const handleSuggest = async (val: string) => {
    setQuery(val);
    if (val.length < 2) { setSuggestions([]); return; }
    const res = await searchApi.suggest(val);
    setSuggestions(res.data.suggestions);
    setShowSuggestions(true);
  };

  const handleCategoryFilter = (cat: string) => {
    const newCat = selectedCategory === cat ? "" : cat;
    setSelectedCategory(newCat);
    doSearch(query, newCat, minPrice, maxPrice, 1);
    setPage(1);
  };

  const handlePriceFilter = () => {
    doSearch(query, selectedCategory, minPrice, maxPrice, 1);
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    doSearch(query, selectedCategory, minPrice, maxPrice, newPage);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <form onSubmit={handleSearch} className="relative mb-8">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={query}
              onChange={e => handleSuggest(e.target.value)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="Search products..."
              className="w-full border border-gray-200 rounded-xl px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg z-10 mt-1">
                {suggestions.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={() => {
                      setQuery(s.name);
                      setShowSuggestions(false);
                    }}
                    className="w-full text-left px-5 py-3 text-sm hover:bg-gray-50 flex justify-between items-center"
                  >
                    <span>{s.name}</span>
                    <span className="text-blue-600 font-medium">${Number(s.price).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-blue-700"
          >
            Search
          </button>
        </div>
      </form>

      <div className="flex flex-col md:flex-row gap-8">
        <aside className="w-full md:w-56 flex-shrink-0">
          {categories.length > 0 && (
            <div className="mb-6">
              <h3 className="font-medium text-gray-900 mb-3 text-sm">Category</h3>
              <div className="space-y-2">
                {categories.map(cat => (
                  <button
                    key={cat.key}
                    onClick={() => handleCategoryFilter(cat.key)}
                    className={`w-full text-left text-sm px-3 py-2 rounded-lg flex justify-between items-center transition-colors ${
                      selectedCategory === cat.key
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span>{cat.key || "Uncategorised"}</span>
                    <span className="text-xs text-gray-400">{cat.doc_count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="font-medium text-gray-900 mb-3 text-sm">Price range</h3>
            <div className="flex gap-2 mb-2">
              <input
                type="number"
                placeholder="Min"
                value={minPrice}
                onChange={e => setMinPrice(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder="Max"
                value={maxPrice}
                onChange={e => setMaxPrice(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={handlePriceFilter}
              className="w-full border border-gray-200 text-gray-600 text-sm py-2 rounded-lg hover:bg-gray-50"
            >
              Apply
            </button>
          </div>
        </aside>

        <div className="flex-1">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">
              {loading ? "Searching..." : `${total} result${total !== 1 ? "s" : ""}${query ? ` for "${query}"` : ""}`}
            </p>
            {selectedCategory && (
              <button
                onClick={() => handleCategoryFilter(selectedCategory)}
                className="text-xs text-blue-600 hover:underline"
              >
                Clear filter: {selectedCategory}
              </button>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl overflow-hidden border border-gray-100 animate-pulse">
                  <div className="bg-gray-200 h-40" />
                  <div className="p-4 space-y-2">
                    <div className="bg-gray-200 h-4 rounded w-3/4" />
                    <div className="bg-gray-200 h-4 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-lg mb-2">No products found</p>
              <p className="text-sm">Try a different search term or remove filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map(product => (
                <Link key={product.id} href={`/products/${product.id}`}>
                  <div className="bg-white rounded-xl overflow-hidden border border-gray-100 hover:shadow-lg transition-shadow cursor-pointer group">
                    <div className="bg-gray-100 h-40 overflow-hidden">
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
                        <span className="text-blue-600 font-semibold">${Number(product.price).toFixed(2)}</span>
                        <span className="text-xs text-gray-400">{product.stock_quantity} left</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="px-4 py-2 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages}
                className="px-4 py-2 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}