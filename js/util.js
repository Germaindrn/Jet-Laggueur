function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The Android app serves these files from a private origin, so links meant
// for other people must point to the public site.
const PUBLIC_SITE_URL = "https://germaindrn.github.io/Jet-Laggueur/";

function isAndroidApp() {
  return location.hostname === "appassets.androidplatform.net";
}

function shareBaseUrl() {
  if (/^https?:$/.test(location.protocol) && !isAndroidApp()) return location.origin + location.pathname;
  return PUBLIC_SITE_URL;
}
