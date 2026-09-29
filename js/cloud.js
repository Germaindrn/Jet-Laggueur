// Live sync through Firebase Realtime Database, next to the manual JSONBin /
// Pantry sync of sync.js. A shared trip lives under /trips/<id>/state and every
// open device gets each change pushed to it; the link carries the database
// host and the trip id, so whoever opens it needs no setup.
//
// Merge is three-way at the leaf level (base = last server state this device
// saw), so two people editing different fields or activities never clobber
// each other; on the very same field the local edit wins. Activities are keyed
// by id rather than array index, so moving one to another day only rewrites
// its _d / _o leaves.

const FIREBASE_SDK_BASE = "https://www.gstatic.com/firebasejs/12.19.0/";
const CLOUD_CFG_KEY = "voyageplanner_firebase";
const CLOUD_BASE_KEY = "voyageplanner_cloud_base";
const CLOUD_PUSH_DELAY = 600;
const CLOUD_TIMEOUT = 15000;
const CLOUD_KEY_BAD = /[.#$\[\]\/]/;

// ---------- Config ----------

function getCloudConfig() {
  try { return JSON.parse(localStorage.getItem(CLOUD_CFG_KEY)) || {}; } catch (e) { return {}; }
}

function setCloudConfig(cfg) {
  try { localStorage.setItem(CLOUD_CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
}

// "https://x-default-rtdb.europe-west1.firebasedatabase.app/" → host, "" if
// empty, null if it is not a Realtime Database URL.
function normalizeDbHost(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  const m = s.match(/^(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:firebaseio\.com|firebasedatabase\.app))\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

function cloudSaveDbInput(value) {
  const host = normalizeDbHost(value);
  if (host === null) return false;
  const cfg = getCloudConfig();
  cfg.db = host;
  setCloudConfig(cfg);
  return true;
}

// ---------- Device identity ----------
// Roles are per device: /trips/<id>/devices/<deviceId> is written on every
// connection, /trips/<id>/roles/<deviceId> gives its role (none = "surpris").
// Enforced by the interface only, not by the database rules.

const CLOUD_DEVICE_KEY = "voyageplanner_device";

function cloudDevice() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(CLOUD_DEVICE_KEY)); } catch (e) {}
  if (!d || !d.id) {
    d = { id: cloudNewId(), name: "" };
    try { localStorage.setItem(CLOUD_DEVICE_KEY, JSON.stringify(d)); } catch (e) {}
  }
  return d;
}

function cloudGuessDeviceName() {
  const ua = navigator.userAgent || "";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone"
    : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Appareil";
  return os + (isAndroidApp() ? " (app)" : " (navigateur)");
}

function cloudDeviceName() {
  return cloudDevice().name || cloudGuessDeviceName();
}

function cloudSetDeviceName(name) {
  const d = cloudDevice();
  d.name = String(name || "").trim().slice(0, 40) || cloudGuessDeviceName();
  try { localStorage.setItem(CLOUD_DEVICE_KEY, JSON.stringify(d)); } catch (e) {}
  for (const e of cloudEntries.values()) cloudRegisterDevice(e);
}

// Asked once, the first time this device shares or joins a trip.
function cloudEnsureDeviceName() {
  const d = cloudDevice();
  if (d.name) return;
  const name = prompt("Nom de cet appareil (visible par les autres membres du voyage) :", cloudGuessDeviceName());
  cloudSetDeviceName(name);
}

function cloudDeviceRecord() {
  return { name: cloudDeviceName(), platform: isAndroidApp() ? "app" : "web", lastSeen: Date.now() };
}

// admin: sees everything, can switch to "Gérer" and hand out roles.
// voyageur: sees everything as it really is, read-only.
// surpris: sees what is marked for them (shared names, notes, blurred places).
const CLOUD_ROLES = {
  admin: { label: "Admin", icon: "✏️" },
  voyageur: { label: "Voyageur", icon: "👁" },
  surpris: { label: "Surpris", icon: "🎁" },
};

// A trip that is not shared is this device's own: admin.
function cloudRole(trip) {
  if (!trip || !trip.cloud) return "admin";
  return CLOUD_ROLES[trip.cloud.role] ? trip.cloud.role : "surpris";
}

function cloudIsAdmin(trip) {
  return cloudRole(trip) === "admin";
}

// ---------- Trip state <-> Firebase tree ----------
// Firebase drops null and empty values and turns dense integer-keyed objects
// into arrays, so the encoding sticks to what survives a round trip.

function cloudIsPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function cloudIsLeafArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => x !== null && x !== undefined && typeof x !== "object");
}

function cloudEncodeValue(v) {
  if (v === null || v === undefined || typeof v === "function") return undefined;
  if (typeof v === "number" && !isFinite(v)) return undefined;
  if (typeof v !== "object") return v;
  if (cloudIsLeafArray(v)) return v.slice();
  const out = {};
  const keys = Array.isArray(v) ? v.map((_, i) => String(i)) : Object.keys(v);
  for (const k of keys) {
    if (!k || CLOUD_KEY_BAD.test(k)) continue;
    const e = cloudEncodeValue(v[k]);
    if (e !== undefined) out[k] = e;
  }
  return Object.keys(out).length ? out : undefined;
}

