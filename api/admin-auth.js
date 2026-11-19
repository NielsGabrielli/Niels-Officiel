const crypto = require("crypto");
const OTPAuth = require("otpauth");

const COOKIE_NAME = "niels_admin_session";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

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

function signPayload(payloadObj, secret) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = b64url(
    crypto.createHmac("sha256", secret).update(payload).digest()
  );
  return `${payload}.${sig}`;
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

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  // Format: scrypt$saltB64$urlsafeHashB64
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  if (!salt.length || !expected.length) return false;
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function verifyTotp(code, secretBase32) {
  if (!secretBase32) return false;
  const totp = new OTPAuth.TOTP({
    issuer: "Niels Admin",
    label: "admin",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: String(code || "").trim(), window: 1 });
  return delta !== null;
}

function setCookie(res, name, value, maxAgeSec) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  res.setHeader(
    "Set-Cookie",
    `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
}

function envConfigured() {
  return Boolean(
    process.env.ADMIN_USERNAME &&
      process.env.ADMIN_PASSWORD_HASH &&
      process.env.ADMIN_TOTP_SECRET &&
      getSessionSecret()
  );
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

  let body;
  try {
    body = await readBody(req);
  } catch {
    json(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  const action = body && body.action;
  const sessionSecret = getSessionSecret();

  if (action === "session") {
    if (!sessionSecret) {
      json(res, 200, { ok: true, authenticated: false });
      return;
    }
    const cookies = parseCookies(req);
    const data = verifySigned(cookies[COOKIE_NAME], sessionSecret);
    json(res, 200, {
      ok: true,
      authenticated: Boolean(data && data.typ === "session"),
    });
    return;
  }

  if (action === "logout") {
    clearCookie(res, COOKIE_NAME);
    json(res, 200, { ok: true });
    return;
  }

  if (!envConfigured()) {
    json(res, 503, { ok: false, error: "auth_not_configured" });
    return;
  }

  if (action === "login") {
    const username = String(body.username || "");
    const password = String(body.password || "");
    const userOk = timingSafeEqualStr(username, process.env.ADMIN_USERNAME);
    const passOk = verifyPassword(password, process.env.ADMIN_PASSWORD_HASH);
    if (!userOk || !passOk) {
      json(res, 401, { ok: false, error: "invalid_credentials" });
      return;
    }
    const challengeToken = signPayload(
      {
        typ: "challenge",
        sub: process.env.ADMIN_USERNAME,
        exp: Date.now() + CHALLENGE_TTL_MS,
      },
      sessionSecret
    );
    json(res, 200, { ok: true, challengeToken });
    return;
  }

  if (action === "verify2fa") {
    const challenge = verifySigned(body.challengeToken, sessionSecret);
    if (!challenge || challenge.typ !== "challenge") {
      json(res, 401, { ok: false, error: "invalid_challenge" });
      return;
    }
    if (!verifyTotp(body.code, process.env.ADMIN_TOTP_SECRET)) {
      json(res, 401, { ok: false, error: "invalid_totp" });
      return;
    }
    const sessionToken = signPayload(
      {
        typ: "session",
        sub: challenge.sub,
        exp: Date.now() + SESSION_TTL_MS,
      },
      sessionSecret
    );
    setCookie(res, COOKIE_NAME, sessionToken, Math.floor(SESSION_TTL_MS / 1000));
    json(res, 200, { ok: true });
    return;
  }

  json(res, 400, { ok: false, error: "unknown_action" });
};
