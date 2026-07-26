/**
 * modal.js — Reusable Modal Component
 * Admin Panel CronusFit
 *
 * Injects content into the existing #modal shell defined in index.html.
 * Accessible: role="dialog", aria-modal="true", aria-labelledby="modal-title",
 * focus trapping on #modal-confirm, Escape key to close.
 *
 * Usage:
 *   Modal.open({ title, bodyHTML, onConfirm, confirmLabel, confirmDisabled });
 *   Modal.close();
 */

const Modal = {
  /** @type {Function|null} Bound Escape key handler (stored for cleanup) */
  _keyHandler: null,

  /**
   * Open the modal with the given content and configuration.
   *
   * @param {object} options
   * @param {string}   options.title           - Modal heading text
   * @param {string}   options.bodyHTML         - HTML string for modal body
   * @param {Function} options.onConfirm        - Called when confirm button is clicked
   * @param {string}   [options.confirmLabel]   - Confirm button text (default: 'Confirmar')
   * @param {boolean}  [options.confirmDisabled]- Whether confirm button starts disabled
   */
  open({ title, bodyHTML, onConfirm, confirmLabel = 'Confirmar', confirmDisabled = false }) {
    const el      = document.getElementById('modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl  = document.getElementById('modal-body');
    const confirmEl = document.getElementById('modal-confirm');

    if (!el || !titleEl || !bodyEl || !confirmEl) {
      console.error('[Modal] Required DOM elements not found. Ensure #modal shell is in index.html.');
      return;
    }

    // Populate content
    titleEl.textContent  = title ?? '';
    bodyEl.innerHTML     = bodyHTML ?? '';
    confirmEl.textContent = confirmLabel;
    confirmEl.disabled   = confirmDisabled === true;

    // Attach confirm handler (replace any previous)
    confirmEl.onclick = (e) => {
      e.preventDefault();
      if (typeof onConfirm === 'function') onConfirm();
    };

    // Show modal
    el.classList.remove('hidden');
    el.setAttribute('aria-modal', 'true');

    // Focus the confirm button for keyboard accessibility
    // Use setTimeout to ensure the element is visible/focusable
    setTimeout(() => confirmEl.focus(), 0);

    // Register Escape key handler
    Modal._keyHandler = (e) => {
      if (e.key === 'Escape') Modal.close();
    };
    document.addEventListener('keydown', Modal._keyHandler);
  },

  /**
   * Close the modal and clean up event listeners.
   */
  close() {
    const el = document.getElementById('modal');
    if (!el) return;

    el.classList.add('hidden');
    el.setAttribute('aria-modal', 'false');

    // Remove confirm handler to prevent stale closures
    const confirmEl = document.getElementById('modal-confirm');
    if (confirmEl) {
      confirmEl.onclick = null;
      confirmEl.disabled = false;
    }

    // Clean up body content
    const bodyEl = document.getElementById('modal-body');
    if (bodyEl) bodyEl.innerHTML = '';

    // Remove Escape handler
    if (Modal._keyHandler) {
      document.removeEventListener('keydown', Modal._keyHandler);
      Modal._keyHandler = null;
    }
  },
};

window.Modal = Modal;
