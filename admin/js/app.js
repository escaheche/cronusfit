/**
 * app.js — Bootstrap & App Initialization
 * Admin Panel CronusFit
 *
 * Entry point for the SPA. Loaded first in index.html.
 * Initializes all core modules and triggers the first navigation.
 *
 * Load order in index.html:
 *   1. app.js  (this file — defines nothing, bootstraps on DOMContentLoaded)
 *   2. router.js
 *   3. auth.js
 *   4. api.js
 *   5. toast.js
 *   6. modal.js
 *   7. sidebar.js
 *   8. network.js
 *   9. sections/…
 *
 * All modules expose themselves on `window` so they are accessible globally
 * without a bundler (e.g. window.AuthGuard, window.Toast, window.Modal, …).
 *
 * Req: 1.1, 2.1, 2.2, 9.2
 */

window.addEventListener('DOMContentLoaded', () => {
  // 1. Start connectivity monitor (registers online/offline listeners)
  if (typeof Network !== 'undefined') {
    Network.init();
  } else {
    console.warn('[App] Network module not loaded yet — check script order in index.html');
  }

  // 2. Render sidebar navigation items and wire hamburger / logout
  if (typeof Sidebar !== 'undefined') {
    Sidebar.init();
  } else {
    console.warn('[App] Sidebar module not loaded yet — check script order in index.html');
  }

  // 3. Navigate to the initial hash (or fallback to #patrones)
  //    Router registers its own DOMContentLoaded listener and handles this,
  //    but we call it here explicitly as a safety net in case the router file
  //    loaded before the section modules were ready.
  //
  //    The router's own DOMContentLoaded listener fires first (it was registered
  //    when router.js was evaluated), and sections will be available because all
  //    <script> tags are synchronous — by the time DOMContentLoaded fires, every
  //    module is already evaluated and its global is on window.
  //
  //    NOTE: Router.navigate() is idempotent — calling it again is safe.
  if (typeof Router !== 'undefined') {
    Router.navigate(location.hash || '#patrones');
  } else {
    console.warn('[App] Router module not loaded yet — check script order in index.html');
  }
});

/*
 * Expose a minimal global for debugging in DevTools.
 * This does NOT expose the JWT — only module references.
 */
window.__CronusFitAdmin = {
  get AuthGuard()  { return typeof AuthGuard  !== 'undefined' ? AuthGuard  : null; },
  get Toast()      { return typeof Toast      !== 'undefined' ? Toast      : null; },
  get Modal()      { return typeof Modal      !== 'undefined' ? Modal      : null; },
  get Sidebar()    { return typeof Sidebar    !== 'undefined' ? Sidebar    : null; },
  get Api()        { return typeof Api        !== 'undefined' ? Api        : null; },
  get Router()     { return typeof Router     !== 'undefined' ? Router     : null; },
  get Network()    { return typeof Network    !== 'undefined' ? Network    : null; },
};
