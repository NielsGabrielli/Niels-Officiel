const crypto = require("crypto");

const COOKIE_NAME = "niels_admin_session";
const CONCERTS_BLOB_PATH = "niels-concerts.json";

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

function emptyConcerts() {
  return { version: 2, intro: "", concerts: [] };
}

function normalizePayload(input) {
  const src = input && typeof input === "object" ? input : {};
  const concerts = Array.isArray(src.concerts)
    ? src.concerts
        .map((c) => {
          if (!c || typeof c !== "object") return null;
          return {
            id: String(c.id || "").trim() || `c_${Date.now()}`,
            dateIso: String(c.dateIso || "").trim(),
            time: String(c.time || "").trim(),
            dateLabel: String(c.dateLabel || "").trim(),
            venue: String(c.venue || "").trim(),
            type: String(c.type || "").trim(),
            bookingUrl: String(c.bookingUrl || "").trim(),
          };
        })
        .filter(Boolean)
    : [];
  return {
    version: 2,
    intro: typeof src.intro === "string" ? src.intro.trim() : "",
    concerts,
    updatedAt: new Date().toISOString(),
  };
}

async function readConcertsBlob() {
  if (!hasBlob()) return null;
  try {
    const { get } = require("@vercel/blob");
    const result = await get(CONCERTS_BLOB_PATH, { access: "private" });
    if (!result || result.statusCode === 404 || !result.stream) {
      return emptyConcerts();
    }
    const text = await new Response(result.stream).text();
    if (!text) return emptyConcerts();
    const parsed = JSON.parse(text);
    return normalizePayload(parsed);
  } catch (err) {
    console.error("concerts blob read", err);
    return emptyConcerts();
  }
}

async function writeConcertsBlob(payload) {
  if (!hasBlob()) {
    const err = new Error("blob_required");
    err.code = "blob_required";
    throw err;
  }
  const { put } = require("@vercel/blob");
  const data = normalizePayload(payload);
  await put(CONCERTS_BLOB_PATH, JSON.stringify(data, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
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

  if (req.method === "GET") {
    const data = (await readConcertsBlob()) || emptyConcerts();
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
    const data = (await readConcertsBlob()) || emptyConcerts();
    json(res, 200, data);
    return;
  }

  if (action === "publish") {
    const session = getSessionUser(req);
    if (!session) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    if (!hasBlob()) {
      json(res, 503, {
        ok: false,
        error: "blob_required",
        message:
          "Blob Store Vercel requis pour publier l’agenda. Connectez un Blob au projet puis redeployez.",
      });
      return;
    }
    try {
      const saved = await writeConcertsBlob(body.data || body.payload || body);
      json(res, 200, { ok: true, data: saved });
    } catch (err) {
      console.error("concerts publish", err);
      json(res, 500, { ok: false, error: "persist_failed" });
    }
    return;
  }

  json(res, 400, { ok: false, error: "unknown_action" });
};
