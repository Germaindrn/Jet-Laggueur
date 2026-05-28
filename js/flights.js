// Flight cards (arrival + departure) and IATA airport autocomplete picker.

function apSearch(q) {
  if (!q || q.length < 2) return [];
  const up = q.toUpperCase().trim();
  return Object.entries(AP)
    .filter(
      ([code, a]) =>
        code.startsWith(up) ||
        a.c.toUpperCase().includes(up) ||
        a.n.toUpperCase().includes(up) ||
        a.co.toUpperCase().includes(up)
    )
    .slice(0, 8);
}

function apInput(fid, field, q) {
  const dd = document.getElementById(`apdd-${fid}-${field}`);
  if (!dd) return;
  const res = apSearch(q);
  if (!res.length) {
    dd.style.display = "none";
    return;
  }
  dd.innerHTML = res
    .map(
      ([code, a]) =>
        `<div class="ap-option" onmousedown="apSelect(${fid},'${field}','${code}')">
      <span class="ap-code">${code}</span>
      <div class="ap-info"><div class="ap-city-name">${a.c}</div><div class="ap-full-name">${a.n}</div></div>
      <span class="ap-ctry">${a.co}</span>
    </div>`
    )
    .join("");
  dd.style.display = "block";
}

function apSelect(fid, field, code) {
  const f = state.flights.find((f) => f.id === fid);
  if (!f) return;
  f[field + "Code"] = code;
  saveState();
  const inp = document.getElementById(`apinp-${fid}-${field}`);
  if (inp) inp.value = code;
  const res = document.getElementById(`apres-${fid}-${field}`);
  const a = AP[code];
  if (res && a) {
    res.textContent = `${a.c} · ${a.n}`;
    res.className = "ap-resolved ok";
  }
  const dd = document.getElementById(`apdd-${fid}-${field}`);
  if (dd) dd.style.display = "none";
  updateMap();
}

function apBlur(fid, field) {
  setTimeout(() => {
    const dd = document.getElementById(`apdd-${fid}-${field}`);
    if (dd) dd.style.display = "none";
    const inp = document.getElementById(`apinp-${fid}-${field}`);
    if (!inp) return;
    const val = inp.value.toUpperCase().trim();
    const f = state.flights.find((f) => f.id === fid);
    if (!f) return;
    if (val.length === 3 && AP[val]) {
      apSelect(fid, field, val);
    } else {
      f[field + "Code"] = inp.value;
      const res = document.getElementById(`apres-${fid}-${field}`);
      if (res) {
        res.textContent = "";
        res.className = "ap-resolved";
      }
    }
  }, 160);
}

function apWidget(fid, field, cur, ph) {
  const a = cur ? AP[cur.toUpperCase()] : null;
  return `<div class="airport-picker">
    <input type="text" id="apinp-${fid}-${field}" placeholder="${ph}" value="${cur || ""}"
      oninput="apInput(${fid},'${field}',this.value)"
      onfocus="apInput(${fid},'${field}',this.value)"
      onblur="apBlur(${fid},'${field}')">
    <div class="ap-resolved${a ? " ok" : ""}" id="apres-${fid}-${field}">${a ? a.c + " · " + a.n : ""}</div>
    <div class="ap-dropdown" id="apdd-${fid}-${field}"></div>
  </div>`;
}

function apLabel(code) {
  if (!code) return "?";
  const a = AP[code.toUpperCase()];
  return a ? `${code.toUpperCase()} · ${a.c}` : code;
}

function apCity(code) {
  if (!code) return "?";
  const a = AP[code.toUpperCase()];
  return a ? a.c : code;
}

// ============== FLIGHT CARDS ==============
function updateFlight(id, field, value) {
  const f = state.flights.find((f) => f.id === id);
  if (f) f[field] = value;
  saveState();
}

function tzOpts(sel) {
  return TIMEZONES.map(
    (tz) =>
      `<option value="${tz}"${tz === sel ? " selected" : ""}>${tz.replace(/_/g, " ")}</option>`
  ).join("");
}

function renderFlights() {
  const list = document.getElementById("flights-list");
  document.getElementById("no-flights").style.display = "none";
  list.innerHTML = state.flights
    .map((f, i) => {
      if (i === 0) {
        // Arrivée : où et quand on arrive sur place
        return `
      <div class="flight-card">
        <div class="card-top">
          <span class="flight-badge">✈ Arrivée</span>
          <input type="text" style="max-width:140px" placeholder="N° vol (AF011)" value="${f.flightNum || ""}" onchange="updateFlight(${f.id},'flightNum',this.value)">
        </div>
        <div class="form-row cols-1">
          <div><label>Aéroport d'arrivée</label>${apWidget(f.id, "to", f.toCode, "NRT, Tokyo…")}</div>
        </div>
        <div class="form-row cols-3">
          <div><label>Date</label><input type="date" value="${f.arriveDate || ""}" onchange="updateFlight(${f.id},'arriveDate',this.value)"></div>
          <div><label>Heure</label><input type="time" value="${f.arriveTime || ""}" onchange="updateFlight(${f.id},'arriveTime',this.value)"></div>
          <div><label>Fuseau</label><select onchange="updateFlight(${f.id},'arriveTz',this.value)">${tzOpts(f.arriveTz)}</select></div>
        </div>
      </div>`;
      }
      // Départ : où et quand on repart
      return `
      <div class="flight-card">
        <div class="card-top">
          <span class="flight-badge">✈ Départ</span>
          <input type="text" style="max-width:140px" placeholder="N° vol (AF012)" value="${f.flightNum || ""}" onchange="updateFlight(${f.id},'flightNum',this.value)">
        </div>
        <div class="form-row cols-1">
          <div><label>Aéroport de départ</label>${apWidget(f.id, "from", f.fromCode, "CDG, Paris…")}</div>
        </div>
        <div class="form-row cols-3">
          <div><label>Date</label><input type="date" value="${f.departDate || ""}" onchange="updateFlight(${f.id},'departDate',this.value)"></div>
          <div><label>Heure</label><input type="time" value="${f.departTime || ""}" onchange="updateFlight(${f.id},'departTime',this.value)"></div>
          <div><label>Fuseau</label><select onchange="updateFlight(${f.id},'departTz',this.value)">${tzOpts(f.departTz)}</select></div>
        </div>
      </div>`;
    })
    .join("");
}

function flightDuration(f) {
  try {
    const depLocal = new Date(`${f.departDate}T${f.departTime}:00`);
    const arrLocal = new Date(`${f.arriveDate}T${f.arriveTime}:00`);
    const depOffset = tzOffsetMinutes(depLocal, f.departTz || "Europe/Paris");
    const arrOffset = tzOffsetMinutes(arrLocal, f.arriveTz || "Europe/Paris");
    const depUTC = depLocal.getTime() - depOffset * 60000;
    const arrUTC = arrLocal.getTime() - arrOffset * 60000;
    const ms = arrUTC - depUTC;
    if (ms < 0) return "";
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return `<div class="route-segment"><strong>Durée :</strong> ${h}h${m > 0 ? m + "min" : ""}</div>`;
  } catch (e) {
    return "";
  }
}

function tzOffsetMinutes(date, tz) {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: tz });
  return (new Date(tzStr) - new Date(utcStr)) / 60000;
}
