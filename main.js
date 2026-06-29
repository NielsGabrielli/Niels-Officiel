const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ── Header elevation ── */
function setHeaderElevation() {
  const header = $("[data-elevate]");
  if (!header) return;
  header.classList.toggle("is-elevated", window.scrollY > 8);
}

/* ── Hero title fit ── */
function fitHeroTitleToSubtitle() {
  const hero = $(".hero");
  if (!hero) return;
  const title = $(".title", hero);
  const subtitle = $(".subtitle", hero);
  if (!title || !subtitle) return;
  title.style.fontSize = "";
  const targetWidth = subtitle.getBoundingClientRect().width;
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) return;
  const computed = window.getComputedStyle(title);
  const baseFontPx = Number.parseFloat(computed.fontSize) || 72;
  const minPx = 64, maxPx = 240;
  let lo = minPx, hi = maxPx;
  let best = Math.min(maxPx, Math.max(minPx, baseFontPx));
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    title.style.fontSize = `${mid}px`;
    const w = title.getBoundingClientRect().width;
    if (!Number.isFinite(w) || w <= 0) break;
    best = mid;
    if (w < targetWidth) lo = mid; else hi = mid;
  }
  title.style.fontSize = `${best}px`;
}

/* ── Forms ── */
function wireForms() {
  const contactForm = $("#contactForm");
  const contactHint = $("#contactHint");
  if (contactForm && contactHint) {
    contactForm.addEventListener("submit", (e) => {
      e.preventDefault();
      contactHint.textContent =
        "Formulaire en mode maquette (aucun envoi). Branche-le à un service (Formspree, EmailJS…).";
    });
  }
  const newsletterForm = $("#newsletterForm");
  const newsletterHint = $("#newsletterHint");
  if (newsletterForm && newsletterHint) {
    newsletterForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(newsletterForm);
      const email = String(data.get("email") || "").trim();
      const consent = Boolean(data.get("consent"));
      if (!email) { newsletterHint.textContent = "Ajoute un email pour t'inscrire."; return; }
      if (!consent) { newsletterHint.textContent = "Merci de cocher le consentement."; return; }
      newsletterHint.textContent =
        "Inscription en mode maquette (aucun envoi). Connecte à Mailchimp/Brevo ensuite.";
    });
  }
}

/* ── Burger menu ── */
function wireBurger() {
  const burger = $(".nav__burger");
  const nav = $(".nav");
  if (!burger || !nav) return;
  burger.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(isOpen));
  });
  $$(".nav__link").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
    });
  });
}

/* ── Active nav on scroll ── */
function wireActiveNav() {
  const sections = $$("section[id]");
  const links = $$(".nav__link[href^='#']");
  if (!sections.length || !links.length) return;
  const getLink = (id) => links.find((l) => l.getAttribute("href") === `#${id}`);
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((l) => l.classList.remove("is-active"));
        const link = getLink(entry.target.id);
        if (link) link.classList.add("is-active");
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );
  sections.forEach((s) => observer.observe(s));
}

/* ── Reveal on scroll ── */
function wireReveal() {
  const items = $$(".reveal");
  if (!items.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  items.forEach((el) => observer.observe(el));
}

/* ── Scroll / resize ── */
window.addEventListener("scroll", setHeaderElevation, { passive: true });
let __fitRaf = 0;
function scheduleHeroFit() {
  if (__fitRaf) return;
  __fitRaf = window.requestAnimationFrame(() => { __fitRaf = 0; fitHeroTitleToSubtitle(); });
}
window.addEventListener("resize", scheduleHeroFit, { passive: true });

/* ── Hero parallax (subtil) ── */
function wireHeroParallax() {
  const media = $(".hero__media");
  if (!media) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMotion.matches) return;

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      const y = Math.min(32, window.scrollY * 0.12);
      media.style.setProperty("--hero-parallax-y", `${y}px`);
    });
  };

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/* ── Music image parallax (subtil) ── */
function wireMusicParallax() {
  const media = $(".music__media");
  if (!media) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMotion.matches) return;

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      const y = Math.min(24, window.scrollY * 0.08);
      media.style.setProperty("--music-parallax-y", `${y}px`);
    });
  };

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, "&#39;");
}

