/**
 * network.js — Connectivity Monitor
 * Admin Panel CronusFit
 *
 * Usage:
 *   Network.init();       // call once on DOMContentLoaded
 *   Network.isOnline();   // returns current connectivity state
 *
 * HTML dependencies:
 *   <div id="network-banner" class="hidden ...">...</div>
 *   Any element with [data-requires-network] is disabled while offline
 */

const Network = {
  /** Current connectivity state — initialised from browser navigator.onLine */
  _online: navigator.onLine,

  /**
   * Register window online/offline event listeners.
   * Should be called once during app bootstrap (DOMContentLoaded).
   */
  init() {
    window.addEventListener('online', () => this._set(true));
    window.addEventListener('offline', () => this._set(false));

    // Apply initial state in case the page loaded while offline
    this._set(this._online);
  },

  /**
   * Internal: update connectivity state and sync UI.
   * @param {boolean} online
   */
  _set(online) {
    this._online = online;

    const banner = document.getElementById('network-banner');
    if (banner) {
      if (online) {
        banner.classList.add('hidden');
      } else {
        banner.classList.remove('hidden');
      }
    }

    // Enable/disable all elements that require a network connection
    document.querySelectorAll('[data-requires-network]').forEach((el) => {
      el.disabled = !online;
    });
  },

  /**
   * Returns the current connectivity state.
   * @returns {boolean}
   */
  isOnline() {
    return this._online;
  },
};

window.Network = Network;
