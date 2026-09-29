// Visitor mode: export a trip with randomized coordinates and masked names,
// share via URL hash + QR code, and load/render the trip in read-only mode.

const VISITOR_RADIUS_KM = 2;
const VISITOR_QR_LIB = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js";
const VISITOR_QR_MAX = 2200;

let qrLibPromise = null;
function loadQrLib() {
  if (qrLibPromise) return qrLibPromise;
  qrLibPromise = new Promise((resolve, reject) => {
    if (window.qrcode) return resolve(window.qrcode);
    const s = document.createElement("script");
    s.src = VISITOR_QR_LIB;
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => { qrLibPromise = null; reject(new Error("qr lib")); };
    document.head.appendChild(s);
  });
  return qrLibPromise;
}

function randomOffsetLatLng(latLng, rand = Math.random) {
  if (!latLng || latLng.length !== 2) return null;
  const [lat, lng] = latLng;
  const r = Math.sqrt(rand()) * VISITOR_RADIUS_KM;
  const theta = rand() * 2 * Math.PI;
  const dLat = (r / 111.32) * Math.cos(theta);
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const dLng = (r / (111.32 * cosLat)) * Math.sin(theta);
  return [
    Number((lat + dLat).toFixed(5)),
    Number((lng + dLng).toFixed(5)),
  ];
}

