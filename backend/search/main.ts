import { Hono } from "hono/mod.ts";
import { corsConfig } from "../shared/cors.ts";
import { query } from "../shared/db.ts";

const app = new Hono();
app.use("*", corsConfig);

const ES_URL = Deno.env.get("ES_HOST") || "http://localhost:9200";
const INDEX = "products";

async function esRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${ES_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return { status: res.status };
  }
  const text = await res.text();
  if (!text) return { status: res.status };
  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status };
  }
}

async function createIndex() {
  try {
    const res = await fetch(`${ES_URL}/${INDEX}`);
    if (res.status === 404) {
      await esRequest("PUT", `/${INDEX}`, {
        mappings: {
          properties: {
            id: { type: "keyword" },
            name: { type: "text", analyzer: "english" },
            description: { type: "text", analyzer: "english" },
            price: { type: "float" },
            stock_quantity: { type: "integer" },
            category_name: { type: "keyword" },
            store_name: { type: "keyword" },
            seller_id: { type: "keyword" },
            tags: { type: "keyword" },
            is_active: { type: "boolean" },
            created_at: { type: "date" },
          },
        },
      });
      console.log("Index created");
    } else {
      console.log("Index already exists");
    }
  } catch (err) {
    console.error("Error creating index:", err);
  }
}

// POST /search/index — index all products from PostgreSQL into ES
app.post("/search/index", async (c) => {
  try {
    const result = await query(
      `SELECT p.id, p.name, p.description, p.price, p.stock_quantity,
              p.tags, p.is_active, p.created_at, p.seller_id,
              s.store_name, c.name as category_name
       FROM products p
       LEFT JOIN sellers s ON p.seller_id = s.id
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true`
    );

    if (result.rows.length === 0) {
      return c.json({ message: "No products to index" });
    }

    // Bulk index
    const bulkBody = result.rows.flatMap((row) => {
      const product = row as Record<string, unknown>;
      return [
        { index: { _index: INDEX, _id: product.id } },
        {
          id: product.id,
          name: product.name,
          description: product.description || "",
          price: Number(product.price),
          stock_quantity: Number(product.stock_quantity),
          category_name: product.category_name || "",
          store_name: product.store_name || "",
          seller_id: product.seller_id,
          tags: product.tags || [],
          is_active: product.is_active,
          created_at: product.created_at,
        },
      ];
    });

    const bulkResult = await esRequest("POST", "/_bulk", 
      bulkBody.map(l => JSON.stringify(l)).join("\n") + "\n"
    );

    return c.json({
      message: `Indexed ${result.rows.length} products`,
      errors: bulkResult.errors,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Indexing failed" }, 500);
  }
});

// GET /search?q=&category=&min_price=&max_price=&page=&limit=
app.get("/search", async (c) => {
  try {
    const q = c.req.query("q") || "";
    const category = c.req.query("category") || "";
    const minPrice = Number(c.req.query("min_price") || 0);
    const maxPrice = Number(c.req.query("max_price") || 999999);
    const page = Number(c.req.query("page") || 1);
    const limit = Number(c.req.query("limit") || 12);
    const from = (page - 1) * limit;

    const must: unknown[] = [
      { term: { is_active: true } },
      { range: { price: { gte: minPrice, lte: maxPrice } } },
    ];

    if (q) {
      must.push({
        multi_match: {
          query: q,
          fields: ["name^3", "description", "tags^2"],
          fuzziness: "AUTO",
        },
      });
    }

    if (category) {
      must.push({ term: { category_name: category } });
    }

    const esQuery = {
      from,
      size: limit,
      query: { bool: { must } },
      sort: q ? ["_score"] : [{ created_at: "desc" }],
      aggs: {
        categories: {
          terms: { field: "category_name", size: 20 },
        },
        price_stats: {
          stats: { field: "price" },
        },
      },
    };

    const result = await esRequest("POST", `/${INDEX}/_search`, esQuery);

    const hits = result.hits?.hits || [];
    const total = result.hits?.total?.value || 0;

    return c.json({
      products: hits.map((h: Record<string, unknown>) => ({
        ...(h._source as Record<string, unknown>),
        score: h._score,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      aggregations: {
        categories: result.aggregations?.categories?.buckets || [],
        price_stats: result.aggregations?.price_stats || {},
      },
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Search failed" }, 500);
  }
});

// GET /search/suggest?q= — autocomplete
app.get("/search/suggest", async (c) => {
  try {
    const q = c.req.query("q") || "";
    if (!q) return c.json({ suggestions: [] });

    const result = await esRequest("POST", `/${INDEX}/_search`, {
      size: 5,
      query: {
        multi_match: {
          query: q,
          fields: ["name^3", "tags"],
          type: "phrase_prefix",
        },
      },
      _source: ["id", "name", "price"],
    });

    const suggestions = (result.hits?.hits || []).map(
      (h: Record<string, unknown>) => h._source
    );

    return c.json({ suggestions });
  } catch (err) {
    console.error(err);
    return c.json({ suggestions: [] });
  }
});

await createIndex();
console.log("Search service running on http://localhost:8005");
Deno.serve({ port: 8005 }, app.fetch);