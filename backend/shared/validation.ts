import type { Context, Next } from "hono/mod.ts";
import { z } from "zod";

const uuid = z.string().uuid();
export const isUuid = (value: unknown) => uuid.safeParse(value).success;

// Parses the JSON body with `schema`. Invalid JSON is raised as a ZodError,
// so the routes' existing `ZodError → 400` handling covers it too.
export async function parseJsonBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: [],
      message: "Request body must be valid JSON",
    }]);
  }
  return schema.parse(body);
}

// Route middleware: 400 unless each named path param is a UUID, so malformed
// ids never reach Postgres (which would fail the query with a 500).
export function uuidParams(...names: string[]) {
  return async (c: Context, next: Next) => {
    for (const name of names) {
      if (!isUuid(c.req.param(name))) {
        return c.json({ error: `Invalid ${name}: expected a UUID` }, 400);
      }
    }
    await next();
  };
}

// ?page= and ?limit= as positive integers; a limit above `maxLimit` is capped
// rather than rejected.
export function paginationSchema(defaultLimit: number, maxLimit = 100) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).default(defaultLimit)
      .transform((limit) => Math.min(limit, maxLimit)),
  });
}

export const optionalUuid = uuid.optional();
