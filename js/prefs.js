// User preferences: visibility toggles, themes, calendar zoom (H + V), color palette.

function getShowTravel() {
  try { return localStorage.getItem("voyageplanner_showtravel") !== "0"; } catch (e) { return true; }
}

function toggleTravel(show) {
  try { localStorage.setItem("voyageplanner_showtravel", show ? "1" : "0"); } catch (e) {}
  document.body.classList.toggle("hide-travel", !show);
}

function getShowActivities() {
  try { return localStorage.getItem("voyageplanner_showactivities") !== "0"; } catch (e) { return true; }
}

function toggleActivities(show) {
  try { localStorage.setItem("voyageplanner_showactivities", show ? "1" : "0"); } catch (e) {}
  document.body.classList.toggle("hide-activities", !show);
  if (typeof updateMap === "function") updateMap();
}

function getShowNights() {
  try { return localStorage.getItem("voyageplanner_shownights") !== "0"; } catch (e) { return true; }
}

function toggleNights(show) {
  try { localStorage.setItem("voyageplanner_shownights", show ? "1" : "0"); } catch (e) {}
  document.body.classList.toggle("hide-nights", !show);
  if (typeof updateMap === "function") updateMap();
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

const CAL_VZOOM_MIN = 20;
const CAL_VZOOM_MAX = 140;
const CAL_VZOOM_DEFAULT = 60;
const CAL_VZOOM_STEP = 10;
const CAL_HOURS_RANGE = 18;

function getCalVZoom() {
  try {
    const v = Number(localStorage.getItem("voyageplanner_calvzoom"));
    if (v >= CAL_VZOOM_MIN && v <= CAL_VZOOM_MAX) return v;
  } catch (e) {}
  return CAL_VZOOM_DEFAULT;
}

function setCalVZoom(v) {
  const clamped = Math.max(CAL_VZOOM_MIN, Math.min(CAL_VZOOM_MAX, Math.round(v)));
  try { localStorage.setItem("voyageplanner_calvzoom", String(clamped)); } catch (e) {}
  const range = document.getElementById("cal-vzoom-range");
  if (range && Number(range.value) !== clamped) range.value = String(clamped);
  renderCalendar();
}

function changeCalVZoom(dir) {
  setCalVZoom(getCalVZoom() + dir * CAL_VZOOM_STEP);
}

function fitCalVZoom() {
  const wrapper = document.querySelector(".calendar-wrapper");
  if (!wrapper) return;
  const wrapperRect = wrapper.getBoundingClientRect();
  const available = window.innerHeight - wrapperRect.top - 80;
  const dayHead = 62;
  const per = Math.floor((available - dayHead) / CAL_HOURS_RANGE);
  setCalVZoom(per);
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
