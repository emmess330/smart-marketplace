"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { productsApi, usersApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import Cookies from "js-cookie";

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  stock_quantity: number;
  category_name: string;
  is_active: boolean;
  // Seller-created products store URL strings; Kaggle-imported ones store { url }.
  images?: (string | { url: string })[];
}

function firstImageUrl(product: Product) {
  const first = product.images?.[0];
  return typeof first === "string" ? first : first?.url ?? "";
}

export default function SellerProductsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: "",
    stock_quantity: "",
    category_id: "",
    image_url: "",
  });
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [imagePreview, setImagePreview] = useState("");

  useEffect(() => {
    if (!Cookies.get("access_token")) {
      router.push("/login");
      return;
    }
    if (user?.role !== "seller") {
      router.push("/");
      return;
    }
    fetchProducts();
    fetchCategories();
  }, [user]);

  const fetchProducts = async () => {
    try {
      const res = await productsApi.getSellerProducts();
      setProducts(res.data.products);
    } catch (err) {
      console.error("Failed to fetch seller products", err);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await productsApi.categories();
      setCategories(res.data.categories);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    try {
      await productsApi.delete(id);
      fetchProducts();
    } catch (err) {
      alert("Delete failed");
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    const currentImageUrl = firstImageUrl(product);
    setFormData({
      name: product.name,
      description: product.description || "",
      price: product.price.toString(),
      stock_quantity: product.stock_quantity.toString(),
      category_id: "",
      image_url: currentImageUrl,
    });
    setImagePreview(currentImageUrl);
    setShowModal(true);
  };

  const handleCreate = () => {
    setEditingProduct(null);
    setFormData({
      name: "",
      description: "",
      price: "",
      stock_quantity: "",
      category_id: "",
      image_url: "",
    });
    setImagePreview("");
    setShowModal(true);
  };

  const handleImageUrlChange = (url: string) => {
    setFormData({ ...formData, image_url: url });
    setImagePreview(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        name: formData.name,
        description: formData.description,
        price: parseFloat(formData.price),
        stock_quantity: parseInt(formData.stock_quantity),
        category_id: formData.category_id || undefined,
        images: formData.image_url ? [formData.image_url] : [],
        tags: [],
      };
      if (editingProduct) {
        await productsApi.update(editingProduct.id, data);
      } else {
        await productsApi.create(data);
      }
      setShowModal(false);
      fetchProducts();
    } catch (err) {
      alert("Save failed");
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-black">Manage Products</h1>
        <button
          onClick={handleCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + Add Product
        </button>
      </div>

      <div className="bg-white rounded-xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-3 text-black">Image</th>
              <th className="text-left p-3 text-black">Name</th>
              <th className="text-left p-3 text-black">Price</th>
              <th className="text-left p-3 text-black">Stock</th>
              <th className="text-left p-3 text-black">Status</th>
              <th className="text-left p-3 text-black">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b hover:bg-gray-50">
                <td className="p-3">
  {(() => {
    const imgUrl = firstImageUrl(product) || `https://picsum.photos/seed/${product.id}/48/48`;
    return (
      <img
        src={imgUrl}
        alt={product.name}
        className="w-12 h-12 object-cover rounded"
      />
    );
  })()}
</td>
                <td className="p-3 text-black">{product.name}</td>
                <td className="p-3 text-black">${product.price}</td>
                <td className="p-3 text-black">{product.stock_quantity}</td>
                <td className="p-3">
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${
                      product.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {product.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="p-3 space-x-2">
                  <button
                    onClick={() => handleEdit(product)}
                    className="text-blue-600 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(product.id)}
                    className="text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal for Create/Edit */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">
              {editingProduct ? "Edit Product" : "New Product"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                placeholder="Name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full border rounded-lg p-2 text-black"
                required
              />
              <textarea
                placeholder="Description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full border rounded-lg p-2 text-black"
                rows={3}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Price"
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: e.target.value })
                }
                className="w-full border rounded-lg p-2 text-black"
                required
              />
              <input
                type="number"
                placeholder="Stock Quantity"
                value={formData.stock_quantity}
                onChange={(e) =>
                  setFormData({ ...formData, stock_quantity: e.target.value })
                }
                className="w-full border rounded-lg p-2 text-black"
                required
              />
              <select
                value={formData.category_id}
                onChange={(e) =>
                  setFormData({ ...formData, category_id: e.target.value })
                }
                className="w-full border rounded-lg p-2"
              >
                <option value="">No category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>

              {/* Image URL field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Product Image URL
                </label>
                <input
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={formData.image_url}
                  onChange={(e) => handleImageUrlChange(e.target.value)}
                  className="w-full border rounded-lg p-2 text-black"
                />
                {imagePreview && (
                  <div className="mt-2">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="w-24 h-24 object-cover rounded border"
                      onError={() => setImagePreview("")}
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="border px-4 py-2 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}