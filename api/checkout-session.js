function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

function formatMoney(cents, currency) {
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: String(currency || "eur").toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${String(currency || "eur").toUpperCase()}`;
  }
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !/^sk_(test|live)_/.test(secret)) {
    json(res, 503, { ok: false, error: "stripe_not_configured" });
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const sessionId = String(url.searchParams.get("session_id") || "").trim();
  if (!sessionId || !/^cs_(test|live)_/.test(sessionId)) {
    json(res, 400, { ok: false, error: "invalid_session" });
    return;
  }

  try {
    const Stripe = require("stripe");
    const stripe = new Stripe(secret);
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items.data.price.product"],
    });

    if (!session || session.payment_status !== "paid") {
      json(res, 404, { ok: false, error: "not_paid" });
      return;
    }

    const details = session.customer_details || {};
    const ship = session.shipping_details || {};
    const addr = ship.address || details.address || {};
    const line =
      Array.isArray(session.line_items?.data) && session.line_items.data[0]
        ? session.line_items.data[0]
        : null;
    const productTitle =
      String(session.metadata?.productTitle || "").trim() ||
      String(line?.description || "").trim() ||
      "Produit Niels";

    json(res, 200, {
      ok: true,
      order: {
        sessionId: session.id,
        productTitle,
        amountLabel: formatMoney(session.amount_total, session.currency),
        email: details.email || session.customer_email || "",
        name: details.name || ship.name || "",
        phone: details.phone || "",
        shipping: {
          name: ship.name || details.name || "",
          line1: addr.line1 || "",
          line2: addr.line2 || "",
          city: addr.city || "",
          postalCode: addr.postal_code || "",
          country: addr.country || "",
        },
      },
    });
  } catch (err) {
    console.error("checkout-session", err);
    json(res, 500, { ok: false, error: "lookup_failed" });
  }
};
