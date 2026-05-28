// ===================== MULTI-TRIP STATE =====================
let allTrips = loadAllTrips();
let currentTripId = loadCurrentTripId();
let state = getTripState(currentTripId);

function defaultFlight() {
  return {
    id: Date.now(),
    fromCode: "",
    toCode: "",
    departDate: "",
    departTime: "",
    departTz: "Europe/Paris",
    arriveDate: "",
    arriveTime: "",
    arriveTz: "Europe/Paris",
    flightNum: "",
  };
}

function ensureFlights() {
  if (!state.flights || state.flights.length < 2) {
    state.flights = [
      state.flights?.[0] || defaultFlight(),
      state.flights?.[1] || { ...defaultFlight(), id: Date.now() + 1 },
    ];
  }
  // Keep only 2
  state.flights.length = 2;
}

function loadAllTrips() {
  try {
    const saved = localStorage.getItem("voyageplanner_trips");
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  try {
    const old = localStorage.getItem("voyageplanner_state");
    if (old) {
      const s = JSON.parse(old);
      const id = Date.now();
      const trips = [{ id, title: s.title || "Mon Voyage", state: s }];
      localStorage.setItem("voyageplanner_trips", JSON.stringify(trips));
      localStorage.setItem("voyageplanner_current", String(id));
      localStorage.removeItem("voyageplanner_state");
      return trips;
    }
  } catch (e) {}
  const id = Date.now();
  return [{ id, title: "Mon Voyage", state: { title: "Mon Voyage", numDays: 3, flights: [], days: [] } }];
}

function loadCurrentTripId() {
  const saved = localStorage.getItem("voyageplanner_current");
  if (saved && allTrips.find((t) => t.id === Number(saved))) return Number(saved);
  return allTrips[0].id;
}

function getTripState(id) {
  const trip = allTrips.find((t) => t.id === id);
  return trip ? trip.state : allTrips[0].state;
}

function saveAll() {
  const trip = allTrips.find((t) => t.id === currentTripId);
  if (trip) {
    trip.state = state;
    trip.title = state.title;
    trip.updatedAt = Date.now();
  }
  try {
    localStorage.setItem("voyageplanner_trips", JSON.stringify(allTrips));
    localStorage.setItem("voyageplanner_current", String(currentTripId));
  } catch (e) {}
  maybeAutoSync();
}

const history = [];
const HISTORY_MAX = 50;
let lastSnapshot = null;
let suspendHistory = false;

function saveState() {
  if (!suspendHistory) {
    if (lastSnapshot !== null) {
      history.push(lastSnapshot);
      if (history.length > HISTORY_MAX) history.shift();
    }
    try { lastSnapshot = JSON.stringify(state); } catch (e) {}
  }
  saveAll();
}

function undo() {
  if (!history.length) return;
  const snap = history.pop();
  try {
    const restored = JSON.parse(snap);
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, restored);
    lastSnapshot = snap;
    suspendHistory = true;
    saveAll();
    suspendHistory = false;
    if (currentDetail) closeDetail();
    renderFlights();
    renderCalendar();
    updateMap();
  } catch (e) {}
}

function renderTripSelector() {
  const sel = document.getElementById("trip-select");
  sel.innerHTML = allTrips.map((t) =>
    `<option value="${t.id}"${t.id === currentTripId ? " selected" : ""}>${t.title}</option>`
  ).join("");
}

function switchTrip(id) {
  currentTripId = Number(id);
  state = getTripState(currentTripId);
  localStorage.setItem("voyageplanner_current", String(currentTripId));
  focusedDay = null;
  restoreUI();
}

function createTrip() {
  const id = Date.now();
  const newState = { title: "Nouveau Voyage", numDays: 3, flights: [], days: [] };
  allTrips.push({ id, title: newState.title, state: newState });
  currentTripId = id;
  state = newState;
  ensureFlights();
  saveAll();
  restoreUI();
}

function deleteTrip() {
  if (allTrips.length <= 1) return;
  if (!confirm("Supprimer ce voyage ?")) return;
  allTrips = allTrips.filter((t) => t.id !== currentTripId);
  currentTripId = allTrips[0].id;
  state = getTripState(currentTripId);
  saveAll();
  restoreUI();
}

function openExport() {
  const data = JSON.stringify({ v: 1, trip: state }, null, 2);
  const filename = (state.title || "voyage").replace(/[^a-z0-9_-]/gi, "_") + ".json";
  document.getElementById("modal-title").textContent = "Exporter le voyage";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">Copie le code ci-dessous et colle-le sur Instagram, Discord, email… ou télécharge le fichier.</p>
    <textarea id="export-text" readonly>${escapeHtml(data)}</textarea>
    <div class="modal-actions">
      <button class="btn btn-gold btn-sm" onclick="copyExport()">📋 Copier</button>
      <button class="btn btn-gold btn-sm" onclick="downloadExport('${filename}')">💾 Télécharger</button>
      <button class="btn btn-gold btn-sm" onclick="shareExport()">📤 Partager</button>
    </div>
    <div id="export-status" class="modal-status"></div>
  `;
  showModal();
}

function copyExport() {
  const txt = document.getElementById("export-text").value;
  navigator.clipboard.writeText(txt).then(
    () => (document.getElementById("export-status").textContent = "✓ Copié dans le presse-papier"),
    () => {
      document.getElementById("export-text").select();
      document.execCommand("copy");
      document.getElementById("export-status").textContent = "✓ Copié";
    }
  );
}

function downloadExport(filename) {
  const txt = document.getElementById("export-text").value;
  const blob = new Blob([txt], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  document.getElementById("export-status").textContent = "✓ Fichier téléchargé";
}

async function shareExport() {
  const txt = document.getElementById("export-text").value;
  const title = state.title || "Mon voyage";
  if (navigator.share) {
    try {
      await navigator.share({ title: `Jet Laggueur · ${title}`, text: txt });
      document.getElementById("export-status").textContent = "✓ Partagé";
    } catch (e) {}
  } else {
    copyExport();
    document.getElementById("export-status").textContent = "✓ Copié — colle dans ton app";
  }
}

function openImport() {
  document.getElementById("modal-title").textContent = "Importer un voyage";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">Colle ici le code reçu, ou charge un fichier .json.</p>
    <textarea id="import-text" placeholder='{"v":1,"trip":…}'></textarea>
    <div class="modal-actions">
      <label class="btn btn-gold btn-sm" style="cursor:pointer;">
        📂 Charger un fichier
        <input type="file" accept=".json,application/json" style="display:none;" onchange="loadImportFile(this)">
      </label>
      <button class="btn btn-gold btn-sm" onclick="applyImport()">✓ Importer</button>
    </div>
    <div id="import-status" class="modal-status"></div>
  `;
  showModal();
}

function loadImportFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("import-text").value = e.target.result;
  };
  reader.readAsText(file);
}

function applyImport() {
  const txt = document.getElementById("import-text").value.trim();
  const status = document.getElementById("import-status");
  if (!txt) { status.textContent = "⚠ Colle d'abord le code"; return; }
  try {
    const parsed = JSON.parse(txt);
    const imported = parsed.trip || parsed.state || parsed;
    if (!imported || typeof imported !== "object") throw new Error("format");
    const id = Date.now();
    const title = imported.title || "Voyage importé";
    allTrips.push({ id, title, state: imported });
    currentTripId = id;
    state = imported;
    saveState();
    renderTripSelector();
    restoreUI();
    closeModal();
  } catch (e) {
    status.textContent = "⚠ Code invalide";
  }
}

function showModal() {
  document.getElementById("modal-overlay").classList.add("open");
}

function closeModal(ev) {
  if (ev && ev.target.closest(".modal")) return;
  document.getElementById("modal-overlay").classList.remove("open");
}

function getShowTravel() {
  try { return localStorage.getItem("voyageplanner_showtravel") !== "0"; } catch (e) { return true; }
}

function toggleTravel(show) {
  try { localStorage.setItem("voyageplanner_showtravel", show ? "1" : "0"); } catch (e) {}
  document.body.classList.toggle("hide-travel", !show);
}

const CAL_ZOOM_MIN = 40;
const CAL_ZOOM_MAX = 320;
const CAL_ZOOM_DEFAULT = 220;
const CAL_ZOOM_STEP = 20;

function getCalZoom() {
  try {
    const v = Number(localStorage.getItem("voyageplanner_calzoom"));
    if (v >= CAL_ZOOM_MIN && v <= CAL_ZOOM_MAX) return v;
  } catch (e) {}
  return CAL_ZOOM_DEFAULT;
}

