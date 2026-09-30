// Vertical timeline: the read-only view on phones (Android app and mobile
// web), in place of the hour grid which is unreadable at that width. One
// continuous list, day by day: flights, activities with weather and travel
// time, the night's accommodation, and a "now" marker on today.

const TIMELINE_MEDIA = window.matchMedia("(max-width: 760px)");
let timelineToken = 0;
let timelineScrolledFor = null;

function timelineActive() {
  return TIMELINE_MEDIA.matches && isReadOnly() && currentView === "trip";
}

function tlMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function tlClock(min) {
  return String(Math.floor(min / 60) % 24).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}

// End time, marked "+1" when the activity runs past midnight.
function tlEnd(min) {
  return tlClock(min) + (min > 1440 ? " <small>+1</small>" : "");
}

function tlDayItems(i, date) {
  const day = state.days[i];
  const flights = date ? getFlightsOn(date) : [];
  const arrive = flights.find((f) => f.ev === "arrive");
  const depart = flights.find((f) => f.ev === "depart");
  const items = [];
  if (arrive) items.push({ kind: "flight", start: tlMinutes(arrive.arriveTime), f: arrive });
  // What is left of yesterday's activities running past midnight.
  const prev = state.days[i - 1];
  if (prev) prev.activities.forEach((act, j) => {
    const start = tlMinutes(act.time);
    const end = start == null ? null : start + (Number(act.durationMin) || 60);
    if (end > 1440) items.push({ kind: "cont", start: 0, end: Math.min(end - 1440, 1440), act, j, fromDay: i - 1 });
  });
  day.activities.forEach((act, j) => {
    const start = tlMinutes(act.time);
    const dur = Number(act.durationMin) || 60;
    items.push({ kind: "act", start, end: start == null ? null : start + dur, act, j });
  });
  if (depart) items.push({ kind: "flight", start: tlMinutes(depart.departTime), f: depart });
  // Timed items in order, untimed ones after them.
  items.sort((x, y) => (x.start == null) - (y.start == null) || (x.start || 0) - (y.start || 0));
  // The night only once it is entered.
  if (!depart && day.nightLocation) items.push({ kind: "night", start: 21 * 60 });
  return items;
}

function tlItemHtml(i, it, visitor) {
  const day = state.days[i];
  const real = showsRealPlaces();
  if (it.kind === "cont") {
    const act = it.act;
    const name = visitor ? (act.shareName || `Activité ${String.fromCharCode(65 + it.j)}`) : (act.name || "Sans titre");
    const color = act.color ? ` style="--act-color:${escapeAttr(act.color)}"` : "";
    return `<li class="tl-item tl-act tl-cont" data-start="0" data-end="${it.end}"${color}
      onclick="openActivityDetail(${it.fromDay}, ${act.id}, event)">
      <div class="tl-time"><strong>00:00</strong><span>${tlClock(it.end)}</span></div>
      <div class="tl-card">
        <div class="tl-title">↳ ${escapeHtml(name)}</div>
        <div class="tl-sub">Suite de la veille</div>
      </div>
    </li>`;
  }
  if (it.kind === "flight") {
    const f = it.f;
    const code = ((f.ev === "arrive" ? f.toCode : f.fromCode) || "").toUpperCase();
    const city = (AP[code] && AP[code].c) || code || "?";
    const time = f.ev === "arrive" ? f.arriveTime : f.departTime;
    return `<li class="tl-item tl-flight" data-start="${it.start == null ? "" : it.start}">
      <div class="tl-time"><strong>${escapeHtml(time || "—")}</strong></div>
      <div class="tl-card">
        <div class="tl-title">✈ ${f.ev === "arrive" ? "Arrivée" : "Départ"} · ${escapeHtml(city)}${code ? ` (${escapeHtml(code)})` : ""}</div>
        ${f.flightNum ? `<div class="tl-sub">Vol ${escapeHtml(f.flightNum)}</div>` : ""}
      </div>
    </li>`;
  }
  if (it.kind === "night") {
    const name = day.nightLocation || "Hébergement";
    const notes = visitor ? day.nightShareDescription : day.nightDescription;
    return `<li class="tl-travel" id="tl-tr-${i}-night" hidden></li>
    <li class="tl-item tl-night" data-start="${it.start}" onclick="openNightDetail(${i}, event)">
      <div class="tl-time"><strong>Soir</strong></div>
      <div class="tl-card">
        <div class="tl-title">🛏 ${escapeHtml(name)}</div>
        ${notes ? `<div class="tl-notes">${escapeHtml(notes)}</div>` : ""}
        ${real && day.nightLatLng ? `<div class="tl-foot">${itineraryBtnHtml(day.nightLatLng, day.nightLocation, "tl-go")}</div>` : ""}
      </div>
    </li>`;
  }
  const act = it.act;
  const name = visitor
    ? (act.shareName || `Activité ${String.fromCharCode(65 + it.j)}`)
    : (act.name || "Sans titre");
  const notes = visitor ? act.shareDescription : act.description;
  const color = act.color ? ` style="--act-color:${escapeAttr(act.color)}"` : "";
  const go = real && act.latLng ? itineraryBtnHtml(act.latLng, name || act.place, "tl-go") : "";
  return `<li class="tl-travel" id="tl-tr-${i}-${act.id}" hidden></li>
  <li class="tl-item tl-act" data-start="${it.start == null ? "" : it.start}" data-end="${it.end == null ? "" : it.end}"${color}
    onclick="openActivityDetail(${i}, ${act.id}, event)">
    <div class="tl-time">${it.start == null ? "<strong>—</strong>" : `<strong>${tlClock(it.start)}</strong><span>${tlEnd(it.end)}</span>`}</div>
    <div class="tl-card">
      <div class="tl-title">${escapeHtml(name)}</div>
      ${real && act.place ? `<div class="tl-sub">📍 ${escapeHtml(act.place)}</div>` : ""}
      ${notes ? `<div class="tl-notes">${escapeHtml(notes)}</div>` : ""}
      <div class="tl-foot"><span class="tl-wx" id="tl-wx-${i}-${act.id}" hidden></span>${go}</div>
    </div>
  </li>`;
}

