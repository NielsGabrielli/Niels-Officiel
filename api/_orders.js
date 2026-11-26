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

async function sendOrderPaidEmails(order) {
  const notify = String(
    process.env.ORDER_NOTIFY_EMAIL || process.env.CONTACT_EMAIL || ""
  ).trim();
  const money = formatMoney(order.amountTotal, order.currency);
  const shipText = formatShipping(order.shipping);

  if (order.email) {
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
        `Nous vous enverrons un e-mail dès l’expédition.`,
        `— Boutique Niels`,
      ]
        .filter(Boolean)
        .join("\n"),
      html: `
        <p>Merci pour votre commande !</p>
        <p><strong>Produit :</strong> ${escapeHtml(order.productTitle)}<br/>
        ${money ? `<strong>Montant :</strong> ${escapeHtml(money)}` : ""}</p>
        <p><strong>Adresse de livraison :</strong><br/>${escapeHtml(shipText).replace(/\n/g, "<br/>")}</p>
        <p>Nous vous enverrons un e-mail dès l’expédition.</p>
        <p>— Boutique Niels</p>
      `,
    });
  }

  if (notify) {
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
      html: `
        <p><strong>Nouvelle commande boutique</strong></p>
        <p>Produit : ${escapeHtml(order.productTitle)}<br/>
        ${money ? `Montant : ${escapeHtml(money)}<br/>` : ""}
        Client : ${escapeHtml(order.name || "—")} &lt;${escapeHtml(order.email || "—")}&gt;<br/>
        ${order.phone ? `Tél : ${escapeHtml(order.phone)}<br/>` : ""}
        ID : ${escapeHtml(order.id)}</p>
        <p>Livraison :<br/>${escapeHtml(shipText).replace(/\n/g, "<br/>")}</p>
      `,
    });
  }
}

async function sendOrderShippedEmail(order) {
  if (!order?.email) return { sent: false, reason: "no_email" };
  const tracking =
    order.trackingUrl ||
    (order.trackingNumber ? `N° de suivi : ${order.trackingNumber}` : "");
  return sendOrderEmail({
    to: order.email,
    subject: `Votre commande a été expédiée — ${order.productTitle}`,
    text: [
      `Bonne nouvelle : votre commande a été expédiée.`,
      ``,
      `Produit : ${order.productTitle}`,
      tracking,
      ``,
      `— Boutique Niels`,
    ]
      .filter(Boolean)
      .join("\n"),
    html: `
      <p>Bonne nouvelle : votre commande a été expédiée.</p>
      <p><strong>Produit :</strong> ${escapeHtml(order.productTitle)}</p>
      ${
        order.trackingUrl
          ? `<p><a href="${escapeAttr(order.trackingUrl)}">Suivre mon colis</a></p>`
          : order.trackingNumber
            ? `<p>N° de suivi : <strong>${escapeHtml(order.trackingNumber)}</strong></p>`
            : ""
      }
      <p>— Boutique Niels</p>
    `,
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
