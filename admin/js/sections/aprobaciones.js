/**
 * sections/aprobaciones.js — Sección Aprobaciones
 * Admin Panel CronusFit
 *
 * Cola de mockups pendientes de aprobación. Aprobar o rechazar con motivo.
 * Req: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

const AprobacionesSection = {
  /** @type {Array} Local pending-approval mockup list */
  _items: [],

  async render() {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    // Show loading
    appContent.innerHTML = `
      <div class="flex items-center justify-center min-h-64">
        <div class="flex flex-col items-center gap-3 text-gray-400">
          <svg class="w-10 h-10 animate-spin text-brand-gold" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span class="text-sm">Cargando cola de aprobaciones...</span>
        </div>
      </div>
    `;

    try {
      const data = await Api.get('/api/mockups?status=pending_approval');
      // Sort ASC: oldest first (first-in, first-out review queue)
      AprobacionesSection._items = (data || []).sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );
    } catch (err) {
      Toast.error(`Error al cargar aprobaciones: ${err.message ?? 'Error desconocido'}`);
      appContent.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <p>No se pudo cargar la cola de aprobaciones.</p>
        </div>
      `;
      return;
    }

    AprobacionesSection._renderQueue(appContent);

    // Update sidebar badge with current pending count
    if (typeof Sidebar !== 'undefined') {
      Sidebar.updateBadge('#aprobaciones', AprobacionesSection._items.length);
    }
  },

  _renderQueue(container) {
    if (!AprobacionesSection._items.length) {
      container.innerHTML = `
        <div class="max-w-4xl mx-auto">
          <h2 class="text-xl font-bold text-brand-blue mb-6">Cola de aprobaciones</h2>
          <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
            <svg class="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <p class="text-base font-medium">No hay mockups pendientes de revisión</p>
          </div>
        </div>
      `;
      return;
    }

    const cards = AprobacionesSection._items.map(item => AprobacionesSection._renderCard(item)).join('');

    container.innerHTML = `
      <div class="max-w-4xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-xl font-bold text-brand-blue">Cola de aprobaciones</h2>
          <span class="bg-amber-100 text-amber-700 text-sm font-semibold px-3 py-1 rounded-full">
            ${AprobacionesSection._items.length} pendiente(s)
          </span>
        </div>
        <div id="approval-queue" class="space-y-4">
          ${cards}
        </div>
      </div>
    `;

    // Wire event delegation
    container.addEventListener('click', AprobacionesSection._handleClick);
  },

  _renderCard(item) {
    return `
      <article id="approval-card-${AprobacionesSection._esc(item.id)}"
               class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="p-5">

          <!-- Header -->
          <div class="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 class="font-bold text-brand-blue text-base">
                ${AprobacionesSection._esc(item.patternName ?? '—')}
              </h3>
              <p class="text-sm text-gray-500 mt-0.5">
                ${AprobacionesSection._esc(item.garmentType ?? '—')}
                · Generado el ${AprobacionesSection._formatDate(item.createdAt)}
              </p>
            </div>
            <span class="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                         bg-amber-100 text-amber-700">
              Pendiente
            </span>
          </div>

          <!-- Front + Back images -->
          <div class="grid grid-cols-2 gap-3 mb-5">
            <div>
              <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Vista frontal
              </p>
              <img src="${AprobacionesSection._esc(item.frontUrl)}"
                   alt="Vista frontal del mockup ${AprobacionesSection._esc(item.patternName ?? item.id)}"
                   loading="lazy"
                   class="w-full rounded-xl border border-gray-200 object-contain aspect-square bg-gray-50">
            </div>
            <div>
              <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Vista trasera
              </p>
              <img src="${AprobacionesSection._esc(item.backUrl)}"
                   alt="Vista trasera del mockup ${AprobacionesSection._esc(item.patternName ?? item.id)}"
                   loading="lazy"
                   class="w-full rounded-xl border border-gray-200 object-contain aspect-square bg-gray-50">
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-3">
            <button class="btn-approve btn-primary flex items-center gap-1.5"
                    data-item-id="${AprobacionesSection._esc(item.id)}"
                    data-requires-network>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
              <span>Aprobar</span>
              <svg class="btn-approve-spinner hidden w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </button>
            <button class="btn-reject btn-danger flex items-center gap-1.5"
                    data-item-id="${AprobacionesSection._esc(item.id)}"
                    data-requires-network>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
              Rechazar
            </button>
          </div>

        </div>
      </article>
    `;
  },

  // ── Event handling ─────────────────────────────────────────────────────────

  _handleClick(e) {
    const approveBtn = e.target.closest('.btn-approve');
    const rejectBtn  = e.target.closest('.btn-reject');

    if (approveBtn) {
      AprobacionesSection._handleApprove(approveBtn.dataset.itemId, approveBtn);
    } else if (rejectBtn) {
      AprobacionesSection._openRejectModal(rejectBtn.dataset.itemId);
    }
  },

  async _handleApprove(id, btn) {
    if (!id) return;

    const spinner = btn.querySelector('.btn-approve-spinner');
    btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');

    try {
      await Api.put(`/api/mockups/${id}`, { status: 'approved' });

      // Remove from local list
      AprobacionesSection._items = AprobacionesSection._items.filter(i => i.id !== id);

      // Remove card from DOM
      const card = document.getElementById(`approval-card-${id}`);
      if (card) card.remove();

      // Update sidebar badge
      if (typeof Sidebar !== 'undefined') {
        Sidebar.updateBadge('#aprobaciones', AprobacionesSection._items.length);
      }

      Toast.success('Mockup aprobado correctamente.');

      // Show empty state if queue is now empty
      if (!AprobacionesSection._items.length) {
        const queueEl = document.getElementById('approval-queue');
        if (queueEl) {
          queueEl.innerHTML = `
            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-gray-400">
              <p class="text-base font-medium">No hay más mockups pendientes de revisión</p>
            </div>
          `;
        }
      }
    } catch (err) {
      Toast.error(`Error al aprobar mockup: ${err.message ?? 'Error desconocido'}`);
      // Restore button — item stays in queue
      btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
    }
  },

  _openRejectModal(id) {
    if (!id || typeof Modal === 'undefined') return;

    const bodyHTML = `
      <div>
        <label for="reject-reason" class="block text-sm font-semibold text-gray-700 mb-2">
          Motivo de rechazo <span class="text-red-500" aria-hidden="true">*</span>
        </label>
        <textarea id="reject-reason"
                  rows="4"
                  maxlength="500"
                  placeholder="Describe el motivo de rechazo (1–500 caracteres)..."
                  class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold
                         resize-none"
                  aria-required="true"></textarea>
        <p class="text-xs text-gray-400 mt-1">
          <span id="reject-char-count">0</span>/500 caracteres
        </p>
        <span id="reject-reason-err" class="hidden text-xs text-red-600 mt-1" role="alert">
          El motivo debe tener entre 1 y 500 caracteres.
        </span>
      </div>
    `;

    Modal.open({
      title: 'Rechazar mockup',
      bodyHTML,
      confirmLabel: 'Confirmar rechazo',
      onConfirm: async () => {
        const reason = document.getElementById('reject-reason')?.value?.trim() ?? '';
        const errEl  = document.getElementById('reject-reason-err');

        if (reason.length < 1 || reason.length > 500) {
          if (errEl) errEl.classList.remove('hidden');
          return; // Keep modal open
        }

        Modal.close();
        await AprobacionesSection._handleReject(id, reason);
      },
    });

    // Wire textarea for live validation + char count + confirm button state
    const textarea = document.getElementById('reject-reason');
    const confirmBtn = document.getElementById('modal-confirm');
    const charCount  = document.getElementById('reject-char-count');

    // Initially disable confirm
    if (confirmBtn) confirmBtn.disabled = true;

    textarea?.addEventListener('input', () => {
      const len = textarea.value.trim().length;
      if (charCount) charCount.textContent = len;

      const valid = len >= 1 && len <= 500;
      if (confirmBtn) confirmBtn.disabled = !valid;

      const errEl = document.getElementById('reject-reason-err');
      if (errEl) errEl.classList.toggle('hidden', valid);
    });
  },

  async _handleReject(id, reason) {
    try {
      await Api.put(`/api/mockups/${id}`, { status: 'rejected', reason });

      // Remove from local list
      AprobacionesSection._items = AprobacionesSection._items.filter(i => i.id !== id);

      // Remove card from DOM
      const card = document.getElementById(`approval-card-${id}`);
      if (card) card.remove();

      // Update sidebar badge
      if (typeof Sidebar !== 'undefined') {
        Sidebar.updateBadge('#aprobaciones', AprobacionesSection._items.length);
      }

      Toast.success('Mockup rechazado.');

      // Empty state
      if (!AprobacionesSection._items.length) {
        const queueEl = document.getElementById('approval-queue');
        if (queueEl) {
          queueEl.innerHTML = `
            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-gray-400">
              <p class="text-base font-medium">No hay más mockups pendientes de revisión</p>
            </div>
          `;
        }
      }
    } catch (err) {
      Toast.error(`Error al rechazar mockup: ${err.message ?? 'Error desconocido'}`);
      // Item stays in local list; card stays in DOM
    }
  },

  // ── Helpers ────────────────────────────────────────────────────────────────

  _formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('es-CL', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch { return iso; }
  },

  _esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

window.AprobacionesSection = AprobacionesSection;
