const ORDERS_BLOB_PATH = "niels-orders.json";

function hasBlob() {
  return Boolean(
    process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
  );
}

function emptyOrders() {
  return { version: 1, orders: [] };
}

function normalizeOrder(input) {
  if (!input || typeof input !== "object") return null;
  const statusRaw = String(input.status || "paid").trim().toLowerCase();
  const statusAllowed = new Set([
    "paid",
    "preparing",
    "shipped",
    "delivered",
    "cancelled",
  ]);
  const status = statusAllowed.has(statusRaw) ? statusRaw : "paid";
  const shipping =
    input.shipping && typeof input.shipping === "object"
      ? {
          name: String(input.shipping.name || "").trim(),
          line1: String(input.shipping.line1 || "").trim(),
          line2: String(input.shipping.line2 || "").trim(),
          city: String(input.shipping.city || "").trim(),
          postalCode: String(input.shipping.postalCode || "").trim(),
          country: String(input.shipping.country || "").trim(),
        }
      : null;

  return {
    id: String(input.id || "").trim(),
    stripeSessionId: String(input.stripeSessionId || "").trim(),
    productId: String(input.productId || "").trim(),
    productTitle: String(input.productTitle || "").trim(),
    amountTotal: Number.isFinite(Number(input.amountTotal))
      ? Math.round(Number(input.amountTotal))
      : null,
    currency: String(input.currency || "eur").trim().toLowerCase() || "eur",
    email: String(input.email || "").trim(),
    name: String(input.name || "").trim(),
    phone: String(input.phone || "").trim(),
    shipping,
    status,
    trackingNumber: String(input.trackingNumber || "").trim(),
    trackingUrl: String(input.trackingUrl || "").trim(),
    createdAt: String(input.createdAt || new Date().toISOString()),
    updatedAt: String(input.updatedAt || new Date().toISOString()),
  };
}

async function readOrdersBlob() {
  if (!hasBlob()) return emptyOrders();
  try {
    const { get } = require("@vercel/blob");
    const result = await get(ORDERS_BLOB_PATH, { access: "private" });
    if (result && result.stream) {
      const text = await new Response(result.stream).text();
      if (text) {
        const parsed = JSON.parse(text);
        const orders = Array.isArray(parsed?.orders)
          ? parsed.orders.map(normalizeOrder).filter(Boolean)
          : [];
        return { version: 1, orders };
      }
    }
  } catch (err) {
    console.error("orders blob read", err);
  }
  return emptyOrders();
}

