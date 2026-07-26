/**
 * sections/publicaciones.js — Sección Publicaciones
 * Admin Panel CronusFit
 *
 * Publicar / despublicar mockups aprobados en el sitio de exhibición.
 * Req: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

const PublicacionesSection = {
  /** @type {Array} Local approved mockups */
  _items: [],
  /** @type {string} Active filter: 'all' | 'published' | 'unpublished' */
  _activeFilter: 'all',

  async render() {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    PublicacionesSection._activeFilter = 'all';

    // Show loading
    appContent.innerHTML = `
      <div class="flex items-center justify-center min-h-64">
        <div class="flex flex-col items-center gap-3 text-gray-400">
          <svg class="w-10 h-10 animate-spin text-brand-gold" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span class="text-sm">Cargando publicaciones...</span>
        </div>
      </div>
    `;

    try {
      const data = await Api.get('/api/mockups?status=approved');
      PublicacionesSection._items = data || [];
    } catch (err) {
      Toast.error(`Error al cargar publicaciones: ${err.message ?? 'Error desconocido'}`);
      appContent.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <p>No se pudo cargar la lista de publicaciones.</p>
        </div>
      `;
      return;
    }

    PublicacionesSection._renderAll(appContent);
  },

  _renderAll(container) {
    container.innerHTML = `
      <div class="max-w-5xl mx-auto">
        <h2 class="text-xl font-bold text-brand-blue mb-5">Publicaciones</h2>

        <!-- Filter buttons -->
        <div class="flex flex-wrap gap-2 mb-5" role="group" aria-label="Filtrar por estado de publicación">
          ${[
            ['all', 'Todos'],
            ['published', 'Publicados'],
            ['unpublished', 'No publicados'],
          ].map(([val, label]) => `
            <button class="pub-filter-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors
                           ${PublicacionesSection._activeFilter === val
                              ? 'bg-brand-blue text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
                    data-filter="${val}">
              ${label}
            </button>
          `).join('')}
        </div>

        <!-- Grid -->
        <div id="pub-grid">
          ${PublicacionesSection._renderGrid()}
        </div>
      </div>
    `;

    // Wire filter buttons
    container.querySelectorAll('.pub-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        PublicacionesSection._activeFilter = btn.dataset.filter;
        // Update button styles
        container.querySelectorAll('.pub-filter-btn').forEach(b => {
          const active = b.dataset.filter === PublicacionesSection._activeFilter;
          b.className = `pub-filter-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            active ? 'bg-brand-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`;
        });
        PublicacionesSection._rerenderGrid();
      });
    });

    // Wire publish/unpublish via event delegation
    container.addEventListener('click', PublicacionesSection._handleClick);
  },

  _renderGrid() {
    const items = PublicacionesSection._filtered();

    if (!items.length) {
      return `
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-gray-400">
          <p class="text-base font-medium">No hay mockups con este filtro</p>
        </div>
      `;
    }

    return `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        ${items.map(item => PublicacionesSection._renderCard(item)).join('')}
      </div>
    `;
  },

  _renderCard(item) {
    const published = item.published === true;
    const lastAction = item.publishedAt
      ? `Últ. acción: ${PublicacionesSection._formatDate(item.publishedAt)}`
      : `Creado: ${PublicacionesSection._formatDate(item.createdAt)}`;

    return `
      <div id="pub-card-${PublicacionesSection._esc(item.id)}"
           class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

        <!-- Thumbnails -->
        <div class="grid grid-cols-2 gap-0.5 bg-gray-100">
          <img src="${PublicacionesSection._esc(item.frontUrl)}"
               alt="Vista frontal de ${PublicacionesSection._esc(item.patternName ?? item.id)}"
               loading="lazy"
               class="w-full aspect-square object-cover bg-gray-50">
          <img src="${PublicacionesSection._esc(item.backUrl)}"
               alt="Vista trasera de ${PublicacionesSection._esc(item.patternName ?? item.id)}"
               loading="lazy"
               class="w-full aspect-square object-cover bg-gray-50">
        </div>

        <!-- Info -->
        <div class="p-4">
          <p class="font-semibold text-brand-blue text-sm truncate mb-1">
            ${PublicacionesSection._esc(item.patternName ?? item.garmentType ?? '—')}
          </p>
          <div class="flex items-center justify-between mb-3">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                         ${published ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}">
              ${published ? 'Publicado' : 'No publicado'}
            </span>
            <span class="text-xs text-gray-400">${lastAction}</span>
          </div>

          <!-- Actions -->
          <div class="flex gap-2">
            ${published
              ? `<button class="btn-unpublish btn-danger w-full text-sm py-2 flex items-center justify-center gap-1.5"
                          data-item-id="${PublicacionesSection._esc(item.id)}"
                          data-requires-network>
                  <span>Despublicar</span>
                  <svg class="btn-unpublish-spinner hidden w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </button>`
              : `<button class="btn-publish btn-primary w-full text-sm py-2 flex items-center justify-center gap-1.5"
                          data-item-id="${PublicacionesSection._esc(item.id)}"
                          data-requires-network>
                  <span>Publicar</span>
                  <svg class="btn-publish-spinner hidden w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </button>`
            }
          </div>
        </div>
      </div>
    `;
  },

  _rerenderGrid() {
    const gridEl = document.getElementById('pub-grid');
    if (gridEl) gridEl.innerHTML = PublicacionesSection._renderGrid();
  },

  // ── Event handling ─────────────────────────────────────────────────────────

  _handleClick(e) {
    const publishBtn   = e.target.closest('.btn-publish');
    const unpublishBtn = e.target.closest('.btn-unpublish');

    if (publishBtn) {
      PublicacionesSection._handlePublish(publishBtn.dataset.itemId, publishBtn);
    } else if (unpublishBtn) {
      PublicacionesSection._handleUnpublish(unpublishBtn.dataset.itemId, unpublishBtn);
    }
  },

  async _handlePublish(id, btn) {
    if (!id) return;

    // Client-side validation: only approved mockups can be published
    const item = PublicacionesSection._items.find(i => i.id === id);
    if (!item) return;

    if (item.status !== 'approved') {
      Toast.error('Solo los mockups aprobados pueden publicarse.');
      return; // Cancel — no API call
    }

    const spinner = btn.querySelector('.btn-publish-spinner');
    btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');

    try {
      await Api.put(`/products/${id}/publish`);
      item.published  = true;
      item.publishedAt = new Date().toISOString();
      Toast.success('Mockup publicado correctamente.');
      PublicacionesSection._rerenderGrid();
    } catch (err) {
      // Keep previous state
      Toast.error(`Error al publicar: ${err.message ?? 'Error desconocido'}`);
      btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
    }
  },

  async _handleUnpublish(id, btn) {
    if (!id) return;

    const item = PublicacionesSection._items.find(i => i.id === id);
    if (!item) return;

    const spinner = btn.querySelector('.btn-unpublish-spinner');
    btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');

    try {
      await Api.put(`/products/${id}/unpublish`);
      item.published  = false;
      item.publishedAt = new Date().toISOString();
      Toast.success('Mockup despublicado correctamente.');
      PublicacionesSection._rerenderGrid();
    } catch (err) {
      // Keep previous state
      Toast.error(`Error al despublicar: ${err.message ?? 'Error desconocido'}`);
      btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
    }
  },

  // ── Helpers ────────────────────────────────────────────────────────────────

  _filtered() {
    const f = PublicacionesSection._activeFilter;
    if (f === 'published')   return PublicacionesSection._items.filter(i => i.published === true);
    if (f === 'unpublished') return PublicacionesSection._items.filter(i => i.published !== true);
    return PublicacionesSection._items;
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

window.PublicacionesSection = PublicacionesSection;