const CONCERTS_STORAGE_KEY = "niels_concerts_v1";
const SHOP_STORAGE_KEY = "niels_shop_v1";

function concertIsPast(dateIso) {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  const eventDay = new Date(`${dateIso}T12:00:00`);
  const today = new Date();
  eventDay.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return eventDay < today;
}

function sortConcertsForDisplay(items) {
  return [...items].sort((a, b) => {
    const pastA = concertIsPast(a.dateIso);
    const pastB = concertIsPast(b.dateIso);
    if (pastA !== pastB) return pastA ? 1 : -1;
    const isoA = a.dateIso && /^\d{4}-\d{2}-\d{2}$/.test(a.dateIso) ? a.dateIso : "9999-12-31";
    const isoB = b.dateIso && /^\d{4}-\d{2}-\d{2}$/.test(b.dateIso) ? b.dateIso : "9999-12-31";
    if (pastA) return isoB.localeCompare(isoA);
    return isoA.localeCompare(isoB);
  });
}

function formatConcertDateDisplay(c) {
  if (c.dateIso && /^\d{4}-\d{2}-\d{2}$/.test(c.dateIso)) {
    const d = new Date(`${c.dateIso}T12:00:00`);
    const long = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
    return long.charAt(0).toUpperCase() + long.slice(1);
  }
  const bits = [c.dateLabel, c.year].filter(Boolean);
  return bits.length ? bits.join(" · ") : "—";
}

