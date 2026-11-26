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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const apiKey = process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY;
  if (!apiKey) {
    json(res, 503, {
      ok: false,
      error: "brevo_not_configured",
      message: "Ajoutez BREVO_API_KEY dans Vercel.",
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

  const email = String(body.email || "").trim().toLowerCase();
  const consent = body.consent === true || body.consent === "true" || body.consent === "on";
  const source = String(body.source || "soundletter").trim().slice(0, 80);

  if (!isValidEmail(email)) {
    json(res, 400, {
      ok: false,
      error: "invalid_email",
      message: "Adresse e-mail invalide.",
    });
    return;
  }
  if (!consent) {
    json(res, 400, {
      ok: false,
      error: "consent_required",
      message: "Le consentement est requis.",
    });
    return;
  }

  const listIdRaw = process.env.BREVO_NEWSLETTER_LIST_ID;
  const listId = listIdRaw ? Number(listIdRaw) : null;
  const payload = {
    email,
    updateEnabled: true,
    attributes: {
      SOURCE: source || "soundletter",
      OPT_IN: true,
    },
  };
  if (Number.isFinite(listId) && listId > 0) {
    payload.listIds = [listId];
  }

  try {
    const brevoRes = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    // 201 created, 204 updated (updateEnabled), 400 duplicate souvent OK
    if (brevoRes.status === 201 || brevoRes.status === 204) {
      json(res, 200, { ok: true });
      return;
    }

    let errBody = {};
    try {
      errBody = await brevoRes.json();
    } catch {
      /* ignore */
    }
    const code = errBody?.code || "";
    if (
      brevoRes.status === 400 &&
      (code === "duplicate_parameter" || /already|exist/i.test(String(errBody?.message || "")))
    ) {
      json(res, 200, { ok: true, alreadySubscribed: true });
      return;
    }

    console.error("brevo newsletter", brevoRes.status, errBody);
    json(res, 502, {
      ok: false,
      error: "brevo_failed",
      message:
        code === "unauthorized" || brevoRes.status === 401
          ? "Clé Brevo sans droit Contacts. Ajoutez la permission Contacts à la clé API."
          : "Impossible d’enregistrer l’inscription pour le moment.",
    });
  } catch (err) {
    console.error("brevo newsletter network", err);
    json(res, 500, {
      ok: false,
      error: "network_error",
      message: "Impossible de joindre Brevo.",
    });
  }
};