// Seeded generator: the "surpris" role redraws the trip on every change, so
// each place must land on the same blurred spot every time.
function seededRand(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// What the "surpris" see: the real value when its box is ticked, otherwise
// the alternative one typed for them.
function surpriseActName(a) { return (a.nameVisible ? a.name : a.shareName) || ""; }
function surpriseActDesc(a) { return (a.descVisible ? a.description : a.shareDescription) || ""; }
function surpriseNightName(d) { return (d.nightNameVisible ? d.nightLocation : d.nightShareName) || ""; }
function surpriseNightDesc(d) { return (d.nightDescVisible ? d.nightDescription : d.nightShareDescription) || ""; }

// `blur(key, latLng)` lets links draw fresh noise and the live role reuse
// the same noise per place.
function buildVisitorTrip(src, blur = (key, ll) => randomOffsetLatLng(ll)) {
  const days = (src.days || []).map((d, i) => ({
    nightLatLng: blur("n" + i, d.nightLatLng),
    nightShareName: surpriseNightName(d),
    nightShareDescription: surpriseNightDesc(d),
    activities: (d.activities || []).map((a) => ({
      id: a.id,
      time: a.time || "",
      durationMin: Number(a.durationMin) || 60,
      latLng: blur("a" + a.id, a.latLng),
      shareName: surpriseActName(a),
      shareDescription: surpriseActDesc(a),
      color: a.color || null,
    })),
  }));
  return {
    v: 1,
    mode: "visitor",
    trip: {
      title: src.title || "Voyage",
      numDays: src.numDays || days.length,
      flights: (src.flights || []).map((f) => ({
        id: f.id || Date.now(),
        fromCode: f.fromCode || "",
        toCode: f.toCode || "",
        departDate: f.departDate || "",
        departTime: f.departTime || "",
        departTz: f.departTz || "",
        arriveDate: f.arriveDate || "",
        arriveTime: f.arriveTime || "",
        arriveTz: f.arriveTz || "",
        flightNum: f.flightNum || "",
      })),
      days,
    },
  };
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 2 ? "==" : str.length % 4 === 3 ? "=" : "";
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function buildVisitorUrl(payload) {
  const data = b64urlEncode(JSON.stringify(payload));
  return shareBaseUrl() + "#v=" + data;
}

function openVisitorShare() {
  const payload = buildVisitorTrip(state);
  const url = buildVisitorUrl(payload);
  const tooLong = url.length > VISITOR_QR_MAX;

  document.getElementById("modal-title").textContent = "Partager (mode visiteur)";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">Lien lecture seule, lieux floutés (±${VISITOR_RADIUS_KM} km), noms d'activités cachés.
    Sur chaque activité, coche « Visible par les surpris » pour montrer le vrai nom ou la vraie description, ou saisis une autre version pour eux.</p>
    <textarea id="visitor-url" readonly>${escapeHtml(url)}</textarea>
    <div class="modal-actions">
      <button class="btn btn-gold btn-sm" onclick="copyVisitorUrl()">📋 Copier le lien</button>
      <button class="btn btn-gold btn-sm" onclick="shareVisitorUrl()">📤 Partager</button>
      <button class="btn btn-ghost btn-sm" onclick="previewVisitorUrl()">👁 Aperçu</button>
    </div>
    <div class="visitor-qr-wrap">
      <div id="visitor-qr" class="visitor-qr ${tooLong ? "disabled" : ""}"></div>
      <div class="visitor-qr-caption">
        ${tooLong
          ? "Voyage trop long pour un QR code lisible — partage le lien."
          : "Scanne avec un téléphone"}
      </div>
    </div>
    <div id="visitor-status" class="modal-status"></div>
  `;
  showModal();

  if (!tooLong) {
    loadQrLib().then((qrcode) => {
      try {
        const q = qrcode(0, "L");
        q.addData(url);
        q.make();
        const container = document.getElementById("visitor-qr");
        if (container) container.innerHTML = q.createSvgTag({ scalable: true });
      } catch (e) {
        const container = document.getElementById("visitor-qr");
        if (container) {
          container.classList.add("disabled");
          container.textContent = "QR indisponible";
        }
      }
    }).catch(() => {
      const container = document.getElementById("visitor-qr");
      if (container) {
        container.classList.add("disabled");
        container.textContent = "QR indisponible (hors-ligne ?)";
      }
    });
  }
}

function copyVisitorUrl() {
  const ta = document.getElementById("visitor-url");
  if (!ta) return;
  const txt = ta.value;
  navigator.clipboard.writeText(txt).then(
    () => (document.getElementById("visitor-status").textContent = "✓ Lien copié"),
    () => {
      ta.select();
      document.execCommand("copy");
      document.getElementById("visitor-status").textContent = "✓ Copié";
    }
  );
}

async function shareVisitorUrl() {
  const ta = document.getElementById("visitor-url");
  if (!ta) return;
  const url = ta.value;
  const title = state.title || "Voyage";
  if (navigator.share) {
    try {
      await navigator.share({ title: `Jet Laggueur · ${title}`, url });
      document.getElementById("visitor-status").textContent = "✓ Partagé";
    } catch (e) {}
  } else {
    copyVisitorUrl();
  }
}

function previewVisitorUrl() {
  const ta = document.getElementById("visitor-url");
  if (!ta) return;
  window.open(ta.value, "_blank");
}

function readVisitorHash() {
  const h = location.hash || "";
  const m = h.match(/^#v=(.+)$/);
  if (!m) return null;
  try {
    const json = b64urlDecode(m[1]);
    const parsed = JSON.parse(json);
    if (parsed && parsed.mode === "visitor" && parsed.trip) return parsed.trip;
  } catch (e) {}
  return null;
}

function isVisitorMode() {
  return /^#v=/.test(location.hash || "");
}

function visitorTripToState(trip) {
  return {
    title: trip.title || "Voyage visiteur",
    numDays: trip.numDays || (trip.days || []).length || 1,
    flights: trip.flights || [],
    days: (trip.days || []).map((d) => ({
      nightLocation: d.nightShareName || "",
      nightLatLng: d.nightLatLng || null,
      nightDescription: "",
      nightShareDescription: d.nightShareDescription || "",
      activities: (d.activities || []).map((a) => ({
        id: a.id || Date.now() + Math.random(),
        time: a.time || "",
        durationMin: Number(a.durationMin) || 60,
        name: "",
        place: "",
        latLng: a.latLng || null,
        description: "",
        shareName: a.shareName || "",
        shareDescription: a.shareDescription || "",
        color: a.color || null,
      })),
    })),
  };
}

function applyVisitorTripToState(trip) {
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, visitorTripToState(trip));
}

// Masked copy shown to the "surpris" role of a shared trip; never saved.
function buildSurpriseState(src, seed) {
  const blur = (key, ll) => randomOffsetLatLng(ll, seededRand(seed + ":" + key));
  return visitorTripToState(buildVisitorTrip(src, blur).trip);
}

function activateVisitorMode() {
  document.body.classList.add("visitor-mode");
  if (typeof saveAll === "function") {
    window.saveAll = function () {};
    window.saveState = function () {};
  }
}
