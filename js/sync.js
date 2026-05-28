// Pantry-backed multi-device sync: push/pull/merge by updatedAt, auto-push (debounced).

const PANTRY_BASE = "https://getpantry.cloud/apiv1/pantry";

function getSyncConfig() {
  try {
    const raw = localStorage.getItem("voyageplanner_pantry");
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { pantryId: "", basket: "voyages", auto: false, sharedIds: null };
}

function setSyncConfig(cfg) {
  localStorage.setItem("voyageplanner_pantry", JSON.stringify(cfg));
}

function openSync() {
  const cfg = getSyncConfig();
  document.getElementById("modal-title").textContent = "Synchroniser (Pantry)";
  document.getElementById("modal-body").innerHTML = `
    <p class="modal-hint">
      Partage le même <strong>Pantry ID</strong> avec ton ami pour synchroniser les voyages.
      Crée un pantry gratuit sur <a href="https://getpantry.cloud" target="_blank" rel="noopener">getpantry.cloud</a>.
    </p>
    <label style="display:block;margin-top:8px;">Pantry ID</label>
    <input type="text" id="sync-pantry-id" value="${escapeHtml(cfg.pantryId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="width:100%;padding:8px;box-sizing:border-box;">
    <label style="display:block;margin-top:8px;">Nom du basket</label>
    <input type="text" id="sync-basket" value="${escapeHtml(cfg.basket || "voyages")}" style="width:100%;padding:8px;box-sizing:border-box;">
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
      <input type="checkbox" id="sync-auto" ${cfg.auto ? "checked" : ""}>
      <span>Push automatique après chaque modification (avec délai)</span>
    </label>
    <div style="margin-top:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>Voyages à partager</strong>
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
      <button class="btn btn-gold btn-sm" onclick="syncPull()">⬇ Récupérer & fusionner</button>
    </div>
    <div id="sync-status" class="modal-status"></div>
    <p class="modal-hint" style="margin-top:10px;font-size:11px;opacity:.7;">
      La fusion garde la version la plus récente de chaque voyage (par <code>updatedAt</code>).
      Les suppressions ne se propagent pas — supprime manuellement sur chaque appareil.
    </p>
  `;
  showModal();
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
  const cfg = {
    pantryId: document.getElementById("sync-pantry-id").value.trim(),
    basket: document.getElementById("sync-basket").value.trim() || "voyages",
    auto: document.getElementById("sync-auto").checked,
    sharedIds: getSelectedSharedIds(),
  };
  setSyncConfig(cfg);
  setSyncStatus("✓ Enregistré");
}

function setSyncStatus(msg) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = msg;
}

function readSyncInputs() {
  const idEl = document.getElementById("sync-pantry-id");
  const bEl = document.getElementById("sync-basket");
  const cfg = getSyncConfig();
  if (idEl) cfg.pantryId = idEl.value.trim();
  if (bEl) cfg.basket = bEl.value.trim() || "voyages";
  if (document.getElementById("sync-auto")) cfg.auto = document.getElementById("sync-auto").checked;
  if (document.querySelector(".sync-trip-cb")) cfg.sharedIds = getSelectedSharedIds();
  setSyncConfig(cfg);
  return cfg;
}

function tripsToShare(cfg) {
  if (!cfg.sharedIds) return allTrips;
  return allTrips.filter((t) => cfg.sharedIds.includes(t.id));
}

async function syncPush() {
  const cfg = readSyncInputs();
  if (!cfg.pantryId) { setSyncStatus("⚠ Renseigne un Pantry ID"); return; }
  setSyncStatus("⏳ Envoi…");
  try {
    const shared = tripsToShare(cfg);
    const body = { trips: shared, updatedAt: Date.now() };
    const r = await fetch(`${PANTRY_BASE}/${encodeURIComponent(cfg.pantryId)}/basket/${encodeURIComponent(cfg.basket)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    setSyncStatus("✓ Envoyé (" + shared.length + " voyages)");
  } catch (e) {
    setSyncStatus("⚠ Erreur envoi : " + e.message);
  }
}

async function syncPull() {
  const cfg = readSyncInputs();
  if (!cfg.pantryId) { setSyncStatus("⚠ Renseigne un Pantry ID"); return; }
  setSyncStatus("⏳ Récupération…");
  try {
    const r = await fetch(`${PANTRY_BASE}/${encodeURIComponent(cfg.pantryId)}/basket/${encodeURIComponent(cfg.basket)}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    const remote = Array.isArray(data.trips) ? data.trips : [];
    const merged = mergeTrips(allTrips, remote);
    allTrips = merged;
    if (!allTrips.find((t) => t.id === currentTripId)) {
      currentTripId = allTrips[0].id;
    }
    state = getTripState(currentTripId);
    ensureFlights();
    localStorage.setItem("voyageplanner_trips", JSON.stringify(allTrips));
    localStorage.setItem("voyageplanner_current", String(currentTripId));
    renderTripSelector();
    restoreUI();
    setSyncStatus("✓ Fusionné (" + allTrips.length + " voyages au total)");
  } catch (e) {
    setSyncStatus("⚠ Erreur récup : " + e.message);
  }
}

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

let autoSyncTimer = null;
function maybeAutoSync() {
  const cfg = getSyncConfig();
  if (!cfg.auto || !cfg.pantryId) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    const shared = tripsToShare(cfg);
    fetch(`${PANTRY_BASE}/${encodeURIComponent(cfg.pantryId)}/basket/${encodeURIComponent(cfg.basket)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trips: shared, updatedAt: Date.now() }),
    }).catch(() => {});
  }, 3000);
}