function applyCalZoom(v) {
  const grid = document.getElementById("calendar-grid");
  if (grid) grid.style.setProperty("--cal-day-w", v + "px");
  const range = document.getElementById("cal-zoom-range");
  if (range && Number(range.value) !== v) range.value = String(v);
}

function setCalZoom(v) {
  const clamped = Math.max(CAL_ZOOM_MIN, Math.min(CAL_ZOOM_MAX, Math.round(v)));
  try { localStorage.setItem("voyageplanner_calzoom", String(clamped)); } catch (e) {}
  applyCalZoom(clamped);
}

function changeCalZoom(dir) {
  setCalZoom(getCalZoom() + dir * CAL_ZOOM_STEP);
}

function fitCalZoom() {
  const wrapper = document.querySelector(".calendar-wrapper");
  const grid = document.getElementById("calendar-grid");
  if (!wrapper || !grid) return;
  const hours = grid.querySelector(".cal-hours");
  const hoursW = hours ? hours.getBoundingClientRect().width : 50;
  const days = grid.querySelectorAll(".cal-day").length;
  if (!days) return;
  const available = wrapper.clientWidth - hoursW - 8;
  const per = Math.floor(available / days);
  setCalZoom(per);
}

const THEMES = [
  { id: "sable", name: "Sable & Or" },
  { id: "nuit", name: "Nuit étoilée" },
  { id: "tropique", name: "Tropique" },
  { id: "foret", name: "Forêt" },
  { id: "lavande", name: "Lavande" },
  { id: "ardoise", name: "Ardoise" },
];

const ACTIVITY_COLORS = [
  { value: "", name: "Couleur du thème" },
  { value: "#e74c3c", name: "Rouge" },
  { value: "#e67e22", name: "Orange" },
  { value: "#f1c40f", name: "Jaune" },
  { value: "#27ae60", name: "Vert" },
  { value: "#16a085", name: "Sarcelle" },
  { value: "#3498db", name: "Bleu" },
  { value: "#5e60ce", name: "Indigo" },
  { value: "#9b59b6", name: "Violet" },
  { value: "#e84393", name: "Rose" },
  { value: "#34495e", name: "Ardoise" },
];

function setTheme(id) {
  document.documentElement.setAttribute("data-theme", id);
  try { localStorage.setItem("voyageplanner_theme", id); } catch (e) {}
  const sel = document.getElementById("theme-select");
  if (sel) sel.value = id;
  if (typeof updateMap === "function" && typeof state !== "undefined" && state.days) {
    updateMap();
  }
}

function initThemes() {
  const sel = document.getElementById("theme-select");
  if (sel && !sel.options.length) {
    sel.innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  }
  let saved = "sable";
  try { saved = localStorage.getItem("voyageplanner_theme") || "sable"; } catch (e) {}
  setTheme(saved);
}

function adjustHeaderSpacing() {}

function toggleIsland() {
  if (window.scrollY > 0) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.body.classList.toggle("island-collapsed");
  if (map) map.invalidateSize();
  if (mapMarkers.length) {
    const pts = mapMarkers.map((m) => ({ latlng: m.getLatLng() }));
    fitMapToVisibleArea(pts, true);
  }
}
window.addEventListener("resize", () => {
  if (typeof map !== "undefined" && map) map.invalidateSize();
});

function restoreUI() {
  initThemes();
  adjustHeaderSpacing();
  const show = getShowTravel();
  document.body.classList.toggle("hide-travel", !show);
  const tt = document.getElementById("toggle-travel");
  if (tt) tt.checked = show;
  const zr = document.getElementById("cal-zoom-range");
  if (zr) zr.value = String(getCalZoom());
  try { lastSnapshot = JSON.stringify(state); } catch (e) {}
  ensureFlights();
  renderTripSelector();
  document.getElementById("trip-title-input").value = state.title;
  document.title = state.title + " — Jet Laggueur";
  document.getElementById("days-count-display").textContent = state.numDays;
  renderFlights();
  renderCalendar();
  setTimeout(() => map.invalidateSize(), 100);
  updateMap();
}

// ===================== MAP =====================
const map = L.map("map", { zoomControl: true }).setView([46.2, 2.3], 5);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap &copy; CARTO",
  subdomains: "abcd",
  maxZoom: 20,
}).addTo(map);

let mapMarkers = [];
let routePolylines = [];

function clearMap() {
  mapMarkers.forEach((m) => map.removeLayer(m));
  mapMarkers = [];
  routePolylines.forEach((p) => map.removeLayer(p));
  routePolylines = [];
}

