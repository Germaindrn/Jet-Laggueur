// Calendar grid (per-day columns + hourly timeline), activity drag-and-drop,
// detail side panel (activity + night), travel-time pills, click-to-create.

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
  if (!s) return null;
  let n;
  if (e && e >= s) {
    n =
      Math.round(
        (new Date(e + "T00:00:00") - new Date(s + "T00:00:00")) / 86400000
      ) + 1;
  } else {
    n = 1;
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
  const metaBox = document.querySelector(".calendar-meta");
  const trip = computeTripDates();
  if (typeof renderTimeline === "function") renderTimeline();

  if (!trip) {
    metaBox.style.display = "flex";
    meta.innerHTML =
      '<span style="color:var(--muted);font-size:0.80rem;">Renseignez l\'arrivée et le départ pour générer le calendrier.</span>';
    grid.innerHTML = `<div class="calendar-empty"><div class="empty-icon">🗓️</div>Ajoutez vos vols dans l'onglet <strong>Vols</strong>.</div>`;
    return;
  }
  ensureDays(trip.n);

  meta.innerHTML = "";
  metaBox.style.display = "flex";

  const START_HOUR = 0;
  const END_HOUR = 24;
  const HOUR_PX = getCalVZoom();
  const DAY_MIN = 1440;

  // Hour labels column — same height as the day bodies so the side strip
  // (background + separator) spans the full calendar height.
  const bodyHeight = (END_HOUR - START_HOUR) * HOUR_PX;
  let hoursCol = `<div class="cal-hours" style="height:${bodyHeight}px">`;
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    hoursCol += `<div class="cal-hour-label" style="top:${(h - START_HOUR) * HOUR_PX}px">${String(h % 24).padStart(2, "0")}:00</div>`;
  }
  hoursCol += '</div>';

  const visitorCal = isSurpriseView();
  const tz = tripTimeZone();
  // Activities running past midnight: the rest is drawn on the next day.
  let carry = [];

  const daysCols = trip.dates.map((date, i) => {
    const day = state.days[i];
    const d = new Date(date + "T00:00:00");
    const wd = d.toLocaleDateString("fr-FR", { weekday: "short" });
    const ds = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const flights = getFlightsOn(date);
    const hasDepart = flights.some((f) => f.ev === "depart");
    const hasArrive = flights.some((f) => f.ev === "arrive");

    let events = "";

    // Daylight band, from sunrise to sunset where the day's night is spent.
    const sun = sunTimes(date, dayLocation(i), tz);
    let bodyCls = "cal-day-body";
    if (sun) {
      bodyCls += " has-sun";
      const rise = sun.polar ? (sun.polar === "day" ? 0 : null) : Math.max(0, sun.rise);
      const set = sun.polar ? (sun.polar === "day" ? DAY_MIN : null) : Math.min(DAY_MIN, sun.set);
      if (rise != null && set > rise) {
        const label = sun.polar ? "" : `data-rise="☀ ${minToClock(sun.rise)}" data-set="☾ ${minToClock(sun.set)}"`;
        events += `<div class="cal-daylight" style="top:${(rise / 60) * HOUR_PX}px;height:${((set - rise) / 60) * HOUR_PX}px" ${label}></div>`;
      }
    }

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
      // The card ends at the landing time (it sits above it), unless that
      // would push it over the day header, just after midnight.
      const arriveCls = top >= 48 ? " cal-evt-arrive" : "";
      events += `<div class="cal-evt cal-evt-flight${arriveCls}" style="top:${top}px">
        <div class="evt-time">${f.arriveTime || ""}</div>
        <div class="evt-title">✈ Arrivée ${toAp ? toAp.c : to}</div>
        <div class="evt-sub">${f.flightNum || ""}</div>
      </div>`;
    }

    // Tail of yesterday's late activities, from midnight
    carry.forEach((c) => {
      const colorStyle = c.act.color ? `--act-color:${c.act.color};` : "";
      const heightPx = Math.max(20, (c.mins / 60) * HOUR_PX);
      events += `<div class="cal-evt cal-evt-act cal-evt-cont" style="${colorStyle}top:0;height:${heightPx}px"
        id="evt-cont-${i}-${c.act.id}" data-day="${c.day}" data-id="${c.act.id}" data-offset="${c.offset}">
        <div class="evt-compact"><span class="evt-compact-name">↳ ${c.label}</span></div>
        <div class="evt-resize-handle" title="Étirer pour changer la durée"></div>
      </div>`;
    });
    const nextCarry = [];

    // Activities
    day.activities.forEach((act, j) => {
      const top = timeToPos(act.time, START_HOUR, HOUR_PX);
      const start = (top / HOUR_PX) * 60;
      const dur = Number(act.durationMin) || 60;
      const spans = start + dur > DAY_MIN;
      const heightPx = Math.max(28, ((Math.min(start + dur, DAY_MIN) - start) / 60) * HOUR_PX);
      const sel = currentDetail && currentDetail.type === "act" && currentDetail.day === i && currentDetail.id === act.id ? " selected" : "";
      const colorStyle = act.color ? `--act-color:${act.color};` : "";
      const evtLabel = visitorCal
        ? escapeHtml(act.shareName || `Activité ${String.fromCharCode(65 + j)}`)
        : escapeHtml(act.name || "Sans titre");
      if (spans) nextCarry.push({ act, day: i, label: evtLabel, offset: DAY_MIN - start, mins: Math.min(start + dur - DAY_MIN, DAY_MIN) });
      events += `<div class="cal-evt cal-evt-travel" id="travel-act-${act.id}" data-activity-top="${top}" style="top:${top}px;height:0;display:none">
        <div class="evt-compact"><span class="evt-compact-name travel-text"></span></div>
      </div>`;
      events += `<div class="cal-evt cal-evt-act${sel}${spans ? " spans" : ""}" style="${colorStyle}top:${top}px;height:${heightPx}px" id="evt-${i}-${act.id}" data-day="${i}" data-id="${act.id}" data-offset="0">
        <div class="evt-compact">
          <span class="evt-compact-name">${evtLabel}</span>
          <span class="evt-weather" id="wx-${i}-${act.id}" style="display:none"></span>
        </div>
        ${spans ? "" : '<div class="evt-resize-handle" title="Étirer pour changer la durée"></div>'}
      </div>`;
    });
    carry = nextCarry;

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

    // Accommodation, under the day (none on the departure day)
    let night = '<div class="cal-day-night none"></div>';
    if (!hasDepart) {
      const sel = currentDetail && currentDetail.type === "night" && currentDetail.day === i ? " selected" : "";
      const name = day.nightLocation
        ? `🛏 ${escapeHtml(day.nightLocation)}`
        : (isReadOnly() ? '<span class="cal-night-empty">Hébergement non renseigné</span>' : '<span class="cal-night-empty">+ Hébergement</span>');
      night = `<div class="cal-day-night${sel}${day.nightLocation ? "" : " empty"}" onclick="openNightDetail(${i},event)">
        <span class="cal-night-name">${name}</span>
        <span class="cal-night-travel" id="travel-night-${i}" hidden></span>
      </div>`;
    }

    return `<div class="cal-day">
      <div class="cal-day-head" onclick="focusDay(${i})" title="Centrer la carte sur ce jour">
        <div class="cal-day-num">J${i + 1}</div>
        <div class="cal-day-wd">${wd.charAt(0).toUpperCase() + wd.slice(1)}</div>
        <div class="cal-day-ds">${ds}</div>
      </div>
      <div class="${bodyCls}" style="height:${bodyHeight}px">
        ${events}
      </div>
      ${night}
    </div>`;
  }).join("");

  grid.innerHTML = hoursCol + daysCols;
  applyCalZoom(getCalZoom());

  initActivityDragDrop(START_HOUR, HOUR_PX);
  initCalendarClickToCreate(START_HOUR, HOUR_PX);
  renderNowLine();

  // Async: fill in travel times, then the weather pills
  fillTravelTimes(trip);
  fillWeather(trip);
}

