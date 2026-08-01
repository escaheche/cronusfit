/**
 * sections/cotizaciones.js — Sección Cotizaciones
 * Admin Panel CronusFit
 *
 * Lista, filtra y responde cotizaciones de clientes.
 * Req: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

const CotizacionesSection = {
  /** @type {Array} Full local copy of quotes */
  _quotes: [],
  /** @type {string} Active status filter */
  _activeFilter: 'all',
  /** @type {string|null} Currently expanded quote id */
  _selectedId: null,

  async render() {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    // Reset state
    CotizacionesSection._activeFilter = 'all';
    CotizacionesSection._selectedId = null;

    // Show loading spinner
    appContent.innerHTML = `
      <div class="flex items-center justify-center min-h-64">
        <div class="flex flex-col items-center gap-3 text-gray-400">
          <svg class="w-10 h-10 animate-spin text-brand-gold" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span class="text-sm">Cargando cotizaciones...</span>
        </div>
      </div>
    `;

    try {
      const data = await Api.get('/api/quotes');
      // Sort by receivedAt descending
      CotizacionesSection._quotes = (data || []).sort(
        (a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)
      );
    } catch (err) {
      Toast.error(`Error al cargar cotizaciones: ${err.message ?? 'Error desconocido'}`);
      appContent.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <p class="text-base">No se pudo cargar la lista de cotizaciones.</p>
        </div>
      `;
      return;
    }

    CotizacionesSection._renderAll(appContent);
  },

  // ── Rendering ──────────────────────────────────────────────────────────────

  _renderAll(container) {
    const counts = CotizacionesSection._countByStatus();
    const filtered = CotizacionesSection._filtered();

    container.innerHTML = `
      <div class="max-w-5xl mx-auto">
        <h2 class="text-xl font-bold text-brand-blue mb-5">Cotizaciones</h2>

        <!-- Status summary counters -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          ${CotizacionesSection._renderCounterCard('Pendientes', counts.pending, 'amber')}
          ${CotizacionesSection._renderCounterCard('Cotizadas', counts.quoted, 'blue')}
          ${CotizacionesSection._renderCounterCard('Aceptadas', counts.accepted, 'emerald')}
          ${CotizacionesSection._renderCounterCard('Rechazadas', counts.rejected, 'red')}
        </div>

        <!-- Filter buttons -->
        <div class="flex flex-wrap gap-2 mb-5" role="group" aria-label="Filtrar por estado">
          ${[
            ['all', 'Todas'],
            ['pending', 'Pendientes'],
            ['quoted', 'Cotizadas'],
            ['accepted', 'Aceptadas'],
            ['rejected', 'Rechazadas'],
          ].map(([val, label]) => `
            <button class="filter-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors
                           ${CotizacionesSection._activeFilter === val
                              ? 'bg-brand-blue text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
                    data-filter="${val}">
              ${label}
            </button>
          `).join('')}
        </div>

        <!-- Quotes list + detail panel -->
        <div class="flex flex-col lg:flex-row gap-5">

          <!-- List -->
          <div id="quotes-list" class="flex-1">
            ${CotizacionesSection._renderList(filtered)}
          </div>

          <!-- Detail panel -->
          <div id="quote-detail" class="lg:w-96 shrink-0">
            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center text-gray-400 text-sm">
              Selecciona una cotización para ver el detalle
            </div>
          </div>

        </div>
      </div>
    `;

    // Wire filter buttons
    container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        CotizacionesSection._activeFilter = btn.dataset.filter;
        CotizacionesSection._rerenderList();
        // Update active state visually
        container.querySelectorAll('.filter-btn').forEach(b => {
          const active = b.dataset.filter === CotizacionesSection._activeFilter;
          b.className = `filter-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            active ? 'bg-brand-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`;
        });
      });
    });

    // Wire row clicks via event delegation
    container.addEventListener('click', (e) => {
      const row = e.target.closest('[data-quote-id]');
      if (!row || e.target.closest('button')) return;
      const id = row.dataset.quoteId;
      CotizacionesSection._selectedId = id;
      CotizacionesSection._renderDetail(id);
    });

    // Wire price form submissions via delegation
    container.addEventListener('submit', (e) => {
      if (e.target.id === 'price-form') {
        e.preventDefault();
        CotizacionesSection._handlePriceSubmit(e.target);
      }
    });
  },

  _renderCounterCard(label, count, color) {
    const colorMap = {
      amber:   'bg-amber-50 border-amber-200 text-amber-700',
      blue:    'bg-blue-50 border-blue-200 text-blue-700',
      emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      red:     'bg-red-50 border-red-200 text-red-700',
    };
    return `
      <div class="rounded-xl border p-4 ${colorMap[color] ?? 'bg-gray-50 border-gray-200 text-gray-700'}">
        <p class="text-2xl font-bold">${count}</p>
        <p class="text-xs font-medium mt-0.5">${label}</p>
      </div>
    `;
  },

  _renderList(quotes) {
    if (!quotes.length) {
      return `
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400 text-sm">
          No hay cotizaciones con este filtro
        </div>
      `;
    }
    return `
      <ul class="space-y-2">
        ${quotes.map(q => `
          <li data-quote-id="${CotizacionesSection._esc(q.id)}"
              class="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3.5
                     hover:border-brand-blue/30 cursor-pointer transition-colors
                     ${CotizacionesSection._selectedId === q.id ? 'border-brand-blue bg-brand-blue/5' : ''}">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-gray-900 truncate">
                  ${CotizacionesSection._esc(q.clientName ?? '—')}
                </p>
                <p class="text-xs text-gray-500 mt-0.5">
                  ${CotizacionesSection._esc(q.product ?? '—')}
                  · Cant: ${q.quantity ?? '—'}
                  · ${(q.sizes ?? []).join(', ') || '—'}
                </p>
              </div>
              <div class="shrink-0 text-right">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                             ${CotizacionesSection._statusClass(q.status)}">
                  ${CotizacionesSection._formatStatus(q.status)}
                </span>
                <p class="text-xs text-gray-400 mt-1">
                  ${CotizacionesSection._formatDate(q.receivedAt)}
                </p>
              </div>
            </div>
          </li>
        `).join('')}
      </ul>
    `;
  },

  _rerenderList() {
    const listEl = document.getElementById('quotes-list');
    if (listEl) listEl.innerHTML = CotizacionesSection._renderList(CotizacionesSection._filtered());
  },

  _renderDetail(id) {
    const q = CotizacionesSection._quotes.find(x => x.id === id);
    const detailEl = document.getElementById('quote-detail');
    if (!q || !detailEl) return;

    const historyRows = (q.statusHistory ?? []).map(h => `
      <div class="flex items-center justify-between text-xs">
        <span class="inline-flex items-center px-2 py-0.5 rounded-full font-medium
                     ${CotizacionesSection._statusClass(h.status)}">
          ${CotizacionesSection._formatStatus(h.status)}
        </span>
        <span class="text-gray-400">${CotizacionesSection._formatDate(h.changedAt)}</span>
      </div>
    `).join('');

    const priceForm = q.status === 'pending' ? `
      <form id="price-form" data-quote-id="${CotizacionesSection._esc(q.id)}" class="border-t border-gray-100 pt-4 mt-4">
        <p class="text-sm font-semibold text-gray-700 mb-2">Responder con precio</p>
        <label for="quote-price" class="block text-xs font-medium text-gray-600 mb-1">
          Precio (CLP)
        </label>
        <div class="flex gap-2">
          <input id="quote-price" name="price" type="number" min="0" step="100" required
                 class="flex-1 rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm
                        focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold"
                 placeholder="Ej: 45000">
          <button type="submit" data-requires-network
                  class="btn-primary flex items-center gap-1.5 text-sm px-4 py-2">
            <span class="btn-price-text">Enviar</span>
            <svg class="hidden btn-price-spinner w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </button>
        </div>
      </form>
    ` : '';

    detailEl.innerHTML = `
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <h3 class="font-bold text-brand-blue text-base">${CotizacionesSection._esc(q.clientName ?? '—')}</h3>

        <div class="space-y-1.5 text-sm text-gray-600">
          <p><span class="font-medium text-gray-700">Producto:</span> ${CotizacionesSection._esc(q.product ?? '—')}</p>
          <p><span class="font-medium text-gray-700">Cantidad:</span> ${q.quantity ?? '—'}</p>
          <p><span class="font-medium text-gray-700">Tallas:</span> ${(q.sizes ?? []).join(', ') || '—'}</p>
          <p><span class="font-medium text-gray-700">Recibida:</span> ${CotizacionesSection._formatDate(q.receivedAt)}</p>
        </div>

        <!-- Contact info -->
        <div class="border-t border-gray-100 pt-3 space-y-1.5 text-sm text-gray-600">
          <p class="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-1">Contacto</p>
          <p><span class="font-medium text-gray-700">Email:</span> ${CotizacionesSection._esc(q.contactInfo?.email ?? '—')}</p>
          <p><span class="font-medium text-gray-700">Teléfono:</span> ${CotizacionesSection._esc(q.contactInfo?.phone ?? '—')}</p>
        </div>

        <!-- Notes -->
        ${q.notes ? `
          <div class="border-t border-gray-100 pt-3 text-sm text-gray-600">
            <p class="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-1">Notas de personalización</p>
            <p class="whitespace-pre-wrap">${CotizacionesSection._esc(q.notes)}</p>
          </div>
        ` : ''}

        <!-- Status history -->
        ${historyRows ? `
          <div class="border-t border-gray-100 pt-3">
            <p class="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-2">Historial</p>
            <div class="space-y-1.5">${historyRows}</div>
          </div>
        ` : ''}

        ${priceForm}
      </div>
    `;
  },

  // ── Price submit ───────────────────────────────────────────────────────────

  async _handlePriceSubmit(form) {
    const id    = form.dataset.quoteId;
    const price = parseFloat(form.querySelector('[name="price"]')?.value);
    if (!id || isNaN(price) || price < 0) return;

    const submitBtn = form.querySelector('[type="submit"]');
    const spinner   = form.querySelector('.btn-price-spinner');
    const btnText   = form.querySelector('.btn-price-text');

    if (submitBtn) submitBtn.disabled = true;
    if (spinner)   spinner.classList.remove('hidden');
    if (btnText)   btnText.textContent = 'Enviando...';

    // Snapshot previous state for rollback
    const prevQuote = CotizacionesSection._quotes.find(q => q.id === id);
    const prevStatus = prevQuote?.status;

    try {
      await Api.post(`/api/quotes/${id}/price`, { price });
      // Update local state
      if (prevQuote) { prevQuote.status = 'quoted'; prevQuote.price = price; }
      Toast.success('Cotización actualizada con el precio enviado.');
      CotizacionesSection._rerenderList();
      CotizacionesSection._renderDetail(id);
    } catch (err) {
      // Rollback view — state unchanged
      if (prevQuote && prevStatus) prevQuote.status = prevStatus;
      Toast.error(`Error al actualizar cotización: ${err.message ?? 'Error desconocido'}`);
      // Re-enable form
      if (submitBtn) submitBtn.disabled = false;
      if (spinner)   spinner.classList.add('hidden');
      if (btnText)   btnText.textContent = 'Enviar';
    }
  },

  // ── Helpers ────────────────────────────────────────────────────────────────

  _filtered() {
    const f = CotizacionesSection._activeFilter;
    if (f === 'all') return CotizacionesSection._quotes;
    return CotizacionesSection._quotes.filter(q => q.status === f);
  },

  _countByStatus() {
    const counts = { pending: 0, quoted: 0, accepted: 0, rejected: 0 };
    CotizacionesSection._quotes.forEach(q => {
      if (counts[q.status] !== undefined) counts[q.status]++;
    });
    return counts;
  },

  _formatStatus(status) {
    const map = {
      pending: 'Pendiente',
      quoted: 'Cotizada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
    };
    return map[status] ?? status ?? '—';
  },

  _statusClass(status) {
    const map = {
      pending:  'bg-amber-100 text-amber-700',
      quoted:   'bg-blue-100 text-blue-700',
      accepted: 'bg-emerald-100 text-emerald-700',
      rejected: 'bg-red-100 text-red-700',
    };
    return map[status] ?? 'bg-gray-100 text-gray-500';
  },

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

window.CotizacionesSection = CotizacionesSection;
