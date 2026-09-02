// Multi-device sync: backend = JSONBin or Pantry. Merge by updatedAt.
// No auto-push. On trip switch / app load, silently pulls newer versions of existing trips.
// Manual pull opens an import picker so the user chooses which remote trips to bring in.

const PANTRY_BASE = "https://getpantry.cloud/apiv1/pantry";
const JSONBIN_BASE = "https://api.jsonbin.io/v3/b";

function getSyncConfig() {
  try {
    const raw = localStorage.getItem("voyageplanner_pantry");
    if (raw) {
      const cfg = JSON.parse(raw);
      if (!cfg.backend) cfg.backend = cfg.pantryId ? "pantry" : "jsonbin";
      return cfg;
    }
  } catch (e) {}
  return {
    backend: "jsonbin",
    pantryId: "",
    basket: "voyages",
    binId: "",
    apiKey: "",
    sharedIds: null,
  };
}

function setSyncConfig(cfg) {
  localStorage.setItem("voyageplanner_pantry", JSON.stringify(cfg));
}

function openSync() {
  const cfg = getSyncConfig();
  document.getElementById("modal-title").textContent = "Synchroniser";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">
      Partage les mêmes identifiants avec ton ami pour synchroniser les voyages.
    </p>
    <label style="display:block;margin-top:8px;">Service</label>
    <select id="sync-backend" onchange="onSyncBackendChange()" style="width:100%;padding:8px;box-sizing:border-box;">
      <option value="jsonbin" ${cfg.backend === "jsonbin" ? "selected" : ""}>JSONBin.io</option>
      <option value="pantry" ${cfg.backend === "pantry" ? "selected" : ""}>Pantry</option>
    </select>
    <div id="sync-backend-fields">${renderSyncBackendFields(cfg)}</div>
    <div style="margin-top:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>Voyages à partager (envoi)</strong>
        <span style="font-size:11px;">
          <a href="#" onclick="toggleAllShared(true);return false;">Tout</a> ·
          <a href="#" onclick="toggleAllShared(false);return false;">Aucun</a>
        </span>
      </div>
      <div id="sync-trip-list" style="max-height:180px;overflow:auto;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px;margin-top:4px;">
        ${renderSyncTripList(cfg)}
      </div>
    </div>
    <div class="modal-actions" style="margin-top:12px;">
      <button class="btn btn-gold btn-sm" onclick="saveSyncConfig()">💾 Enregistrer</button>
      <button class="btn btn-gold btn-sm" onclick="syncPush()">⬆ Envoyer</button>
      <button class="btn btn-gold btn-sm" onclick="syncPullPicker()">⬇ Importer…</button>
    </div>
    <div id="sync-status" class="modal-status"></div>
    <p class="modal-hint" style="margin-top:10px;font-size:11px;opacity:.7;">
      Les versions plus récentes des voyages déjà présents sont récupérées automatiquement à l'ouverture.
      Les suppressions ne se propagent pas.
    </p>
  `;
  showModal();
}

function renderSyncBackendFields(cfg) {
  cfg = cfg || getSyncConfig();
  if (cfg.backend === "pantry") {
    return `
      <p class="modal-hint" style="margin-top:8px;font-size:11px;">
        Crée un pantry gratuit sur <a href="https://getpantry.cloud" target="_blank" rel="noopener">getpantry.cloud</a>.
        ⚠ Service souvent indisponible.
      </p>
      <label style="display:block;margin-top:8px;">Pantry ID</label>
      <input type="text" id="sync-pantry-id" value="${escapeHtml(cfg.pantryId || "")}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="width:100%;padding:8px;box-sizing:border-box;">
      <label style="display:block;margin-top:8px;">Nom du basket</label>
      <input type="text" id="sync-basket" value="${escapeHtml(cfg.basket || "voyages")}" style="width:100%;padding:8px;box-sizing:border-box;">
    `;
  }
  return `
    <p class="modal-hint" style="margin-top:8px;font-size:11px;">
      Compte gratuit sur <a href="https://jsonbin.io" target="_blank" rel="noopener">jsonbin.io</a>.
      Récupère la <em>Master Key</em> (menu « API Keys ») et l'ID du bin (dans son URL).
    </p>
    <label style="display:block;margin-top:8px;">Bin ID</label>
    <input type="text" id="sync-bin-id" value="${escapeHtml(cfg.binId || "")}" placeholder="65xxxxxxxxxxxxxxxxxxxxxx" style="width:100%;padding:8px;box-sizing:border-box;">
    <label style="display:block;margin-top:8px;">Master Key</label>
    <input type="password" id="sync-api-key" value="${escapeHtml(cfg.apiKey || "")}" placeholder="$2a$10$..." style="width:100%;padding:8px;box-sizing:border-box;">
  `;
}

function onSyncBackendChange() {
  const cfg = readSyncInputs();
  document.getElementById("sync-backend-fields").innerHTML = renderSyncBackendFields(cfg);
}

function renderSyncTripList(cfg) {
  if (!allTrips.length) return '<p style="font-size:12px;opacity:.7;">Aucun voyage.</p>';
  const shared = cfg.sharedIds;
  return allTrips.map((t) => {
    const checked = (shared === null || shared === undefined) ? true : shared.includes(t.id);
    return `<label style="display:flex;align-items:center;gap:8px;padding:4px;">
      <input type="checkbox" class="sync-trip-cb" data-id="${t.id}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(t.title || "Voyage")}</span>
    </label>`;
  }).join("");
}

function toggleAllShared(on) {
  document.querySelectorAll(".sync-trip-cb").forEach((cb) => { cb.checked = on; });
}

function getSelectedSharedIds() {
  const ids = [];
  document.querySelectorAll(".sync-trip-cb").forEach((cb) => {
    if (cb.checked) ids.push(Number(cb.dataset.id));
  });
  return ids;
}

function saveSyncConfig() {
  readSyncInputs();
  setSyncStatus("✓ Enregistré");
}

function setSyncStatus(msg) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = msg;
}

function readSyncInputs() {
  const cfg = getSyncConfig();
  const backendEl = document.getElementById("sync-backend");
  if (backendEl) cfg.backend = backendEl.value;
  const pId = document.getElementById("sync-pantry-id");
  if (pId) cfg.pantryId = pId.value.trim();
  const bk = document.getElementById("sync-basket");
  if (bk) cfg.basket = bk.value.trim() || "voyages";
  const bin = document.getElementById("sync-bin-id");
  if (bin) cfg.binId = bin.value.trim();
  const key = document.getElementById("sync-api-key");
  if (key) cfg.apiKey = key.value.trim();
  if (document.querySelector(".sync-trip-cb")) cfg.sharedIds = getSelectedSharedIds();
  setSyncConfig(cfg);
  return cfg;
}

function tripsToShare(cfg) {
  if (!cfg.sharedIds) return allTrips;
  return allTrips.filter((t) => cfg.sharedIds.includes(t.id));
}

function validateBackendCfg(cfg) {
  if (cfg.backend === "jsonbin") {
    if (!cfg.binId) return "⚠ Renseigne un Bin ID";
    if (!cfg.apiKey) return "⚠ Renseigne une Master Key";
  } else {
    if (!cfg.pantryId) return "⚠ Renseigne un Pantry ID";
  }
  return null;
}

async function backendPush(cfg, body) {
  if (cfg.backend === "jsonbin") {
    return fetch(`${JSONBIN_BASE}/${encodeURIComponent(cfg.binId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": cfg.apiKey },
      body: JSON.stringify(body),
    });
  }
  return fetch(`${PANTRY_BASE}/${encodeURIComponent(cfg.pantryId)}/basket/${encodeURIComponent(cfg.basket)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function backendFetchTrips(cfg) {
  if (cfg.backend === "jsonbin") {
    const r = await fetch(`${JSONBIN_BASE}/${encodeURIComponent(cfg.binId)}/latest`, {
      headers: { "X-Master-Key": cfg.apiKey },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    const rec = data.record || data;
    return Array.isArray(rec.trips) ? rec.trips : [];
  }
  const r = await fetch(`${PANTRY_BASE}/${encodeURIComponent(cfg.pantryId)}/basket/${encodeURIComponent(cfg.basket)}`);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const data = await r.json();
  return Array.isArray(data.trips) ? data.trips : [];
}

async function syncPush() {
  const cfg = readSyncInputs();
  const err = validateBackendCfg(cfg);
  if (err) { setSyncStatus(err); return; }
  setSyncStatus("⏳ Envoi…");
  try {
    const shared = tripsToShare(cfg);
    // Both backends hold a single document, so a blind write would delete the
    // trips the other device pushed. Start from what is online and overwrite
    // only the trips being sent.
    let remote = [];
    try { remote = await backendFetchTrips(cfg); } catch (e) { remote = []; }
    const remoteById = new Map(remote.map((t) => [t.id, t]));
    const overwritten = shared.filter((t) => {
      const ex = remoteById.get(t.id);
      return ex && (ex.updatedAt || 0) > (t.updatedAt || 0);
    }).length;
    const payload = replaceTrips(remote, shared);
    const r = await backendPush(cfg, { trips: payload, updatedAt: Date.now() });
    if (!r.ok) throw new Error("HTTP " + r.status);
    setSyncStatus(
      "✓ Envoyé (" + shared.length + " voyage" + (shared.length > 1 ? "s" : "") +
      ", " + payload.length + " en ligne)" +
      (overwritten ? " ⚠ " + overwritten + " version en ligne plus récente écrasée" : "")
    );
  } catch (e) {
    setSyncStatus("⚠ Erreur envoi : " + e.message);
  }
}

async function syncPullPicker() {
  const cfg = readSyncInputs();
  const err = validateBackendCfg(cfg);
  if (err) { setSyncStatus(err); return; }
  setSyncStatus("⏳ Lecture de la base…");
  let remote;
  try {
    remote = await backendFetchTrips(cfg);
  } catch (e) {
    setSyncStatus("⚠ Erreur lecture : " + e.message);
    return;
  }
  if (!remote.length) { setSyncStatus("Aucun voyage côté serveur."); return; }
  renderImportPicker(remote);
}

function sameTripContent(a, b) {
  try { return JSON.stringify(a.state) === JSON.stringify(b.state); } catch (e) { return false; }
}

function renderImportPicker(remote) {
  const localById = new Map(allTrips.map((t) => [t.id, t]));
  const items = remote.map((t) => {
    const local = localById.get(t.id);
    let badge, badgeColor, defaultChecked;
    if (!local) { badge = "nouveau"; badgeColor = "#3aa66a"; defaultChecked = true; }
    else if (sameTripContent(local, t)) { badge = "identique"; badgeColor = "#888"; defaultChecked = false; }
    else if ((t.updatedAt || 0) > (local.updatedAt || 0)) { badge = "mise à jour"; badgeColor = "#c98a2b"; defaultChecked = true; }
    else { badge = "copie locale plus récente"; badgeColor = "#7b5ea7"; defaultChecked = false; }
    return { trip: t, badge, badgeColor, defaultChecked };
  });
  document.getElementById("modal-title").textContent = "Importer des voyages";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">Coche les voyages à importer : un voyage coché <strong>remplace</strong> la copie locale, même si elle est plus récente.</p>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
      <strong>${remote.length} voyage(s) trouvé(s)</strong>
      <span style="font-size:11px;">
        <a href="#" onclick="toggleAllImport(true);return false;">Tout</a> ·
        <a href="#" onclick="toggleAllImport(false);return false;">Aucun</a>
      </span>
    </div>
    <div style="max-height:240px;overflow:auto;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px;margin-top:4px;">
      ${items.map((it, i) => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:1px solid rgba(255,255,255,0.05);">
          <input type="checkbox" class="import-trip-cb" data-idx="${i}" ${it.defaultChecked ? "checked" : ""}>
          <span style="flex:1;">${escapeHtml(it.trip.title || "Voyage")}</span>
          <span style="font-size:10px;padding:2px 6px;border-radius:8px;background:${it.badgeColor};color:#fff;">${it.badge}</span>
        </label>
      `).join("")}
    </div>
    <div class="modal-actions" style="margin-top:12px;">
      <button class="btn btn-gold btn-sm" onclick="confirmImport()">⬇ Importer la sélection</button>
      <button class="btn btn-ghost btn-sm" onclick="openSync()">Annuler</button>
    </div>
    <div id="sync-status" class="modal-status"></div>
  `;
  window._syncImportItems = items;
}

function toggleAllImport(on) {
  document.querySelectorAll(".import-trip-cb").forEach((cb) => { cb.checked = on; });
}

function confirmImport() {
  const items = window._syncImportItems || [];
  const picked = [];
  document.querySelectorAll(".import-trip-cb").forEach((cb) => {
    if (cb.checked) picked.push(items[Number(cb.dataset.idx)].trip);
  });
  if (!picked.length) { setSyncStatus("Aucune sélection."); return; }
  const knownIds = new Set(allTrips.map((t) => t.id));
  const replaced = picked.filter((t) => knownIds.has(t.id)).length;
  // Ticking a trip is an explicit choice, so it always wins. Going through
  // mergeTrips() here dropped the import whenever the local copy carried a
  // newer updatedAt, which is what forced the "delete then re-sync" detour.
  allTrips = replaceTrips(allTrips, picked);
  if (!allTrips.find((t) => t.id === currentTripId)) {
    currentTripId = allTrips[0].id;
  }
  state = getTripState(currentTripId);
  ensureFlights();
  seedTripSignatures(); // after ensureFlights, so the seed matches what is in memory
  localStorage.setItem("voyageplanner_trips", JSON.stringify(allTrips));
  localStorage.setItem("voyageplanner_current", String(currentTripId));
  renderHome();
  if (currentView === "trip") restoreUI();
  window._syncImportItems = null;
  const added = picked.length - replaced;
  const parts = [];
  if (replaced) parts.push(replaced + " remplacé" + (replaced > 1 ? "s" : ""));
  if (added) parts.push(added + " ajouté" + (added > 1 ? "s" : ""));
  setSyncStatus("✓ Importé : " + parts.join(", "));
}

// Incoming wins unconditionally — for explicit user choices.
function replaceTrips(local, incoming) {
  const byId = new Map(local.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  return Array.from(byId.values());
}

// Newest wins — for the silent background refresh.
function mergeTrips(local, remote) {
  const byId = new Map();
  for (const t of local) byId.set(t.id, t);
  for (const t of remote) {
    const ex = byId.get(t.id);
    if (!ex || (t.updatedAt || 0) > (ex.updatedAt || 0)) {
      byId.set(t.id, t);
    }
  }
  return Array.from(byId.values());
}

// Background check on trip open: silently refresh existing trips if remote is newer.
// Throttled to avoid hammering the API on rapid switches.
let _syncCheckLastAt = 0;
let _syncCheckInFlight = false;
async function syncCheckRemote() {
  const cfg = getSyncConfig();
  if (validateBackendCfg(cfg)) return;
  if (_syncCheckInFlight) return;
  if (Date.now() - _syncCheckLastAt < 15000) return;
  _syncCheckInFlight = true;
  try {
    const remote = await backendFetchTrips(cfg);
    _syncCheckLastAt = Date.now();
    const localById = new Map(allTrips.map((t) => [t.id, t]));
    const updates = remote.filter((t) => {
      const ex = localById.get(t.id);
      return ex && (t.updatedAt || 0) > (ex.updatedAt || 0);
    });
    if (!updates.length) return;
    allTrips = mergeTrips(allTrips, updates);
    state = getTripState(currentTripId);
    ensureFlights();
    seedTripSignatures(); // after ensureFlights, so the seed matches what is in memory
    localStorage.setItem("voyageplanner_trips", JSON.stringify(allTrips));
    renderHome();
    if (currentView === "trip") restoreUI();
    showSyncToast("☁ " + updates.length + " voyage" + (updates.length > 1 ? "s" : "") + " mis à jour");
  } catch (e) {
    // silent
  } finally {
    _syncCheckInFlight = false;
  }
}

function showSyncToast(msg) {
  let el = document.getElementById("sync-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "sync-toast";
    el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,0.92);color:#fff;padding:10px 18px;border-radius:6px;font-size:13px;z-index:10000;transition:opacity 0.3s;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.3);";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = "0"; }, 3500);
}