function makeIcon(color, label, dayIdx, isAirport) {
  const safe = escapeHtml(String(label || ""));
  const dayAttr = dayIdx == null ? "" : ` data-day="${dayIdx}"`;
  const apAttr = isAirport ? ` data-airport="1"` : "";
  return L.divIcon({
    className: "map-pill-icon",
    html: `<div class="map-pill"${dayAttr}${apAttr} style="background:${color};"><span class="map-pill-dot"></span><span class="map-pill-label">${safe}</span></div>`,
    iconSize: null,
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

// Get destination airport latLng (toCode of the aller flight)
function getDestAirportLatLng() {
  if (state.flights.length < 1) return null;
  const aller = state.flights[0];
  const code = (aller.toCode || "").toUpperCase();
  if (code && AP[code]) return [AP[code].lat, AP[code].lng];
  return null;
}

function getDestAirportCode() {
  if (state.flights.length < 1) return null;
  const code = (state.flights[0].toCode || "").toUpperCase();
  return (code && AP[code]) ? code : null;
}

async function updateMap() {
  clearMap();
  const pts = [];

  const css = getComputedStyle(document.documentElement);
  const colNavy = css.getPropertyValue("--navy").trim() || "#1a2744";
  const colNavyLight = css.getPropertyValue("--navy-light").trim() || "#2d3f6b";
  const colGold = css.getPropertyValue("--gold").trim() || "#c9a84c";

  // Show only destination airport on map
  const destCode = getDestAirportCode();
  if (destCode) {
    const a = AP[destCode];
    pts.push({
      latlng: [a.lat, a.lng],
      label: destCode,
      color: colNavy,
      isAirport: true,
      popup: `✈ ${destCode} · ${a.c}<br><small>${a.n}</small>`,
    });
  }

  // Collect all day points for routing
  const routePts = [];
  const destLL = getDestAirportLatLng();

  state.days.forEach((day, i) => {
    const isFirstDay = i === 0;
    const isLastDay = i === state.days.length - 1;

    // First day: airport is first waypoint
    if (isFirstDay && destLL) {
      routePts.push({ latlng: destLL, label: destCode || "✈" });
    }

    // Activities
    day.activities.forEach((act, j) => {
      if (act.latLng) {
        const label = act.name || act.place || `J${i + 1} activité ${String.fromCharCode(65 + j)}`;
        pts.push({
          latlng: act.latLng,
          label,
          color: act.color || colGold,
          dayIdx: i,
          popup: `<b>${act.time || ""}</b> ${escapeHtml(act.name || "")}${act.description ? "<br><small>" + escapeHtml(act.description) + "</small>" : ""}`,
        });
        routePts.push({ latlng: act.latLng, label, dayIdx: i });
      }
    });

    // Night location (not on last day)
    if (day.nightLatLng && !isLastDay) {
      const label = "Nuit";
      pts.push({
        latlng: day.nightLatLng,
        label,
        color: colNavyLight,
        dayIdx: i,
        popup: `🌙 Nuit ${i + 1}: ${escapeHtml(day.nightLocation || "")}${day.nightDescription ? "<br><small>" + escapeHtml(day.nightDescription) + "</small>" : ""}`,
      });
      routePts.push({ latlng: day.nightLatLng, label, dayIdx: i });
    }

    // Last day: airport is last waypoint
    if (isLastDay && destLL) {
      routePts.push({ latlng: destLL, label: destCode || "✈" });
    }
  });

  if (pts.length === 0) return;

  pts.forEach((p) => {
    const m = L.marker(p.latlng, { icon: makeIcon(p.color, p.label, p.dayIdx, p.isAirport) })
      .addTo(map)
      .bindPopup(p.popup);
    m._dayIdx = p.dayIdx;
    m._isAirport = !!p.isAirport;
    mapMarkers.push(m);
  });

  if (routePts.length > 1) await drawRoutes(routePts);

  map.invalidateSize();
  applyDayHighlight();
  if (focusedDay != null) {
    focusDay(focusedDay, false);
  } else {
    fitMapToVisibleArea(pts, true);
  }
}

let focusedDay = null;

function focusDay(i, animate = true) {
  if (focusedDay === i) {
    focusedDay = null;
    applyDayHighlight();
    if (mapMarkers.length) {
      const allPts = mapMarkers.map((m) => ({ latlng: m.getLatLng() }));
      fitMapToVisibleArea(allPts, animate);
    }
    return;
  }
  focusedDay = i;
  applyDayHighlight();
  const dayPts = [];
  const destLL = getDestAirportLatLng();
  const lastDay = state.days.length - 1;
  if (destLL && (i === 0 || i === lastDay)) dayPts.push({ latlng: destLL });
  const prevDay = state.days[i - 1];
  if (prevDay && prevDay.nightLatLng) dayPts.push({ latlng: prevDay.nightLatLng });
  const day = state.days[i];
  if (day) {
    day.activities.forEach((a) => {
      if (a.latLng) dayPts.push({ latlng: a.latLng });
    });
    if (day.nightLatLng) dayPts.push({ latlng: day.nightLatLng });
  }
  if (dayPts.length === 0) return;
  fitMapToVisibleArea(dayPts, animate);
}

function applyDayHighlight() {
  const prev = focusedDay != null ? focusedDay - 1 : null;
  const lastDay = state.days.length - 1;
  const airportInFocus = focusedDay === 0 || focusedDay === lastDay;
  const pills = document.querySelectorAll(".map-pill");
  pills.forEach((p) => {
    const d = p.dataset.day;
    const dn = d == null ? null : Number(d);
    const isAirport = p.dataset.airport === "1";
    const inFocus = focusedDay != null && (
      dn === focusedDay ||
      (dn === prev && isPrevNightMarker(p, prev)) ||
      (isAirport && airportInFocus)
    );
    p.classList.toggle("dimmed", focusedDay != null && !inFocus);
    p.classList.toggle("highlighted", inFocus);
  });
  document.querySelectorAll(".cal-day").forEach((el, i) => {
    el.classList.toggle("day-focused", i === focusedDay);
  });
  routePolylines.forEach((poly) => {
    if (focusedDay == null) {
      poly.setStyle({ opacity: 0.8, weight: 3 });
    } else if (poly._dayIdx === focusedDay) {
      poly.setStyle({ opacity: 0.95, weight: 4 });
    } else {
      poly.setStyle({ opacity: 0.15, weight: 2 });
    }
  });
}

function isPrevNightMarker(pill, prevDayIdx) {
  if (prevDayIdx == null || prevDayIdx < 0) return false;
  const label = pill.querySelector(".map-pill-label")?.textContent || "";
  return label === "Nuit";
}

window.addEventListener("load", () => {
  if (!map) return;
  setTimeout(() => {
    map.invalidateSize();
    if (mapMarkers.length) {
      const pts = mapMarkers.map((m) => ({ latlng: m.getLatLng() }));
      fitMapToVisibleArea(pts, false);
    }
  }, 250);
});

function fitMapToVisibleArea(pts, animate = true) {
  if (!map || !pts || !pts.length) return;
  map.invalidateSize();
  const headerH = document.querySelector(".app-header")?.offsetHeight || 80;
  const vh = window.innerHeight;
  const collapsed = document.body.classList.contains("island-collapsed");
  // Reserve space at bottom based on logical island state (not transition)
  const bottomReserved = collapsed ? 60 : Math.round(vh * 0.4);
  const topPad = headerH + 20;
  const bottomPad = bottomReserved + 16;
  const padOpts = {
    paddingTopLeft: [30, topPad],
    paddingBottomRight: [30, bottomPad],
    animate,
    duration: 0.6,
  };
  const fn = animate ? "flyToBounds" : "fitBounds";
  if (pts.length === 1) {
    const bounds = L.latLngBounds([pts[0].latlng, pts[0].latlng]);
    map[fn](bounds, { ...padOpts, maxZoom: 12 });
  } else {
    map[fn](L.latLngBounds(pts.map((p) => p.latlng)), padOpts);
  }
}


function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

const ROUTE_CACHE_KEY = "voyageplanner_route_cache";
let routeCache = (() => {
  try { return JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY) || "{}"); } catch (e) { return {}; }
})();
let routeCacheDirty = false;
function persistRouteCache() {
  if (!routeCacheDirty) return;
  routeCacheDirty = false;
  try { localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(routeCache)); } catch (e) {}
}
function routeCacheKey(a, b) {
  return `${a[0].toFixed(4)},${a[1].toFixed(4)}|${b[0].toFixed(4)},${b[1].toFixed(4)}`;
}

function drawCachedSegment(from, to, cached) {
  const routeColor = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#c9a84c";
  const poly = L.polyline(cached.coords, {
    color: routeColor,
    weight: 3,
    opacity: 0.8,
    dashArray: "6,4",
  }).addTo(map);
  poly._dayIdx = to.dayIdx != null ? to.dayIdx : from.dayIdx;
  routePolylines.push(poly);
  return `<b>${from.label} → ${to.label}</b>: ${cached.km} km — ${cached.h > 0 ? cached.h + "h " : ""}${cached.m}min`;
}

async function drawRoutes(pts) {
  const infos = [];
  // First pass: draw cached segments instantly
  const segments = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const from = pts[i];
    const to = pts[i + 1];
    const key = routeCacheKey(from.latlng, to.latlng);
    const cached = routeCache[key];
    if (cached) {
      infos.push(drawCachedSegment(from, to, cached));
      segments.push(null);
    } else {
      segments.push({ from, to, key, idx: i });
      infos.push(`<b>${from.label} → ${to.label}</b>: …`);
    }
  }
  document.getElementById("map-info").innerHTML = infos.length
    ? infos.map((r) => `<div class="route-segment">${r}</div>`).join("")
    : "🗺️ Itinéraire affiché";
  // Second pass: fetch missing segments
  for (const seg of segments) {
    if (!seg) continue;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${seg.from.latlng[1]},${seg.from.latlng[0]};${seg.to.latlng[1]},${seg.to.latlng[0]}?overview=full&geometries=geojson`;
      const data = await (await fetch(url)).json();
      if (data.routes?.[0]) {
        const r = data.routes[0];
        const km = (r.distance / 1000).toFixed(0);
        const dur = Math.round(r.duration / 60);
        const h = Math.floor(dur / 60);
        const m = dur % 60;
        const cached = {
          coords: r.geometry.coordinates.map((c) => [c[1], c[0]]),
          km, h, m,
        };
        routeCache[seg.key] = cached;
        routeCacheDirty = true;
        infos[seg.idx] = drawCachedSegment(seg.from, seg.to, cached);
        document.getElementById("map-info").innerHTML = infos.map((r) => `<div class="route-segment">${r}</div>`).join("");
      }
    } catch (e) {
      /* ignore routing errors */
    }
  }
  persistRouteCache();
  applyDayHighlight();
}

// Fetch driving time between two latlng points, returns formatted string or null
async function getDrivingTime(fromLL, toLL) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLL[1]},${fromLL[0]};${toLL[1]},${toLL[0]}?overview=false`;
    const data = await (await fetch(url)).json();
    if (data.routes?.[0]) {
      const r = data.routes[0];
      const km = (r.distance / 1000).toFixed(0);
      const dur = Math.round(r.duration / 60);
      const h = Math.floor(dur / 60);
      const m = dur % 60;
      let t;
      if (h > 0 && m === 0) t = `${h}h`;
      else if (h > 0) t = `${h}h${String(m).padStart(2, "0")}`;
      else t = `${m}min`;
      return { km, min: dur, text: `${km} km · ${t}`, durText: t };
    }
  } catch (e) {}
  return null;
}

// ===================== GEOCODING =====================
const geoCache = {};

