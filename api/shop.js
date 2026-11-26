const crypto = require("crypto");

const COOKIE_NAME = "niels_admin_session";
const SHOP_BLOB_PATH = "niels-shop.json";
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

const DEFAULT_PRODUCT_TYPES = [
  { id: "vetement", label: "Vêtement" },
  { id: "musique", label: "Musique" },
  { id: "affiche", label: "Affiche" },
  { id: "accessoire", label: "Accessoire" },
  { id: "autre", label: "Autre" },
];

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

function verifySigned(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = b64url(
    crypto.createHmac("sha256", secret).update(payload).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(payload).toString("utf8"));
    if (!data || typeof data !== "object") return null;
    if (typeof data.exp !== "number" || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function getSessionUser(req) {
  const secret = getSessionSecret();
  if (!secret) return null;
  const cookies = parseCookies(req);
  const data = verifySigned(cookies[COOKIE_NAME], secret);
  if (!data || data.typ !== "session") return null;
  return data;
}

function hasBlob() {
  return Boolean(
    process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
  );
}

function emptyShop() {
  return {
    version: 4,
    intro: "",
    shopUrl: "",
    shopCtaLabel: "Toute la boutique",
    cmsCtaLabel: "Voir la fiche produit",
    productTypes: DEFAULT_PRODUCT_TYPES,
    products: [],
  };
}

function normalizeProductTypes(list) {
  const src = Array.isArray(list) ? list : DEFAULT_PRODUCT_TYPES;
  const out = [];
  const seen = new Set();
  src.forEach((t) => {
    if (!t || typeof t !== "object") return;
    const id = String(t.id || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "");
    const label = String(t.label || id).trim();
    if (!id || !label || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label });
  });
  return out.length ? out : DEFAULT_PRODUCT_TYPES.slice();
}

function normalizeProduct(p) {
  if (!p || typeof p !== "object") return null;
  const imagesRaw = Array.isArray(p.images) ? p.images : [];
  const images = imagesRaw
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  const legacyImage = String(p.image || "").trim();
  if (legacyImage && !images.includes(legacyImage)) images.unshift(legacyImage);
  const image = images[0] || legacyImage || "";
  const priceCentsRaw = Number(p.priceCents);
  const priceCents =
    Number.isFinite(priceCentsRaw) && priceCentsRaw > 0
      ? Math.round(priceCentsRaw)
      : null;
  return {
    id: String(p.id || "").trim() || `p_${Date.now()}`,
    title: String(p.title || "").trim(),
    description: String(p.description || "").trim(),
    detail: String(p.detail || "").trim(),
    price: String(p.price || "").trim(),
    priceCents,
    currency: String(p.currency || "eur").trim().toLowerCase() || "eur",
    buyEnabled: p.buyEnabled === true,
    type: String(p.type || "autre").trim() || "autre",
    image,
    images,
    cmsPageUrl: String(p.cmsPageUrl || "").trim(),
    published: p.published !== false,
  };
}

function normalizePayload(input) {
  const src = input && typeof input === "object" ? input : {};
  const products = Array.isArray(src.products)
    ? src.products.map(normalizeProduct).filter(Boolean)
    : [];
  return {
    version: 4,
    intro: typeof src.intro === "string" ? src.intro.trim() : "",
    shopUrl: typeof src.shopUrl === "string" ? src.shopUrl.trim() : "",
    shopCtaLabel:
      typeof src.shopCtaLabel === "string" ? src.shopCtaLabel.trim() : "",
    cmsCtaLabel:
      typeof src.cmsCtaLabel === "string" ? src.cmsCtaLabel.trim() : "",
    productTypes: normalizeProductTypes(src.productTypes),
    products,
    updatedAt: new Date().toISOString(),
  };
}

async function readShopBlob() {
  if (!hasBlob()) return null;
  try {
    const { get } = require("@vercel/blob");
    const result = await get(SHOP_BLOB_PATH, { access: "private" });
    if (!result || result.statusCode === 404 || !result.stream) {
      return emptyShop();
    }
    const text = await new Response(result.stream).text();
    if (!text) return emptyShop();
    return normalizePayload(JSON.parse(text));
  } catch (err) {
    console.error("shop blob read", err);
    return emptyShop();
  }
}

async function writeShopBlob(payload) {
  if (!hasBlob()) {
    const err = new Error("blob_required");
    err.code = "blob_required";
    throw err;
  }
  const { put } = require("@vercel/blob");
  const data = normalizePayload(payload);
  await put(SHOP_BLOB_PATH, JSON.stringify(data, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return data;
}

function safeFileName(name) {
  return String(name || "image")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function uploadShopImage({ fileName, contentType, dataBase64 }) {
  if (!hasBlob()) {
    const err = new Error("blob_required");
    err.code = "blob_required";
    throw err;
  }
  const raw = String(dataBase64 || "");
  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    const err = new Error("empty_file");
    err.code = "empty_file";
    throw err;
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    const err = new Error("file_too_large");
    err.code = "file_too_large";
    throw err;
  }
  const type = String(contentType || "image/jpeg");
  if (!/^image\/(jpeg|jpg|png|webp|gif|svg\+xml)$/i.test(type)) {
    const err = new Error("invalid_type");
    err.code = "invalid_type";
    throw err;
  }
  const ext =
    type.includes("png")
      ? "png"
      : type.includes("webp")
        ? "webp"
        : type.includes("gif")
          ? "gif"
          : type.includes("svg")
            ? "svg"
            : "jpg";
  const pathname = `shop/${Date.now()}-${safeFileName(fileName).replace(/\.[a-z0-9]+$/, "")}.${ext}`;
  const { put } = require("@vercel/blob");
  const uploaded = await put(pathname, buffer, {
    access: "public",
    contentType: type,
    addRandomSuffix: true,
  });
  return { url: uploaded.url, pathname: uploaded.pathname };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method === "GET") {
    const data = (await readShopBlob()) || emptyShop();
    json(res, 200, data);
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    json(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  const action = body && body.action;

  if (action === "get" || !action) {
    const data = (await readShopBlob()) || emptyShop();
    json(res, 200, data);
    return;
  }

  const session = getSessionUser(req);
  if (!session) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  if (action === "publish") {
    if (!hasBlob()) {
      json(res, 503, {
        ok: false,
        error: "blob_required",
        message:
          "Blob Store Vercel requis pour publier la boutique. Connectez un Blob au projet puis redeployez.",
      });
      return;
    }
    try {
      const saved = await writeShopBlob(body.data || body.payload || body);
      json(res, 200, { ok: true, data: saved });
    } catch (err) {
      console.error("shop publish", err);
      json(res, 500, { ok: false, error: "persist_failed" });
    }
    return;
  }

  if (action === "uploadImage") {
    try {
      const uploaded = await uploadShopImage({
        fileName: body.fileName,
        contentType: body.contentType,
        dataBase64: body.dataBase64,
      });
      json(res, 200, { ok: true, ...uploaded });
    } catch (err) {
      console.error("shop uploadImage", err);
      const code = err && err.code ? err.code : "upload_failed";
      const status =
        code === "blob_required"
          ? 503
          : code === "file_too_large" || code === "invalid_type" || code === "empty_file"
            ? 400
            : 500;
      json(res, status, {
        ok: false,
        error: code,
        message:
          code === "blob_required"
            ? "Blob Store Vercel requis pour téléverser des images."
            : code === "file_too_large"
              ? "Image trop lourde (max ~3,5 Mo)."
              : code === "invalid_type"
                ? "Type d’image non supporté (JPG, PNG ou WebP)."
                : code === "empty_file"
                  ? "Fichier image vide."
                  : "Échec du téléversement. Réessayez avec un JPG plus léger.",
      });
    }
    return;
  }

  json(res, 400, { ok: false, error: "unknown_action" });
};
