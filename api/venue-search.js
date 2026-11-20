function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

function formatPhotonLabel(props) {
  const name = props.name || props.street || "";
  const city =
    props.city ||
    props.town ||
    props.village ||
    props.municipality ||
    props.county ||
    props.district ||
    "";
  const secondary = [
    props.street && props.name ? props.street : "",
    city,
    props.state || "",
    props.country || "",
  ]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(", ");
  const primary = name || city || "Lieu";
  const venueValue =
    city && name && name !== city
      ? `${name} — ${city}`
      : name || secondary || primary;
  return { primary, secondary, venueValue };
}

function formatBanLabel(feature) {
  const props = feature.properties || {};
  const primary = props.name || props.label || "Adresse";
  const secondary = [props.postcode, props.city, props.context]
    .filter(Boolean)
    .join(", ");
  const venueValue = props.label || primary;
  return { primary, secondary, venueValue };
}

async function searchPhoton(q) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=6`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "niels-officiel-admin/1.0" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  return features.map((f) => formatPhotonLabel(f.properties || {}));
}

async function searchBan(q) {
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const data = await res.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  return features.map(formatBanLabel);
}

function dedupeResults(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = String(item.venueValue || "")
      .toLowerCase()
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 8);
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const q = String(url.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    json(res, 200, { ok: true, results: [] });
    return;
  }

  try {
    const [photon, ban] = await Promise.all([
      searchPhoton(q).catch(() => []),
      searchBan(q).catch(() => []),
    ]);
    // Photon d'abord (salles / POI), puis adresses BAN
    const results = dedupeResults([...(photon || []), ...(ban || [])]);
    json(res, 200, { ok: true, results });
  } catch (err) {
    console.error("venue-search", err);
    json(res, 500, { ok: false, error: "search_failed", results: [] });
  }
};