async function geocode(q) {
  if (!q || q.trim().length < 3) return null;
  const k = q.trim().toLowerCase();
  if (geoCache[k]) return geoCache[k];
  try {
    const d = await (
      await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
        { headers: { "Accept-Language": "fr" } }
      )
    ).json();
    if (d[0]) {
      const ll = [parseFloat(d[0].lat), parseFloat(d[0].lon)];
      geoCache[k] = ll;
      return ll;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

const geoTimers = {};

function scheduleGeocode(key, q, cb) {
  if (geoTimers[key]) clearTimeout(geoTimers[key]);
  geoTimers[key] = setTimeout(async () => {
    const el = document.getElementById("geo-" + key);
    if (el) {
      el.textContent = "⌛ Recherche…";
      el.className = "geocode-status geocode-loading";
    }
    const ll = await geocode(q);
    if (el) {
      el.textContent = ll ? "✓ Localisé" : "✗ Non trouvé";
      el.className = "geocode-status " + (ll ? "geocode-ok" : "geocode-err");
    }
    cb(ll);
    updateMap();
  }, 900);
}

// ===================== AIRPORT AUTOCOMPLETE =====================
function apSearch(q) {
  if (!q || q.length < 2) return [];
  const up = q.toUpperCase().trim();
  return Object.entries(AP)
    .filter(
      ([code, a]) =>
        code.startsWith(up) ||
        a.c.toUpperCase().includes(up) ||
        a.n.toUpperCase().includes(up) ||
        a.co.toUpperCase().includes(up)
    )
    .slice(0, 8);
}

function apInput(fid, field, q) {
  const dd = document.getElementById(`apdd-${fid}-${field}`);
  if (!dd) return;
  const res = apSearch(q);
  if (!res.length) {
    dd.style.display = "none";
    return;
  }
  dd.innerHTML = res
    .map(
      ([code, a]) =>
        `<div class="ap-option" onmousedown="apSelect(${fid},'${field}','${code}')">
      <span class="ap-code">${code}</span>
      <div class="ap-info"><div class="ap-city-name">${a.c}</div><div class="ap-full-name">${a.n}</div></div>
      <span class="ap-ctry">${a.co}</span>
    </div>`
    )
    .join("");
  dd.style.display = "block";
}

function apSelect(fid, field, code) {
  const f = state.flights.find((f) => f.id === fid);
  if (!f) return;
  f[field + "Code"] = code;
  saveState();
  const inp = document.getElementById(`apinp-${fid}-${field}`);
  if (inp) inp.value = code;
  const res = document.getElementById(`apres-${fid}-${field}`);
  const a = AP[code];
  if (res && a) {
    res.textContent = `${a.c} · ${a.n}`;
    res.className = "ap-resolved ok";
  }
  const dd = document.getElementById(`apdd-${fid}-${field}`);
  if (dd) dd.style.display = "none";
  updateMap();
}

function apBlur(fid, field) {
  setTimeout(() => {
    const dd = document.getElementById(`apdd-${fid}-${field}`);
    if (dd) dd.style.display = "none";
    const inp = document.getElementById(`apinp-${fid}-${field}`);
    if (!inp) return;
    const val = inp.value.toUpperCase().trim();
    const f = state.flights.find((f) => f.id === fid);
    if (!f) return;
    if (val.length === 3 && AP[val]) {
      apSelect(fid, field, val);
    } else {
      f[field + "Code"] = inp.value;
      const res = document.getElementById(`apres-${fid}-${field}`);
      if (res) {
        res.textContent = "";
        res.className = "ap-resolved";
      }
    }
  }, 160);
}

function apWidget(fid, field, cur, ph) {
  const a = cur ? AP[cur.toUpperCase()] : null;
  return `<div class="airport-picker">
    <input type="text" id="apinp-${fid}-${field}" placeholder="${ph}" value="${cur || ""}"
      oninput="apInput(${fid},'${field}',this.value)"
      onfocus="apInput(${fid},'${field}',this.value)"
      onblur="apBlur(${fid},'${field}')">
    <div class="ap-resolved${a ? " ok" : ""}" id="apres-${fid}-${field}">${a ? a.c + " · " + a.n : ""}</div>
    <div class="ap-dropdown" id="apdd-${fid}-${field}"></div>
  </div>`;
}

function apLabel(code) {
  if (!code) return "?";
  const a = AP[code.toUpperCase()];
  return a ? `${code.toUpperCase()} · ${a.c}` : code;
}

function apCity(code) {
  if (!code) return "?";
  const a = AP[code.toUpperCase()];
  return a ? a.c : code;
}

// ===================== TABS =====================
function showTab(name, event) {
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".nav-tab")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  if (event) event.target.classList.add("active");
  if (name === "jours") renderCalendar();
}

// ===================== FLIGHTS =====================
function updateFlight(id, field, value) {
  const f = state.flights.find((f) => f.id === id);
  if (f) f[field] = value;
  saveState();
}

function tzOpts(sel) {
  return TIMEZONES.map(
    (tz) =>
      `<option value="${tz}"${tz === sel ? " selected" : ""}>${tz.replace(/_/g, " ")}</option>`
  ).join("");
}

function renderFlights() {
  const list = document.getElementById("flights-list");
  document.getElementById("no-flights").style.display = "none";
  const labels = ["✈ Aller", "✈ Retour"];
  list.innerHTML = state.flights
    .map(
      (f, i) => `
    <div class="flight-card">
      <div class="card-top">
        <span class="flight-badge">${labels[i]}</span>
        <span class="flight-arrow">✈</span>
        <input type="text" style="max-width:110px" placeholder="N° vol (AF011)" value="${f.flightNum || ""}" onchange="updateFlight(${f.id},'flightNum',this.value)">
      </div>
      <div class="form-row cols-2">
        <div><label>Aéroport de départ</label>${apWidget(f.id, "from", f.fromCode, "CDG, Paris…")}</div>
        <div><label>Aéroport d'arrivée</label>${apWidget(f.id, "to", f.toCode, "NRT, Tokyo…")}</div>
      </div>
      <div class="form-row cols-4">
        <div><label>Date départ</label><input type="date" value="${f.departDate || ""}" onchange="updateFlight(${f.id},'departDate',this.value)"></div>
        <div><label>Heure départ</label><input type="time" value="${f.departTime || ""}" onchange="updateFlight(${f.id},'departTime',this.value)"></div>
        <div><label>Date arrivée</label><input type="date" value="${f.arriveDate || ""}" onchange="updateFlight(${f.id},'arriveDate',this.value)"></div>
        <div><label>Heure arrivée</label><input type="time" value="${f.arriveTime || ""}" onchange="updateFlight(${f.id},'arriveTime',this.value)"></div>
      </div>
      <div class="form-row cols-2">
        <div><label>Fuseau départ</label><select onchange="updateFlight(${f.id},'departTz',this.value)">${tzOpts(f.departTz)}</select></div>
        <div><label>Fuseau arrivée</label><select onchange="updateFlight(${f.id},'arriveTz',this.value)">${tzOpts(f.arriveTz)}</select></div>
      </div>
      ${f.departTime && f.arriveTime && f.departDate && f.arriveDate ? flightDuration(f) : ""}
    </div>
  `
    )
    .join("");
}

function flightDuration(f) {
  try {
    const depLocal = new Date(`${f.departDate}T${f.departTime}:00`);
    const arrLocal = new Date(`${f.arriveDate}T${f.arriveTime}:00`);
    const depOffset = tzOffsetMinutes(depLocal, f.departTz || "Europe/Paris");
    const arrOffset = tzOffsetMinutes(arrLocal, f.arriveTz || "Europe/Paris");
    const depUTC = depLocal.getTime() - depOffset * 60000;
    const arrUTC = arrLocal.getTime() - arrOffset * 60000;
    const ms = arrUTC - depUTC;
    if (ms < 0) return "";
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return `<div class="route-segment"><strong>Durée :</strong> ${h}h${m > 0 ? m + "min" : ""}</div>`;
  } catch (e) {
    return "";
  }
}

function tzOffsetMinutes(date, tz) {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: tz });
  return (new Date(tzStr) - new Date(utcStr)) / 60000;
}

// ===================== CALENDAR =====================
function computeTripDates() {
  let s = null;
  let e = null;
  const arrivals = [];
  const departures = [];
  state.flights.forEach((f) => {
    if (f.arriveDate) arrivals.push(f.arriveDate);
    if (f.departDate) departures.push(f.departDate);
  });
  if (arrivals.length > 0) {
    s = arrivals.reduce((a, b) => (a < b ? a : b));
  }
  if (departures.length > 0) {
    e = departures.reduce((a, b) => (a > b ? a : b));
  }
  const fromFlights = !!s;
  if (!s) s = document.getElementById("trip-start-date")?.value || null;
  if (!s) return null;
  let n;
  if (e && e >= s) {
    n =
      Math.round(
        (new Date(e + "T00:00:00") - new Date(s + "T00:00:00")) / 86400000
      ) + 1;
  } else {
    n = Math.max(state.numDays, 1);
  }
  const dates = [];
  const base = new Date(s + "T00:00:00");
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    dates.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
  }
  return { dates, s, e, n, fromFlights };
}

