// Leaflet map, marker pills, OSRM routing, Nominatim geocoding.

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
  const showActivities = getShowActivities();
  const showNights = getShowNights();

  state.days.forEach((day, i) => {
    const isFirstDay = i === 0;
    const isLastDay = i === state.days.length - 1;

    // First day: airport is first waypoint
    if (isFirstDay && destLL) {
      routePts.push({ latlng: destLL, label: destCode || "✈" });
    }

    // Activities
    if (showActivities) {
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
    }

    // Night location (not on last day)
    if (showNights && day.nightLatLng && !isLastDay) {
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
