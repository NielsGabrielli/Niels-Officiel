const crypto = require("crypto");
const {
  hasBlob,
  readOrdersBlob,
  writeOrdersBlob,
  normalizeOrder,
  sendOrderShippedEmail,
  sendOrderPaidEmails,
} = require("./_orders");

const COOKIE_NAME = "niels_admin_session";

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

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  const session = getSessionUser(req);
  if (!session) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  if (req.method === "GET") {
    const data = await readOrdersBlob();
    json(res, 200, { ok: true, ...data });
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

  if (action === "list" || !action) {
    const data = await readOrdersBlob();
    json(res, 200, { ok: true, ...data });
    return;
  }

  if (action === "update") {
    if (!hasBlob()) {
      json(res, 503, {
        ok: false,
        error: "blob_required",
        message: "Blob Store Vercel requis pour gérer les commandes.",
      });
      return;
    }
    const orderId = String(body.id || "").trim();
    if (!orderId) {
      json(res, 400, { ok: false, error: "missing_id" });
      return;
    }
    const store = await readOrdersBlob();
    const idx = store.orders.findIndex((o) => o && o.id === orderId);
    if (idx < 0) {
      json(res, 404, { ok: false, error: "not_found" });
      return;
    }

    const prev = store.orders[idx];
    const next = normalizeOrder({
      ...prev,
      status: body.status != null ? body.status : prev.status,
      trackingNumber:
        body.trackingNumber != null ? body.trackingNumber : prev.trackingNumber,
      trackingUrl:
        body.trackingUrl != null ? body.trackingUrl : prev.trackingUrl,
      updatedAt: new Date().toISOString(),
    });
    store.orders[idx] = next;
    await writeOrdersBlob(store);

    let email = { sent: false, reason: "skipped" };
    const becameShipped =
      prev.status !== "shipped" && next.status === "shipped";
    const askNotify = body.notifyCustomer === true;
    if ((becameShipped || askNotify) && next.status === "shipped") {
      email = await sendOrderShippedEmail(next);
    }

    json(res, 200, {
      ok: true,
      order: next,
      email,
      message:
        email && email.sent
          ? "Commande enregistrée. E-mail d’expédition envoyé."
          : email && email.reason === "skipped"
            ? "Commande enregistrée."
            : `Commande enregistrée. E-mail d’expédition non envoyé (${email?.reason || "erreur"}).`,
    });
    return;
  }

  if (action === "previewEmails") {
    const to = String(body.to || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      json(res, 400, { ok: false, error: "invalid_email" });
      return;
    }
    const sampleOrder = normalizeOrder({
      id: `ord_preview_${Date.now()}`,
      stripeSessionId: `cs_test_preview_${Date.now()}`,
      productId: "p-cd-live",
      productTitle: "CD - Live Session 2025",
      amountTotal: 1200,
      currency: "eur",
      email: to,
      name: "Franck Lecointe",
      phone: "+33 6 00 00 00 00",
      shipping: {
        name: "Franck Lecointe",
        line1: "14 Chemin de la Fontaine",
        line2: "",
        city: "Barbentane",
        postalCode: "13570",
        country: "FR",
      },
      status: "paid",
      trackingNumber: "3S00000000000",
      trackingUrl: "https://www.laposte.fr/outils/suivre-vos-envois",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const paid = await sendOrderPaidEmails(sampleOrder, {
      skipMerchant: true,
      subjectPrefix: "[Aperçu] ",
    });
    const shipped = await sendOrderShippedEmail(
      { ...sampleOrder, status: "shipped" },
      { subjectPrefix: "[Aperçu] " }
    );

    const okCustomer = paid?.customer?.sent === true;
    const okShipped = shipped?.sent === true;
    json(res, okCustomer || okShipped ? 200 : 500, {
      ok: okCustomer || okShipped,
      to,
      paid,
      shipped,
      message: `Aperçus → confirmation: ${okCustomer ? "OK" : paid?.customer?.reason || "échec"} · expédition: ${okShipped ? "OK" : shipped?.reason || "échec"}`,
    });
    return;
  }

  json(res, 400, { ok: false, error: "unknown_action" });
};