function ensureDays(n) {
  while (state.days.length < n)
    state.days.push({ nightLocation: "", nightLatLng: null, nightDescription: "", activities: [] });
  state.days.length = n;
  saveState();
}

function getFlightsOn(date) {
  const out = [];
  // flights[0] = aller, flights[1] = retour
  state.flights.forEach((f, idx) => {
    // For aller (idx 0): only show arrival on the calendar (departure is from home)
    // For retour (idx 1): only show departure on the calendar (arrival is back home)
    if (idx === 0 && f.arriveDate === date) {
      out.push({ ...f, ev: "arrive" });
    } else if (idx === 1 && f.departDate === date) {
      out.push({ ...f, ev: "depart" });
    }
  });
  return out;
}

function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  const meta = document.getElementById("cal-meta-info");
  const manual = document.getElementById("manual-controls");
  const metaBox = document.querySelector(".calendar-meta");
  const trip = computeTripDates();

  if (!trip) {
    manual.style.display = "flex";
    metaBox.style.display = "flex";
    document.getElementById("days-count-display").textContent = state.numDays;
    meta.innerHTML =
      '<span style="color:var(--muted);font-size:0.80rem;">Saisissez vos vols ou choisissez une date de départ.</span>';
    grid.innerHTML = `<div class="calendar-empty"><div class="empty-icon">🗓️</div>Ajoutez vos vols dans l'onglet <strong>Vols</strong><br>ou saisissez une date de départ manuellement.</div>`;
    return;
  }
  ensureDays(trip.n);

  meta.innerHTML = "";
  if (trip.fromFlights) {
    manual.style.display = "none";
    metaBox.style.display = "none";
  } else {
    manual.style.display = "flex";
    metaBox.style.display = "flex";
    document.getElementById("days-count-display").textContent = state.numDays;
  }

  const START_HOUR = 6;
  const END_HOUR = 24;
  const HOUR_PX = 60;

  // Hour labels column
  let hoursCol = '<div class="cal-hours">';
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    hoursCol += `<div class="cal-hour-label" style="top:${(h - START_HOUR) * HOUR_PX}px">${String(h).padStart(2, "0")}:00</div>`;
  }
  hoursCol += '</div>';

  const daysCols = trip.dates.map((date, i) => {
    const day = state.days[i];
    const d = new Date(date + "T00:00:00");
    const wd = d.toLocaleDateString("fr-FR", { weekday: "short" });
    const ds = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const flights = getFlightsOn(date);
    const hasDepart = flights.some((f) => f.ev === "depart");
    const hasArrive = flights.some((f) => f.ev === "arrive");

    // Build events positioned by time
    let events = "";
    let wpIdx = 0;

    // Hour grid lines
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      events += `<div class="cal-hour-line" style="top:${(h - START_HOUR) * HOUR_PX}px"></div>`;
    }

    // Flight arrival
    if (hasArrive) {
      const f = flights.find((fl) => fl.ev === "arrive");
      const to = f.toCode?.toUpperCase() || "?";
      const toAp = AP[to];
      const top = timeToPos(f.arriveTime, START_HOUR, HOUR_PX);
      events += `<div class="cal-evt cal-evt-flight" style="top:${top}px">
        <div class="evt-time">${f.arriveTime || ""}</div>
        <div class="evt-title">✈ Arrivée ${toAp ? toAp.c : to}</div>
        <div class="evt-sub">${f.flightNum || ""}</div>
      </div>`;
      wpIdx++;
    }

    // Activities
    day.activities.forEach((act, j) => {
      const top = timeToPos(act.time, START_HOUR, HOUR_PX);
      const dur = Number(act.durationMin) || 60;
      const heightPx = Math.max(28, (dur / 60) * HOUR_PX);
      const sel = currentDetail && currentDetail.type === "act" && currentDetail.day === i && currentDetail.id === act.id ? " selected" : "";
      const colorStyle = act.color ? `--act-color:${act.color};` : "";
      events += `<div class="cal-evt cal-evt-travel" id="travel-act-${act.id}" data-activity-top="${top}" style="top:${top}px;height:0;display:none">
        <div class="evt-compact"><span class="evt-compact-name travel-text"></span></div>
      </div>`;
      events += `<div class="cal-evt cal-evt-act${sel}" style="${colorStyle}top:${top}px;height:${heightPx}px" id="evt-${i}-${act.id}" data-day="${i}" data-id="${act.id}">
        <div class="evt-compact">
          <span class="evt-compact-name">${escapeHtml(act.name || "Sans titre")}</span>
        </div>
        <div class="evt-resize-handle" title="Étirer pour changer la durée"></div>
      </div>`;
      wpIdx++;
    });

    // Accommodation (not on departure day) - place at 21:00
    if (!hasDepart) {
      const top = timeToPos("21:00", START_HOUR, HOUR_PX);
      const sel = currentDetail && currentDetail.type === "night" && currentDetail.day === i ? " selected" : "";
      events += `<div class="cal-evt cal-evt-travel" id="travel-night-${i}" data-activity-top="${top}" style="top:${top}px;height:0;display:none">
        <div class="evt-compact"><span class="evt-compact-name travel-text"></span></div>
      </div>`;
      events += `<div class="cal-evt cal-evt-night${sel}" style="top:${top}px" onclick="openNightDetail(${i},event)">
        <div class="evt-compact">
          <span class="evt-compact-name">${escapeHtml(day.nightLocation || "Hébergement")}</span>
        </div>
      </div>`;
    }

    // Flight departure
    if (hasDepart) {
      const f = flights.find((fl) => fl.ev === "depart");
      const from = f.fromCode?.toUpperCase() || "?";
      const fromAp = AP[from];
      const top = timeToPos(f.departTime, START_HOUR, HOUR_PX);
      events += `<div class="cal-evt cal-evt-flight" style="top:${top}px">
        <div class="evt-time">${f.departTime || ""}</div>
        <div class="evt-title">✈ Départ ${fromAp ? fromAp.c : from}</div>
        <div class="evt-sub">${f.flightNum || ""}</div>
      </div>`;
    }

    return `<div class="cal-day">
      <div class="cal-day-head" onclick="focusDay(${i})" title="Centrer la carte sur ce jour">
        <div class="cal-day-num">J${i + 1}</div>
        <div class="cal-day-wd">${wd.charAt(0).toUpperCase() + wd.slice(1)}</div>
        <div class="cal-day-ds">${ds}</div>
      </div>
      <div class="cal-day-body" style="height:${(END_HOUR - START_HOUR) * HOUR_PX}px">
        ${events}
      </div>
    </div>`;
  }).join("");

  grid.innerHTML = hoursCol + daysCols;
  applyCalZoom(getCalZoom());

  initActivityDragDrop(START_HOUR, HOUR_PX);
  initCalendarClickToCreate(START_HOUR, HOUR_PX);

  // Async: fill in travel times
  fillTravelTimes(trip);
}