let fillWeatherToken = 0;

// Groups every located activity by place, so each place costs one request no
// matter how many days it appears on. Runs after the grid is in the DOM.
async function fillWeather(trip) {
  const myToken = ++fillWeatherToken;
  const byLoc = new Map();
  trip.dates.forEach((date, i) => {
    const day = state.days[i];
    if (!day) return;
    day.activities.forEach((act) => {
      if (!act.latLng) return;
      const key = weatherKey(act.latLng);
      if (!byLoc.has(key)) byLoc.set(key, { ll: act.latLng, items: [] });
      byLoc.get(key).items.push({ date, time: act.time, elId: `wx-${i}-${act.id}` });
    });
  });
  if (!byLoc.size) return;

  await Promise.all(Array.from(byLoc.values()).map(async ({ ll, items }) => {
    const fc = await getForecast(ll);
    if (myToken !== fillWeatherToken || !fc) return;
    for (const it of items) {
      const el = document.getElementById(it.elId);
      if (!el) continue;
      const w = readForecast(fc, it.date, it.time);
      const txt = weatherPillText(w);
      if (txt) {
        el.textContent = txt;
        el.title = weatherPillTitle(w);
        el.style.display = "";
      } else {
        el.style.display = "none";
      }
    }
  }));
}

function initActivityDragDrop(START_HOUR, HOUR_PX) {
  const grid = document.getElementById("calendar-grid");
  if (!grid) return;
  if (isReadOnly()) {
    grid.querySelectorAll(".cal-evt-act").forEach((evt) => {
      evt.addEventListener("click", (e) => {
        openActivityDetail(Number(evt.dataset.day), Number(evt.dataset.id), e);
      });
    });
    return;
  }
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
        offset: Number(evt.dataset.offset) || 0,
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
      const minutes = resize.offset + Math.max(15, Math.round((finalH / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN);
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
    top = Math.max(0, Math.min(top, r.height - HOUR_PX / 4));
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

  let docMove = null, docUp = null, docCancel = null;

  function endDrag(commit, e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    lastPointerEvt = null;
    if (autoScrollRaf != null) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
    if (d.el) d.el.classList.remove("dragging");
    if (docMove) document.removeEventListener("pointermove", docMove);
    if (docUp) document.removeEventListener("pointerup", docUp);
    if (docCancel) document.removeEventListener("pointercancel", docCancel);
    docMove = docUp = docCancel = null;
    if (!commit) {
      renderCalendar();
      return;
    }
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
  }

  grid.querySelectorAll(".cal-evt-act").forEach((evt) => {
    if (evt.classList.contains("cal-evt-cont")) {
      evt.addEventListener("click", (e) => {
        if (e.target.closest(".evt-resize-handle")) return;
        openActivityDetail(Number(evt.dataset.day), Number(evt.dataset.id), e);
      });
      return;
    }
    evt.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".evt-resize-handle")) return;
      if (e.button !== 0) return;
      e.preventDefault();
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
      docMove = (ev) => {
        if (!drag) return;
        if (!drag.moved) {
          const dx = Math.abs(ev.clientX - drag.startX);
          const dy = Math.abs(ev.clientY - drag.startY);
          if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
          drag.moved = true;
          drag.el.classList.add("dragging");
        }
        lastPointerEvt = ev;
        applyDragPosition(ev);
        maybeStartAutoScroll();
      };
      docUp = (ev) => endDrag(true, ev);
      docCancel = () => endDrag(false);
      document.addEventListener("pointermove", docMove);
      document.addEventListener("pointerup", docUp);
      document.addEventListener("pointercancel", docCancel);
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
  if (isSurpriseView()) {
    const dur = Number(act.durationMin) || 60;
    const durTxt = dur >= 60
      ? `${Math.floor(dur / 60)}h${dur % 60 ? String(dur % 60).padStart(2, "0") : ""}`
      : `${dur} min`;
    if (act.shareName) title.textContent = `Jour ${dayIdx + 1} · ${act.shareName}`;
    body.innerHTML = `
      <div class="detail-meta">
        ${act.time ? `<div class="detail-meta-time">🕒 ${escapeHtml(act.time)} · ${durTxt}</div>` : ""}
        ${placeShown(act) && act.place ? `<div class="detail-meta-place">📍 ${escapeHtml(act.place)}</div>` : ""}
      </div>
      <div class="detail-map-wrap"><div id="dp-map" class="detail-map"></div></div>
      ${placeShown(act) ? itineraryBtnHtml(act.latLng, act.shareName || act.place) : ""}
      <div class="detail-weather" id="dp-weather"></div>
      <div class="detail-share-desc">
        ${act.shareDescription
          ? escapeHtml(act.shareDescription).replace(/\n/g, "<br>")
          : '<span class="detail-empty">Aucune description partagée.</span>'}
      </div>
    `;
    setTimeout(() => initDetailMap(act.latLng), 50);
    // Safe to show: the visitor's coordinates are blurred by ±2 km, which is
    // far below the resolution of a forecast — no location is given away.
    fillDetailWeather(dayIdx, act);
    showDetailPanel();
    return;
  }
  if (isReadOnly()) {
    const dur = Number(act.durationMin) || 60;
    const durTxt = dur >= 60
      ? `${Math.floor(dur / 60)}h${dur % 60 ? String(dur % 60).padStart(2, "0") : ""}`
      : `${dur} min`;
    if (act.name) title.textContent = `Jour ${dayIdx + 1} · ${act.name}`;
    body.innerHTML = `
      <div class="detail-meta">
        ${act.time ? `<div class="detail-meta-time">🕒 ${escapeHtml(act.time)} · ${durTxt}</div>` : ""}
        ${act.place ? `<div class="detail-meta-place">📍 ${escapeHtml(act.place)}</div>` : ""}
      </div>
      <div class="detail-map-wrap"><div id="dp-map" class="detail-map"></div></div>
      ${itineraryBtnHtml(act.latLng, act.name || act.place)}
      <div class="detail-weather" id="dp-weather"></div>
      ${act.description ? `<div class="detail-share-desc">${escapeHtml(act.description).replace(/\n/g, "<br>")}</div>` : ""}
    `;
    setTimeout(() => initDetailMap(act.latLng), 50);
    fillDetailWeather(dayIdx, act);
    showDetailPanel();
    return;
  }
  const swatches = ACTIVITY_COLORS.map((c) => {
    const selected = (act.color || "") === c.value ? " selected" : "";
    const isDefault = c.value === "";
    const styleAttr = isDefault ? "" : ` style="background:${c.value}"`;
    const cls = isDefault ? "color-swatch color-default" : "color-swatch";
    return `<button type="button" class="${cls}${selected}" data-color="${c.value}" title="${c.name}" aria-label="${c.name}"${styleAttr}></button>`;
  }).join("");
  body.innerHTML = `
    <div class="detail-label">
      <div class="detail-label-row"><span>Nom</span>${surpriseToggleHtml("dp-name-vis", act.nameVisible)}</div>
      <input type="text" id="dp-name" placeholder="Activité" value="${escapeAttr(act.name || "")}">
    </div>
    <label class="detail-label detail-alt" id="dp-share-name-wrap" ${act.nameVisible ? "hidden" : ""}>Nom vu par les surpris
      <input type="text" id="dp-share-name" placeholder="Indice, surprise…" value="${escapeAttr(act.shareName || "")}">
    </label>
    <label class="detail-label">Durée (minutes)
      <input type="number" id="dp-duration" min="15" step="15" value="${Number(act.durationMin) || 60}">
    </label>
    <label class="detail-label">Couleur
      <div class="color-palette" id="dp-colors">${swatches}</div>
    </label>
    <div class="detail-label">
      <div class="detail-label-row"><span>Lieu</span>${surpriseToggleHtml("dp-place-vis", act.placeVisible, PLACE_TOGGLE_LABEL, PLACE_TOGGLE_TITLE)}</div>
      <input type="text" id="dp-place" placeholder="Adresse, ville…" value="${escapeAttr(act.place || "")}">
      <div class="geocode-status" id="dp-geo">${act.latLng ? '<span class="geocode-ok">✓ Localisé</span>' : ""}</div>
    </div>
    <div class="detail-map-wrap"><div id="dp-map" class="detail-map"></div></div>
    ${itineraryBtnHtml(act.latLng, act.name || act.place)}
    <div class="detail-label">Météo prévue
      <div class="detail-weather" id="dp-weather"></div>
    </div>
    <div class="detail-label">
      <div class="detail-label-row"><span>Description</span>${surpriseToggleHtml("dp-desc-vis", act.descVisible)}</div>
      <textarea id="dp-desc" placeholder="Notes, lien…">${escapeHtml(act.description || "")}</textarea>
    </div>
    <label class="detail-label detail-alt" id="dp-share-desc-wrap" ${act.descVisible ? "hidden" : ""}>Description vue par les surpris
      <textarea id="dp-share-desc" placeholder="Indice, énigme, ambiance…">${escapeHtml(act.shareDescription || "")}</textarea>
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
      if (a) fillDetailWeather(dayIdx, a);
    });
  });
  document.getElementById("dp-desc").addEventListener("input", (e) => {
    updateActivity(dayIdx, actId, "description", e.target.value);
  });
  document.getElementById("dp-share-name").addEventListener("input", (e) => {
    updateActivity(dayIdx, actId, "shareName", e.target.value);
  });
  document.getElementById("dp-share-desc").addEventListener("input", (e) => {
    updateActivity(dayIdx, actId, "shareDescription", e.target.value);
  });
  bindSurpriseToggle("dp-name-vis", "dp-share-name-wrap", (on) => updateActivity(dayIdx, actId, "nameVisible", on));
  bindSurpriseToggle("dp-desc-vis", "dp-share-desc-wrap", (on) => updateActivity(dayIdx, actId, "descVisible", on));
  bindSurpriseToggle("dp-place-vis", null, (on) => updateActivity(dayIdx, actId, "placeVisible", on));
  setTimeout(() => initDetailMap(act.latLng), 50);
  fillDetailWeather(dayIdx, act);
  showDetailPanel();
}

// Fills #dp-weather for one activity. Bails out if the panel moved on to
// another activity while the request was in flight.
async function fillDetailWeather(dayIdx, act) {
  const el = document.getElementById("dp-weather");
  if (!el) return;
  const trip = computeTripDates();
  const date = trip && trip.dates[dayIdx];
  if (!date) {
    el.innerHTML = '<span class="detail-weather-empty">Renseigne tes vols pour dater le voyage.</span>';
    return;
  }
  if (!act.latLng) {
    el.innerHTML = '<span class="detail-weather-empty">Renseigne un lieu pour voir la météo.</span>';
    return;
  }
  el.innerHTML = '<span class="detail-weather-empty">⌛ Météo…</span>';

  const fc = await getForecast(act.latLng);
  if (!currentDetail || currentDetail.type !== "act" || currentDetail.id !== act.id) return;
  const box = document.getElementById("dp-weather");
  if (!box) return;
  if (!fc) {
    box.innerHTML = '<span class="detail-weather-empty">Météo indisponible pour le moment.</span>';
    return;
  }

  const w = readForecast(fc, date, act.time);
  if (!w || w.outOfRange) {
    box.innerHTML = `<span class="detail-weather-empty">Prévision indisponible au-delà de ${WEATHER_MAX_DAYS} jours.</span>`;
    return;
  }
  const temp = w.daily
    ? `${Math.round(w.tmin)}° / ${Math.round(w.tmax)}°`
    : formatTemp(w.temp);
  const when = w.daily
    ? '<span class="detail-weather-when">sur la journée</span>'
    : `<span class="detail-weather-when">à ${escapeHtml(w.hour)}</span>`;
  const precip = w.precip == null || isNaN(w.precip)
    ? ""
    : `<div class="detail-weather-precip">Risque de précipitations ${Math.round(w.precip)} %</div>`;
  box.innerHTML = `
    <div class="detail-weather-card">
      <span class="detail-weather-icon">${w.icon}</span>
      <div>
        <div class="detail-weather-temp">${temp} ${when}</div>
        <div class="detail-weather-label">${escapeHtml(w.label)}</div>
        ${precip}
      </div>
    </div>`;
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
  addBaseLayer(detailMap, false);
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

// "Visible par les surpris": ticked, the surprise roles and visitor links
// see the real value; unticked, a field below takes the one meant for them.
function surpriseToggleHtml(id, checked, label = "🎁 Visible par les surpris",
  title = "Cochée : les surpris voient ce champ tel quel. Décochée : tu leur donnes une autre version.") {
  return `<label class="surprise-toggle" title="${title}">
    <input type="checkbox" id="${id}" ${checked ? "checked" : ""}> ${label}</label>`;
}

const PLACE_TOGGLE_LABEL = "📍 Adresse visible par les surpris";
const PLACE_TOGGLE_TITLE = "Cochée : les surpris voient l'adresse exacte et l'itinéraire. Décochée : lieu flouté à ±2 km.";

function bindSurpriseToggle(checkboxId, altWrapId, onChange) {
  const cb = document.getElementById(checkboxId);
  if (!cb) return;
  cb.addEventListener("change", () => {
    const wrap = document.getElementById(altWrapId);
    if (wrap) wrap.hidden = cb.checked;
    onChange(cb.checked);
  });
}

function openNightDetail(dayIdx, ev) {
  if (ev) ev.stopPropagation();
  const day = state.days[dayIdx];
  if (!day) return;
  currentDetail = { type: "night", day: dayIdx };
  const body = document.getElementById("detail-body");
  const title = document.getElementById("detail-title");
  title.textContent = `Jour ${dayIdx + 1} · Hébergement`;
  if (isSurpriseView()) {
    if (day.nightLocation) title.textContent = `Jour ${dayIdx + 1} · ${day.nightLocation}`;
    body.innerHTML = `
      <div class="detail-map-wrap"><div id="dp-map" class="detail-map"></div></div>
      ${nightPlaceShown(day) ? itineraryBtnHtml(day.nightLatLng, day.nightLocation) : ""}
      <div class="detail-share-desc">
        ${day.nightShareDescription
          ? escapeHtml(day.nightShareDescription).replace(/\n/g, "<br>")
          : '<span class="detail-empty">Aucune description partagée.</span>'}
      </div>
    `;
    setTimeout(() => initDetailMap(day.nightLatLng), 50);
    showDetailPanel();
    return;
  }
  if (isReadOnly()) {
    if (day.nightLocation) title.textContent = `Jour ${dayIdx + 1} · ${day.nightLocation}`;
    body.innerHTML = `
      <div class="detail-meta">
        <div class="detail-meta-place">🛏 ${escapeHtml(day.nightLocation || "Hébergement non renseigné")}</div>
      </div>
      <div class="detail-map-wrap"><div id="dp-map" class="detail-map"></div></div>
      ${itineraryBtnHtml(day.nightLatLng, day.nightLocation)}
      ${day.nightDescription ? `<div class="detail-share-desc">${escapeHtml(day.nightDescription).replace(/\n/g, "<br>")}</div>` : ""}
    `;
    setTimeout(() => initDetailMap(day.nightLatLng), 50);
    showDetailPanel();
    return;
  }
  body.innerHTML = `
    <div class="detail-label">
      <div class="detail-label-row"><span>Hôtel, Airbnb…</span>${surpriseToggleHtml("dp-night-name-vis", day.nightNameVisible)}</div>
      <input type="text" id="dp-night-place" value="${escapeAttr(day.nightLocation || "")}">
      <div class="geocode-status" id="dp-night-geo">${day.nightLatLng ? '<span class="geocode-ok">✓ Localisé</span>' : ""}</div>
      <div class="detail-label-row detail-place-row">${surpriseToggleHtml("dp-night-place-vis", day.nightPlaceVisible, PLACE_TOGGLE_LABEL, PLACE_TOGGLE_TITLE)}</div>
    </div>
    <label class="detail-label detail-alt" id="dp-night-share-name-wrap" ${day.nightNameVisible ? "hidden" : ""}>Nom vu par les surpris
      <input type="text" id="dp-night-share-name" placeholder="Hébergement" value="${escapeAttr(day.nightShareName || "")}">
    </label>
    <div class="detail-map-wrap"><div id="dp-map" class="detail-map"></div></div>
    <div class="detail-label">
      <div class="detail-label-row"><span>Notes / lien booking</span>${surpriseToggleHtml("dp-night-desc-vis", day.nightDescVisible)}</div>
      <textarea id="dp-night-desc">${escapeHtml(day.nightDescription || "")}</textarea>
    </div>
    <label class="detail-label detail-alt" id="dp-night-share-desc-wrap" ${day.nightDescVisible ? "hidden" : ""}>Description vue par les surpris
      <textarea id="dp-night-share-desc" placeholder="Indice, ambiance…">${escapeHtml(day.nightShareDescription || "")}</textarea>
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
  document.getElementById("dp-night-share-desc").addEventListener("input", (e) => {
    updateDayField(dayIdx, "nightShareDescription", e.target.value);
  });
  document.getElementById("dp-night-share-name").addEventListener("input", (e) => {
    updateDayField(dayIdx, "nightShareName", e.target.value);
  });
  bindSurpriseToggle("dp-night-name-vis", "dp-night-share-name-wrap", (on) => updateDayField(dayIdx, "nightNameVisible", on));
  bindSurpriseToggle("dp-night-desc-vis", "dp-night-share-desc-wrap", (on) => updateDayField(dayIdx, "nightDescVisible", on));
  bindSurpriseToggle("dp-night-place-vis", null, (on) => updateDayField(dayIdx, "nightPlaceVisible", on));
  showDetailPanel();
}

function showDetailPanel() {
  const panel = document.getElementById("detail-panel");
  window.scrollTo({ top: 0, behavior: "smooth" });
  const header = document.querySelector(".app-header");
  const headerH = header ? Math.ceil(header.getBoundingClientRect().height) : 80;
  panel.style.top = headerH + 8 + "px";
  panel.style.bottom = "0px";
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
  if (isReadOnly()) return;
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
  if (isReadOnly()) return;
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

function minToClock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

// Time zone of the destination, for sunrise / sunset in local time.
function tripTimeZone() {
  const f = state.flights || [];
  return (f[0] && f[0].arriveTz) || (f[1] && f[1].departTz) || undefined;
}

// Where day i is spent: its night, else the previous one, else its first
// located activity, else the arrival airport.
function dayLocation(i) {
  const day = state.days[i];
  if (day && day.nightLatLng) return day.nightLatLng;
  const prev = state.days[i - 1];
  if (prev && prev.nightLatLng) return prev.nightLatLng;
  const act = day && day.activities.find((a) => a.latLng);
  if (act) return act.latLng;
  return getDestAirportLatLng();
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
  if (!showsRealPlaces()) return; // blurred places: the times would mislead
  const myToken = ++fillTravelToken;
  const destLL = getDestAirportLatLng();
  const HOUR_PX = getCalVZoom();
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
        if (info && el.classList.contains("cal-night-travel")) {
          el.textContent = "🚗 " + info.text;
          el.hidden = false;
        } else if (info) {
          const h = Math.max(16, info.min * pxPerMin);
          const top = Number(el.dataset.activityTop) || 0;
          el.style.top = Math.max(0, top - h) + "px";
          el.style.height = h + "px";
          el.style.display = "";
          const t = el.querySelector(".travel-text");
          if (t) t.textContent = info.text;
        }
      } else if (el && !el.classList.contains("cal-night-travel")) {
        el.style.display = "none";
      }
      prev = wp.ll;
    }
  }
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
