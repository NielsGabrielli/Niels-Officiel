const fs = require("fs");
const path = require("path");

const SHOP_BLOB_PATH = "niels-shop.json";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
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

function hasBlob() {
  return Boolean(
    process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
  );
}

function readLocalShop() {
  try {
    const file = path.join(process.cwd(), "assets", "shop.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function readShop() {
  if (hasBlob()) {
    try {
      const { get } = require("@vercel/blob");
      const result = await get(SHOP_BLOB_PATH, { access: "private" });
      if (result && result.stream) {
        const text = await new Response(result.stream).text();
        if (text) return JSON.parse(text);
      }
    } catch (err) {
      console.error("checkout shop blob read", err);
    }
  }
  return readLocalShop();
}

function siteOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  if (host) return `${proto}://${host}`;
  return process.env.SITE_URL || "https://www.niels-officiel.fr";
}

function findProduct(shop, productId) {
  const products = Array.isArray(shop?.products) ? shop.products : [];
  return products.find((p) => p && String(p.id) === String(productId)) || null;
}

function productImageUrls(product) {
  const images = Array.isArray(product.images)
    ? product.images.map((u) => String(u || "").trim()).filter(Boolean)
    : [];
  const legacy = String(product.image || "").trim();
  if (legacy && !images.includes(legacy)) images.unshift(legacy);
  // Stripe n’accepte que des URLs absolues https
  return images.filter((u) => /^https:\/\//i.test(u)).slice(0, 8);
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !/^sk_(test|live)_/.test(secret)) {
    json(res, 503, {
      ok: false,
      error: "stripe_not_configured",
      message: "Ajoutez STRIPE_SECRET_KEY (sk_test_…) dans Vercel.",
    });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    json(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  const productId = String(body.productId || "").trim();
  if (!productId) {
    json(res, 400, { ok: false, error: "missing_product" });
    return;
  }

  const shop = await readShop();
  const product = findProduct(shop, productId);
  if (!product || product.published === false) {
    json(res, 404, { ok: false, error: "product_not_found" });
    return;
  }

  const buyEnabled = product.buyEnabled === true;
  const priceCents = Number(product.priceCents);
  const currency = String(product.currency || "eur").toLowerCase();
  const availability = String(product.availability || "")
    .trim()
    .toLowerCase();
  if (!buyEnabled || !Number.isFinite(priceCents) || priceCents < 50) {
    json(res, 400, {
      ok: false,
      error: "product_not_for_sale",
      message: "Ce produit n’est pas achetable (prix min. 0,50 €).",
    });
    return;
  }
  if (availability === "rupture") {
    json(res, 409, {
      ok: false,
      error: "out_of_stock",
      message: "Produit en rupture de stock.",
    });
    return;
  }

  const stockRaw = product.stock;
  if (stockRaw != null && stockRaw !== "") {
    const stock = Number(stockRaw);
    if (!Number.isFinite(stock) || stock <= 0) {
      json(res, 409, {
        ok: false,
        error: "out_of_stock",
        message: "Produit en rupture de stock.",
      });
      return;
    }
  }

  const origin = siteOrigin(req);
  const Stripe = require("stripe");
  const stripe = new Stripe(secret);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "fr",
      billing_address_collection: "required",
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: ["FR", "BE", "CH", "LU", "MC", "DE", "IT", "ES", "PT", "GB", "CA"],
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: Math.round(priceCents),
            product_data: {
              name: String(product.title || "Produit Niels").slice(0, 120),
              description: String(
                product.description || product.detail || ""
              ).slice(0, 500) || undefined,
              images: productImageUrls(product),
            },
          },
        },
      ],
      success_url: `${origin}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/boutique?checkout=cancel`,
      metadata: {
        productId: String(product.id),
        productTitle: String(product.title || "Produit Niels").slice(0, 120),
        quantity: "1",
        source: "niels-shop",
      },
    });

    json(res, 200, { ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error("stripe checkout", err);
    json(res, 500, {
      ok: false,
      error: "checkout_failed",
      message: err && err.message ? err.message : "Erreur Stripe",
    });
  }
};
