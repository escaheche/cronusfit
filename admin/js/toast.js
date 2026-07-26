/**
 * toast.js — Toast Notification component
 * Admin Panel CronusFit
 *
 * Usage:
 *   Toast.success('Patrón guardado correctamente');   // auto-dismiss after 4s
 *   Toast.error('Error al guardar el patrón');        // persists until user closes
 *   Toast.warn('Sesión expirada');                    // persists until user closes
 */

const Toast = {
  /**
   * Internal: creates and appends a toast element to #toast-container.
   *
   * @param {'success'|'error'|'warn'} type
   * @param {string} message
   * @param {boolean} autoDismiss - If true, removes the toast after 4000ms
   * @returns {HTMLElement} The created toast element
   */
  _show(type, message, autoDismiss = true) {
    const container = document.getElementById('toast-container');
    if (!container) {
      console.warn('[Toast] #toast-container not found in DOM');
      return null;
    }

    // Wrapper element — WCAG 2.1 AA: role=alert + aria-live=assertive
    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');

    // Base classes + type-specific class
    el.className = [
      `toast-${type}`,
      'rounded-xl',
      'px-4',
      'py-3',
      'flex',
      'items-start',
      'gap-3',
      'shadow-lg',
      'text-sm',
      'font-medium',
    ].join(' ');

    // Message span
    const msgSpan = document.createElement('span');
    msgSpan.className = 'flex-1';
    msgSpan.textContent = message;
    el.appendChild(msgSpan);

    // Error and warn require a manual close button; success auto-dismisses
    if (!autoDismiss) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Cerrar notificación');
      closeBtn.className = 'ml-auto shrink-0 opacity-75 hover:opacity-100 transition-opacity';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => el.remove());
      el.appendChild(closeBtn);
    }

    container.appendChild(el);

    if (autoDismiss) {
      setTimeout(() => el.remove(), 4000);
    }

    return el;
  },

  /**
   * Show a success toast. Auto-dismisses after 4 seconds.
   * @param {string} msg
   */
  success: (msg) => Toast._show('success', msg, true),

  /**
   * Show an error toast. Persists until the user closes it.
   * @param {string} msg
   */
  error: (msg) => Toast._show('error', msg, false),

  /**
   * Show a warning toast. Persists until the user closes it.
   * @param {string} msg
   */
  warn: (msg) => Toast._show('warn', msg, false),
};

window.Toast = Toast;