function initActivityDragDrop(START_HOUR, HOUR_PX) {
  const grid = document.getElementById("calendar-grid");
  if (!grid) return;
  const SNAP_MIN = 15;
  const DRAG_THRESHOLD = 5;
  let drag = null;

  grid.querySelectorAll(".cal-evt-act .evt-resize-handle").forEach((handle) => {
    const evt = handle.closest(".cal-evt-act");
    let resize = null;
    handle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const rect = evt.getBoundingClientRect();
      resize = {
        startY: e.clientY,
        startH: rect.height,
        day: Number(evt.dataset.day),
        id: Number(evt.dataset.id),
      };
      handle.setPointerCapture(e.pointerId);
      evt.classList.add("resizing");
    });
    handle.addEventListener("pointermove", (e) => {
      if (!resize) return;
      const newH = Math.max(HOUR_PX * 0.25, resize.startH + (e.clientY - resize.startY));
      evt.style.height = newH + "px";
    });
    handle.addEventListener("pointerup", () => {
      if (!resize) return;
      const finalH = parseFloat(evt.style.height);
      const minutes = Math.max(15, Math.round((finalH / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN);
      updateActivity(resize.day, resize.id, "durationMin", minutes);
      resize = null;
      evt.classList.remove("resizing");
      renderCalendar();
    });
    handle.addEventListener("pointercancel", () => {
      resize = null;
      evt.classList.remove("resizing");
      renderCalendar();
    });
  });

  const wrapper = grid.closest(".calendar-wrapper");
  const SCROLL_EDGE = 70;
  const SCROLL_MAX_SPEED = 22;
  let autoScrollRaf = null;
  let lastPointerEvt = null;

  function applyDragPosition(e) {
    if (!drag) return;
    const days = grid.querySelectorAll(".cal-day");
    let targetBody = null;
    days.forEach((d, i) => {
      const r = d.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right) {
        drag.newDay = i;
        targetBody = d.querySelector(".cal-day-body");
      }
    });
    if (!targetBody) {
      const r0 = days[0]?.getBoundingClientRect();
      const rLast = days[days.length - 1]?.getBoundingClientRect();
      if (r0 && e.clientX < r0.left) {
        drag.newDay = 0;
        targetBody = days[0].querySelector(".cal-day-body");
      } else if (rLast && e.clientX > rLast.right) {
        drag.newDay = days.length - 1;
        targetBody = days[days.length - 1].querySelector(".cal-day-body");
      }
    }
    if (!targetBody) targetBody = days[drag.newDay]?.querySelector(".cal-day-body");
    if (!targetBody) return;
    if (drag.el.parentElement !== targetBody) targetBody.appendChild(drag.el);
    const r = targetBody.getBoundingClientRect();
    let top = e.clientY - r.top - drag.offsetY;
    top = Math.max(0, Math.min(top, r.height - drag.el.offsetHeight));
    drag.el.style.top = top + "px";
    drag.newTop = top;
  }

  function autoScrollTick() {
    autoScrollRaf = null;
    if (!drag || !lastPointerEvt || !wrapper) return;
    const wr = wrapper.getBoundingClientRect();
    let dx = 0;
    if (lastPointerEvt.clientX < wr.left + SCROLL_EDGE) {
      const t = (wr.left + SCROLL_EDGE - lastPointerEvt.clientX) / SCROLL_EDGE;
      dx = -Math.ceil(Math.min(1, t) * SCROLL_MAX_SPEED);
    } else if (lastPointerEvt.clientX > wr.right - SCROLL_EDGE) {
      const t = (lastPointerEvt.clientX - (wr.right - SCROLL_EDGE)) / SCROLL_EDGE;
      dx = Math.ceil(Math.min(1, t) * SCROLL_MAX_SPEED);
    }
    if (dx !== 0) {
      const before = wrapper.scrollLeft;
      wrapper.scrollLeft = before + dx;
      if (wrapper.scrollLeft !== before) applyDragPosition(lastPointerEvt);
      autoScrollRaf = requestAnimationFrame(autoScrollTick);
    }
  }

  function maybeStartAutoScroll() {
    if (autoScrollRaf == null) autoScrollRaf = requestAnimationFrame(autoScrollTick);
  }

  grid.querySelectorAll(".cal-evt-act").forEach((evt) => {
    evt.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".evt-resize-handle")) return;
      if (e.button !== 0) return;
      const rect = evt.getBoundingClientRect();
      drag = {
        el: evt,
        day: Number(evt.dataset.day),
        id: Number(evt.dataset.id),
        offsetY: e.clientY - rect.top,
        startX: e.clientX,
        startY: e.clientY,
        newDay: Number(evt.dataset.day),
        newTop: parseFloat(evt.style.top) || 0,
        moved: false,
      };
      evt.setPointerCapture(e.pointerId);
    });

    evt.addEventListener("pointermove", (e) => {
      if (!drag || drag.el !== evt) return;
      if (!drag.moved) {
        const dx = Math.abs(e.clientX - drag.startX);
        const dy = Math.abs(e.clientY - drag.startY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        drag.moved = true;
        evt.classList.add("dragging");
      }
      lastPointerEvt = e;
      applyDragPosition(e);
      maybeStartAutoScroll();
    });

    evt.addEventListener("pointerup", (e) => {
      if (!drag || drag.el !== evt) return;
      const d = drag;
      drag = null;
      lastPointerEvt = null;
      if (autoScrollRaf != null) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
      evt.classList.remove("dragging");
      if (!d.moved) {
        openActivityDetail(d.day, d.id, e);
        return;
      }
      const mins = Math.round((d.newTop / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
      const total = START_HOUR * 60 + mins;
      const hh = String(Math.floor(total / 60)).padStart(2, "0");
      const mm = String(total % 60).padStart(2, "0");
      const newTime = `${hh}:${mm}`;
      const idx = state.days[d.day].activities.findIndex((a) => a.id === d.id);
      if (idx === -1) return renderCalendar();
      const act = state.days[d.day].activities[idx];
      act.time = newTime;
      if (d.newDay !== d.day) {
        state.days[d.day].activities.splice(idx, 1);
        state.days[d.newDay].activities.push(act);
      }
      saveState();
      renderCalendar();
    });

    evt.addEventListener("pointercancel", () => {
      if (drag && drag.el === evt) {
        evt.classList.remove("dragging");
        drag = null;
        lastPointerEvt = null;
        if (autoScrollRaf != null) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
        renderCalendar();
      }
    });
  });
}

let currentDetail = null;

function openActivityDetail(dayIdx, actId, ev) {
  if (ev) {
    if (ev.target.closest(".evt-drag-handle")) return;
    ev.stopPropagation();
  }
  const act = state.days[dayIdx]?.activities.find((a) => a.id === actId);
  if (!act) return;
  currentDetail = { type: "act", day: dayIdx, id: actId };
  const body = document.getElementById("detail-body");
  const title = document.getElementById("detail-title");
  title.textContent = `Jour ${dayIdx + 1} · Activité`;
  const swatches = ACTIVITY_COLORS.map((c) => {
    const selected = (act.color || "") === c.value ? " selected" : "";
    const isDefault = c.value === "";
    const styleAttr = isDefault ? "" : ` style="background:${c.value}"`;
    const cls = isDefault ? "color-swatch color-default" : "color-swatch";
    return `<button type="button" class="${cls}${selected}" data-color="${c.value}" title="${c.name}" aria-label="${c.name}"${styleAttr}></button>`;
  }).join("");
  body.innerHTML = `
    <label class="detail-label">Nom
      <input type="text" id="dp-name" placeholder="Activité" value="${escapeAttr(act.name || "")}">
    </label>
    <label class="detail-label">Durée (minutes)
      <input type="number" id="dp-duration" min="15" step="15" value="${Number(act.durationMin) || 60}">
    </label>
    <label class="detail-label">Couleur
      <div class="color-palette" id="dp-colors">${swatches}</div>
    </label>
    <label class="detail-label">Lieu
      <input type="text" id="dp-place" placeholder="Adresse, ville…" value="${escapeAttr(act.place || "")}">
      <div class="geocode-status" id="dp-geo">${act.latLng ? '<span class="geocode-ok">✓ Localisé</span>' : ""}</div>
    </label>
    <div class="detail-map-wrap"><div id="dp-map" class="detail-map"></div></div>
    <label class="detail-label">Notes
      <textarea id="dp-desc" placeholder="Notes, lien…">${escapeHtml(act.description || "")}</textarea>
    </label>
    <div class="detail-actions">
      <button class="btn btn-danger btn-sm" onclick="removeCalAct(${dayIdx},${actId});closeDetail()">Supprimer</button>
    </div>
  `;
  document.querySelectorAll("#dp-colors .color-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = btn.dataset.color || "";
      updateActivity(dayIdx, actId, "color", c || null);
      document.querySelectorAll("#dp-colors .color-swatch").forEach((b) => b.classList.toggle("selected", b === btn));
      const evtEl = document.getElementById(`evt-${dayIdx}-${actId}`);
      if (evtEl) {
        if (c) evtEl.style.setProperty("--act-color", c);
        else evtEl.style.removeProperty("--act-color");
      }
      updateMap();
    });
  });
  document.getElementById("dp-duration").addEventListener("input", (e) => {
    const v = Math.max(15, Number(e.target.value) || 60);
    updateActivity(dayIdx, actId, "durationMin", v);
    renderCalendar();
  });
  document.getElementById("dp-name").addEventListener("input", (e) => {
    updateActivity(dayIdx, actId, "name", e.target.value);
    const label = document.querySelector(`#evt-${dayIdx}-${actId} .evt-compact-name`);
    if (label) label.textContent = e.target.value || "Sans titre";
  });
  document.getElementById("dp-place").addEventListener("input", (e) => {
    updateActivity(dayIdx, actId, "place", e.target.value);
    scheduleGeocode(`dp_${dayIdx}_${actId}`, e.target.value, (ll) => {
      const a = state.days[dayIdx].activities.find((a) => a.id === actId);
      if (a) a.latLng = ll;
      const geo = document.getElementById("dp-geo");
      if (geo) geo.innerHTML = ll ? '<span class="geocode-ok">✓ Localisé</span>' : "";
      updateDetailMap(ll);
    });
  });
  document.getElementById("dp-desc").addEventListener("input", (e) => {
    updateActivity(dayIdx, actId, "description", e.target.value);
  });
  setTimeout(() => initDetailMap(act.latLng), 50);
  showDetailPanel();
}

