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
  if (role !== "admin") {
    const r = CLOUD_ROLES[role];
    btn.textContent = r.icon + " " + r.label;
    btn.title = role === "voyageur"
      ? "Tu vois tout le voyage ; seuls les admins peuvent le modifier"
      : "Tu vois la version surprise du voyage ; lieux approximatifs";
    btn.className = "btn btn-ghost btn-sm header-trip-only mode-btn mode-locked";
  } else if (editMode) {
    btn.textContent = "✓ Terminer";
    btn.title = "Revenir en lecture";
    btn.className = "btn btn-gold btn-sm header-trip-only mode-btn";
  } else {
    btn.textContent = "✏️ Gérer";
    btn.title = "Passer en mode gestion pour modifier le voyage";
    btn.className = "btn btn-ghost btn-sm header-trip-only mode-btn";
  }
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
  const START_HOUR = 6;
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