function renderTimeline() {
  const box = document.getElementById("timeline");
  if (!box) return;
  const myToken = ++timelineToken;
  if (!timelineActive()) { box.innerHTML = ""; return; }
  const header = document.querySelector(".app-header");
  if (header) document.documentElement.style.setProperty("--app-header-h", header.offsetHeight + "px");

  const visitor = isSurpriseView();
  const trip = computeTripDates();
  const dates = trip ? trip.dates : state.days.map(() => null);
  const today = todayISO();
  let html = tlFiltersHtml();
  html += trip ? "" : `<p class="tl-hint">Les vols ne sont pas encore renseignés : les jours ne sont pas datés.</p>`;
  if (!dates.length) html += `<p class="tl-hint">Aucun jour dans ce voyage pour l'instant.</p>`;
  dates.forEach((date, i) => {
    if (!state.days[i]) return;
    const d = date ? new Date(date + "T00:00:00") : null;
    const label = d
      ? d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
      : `Jour ${i + 1}`;
    const items = tlDayItems(i, date);
    const hasContent = items.some((it) => it.kind !== "night");
    html += `<section class="tl-day${date === today ? " today" : ""}" data-date="${date || ""}" id="tl-day-${i}">
      <header class="tl-day-head" onclick="focusDay(${i})" title="Centrer la carte sur ce jour">
        <span class="tl-day-num">J${i + 1}</span>
        <span class="tl-day-date">${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</span>
        ${date === today ? '<span class="tl-today">Aujourd\'hui</span>' : ""}
      </header>
      <ol class="tl-items">
        ${hasContent ? "" : '<li class="tl-free">Journée libre</li>'}
        ${items.map((it) => tlItemHtml(i, it, visitor)).join("")}
      </ol>
    </section>`;
  });
  box.innerHTML = html;
  updateTimelineNow();

  if (timelineScrolledFor !== currentTripId) {
    timelineScrolledFor = currentTripId;
    const todayEl = box.querySelector(".tl-day.today");
    if (todayEl) setTimeout(() => todayEl.scrollIntoView({ block: "start" }), 50);
  }
  if (trip) {
    fillTimelineWeather(trip, myToken);
    if (showsRealPlaces()) fillTimelineTravel(trip, myToken);
  }
}

// Moves the "now" marker and fades what is over; run every minute.
function updateTimelineNow() {
  const box = document.getElementById("timeline");
  if (!box) return;
  box.querySelectorAll(".tl-now").forEach((el) => el.remove());
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = todayISO();
  box.querySelectorAll(".tl-day").forEach((dayEl) => {
    const date = dayEl.dataset.date;
    const past = date && date < today;
    const isToday = date === today;
    let next = null;
    dayEl.querySelectorAll(".tl-item").forEach((li) => {
      const start = li.dataset.start === "" ? null : Number(li.dataset.start);
      const end = li.dataset.end ? Number(li.dataset.end) : start;
      li.classList.toggle("past", !!past || (isToday && end != null && end <= nowMin));
      if (isToday && !next && start != null && start > nowMin) next = li;
    });
    if (!isToday) return;
    const marker = document.createElement("li");
    marker.className = "tl-now";
    marker.innerHTML = `<span>Maintenant · ${tlClock(nowMin)}</span>`;
    const list = dayEl.querySelector(".tl-items");
    // Keep the travel line glued to the item it leads to.
    const anchor = next && next.previousElementSibling && next.previousElementSibling.classList.contains("tl-travel")
      ? next.previousElementSibling : next;
    list.insertBefore(marker, anchor);
  });
}

