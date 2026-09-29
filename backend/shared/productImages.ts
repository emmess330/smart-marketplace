// products.images holds URLs in two shapes: plain strings (seller-created
// products) and { url } objects (the Kaggle import). Returns just the URL
// strings. Elasticsearch needs one shape per field, so indexers use this.
export function imageUrls(value: unknown): string[] {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((image) => {
      if (typeof image === "string") return image;
      const url = (image as { url?: unknown } | null)?.url;
      return typeof url === "string" ? url : null;
    })
    .filter((url): url is string => !!url);
}
