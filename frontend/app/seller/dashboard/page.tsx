"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { analyticsApi, forecastApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import Cookies from "js-cookie";

interface Overview {
  total_orders: number;
  total_revenue: number;
  total_units_sold: number;
}

interface DailyRevenue {
  date: string;
  revenue: number;
  orders: number;
}

interface TopProduct {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
  units_sold: number;
  revenue: number;
}

interface LowStock {
  id: string;
  name: string;
  stock_quantity: number;
}

interface ForecastPoint {
  date: string;
  predicted: number;
  lower: number;
  upper: number;
}

interface HistoricalPoint {
  date: string;
  actual: number;
}

export default function SellerDashboard() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dailyRevenue, setDailyRevenue] = useState<DailyRevenue[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [lowStock, setLowStock] = useState<LowStock[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [forecastMethod, setForecastMethod] = useState("");
  const [loading, setLoading] = useState(true);
  const [forecastLoading, setForecastLoading] = useState(true);

  useEffect(() => {
    if (!Cookies.get("access_token")) {
      router.push("/login");
      return;
    }

    analyticsApi.getSellerAnalytics()
      .then(res => {
        setOverview(res.data.overview);
        setDailyRevenue(res.data.daily_revenue);
        setTopProducts(res.data.top_products);
        setLowStock(res.data.low_stock);
      })
      .catch(() => router.push("/"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    forecastApi.getForecast(user.id)
      .then(res => {
        setForecast(res.data.forecast);
        setHistorical(res.data.historical);
        setForecastMethod(res.data.method);
      })
      .catch(() => {})
      .finally(() => setForecastLoading(false));
  }, [user]);

  const revenueChartMax = Math.max(
    ...dailyRevenue.map(d => Number(d.revenue)),
    1
  );
  const forecastValues = [
    ...forecast.flatMap(f => [f.predicted, f.lower, f.upper]),
    ...historical.map(h => h.actual),
  ].filter(value => Number.isFinite(value));
  const rawForecastMin = forecastValues.length ? Math.min(...forecastValues) : 0;
  const rawForecastMax = forecastValues.length ? Math.max(...forecastValues) : 1;
  const forecastPadding = Math.max(
    (rawForecastMax - rawForecastMin) * 0.15,
    rawForecastMax * 0.05,
    1
  );
  const forecastDomainMin = Math.max(0, rawForecastMin - forecastPadding);
  const forecastDomainMax = rawForecastMax + forecastPadding;
  const forecastRange = Math.max(forecastDomainMax - forecastDomainMin, 1);
  const chartStep = 12;
  const historicalWidth = historical.length > 0 ? historical.length * chartStep : 0;
  const forecastChartWidth = Math.max(
    (historical.length + forecast.length - 1) * chartStep,
    chartStep
  );
  const forecastX = (index: number) => historicalWidth + index * chartStep;
  const forecastY = (value: number) =>
    95 - ((value - forecastDomainMin) / forecastRange) * 85;

  if (loading) return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="animate-pulse space-y-6">
        <div className="grid grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-gray-200 h-24 rounded-xl" />
          ))}
        </div>
        <div className="bg-gray-200 h-64 rounded-xl" />
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Seller Dashboard</h1>

      {/* Overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <p className="text-sm text-gray-500 mb-1">Total revenue</p>
          <p className="text-3xl font-bold text-gray-900">
            ${Number(overview?.total_revenue || 0).toFixed(2)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <p className="text-sm text-gray-500 mb-1">Total orders</p>
          <p className="text-3xl font-bold text-gray-900">
            {overview?.total_orders || 0}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <p className="text-sm text-gray-500 mb-1">Units sold</p>
          <p className="text-3xl font-bold text-gray-900">
            {overview?.total_units_sold || 0}
          </p>
        </div>
      </div>

      {/* Revenue chart — last 30 days */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-8">
        <h2 className="font-semibold text-gray-900 mb-4">Revenue — last 30 days</h2>
        {dailyRevenue.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No sales data yet</p>
        ) : (
          <div className="flex items-end gap-1 h-40">
            {dailyRevenue.map((day, i) => {
              const height = revenueChartMax > 0
                ? (Number(day.revenue) / revenueChartMax) * 100
                : 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div
                    className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors"
                    style={{ height: `${Math.max(height, 2)}%` }}
                  />
                  <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                    {day.date}: ${Number(day.revenue).toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Forecast chart */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="font-semibold text-gray-900">Sales forecast — next 30 days</h2>
            {forecastMethod && (
              <p className="text-xs text-gray-400 mt-0.5">
                Method: {forecastMethod === "prophet" ? "Facebook Prophet" : forecastMethod === "linear_trend" ? "Linear trend" : forecastMethod}
              </p>
            )}
          </div>
          <button
            onClick={async () => {
              setForecastLoading(true);
              try {
                await forecastApi.train();
                const res = await forecastApi.getForecast(user!.id);
                setForecast(res.data.forecast);
                setHistorical(res.data.historical);
                setForecastMethod(res.data.method);
              } finally {
                setForecastLoading(false);
              }
            }}
            className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 text-gray-600"
          >
            Retrain
          </button>
        </div>

        {forecastLoading ? (
          <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
            Loading forecast...
          </div>
        ) : forecast.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No forecast available</p>
        ) : (
          <div className="relative h-48">
            <svg width="100%" height="100%" viewBox={`0 0 ${forecastChartWidth} 100`} preserveAspectRatio="none">
              {/* Confidence band */}
              <path
                d={[
                  `M ${forecastX(0)} ${forecastY(forecast[0].upper)}`,
                  ...forecast.map((f, i) => `L ${forecastX(i)} ${forecastY(f.upper)}`),
                  ...forecast.slice().reverse().map((f, i) => `L ${forecastX(forecast.length - 1 - i)} ${forecastY(f.lower)}`),
                  "Z"
                ].join(" ")}
                fill="#DBEAFE"
                opacity="0.6"
              />
              {historical.length > 0 && (
                <line
                  x1={historicalWidth}
                  y1="5"
                  x2={historicalWidth}
                  y2="95"
                  stroke="#E5E7EB"
                  strokeWidth="1"
                />
              )}
              {/* Forecast line */}
              <polyline
                points={forecast.map((f, i) => `${forecastX(i)},${forecastY(f.predicted)}`).join(" ")}
                fill="none"
                stroke="#3B82F6"
                strokeWidth="1.5"
              />
              {/* Historical line */}
              {historical.length > 0 && (
                <polyline
                  points={historical.map((h, i) => `${i * 12},${forecastY(h.actual)}`).join(" ")}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                />
              )}
            </svg>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-4 h-0.5 bg-blue-500 inline-block" /> Forecast
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-0.5 bg-green-500 inline-block border-dashed" /> Historical
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-2 bg-blue-100 inline-block" /> Confidence interval
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top products */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Top products</h2>
          {topProducts.length === 0 ? (
            <p className="text-gray-400 text-sm">No products yet</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map(product => (
                <div key={product.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900 truncate max-w-[200px]">{product.name}</p>
                    <p className="text-xs text-gray-400">{product.units_sold} units sold</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">${Number(product.revenue).toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{product.stock_quantity} in stock</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Low stock alerts */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Low stock alerts</h2>
          {lowStock.length === 0 ? (
            <p className="text-gray-400 text-sm">All products are well stocked</p>
          ) : (
            <div className="space-y-3">
              {lowStock.map(product => (
                <div key={product.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                  <p className="text-sm text-gray-900">{product.name}</p>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                    product.stock_quantity === 0
                      ? "bg-red-50 text-red-600"
                      : "bg-amber-50 text-amber-600"
                  }`}>
                    {product.stock_quantity === 0 ? "Out of stock" : `${product.stock_quantity} left`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}