// Bootstrap: bind the trip-title input, ensure flights, restore UI from storage.
// Runs last so every other module's functions are already defined.

document.getElementById("trip-title-input").addEventListener("input", (e) => {
  state.title = e.target.value;
  document.title = e.target.value + " — Jet Laggueur";
  saveState();
  renderTripSelector();
});

ensureFlights();
restoreUI();
