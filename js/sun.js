// Sunrise / sunset, computed locally (sunrise equation, NOAA constants): no
// API, works offline. Used to shade night hours on the calendar grid.

const SUN_CACHE = new Map();

// Minutes after local midnight in `tz` for date "YYYY-MM-DD" at [lat, lng].
// { rise, set } — or { polar: "day" | "night" } when the sun never sets/rises.
function sunTimes(date, latLng, tz) {
  if (!date || !latLng) return null;
  const key = `${date}|${latLng[0].toFixed(2)},${latLng[1].toFixed(2)}|${tz || ""}`;
  if (SUN_CACHE.has(key)) return SUN_CACHE.get(key);
  const [y, m, d] = date.split("-").map(Number);
  const rad = Math.PI / 180;
  const lat = latLng[0];
  const lng = latLng[1];
  const jdNoon = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5;
  const jStar = jdNoon - 2451545.0 + 0.0008 - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
  let out;
  if (cosW > 1) out = { polar: "night" };
  else if (cosW < -1) out = { polar: "day" };
  else {
    const w = Math.acos(cosW) / rad / 360;
    out = {
      rise: localMinutes((jTransit - w - 2440587.5) * 86400000, tz, date),
      set: localMinutes((jTransit + w - 2440587.5) * 86400000, tz, date),
    };
  }
  SUN_CACHE.set(key, out);
  return out;
}

// Minutes since midnight of `date` in `tz` (can fall outside 0–1440 when the
// instant lands on the previous or next local day).
function localMinutes(ms, tz, date) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(ms));
  } catch (e) {
    return localMinutes(ms, undefined, date);
  }
  const get = (t) => parts.find((p) => p.type === t).value;
  const localDate = `${get("year")}-${get("month")}-${get("day")}`;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  const dayShift = Math.round((Date.parse(localDate + "T00:00:00Z") - Date.parse(date + "T00:00:00Z")) / 86400000);
  return mins + dayShift * 1440;
}