function cloudDecodeValue(v) {
  if (Array.isArray(v)) return v.map(cloudDecodeValue);
  if (!cloudIsPlainObject(v)) return v;
  const keys = Object.keys(v);
  if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
    const arr = [];
    keys.forEach((k) => { arr[Number(k)] = cloudDecodeValue(v[k]); });
    return arr;
  }
  const out = {};
  keys.forEach((k) => { out[k] = cloudDecodeValue(v[k]); });
  return out;
}

function encodeTripState(s) {
  s = s || {};
  const tree = {};
  for (const k of Object.keys(s)) {
    if (k === "days" || CLOUD_KEY_BAD.test(k)) continue;
    const e = cloudEncodeValue(s[k]);
    if (e !== undefined) tree[k] = e;
  }
  const days = Array.isArray(s.days) ? s.days : [];
  // Days are indexed and an empty one vanishes from Firebase, so the count
  // travels on its own.
  tree._nDays = days.length;
  const dayTree = {};
  const acts = {};
  days.forEach((d, i) => {
    if (!d) return;
    const { activities, ...rest } = d;
    const e = cloudEncodeValue(rest);
    if (e) dayTree[i] = e;
    (Array.isArray(activities) ? activities : []).forEach((a, j) => {
      if (!a || a.id === undefined || a.id === null) return;
      let key = "a" + String(a.id).replace(/[^A-Za-z0-9_-]/g, "_");
      while (acts[key]) key += "_";
      acts[key] = { ...(cloudEncodeValue(a) || {}), _d: i, _o: j };
    });
  });
  if (Object.keys(dayTree).length) tree.days = dayTree;
  if (Object.keys(acts).length) tree.acts = acts;
  return tree;
}

function decodeTripState(tree) {
  tree = cloudIsPlainObject(tree) ? tree : {};
  const s = {};
  for (const k of Object.keys(tree)) {
    if (k === "days" || k === "acts" || k === "_nDays") continue;
    s[k] = cloudDecodeValue(tree[k]);
  }
  const n = Math.max(0, Math.min(366, Math.floor(Number(tree._nDays) || 0)));
  const rawDays = tree.days || {};
  s.days = [];
  for (let i = 0; i < n; i++) {
    const d = rawDays[i];
    s.days.push({
      nightLocation: "",
      nightLatLng: null,
      nightDescription: "",
      ...(cloudIsPlainObject(d) ? cloudDecodeValue(d) : {}),
      activities: [],
    });
  }
  const acts = cloudIsPlainObject(tree.acts) ? tree.acts : {};
  const placed = [];
  for (const key of Object.keys(acts)) {
    const a = acts[key];
    // No id means leftovers of an activity deleted elsewhere while this
    // device was editing it: the delete wins.
    if (!cloudIsPlainObject(a) || a.id === undefined) continue;
    const { _d, _o, ...rest } = a;
    if (!Number.isInteger(_d) || _d < 0 || _d >= n) continue;
    placed.push({ d: _d, o: Number(_o) || 0, key, act: cloudDecodeValue(rest) });
  }
  placed.sort((x, y) => x.o - y.o || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  placed.forEach((p) => s.days[p.d].activities.push(p.act));
  if (!Array.isArray(s.flights)) s.flights = [];
  if (typeof s.title !== "string") s.title = "Voyage";
  return s;
}

// ---------- Leaf maps, merge, update payload ----------
// A tree flattens to Map("a/b/c" → JSON of the leaf); primitive arrays such
// as [lat, lng] stay one leaf.

function cloudFlatten(tree) {
  const out = new Map();
  (function walk(v, path) {
    if (v === null || v === undefined) return;
    if (typeof v !== "object" || cloudIsLeafArray(v)) {
      if (path) out.set(path, JSON.stringify(v));
      return;
    }
    const keys = Array.isArray(v) ? v.map((_, i) => String(i)) : Object.keys(v);
    for (const k of keys) walk(v[k], path ? path + "/" + k : k);
  })(tree, "");
  return out;
}

function cloudUnflatten(flat) {
  const root = {};
  for (const [path, json] of flat) {
    const parts = path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cloudIsPlainObject(node[parts[i]])) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = JSON.parse(json);
  }
  return root;
}

// Leaf-level three-way merge; a leaf both sides changed keeps the local value.
function cloudMerge3(base, local, remote) {
  const out = new Map();
  const paths = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  for (const p of paths) {
    const b = base.get(p);
    const l = local.get(p);
    const r = remote.get(p);
    const v = l === r ? l : l === b ? r : l;
    if (v !== undefined) out.set(p, v);
  }
  return out;
}

// Round trip through the app's shape, which drops orphan leaves a merge can
// leave behind (half of an activity deleted on the other side).
function cloudCanonical(flat) {
  return cloudFlatten(encodeTripState(decodeTripState(cloudUnflatten(flat))));
}