async function fillTimelineWeather(trip, myToken) {
  const byLoc = new Map();
  trip.dates.forEach((date, i) => {
    const day = state.days[i];
    if (!day) return;
    day.activities.forEach((act) => {
      if (!act.latLng) return;
      const key = weatherKey(act.latLng);
      if (!byLoc.has(key)) byLoc.set(key, { ll: act.latLng, items: [] });
      byLoc.get(key).items.push({ date, time: act.time, elId: `tl-wx-${i}-${act.id}` });
    });
  });
  await Promise.all(Array.from(byLoc.values()).map(async ({ ll, items }) => {
    const fc = await getForecast(ll);
    if (myToken !== timelineToken || !fc) return;
    for (const it of items) {
      const el = document.getElementById(it.elId);
      const w = readForecast(fc, it.date, it.time);
      const txt = weatherPillText(w);
      if (!el || !txt) continue;
      el.textContent = txt + (w.precip >= 30 ? ` · 💧 ${Math.round(w.precip)} %` : "");
      el.title = weatherPillTitle(w);
      el.hidden = false;
    }
  }));
}

// Same walk as fillTravelTimes() in calendar.js, shares its cache.
async function fillTimelineTravel(trip, myToken) {
  const destLL = getDestAirportLatLng();
  let prev = null;
  for (let i = 0; i < trip.n; i++) {
    const day = state.days[i];
    if (!day) continue;
    const flights = getFlightsOn(trip.dates[i]);
    if (flights.some((f) => f.ev === "arrive") && destLL) prev = destLL;
    const wps = [];
    day.activities.forEach((act) => {
      if (act.latLng) wps.push({ time: act.time || "00:00", ll: act.latLng, elId: `tl-tr-${i}-${act.id}` });
    });
    if (!flights.some((f) => f.ev === "depart") && day.nightLatLng) {
      wps.push({ time: "21:00", ll: day.nightLatLng, elId: `tl-tr-${i}-night` });
    }
    wps.sort((a, b) => a.time.localeCompare(b.time));
    for (const wp of wps) {
      if (myToken !== timelineToken) return;
      if (prev) {
        const key = travelKey(prev, wp.ll);
        let info = travelCache[key];
        if (!info) {
          info = await getDrivingTime(prev, wp.ll);
          if (info) travelCache[key] = info;
        }
        if (myToken !== timelineToken) return;
        const el = document.getElementById(wp.elId);
        if (el && info && info.min > 0) {
          el.innerHTML = `<span>🚗 ${escapeHtml(info.text)}</span>`;
          el.hidden = false;
        }
      }
      prev = wp.ll;
    }
  }
}

// Display filters, also reachable read-only: same preferences as the
// calendar checkboxes, applied to the timeline (CSS) and the map.
function tlFiltersHtml() {
  const chip = (key, label, on) =>
    `<button type="button" class="tl-chip" aria-pressed="${on}" onclick="tlToggleFilter('${key}')">${label}</button>`;
  return `<div class="tl-filters" role="group" aria-label="Afficher">
    ${chip("act", "Activités", getShowActivities())}${chip("night", "Nuits", getShowNights())}${chip("travel", "Trajets", getShowTravel())}
  </div>`;
}

function tlToggleFilter(key) {
  if (key === "act") toggleActivities(!getShowActivities());
  else if (key === "night") toggleNights(!getShowNights());
  else toggleTravel(!getShowTravel());
  const boxes = { "toggle-activities": getShowActivities(), "toggle-nights": getShowNights(), "toggle-travel": getShowTravel() };
  Object.keys(boxes).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = boxes[id];
  });
  renderTimeline();
}

function onTimelineMediaChange() {
  if (currentView === "trip") renderTimeline();
}
if (TIMELINE_MEDIA.addEventListener) TIMELINE_MEDIA.addEventListener("change", onTimelineMediaChange);
else TIMELINE_MEDIA.addListener(onTimelineMediaChange);
