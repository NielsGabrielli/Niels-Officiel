const ALLOWED_PREFIX = "shop/";

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(body);
}

function hasBlob() {
  return Boolean(
    process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
  );
}

function sanitizePathname(raw) {
  const value = String(raw || "")
    .trim()
    .replace(/^\/+/, "");
  if (!value || value.includes("..") || value.includes("\\")) return null;
  if (!value.startsWith(ALLOWED_PREFIX)) return null;
  if (!/\.(jpe?g|png|webp|gif)$/i.test(value)) return null;
  return value;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }

  if (!hasBlob()) {
    send(res, 503, "Blob unavailable");
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const pathname = sanitizePathname(url.searchParams.get("p"));
  if (!pathname) {
    send(res, 400, "Invalid path");
    return;
  }

  try {
    const { get } = require("@vercel/blob");
    const result = await get(pathname, { access: "private" });
    if (!result || !result.stream) {
      send(res, 404, "Not found");
      return;
    }

    const contentType =
      (result.blob && result.blob.contentType) ||
      result.headers?.get?.("content-type") ||
      "image/jpeg";
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = result.stream;
    if (typeof stream.getReader === "function") {
      const reader = stream.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      };
      await pump();
      return;
    }

    stream.pipe(res);
  } catch (err) {
    console.error("shop-media", err);
    send(res, 500, "Media error");
  }
};