let detailMap = null;
let detailMarker = null;
function initDetailMap(latLng) {
  const el = document.getElementById("dp-map");
  if (!el) return;
  if (detailMap) {
    detailMap.remove();
    detailMap = null;
    detailMarker = null;
  }
  const center = latLng || [46.2, 2.3];
  const zoom = latLng ? 15 : 5;
  detailMap = L.map(el, { zoomControl: true, attributionControl: false }).setView(center, zoom);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(detailMap);
  if (latLng) {
    detailMarker = L.marker(latLng).addTo(detailMap);
  }
  setTimeout(() => detailMap && detailMap.invalidateSize(), 100);
}

function updateDetailMap(latLng) {
  if (!detailMap) return initDetailMap(latLng);
  if (latLng) {
    if (detailMarker) detailMarker.setLatLng(latLng);
    else detailMarker = L.marker(latLng).addTo(detailMap);
    detailMap.setView(latLng, 15);
  }
}

function openNightDetail(dayIdx, ev) {
  if (ev) ev.stopPropagation();
  const day = state.days[dayIdx];
  if (!day) return;
  currentDetail = { type: "night", day: dayIdx };
  const body = document.getElementById("detail-body");
  const title = document.getElementById("detail-title");
  title.textContent = `Jour ${dayIdx + 1} · Hébergement`;
  body.innerHTML = `
    <label class="detail-label">Hôtel, Airbnb…
      <input type="text" id="dp-night-place" value="${escapeAttr(day.nightLocation || "")}">
      <div class="geocode-status" id="dp-night-geo">${day.nightLatLng ? '<span class="geocode-ok">✓ Localisé</span>' : ""}</div>
    </label>
    <div class="detail-map-wrap"><div id="dp-map" class="detail-map"></div></div>
    <label class="detail-label">Notes / lien booking
      <textarea id="dp-night-desc">${escapeHtml(day.nightDescription || "")}</textarea>
    </label>
  `;
  setTimeout(() => initDetailMap(day.nightLatLng), 50);
  document.getElementById("dp-night-place").addEventListener("input", (e) => {
    updateDayField(dayIdx, "nightLocation", e.target.value);
    scheduleGeocode(`dp_night_${dayIdx}`, e.target.value, (ll) => {
      state.days[dayIdx].nightLatLng = ll;
      const geo = document.getElementById("dp-night-geo");
      if (geo) geo.innerHTML = ll ? '<span class="geocode-ok">✓ Localisé</span>' : "";
      updateDetailMap(ll);
    });
    const label = document.querySelector(`.cal-day:nth-child(${dayIdx + 2}) .cal-evt-night .evt-compact-name`);
    if (label) label.textContent = e.target.value || "Hébergement";
  });
  document.getElementById("dp-night-desc").addEventListener("input", (e) => {
    updateDayField(dayIdx, "nightDescription", e.target.value);
  });
  showDetailPanel();
}

function showDetailPanel() {
  const panel = document.getElementById("detail-panel");
  const cal = document.getElementById("tab-jours");
  if (cal) {
    const top = Math.max(80, cal.getBoundingClientRect().top);
    panel.style.top = top + "px";
  }
  panel.classList.add("open");
  document.body.classList.add("detail-open");
  document.querySelectorAll(".cal-evt.selected").forEach((el) => el.classList.remove("selected"));
  if (currentDetail) {
    if (currentDetail.type === "act") {
      const el = document.getElementById(`evt-${currentDetail.day}-${currentDetail.id}`);
      if (el) el.classList.add("selected");
    }
  }
  setTimeout(() => map && map.invalidateSize(), 260);
}

function closeDetail() {
  currentDetail = null;
  const panel = document.getElementById("detail-panel");
  panel.classList.remove("open");
  document.body.classList.remove("detail-open");
  document.querySelectorAll(".cal-evt.selected").forEach((el) => el.classList.remove("selected"));
  if (detailMap) {
    detailMap.remove();
    detailMap = null;
    detailMarker = null;
  }
  setTimeout(() => map && map.invalidateSize(), 260);
}

document.addEventListener("pointerdown", (e) => {
  if (!currentDetail) return;
  if (e.target.closest("#detail-panel")) return;
  if (e.target.closest(".cal-evt")) return;
  closeDetail();
});

document.addEventListener("keydown", (e) => {
  const inField = e.target.matches("input, textarea, select, [contenteditable]");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && !inField && currentDetail) {
    e.preventDefault();
    if (currentDetail.type === "act") {
      removeCalAct(currentDetail.day, currentDetail.id);
      closeDetail();
    } else if (currentDetail.type === "night") {
      updateDayField(currentDetail.day, "nightLocation", "");
      updateDayField(currentDetail.day, "nightDescription", "");
      state.days[currentDetail.day].nightLatLng = null;
      saveState();
      closeDetail();
      renderCalendar();
      updateMap();
    }
  }
});

