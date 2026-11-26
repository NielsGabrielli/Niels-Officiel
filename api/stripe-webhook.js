const SHOP_BLOB_PATH = "niels-shop.json";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function hasBlob() {
  return Boolean(
    process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
  );
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readShopBlob() {
  if (!hasBlob()) return null;
  try {
    const { get } = require("@vercel/blob");
    const result = await get(SHOP_BLOB_PATH, { access: "private" });
    if (result && result.stream) {
      const text = await new Response(result.stream).text();
      if (text) return JSON.parse(text);
    }
  } catch (err) {
    console.error("stripe-webhook shop read", err);
  }
  return null;
}

async function writeShopBlob(data) {
  if (!hasBlob()) return null;
  const { put } = require("@vercel/blob");
  await put(SHOP_BLOB_PATH, JSON.stringify(data, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return data;
}

async function decrementStock(productId, qty) {
  const id = String(productId || "").trim();
  const amount = Math.max(1, Math.floor(Number(qty) || 1));
  if (!id) return;
  const shop = await readShopBlob();
  if (!shop || !Array.isArray(shop.products)) return;

  let changed = false;
  shop.products = shop.products.map((p) => {
    if (!p || String(p.id) !== id) return p;
    if (p.stock == null || p.stock === "") return p;
    const current = Number(p.stock);
    if (!Number.isFinite(current)) return p;
    changed = true;
    return { ...p, stock: Math.max(0, Math.floor(current) - amount) };
  });

  if (changed) await writeShopBlob(shop);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !webhookSecret) {
    json(res, 503, { ok: false, error: "webhook_not_configured" });
    return;
  }

  const Stripe = require("stripe");
  const stripe = new Stripe(secret);
  const rawBody = await readRawBody(req);
  const signature = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("stripe webhook signature", err);
    json(res, 400, { ok: false, error: "invalid_signature" });
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const productId = session?.metadata?.productId;
      const qty = session?.metadata?.quantity || 1;
      if (productId) await decrementStock(productId, qty);
    }
  } catch (err) {
    console.error("stripe webhook handle", err);
    json(res, 500, { ok: false, error: "handle_failed" });
    return;
  }

  json(res, 200, { ok: true });
};
