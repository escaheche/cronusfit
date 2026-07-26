/**
 * sections/patrones.js — Sección Patrones
 * Admin Panel CronusFit
 *
 * Muestra el listado de patrones, formulario de creación, y descarga PDF via jsPDF.
 * Req: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

const PatronesSection = {
  /** @type {Array} Local copy of patterns from the API */
  _patterns: [],

  async render() {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    // Show loading spinner
    appContent.innerHTML = `
      <div class="flex items-center justify-center min-h-64" aria-label="Cargando patrones...">
        <div class="flex flex-col items-center gap-3 text-gray-400">
          <svg class="w-10 h-10 animate-spin text-brand-gold" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span class="text-sm">Cargando patrones...</span>
        </div>
      </div>
    `;

    try {
      const data = await Api.get('/api/patterns');
      // Sort by createdAt descending (most recent first)
      PatronesSection._patterns = (data || []).sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
    } catch (err) {
      Toast.error(`Error al cargar patrones: ${err.message ?? 'Error desconocido'}`);
      appContent.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <p class="text-base">No se pudo cargar la lista de patrones.</p>
        </div>
      `;
      return;
    }

    PatronesSection._renderContent(appContent);
  },

  _renderContent(container) {
    container.innerHTML = `
      <div class="max-w-6xl mx-auto">

        <!-- Section header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 class="text-xl font-bold text-brand-blue">Patrones de corte</h2>
            <p class="text-gray-500 text-sm mt-0.5">${PatronesSection._patterns.length} patrón(es) registrado(s)</p>
          </div>
          <button id="btn-nuevo-patron"
                  data-requires-network
                  class="btn-primary flex items-center gap-2 self-start sm:self-auto">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            Nuevo patrón
          </button>
        </div>

        <!-- Inline creation form (hidden by default) -->
        <div id="patron-form-container" class="hidden mb-8"></div>

        <!-- Patterns table -->
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          ${PatronesSection._renderTable()}
        </div>

      </div>
    `;

    // Wire up "Nuevo patrón" button
    document.getElementById('btn-nuevo-patron')
      ?.addEventListener('click', PatronesSection._showForm);
  },

  _renderTable() {
    if (PatronesSection._patterns.length === 0) {
      return `
        <div class="text-center py-16 text-gray-400">
          <svg class="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0121 9.414V19a2 2 0 01-2 2z"/>
          </svg>
          <p class="text-base font-medium">No hay patrones registrados</p>
          <p class="text-sm mt-1">Crea el primer patrón usando el botón "Nuevo patrón"</p>
        </div>
      `;
    }

    const rows = PatronesSection._patterns.map(p => `
      <tr class="border-t border-gray-100 hover:bg-gray-50 transition-colors">
        <td class="px-4 py-3.5 text-sm font-medium text-gray-900">${PatronesSection._esc(p.name ?? p.garmentType ?? '—')}</td>
        <td class="px-4 py-3.5 text-sm text-gray-600">${PatronesSection._esc(p.garmentType ?? '—')}</td>
        <td class="px-4 py-3.5 text-sm text-gray-600">${PatronesSection._formatAgeGroup(p.ageGroup)}</td>
        <td class="px-4 py-3.5 text-sm text-gray-600">${PatronesSection._esc(p.size ?? '—')}</td>
        <td class="px-4 py-3.5">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                       ${PatronesSection._statusClass(p.status)}">
            ${PatronesSection._formatStatus(p.status)}
          </span>
        </td>
        <td class="px-4 py-3.5 text-sm text-gray-500">${PatronesSection._formatDate(p.createdAt)}</td>
        <td class="px-4 py-3.5 text-right">
          ${p.status === 'approved' && p.svgUrl
            ? `<button class="btn-download-pdf text-xs text-brand-blue font-medium hover:text-brand-gold transition-colors"
                      data-pattern-id="${PatronesSection._esc(p.id)}"
                      data-presigned-url="${PatronesSection._esc(p.svgUrl)}"
                      data-requires-network>
                Descargar PDF
              </button>`
            : '<span class="text-xs text-gray-300">—</span>'
          }
        </td>
      </tr>
    `).join('');

    return `
      <div class="overflow-x-auto">
        <table class="w-full" aria-label="Lista de patrones">
          <thead>
            <tr class="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <th class="px-4 py-3 text-left">Nombre</th>
              <th class="px-4 py-3 text-left">Tipo de prenda</th>
              <th class="px-4 py-3 text-left">Grupo etario</th>
              <th class="px-4 py-3 text-left">Talla</th>
              <th class="px-4 py-3 text-left">Estado</th>
              <th class="px-4 py-3 text-left">Fecha</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  },

  _showForm() {
    const container = document.getElementById('patron-form-container');
    if (!container) return;

    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="bg-white rounded-2xl shadow-sm border border-brand-gold/30 p-6">
        <h3 class="text-brand-blue font-bold text-lg mb-5">Nuevo patrón</h3>

        <form id="patron-create-form" novalidate>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">

            <!-- garmentType -->
            <div>
              <label for="patron-garmentType" class="block text-sm font-semibold text-gray-700 mb-1.5">
                Tipo de prenda <span class="text-red-500" aria-hidden="true">*</span>
              </label>
              <select id="patron-garmentType" name="garmentType" required
                      class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold">
                <option value="">Seleccionar...</option>
                <option value="jersey">Jersey / Camiseta</option>
                <option value="shorts">Short</option>
                <option value="tracksuit_top">Chaqueta deportiva</option>
                <option value="tracksuit_bottom">Pantalón deportivo</option>
                <option value="polo">Polo</option>
                <option value="hoodie">Hoodie</option>
              </select>
              <span id="err-garmentType" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
            </div>

            <!-- ageGroup -->
            <div>
              <label for="patron-ageGroup" class="block text-sm font-semibold text-gray-700 mb-1.5">
                Grupo etario <span class="text-red-500" aria-hidden="true">*</span>
              </label>
              <select id="patron-ageGroup" name="ageGroup" required
                      class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold">
                <option value="">Seleccionar...</option>
                <option value="children">Infantil</option>
                <option value="adult">Adulto</option>
              </select>
              <span id="err-ageGroup" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
            </div>

            <!-- size -->
            <div>
              <label for="patron-size" class="block text-sm font-semibold text-gray-700 mb-1.5">
                Talla <span class="text-red-500" aria-hidden="true">*</span>
              </label>
              <select id="patron-size" name="size" required
                      class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold">
                <option value="">Seleccionar...</option>
                <!-- Adult sizes -->
                <optgroup label="Adulto">
                  <option value="XS">XS</option>
                  <option value="S">S</option>
                  <option value="M">M</option>
                  <option value="L">L</option>
                  <option value="XL">XL</option>
                  <option value="2XL">2XL</option>
                  <option value="3XL">3XL</option>
                  <option value="4XL">4XL</option>
                  <option value="5XL">5XL</option>
                  <option value="6XL">6XL</option>
                </optgroup>
                <!-- Children sizes -->
                <optgroup label="Infantil">
                  <option value="2T">2T</option>
                  <option value="3T">3T</option>
                  <option value="4T">4T</option>
                  <option value="6">6</option>
                  <option value="8">8</option>
                  <option value="10">10</option>
                  <option value="12">12</option>
                  <option value="14">14</option>
                  <option value="16">16</option>
                </optgroup>
              </select>
              <span id="err-size" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
            </div>

          </div>

          <!-- Measurements section -->
          <div class="mt-5">
            <p class="text-sm font-semibold text-gray-700 mb-3">
              Medidas (en milímetros) <span class="text-red-500" aria-hidden="true">*</span>
            </p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">

              <div>
                <label for="patron-chestWidth" class="block text-xs font-medium text-gray-600 mb-1">
                  Ancho de pecho
                </label>
                <input id="patron-chestWidth" name="chestWidth" type="number"
                       min="200" max="1000" step="1" required
                       class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm
                              focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold"
                       placeholder="450">
                <span id="err-chestWidth" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
              </div>

              <div>
                <label for="patron-bodyLength" class="block text-xs font-medium text-gray-600 mb-1">
                  Largo de cuerpo
                </label>
                <input id="patron-bodyLength" name="bodyLength" type="number"
                       min="300" max="1200" step="1" required
                       class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm
                              focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold"
                       placeholder="680">
                <span id="err-bodyLength" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
              </div>

              <div>
                <label for="patron-shoulderWidth" class="block text-xs font-medium text-gray-600 mb-1">
                  Ancho de hombro
                </label>
                <input id="patron-shoulderWidth" name="shoulderWidth" type="number"
                       min="100" max="600" step="1" required
                       class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm
                              focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold"
                       placeholder="380">
                <span id="err-shoulderWidth" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
              </div>

              <div>
                <label for="patron-sleeveLength" class="block text-xs font-medium text-gray-600 mb-1">
                  Largo de manga
                </label>
                <input id="patron-sleeveLength" name="sleeveLength" type="number"
                       min="0" max="800" step="1" required
                       class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm
                              focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold"
                       placeholder="220">
                <span id="err-sleeveLength" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
              </div>

            </div>
          </div>

          <!-- Form actions -->
          <div class="flex items-center gap-3 mt-6">
            <button type="submit"
                    id="btn-patron-submit"
                    data-requires-network
                    class="btn-primary flex items-center gap-2">
              <span id="patron-submit-text">Generar patrón</span>
              <svg id="patron-submit-spinner"
                   class="hidden w-4 h-4 animate-spin"
                   fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </button>
            <button type="button"
                    id="btn-patron-cancel"
                    class="px-4 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-medium
                           hover:border-brand-blue hover:text-brand-blue transition-colors text-sm">
              Cancelar
            </button>
          </div>

        </form>
      </div>
    `;

    // Wire up form events
    document.getElementById('patron-create-form')
      ?.addEventListener('submit', PatronesSection._handleCreateSubmit);
    document.getElementById('btn-patron-cancel')
      ?.addEventListener('click', () => {
        const fc = document.getElementById('patron-form-container');
        if (fc) { fc.innerHTML = ''; fc.classList.add('hidden'); }
      });

    // Focus first field
    document.getElementById('patron-garmentType')?.focus();
  },

  async _handleCreateSubmit(e) {
    e.preventDefault();

    // Clear previous field errors
    ['garmentType', 'ageGroup', 'size', 'chestWidth', 'bodyLength', 'shoulderWidth', 'sleeveLength']
      .forEach(f => PatronesSection._clearFieldError(f));

    const garmentType    = document.getElementById('patron-garmentType')?.value;
    const ageGroup       = document.getElementById('patron-ageGroup')?.value;
    const size           = document.getElementById('patron-size')?.value;
    const chestWidth     = parseInt(document.getElementById('patron-chestWidth')?.value, 10);
    const bodyLength     = parseInt(document.getElementById('patron-bodyLength')?.value, 10);
    const shoulderWidth  = parseInt(document.getElementById('patron-shoulderWidth')?.value, 10);
    const sleeveLength   = parseInt(document.getElementById('patron-sleeveLength')?.value, 10);

    // Client-side required validation
    let hasErrors = false;
    if (!garmentType) { PatronesSection._setFieldError('garmentType', 'Selecciona un tipo de prenda'); hasErrors = true; }
    if (!ageGroup)    { PatronesSection._setFieldError('ageGroup', 'Selecciona un grupo etario'); hasErrors = true; }
    if (!size)        { PatronesSection._setFieldError('size', 'Selecciona una talla'); hasErrors = true; }
    if (!chestWidth)  { PatronesSection._setFieldError('chestWidth', 'Ingresa el ancho de pecho'); hasErrors = true; }
    if (!bodyLength)  { PatronesSection._setFieldError('bodyLength', 'Ingresa el largo de cuerpo'); hasErrors = true; }
    if (!shoulderWidth){ PatronesSection._setFieldError('shoulderWidth', 'Ingresa el ancho de hombro'); hasErrors = true; }
    if (isNaN(sleeveLength)) { PatronesSection._setFieldError('sleeveLength', 'Ingresa el largo de manga'); hasErrors = true; }
    if (hasErrors) return;

    const submitBtn = document.getElementById('btn-patron-submit');
    const spinner   = document.getElementById('patron-submit-spinner');
    const btnText   = document.getElementById('patron-submit-text');

    if (submitBtn) submitBtn.disabled = true;
    if (spinner)   spinner.classList.remove('hidden');
    if (btnText)   btnText.textContent = 'Generando...';

    try {
      await Api.post('/api/patterns/generate', {
        garmentType,
        ageGroup,
        size,
        measurements: { chestWidth, bodyLength, shoulderWidth, sleeveLength },
      });
      Toast.success('Patrón generado correctamente. Aparecerá en la lista pronto.');
      // Close form and reload list
      const fc = document.getElementById('patron-form-container');
      if (fc) { fc.innerHTML = ''; fc.classList.add('hidden'); }
      PatronesSection.render();
    } catch (err) {
      // Map API validation errors to fields if available
      if (err.fields && typeof err.fields === 'object') {
        Object.entries(err.fields).forEach(([field, msg]) => {
          PatronesSection._setFieldError(field, msg);
        });
      } else {
        Toast.error(`Error al crear patrón: ${err.message ?? 'Error desconocido'}`);
      }
      // Re-enable form
      if (submitBtn) submitBtn.disabled = false;
      if (spinner)   spinner.classList.add('hidden');
      if (btnText)   btnText.textContent = 'Generar patrón';
    }
  },

  // ── PDF download ───────────────────────────────────────────────────────────

  /**
   * Fetch the SVG from a presigned URL, then generate a local PDF using jsPDF.
   * If the SVG fetch fails, shows Toast.error without creating a partial file.
   *
   * @param {string} patternId
   * @param {string} presignedUrl
   */
  async downloadPatternPDF(patternId, presignedUrl) {
    let svgText;
    try {
      const res = await fetch(presignedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      svgText = await res.text();
    } catch (err) {
      Toast.error(`No se pudo descargar el SVG del patrón: ${err.message}`);
      return; // Abort — no partial file
    }

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
      const svgElement = svgDoc.documentElement;

      await doc.svg(svgElement, { x: 10, y: 10, width: 190, height: 277 });
      doc.save(`patron-${patternId}.pdf`);
    } catch (err) {
      Toast.error(`Error al generar el PDF: ${err.message}`);
    }
  },

  // ── Event delegation for download buttons ─────────────────────────────────

  _bindTableEvents() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-download-pdf');
      if (!btn) return;
      const { patternId, presignedUrl } = btn.dataset;
      if (patternId && presignedUrl) {
        PatronesSection.downloadPatternPDF(patternId, presignedUrl);
      }
    });
  },

  // ── Helpers ────────────────────────────────────────────────────────────────

  _formatAgeGroup(ag) {
    const map = { children: 'Infantil', adult: 'Adulto' };
    return map[ag] ?? ag ?? '—';
  },

  _formatStatus(status) {
    const map = { draft: 'Borrador', approved: 'Aprobado', rejected: 'Rechazado' };
    return map[status] ?? status ?? '—';
  },

  _statusClass(status) {
    const map = {
      draft:    'bg-gray-100 text-gray-600',
      approved: 'bg-emerald-100 text-emerald-700',
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

  _setFieldError(field, msg) {
    const el = document.getElementById(`err-${field}`);
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  },

  _clearFieldError(field) {
    const el = document.getElementById(`err-${field}`);
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  },
};

// Bind table event delegation once
PatronesSection._bindTableEvents();

window.PatronesSection = PatronesSection;