function cloudSameFlat(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

// Multi-path update() payload turning `from` into `to`, or null if equal.
function cloudBuildUpdate(from, to) {
  const ops = {};
  const sets = new Set();
  for (const [p, v] of to) {
    if (from.get(p) !== v) { ops[p] = JSON.parse(v); sets.add(p); }
  }
  const setAncestors = new Set();
  for (const p of sets) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) setAncestors.add(parts.slice(0, i).join("/"));
  }
  for (const p of from.keys()) {
    if (to.has(p) || setAncestors.has(p)) continue;
    // Skip deletions a set already covers: update() refuses overlapping
    // paths, e.g. a leaf that turned into a branch or the reverse.
    const parts = p.split("/");
    let covered = false;
    for (let i = 1; i < parts.length && !covered; i++) covered = sets.has(parts.slice(0, i).join("/"));
    if (!covered) ops[p] = null;
  }
  return Object.keys(ops).length ? ops : null;
}

// ---------- SDK ----------

let cloudSdkPromise = null;

function loadCloudSdk() {
  if (window.firebase && window.firebase.database) return Promise.resolve(window.firebase);
  if (cloudSdkPromise) return cloudSdkPromise;
  const load = (file) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = FIREBASE_SDK_BASE + file;
    s.onload = resolve;
    s.onerror = () => reject(new Error("SDK Firebase injoignable (hors ligne ?)"));
    document.head.appendChild(s);
  });
  cloudSdkPromise = (window.firebase ? Promise.resolve() : load("firebase-app-compat.js"))
    .then(() => load("firebase-database-compat.js"))
    .then(() => window.firebase)
    .catch((e) => { cloudSdkPromise = null; throw e; });
  return cloudSdkPromise;
}

// One named app per database host, so a link can point to any database.
function cloudDb(host) {
  const name = "jl-" + host;
  const app = firebase.apps.find((a) => a.name === name) ||
    firebase.initializeApp({ databaseURL: "https://" + host }, name);
  return app.database();
}

function cloudWithTimeout(promise, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), CLOUD_TIMEOUT)),
  ]);
}

function cloudErrorText(e) {
  const m = (e && (e.code || e.message)) || String(e);
  if (/permission/i.test(m)) return "accès refusé — publie les règles de database.rules.json dans la console Firebase";
  return (e && e.message) || m;
}

// ---------- Live subscriptions ----------

// cloudId → { id, host, ref, handler, base, remote, live, pending, timer, error }
const cloudEntries = new Map();
const cloudConnected = new Map();

function findCloudTrip(cloudId) {
  return allTrips.find((t) => t.cloud && t.cloud.id === cloudId);
}

function cloudLoadBases() {
  try { return JSON.parse(localStorage.getItem(CLOUD_BASE_KEY)) || {}; } catch (e) { return {}; }
}

function cloudStoreBase(cloudId, flat) {
  const all = cloudLoadBases();
  if (flat) all[cloudId] = Object.fromEntries(flat);
  else delete all[cloudId];
  try { localStorage.setItem(CLOUD_BASE_KEY, JSON.stringify(all)); } catch (e) {}
}

function cloudSaveTrips() {
  try { localStorage.setItem("voyageplanner_trips", JSON.stringify(allTrips)); } catch (e) {}
}

async function cloudSubscribeAll() {
  for (const id of [...cloudEntries.keys()]) if (!findCloudTrip(id)) cloudUnsubscribe(id);
  const trips = allTrips.filter((t) => t.cloud && t.cloud.id && t.cloud.db);
  if (!trips.length) return;
  try { await loadCloudSdk(); } catch (e) { cloudRenderStatus(); return; }
  trips.forEach(cloudSubscribe);
}

function cloudSubscribe(trip) {
  const { id, db: host } = trip.cloud;
  if (cloudEntries.has(id)) return cloudEntries.get(id);
  const saved = cloudLoadBases()[id];
  const entry = {
    id,
    host,
    ref: cloudDb(host).ref("trips/" + id + "/state"),
    base: saved ? new Map(Object.entries(saved)) : null,
    remote: null,
    live: false,
    pending: 0,
    timer: null,
    error: null,
  };
  cloudEntries.set(id, entry);
  const onError = (err) => { entry.error = cloudErrorText(err); cloudRenderStatus(); };
  entry.handler = entry.ref.on("value", (snap) => cloudOnRemote(entry, snap.val()), onError);
  const root = cloudDb(host).ref("trips/" + id);
  entry.rolesRef = root.child("roles");
  entry.devicesRef = root.child("devices");
  entry.rolesHandler = entry.rolesRef.on("value", (snap) => cloudOnRoles(entry, snap.val()), onError);
  entry.devicesHandler = entry.devicesRef.on("value", (snap) => {
    entry.devices = snap.val() || {};
    cloudRefreshShareModal(entry.id);
  }, onError);
  cloudRegisterDevice(entry);
  cloudWatchConnection(host);
  return entry;
}

