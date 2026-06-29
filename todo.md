# Todo — Site Niels

> Audit du 23 mars 2026 — intégrations techniques appliquées le 23 mars 2026.

---

## 🔴 Priorité haute — Contenu & fonctionnel

### Contenu manquant (placeholders à remplacer)
- [ ] **Bio** — Écrire et intégrer la bio courte (2-3 lignes hero) + bio longue (section bio)
- [ ] **Photo portrait** — Remplacer le placeholder `.media--portrait` par une vraie photo (section Bio)
- [ ] **Visuel musique** — Remplacer le placeholder `.media--landscape` par un visuel cover ou scène (section Musique)
- [ ] **Liens streaming** — Remplacer `href="#"` des boutons Spotify et YouTube par les vraies URLs
- [ ] **Discographie** — Renseigner le titre, l'année et la cover art du/des EP/albums
- [x] **Concerts** — Agenda géré via l’admin (`admin.html` → Section Concerts) : ajout/suppression de dates, export `concerts.json`, aperçu `?preview=1`, affichage public depuis `assets/concerts.json`
- [ ] **Concerts (contenu)** — Renseigner les vraies dates, lieux et liens de billetterie dans l’admin puis déployer le `concerts.json` généré
- [x] **Boutique** — Section accueil (≤3 produits), page `boutique.html` (>3), admin complet (ordre, publication, aperçu)
- [ ] **Boutique (contenu)** — Remplacer les visuels SVG par de vraies photos et connecter un vrai shop externe si besoin
- [ ] **Espace pro** — Créer et lier un vrai press kit (PDF) et une fiche technique derrière le bouton "Accéder"
- [x] **Mentions légales** — Page `mentions-legales.html` (éditeur, hébergeur, propriété intellectuelle)
- [x] **Confidentialité** — Page `confidentialite.html` (RGPD, cookies, formulaires, newsletter)

### Formulaires non fonctionnels
- [ ] **Formulaire Contact** — Brancher à un service d'envoi d'email (Formspree, EmailJS, Resend…)
  - Ajouter une vraie validation HTML5 (`required`, `type="email"`) et feedback visuel d'erreur
  - Afficher un message de succès clair après envoi
- [ ] **Newsletter** — Connecter le formulaire à Mailchimp, Brevo ou équivalent
  - Double opt-in recommandé pour conformité RGPD
  - Le champ email du formulaire sombre n'a pas d'attribut `required` → à corriger

### Police RocaOne manquante
- [x] La police **RocaOne** est déclarée via `local()` uniquement → **Playfair Display ajouté en fallback dans toute la CSS + Google Fonts chargée via `<link>` + preconnect**

---

## 🟠 Priorité moyenne — UX & interactivité

### Navigation
- [x] **Menu burger mobile** — Ajouté (bouton hamburger + toggle JS + menu déroulant sous 480px)
- [x] **Active link** — Ajouté (IntersectionObserver, lien actif en terracotta au scroll)

### Animations d'entrée
- [x] Animations d'apparition au scroll sur les sections (fade-in + translateY) via `IntersectionObserver`
- [x] Animation d'entrée hero (titre + sous-titre + CTA décalés via keyframes CSS)

### Section "Salon" (galerie)
- [ ] Les 4 tuiles `.tile` sont des placeholders vides → remplacer par de vraies photos (format `.webp` recommandé)
- [ ] Ajouter une lightbox ou un lien vers une page dédiée au format "Dans mon salon"

### Discographie — Lecteur Spotify
- [ ] Remplacer le placeholder `.player__frame` par le vrai iframe Spotify embed (album/playlist)
- [ ] Si plusieurs releases : envisager un carrousel ou des onglets pour naviguer entre elles

### Boutique
- [x] Les visuels produits sont gérés via l’admin (chemins images) — remplacer les SVG placeholder par de vraies photos optimisées

---

## 🟡 Priorité normale — SEO & performance

### SEO
- [x] Ajouté les balises **Open Graph** (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`)
- [x] Ajouté la balise **Twitter Card**
- [x] Ajouté `<link rel="canonical">`
- [x] Favicon SVG terracotta créé et lié (`favicon.svg`) + `apple-touch-icon`
- [x] Google Fonts déplacée vers `<link>` avec `rel="preconnect"` (Montserrat + Playfair Display)
- [ ] Remplacer le `favicon.ico` générique par une version PNG 180px
- [ ] Ajouter un `sitemap.xml` si le site est indexé

### Performance
- [x] Google Fonts via `<link>` avec `rel="preconnect"` ✓ (fait en même temps que le SEO)
- [ ] Ajouter `loading="lazy"` dès que de vraies `<img>` sont intégrées
- [ ] Optimiser les images en `.webp`
- [ ] Ajouter `<meta name="theme-color">` adapté pour Android Chrome (déjà présent mais à vérifier la valeur)
- [ ] Vérifier et corriger le score Lighthouse (Performance, Accessibilité, SEO, Bonnes pratiques)
- [x] `robots.txt` créé
- [ ] Le `package.json` n'a pas d'auteur ni de description → compléter
- [x] `.gitignore` ajouté (exclure `node_modules`, `dist`, `.DS_Store`)
- [ ] Ajouter `.nvmrc` ou `engines` dans `package.json`
- [x] **`required`** ajouté sur le champ email de la newsletter

---

## 🟢 Priorité basse — Améliorations futures

- [ ] **Page "Univers" / About** — Envisager une page dédiée avec une bio longue, galerie photos et texte éditorial
- [ ] **Vidéo hero** — Remplacer ou enrichir le fond du héro avec une vidéo courte en loop (`<video autoplay muted loop playsinline>`) pour plus d'impact
- [ ] **Mode clair (optionnel)** — Prévoir un toggle light/dark mode si l'univers graphique le permet
- [ ] **Sous-domaine ou page "Dans mon salon"** — Créer une landing page dédiée à ce format pour le booking de salons privés
- [ ] **Analytics** — Intégrer un outil de mesure d'audience respectueux de la vie privée (Plausible, Umami ou Google Analytics avec consentement)
- [x] **Cookie banner** — Bannière cookies techniques + pop-up Soundletter après acceptation
- [ ] **Accessibilité (a11y)** — Vérifier les contrastes (notamment le texte `.body--muted` en crème à 70% d'opacité sur fond noir), tester au clavier et avec un lecteur d'écran
- [ ] **Smooth scroll** polyfill — Le `scroll-behavior: smooth` CSS n'est pas supporté sur certains anciens Safari mobiles ; envisager un polyfill JS léger
