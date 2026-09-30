// Leaflet map, marker pills, OSRM routing, Nominatim geocoding.

// ============== BASE LAYER ==============
// CARTO's free basemaps now stamp "API KEY REQUIRED" across every tile, so the
// default is OpenStreetMap's standard layer, softened in CSS (.leaflet-tile-pane)
// to keep the pale look. Fill in CARTO_API_KEY to go back to Positron.
const CARTO_API_KEY = "";

const BASE_TILES = CARTO_API_KEY
  ? {
      url: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?api_key=${CARTO_API_KEY}`,
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      options: { subdomains: "abcd", maxZoom: 20 },
    }
  : {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenStreetMap",
      options: { maxZoom: 19 },
    };

function addBaseLayer(target, withAttribution = true) {
  return L.tileLayer(BASE_TILES.url, {
    ...BASE_TILES.options,
    attribution: withAttribution ? BASE_TILES.attribution : "",
  }).addTo(target);
}

const map = L.map("map", { zoomControl: true }).setView([46.2, 2.3], 5);
addBaseLayer(map);

let mapMarkers = [];
// Leaflet stacks markers by latitude; these offsets keep activities above
// the airport, and both above nights, wherever they are.
const MARKER_LAYER = { activity: 20000, airport: 10000, night: 0 };
let routePolylines = [];

function clearMap() {
  mapMarkers.forEach((m) => map.removeLayer(m));
  mapMarkers = [];
  routePolylines.forEach((p) => map.removeLayer(p));
  routePolylines = [];
}

// `days` / `nights`: day indexes of the activities / nights on this pill,
// used to highlight it when one of those days is focused.
function makeIcon(color, label, { days = [], nights = [], isAirport = false, count = 1 } = {}) {
  const safe = escapeHtml(String(label || ""));
  const attrs = ` data-days="${days.join(",")}" data-nights="${nights.join(",")}"` + (isAirport ? ` data-airport="1"` : "");
  const badge = count > 1 ? `<span class="map-pill-count">${count}</span>` : "";
  return L.divIcon({
    className: "map-pill-icon",
    html: `<div class="map-pill"${attrs} style="background:${color};"><span class="map-pill-dot"></span><span class="map-pill-label">${safe}</span>${badge}</div>`,
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

// Airport of the way home (fromCode of the return flight); the arrival one
// when it is not set.
function getDepartAirportCode() {
  const code = ((state.flights[1] && state.flights[1].fromCode) || "").toUpperCase();
  return (code && AP[code]) ? code : getDestAirportCode();
}

function getDepartAirportLatLng() {
  const code = getDepartAirportCode();
  return code ? [AP[code].lat, AP[code].lng] : null;
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
      layer: MARKER_LAYER.airport,
      popup: `✈ ${destCode} · ${a.c}<br><small>${a.n}</small>`,
    });
  }
  const departCode = getDepartAirportCode();
  if (departCode && departCode !== destCode) {
    const a = AP[departCode];
    pts.push({
      latlng: [a.lat, a.lng],
      label: departCode,
      color: colNavy,
      isAirport: true,
      layer: MARKER_LAYER.airport,
      popup: `✈ ${departCode} · ${a.c}<br><small>${a.n}</small>`,
    });
  }

  // Routes always trace through every saved waypoint (activities + nights).
  // Visibility toggles only affect markers, not the itinerary itself.
  const routePts = [];
  const destLL = getDestAirportLatLng();
  const showActivities = getShowActivities();
  const showNights = getShowNights();
  const showTravel = getShowTravel();

  state.days.forEach((day, i) => {
    const isFirstDay = i === 0;
    const isLastDay = i === state.days.length - 1;

    // First day: airport is first waypoint
    if (isFirstDay && destLL) {
      routePts.push({ latlng: destLL, label: destCode || "✈", exact: true });
    }

    // Activities — markers gated by toggle, route always traces through them
    const visitor = isSurpriseView();
    day.activities.forEach((act, j) => {
      if (!act.latLng) return;
      const label = visitor
        ? (act.shareName || `J${i + 1} · ${String.fromCharCode(65 + j)}`)
        : (act.name || act.place || `J${i + 1} activité ${String.fromCharCode(65 + j)}`);
      if (showActivities) {
        const popupText = visitor
          ? `<b>${act.time || ""}</b> ${escapeHtml(act.shareName || "")}${act.shareDescription ? "<br><small>" + escapeHtml(act.shareDescription) + "</small>" : ""}`
          : `<b>${act.time || ""}</b> ${escapeHtml(act.name || "")}${act.description ? "<br><small>" + escapeHtml(act.description) + "</small>" : ""}`;
        pts.push({
          latlng: act.latLng,
          label,
          color: act.color || colGold,
          layer: MARKER_LAYER.activity,
          kind: "act",
          open: `openActivityDetail(${i}, ${act.id})`,
          line: `J${i + 1}${act.time ? " · " + act.time : ""}`,
          dayIdx: i,
          popup: popupText,
        });
      }
      routePts.push({ latlng: act.latLng, label, dayIdx: i, exact: placeShown(act) });
    });

    // Night location (not on last day) — same logic: marker gated, route always
    if (day.nightLatLng && !isLastDay) {
      const label = "Nuit";
      if (showNights) {
        const nightPopup = visitor
          ? `🌙 Nuit ${i + 1}${day.nightLocation ? ": " + escapeHtml(day.nightLocation) : ""}${day.nightShareDescription ? "<br><small>" + escapeHtml(day.nightShareDescription) + "</small>" : ""}`
          : `🌙 Nuit ${i + 1}: ${escapeHtml(day.nightLocation || "")}${day.nightDescription ? "<br><small>" + escapeHtml(day.nightDescription) + "</small>" : ""}`;
        pts.push({
          latlng: day.nightLatLng,
          label,
          color: colNavyLight,
          layer: MARKER_LAYER.night,
          kind: "night",
          open: `openNightDetail(${i})`,
          line: `Nuit ${i + 1}`,
          name: day.nightLocation || "Hébergement",
          dayIdx: i,
          popup: nightPopup,
        });
      }
      routePts.push({ latlng: day.nightLatLng, label, dayIdx: i, exact: nightPlaceShown(day) });
    }

    // Last day: the departure airport is the last waypoint
    const departLL = getDepartAirportLatLng();
    if (isLastDay && departLL) {
      routePts.push({ latlng: departLL, label: getDepartAirportCode() || "✈", exact: true });
    }
  });

  if (pts.length === 0 && (!showTravel || routePts.length < 2)) {
    const info = document.getElementById("map-info");
    if (info) info.innerHTML = "🗺️ Ajoutez des lieux pour voir l'itinéraire";
    return;
  }

  groupMapPoints(pts).forEach((g) => {
    const p = g[0];
    const acts = g.filter((x) => x.kind === "act");
    const days = acts.map((x) => x.dayIdx);
    const nights = g.filter((x) => x.kind === "night").map((x) => x.dayIdx);
    const lead = acts[0] || p;
    const icon = makeIcon(lead.color, lead.label, { days, nights, isAirport: p.isAirport, count: g.length });
    const layer = Math.max(...g.map((x) => x.layer || 0));
    const m = L.marker(p.latlng, { icon, zIndexOffset: layer })
      .addTo(map)
      .bindPopup(g.length > 1 ? groupPopupHtml(g) : p.popup);
    m._dayIdx = p.dayIdx;
    m._isAirport = !!p.isAirport;
    mapMarkers.push(m);
  });

  if (showTravel && routePts.length > 1) {
    await drawRoutes(routePts);
  } else {
    const info = document.getElementById("map-info");
    if (info) info.innerHTML = showTravel
      ? "🗺️ Ajoutez des lieux pour voir l'itinéraire"
      : "Trajets masqués.";
  }

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
  const list = (s) => (s ? s.split(",").map(Number) : []);
  pills.forEach((p) => {
    const days = list(p.dataset.days);
    const nights = list(p.dataset.nights);
    const isAirport = p.dataset.airport === "1";
    // A day shows its activities, its night and the night before.
    const inFocus = focusedDay != null && (
      days.includes(focusedDay) ||
      nights.includes(focusedDay) ||
      (prev != null && nights.includes(prev)) ||
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

// Activities and nights on the same spot (~10 m) share one pill; its popup
// lists them. The airport keeps its own.
function groupMapPoints(pts) {
  const groups = new Map();
  const out = [];
  pts.forEach((p) => {
    if (p.isAirport) { out.push([p]); return; }
    const key = p.latlng[0].toFixed(4) + "," + p.latlng[1].toFixed(4);
    if (!groups.has(key)) { groups.set(key, []); out.push(groups.get(key)); }
    groups.get(key).push(p);
  });
  // Chronological: day, then activities before the night.
  out.forEach((g) => g.sort((a, b) => (a.dayIdx - b.dayIdx) || ((a.kind === "night") - (b.kind === "night"))));
  return out;
}

function groupPopupHtml(g) {
  const items = g.map((x) => `<button type="button" class="map-group-item" onclick="map.closePopup();${x.open}">
      <span class="map-group-dot" style="background:${x.color}"></span>
      <span class="map-group-when">${escapeHtml(x.line || "")}</span>
      <span class="map-group-name">${escapeHtml(x.name || x.label || "")}</span>
    </button>`).join("");
  return `<div class="map-group"><div class="map-group-title">${g.length} étapes ici</div>${items}</div>`;
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

// ============== ROUTING (OSRM) ==============
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

// A plain line between two points, when one of them is blurred (surprise
// view): a road route to an approximate spot would be made up.
function drawStraightSegment(from, to) {
  const routeColor = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#c9a84c";
  const poly = L.polyline([from.latlng, to.latlng], {
    color: routeColor,
    weight: 3,
    opacity: 0.8,
    dashArray: "6,4",
  }).addTo(map);
  poly._dayIdx = to.dayIdx != null ? to.dayIdx : from.dayIdx;
  routePolylines.push(poly);
  return `<b>${escapeHtml(from.label)} → ${escapeHtml(to.label)}</b>: lieu approximatif`;
}

async function drawRoutes(pts) {
  const infos = [];
  // First pass: draw cached segments instantly; segments with a blurred end
  // (surprise view) stay a straight line.
  const segments = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const from = pts[i];
    const to = pts[i + 1];
    if (from.exact === false || to.exact === false) {
      infos.push(drawStraightSegment(from, to));
      segments.push(null);
      continue;
    }
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

// ============== GEOCODING (Nominatim) ==============
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