async function loadConcertsData() {
  try {
    const raw = localStorage.getItem(CONCERTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.concerts)) return parsed;
    }
  } catch {
    /* fichier JSON par défaut */
  }
  const res = await fetch("./assets/concerts.json", { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function renderConcerts(data) {
  const introEl = $("#concertsIntro");
  const mount = $("#concertsMount");
  if (!mount) return;
  mount.removeAttribute("aria-busy");
  const intro = data && typeof data.intro === "string" ? data.intro.trim() : "";
  if (introEl) {
    if (intro) {
      introEl.textContent = intro;
      introEl.removeAttribute("hidden");
    } else {
      introEl.textContent = "";
      introEl.setAttribute("hidden", "");
    }
  }
  const items = Array.isArray(data?.concerts) ? sortConcertsForDisplay(data.concerts) : [];
  if (!items.length) {
    mount.innerHTML =
      '<p class="body body--muted concerts__empty">Aucune date annoncée pour le moment.</p>';
    return;
  }
  mount.innerHTML = items
    .map((c) => {
      const dateLine = escapeHtml(formatConcertDateDisplay(c));
      const venue = escapeHtml(c.venue || "");
      const type = escapeHtml(c.type || "");
      const past = concertIsPast(c.dateIso);
      const rawUrl = String(c.bookingUrl || "").trim();
      const hasUrl = /^https?:\/\//i.test(rawUrl);
      const href = hasUrl ? escapeAttr(rawUrl) : "#contact";
      const external = hasUrl ? ' target="_blank" rel="noopener noreferrer"' : "";
      let ctaHtml;
      if (past) {
        ctaHtml =
          '<span class="btn btn--ghost btn--small concert-card__done" role="status">Terminé</span>';
      } else if (hasUrl) {
        ctaHtml = `<a class="btn btn--primary btn--small" href="${href}"${external} aria-label="${escapeAttr(`Réserver — ${formatConcertDateDisplay(c)}`)}">Réserver</a>`;
      } else {
        ctaHtml = `<a class="btn btn--ghost btn--small" href="#contact" aria-label="${escapeAttr(`Contacter — ${formatConcertDateDisplay(c)}`)}">Bientôt — contact</a>`;
      }
      const cardClass = past ? "concert-card concert-card--past" : "concert-card";
      return `<article class="${cardClass}"${past ? ' data-past="true"' : ""}>
      <div class="concert-card__meta">
        <p class="concert-card__date">${dateLine}</p>
        <p class="concert-card__venue">${venue}</p>
      </div>
      <p class="concert-card__type">${type}</p>
      <div class="concert-card__cta">
        ${ctaHtml}
      </div>
    </article>`;
    })
    .join("");
}

async function wireConcerts() {
  try {
    const data = await loadConcertsData();
    renderConcerts(data);
  } catch {
    const introEl = $("#concertsIntro");
    if (introEl) {
      introEl.textContent = "Impossible de charger l’agenda pour le moment.";
      introEl.removeAttribute("hidden");
    }
    const mount = $("#concertsMount");
    if (mount) {
      mount.removeAttribute("aria-busy");
      mount.innerHTML =
        '<p class="body body--muted concerts__empty">Contenu indisponible.</p>';
    }
  }
}

async function loadShopData() {
  try {
    const raw = localStorage.getItem(SHOP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.products)) return parsed;
    }
  } catch {
    /* JSON par défaut */
  }
  const res = await fetch("./assets/shop.json", { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

let shopProductsCache = [];
let shopModalMeta = { cmsCtaLabel: "Voir la fiche produit" };
let shopModalLastFocus = null;

function isCmsProductUrl(s) {
  const u = String(s || "").trim();
  if (!u || /^javascript:/i.test(u)) return false;
  return /^https?:\/\//i.test(u) || /^\/\S/.test(u);
}

function renderShop(data) {
  const mount = $("#shopProducts");
  const cta = $("#shopCta");
  const introEl = $("#shopIntro");
  if (!mount) return;
  mount.removeAttribute("aria-busy");

  const intro = data && typeof data.intro === "string" ? data.intro.trim() : "";
  if (introEl) {
    if (intro) {
      introEl.textContent = intro;
      introEl.removeAttribute("hidden");
    } else {
      introEl.textContent = "";
      introEl.setAttribute("hidden", "");
    }
  }

  shopModalMeta.cmsCtaLabel =
    String(data?.cmsCtaLabel || "Voir la fiche produit").trim() || "Voir la fiche produit";

  const shopUrl = String(data?.shopUrl || "").trim();
  if (cta) {
    const label = String(data?.shopCtaLabel || "Le shop").trim() || "Le shop";
    cta.textContent = label;
    if (/^https?:\/\//i.test(shopUrl)) {
      cta.setAttribute("href", shopUrl);
      cta.setAttribute("target", "_blank");
      cta.setAttribute("rel", "noopener noreferrer");
      cta.setAttribute("aria-label", `${label} (nouvel onglet)`);
    } else {
      cta.setAttribute("href", "#contact");
      cta.removeAttribute("target");
      cta.removeAttribute("rel");
      cta.setAttribute("aria-label", "Contacter pour la boutique");
    }
  }

  const items = Array.isArray(data?.products) ? data.products : [];
  shopProductsCache = items;

  if (!items.length) {
    mount.innerHTML =
      '<p class="body body--muted products__empty">Aucun produit pour le moment.</p>';
    return;
  }

  mount.innerHTML = items
    .map((p) => {
      const id = escapeAttr(String(p.id || ""));
      const title = escapeHtml(p.title || "Produit");
      const desc = escapeHtml(p.description || "");
      const priceRaw = String(p.price || "").trim();
      const priceHtml = priceRaw
        ? `<p class="product__price">${escapeHtml(priceRaw)}</p>`
        : "";
      const imgPath = String(p.image || "").trim();
      const imgAlt = escapeAttr(String(p.title || "Produit"));
      const imgHtml = imgPath
        ? `<img src="${escapeAttr(imgPath)}" alt="${imgAlt}" width="800" height="600" loading="lazy" decoding="async" />`
        : "";
      return `<article class="product">
  <button type="button" class="product-card__open" data-product-id="${id}" aria-haspopup="dialog" aria-label="${escapeAttr(`Détails — ${p.title || "Produit"}`)}">
    <div class="product__img">${imgHtml}</div>
    <div class="product__info">
      <h3 class="h3">${title}</h3>
      <p class="body body--muted">${desc}</p>
      ${priceHtml}
    </div>
  </button>
</article>`;
    })
    .join("");
}

function openShopModal(product) {
  const modal = $("#shopModal");
  const titleEl = $("#shopModalTitle");
  const descEl = $("#shopModalDesc");
  const detailEl = $("#shopModalDetail");
  const priceEl = $("#shopModalPrice");
  const mediaEl = $("#shopModalMedia");
  const cmsBtn = $("#shopModalCms");
  if (!modal || !product) return;

  const title = String(product.title || "Produit");
  const desc = String(product.description || "");
  const detail = String(product.detail || "").trim();
  const price = String(product.price || "").trim();
  const imgPath = String(product.image || "").trim();
  const cmsUrl = String(product.cmsPageUrl || "").trim();

  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;
  if (detailEl) {
    if (detail) {
      detailEl.textContent = detail;
      detailEl.removeAttribute("hidden");
    } else {
      detailEl.textContent = "";
      detailEl.setAttribute("hidden", "");
    }
  }
  if (priceEl) {
    if (price) {
      priceEl.textContent = price;
      priceEl.removeAttribute("hidden");
    } else {
      priceEl.textContent = "";
      priceEl.setAttribute("hidden", "");
    }
  }
  if (mediaEl) {
    if (imgPath) {
      const alt = escapeAttr(title);
      mediaEl.innerHTML = `<img src="${escapeAttr(imgPath)}" alt="${alt}" width="800" height="600" decoding="async" />`;
    } else {
      mediaEl.innerHTML = "";
    }
  }
  if (cmsBtn) {
    const label = shopModalMeta.cmsCtaLabel;
    cmsBtn.textContent = label;
    if (isCmsProductUrl(cmsUrl)) {
      cmsBtn.setAttribute("href", cmsUrl);
      const ext = /^https?:\/\//i.test(cmsUrl);
      if (ext) {
        cmsBtn.setAttribute("target", "_blank");
        cmsBtn.setAttribute("rel", "noopener noreferrer");
      } else {
        cmsBtn.removeAttribute("target");
        cmsBtn.removeAttribute("rel");
      }
      cmsBtn.removeAttribute("hidden");
      cmsBtn.setAttribute("aria-label", `${label} — ${title}`);
    } else {
      cmsBtn.setAttribute("hidden", "");
      cmsBtn.removeAttribute("href");
    }
  }

  shopModalLastFocus = document.activeElement;
  modal.removeAttribute("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("shop-modal-open");

  const closeBtn = $("#shopModalClose");
  if (closeBtn) closeBtn.focus();
}

function closeShopModal() {
  const modal = $("#shopModal");
  if (!modal || modal.hasAttribute("hidden")) return;
  modal.setAttribute("hidden", "");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("shop-modal-open");
  if (shopModalLastFocus && typeof shopModalLastFocus.focus === "function") {
    shopModalLastFocus.focus();
  }
  shopModalLastFocus = null;
}

let shopModalListenersBound = false;

function wireShopModals() {
  const modal = $("#shopModal");
  const closeBtn = $("#shopModalClose");
  if (!modal || shopModalListenersBound) return;
  shopModalListenersBound = true;

  modal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.closest && t.closest("[data-shop-modal-close]")) closeShopModal();
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeShopModal());
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hasAttribute("hidden")) {
      e.preventDefault();
      closeShopModal();
    }
  });
}

