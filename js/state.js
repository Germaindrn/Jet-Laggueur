// Multi-trip persistence, undo, modal-based import/export.

let allTrips = loadAllTrips();
let currentTripId = loadCurrentTripId();
let state = getTripState(currentTripId);

function defaultFlight() {
  return {
    id: Date.now(),
    fromCode: "",
    toCode: "",
    departDate: "",
    departTime: "",
    departTz: "Europe/Paris",
    arriveDate: "",
    arriveTime: "",
    arriveTz: "Europe/Paris",
    flightNum: "",
  };
}

function ensureFlights() {
  if (!state.flights || state.flights.length < 2) {
    state.flights = [
      state.flights?.[0] || defaultFlight(),
      state.flights?.[1] || { ...defaultFlight(), id: Date.now() + 1 },
    ];
  }
  // Keep only 2
  state.flights.length = 2;
}

function loadAllTrips() {
  try {
    const saved = localStorage.getItem("voyageplanner_trips");
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  try {
    const old = localStorage.getItem("voyageplanner_state");
    if (old) {
      const s = JSON.parse(old);
      const id = Date.now();
      const trips = [{ id, title: s.title || "Mon Voyage", state: s }];
      localStorage.setItem("voyageplanner_trips", JSON.stringify(trips));
      localStorage.setItem("voyageplanner_current", String(id));
      localStorage.removeItem("voyageplanner_state");
      return trips;
    }
  } catch (e) {}
  const id = Date.now();
  return [{ id, title: "Mon Voyage", state: { title: "Mon Voyage", numDays: 3, flights: [], days: [] } }];
}

function loadCurrentTripId() {
  const saved = localStorage.getItem("voyageplanner_current");
  if (saved && allTrips.find((t) => t.id === Number(saved))) return Number(saved);
  return allTrips[0].id;
}

function getTripState(id) {
  const trip = allTrips.find((t) => t.id === id);
  return trip ? trip.state : allTrips[0].state;
}

function saveAll() {
  const trip = allTrips.find((t) => t.id === currentTripId);
  if (trip) {
    trip.state = state;
    trip.title = state.title;
    trip.updatedAt = Date.now();
  }
  try {
    localStorage.setItem("voyageplanner_trips", JSON.stringify(allTrips));
    localStorage.setItem("voyageplanner_current", String(currentTripId));
  } catch (e) {}
}

const history = [];
const HISTORY_MAX = 50;
let lastSnapshot = null;
let suspendHistory = false;

function saveState() {
  if (!suspendHistory) {
    if (lastSnapshot !== null) {
      history.push(lastSnapshot);
      if (history.length > HISTORY_MAX) history.shift();
    }
    try { lastSnapshot = JSON.stringify(state); } catch (e) {}
  }
  saveAll();
}

function undo() {
  if (!history.length) return;
  const snap = history.pop();
  try {
    const restored = JSON.parse(snap);
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, restored);
    lastSnapshot = snap;
    suspendHistory = true;
    saveAll();
    suspendHistory = false;
    if (currentDetail) closeDetail();
    renderFlights();
    renderCalendar();
    updateMap();
  } catch (e) {}
}

function formatRelative(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return "il y a " + min + " min";
  const h = Math.floor(min / 60);
  if (h < 24) return "il y a " + h + " h";
  const d = Math.floor(h / 24);
  if (d < 7) return "il y a " + d + " j";
  return new Date(ts).toLocaleDateString("fr-FR");
}

function renderHome() {
  const list = document.getElementById("home-trip-list");
  if (!list) return;
  if (!allTrips.length) {
    list.innerHTML = '<p class="home-empty">Aucun voyage. Crée-en un ou importe-en pour commencer.</p>';
    return;
  }
  const sorted = [...allTrips].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  list.innerHTML = sorted.map((t) => {
    const days = (t.state && t.state.numDays) || 0;
    const updated = formatRelative(t.updatedAt);
    const isActive = t.id === currentTripId;
    return `<article class="trip-card ${isActive ? "active" : ""}" onclick="openTrip(${t.id})">
      <h3 class="trip-card-title">${escapeHtml(t.title || "Voyage")}</h3>
      <div class="trip-card-meta">
        <span>${days} jour${days > 1 ? "s" : ""}</span>
        ${updated ? `<span class="dot">·</span><span>${updated}</span>` : ""}
      </div>
      <div class="trip-card-actions" onclick="event.stopPropagation()">
        <button class="btn btn-gold btn-sm btn-open" onclick="openTrip(${t.id})">Ouvrir</button>
        <button class="trip-card-icon" title="Exporter" onclick="exportTripFromHome(${t.id})">↗</button>
        <button class="trip-card-icon" title="Partager (visiteur)" onclick="shareTripFromHome(${t.id})">👥</button>
        <button class="trip-card-icon danger" title="Supprimer" onclick="deleteTrip(${t.id})">✕</button>
      </div>
    </article>`;
  }).join("");
}

function openHome() {
  setView("home");
  renderHome();
}

function openTrip(id) {
  switchTrip(id);
}

