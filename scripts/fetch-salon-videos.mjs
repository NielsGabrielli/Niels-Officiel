/**
 * Récupère le flux RSS du canal et garde les vidéos dont le titre ou la description
 * contient « Dans mon salon » (insensible à la casse), les 5 plus récentes.
 * Nécessite le réseau. Sortie : assets/salon-videos.json (repli si le flux live échoue).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const CHANNEL_ID = "UC2kQJLBeSQ5dcpI1VsUkMAQ";
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const FILTER = /dans\s*mon\s*salon/i;
const MAX_VIDEOS = 5;
const EXCLUDE_SHORTS = true;

function decodeXml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseEntries(xml) {
  const videos = [];
  const parts = xml.split(/<entry>/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].split(/<\/entry>/)[0];
    const vid = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(block);
    const titleM = /<title>([^<]*)<\/title>/.exec(block);
    const descM = /<media:description>([\s\S]*?)<\/media:description>/.exec(block);
    const thumbM = /url="(https:\/\/i[^"]+hqdefault[^"]+)"/.exec(block);
    const linkM =
      /<link[^>]+rel="alternate"[^>]+href="([^"]+)"/.exec(block) ||
      /<link[^>]+href="([^"]+)"[^>]+rel="alternate"/.exec(block);
    if (!vid || !titleM) continue;
    const title = decodeXml(titleM[1]);
    const desc = descM ? decodeXml(descM[1]) : "";
    if (!FILTER.test(`${title} ${desc}`)) continue;
    const id = vid[1];
    const url = linkM ? linkM[1] : `https://www.youtube.com/watch?v=${id}`;
    if (EXCLUDE_SHORTS && url.includes("/shorts/")) continue;
    videos.push({
      id,
      title,
      thumbnail: thumbM ? thumbM[1] : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url,
    });
  }
  return videos;
}

async function main() {
  const res = await fetch(RSS_URL);
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  const xml = await res.text();
  const videos = parseEntries(xml).slice(0, MAX_VIDEOS);
  const out = {
    channelId: CHANNEL_ID,
    channelUrl: "https://www.youtube.com/@niels.officiel/videos",
    updatedAt: new Date().toISOString(),
    videos,
  };
  const dest = path.join(ROOT, "assets", "salon-videos.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`OK — ${videos.length} vidéo(s) → ${path.relative(ROOT, dest)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