function cloudUnsubscribe(cloudId) {
  const e = cloudEntries.get(cloudId);
  if (!e) return;
  clearTimeout(e.timer);
  e.ref.off("value", e.handler);
  e.rolesRef.off("value", e.rolesHandler);
  e.devicesRef.off("value", e.devicesHandler);
  cloudEntries.delete(cloudId);
}

// "Registered on connection": refreshed every time the trip is subscribed.
function cloudRegisterDevice(entry) {
  entry.devicesRef.child(cloudDevice().id).set(cloudDeviceRecord()).catch(() => {});
}

function cloudOnRoles(entry, roles) {
  const trip = findCloudTrip(entry.id);
  if (!trip) return;
  const me = cloudDevice().id;
  entry.roles = roles || {};
  // Trips shared before roles existed have none. Only a device linked back
  // then (no role stored locally, i.e. the sharer or an early joiner) takes
  // admin; one joining now stays "surpris" and waits for that device.
  if (!roles) {
    if (trip.cloud.role === undefined) entry.rolesRef.child(me).set("admin").catch(() => {});
    return;
  }
  const role = CLOUD_ROLES[roles[me]] ? roles[me] : "surpris";
  if (trip.cloud.role !== role) {
    trip.cloud.role = role;
    cloudSaveTrips();
    if (typeof onRoleChange === "function") onRoleChange(trip);
  }
  cloudRefreshShareModal(entry.id);
}

function cloudAdminIds(entry) {
  const roles = (entry && entry.roles) || {};
  return Object.keys(roles).filter((k) => roles[k] === "admin");
}

function cloudSetRole(cloudId, deviceId, role) {
  const e = cloudEntries.get(cloudId);
  if (!e || !CLOUD_ROLES[role]) return;
  const admins = cloudAdminIds(e);
  if (role !== "admin" && admins.length === 1 && admins[0] === deviceId) {
    setCloudStatus("⚠ Il faut garder au moins un admin");
    cloudRefreshShareModal(cloudId);
    return;
  }
  // "surpris" is the default, so it is stored as the absence of a role.
  e.rolesRef.child(deviceId).set(role === "surpris" ? null : role)
    .catch((err) => setCloudStatus("⚠ " + cloudErrorText(err)));
}

function cloudWatchConnection(host) {
  if (cloudConnected.has(host)) return;
  cloudConnected.set(host, false);
  cloudDb(host).ref(".info/connected").on("value", (snap) => {
    cloudConnected.set(host, !!snap.val());
    cloudRenderStatus();
  });
}

function cloudOnRemote(entry, raw) {
  const trip = findCloudTrip(entry.id);
  if (!trip) { cloudUnsubscribe(entry.id); return; }
  const remote = cloudFlatten(raw);
  const local = cloudFlatten(encodeTripState(trip.state));
  const admin = cloudIsAdmin(trip);
  let merged;
  if (!raw) merged = local; // wiped online: an admin puts it back
  else if (!entry.base || !admin) merged = cloudCanonical(remote); // the shared copy wins
  else merged = cloudCanonical(cloudMerge3(entry.base, local, remote));
  entry.live = true;
  entry.remote = remote;
  entry.base = remote;
  // Stored only once no write is in flight, else a reload before the ack
  // would take the unsent edits for already-synced ones.
  if (!entry.pending) cloudStoreBase(entry.id, remote);
  if (!cloudSameFlat(merged, local)) cloudApplyToLocal(trip, merged);
  const ops = entry.error || !admin ? null : cloudBuildUpdate(remote, merged);
  if (ops) cloudWrite(entry, ops);
  cloudRenderStatus();
}

function cloudWrite(entry, ops) {
  entry.pending++;
  entry.ref.update(ops).then(
    () => {
      entry.pending--;
      if (!entry.pending) cloudStoreBase(entry.id, entry.base);
      cloudRenderStatus();
    },
    (err) => {
      // Rejections are rules or validation, not network (offline writes
      // queue up): stop writing rather than loop on the reverted value.
      entry.pending--;
      entry.error = cloudErrorText(err);
      cloudRenderStatus();
    }
  );
}

// Hooked in saveAll() whenever a trip's content changed.
function cloudNoteLocalChange(trip) {
  if (!trip || !trip.cloud) return;
  const entry = cloudEntries.get(trip.cloud.id);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => cloudPushLocal(entry), CLOUD_PUSH_DELAY);
  cloudRenderStatus();
}

function cloudPushLocal(entry) {
  entry.timer = null;
  const trip = findCloudTrip(entry.id);
  // Not live yet: the first snapshot merges these edits in.
  if (trip && entry.live && !entry.error && cloudIsAdmin(trip)) {
    const ops = cloudBuildUpdate(entry.remote, cloudFlatten(encodeTripState(trip.state)));
    if (ops) cloudWrite(entry, ops);
  }
  cloudRenderStatus();
}

// ---------- Applying remote changes ----------

let cloudToastAt = 0;

