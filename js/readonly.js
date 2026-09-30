// Read / manage modes and what each role sees. Every trip opens read-only;
// admins switch to "Gérer" to edit. A trip that is not shared counts as
// admin; a shared one follows the role cloud.js reads from Firebase:
// admin and voyageur see the real trip, surpris a masked copy (shared names
// and notes, blurred places), like visitor links.
// Also here: the current-time line on the calendar and the itinerary button,
// both brought over from the Android app so it can ship the site as is.

let editMode = false;

function currentTrip() {
  return allTrips.find((t) => t.id === currentTripId);
}

function currentRole() {
  if (typeof isVisitorMode === "function" && isVisitorMode()) return "surpris";
  return typeof cloudRole === "function" ? cloudRole(currentTrip()) : "admin";
}

function isReadOnly() {
  if (typeof isVisitorMode === "function" && isVisitorMode()) return true;
  return !editMode;
}

function canManageTrip() {
  return currentRole() === "admin";
}

// True when names, notes and places must be the ones marked for surprises.
function isSurpriseView() {
  return currentRole() === "surpris";
}

// Points `state` at what this device may see of the open trip. The masked
// copy is never saved: saveAll() skips while it is shown.
function syncViewState() {
  if (typeof isVisitorMode === "function" && isVisitorMode()) return;
  const trip = currentTrip();
  if (!trip) return;
  state = isSurpriseView()
    ? buildSurpriseState(trip.state, (trip.cloud && trip.cloud.id) || String(trip.id))
    : trip.state;
}

function setEditMode(on) {
  on = !!on && canManageTrip();
  const changed = editMode !== on;
  editMode = on;
  applyModeUI();
  if (!changed || currentView !== "trip") return;
  if (currentDetail) closeDetail();
  renderFlights();
  renderCalendar();
  updateMap();
}

function toggleEditMode() {
  if (!canManageTrip()) {
    if (typeof openCloudShare === "function") openCloudShare(currentTripId);
    return;
  }
  setEditMode(!editMode);
}

function applyModeUI() {
  const ro = isReadOnly();
  document.body.classList.toggle("readonly", ro);
  document.body.classList.toggle("surprise-view", isSurpriseView());
  const title = document.getElementById("trip-title-input");
  if (title) title.readOnly = ro;
  const btn = document.getElementById("mode-btn");
  if (!btn) return;
  if (typeof isVisitorMode === "function" && isVisitorMode()) { btn.hidden = true; return; }
  btn.hidden = false;
  const role = currentRole();
  let icon, label;
  if (role !== "admin") {
    icon = role === "voyageur" ? "eye" : "gift";
    label = CLOUD_ROLES[role].label;
    btn.title = role === "voyageur"
      ? "Voyageur : tu vois tout le voyage ; seuls les admins peuvent le modifier"
      : "Surpris : tu vois la version surprise du voyage";
    btn.className = "btn btn-ghost btn-sm header-trip-only mode-btn mode-locked";
  } else if (editMode) {
    icon = "check";
    label = "Terminer";
    btn.title = "Revenir en lecture";
    btn.className = "btn btn-gold btn-sm header-trip-only mode-btn";
  } else {
    icon = "pencil";
    label = "Gérer";
    btn.title = "Passer en mode gestion pour modifier le voyage";
    btn.className = "btn btn-ghost btn-sm header-trip-only mode-btn";
  }
  btn.innerHTML = uiIcon(icon) + `<span class="btn-label">${label}</span>`;
  btn.setAttribute("aria-label", label);
}

// Sober line icons for the header (they inherit the text colour).
const UI_ICONS = {
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  pencil: '<path d="M4 20h4L19.5 8.5l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5.5 12v8h13v-8M12 8v12"/><path d="M12 8c-2-3.5-5.5-3.5-5.5-1.5S9 8 12 8zm0 0c2-3.5 5.5-3.5 5.5-1.5S15 8 12 8z"/>',
};