async function writeOrdersBlob(data) {
  if (!hasBlob()) {
    const err = new Error("blob_required");
    err.code = "blob_required";
    throw err;
  }
  const orders = Array.isArray(data?.orders)
    ? data.orders.map(normalizeOrder).filter(Boolean)
    : [];
  const payload = { version: 1, orders };
  const { put } = require("@vercel/blob");
  await put(ORDERS_BLOB_PATH, JSON.stringify(payload, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return payload;
}

function orderFromStripeSession(session) {
  const details = session?.customer_details || {};
  const ship = session?.shipping_details || {};
  const addr = ship.address || details.address || {};
  const productTitle =
    String(session?.metadata?.productTitle || "").trim() ||
    "Produit Niels";
  return normalizeOrder({
    id: `ord_${String(session.id || "").replace(/^cs_/, "")}`,
    stripeSessionId: String(session.id || ""),
    productId: String(session?.metadata?.productId || "").trim(),
    productTitle,
    amountTotal: session.amount_total,
    currency: session.currency,
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
    status: "paid",
    trackingNumber: "",
    trackingUrl: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function upsertOrderFromSession(session) {
  const order = orderFromStripeSession(session);
  if (!order || !order.stripeSessionId) return null;
  const store = await readOrdersBlob();
  const idx = store.orders.findIndex(
    (o) => o.stripeSessionId === order.stripeSessionId
  );
  if (idx >= 0) {
    store.orders[idx] = {
      ...store.orders[idx],
      ...order,
      status: store.orders[idx].status || order.status,
      trackingNumber: store.orders[idx].trackingNumber || "",
      trackingUrl: store.orders[idx].trackingUrl || "",
      updatedAt: new Date().toISOString(),
    };
  } else {
    store.orders.unshift(order);
  }
  await writeOrdersBlob(store);
  return idx >= 0 ? store.orders[idx] : order;
}

function parseFromEmail(raw) {
  const value = String(raw || "").trim();
  const match = value.match(/^(.*)<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, "") || "Boutique Niels",
      email: match[2].trim(),
    };
  }
  if (value.includes("@")) {
    return { name: "Boutique Niels", email: value };
  }
  return {
    name: "Boutique Niels",
    email: "contact@niels-officiel.fr",
  };
}

async function sendOrderEmail({ to, subject, html, text }) {
  const key =
    process.env.BREVO_API_KEY ||
    process.env.SENDINBLUE_API_KEY ||
    "";
  if (!key || !to) return { sent: false, reason: "not_configured" };

  const sender = parseFromEmail(
    process.env.ORDER_FROM_EMAIL || "Boutique Niels <contact@niels-officiel.fr>"
  );

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": key,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: String(to).trim() }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("brevo email failed", res.status, body);
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true };
  } catch (err) {
    console.error("brevo email", err);
    return { sent: false, reason: "network_error" };
  }
}

function formatMoney(cents, currency) {
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return "";
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: String(currency || "eur").toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${String(currency || "eur").toUpperCase()}`;
  }
}

function formatShipping(shipping) {
  if (!shipping) return "—";
  return [
    shipping.name,
    shipping.line1,
    shipping.line2,
    [shipping.postalCode, shipping.city].filter(Boolean).join(" "),
    shipping.country,
  ]
    .filter(Boolean)
    .join("\n");
}

function siteBaseUrl() {
  return String(process.env.SITE_URL || "https://www.niels-officiel.fr").replace(
    /\/$/,
    ""
  );
}

function buildEmailLayout({ title, intro, rowsHtml, noteHtml, cta }) {
  const base = siteBaseUrl();
  const logoUrl = `${base}/assets/logo-email.png`;
  const ctaHtml = cta
    ? `<tr>
        <td style="padding:18px 0 0;font-family:Arial,Helvetica,sans-serif;">
          <a href="${escapeAttr(cta.href)}" style="display:inline-block;background-color:#D05033;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 20px;">
            ${escapeHtml(cta.label)}
          </a>
        </td>
      </tr>`
    : "";

  // Fond clair + texte foncé : évite le bug Gmail (texte blanc devenu invisible).
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f1ea;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f4f1ea" style="background-color:#f4f1ea;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #e5d2bb;">
          <tr>
            <td align="center" bgcolor="#ffffff" style="padding:28px 24px 12px;background-color:#ffffff;">
              <a href="${escapeAttr(base)}" style="text-decoration:none;">
                <img src="${escapeAttr(logoUrl)}" width="150" alt="Niels" style="display:block;border:0;height:auto;max-width:150px;" />
              </a>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:8px 24px 28px;font-family:Arial,Helvetica,sans-serif;background-color:#ffffff;color:#1a1a1a;">
              <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;font-weight:700;color:#1a1a1a;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#444444;">${escapeHtml(intro)}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#faf7f2" style="background-color:#faf7f2;border:1px solid #eadfce;">
                <tr>
                  <td style="padding:16px 16px 4px;font-family:Arial,Helvetica,sans-serif;">
                    ${rowsHtml}
                  </td>
                </tr>
              </table>
              ${
                noteHtml
                  ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#555555;">${escapeHtml(noteHtml)}</p>`
                  : ""
              }
              <table role="presentation" cellspacing="0" cellpadding="0">
                ${ctaHtml}
              </table>
              <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#888888;">
                Boutique officielle · <a href="${escapeAttr(base)}" style="color:#D05033;text-decoration:underline;">niels-officiel.fr</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailDetailRow(label, valueHtml) {
  if (!valueHtml) return "";
  return `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:block;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8a7a66;margin-bottom:4px;">${escapeHtml(label)}</span>
    <span style="display:block;font-size:15px;line-height:1.45;color:#1a1a1a;">${valueHtml}</span>
  </p>`;
}

async function sendOrderPaidEmails(order, options = {}) {
  const skipMerchant = options.skipMerchant === true;
  const subjectPrefix = options.subjectPrefix
    ? String(options.subjectPrefix)
    : "";
  const notify = skipMerchant
    ? ""
    : String(
        process.env.ORDER_NOTIFY_EMAIL ||
          process.env.CONTACT_EMAIL ||
          "contact@niels-officiel.fr"
      ).trim();
  const money = formatMoney(order.amountTotal, order.currency);
  const shipText = formatShipping(order.shipping);
  const shipHtml = escapeHtml(shipText).replace(/\n/g, "<br/>");
  const base = siteBaseUrl();
  const results = { customer: null, merchant: null };

  if (order.email) {
    const rowsHtml = [
      emailDetailRow("Produit", escapeHtml(order.productTitle)),
      money ? emailDetailRow("Montant", escapeHtml(money)) : "",
      order.email ? emailDetailRow("E-mail", escapeHtml(order.email)) : "",
      shipText && shipText !== "—"
        ? emailDetailRow("Adresse de livraison", shipHtml)
        : "",
    ].join("");

    results.customer = await sendOrderEmail({
      to: order.email,
      subject: `${subjectPrefix}Confirmation de commande — ${order.productTitle}`,
      text: [
        `Merci pour votre commande !`,
        ``,
        `Produit : ${order.productTitle}`,
        money ? `Montant : ${money}` : "",
        ``,
        `Adresse de livraison :`,
        shipText,
        ``,
        `Nous traitons votre commande et vous préviendrons par e-mail dès l’expédition.`,
        `— Boutique Niels`,
        base,
      ]
        .filter(Boolean)
        .join("\n"),
      html: buildEmailLayout({
        title: "Commande confirmée",
        intro:
          "Merci pour votre achat. Nous avons bien reçu votre paiement et traitons actuellement votre commande.",
        rowsHtml,
        noteHtml:
          "Vous serez prévenu par e-mail dès l’expédition, avec le numéro de suivi du colis.",
        cta: { href: base, label: "Retour au site" },
      }),
    });
  }

  if (notify) {
    const rowsHtml = [
      emailDetailRow("Produit", escapeHtml(order.productTitle)),
      money ? emailDetailRow("Montant", escapeHtml(money)) : "",
      emailDetailRow(
        "Client",
        `${escapeHtml(order.name || "—")}<br/>${escapeHtml(order.email || "—")}${
          order.phone ? `<br/>${escapeHtml(order.phone)}` : ""
        }`
      ),
      shipText && shipText !== "—"
        ? emailDetailRow("Livraison", shipHtml)
        : "",
      order.id ? emailDetailRow("Référence", escapeHtml(order.id)) : "",
    ].join("");

    results.merchant = await sendOrderEmail({
      to: notify,
      subject: `${subjectPrefix}Nouvelle commande — ${order.productTitle}`,
      text: [
        `Nouvelle commande boutique`,
        `Produit : ${order.productTitle}`,
        money ? `Montant : ${money}` : "",
        `Client : ${order.name || "—"} <${order.email || "—"}>`,
        order.phone ? `Tél : ${order.phone}` : "",
        `Livraison :`,
        shipText,
        `ID : ${order.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
      html: buildEmailLayout({
        title: "Nouvelle commande",
        intro: "Une commande vient d’être payée sur la boutique.",
        rowsHtml,
        noteHtml: "Ouvre l’admin pour préparer l’expédition et ajouter le suivi.",
        cta: { href: `${base}/admin`, label: "Voir l’admin" },
      }),
    });
  }

  return results;
}

async function sendOrderShippedEmail(order, options = {}) {
  if (!order?.email) return { sent: false, reason: "no_email" };
  const subjectPrefix = options.subjectPrefix
    ? String(options.subjectPrefix)
    : "";
  const base = siteBaseUrl();
  const trackingText = [
    order.trackingNumber ? `N° de suivi : ${order.trackingNumber}` : "",
    order.trackingUrl ? `Lien : ${order.trackingUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const trackingHtml = [
    order.trackingNumber
      ? `<strong style="color:#1a1a1a;">${escapeHtml(order.trackingNumber)}</strong>`
      : "",
    order.trackingUrl
      ? `<a href="${escapeAttr(order.trackingUrl)}" style="color:#D05033;text-decoration:underline;font-weight:700;">Suivre mon colis</a>`
      : "",
  ]
    .filter(Boolean)
    .join("<br/>");

  const rowsHtml = [
    emailDetailRow("Produit", escapeHtml(order.productTitle)),
    trackingHtml ? emailDetailRow("Suivi", trackingHtml) : "",
  ].join("");

  return sendOrderEmail({
    to: order.email,
    subject: `${subjectPrefix}Votre commande a été expédiée — ${order.productTitle}`,
    text: [
      `Bonne nouvelle : votre commande a été expédiée.`,
      ``,
      `Produit : ${order.productTitle}`,
      trackingText,
      ``,
      `— Boutique Niels`,
      base,
    ]
      .filter(Boolean)
      .join("\n"),
    html: buildEmailLayout({
      title: "Commande expédiée",
      intro:
        "Bonne nouvelle : votre colis est en route. Merci pour votre confiance.",
      rowsHtml,
      noteHtml:
        "Conservez cet e-mail pour suivre l’acheminement de votre commande.",
      cta: order.trackingUrl
        ? { href: order.trackingUrl, label: "Suivre mon colis" }
        : { href: base, label: "Retour au site" },
    }),
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

module.exports = {
  hasBlob,
  emptyOrders,
  normalizeOrder,
  readOrdersBlob,
  writeOrdersBlob,
  upsertOrderFromSession,
  sendOrderPaidEmails,
  sendOrderShippedEmail,
  formatMoney,
};
