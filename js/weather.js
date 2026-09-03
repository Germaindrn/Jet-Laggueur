// Per-activity weather forecast — Open-Meteo, no API key, 16 days ahead.
// One request per location covers the whole trip: activities are grouped by
// rounded coordinates, so a city visited on five different days costs one call.
// Responses are cached in localStorage for an hour and deduplicated in flight.

const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
const WEATHER_MAX_DAYS = 16;
const WEATHER_CACHE_KEY = "voyageplanner_weather_cache";
const WEATHER_TTL_MS = 60 * 60 * 1000;

// WMO weather codes, as returned by Open-Meteo.
const WEATHER_CODES = {
  0: { icon: "☀️", label: "Ciel dégagé" },
  1: { icon: "🌤️", label: "Plutôt dégagé" },
  2: { icon: "⛅", label: "Partiellement nuageux" },
  3: { icon: "☁️", label: "Couvert" },
  45: { icon: "🌫️", label: "Brouillard" },
  48: { icon: "🌫️", label: "Brouillard givrant" },
  51: { icon: "🌦️", label: "Bruine légère" },
  53: { icon: "🌦️", label: "Bruine" },
  55: { icon: "🌦️", label: "Bruine dense" },
  56: { icon: "🌧️", label: "Bruine verglaçante" },
  57: { icon: "🌧️", label: "Bruine verglaçante dense" },
  61: { icon: "🌦️", label: "Pluie faible" },
  63: { icon: "🌧️", label: "Pluie modérée" },
  65: { icon: "🌧️", label: "Pluie forte" },
  66: { icon: "🌧️", label: "Pluie verglaçante" },
  67: { icon: "🌧️", label: "Pluie verglaçante forte" },
  71: { icon: "🌨️", label: "Neige faible" },
  73: { icon: "🌨️", label: "Neige" },
  75: { icon: "🌨️", label: "Neige forte" },
  77: { icon: "🌨️", label: "Grains de neige" },
  80: { icon: "🌦️", label: "Averses faibles" },
  81: { icon: "🌦️", label: "Averses" },
  82: { icon: "🌧️", label: "Averses violentes" },
  85: { icon: "🌨️", label: "Averses de neige" },
  86: { icon: "🌨️", label: "Fortes averses de neige" },
  95: { icon: "⛈️", label: "Orage" },
  96: { icon: "⛈️", label: "Orage avec grêle" },
  99: { icon: "⛈️", label: "Orage avec forte grêle" },
};

function weatherDesc(code) {
  return WEATHER_CODES[code] || { icon: "🌡️", label: "Conditions inconnues" };
}

// ============== CACHE ==============

let weatherCache = (() => {
  try { return JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || "{}"); } catch (e) { return {}; }
})();

// ~1 km of precision: far finer than a forecast needs, and it makes two
// activities in the same neighbourhood share a single request.
function weatherKey(ll) {
  return `${ll[0].toFixed(2)},${ll[1].toFixed(2)}`;
}

function persistWeatherCache() {
  const now = Date.now();
  for (const k of Object.keys(weatherCache)) {
    if (now - (weatherCache[k].fetchedAt || 0) > WEATHER_TTL_MS) delete weatherCache[k];
  }
  try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weatherCache)); } catch (e) {}
}

const weatherInFlight = {};

// Open-Meteo returns a contiguous hourly series starting at midnight local
// time, so an hour can be addressed by offset instead of storing 384 stamps.
function packForecast(d) {
  if (!d || !d.hourly || !d.hourly.time || !d.hourly.time.length) return null;
  return {
    start: d.hourly.time[0].slice(0, 10),
    code: d.hourly.weather_code,
    temp: d.hourly.temperature_2m,
    precip: d.hourly.precipitation_probability,
    daily: d.daily && d.daily.time
      ? {
          start: d.daily.time[0],
          code: d.daily.weather_code,
          tmax: d.daily.temperature_2m_max,
          tmin: d.daily.temperature_2m_min,
          pmax: d.daily.precipitation_probability_max,
        }
      : null,
  };
}

async function getForecast(ll) {
  if (!ll || ll.length !== 2) return null;
  const key = weatherKey(ll);
  const hit = weatherCache[key];
  if (hit && Date.now() - hit.fetchedAt < WEATHER_TTL_MS) return hit.data;
  if (weatherInFlight[key]) return weatherInFlight[key];

  const url = `${WEATHER_API}?latitude=${ll[0].toFixed(4)}&longitude=${ll[1].toFixed(4)}` +
    "&hourly=temperature_2m,weather_code,precipitation_probability" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    `&timezone=auto&forecast_days=${WEATHER_MAX_DAYS}`;

  const p = (async () => {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = packForecast(await r.json());
      if (data) {
        weatherCache[key] = { fetchedAt: Date.now(), data };
        persistWeatherCache();
      }
      return data;
    } catch (e) {
      return null;
    } finally {
      delete weatherInFlight[key];
    }
  })();
  weatherInFlight[key] = p;
  return p;
}

// ============== LOOKUP ==============

// Parsed as UTC on both sides so a DST change inside the trip can't shift the
// count by a day.
function daysBetweenISO(fromISO, toISO) {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// Shapes returned:
//   null                                          → no location, or fetch failed
//   { outOfRange: true }                          → past the 16-day window
//   { icon, label, temp, precip, hour }           → forecast for the activity's hour
//   { icon, label, tmin, tmax, precip, daily }    → activity with no time set
function readForecast(fc, date, time) {
  if (!fc || !date) return null;
  const dayOffset = daysBetweenISO(fc.start, date);
  if (dayOffset == null || dayOffset < 0 || dayOffset >= WEATHER_MAX_DAYS) {
    return { outOfRange: true };
  }

  const hh = /^(\d{1,2}):/.exec(time || "");
  if (!hh) {
    const d = fc.daily;
    const i = d ? daysBetweenISO(d.start, date) : null;
    if (!d || i == null || i < 0 || i >= (d.code || []).length) return { outOfRange: true };
    return {
      ...weatherDesc(d.code[i]),
      tmin: d.tmin[i],
      tmax: d.tmax[i],
      precip: d.pmax[i],
      daily: true,
    };
  }

  const idx = dayOffset * 24 + Math.min(23, Number(hh[1]));
  if (idx < 0 || idx >= (fc.code || []).length) return { outOfRange: true };
  return {
    ...weatherDesc(fc.code[idx]),
    temp: fc.temp[idx],
    precip: fc.precip[idx],
    hour: String(Math.min(23, Number(hh[1]))).padStart(2, "0") + ":00",
  };
}

// Convenience wrapper: fetch + read in one call.
async function getWeatherAt(ll, date, time) {
  if (!ll || !date) return null;
  const fc = await getForecast(ll);
  return fc ? readForecast(fc, date, time) : null;
}

// ============== FORMATTING ==============

function formatTemp(v) {
  if (v == null || isNaN(v)) return "";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " °C";
}

// Compact form for the calendar bubble — icon + rounded temperature.
function weatherPillText(w) {
  if (!w || w.outOfRange) return "";
  const v = w.daily ? w.tmax : w.temp;
  if (v == null || isNaN(v)) return "";
  return `${w.icon} ${Math.round(v)}°`;
}

function weatherPillTitle(w) {
  if (!w || w.outOfRange) return "";
  if (w.daily) return `${w.label} · ${Math.round(w.tmin)}° / ${Math.round(w.tmax)}°`;
  return `${w.label} · ${formatTemp(w.temp)} à ${w.hour}`;
}
