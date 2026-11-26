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
        <td style="padding:8px 0 0;">
          <a href="${escapeAttr(cta.href)}" style="display:inline-block;background:#D05033;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:14px 22px;border-radius:999px;">
            ${escapeHtml(cta.label)}
          </a>
        </td>
      </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0f0f0f;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f0f0f;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#161616;border:1px solid rgba(229,210,187,0.18);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 18px;text-align:center;background:linear-gradient(180deg,rgba(208,80,51,0.18),transparent);">
              <a href="${escapeAttr(base)}" style="text-decoration:none;">
                <img src="${escapeAttr(logoUrl)}" width="160" alt="Niels" style="display:inline-block;height:auto;border:0;max-width:160px;" />
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
              <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:rgba(255,255,255,0.78);">${intro}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f0f0f;border:1px solid rgba(229,210,187,0.14);border-radius:12px;">
                <tr>
                  <td style="padding:18px 18px 8px;">
                    ${rowsHtml}
                  </td>
                </tr>
              </table>
              ${noteHtml ? `<p style="margin:20px 0 0;font-size:14px;line-height:1.55;color:rgba(255,255,255,0.72);">${noteHtml}</p>` : ""}
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:24px;">
                ${ctaHtml}
              </table>
              <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:rgba(229,210,187,0.55);">
                Boutique officielle · <a href="${escapeAttr(base)}" style="color:#D05033;text-decoration:none;">niels-officiel.fr</a>
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
  return `<p style="margin:0 0 14px;">
    <span style="display:block;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(229,210,187,0.55);margin-bottom:4px;">${escapeHtml(label)}</span>
    <span style="display:block;font-size:15px;line-height:1.45;color:#ffffff;">${valueHtml}</span>
  </p>`;
}

async function sendOrderPaidEmails(order) {
  const notify = String(
    process.env.ORDER_NOTIFY_EMAIL || process.env.CONTACT_EMAIL || ""
  ).trim();
  const money = formatMoney(order.amountTotal, order.currency);
  const shipText = formatShipping(order.shipping);
  const shipHtml = escapeHtml(shipText).replace(/\n/g, "<br/>");
  const base = siteBaseUrl();

  if (order.email) {
    const rowsHtml = [
      emailDetailRow("Produit", escapeHtml(order.productTitle)),
      money ? emailDetailRow("Montant", escapeHtml(money)) : "",
      order.email ? emailDetailRow("E-mail", escapeHtml(order.email)) : "",
      shipText && shipText !== "—"
        ? emailDetailRow("Adresse de livraison", shipHtml)
        : "",
    ].join("");

    await sendOrderEmail({
      to: order.email,
      subject: `Confirmation de commande — ${order.productTitle}`,
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

    await sendOrderEmail({
      to: notify,
      subject: `Nouvelle commande — ${order.productTitle}`,
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
        noteHtml: "",
        cta: { href: `${base}/admin`, label: "Voir l’admin" },
      }),
    });
  }
}

async function sendOrderShippedEmail(order) {
  if (!order?.email) return { sent: false, reason: "no_email" };
  const base = siteBaseUrl();
  const trackingText =
    order.trackingUrl ||
    (order.trackingNumber ? `N° de suivi : ${order.trackingNumber}` : "");
  const trackingHtml = order.trackingUrl
    ? `<a href="${escapeAttr(order.trackingUrl)}" style="color:#D05033;text-decoration:none;font-weight:700;">Suivre mon colis</a>${
        order.trackingNumber
          ? `<br/><span style="color:rgba(255,255,255,0.75);">N° ${escapeHtml(order.trackingNumber)}</span>`
          : ""
      }`
    : order.trackingNumber
      ? escapeHtml(order.trackingNumber)
      : "";

  const rowsHtml = [
    emailDetailRow("Produit", escapeHtml(order.productTitle)),
    trackingHtml ? emailDetailRow("Suivi", trackingHtml) : "",
  ].join("");

  return sendOrderEmail({
    to: order.email,
    subject: `Votre commande a été expédiée — ${order.productTitle}`,
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
      noteHtml: "Conservez cet e-mail pour suivre l’acheminement de votre commande.",
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
