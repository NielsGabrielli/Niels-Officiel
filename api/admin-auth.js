const crypto = require("crypto");
const OTPAuth = require("otpauth");

const COOKIE_NAME = "niels_admin_session";
const ENROLLED_COOKIE = "niels_admin_totp_enrolled";
const STATE_BLOB_PATH = "niels-admin-auth-state.json";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ENROLLED_TTL_SEC = 60 * 60 * 24 * 400; // ~13 mois
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

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
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

function buildTotp(user) {
  return new OTPAuth.TOTP({
    issuer: "Niels Admin",
    label: user.username || "admin",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.totpSecret),
  });
}

function verifyTotp(code, user) {
  if (!user || !user.totpSecret) return false;
  const totp = buildTotp(user);
  const delta = totp.validate({ token: String(code || "").trim(), window: 1 });
  return delta !== null;
}

function shouldForceHideTotpSetup() {
  const flag = String(process.env.ADMIN_SHOW_TOTP_SETUP || "auto").toLowerCase();
  return flag === "0" || flag === "false" || flag === "off";
}

function appendSetCookie(res, cookieStr) {
  const prev = res.getHeader("Set-Cookie");
  if (!prev) {
    res.setHeader("Set-Cookie", cookieStr);
  } else if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", prev.concat(cookieStr));
  } else {
    res.setHeader("Set-Cookie", [prev, cookieStr]);
  }
}