function initCalendarClickToCreate(START_HOUR, HOUR_PX) {
  const SNAP_MIN = 15;
  document.querySelectorAll(".cal-day-body").forEach((body, dayIdx) => {
    body.addEventListener("click", (e) => {
      if (e.target.closest(".cal-evt") || e.target.closest(".cal-add-btn-wrap")) return;
      const rect = body.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const mins = Math.max(0, Math.round((y / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN);
      const total = START_HOUR * 60 + mins;
      const hh = String(Math.floor(total / 60)).padStart(2, "0");
      const mm = String(total % 60).padStart(2, "0");
      const newAct = {
        id: Date.now(),
        time: `${hh}:${mm}`,
        name: "",
        place: "",
        latLng: null,
        description: "",
        durationMin: 60,
      };
      state.days[dayIdx].activities.push(newAct);
      saveState();
      renderCalendar();
      openActivityDetail(dayIdx, newAct.id);
      setTimeout(() => {
        const input = document.getElementById("dp-name");
        if (input) input.focus();
      }, 100);
    });
  });
}

function timeToPos(time, startHour, hourPx) {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return Math.max(0, (h - startHour + m / 60) * hourPx);
}

let fillTravelToken = 0;
const travelCache = {};
function travelKey(from, to) {
  return `${from[0].toFixed(4)},${from[1].toFixed(4)}|${to[0].toFixed(4)},${to[1].toFixed(4)}`;
}

async function fillTravelTimes(trip) {
  const myToken = ++fillTravelToken;
  const destLL = getDestAirportLatLng();
  const HOUR_PX = 60;
  const pxPerMin = HOUR_PX / 60;
  let prev = null;

  for (let i = 0; i < trip.n; i++) {
    if (myToken !== fillTravelToken) return;
    const day = state.days[i];
    if (!day) continue;
    const flights = getFlightsOn(trip.dates[i]);
    const hasArrive = flights.some((f) => f.ev === "arrive");
    const hasDepart = flights.some((f) => f.ev === "depart");

    if (hasArrive && destLL) prev = destLL;

    const wps = [];
    day.activities.forEach((act) => {
      if (act.latLng) {
        wps.push({
          time: act.time || "00:00",
          ll: act.latLng,
          elId: `travel-act-${act.id}`,
        });
      }
    });
    if (!hasDepart && day.nightLatLng) {
      wps.push({
        time: "21:00",
        ll: day.nightLatLng,
        elId: `travel-night-${i}`,
      });
    }
    wps.sort((a, b) => a.time.localeCompare(b.time));

    for (const wp of wps) {
      if (myToken !== fillTravelToken) return;
      const el = document.getElementById(wp.elId);
      if (el && prev) {
        const key = travelKey(prev, wp.ll);
        let info = travelCache[key];
        if (!info) {
          info = await getDrivingTime(prev, wp.ll);
          if (info) travelCache[key] = info;
        }
        if (myToken !== fillTravelToken) return;
        if (info) {
          const h = Math.max(16, info.min * pxPerMin);
          const top = Number(el.dataset.activityTop) || 0;
          el.style.top = Math.max(0, top - h) + "px";
          el.style.height = h + "px";
          el.style.display = "";
          const t = el.querySelector(".travel-text");
          if (t) t.textContent = info.text;
        }
      } else if (el) {
        el.style.display = "none";
      }
      prev = wp.ll;
    }
  }
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function addCalAct(i) {
  state.days[i].activities.push({
    id: Date.now(),
    time: "",
    name: "",
    place: "",
    latLng: null,
    description: "",
    durationMin: 60,
  });
  saveState();
  renderCalendar();
}

function removeCalAct(i, id) {
  state.days[i].activities = state.days[i].activities.filter(
    (a) => a.id !== id
  );
  saveState();
  renderCalendar();
  updateMap();
}

function updateDayField(i, f, v) {
  state.days[i][f] = v;
  saveState();
}

function updateActivity(i, id, f, v) {
  const a = state.days[i].activities.find((a) => a.id === id);
  if (a) a[f] = v;
  saveState();
}

function changeDays(d) {
  state.numDays = Math.max(1, Math.min(60, state.numDays + d));
  saveState();
  document.getElementById("days-count-display").textContent = state.numDays;
  renderCalendar();
}

// ===================== INIT =====================
document.getElementById("trip-title-input").addEventListener("input", (e) => {
  state.title = e.target.value;
  document.title = e.target.value + " — Jet Laggueur";
  saveState();
  renderTripSelector();
});

ensureFlights();
restoreUI();

// ===================== PANTRY SYNC =====================
const PANTRY_BASE = "https://getpantry.cloud/apiv1/pantry";

function getSyncConfig() {
  try {
    const raw = localStorage.getItem("voyageplanner_pantry");
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { pantryId: "", basket: "voyages", auto: false, sharedIds: null };
}

function setSyncConfig(cfg) {
  localStorage.setItem("voyageplanner_pantry", JSON.stringify(cfg));
}

function openSync() {
  const cfg = getSyncConfig();
  document.getElementById("modal-title").textContent = "Synchroniser (Pantry)";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">
      Partage le même <strong>Pantry ID</strong> avec ton ami pour synchroniser les voyages.
      Crée un pantry gratuit sur <a href="https://getpantry.cloud" target="_blank" rel="noopener">getpantry.cloud</a>.
    </p>
    <label style="display:block;margin-top:8px;">Pantry ID</label>
    <input type="text" id="sync-pantry-id" value="${escapeHtml(cfg.pantryId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="width:100%;padding:8px;box-sizing:border-box;">
    <label style="display:block;margin-top:8px;">Nom du basket</label>
    <input type="text" id="sync-basket" value="${escapeHtml(cfg.basket || "voyages")}" style="width:100%;padding:8px;box-sizing:border-box;">
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
      <input type="checkbox" id="sync-auto" ${cfg.auto ? "checked" : ""}>
      <span>Push automatique après chaque modification (avec délai)</span>
    </label>
    <div style="margin-top:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>Voyages à partager</strong>
        <span style="font-size:11px;">
          <a href="#" onclick="toggleAllShared(true);return false;">Tout</a> ·
          <a href="#" onclick="toggleAllShared(false);return false;">Aucun</a>
        </span>
      </div>
      <div id="sync-trip-list" style="max-height:180px;overflow:auto;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px;margin-top:4px;">
        ${renderSyncTripList(cfg)}
      </div>
    </div>
    <div class="modal-actions" style="margin-top:12px;">
      <button class="btn btn-gold btn-sm" onclick="saveSyncConfig()">💾 Enregistrer</button>
      <button class="btn btn-gold btn-sm" onclick="syncPush()">⬆ Envoyer</button>
      <button class="btn btn-gold btn-sm" onclick="syncPull()">⬇ Récupérer & fusionner</button>
    </div>
    <div id="sync-status" class="modal-status"></div>
    <p class="modal-hint" style="margin-top:10px;font-size:11px;opacity:.7;">
      La fusion garde la version la plus récente de chaque voyage (par <code>updatedAt</code>).
      Les suppressions ne se propagent pas — supprime manuellement sur chaque appareil.
    </p>
  `;
  showModal();
}

function renderSyncTripList(cfg) {
  if (!allTrips.length) return '<p style="font-size:12px;opacity:.7;">Aucun voyage.</p>';
  const shared = cfg.sharedIds;
  return allTrips.map((t) => {
    const checked = (shared === null || shared === undefined) ? true : shared.includes(t.id);
    return `<label style="display:flex;align-items:center;gap:8px;padding:4px;">
      <input type="checkbox" class="sync-trip-cb" data-id="${t.id}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(t.title || "Voyage")}</span>
    </label>`;
  }).join("");
}

function toggleAllShared(on) {
  document.querySelectorAll(".sync-trip-cb").forEach((cb) => { cb.checked = on; });
}

function getSelectedSharedIds() {
  const ids = [];
  document.querySelectorAll(".sync-trip-cb").forEach((cb) => {
    if (cb.checked) ids.push(Number(cb.dataset.id));
  });
  return ids;
}

function saveSyncConfig() {
  const cfg = {
    pantryId: document.getElementById("sync-pantry-id").value.trim(),
    basket: document.getElementById("sync-basket").value.trim() || "voyages",
    auto: document.getElementById("sync-auto").checked,
    sharedIds: getSelectedSharedIds(),
  };
  setSyncConfig(cfg);
  setSyncStatus("✓ Enregistré");
}

function setSyncStatus(msg) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = msg;
}

function readSyncInputs() {
  const idEl = document.getElementById("sync-pantry-id");
  const bEl = document.getElementById("sync-basket");
  const cfg = getSyncConfig();
  if (idEl) cfg.pantryId = idEl.value.trim();
  if (bEl) cfg.basket = bEl.value.trim() || "voyages";
  if (document.getElementById("sync-auto")) cfg.auto = document.getElementById("sync-auto").checked;
  if (document.querySelector(".sync-trip-cb")) cfg.sharedIds = getSelectedSharedIds();
  setSyncConfig(cfg);
  return cfg;
}

function tripsToShare(cfg) {
  if (!cfg.sharedIds) return allTrips;
  return allTrips.filter((t) => cfg.sharedIds.includes(t.id));
}

async function syncPush() {
  const cfg = readSyncInputs();
  if (!cfg.pantryId) { setSyncStatus("⚠ Renseigne un Pantry ID"); return; }
  setSyncStatus("⏳ Envoi…");
  try {
    const shared = tripsToShare(cfg);
    const body = { trips: shared, updatedAt: Date.now() };
    const r = await fetch(`${PANTRY_BASE}/${encodeURIComponent(cfg.pantryId)}/basket/${encodeURIComponent(cfg.basket)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    setSyncStatus("✓ Envoyé (" + shared.length + " voyages)");
  } catch (e) {
    setSyncStatus("⚠ Erreur envoi : " + e.message);
  }
}

async function syncPull() {
  const cfg = readSyncInputs();
  if (!cfg.pantryId) { setSyncStatus("⚠ Renseigne un Pantry ID"); return; }
  setSyncStatus("⏳ Récupération…");
  try {
    const r = await fetch(`${PANTRY_BASE}/${encodeURIComponent(cfg.pantryId)}/basket/${encodeURIComponent(cfg.basket)}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    const remote = Array.isArray(data.trips) ? data.trips : [];
    const merged = mergeTrips(allTrips, remote);
    allTrips = merged;
    if (!allTrips.find((t) => t.id === currentTripId)) {
      currentTripId = allTrips[0].id;
    }
    state = getTripState(currentTripId);
    ensureFlights();
    localStorage.setItem("voyageplanner_trips", JSON.stringify(allTrips));
    localStorage.setItem("voyageplanner_current", String(currentTripId));
    renderTripSelector();
    restoreUI();
    setSyncStatus("✓ Fusionné (" + allTrips.length + " voyages au total)");
  } catch (e) {
    setSyncStatus("⚠ Erreur récup : " + e.message);
  }
}

function mergeTrips(local, remote) {
  const byId = new Map();
  for (const t of local) byId.set(t.id, t);
  for (const t of remote) {
    const ex = byId.get(t.id);
    if (!ex || (t.updatedAt || 0) > (ex.updatedAt || 0)) {
      byId.set(t.id, t);
    }
  }
  return Array.from(byId.values());
}

let autoSyncTimer = null;
function maybeAutoSync() {
  const cfg = getSyncConfig();
  if (!cfg.auto || !cfg.pantryId) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    const shared = tripsToShare(cfg);
    fetch(`${PANTRY_BASE}/${encodeURIComponent(cfg.pantryId)}/basket/${encodeURIComponent(cfg.basket)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trips: shared, updatedAt: Date.now() }),
    }).catch(() => {});
  }, 3000);
}
