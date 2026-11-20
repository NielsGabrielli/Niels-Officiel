#!/usr/bin/env node
/**
 * Génère les secrets pour l'auth admin (Vercel env vars).
 *
 * Usage:
 *   node scripts/generate-admin-auth.mjs
 *   node scripts/generate-admin-auth.mjs --username niels --password 'MonMotDePasse'
 *   node scripts/generate-admin-auth.mjs --extra --username koma.collectif@gmail.com
 *
 * Modes :
 * - défaut : 4 variables legacy (ADMIN_USERNAME, HASH, TOTP, SESSION)
 * - --extra : génère un compte supplémentaire à coller dans ADMIN_USERS (JSON)
 *
 * Alias (même MDP/TOTP que le compte principal) :
 *   ADMIN_USERNAME_ALIASES=koma.collectif@gmail.com
 */

import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import * as OTPAuth from "otpauth";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function parseArgs(argv) {
  const out = { extra: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--username" || a === "-u") out.username = argv[++i];
    else if (a === "--password" || a === "-p") out.password = argv[++i];
    else if (a === "--extra") out.extra = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function randomPassword(length = 20) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.randomBytes(length);
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
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

async function promptMissing(args) {
  if (args.username && args.password) return args;
  const rl = readline.createInterface({ input, output });
  try {
    const username =
      args.username ||
      (await rl.question("Identifiant admin [niels]: ")).trim() ||
      "niels";
    let password = args.password;
    if (!password) {
      const entered = (
        await rl.question("Mot de passe (vide = générer): ")
      ).trim();
      password = entered || randomPassword(20);
    }
    return { ...args, username, password };
  } finally {
    rl.close();
  }
}

function printTotp(username, totpSecret) {
  const totp = new OTPAuth.TOTP({
    issuer: "Niels Admin",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: totpSecret,
  });
  const otpauthUri = totp.toString();
  console.log("\n=== 2FA TOTP ===\n");
  console.log("Scannez cette URI avec Google Authenticator / Authy / Microsoft Authenticator :");
  console.log(otpauthUri);
  console.log("\nQR :");
  console.log(
    `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUri)}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/generate-admin-auth.mjs
  node scripts/generate-admin-auth.mjs --username niels --password 'SecretFort'
  node scripts/generate-admin-auth.mjs --extra --username koma.collectif@gmail.com

Variables Vercel:
  ADMIN_USERNAME / ADMIN_PASSWORD_HASH / ADMIN_TOTP_SECRET / ADMIN_SESSION_SECRET
  ADMIN_USERS                 (JSON comptes supplémentaires)
  ADMIN_USERNAME_ALIASES      (emails séparés par virgule, même MDP/TOTP)`);
    process.exit(0);
  }

  const { username, password, extra } = await promptMissing(args);
  const passwordHash = hashPassword(password);
  const totpSecret = new OTPAuth.Secret({ size: 20 });

  console.log("\n=== Identifiants (à conserver hors git) ===\n");
  console.log(`Username : ${username}`);
  console.log(`Password : ${password}`);

  if (extra) {
    const entry = {
      username,
      passwordHash,
      totpSecret: totpSecret.base32,
    };
    console.log("\n=== Variable Vercel à ajouter / fusionner ===\n");
    console.log("ADMIN_USERS=" + JSON.stringify([entry]));
    console.log(
      "\nSi ADMIN_USERS existe déjà, ajoutez cet objet dans le tableau JSON existant."
    );
    console.log(
      "Gardez ADMIN_SESSION_SECRET (et le compte principal) tels quels."
    );
  } else {
    const sessionSecret = crypto.randomBytes(32).toString("hex");
    console.log("\n=== Variables d'environnement Vercel ===\n");
    console.log(`ADMIN_USERNAME=${username}`);
    console.log(`ADMIN_PASSWORD_HASH=${passwordHash}`);
    console.log(`ADMIN_TOTP_SECRET=${totpSecret.base32}`);
    console.log(`ADMIN_SESSION_SECRET=${sessionSecret}`);
    console.log(
      "\nOption alias (même MDP/2FA, autre email) :\nADMIN_USERNAME_ALIASES=koma.collectif@gmail.com"
    );
  }

  printTotp(username, totpSecret);
  console.log(
    "\nEnsuite : Vercel → Settings → Environment Variables → Redeploy."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
