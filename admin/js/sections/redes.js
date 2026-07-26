/**
 * sections/redes.js — Sección Redes Sociales
 * Admin Panel CronusFit
 *
 * Revisar y descargar contenido generado automáticamente para Instagram y Facebook.
 * Req: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

const RedesSection = {
  /** @type {Array} Local social content items */
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
          <span class="text-sm">Cargando contenido para redes...</span>
        </div>
      </div>
    `;

    try {
      const data = await Api.get('/api/social-content');
      // Sort descending: most recent first
      RedesSection._items = (data || []).sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
    } catch (err) {
      Toast.error(`Error al cargar contenido de redes: ${err.message ?? 'Error desconocido'}`);
      appContent.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <p>No se pudo cargar el contenido para redes sociales.</p>
        </div>
      `;
      return;
    }

    RedesSection._renderContent(appContent);
  },

  _renderContent(container) {
    // Empty state
    if (!RedesSection._items.length) {
      container.innerHTML = `
        <div class="max-w-2xl mx-auto">
          <h2 class="text-xl font-bold text-brand-blue mb-6">Redes Sociales</h2>
          <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
            <svg class="w-14 h-14 mx-auto mb-4 opacity-25" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342
                       m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316
                       m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684
                       3 3 0 00-5.368-2.684z"/>
            </svg>
            <p class="text-base font-medium mb-2">No hay contenido para redes sociales</p>
            <p class="text-sm mb-5">El contenido se genera automáticamente cuando publicas un mockup.</p>
            <a href="#publicaciones"
               class="inline-flex items-center gap-2 btn-primary px-5 py-2 text-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M17 8l4 4m0 0l-4 4m4-4H3"/>
              </svg>
              Ir a Publicaciones
            </a>
          </div>
        </div>
      `;
      return;
    }

    const cards = RedesSection._items.map(item => RedesSection._renderCard(item)).join('');

    container.innerHTML = `
      <div class="max-w-4xl mx-auto">
        <h2 class="text-xl font-bold text-brand-blue mb-6">Redes Sociales</h2>
        <div id="redes-list" class="space-y-6">
          ${cards}
        </div>
      </div>
    `;

    // Wire copy & retry via event delegation
    container.addEventListener('click', RedesSection._handleClick);
  },

  _renderCard(item) {
    const hasError = item.status === 'error';
    const borderClass = hasError ? 'border-red-200' : 'border-gray-100';

    return `
      <article id="redes-card-${RedesSection._esc(item.id)}"
               class="bg-white rounded-2xl shadow-sm border ${borderClass} overflow-hidden">
        <div class="p-5 sm:p-6">

          <!-- Header -->
          <div class="flex items-center justify-between gap-3 mb-5">
            <p class="text-sm text-gray-500">${RedesSection._formatDate(item.createdAt)}</p>
            <div class="flex items-center gap-2">
              ${hasError
                ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                    Error de generación
                  </span>
                  <button class="btn-retry text-xs font-medium text-brand-blue hover:text-brand-gold transition-colors
                                 underline underline-offset-2"
                          data-item-id="${RedesSection._esc(item.id)}"
                          data-requires-network>
                    Reintentar
                    <svg class="btn-retry-spinner hidden inline w-3.5 h-3.5 ml-1 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  </button>`
                : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                    Listo
                  </span>`
              }
            </div>
          </div>

          <!-- Images -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">

            <!-- Instagram -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Instagram (1080×1080)
                </p>
                <button class="btn-download-ig text-xs text-brand-blue font-medium hover:text-brand-gold transition-colors"
                        data-url="${RedesSection._esc(item.instagramUrl)}"
                        data-requires-network>
                  ↓ Descargar
                </button>
              </div>
              <img src="${RedesSection._esc(item.instagramUrl)}"
                   alt="Imagen Instagram para contenido del ${RedesSection._formatDate(item.createdAt)}"
                   loading="lazy"
                   class="w-full rounded-xl border border-gray-200 object-cover aspect-square bg-gray-50">
            </div>

            <!-- Facebook -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Facebook (1200×630)
                </p>
                <button class="btn-download-fb text-xs text-brand-blue font-medium hover:text-brand-gold transition-colors"
                        data-url="${RedesSection._esc(item.facebookUrl)}"
                        data-requires-network>
                  ↓ Descargar
                </button>
              </div>
              <img src="${RedesSection._esc(item.facebookUrl)}"
                   alt="Imagen Facebook para contenido del ${RedesSection._formatDate(item.createdAt)}"
                   loading="lazy"
                   class="w-full rounded-xl border border-gray-200 object-cover bg-gray-50"
                   style="aspect-ratio: 1200/630;">
            </div>

          </div>

          <!-- Caption -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Caption sugerido
              </p>
              <button class="btn-copy-caption text-xs text-brand-blue font-medium hover:text-brand-gold transition-colors"
                      data-item-id="${RedesSection._esc(item.id)}">
                📋 Copiar
              </button>
            </div>
            <textarea readonly
                      data-caption="${RedesSection._esc(item.caption)}"
                      rows="3"
                      class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm
                             text-gray-700 resize-none focus:outline-none cursor-default"
                      aria-label="Caption sugerido para redes sociales">${RedesSection._esc(item.caption)}</textarea>
          </div>

        </div>
      </article>
    `;
  },

  // ── Event handling ─────────────────────────────────────────────────────────

  _handleClick(e) {
    const igBtn     = e.target.closest('.btn-download-ig');
    const fbBtn     = e.target.closest('.btn-download-fb');
    const copyBtn   = e.target.closest('.btn-copy-caption');
    const retryBtn  = e.target.closest('.btn-retry');

    if (igBtn) {
      const url = igBtn.dataset.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } else if (fbBtn) {
      const url = fbBtn.dataset.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } else if (copyBtn) {
      const id   = copyBtn.dataset.itemId;
      const item = RedesSection._items.find(i => i.id === id);
      if (item?.caption) {
        RedesSection._copyCaption(item.caption);
      }
    } else if (retryBtn) {
      const id = retryBtn.dataset.itemId;
      if (id) RedesSection._handleRetry(id, retryBtn);
    }
  },

  async _copyCaption(text) {
    try {
      await navigator.clipboard.writeText(text);
      Toast.success('Caption copiado al portapapeles.');
    } catch {
      Toast.error('No se pudo copiar el caption. Intenta seleccionarlo manualmente.');
    }
  },

  async _handleRetry(id, btn) {
    const spinner = btn.querySelector('.btn-retry-spinner');
    btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');

    try {
      await Api.post(`/api/social-content/${id}/retry`);
      Toast.success('Regeneración iniciada correctamente. El contenido se actualizará pronto.');
    } catch (err) {
      Toast.error(`Error al reintentar: ${err.message ?? 'Error desconocido'}`);
    } finally {
      btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
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

window.RedesSection = RedesSection;
