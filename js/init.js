// Bootstrap: bind the trip-title input, ensure flights, restore UI from storage.
// Runs last so every other module's functions are already defined.

if (isVisitorMode()) {
  const trip = readVisitorHash();
  if (trip) {
    applyVisitorTripToState(trip);
    activateVisitorMode();
    const banner = document.createElement("div");
    banner.className = "visitor-banner";
    banner.textContent = "👥 Mode visiteur — lieux floutés à ±2 km, lecture seule";
    document.body.insertBefore(banner, document.body.firstChild);
  } else {
    alert("Lien visiteur invalide ou corrompu.");
    history.replaceState(null, "", location.pathname);
  }
}

document.getElementById("trip-title-input").addEventListener("input", (e) => {
  state.title = e.target.value;
  document.title = e.target.value + " — Jet Laggueur";
  saveState();
  renderTripSelector();
});

ensureFlights();
restoreUI();