function uiIcon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${UI_ICONS[name]}</svg>`;
}

// ==================== SURPRISE: real places or blurred ====================

// True when every place on screen is exact (routes and travel times).
function showsRealPlaces() {
  return !isSurpriseView() || !!state.surpriseShowPlaces;
}

// Per place: exact (address and itinerary) or blurred for the surprise.
function placeShown(act) {
  return showsRealPlaces() || !!(act && act.placeVisible);
}

function nightPlaceShown(day) {
  return showsRealPlaces() || !!(day && day.nightPlaceVisible);
}

function surprisePlacesToggleHtml(tripId, rerender) {
  const trip = allTrips.find((t) => t.id === Number(tripId));
  if (!trip || !cloudIsAdmin(trip)) return "";
  return `<label class="surprise-places-toggle">
    <input type="checkbox" ${trip.state.surpriseShowPlaces ? "checked" : ""}
      onchange="setSurpriseShowPlaces(${trip.id}, this.checked);${rerender || ""}">
    Toutes les adresses visibles par les surpris (et l'itinéraire). Sinon, lieu par lieu avec la case 📍 de chaque fiche ; les autres restent floutés à ±2 km.
  </label>`;
}

function setSurpriseShowPlaces(tripId, on) {
  const trip = allTrips.find((t) => t.id === Number(tripId));
  if (!trip || !cloudIsAdmin(trip)) return;
  trip.state.surpriseShowPlaces = !!on;
  trip.updatedAt = Date.now();
  tripSigs.set(trip.id, tripSignature(trip.state));
  if (typeof cloudNoteLocalChange === "function") cloudNoteLocalChange(trip);
  try { localStorage.setItem("voyageplanner_trips", JSON.stringify(allTrips)); } catch (e) {}
}

// Called by cloud.js when an admin changes this device's role on a trip.
function onRoleChange(trip) {
  if (trip.id !== currentTripId) return;
  if (!cloudIsAdmin(trip)) editMode = false;
  if (currentDetail) closeDetail();
  const r = CLOUD_ROLES[cloudRole(trip)];
  showSyncToast(r.icon + " Ton rôle sur ce voyage : " + r.label);
  if (currentView === "trip") restoreUI();
  else applyModeUI();
}

// ==================== CURRENT-TIME LINE (calendar grid) ====================

function todayISO() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function renderNowLine() {
  document.querySelectorAll(".cal-now-line").forEach((el) => el.remove());
  document.querySelectorAll(".cal-day.day-today").forEach((el) => el.classList.remove("day-today"));
  const trip = computeTripDates();
  if (!trip) return;
  const idx = trip.dates.indexOf(todayISO());
  if (idx === -1) return;
  const dayEl = document.querySelectorAll("#calendar-grid .cal-day")[idx];
  if (!dayEl) return;
  dayEl.classList.add("day-today");
  const body = dayEl.querySelector(".cal-day-body");
  if (!body) return;
  const START_HOUR = 0;
  const now = new Date();
  const top = (now.getHours() - START_HOUR + now.getMinutes() / 60) * getCalVZoom();
  if (top < 0 || top > parseFloat(body.style.height || "0") + 4) return;
  const line = document.createElement("div");
  line.className = "cal-now-line";
  line.style.top = top + "px";
  line.dataset.time = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  body.appendChild(line);
}

setInterval(() => {
  if (currentView !== "trip") return;
  renderNowLine();
  if (typeof updateTimelineNow === "function") updateTimelineNow();
}, 60000);

// ==================== ITINERARY (Waze / Google Maps) ====================

function itineraryBtnHtml(latLng, name, cls) {
  if (!latLng || latLng.length !== 2) return "";
  return `<button type="button" class="${cls || "itinerary-btn"}"
    onclick="event.stopPropagation();openItinerary(${Number(latLng[0])},${Number(latLng[1])},'${escapeAttr(String(name || "").replace(/['\\\r\n]/g, " "))}')">🧭 Itinéraire</button>`;
}

function openItinerary(lat, lng, name) {
  const la = Number(lat).toFixed(6);
  const lo = Number(lng).toFixed(6);
  if (isAndroidApp()) {
    // The app turns geo: into the system chooser (Maps, Waze, OsmAnd…).
    window.location.href = `geo:${la},${lo}?q=${la},${lo}(${encodeURIComponent(name || "Destination")})`;
    return;
  }
  document.getElementById("modal-title").textContent = "Itinéraire";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">${escapeHtml(name || "Destination")}</p>
    <div class="itinerary-actions">
      <a class="btn btn-maps" target="_blank" rel="noopener"
        href="https://www.google.com/maps/dir/?api=1&destination=${la},${lo}">Google Maps</a>
      <a class="btn btn-waze" target="_blank" rel="noopener"
        href="https://waze.com/ul?ll=${la},${lo}&navigate=yes">Waze</a>
    </div>
  `;
  showModal();
}