function switchTrip(id) {
  currentTripId = Number(id);
  state = getTripState(currentTripId);
  localStorage.setItem("voyageplanner_current", String(currentTripId));
  focusedDay = null;
  setView("trip");
  restoreUI();
  if (typeof syncCheckRemote === "function") syncCheckRemote();
}

function exportTripFromHome(id) {
  switchTrip(id);
  openExport();
}

function shareTripFromHome(id) {
  switchTrip(id);
  openVisitorShare();
}

function createTrip() {
  const id = Date.now();
  const newState = { title: "Nouveau Voyage", numDays: 3, flights: [], days: [] };
  allTrips.push({ id, title: newState.title, state: newState, updatedAt: Date.now() });
  currentTripId = id;
  state = newState;
  ensureFlights();
  saveAll();
  setView("trip");
  restoreUI();
}

function deleteTrip(idArg) {
  const id = idArg !== undefined ? Number(idArg) : currentTripId;
  const trip = allTrips.find((t) => t.id === id);
  if (!trip) return;
  if (allTrips.length <= 1) { alert("Tu dois garder au moins un voyage."); return; }
  if (!confirm(`Supprimer le voyage « ${trip.title || "Voyage"} » ?`)) return;
  allTrips = allTrips.filter((t) => t.id !== id);
  if (currentTripId === id) {
    currentTripId = allTrips[0].id;
    state = getTripState(currentTripId);
  }
  saveAll();
  renderHome();
  if (currentView === "trip" && document.getElementById("trip-title-input")) {
    restoreUI();
  }
}

function openExport() {
  const data = JSON.stringify({ v: 1, trip: state }, null, 2);
  const filename = (state.title || "voyage").replace(/[^a-z0-9_-]/gi, "_") + ".json";
  document.getElementById("modal-title").textContent = "Exporter le voyage";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">Copie le code ci-dessous et colle-le sur Instagram, Discord, email… ou télécharge le fichier.</p>
    <textarea id="export-text" readonly>${escapeHtml(data)}</textarea>
    <div class="modal-actions">
      <button class="btn btn-gold btn-sm" onclick="copyExport()">📋 Copier</button>
      <button class="btn btn-gold btn-sm" onclick="downloadExport('${filename}')">💾 Télécharger</button>
      <button class="btn btn-gold btn-sm" onclick="shareExport()">📤 Partager</button>
    </div>
    <div id="export-status" class="modal-status"></div>
  `;
  showModal();
}

function copyExport() {
  const txt = document.getElementById("export-text").value;
  navigator.clipboard.writeText(txt).then(
    () => (document.getElementById("export-status").textContent = "✓ Copié dans le presse-papier"),
    () => {
      document.getElementById("export-text").select();
      document.execCommand("copy");
      document.getElementById("export-status").textContent = "✓ Copié";
    }
  );
}

function downloadExport(filename) {
  const txt = document.getElementById("export-text").value;
  const blob = new Blob([txt], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  document.getElementById("export-status").textContent = "✓ Fichier téléchargé";
}

async function shareExport() {
  const txt = document.getElementById("export-text").value;
  const title = state.title || "Mon voyage";
  if (navigator.share) {
    try {
      await navigator.share({ title: `Jet Laggueur · ${title}`, text: txt });
      document.getElementById("export-status").textContent = "✓ Partagé";
    } catch (e) {}
  } else {
    copyExport();
    document.getElementById("export-status").textContent = "✓ Copié — colle dans ton app";
  }
}

function openImport() {
  document.getElementById("modal-title").textContent = "Importer un voyage";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">Colle ici le code reçu, ou charge un fichier .json.</p>
    <textarea id="import-text" placeholder='{"v":1,"trip":…}'></textarea>
    <div class="modal-actions">
      <label class="btn btn-gold btn-sm" style="cursor:pointer;">
        📂 Charger un fichier
        <input type="file" accept=".json,application/json" style="display:none;" onchange="loadImportFile(this)">
      </label>
      <button class="btn btn-gold btn-sm" onclick="applyImport()">✓ Importer</button>
    </div>
    <div id="import-status" class="modal-status"></div>
  `;
  showModal();
}

function loadImportFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("import-text").value = e.target.result;
  };
  reader.readAsText(file);
}

function applyImport() {
  const txt = document.getElementById("import-text").value.trim();
  const status = document.getElementById("import-status");
  if (!txt) { status.textContent = "⚠ Colle d'abord le code"; return; }
  try {
    const parsed = JSON.parse(txt);
    const imported = parsed.trip || parsed.state || parsed;
    if (!imported || typeof imported !== "object") throw new Error("format");
    const id = Date.now();
    const title = imported.title || "Voyage importé";
    allTrips.push({ id, title, state: imported, updatedAt: Date.now() });
    saveAll();
    renderHome();
    closeModal();
  } catch (e) {
    status.textContent = "⚠ Code invalide";
  }
}

function showModal() {
  document.getElementById("modal-overlay").classList.add("open");
}

function closeModal(ev) {
  if (ev && ev.target.closest(".modal")) return;
  document.getElementById("modal-overlay").classList.remove("open");
}
