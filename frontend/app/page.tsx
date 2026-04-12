import Link from "next/link";

export default function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-16">
      <div className="text-center mb-16">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Smart Marketplace
        </h1>
        <p className="text-xl text-gray-500 mb-8">
          Discover products tailored to you, powered by intelligent recommendations
        </p>
        <Link
          href="/products"
          className="bg-blue-600 text-white px-8 py-3 rounded-lg text-lg hover:bg-blue-700 inline-block"
        >
          Browse Products
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
        {[
          { title: "Smart Search", desc: "Find exactly what you need with Elasticsearch-powered search and filters" },
          { title: "Personalised Picks", desc: "ML-powered recommendations based on your browsing and purchase history" },
          { title: "Seller Analytics", desc: "Powerful dashboard with sales forecasting for marketplace sellers" },
        ].map((f) => (
          <div key={f.title} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
            <p className="text-gray-500 text-sm">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
  
}