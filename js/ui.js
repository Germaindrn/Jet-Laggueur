// Global UI: tabs, island toggle, restoreUI orchestration, resize handler.

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

function restoreUI() {
  initThemes();
  adjustHeaderSpacing();
  const show = getShowTravel();
  document.body.classList.toggle("hide-travel", !show);
  const tt = document.getElementById("toggle-travel");
  if (tt) tt.checked = show;
  const showAct = getShowActivities();
  document.body.classList.toggle("hide-activities", !showAct);
  const ta = document.getElementById("toggle-activities");
  if (ta) ta.checked = showAct;
  const showNight = getShowNights();
  document.body.classList.toggle("hide-nights", !showNight);
  const tn = document.getElementById("toggle-nights");
  if (tn) tn.checked = showNight;
  const zr = document.getElementById("cal-zoom-range");
  if (zr) zr.value = String(getCalZoom());
  const vzr = document.getElementById("cal-vzoom-range");
  if (vzr) vzr.value = String(getCalVZoom());
  try { lastSnapshot = JSON.stringify(state); } catch (e) {}
  ensureFlights();
  renderTripSelector();
  document.getElementById("trip-title-input").value = state.title;
  document.title = state.title + " — Jet Laggueur";
  renderFlights();
  renderCalendar();
  setTimeout(() => map.invalidateSize(), 100);
  updateMap();
}