function cloudDetailSnapshot() {
  if (!currentDetail || !state.days) return null;
  const day = state.days[currentDetail.day];
  if (!day) return null;
  const target = currentDetail.type === "act"
    ? day.activities.find((a) => a.id === currentDetail.id)
    : { ...day, activities: null };
  return target ? JSON.stringify(target) : null;
}

function cloudApplyToLocal(trip, flat) {
  const next = decodeTripState(cloudUnflatten(flat));
  const isCurrent = trip.id === currentTripId;
  const detailBefore = isCurrent ? cloudDetailSnapshot() : null;
  trip.state = next;
  trip.title = next.title;
  trip.updatedAt = Date.now();
  if (isCurrent) {
    state = next;
    if (typeof syncViewState === "function") syncViewState();
    ensureFlights();
    // The undo stack (`history` in state.js) holds snapshots without the
    // other device's edits: undoing would push their removal.
    history.length = 0;
    try { lastSnapshot = JSON.stringify(state); } catch (e) {}
  }
  tripSigs.set(trip.id, tripSignature(trip.state));
  cloudSaveTrips();
  cloudRefreshView(trip, detailBefore);
  if (Date.now() - cloudToastAt > 5000) {
    cloudToastAt = Date.now();
    showSyncToast("☁ « " + (trip.title || "Voyage") + " » modifié sur un autre appareil");
  }
}

function cloudRefreshView(trip, detailBefore) {
  if (currentView === "home") { renderHome(); return; }
  if (trip.id !== currentTripId) return;
  // Mid-drag or mid-resize the calendar holds DOM state: redraw on release.
  if (document.querySelector(".cal-evt.dragging, .cal-evt.resizing")) {
    document.addEventListener("pointerup", () => setTimeout(() => {
      if (trip.id === currentTripId && currentView === "trip") cloudRefreshView(trip, null);
    }, 0), { once: true });
    return;
  }
  const active = document.activeElement;
  const titleInput = document.getElementById("trip-title-input");
  if (titleInput && active !== titleInput) titleInput.value = state.title;
  document.title = state.title + " — Jet Laggueur";
  const flightsList = document.getElementById("flights-list");
  if (!(flightsList && flightsList.contains(active))) renderFlights();
  renderCalendar();
  updateMap();
  cloudRefreshDetail(detailBefore);
}

function cloudRefreshDetail(detailBefore) {
  if (!currentDetail) return;
  const d = currentDetail;
  const day = state.days[d.day];
  if (!day || (d.type === "act" && !day.activities.some((a) => a.id === d.id))) {
    closeDetail(); // deleted, or moved to another day
    return;
  }
  const panel = document.getElementById("detail-panel");
  const typing = panel && panel.contains(document.activeElement) &&
    document.activeElement.matches("input, textarea");
  if (typing || cloudDetailSnapshot() === detailBefore) return;
  if (d.type === "act") openActivityDetail(d.day, d.id);
  else openNightDetail(d.day);
}

// ---------- Status ----------

function cloudTripStatus(trip) {
  if (!trip || !trip.cloud) return null;
  const e = cloudEntries.get(trip.cloud.id);
  if (e && e.error) return { cls: "err", text: "☁ Erreur", title: e.error };
  if (!e || !e.live || !cloudConnected.get(e.host)) {
    return { cls: "off", text: "☁ Hors ligne", title: "Modifs gardées sur cet appareil, envoyées au retour du réseau" };
  }
  if (e.pending || e.timer) return { cls: "busy", text: "☁ Envoi…", title: "Envoi en cours" };
  return { cls: "ok", text: "☁ À jour", title: "Synchronisé en temps réel" };
}

function cloudRenderStatus() {
  const pill = document.getElementById("cloud-pill");
  if (!pill) return;
  const st = cloudTripStatus(allTrips.find((t) => t.id === currentTripId));
  pill.hidden = !st;
  if (!st) return;
  pill.className = "cloud-pill header-trip-only cloud-" + st.cls;
  pill.textContent = st.text;
  pill.title = st.title;
}

// ---------- Share / join / stop ----------

function cloudNewId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cloudShareCode(trip) {
  return trip.cloud.db + "/" + trip.cloud.id;
}

function cloudShareUrl(trip) {
  return shareBaseUrl() + "#join=" + cloudShareCode(trip);
}

// Accepts a full link or the bare "host/id" code.
function cloudParseCode(text) {
  const m = String(text || "").trim()
    .match(/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:firebaseio\.com|firebasedatabase\.app))\/([A-Za-z0-9_-]{16,64})\/?$/i);
  return m ? { db: m[1].toLowerCase(), id: m[2] } : null;
}

function setCloudStatus(msg) {
  const el = document.getElementById("cloud-status") || document.getElementById("sync-status");
  if (el) el.textContent = msg;
}

