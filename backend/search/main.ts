import { Hono } from "hono/mod.ts";
import { corsConfig } from "../shared/cors.ts";
import { query } from "../shared/db.ts";
import { paginationSchema } from "../shared/validation.ts";
import { imageUrls } from "../shared/productImages.ts";
import { z } from "zod";

const app = new Hono();
app.use("*", corsConfig);

const ES_URL = Deno.env.get("ES_HOST") || "http://localhost:9200";
const INDEX = Deno.env.get("ES_INDEX") ?? "products";

async function esRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${ES_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body
      ? (typeof body === "string" ? body : JSON.stringify(body))
      : undefined,
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
            // Returned with results for display; never searched.
            images: { type: "keyword", index: false },
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

async function sha256(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

// Compares digests so the check takes the same time however much of the key
// matches.
async function isValidAdminKey(provided: string | undefined) {
  const expected = Deno.env.get("ADMIN_KEY");
  if (!expected || !provided) return false;
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

// POST /search/index — index all products from PostgreSQL into ES.
// Operator-only: it drops and rebuilds the index, so it requires the
// X-Admin-Key header to match ADMIN_KEY in backend/.env.
app.post("/search/index", async (c) => {
  if (!Deno.env.get("ADMIN_KEY")) {
    return c.json({ error: "Reindexing disabled: set ADMIN_KEY in backend/.env" }, 503);
  }
  if (!(await isValidAdminKey(c.req.header("X-Admin-Key")))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const result = await query(
      `SELECT p.id, p.name, p.description, p.price, p.stock_quantity,
              p.tags, p.images, p.is_active, p.created_at, p.seller_id,
              s.store_name, c.name as category_name
       FROM products p
       LEFT JOIN sellers s ON p.seller_id = s.id
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true`,
    );

    if (result.rows.length === 0) {
      await esRequest("DELETE", `/${INDEX}`);
      await createIndex();
      return c.json({ message: "No products to index" });
    }

    await esRequest("DELETE", `/${INDEX}`);
    await createIndex();

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
          images: imageUrls(product.images),
          is_active: product.is_active,
          created_at: product.created_at,
        },
      ];
    });

    const bulkResult = await esRequest(
      "POST",
      "/_bulk",
      bulkBody.map((l) => JSON.stringify(l)).join("\n") + "\n",
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

// Runs the exact/prefix query first and retries with typo tolerance only if
// that finds nothing, so fuzzy noise never mixes with real matches. (This
// replaced a fixed min_score floor: scores shift with index size — an exact
// one-word match scored between 13 and 16 across indexes — so the floor
// hid real matches as well as noise.)
async function searchWithFuzzyFallback(
  q: string,
  build: (fuzzyClause?: unknown) => Record<string, unknown>,
  fuzzyClause: unknown,
) {
  const precise = await esRequest("POST", `/${INDEX}/_search`, build());
  if (q.length < 4 || (precise.hits?.total?.value ?? 0) > 0) return precise;
  return await esRequest("POST", `/${INDEX}/_search`, build(fuzzyClause));
}

// Elasticsearch's default index.max_result_window: from + size beyond this fails.
const MAX_RESULT_WINDOW = 10_000;

const searchQuerySchema = paginationSchema(12)
  .extend({
    q: z.string().trim().default(""),
    category: z.string().default(""),
    min_price: z.coerce.number().min(0).default(0),
    max_price: z.coerce.number().min(0).default(999999),
  })
  .refine((d) => d.min_price <= d.max_price, {
    message: "min_price must not exceed max_price",
    path: ["min_price"],
  })
  .refine((d) => d.page * d.limit <= MAX_RESULT_WINDOW, {
    message: `Only the first ${MAX_RESULT_WINDOW} results can be paged through`,
    path: ["page"],
  });

// GET /search?q=&category=&min_price=&max_price=&page=&limit=
app.get("/search", async (c) => {
  try {
    const parsed = searchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "Invalid query", details: parsed.error.errors }, 400);
    }
    const { q, category, page, limit, min_price: minPrice, max_price: maxPrice } = parsed.data;
    const from = (page - 1) * limit;

    const filter: unknown[] = [
      { term: { is_active: true } },
      { range: { price: { gte: minPrice, lte: maxPrice } } },
    ];

    if (category) {
      filter.push({ term: { category_name: category } });
    }

    const should: unknown[] = q
      ? [
        { term: { category_name: { value: q, boost: 8 } } },
        { term: { category_name: { value: q.toLowerCase(), boost: 8 } } },
        {
          multi_match: {
            query: q,
            fields: ["name^6", "description^3", "tags^2", "store_name"],
            operator: "and",
          },
        },
        {
          multi_match: {
            query: q,
            fields: ["name^5", "description^2"],
            type: "phrase_prefix",
          },
        },
      ]
      : [];

    const fuzzy = {
      multi_match: {
        query: q,
        fields: [
          "name^4",
          "description^2",
          "tags^2",
          "category_name^2",
          "store_name",
        ],
        fuzziness: "AUTO", // 1 edit for 3–5 chars, 2 for longer; a flat 2 matched e.g. "kettle" to "ketch"
        prefix_length: 0,
        max_expansions: 20,
      },
    };

    const buildQuery = (fuzzyClause?: unknown) => ({
      from,
      size: limit,
      query: q
        ? {
          bool: {
            filter,
            should: fuzzyClause ? [...should, fuzzyClause] : should,
            minimum_should_match: 1,
          },
        }
        : { bool: { filter } },
      sort: q ? ["_score"] : [{ created_at: "desc" }],
      aggs: {
        categories: {
          terms: { field: "category_name", size: 20 },
        },
        price_stats: {
          stats: { field: "price" },
        },
      },
    });

    const result = await searchWithFuzzyFallback(q, buildQuery, fuzzy);

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
    const q = (c.req.query("q") || "").trim();
    if (!q) return c.json({ suggestions: [] });
    const should: unknown[] = [
      { term: { category_name: { value: q, boost: 8 } } },
      { term: { category_name: { value: q.toLowerCase(), boost: 8 } } },
      {
        multi_match: {
          query: q,
          fields: ["name^5", "description"],
          type: "phrase_prefix",
        },
      },
    ];

    const fuzzy = {
      multi_match: {
        query: q,
        fields: ["name^4", "description", "tags^2"],
        fuzziness: "AUTO", // 1 edit for 3–5 chars, 2 for longer; a flat 2 matched e.g. "kettle" to "ketch"
        prefix_length: 0,
        max_expansions: 20,
      },
    };

    const result = await searchWithFuzzyFallback(q, (fuzzyClause) => ({
      size: 5,
      query: {
        bool: {
          filter: [{ term: { is_active: true } }],
          should: fuzzyClause ? [...should, fuzzyClause] : should,
          minimum_should_match: 1,
        },
      },
      _source: ["id", "name", "price"],
    }), fuzzy);

    const suggestions = (result.hits?.hits || []).map(
      (h: Record<string, unknown>) => h._source,
    );

    return c.json({ suggestions });
  } catch (err) {
    console.error(err);
    return c.json({ suggestions: [] });
  }
});

await createIndex();
const port = Number(Deno.env.get("SERVICE_PORT") ?? 8005);
console.log(`Search service running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
