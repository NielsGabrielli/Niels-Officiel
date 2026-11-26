/**
 * Envoie les templates e-mail boutique (confirmation + expédition) à une adresse.
 * Usage:
 *   BREVO_API_KEY=... ORDER_FROM_EMAIL='Niels <contact@niels-officiel.fr>' \
 *     node scripts/send-email-previews.mjs koma.collectif@gmail.com
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  raw.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  });
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const to = String(process.argv[2] || "koma.collectif@gmail.com").trim();
if (!to.includes("@")) {
  console.error("Adresse e-mail invalide.");
  process.exit(1);
}

if (!process.env.BREVO_API_KEY && !process.env.SENDINBLUE_API_KEY) {
  console.error(
    "BREVO_API_KEY manquante. Crée .env.local avec BREVO_API_KEY=... puis relance."
  );
  process.exit(1);
}

process.env.ORDER_FROM_EMAIL =
  process.env.ORDER_FROM_EMAIL || "Niels <contact@niels-officiel.fr>";
process.env.ORDER_NOTIFY_EMAIL = "";
process.env.CONTACT_EMAIL = "";
process.env.SITE_URL = process.env.SITE_URL || "https://www.niels-officiel.fr";

const {
  sendOrderPaidEmails,
  sendOrderShippedEmail,
} = require("../api/_orders.js");

const sampleOrder = {
  id: "ord_preview_demo",
  stripeSessionId: "cs_test_preview",
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
};

const paid = await sendOrderPaidEmails(sampleOrder);
const shipped = await sendOrderShippedEmail({
  ...sampleOrder,
  status: "shipped",
});

console.log("Confirmation client:", paid === undefined ? "envoyée (voir logs)" : paid);
console.log("Expédition client:", shipped);
console.log(`Préviews envoyées à ${to}`);