function renderCloudSyncFields() {
  const host = getCloudConfig().db || "";
  const rows = allTrips.length
    ? allTrips.map((t) => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px;">
        <span style="flex:1;">${escapeHtml(t.title || "Voyage")}</span>
        ${t.cloud ? '<span class="cloud-badge">☁ partagé</span>' : ""}
        <button class="btn btn-ghost btn-sm" onclick="openCloudShare(${t.id})">${t.cloud ? "🔗 Lien" : "☁ Partager"}</button>
      </div>`).join("")
    : '<p style="font-size:12px;opacity:.7;">Aucun voyage.</p>';
  return `
    <p class="modal-hint" style="margin-top:8px;font-size:11px;">
      Temps réel : chaque modif apparaît aussitôt sur les autres appareils.
      Crée une <em>Realtime Database</em> gratuite sur
      <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a>,
      publie les règles de <code>database.rules.json</code> et colle l'URL de la base.
      Pour rejoindre un voyage, le lien reçu suffit.
    </p>
    <label style="display:block;margin-top:8px;">URL de la base</label>
    <input type="text" id="sync-fb-url" value="${escapeHtml(host ? "https://" + host : "")}"
      placeholder="https://mon-projet-default-rtdb.europe-west1.firebasedatabase.app"
      onchange="onCloudDbInput(this.value)" style="width:100%;padding:8px;box-sizing:border-box;">
    <div style="margin-top:12px;"><strong>Voyages</strong></div>
    <div style="max-height:180px;overflow:auto;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px;margin-top:4px;">
      ${rows}
    </div>
    <div style="margin-top:12px;"><strong>Rejoindre un voyage partagé</strong></div>
    <div style="display:flex;gap:6px;margin-top:4px;">
      <input type="text" id="cloud-join-input" placeholder="Lien ou code reçu" style="flex:1;padding:8px;box-sizing:border-box;">
      <button class="btn btn-gold btn-sm" onclick="cloudJoinFromInput()">Rejoindre</button>
    </div>
  `;
}

function onCloudDbInput(value) {
  setCloudStatus(cloudSaveDbInput(value)
    ? "✓ Base enregistrée"
    : "⚠ URL attendue : https://….firebasedatabase.app ou https://….firebaseio.com");
}

function openCloudShare(idArg) {
  const trip = allTrips.find((t) => t.id === Number(idArg));
  if (!trip) return;
  document.getElementById("modal-title").textContent = "Partage en temps réel";
  const body = document.getElementById("modal-body");
  if (!trip.cloud) {
    const host = getCloudConfig().db || "";
    body.innerHTML = `
      <p class="modal-hint">« ${escapeHtml(trip.title || "Voyage")} » sera mis en ligne sur ta base Firebase.
      Toute personne qui a le lien pourra le suivre en direct, d'abord en <strong>surpris</strong>
      (noms et descriptions partagés, lieux floutés). Tu seras admin et tu choisiras le rôle de chaque appareil.</p>
      <label style="display:block;margin-top:8px;">URL de la base Firebase</label>
      <input type="text" id="cloud-share-db" value="${escapeHtml(host ? "https://" + host : "")}"
        placeholder="https://mon-projet-default-rtdb.europe-west1.firebasedatabase.app"
        style="width:100%;padding:8px;box-sizing:border-box;">
      <div class="modal-actions">
        <button class="btn btn-gold btn-sm" onclick="cloudEnableShare(${trip.id})">☁ Activer le partage</button>
      </div>
      <div id="cloud-status" class="modal-status"></div>
    `;
    showModal();
    return;
  }
  const url = cloudShareUrl(trip);
  const code = cloudShareCode(trip);
  const role = {
    admin: "Tu es <strong>admin</strong> : tu peux modifier ce voyage (bouton ✏️ Gérer) et choisir le rôle de chaque appareil.",
    voyageur: "Tu es <strong>voyageur</strong> : tu vois tout le voyage, en lecture seule.",
    surpris: "Tu es <strong>surpris</strong> : tu vois ce qui est partagé avec toi, les lieux sont approximatifs.",
  }[cloudRole(trip)];
  body.innerHTML = `
    <p class="modal-hint">${role}</p>
    <p class="modal-hint">Envoie ce lien : en l'ouvrant, on suit le voyage en direct. Chaque appareil qui l'ouvre
    apparaît dans la liste ci-dessous en <strong>surpris</strong>, jusqu'à ce qu'un admin change son rôle
    (<strong>voyageur</strong> : voit tout ; <strong>admin</strong> : peut aussi modifier).</p>
    <textarea id="cloud-share-link" readonly style="min-height:70px;word-break:break-all;">${escapeHtml(url)}</textarea>
    <p class="modal-hint" style="font-size:11px;margin-top:6px;">Code (à coller dans ☁ Sync → Firebase → Rejoindre) : <code>${escapeHtml(code)}</code></p>
    <div class="modal-actions">
      <button class="btn btn-gold btn-sm" onclick="copyCloudLink()">📋 Copier</button>
      <button class="btn btn-gold btn-sm" onclick="shareCloudLink()">📤 Partager</button>
      <button class="btn btn-ghost btn-sm" onclick="cloudStopShare(${trip.id})">Arrêter sur cet appareil</button>
    </div>
    <div class="cloud-devices-head">
      <strong>Appareils</strong>
      <a href="#" onclick="cloudRenameFromModal();return false;">Renommer cet appareil</a>
    </div>
    <div id="cloud-devices" class="cloud-devices">${cloudDevicesHtml(trip)}</div>
    <div class="visitor-qr-wrap"><div id="cloud-qr" class="visitor-qr"></div>
      <div class="visitor-qr-caption">Scanne avec un téléphone</div></div>
    <div id="cloud-status" class="modal-status"></div>
  `;
  cloudShareModalTrip = trip.id;
  showModal();
  loadQrLib().then((qrcode) => {
    const q = qrcode(0, "L");
    q.addData(url);
    q.make();
    const el = document.getElementById("cloud-qr");
    if (el) el.innerHTML = q.createSvgTag({ scalable: true });
  }).catch(() => {
    const el = document.getElementById("cloud-qr");
    if (el) { el.classList.add("disabled"); el.textContent = "QR indisponible (hors-ligne ?)"; }
  });
}

let cloudShareModalTrip = null;

function cloudDevicesHtml(trip) {
  const e = trip.cloud && cloudEntries.get(trip.cloud.id);
  if (!e || !e.devices) return '<p class="modal-hint">Liste disponible une fois en ligne.</p>';
  const me = cloudDevice().id;
  const roles = e.roles || {};
  const canManage = cloudIsAdmin(trip);
  const order = { admin: 0, voyageur: 1, surpris: 2 };
  const rows = Object.keys(e.devices)
    .map((id) => ({ ...e.devices[id], id, role: CLOUD_ROLES[roles[id]] ? roles[id] : "surpris" }))
    .sort((a, b) => (order[a.role] - order[b.role]) || ((b.lastSeen || 0) - (a.lastSeen || 0)));
  if (!rows.length) return '<p class="modal-hint">Aucun appareil enregistré.</p>';
  return rows.map((d) => {
    const seen = d.id === me ? "cet appareil" : (d.lastSeen ? "vu " + formatRelative(d.lastSeen) : "");
    const control = canManage
      ? `<select class="cloud-role-select" onchange="cloudSetRole('${trip.cloud.id}','${escapeAttr(d.id)}',this.value)">
          ${Object.keys(CLOUD_ROLES).map((r) => `<option value="${r}" ${r === d.role ? "selected" : ""}>${CLOUD_ROLES[r].label}</option>`).join("")}
        </select>`
      : `<span class="cloud-role-tag">${CLOUD_ROLES[d.role].label}</span>`;
    return `<div class="cloud-device${d.id === me ? " me" : ""}">
      <div class="cloud-device-info">
        <div class="cloud-device-name">${d.platform === "app" ? "📱" : "🌐"} ${escapeHtml(d.name || "Appareil")}</div>
        <div class="cloud-device-meta">${escapeHtml(seen)}</div>
      </div>
      ${control}
    </div>`;
  }).join("");
}

// Live refresh of the device list while the share modal shows that trip.
function cloudRefreshShareModal(cloudId) {
  const el = document.getElementById("cloud-devices");
  const overlay = document.getElementById("modal-overlay");
  if (!el || !overlay || !overlay.classList.contains("open")) return;
  const trip = allTrips.find((t) => t.id === cloudShareModalTrip);
  if (trip && trip.cloud && trip.cloud.id === cloudId) el.innerHTML = cloudDevicesHtml(trip);
}

function cloudRenameFromModal() {
  const name = prompt("Nom de cet appareil :", cloudDeviceName());
  if (name === null) return;
  cloudSetDeviceName(name);
  setCloudStatus("✓ Renommé");
}

function copyCloudLink() {
  const ta = document.getElementById("cloud-share-link");
  if (!ta) return;
  navigator.clipboard.writeText(ta.value).then(
    () => setCloudStatus("✓ Lien copié"),
    () => { ta.select(); document.execCommand("copy"); setCloudStatus("✓ Copié"); }
  );
}

async function shareCloudLink() {
  const ta = document.getElementById("cloud-share-link");
  if (!ta) return;
  if (navigator.share && /^https?:/.test(ta.value)) {
    try {
      await navigator.share({ title: `Jet Laggueur · ${state.title || "Voyage"}`, url: ta.value });
      setCloudStatus("✓ Partagé");
    } catch (e) {}
  } else {
    copyCloudLink();
  }
}

async function cloudEnableShare(idArg) {
  const trip = allTrips.find((t) => t.id === Number(idArg));
  if (!trip || trip.cloud) return;
  const input = document.getElementById("cloud-share-db");
  if (input && !cloudSaveDbInput(input.value)) {
    setCloudStatus("⚠ URL attendue : https://….firebasedatabase.app ou https://….firebaseio.com");
    return;
  }
  const host = getCloudConfig().db;
  if (!host) { setCloudStatus("⚠ Renseigne l'URL de ta base Firebase"); return; }
  cloudEnsureDeviceName();
  setCloudStatus("⏳ Mise en ligne…");
  try {
    await loadCloudSdk();
    const id = cloudNewId();
    const me = cloudDevice().id;
    const tree = encodeTripState(trip.state);
    await cloudWithTimeout(
      cloudDb(host).ref("trips/" + id).set({
        v: 1,
        localId: trip.id,
        createdBy: me,
        roles: { [me]: "admin" },
        devices: { [me]: cloudDeviceRecord() },
        state: tree,
      }),
      "pas de réponse de Firebase (hors ligne ou URL erronée ?)"
    );
    trip.cloud = { db: host, id, role: "admin" };
    cloudStoreBase(id, cloudFlatten(tree));
    cloudSaveTrips();
    cloudSubscribe(trip);
    renderHome();
    cloudRenderStatus();
    openCloudShare(trip.id);
  } catch (e) {
    setCloudStatus("⚠ " + cloudErrorText(e));
  }
}

function cloudJoinFromInput() {
  const input = document.getElementById("cloud-join-input");
  cloudJoin(input ? input.value : "").then(
    (trip) => { if (trip) closeModal(); },
    (e) => setCloudStatus("⚠ " + e.message)
  );
}

async function cloudJoin(text) {
  const c = cloudParseCode(text);
  if (!c) throw new Error("Lien ou code invalide");
  let trip = findCloudTrip(c.id);
  if (!trip) {
    cloudEnsureDeviceName();
    setCloudStatus("⏳ Lecture du voyage…");
    await loadCloudSdk();
    const snap = await cloudWithTimeout(
      cloudDb(c.db).ref("trips/" + c.id).once("value"),
      "pas de réponse de Firebase (hors ligne ?)"
    ).catch((e) => { throw new Error(cloudErrorText(e)); });
    const node = snap.val();
    if (!node || !node.state) throw new Error("Voyage introuvable");
    const next = decodeTripState(node.state);
    // Same trip already here without live sync (a JSONBin copy, say).
    trip = allTrips.find((t) => t.id === Number(node.localId) && !t.cloud) || null;
    if (trip && !confirm(
      `« ${trip.title || "Voyage"} » est déjà sur cet appareil.\n\n` +
      "OK : le remplacer par la version partagée\nAnnuler : garder les deux"
    )) trip = null;
    if (!trip) {
      // Same local id as the sharer when free, which keeps JSONBin copies
      // of this trip matched up across devices.
      let id = Number(node.localId) || Date.now();
      if (allTrips.some((t) => t.id === id)) id = Date.now();
      while (allTrips.some((t) => t.id === id)) id++;
      trip = { id };
      allTrips.push(trip);
    }
    trip.state = next;
    trip.title = next.title;
    trip.updatedAt = Date.now();
    // A new device joins as "surpris" unless an admin already gave it a role.
    const known = node.roles && node.roles[cloudDevice().id];
    trip.cloud = { ...c, role: CLOUD_ROLES[known] ? known : "surpris" };
    tripSigs.set(trip.id, tripSignature(next));
    cloudStoreBase(c.id, cloudFlatten(node.state));
    cloudSaveTrips();
    const cfg = getCloudConfig();
    if (!cfg.db) { cfg.db = c.db; setCloudConfig(cfg); }
    cloudSubscribe(trip);
    showSyncToast("☁ « " + (trip.title || "Voyage") + " » rejoint");
  }
  openTrip(trip.id);
  return trip;
}

function cloudHandleJoinHash() {
  const m = (location.hash || "").match(/^#join=(.+)$/);
  if (!m) return;
  // window.history: state.js shadows `history` with the undo stack.
  window.history.replaceState(null, "", location.pathname + location.search);
  cloudJoin(decodeURIComponent(m[1])).catch((e) => alert("Impossible de rejoindre le voyage : " + e.message));
}

function cloudStopShare(idArg) {
  const trip = allTrips.find((t) => t.id === Number(idArg));
  if (!trip || !trip.cloud) return;
  const e = cloudEntries.get(trip.cloud.id);
  const admins = cloudAdminIds(e);
  const lastAdmin = cloudIsAdmin(trip) && admins.length === 1 && admins[0] === cloudDevice().id
    ? "\n\n⚠ Tu es le seul admin : plus personne ne pourra le modifier. Donne d'abord le rôle à un autre appareil."
    : "";
  if (!confirm("Arrêter la synchro de ce voyage sur cet appareil ?\n\nTa copie locale est gardée, et le voyage reste en ligne pour les autres." + lastAdmin)) return;
  cloudForget(trip);
  cloudSaveTrips();
  renderHome();
  cloudRenderStatus();
  openCloudShare(trip.id);
}

// Stops live sync of a trip on this device; the online copy stays.
function cloudForget(trip) {
  if (!trip || !trip.cloud) return;
  const e = cloudEntries.get(trip.cloud.id);
  if (e && e.timer) cloudPushLocal(e);
  cloudUnsubscribe(trip.cloud.id);
  cloudStoreBase(trip.cloud.id, null);
  delete trip.cloud;
}

function cloudInit() {
  cloudSubscribeAll();
  cloudHandleJoinHash();
  window.addEventListener("hashchange", cloudHandleJoinHash);
  window.addEventListener("online", cloudSubscribeAll);
}