function wireShopProductButtons() {
  const mount = $("#shopProducts");
  if (!mount) return;
  mount.querySelectorAll(".product-card__open[data-product-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-product-id");
      const product = shopProductsCache.find((p) => String(p.id) === String(id));
      openShopModal(product);
    });
  });
}

async function wireShop() {
  try {
    const data = await loadShopData();
    renderShop(data);
    wireShopProductButtons();
    wireShopModals();
  } catch {
    const mount = $("#shopProducts");
    if (mount) {
      mount.removeAttribute("aria-busy");
      mount.innerHTML =
        '<p class="body body--muted products__empty">Contenu indisponible.</p>';
    }
  }
}

/** Aligné sur scripts/fetch-salon-videos.mjs */
const SALON_CHANNEL_ID = "UC2kQJLBeSQ5dcpI1VsUkMAQ";
const SALON_RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${SALON_CHANNEL_ID}`;
const SALON_FILTER = /dans\s*mon\s*salon/i;
const SALON_MAX = 5;
const SALON_EXCLUDE_SHORTS = true;

function salonDecodeXml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function salonParseFeedXml(xml) {
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
    const title = salonDecodeXml(titleM[1]);
    const desc = descM ? salonDecodeXml(descM[1]) : "";
    if (!SALON_FILTER.test(`${title} ${desc}`)) continue;
    const id = vid[1];
    const url = linkM ? linkM[1] : `https://www.youtube.com/watch?v=${id}`;
    if (SALON_EXCLUDE_SHORTS && url.includes("/shorts/")) continue;
    videos.push({
      id,
      title,
      thumbnail: thumbM ? thumbM[1] : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url,
    });
  }
  return videos;
}