function setCookie(res, name, value, maxAgeSec) {
  appendSetCookie(
    res,
    [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${maxAgeSec}`,
    ].join("; ")
  );
}

function clearCookie(res, name) {
  appendSetCookie(
    res,
    `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
}

function normalizeUser(entry) {
  if (!entry || typeof entry !== "object") return null;
  const username = String(entry.username || entry.u || "").trim();
  const passwordHash = String(entry.passwordHash || entry.p || "").trim();
  const totpSecret = String(entry.totpSecret || entry.t || "").trim();
  if (!username || !passwordHash || !totpSecret) return null;
  return { username, passwordHash, totpSecret };
}

function getBaseAdminUsers() {
  const users = [];
  const seen = new Set();

  function pushUser(user) {
    const normalized = normalizeUser(user);
    if (!normalized) return;
    const key = normalized.username.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    users.push(normalized);
  }

  pushUser({
    username: process.env.ADMIN_USERNAME,
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    totpSecret: process.env.ADMIN_TOTP_SECRET,
  });

  const aliases = String(process.env.ADMIN_USERNAME_ALIASES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const alias of aliases) {
    pushUser({
      username: alias,
      passwordHash: process.env.ADMIN_PASSWORD_HASH,
      totpSecret: process.env.ADMIN_TOTP_SECRET,
    });
  }

  if (process.env.ADMIN_USERS) {
    try {
      const parsed = JSON.parse(process.env.ADMIN_USERS);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      list.forEach(pushUser);
    } catch {
      // ignore
    }
  }

  return users;
}

function emptyState() {
  return { enrolled: {}, passwords: {} };
}

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readBlobState() {
  if (!hasBlob()) return null;
  try {
    const { get } = require("@vercel/blob");
    const result = await get(STATE_BLOB_PATH, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!result || result.statusCode === 404 || !result.stream) {
      return emptyState();
    }
    const text = await new Response(result.stream).text();
    if (!text) return emptyState();
    const parsed = JSON.parse(text);
    return {
      enrolled:
        parsed && typeof parsed.enrolled === "object" && parsed.enrolled
          ? parsed.enrolled
          : {},
      passwords:
        parsed && typeof parsed.passwords === "object" && parsed.passwords
          ? parsed.passwords
          : {},
    };
  } catch (err) {
    console.error("admin-auth blob read", err);
    return emptyState();
  }
}

async function writeBlobState(state) {
  if (!hasBlob()) return false;
  const { put } = require("@vercel/blob");
  await put(STATE_BLOB_PATH, JSON.stringify(state), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return true;
}

function readEnrolledCookie(req, secret) {
  const cookies = parseCookies(req);
  const data = verifySigned(cookies[ENROLLED_COOKIE], secret);
  if (!data || data.typ !== "enrolled" || !Array.isArray(data.users)) return [];
  return data.users.map(String);
}

function writeEnrolledCookie(res, secret, users) {
  const token = signPayload(
    {
      typ: "enrolled",
      users: [...new Set(users.map(String))],
      exp: Date.now() + ENROLLED_TTL_SEC * 1000,
    },
    secret
  );
  setCookie(res, ENROLLED_COOKIE, token, ENROLLED_TTL_SEC);
}

function isUserEnrolled(username, state, cookieUsers) {
  const key = String(username || "");
  if (state && state.enrolled && state.enrolled[key]) return true;
  return cookieUsers.some((u) => timingSafeEqualStr(u, key));
}

function applyOverrides(users, state) {
  if (!state || !state.passwords) return users;
  return users.map((user) => {
    const override = state.passwords[user.username];
    if (!override) return user;
    return { ...user, passwordHash: override };
  });
}

function getAdminUsers(state) {
  return applyOverrides(getBaseAdminUsers(), state);
}

function envConfigured() {
  return Boolean(getSessionSecret() && getBaseAdminUsers().length > 0);
}

function findUserByUsername(username, users) {
  const input = String(username || "");
  let match = null;
  for (const user of users) {
    if (timingSafeEqualStr(input, user.username)) match = user;
  }
  return match;
}

function authenticatePassword(username, password, users) {
  let matchedUser = null;
  for (const user of users) {
    const userOk = timingSafeEqualStr(username, user.username);
    const passOk = verifyPassword(password, user.passwordHash);
    if (userOk && passOk) matchedUser = user;
  }
  return matchedUser;
}

function getSessionUser(req, secret) {
  if (!secret) return null;
  const cookies = parseCookies(req);
  const data = verifySigned(cookies[COOKIE_NAME], secret);
  if (!data || data.typ !== "session") return null;
  return data;
}

function totpSetupUriFor(user, enrolled) {
  if (shouldForceHideTotpSetup()) return null;
  if (enrolled) return null;
  if (!user) return null;
  return buildTotp(user).toString();
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
    const data = getSessionUser(req, sessionSecret);
    json(res, 200, {
      ok: true,
      authenticated: Boolean(data),
      username: data ? data.sub : null,
      blobReady: hasBlob(),
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

  const state = (await readBlobState()) || emptyState();
  const users = getAdminUsers(state);
  const cookieEnrolled = readEnrolledCookie(req, sessionSecret);

  if (action === "login") {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const user = authenticatePassword(username, password, users);
    if (!user) {
      json(res, 401, { ok: false, error: "invalid_credentials" });
      return;
    }
    const challengeToken = signPayload(
      {
        typ: "challenge",
        sub: user.username,
        exp: Date.now() + CHALLENGE_TTL_MS,
      },
      sessionSecret
    );
    const enrolled = isUserEnrolled(user.username, state, cookieEnrolled);
    const payload = { ok: true, challengeToken, enrolled };
    const setupUri = totpSetupUriFor(user, enrolled);
    if (setupUri) payload.totpSetupUri = setupUri;
    json(res, 200, payload);
    return;
  }

  if (action === "verify2fa") {
    const challenge = verifySigned(body.challengeToken, sessionSecret);
    if (!challenge || challenge.typ !== "challenge") {
      json(res, 401, { ok: false, error: "invalid_challenge" });
      return;
    }
    const user = findUserByUsername(challenge.sub, users);
    if (!user || !verifyTotp(body.code, user)) {
      json(res, 401, { ok: false, error: "invalid_totp" });
      return;
    }

    state.enrolled[user.username] = Date.now();
    try {
      await writeBlobState(state);
    } catch (err) {
      console.error("admin-auth blob write enrolled", err);
    }

    const nextEnrolled = [...new Set(cookieEnrolled.concat(user.username))];
    writeEnrolledCookie(res, sessionSecret, nextEnrolled);

    const sessionToken = signPayload(
      {
        typ: "session",
        sub: user.username,
        exp: Date.now() + SESSION_TTL_MS,
      },
      sessionSecret
    );
    setCookie(res, COOKIE_NAME, sessionToken, Math.floor(SESSION_TTL_MS / 1000));
    json(res, 200, { ok: true, username: user.username });
    return;
  }

  if (action === "changePassword") {
    const session = getSessionUser(req, sessionSecret);
    if (!session) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const user = findUserByUsername(session.sub, users);
    if (!user) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 8) {
      json(res, 400, { ok: false, error: "password_too_short" });
      return;
    }
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      json(res, 401, { ok: false, error: "invalid_credentials" });
      return;
    }
    if (!hasBlob()) {
      json(res, 503, {
        ok: false,
        error: "blob_required",
        message:
          "Créez un Blob Store dans Vercel → Storage pour activer le changement de mot de passe.",
      });
      return;
    }

    state.passwords[user.username] = hashPassword(newPassword);
    try {
      await writeBlobState(state);
    } catch (err) {
      console.error("admin-auth blob write password", err);
      json(res, 500, { ok: false, error: "persist_failed" });
      return;
    }
    json(res, 200, { ok: true });
    return;
  }

  if (action === "totpSetup") {
    const session = getSessionUser(req, sessionSecret);
    if (!session) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const user = findUserByUsername(session.sub, users);
    if (!user) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    json(res, 200, { ok: true, totpSetupUri: buildTotp(user).toString() });
    return;
  }

  json(res, 400, { ok: false, error: "unknown_action" });
};