async function salonFetchText(url, timeoutMs = 16000) {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return await res.text();
  } finally {
    window.clearTimeout(t);
  }
}

/** YouTube ne sert pas le RSS avec CORS ; on passe par des proxys publics. */
async function salonFetchRssXml(timeoutMs = 7000) {
  const rss = SALON_RSS_URL;
  const proxyUrls = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(rss)}`,
    `https://corsproxy.io/?${encodeURIComponent(rss)}`,
  ];
  let lastErr;
  for (const p of proxyUrls) {
    try {
      const xml = await salonFetchText(p, timeoutMs);
      if (xml && xml.includes("<yt:videoId>")) return xml;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("RSS");
}

async function salonLoadVideosFromJson() {
  try {
    const res = await fetch("./assets/salon-videos.json", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const videos = Array.isArray(data.videos) ? data.videos : [];
    return videos.slice(0, SALON_MAX);
  } catch {
    return [];
  }
}

async function salonLoadVideosFromRss(timeoutMs = 6500) {
  const xml = await salonFetchRssXml(timeoutMs);
  const list = salonParseFeedXml(xml).slice(0, SALON_MAX);
  return list;
}

function salonChunkPairs(videos) {
  const out = [];
  for (let i = 0; i < videos.length; i += 2) out.push(videos.slice(i, i + 2));
  return out;
}

function salonRenderGallery(root, videos) {
  root.classList.remove("salon__gallery--loading");
  root.removeAttribute("aria-busy");
  if (!videos.length) {
    root.innerHTML =
      '<p class="body salon__gallery-empty">Aucune vidéo « Dans mon salon » pour le moment.</p>';
    return;
  }
  const pairs = salonChunkPairs(videos);
  root.innerHTML = pairs
    .map((pair, si) => {
      const cards = pair
        .map((v, j) => {
          const i = si * 2 + j;
          const titleHtml = escapeHtml(v.title);
          const aria = escapeAttr(`Ouvrir sur YouTube : ${v.title}`);
          const url = escapeAttr(v.url);
          const thumb = escapeAttr(v.thumbnail);
          return `<a class="tile tile--link" style="--salon-i:${i}" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${aria}">
        <img class="tile__thumb" src="${thumb}" alt="" loading="lazy" width="480" height="270" decoding="async" />
        <span class="tile__label">${titleHtml}</span>
      </a>`;
        })
        .join("");
      return `<div class="salon__stack" style="--stack-i:${si}" role="group" aria-label="Vidéos ${si * 2 + 1}–${si * 2 + pair.length}">${cards}</div>`;
    })
    .join("");
}

async function wireSalonGallery() {
  const root = $("#salonGallery");
  if (!root) return;
  // 1) Rendu immédiat depuis le JSON local (fiable/offline).
  const jsonVideos = await salonLoadVideosFromJson();
  salonRenderGallery(root, jsonVideos);

  // 2) Mise à jour "best effort" via RSS, sans bloquer l'affichage.
  salonLoadVideosFromRss(6500)
    .then((rssVideos) => {
      if (rssVideos && rssVideos.length) salonRenderGallery(root, rssVideos);
    })
    .catch(() => {});
}

/* ── Discographie : vinyle piloté par interaction embed (play/pause) ── */
const vinylPlayback = { setPlaying: null, toggle: null };

function wireDiscographyVinyl() {
  const disc = $("#vinylDisc");
  const icon = $("#vinylDiscIcon");
  if (!disc) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let angle = 0;
  let angularVelocity = 0;
  let targetAngularVelocity = 0;
  let isPlaying = false;
  let lastTime = performance.now();

  const TARGET_RAD_PER_SEC = (Math.PI * 2) / 4;
  const TAU_SEC = 0.48;

  function setPlaying(playing) {
    isPlaying = Boolean(playing);
    if (reduceMotion.matches) return;
    targetAngularVelocity = isPlaying ? TARGET_RAD_PER_SEC : 0;
  }

  function togglePlaying() {
    setPlaying(!isPlaying);
  }

  vinylPlayback.setPlaying = setPlaying;
  vinylPlayback.toggle = togglePlaying;

  function tick(now) {
    requestAnimationFrame(tick);
    if (reduceMotion.matches) return;

    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    const alpha = 1 - Math.exp(-dt / TAU_SEC);
    angularVelocity += (targetAngularVelocity - angularVelocity) * alpha;

    angle += angularVelocity * dt;
    const deg = (angle * 180) / Math.PI;
    disc.style.transform = `rotate(${deg}deg)`;
    if (icon) icon.style.transform = `rotate(${deg}deg)`;
  }

  requestAnimationFrame(tick);
}

function wireDiscographyEmbedPlayToggle() {
  const embed = document.querySelector('iframe[data-testid="embed-iframe"]');
  if (!embed) return;
  // Fallback: certains navigateurs renvoient des événements pointer/click au conteneur iframe.
  embed.addEventListener(
    "pointerdown",
    () => {
      if (vinylPlayback.toggle) vinylPlayback.toggle();
    },
    { capture: true }
  );
}

function wireDiscographySpotifyPlaybackMessages() {
  const embed = document.querySelector('iframe[data-testid="embed-iframe"]');
  if (!embed) return;

  // Certains embeds Spotify communiquent via postMessage (isPaused / playback_update).
  // On garde une logique robuste pour différents formats de payload.
  window.addEventListener("message", (event) => {
    if (!event || !event.data) return;
    const originOk = typeof event.origin === "string" && event.origin.includes("open.spotify.com");
    // On ne bloque pas strictement par origin pour éviter des faux négatifs.
    if (!originOk) return;

    const payload = event.data;
    const findIsPaused = (obj) => {
      if (!obj || typeof obj !== "object") return null;
      if (typeof obj.isPaused === "boolean") return obj.isPaused;
      if (obj.data && typeof obj.data === "object" && typeof obj.data.isPaused === "boolean") return obj.data.isPaused;
      if (obj.payload && typeof obj.payload === "object" && typeof obj.payload.isPaused === "boolean") return obj.payload.isPaused;
      return null;
    };

    const isPaused = findIsPaused(payload);
    if (typeof isPaused === "boolean") {
      const playing = !isPaused;
      if (vinylPlayback.setPlaying) vinylPlayback.setPlaying(playing);
    }
  });
}

window.addEventListener("load", () => {
  setHeaderElevation();
  wireForms();
  wireBurger();
  wireActiveNav();
  wireReveal();
  wireHeroParallax();
  wireMusicParallax();
  scheduleHeroFit();
  wireSalonGallery();
  wireConcerts();
  wireShop();
  wireDiscographyVinyl();
  wireDiscographyEmbedPlayToggle();
  wireDiscographySpotifyPlaybackMessages();
});
