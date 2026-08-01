/**
 * sections/mockups.js — Sección Mockups
 * Admin Panel CronusFit
 *
 * Genera mockups de vista frontal y trasera para patrones aprobados.
 * Req: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

const MockupsSection = {
  /** @type {Array} Approved patterns */
  _patterns: [],
  /** @type {File|null} Selected design file */
  _designFile: null,

  async render() {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    MockupsSection._designFile = null;

    // Show loading
    appContent.innerHTML = `
      <div class="flex items-center justify-center min-h-64">
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
      const list = Array.isArray(data) ? data : (data?.patterns ?? []);
      MockupsSection._patterns = list;
    } catch (err) {
      Toast.error(`Error al cargar patrones: ${err.message ?? 'Error desconocido'}`);
      appContent.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <p>No se pudo cargar la lista de patrones.</p>
        </div>
      `;
      return;
    }

    MockupsSection._renderForm(appContent);
  },

  _renderForm(container) {
    const patternOptions = MockupsSection._patterns.length
      ? MockupsSection._patterns.map(p => `
          <option value="${MockupsSection._esc(p.id)}">
            ${MockupsSection._esc(p.name ?? p.garmentType ?? p.id)}
            (${MockupsSection._formatAgeGroup(p.ageGroup)} · ${MockupsSection._esc(p.size)})
          </option>
        `).join('')
      : '<option value="" disabled>No hay patrones disponibles — crea uno en la sección Patrones</option>';
    container.innerHTML = `
      <div class="max-w-2xl mx-auto">
        <h2 class="text-xl font-bold text-brand-blue mb-6">Generar mockup</h2>

        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <form id="mockup-form" novalidate>

            <!-- Pattern selector -->
            <div class="mb-5">
              <label for="mockup-pattern" class="block text-sm font-semibold text-gray-700 mb-1.5">
                Patrón aprobado <span class="text-red-500" aria-hidden="true">*</span>
              </label>
              <select id="mockup-pattern" name="patternId" required
                      class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold">
                <option value="">Seleccionar patrón...</option>
                ${patternOptions}
              </select>
              <span id="err-mockup-pattern" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
            </div>

            <!-- Zone selector -->
            <div class="mb-5">
              <label for="mockup-zone" class="block text-sm font-semibold text-gray-700 mb-1.5">
                Zona de colocación del diseño <span class="text-red-500" aria-hidden="true">*</span>
              </label>
              <select id="mockup-zone" name="zone" required
                      class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold">
                <option value="">Seleccionar zona...</option>
                <option value="chest">Pecho (frontal)</option>
                <option value="full-front">Frente completo</option>
                <option value="full-back">Espalda completa</option>
                <option value="left-sleeve">Manga izquierda</option>
                <option value="right-sleeve">Manga derecha</option>
              </select>
              <span id="err-mockup-zone" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
            </div>

            <!-- Design file upload -->
            <div class="mb-6">
              <p class="block text-sm font-semibold text-gray-700 mb-1.5">
                Archivo de diseño <span class="text-red-500" aria-hidden="true">*</span>
              </p>
              <p class="text-xs text-gray-500 mb-2">PNG, JPEG o SVG · máx. 10 MB</p>

              <!-- Dropzone -->
              <label for="mockup-file"
                     id="mockup-dropzone"
                     class="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed
                            border-gray-300 bg-gray-50 px-4 py-8 cursor-pointer
                            hover:border-brand-gold hover:bg-brand-gold/5 transition-colors">
                <svg class="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14
                           m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
                <span id="mockup-file-label" class="text-sm text-gray-500">
                  Haz clic o arrastra tu archivo aquí
                </span>
                <input id="mockup-file"
                       type="file"
                       name="designFile"
                       accept="image/png,image/jpeg,image/svg+xml"
                       class="sr-only"
                       aria-label="Seleccionar archivo de diseño">
              </label>

              <!-- Inline file validation error -->
              <span id="err-mockup-file" class="hidden text-xs text-red-600 mt-1.5 flex items-center gap-1" role="alert">
              </span>
            </div>

            <!-- Generate button -->
            <button type="submit"
                    id="btn-mockup-generate"
                    data-requires-network
                    class="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base">
              <span id="mockup-btn-text">Generar mockup</span>
              <svg id="mockup-spinner" class="hidden w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </button>

          </form>
        </div>

        <!-- Result area -->
        <div id="mockup-result" class="mt-6"></div>

      </div>
    `;

    // Wire file input
    const fileInput = document.getElementById('mockup-file');
    fileInput?.addEventListener('change', MockupsSection._handleFileChange);

    // Wire form submit
    document.getElementById('mockup-form')
      ?.addEventListener('submit', MockupsSection._handleSubmit);
  },

  // ── File validation ────────────────────────────────────────────────────────

  /**
   * Validates a File object. Returns {ok, reason}.
   * @param {File} file
   * @returns {{ok: boolean, reason?: string}}
   */
  validateDesignFile(file) {
    const VALID_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];
    const MAX_BYTES   = 10 * 1024 * 1024; // 10 MB

    if (!VALID_TYPES.includes(file.type)) {
      return {
        ok: false,
        reason: `Formato no permitido: ${file.type || 'desconocido'}. Use PNG, JPEG o SVG.`,
      };
    }
    if (file.size > MAX_BYTES) {
      return {
        ok: false,
        reason: `El archivo supera 10 MB (${(file.size / 1e6).toFixed(1)} MB). Reduce el tamaño.`,
      };
    }
    return { ok: true };
  },

  _handleFileChange(e) {
    const file = e.target.files?.[0];
    const errEl   = document.getElementById('err-mockup-file');
    const labelEl = document.getElementById('mockup-file-label');

    MockupsSection._designFile = null;

    if (!file) {
      if (labelEl) labelEl.textContent = 'Haz clic o arrastra tu archivo aquí';
      return;
    }

    const result = MockupsSection.validateDesignFile(file);

    if (!result.ok) {
      // Show inline error — do NOT call API
      if (errEl) { errEl.textContent = result.reason; errEl.classList.remove('hidden'); }
      if (labelEl) labelEl.textContent = 'Haz clic o arrastra tu archivo aquí';
      // Reset input so user can pick again
      e.target.value = '';
      return;
    }

    // Valid file
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
    if (labelEl) labelEl.textContent = `✓ ${file.name} (${(file.size / 1e6).toFixed(2)} MB)`;
    MockupsSection._designFile = file;
  },

  // ── Form submit ────────────────────────────────────────────────────────────

  async _handleSubmit(e) {
    e.preventDefault();

    // Clear previous field errors
    ['mockup-pattern', 'mockup-zone', 'mockup-file'].forEach(id => {
      const el = document.getElementById(`err-${id}`);
      if (el) { el.textContent = ''; el.classList.add('hidden'); }
    });

    const patternId = document.getElementById('mockup-pattern')?.value;
    const zone      = document.getElementById('mockup-zone')?.value;
    const file      = MockupsSection._designFile;

    let hasErrors = false;
    if (!patternId) {
      const el = document.getElementById('err-mockup-pattern');
      if (el) { el.textContent = 'Selecciona un patrón'; el.classList.remove('hidden'); }
      hasErrors = true;
    }
    if (!zone) {
      const el = document.getElementById('err-mockup-zone');
      if (el) { el.textContent = 'Selecciona una zona'; el.classList.remove('hidden'); }
      hasErrors = true;
    }
    if (!file) {
      const el = document.getElementById('err-mockup-file');
      if (el) { el.textContent = 'Sube un archivo de diseño válido'; el.classList.remove('hidden'); }
      hasErrors = true;
    }
    if (hasErrors) return;

    const btn     = document.getElementById('btn-mockup-generate');
    const spinner = document.getElementById('mockup-spinner');
    const btnText = document.getElementById('mockup-btn-text');

    if (btn)     btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Subiendo diseño...';

    // Convert file to base64 for upload
    let designFileBase64;
    try {
      designFileBase64 = await MockupsSection._fileToBase64(file);
    } catch {
      Toast.error('No se pudo leer el archivo de diseño.');
      if (btn)     btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
      if (btnText) btnText.textContent = 'Generar mockup';
      return;
    }

    try {
      // PASO 1: Subir archivo de diseño a S3
      let designFileKey;
      try {
        const uploadResult = await Api.post('/api/designs/upload', {
          fileName: file.name,
          fileType: file.type,
          fileContent: designFileBase64,
        });
        if (!uploadResult || !uploadResult.designFileKey) {
          throw new Error('El servidor no devolvió la clave del archivo');
        }
        designFileKey = uploadResult.designFileKey;
      } catch (uploadErr) {
        const msg = uploadErr?.message ?? uploadErr?.error ?? 'Error desconocido al subir diseño';
        Toast.error(`Error al subir diseño: ${msg}`);
        console.error('[Mockup] Upload error:', uploadErr);
        return;
      }

      // PASO 2: Generar mockup usando la referencia S3
      if (btnText) btnText.textContent = 'Generando mockup...';

      // Obtener garmentType del patrón seleccionado
      const selectedPattern = MockupsSection._patterns.find(p => p.id === patternId);
      const garmentType = selectedPattern?.garmentType ?? 'camiseta';

      const result = await Api.post('/api/mockups/generate', {
        patternId,
        garmentType,
        placementZone: zone,
        designFileKey,
      });

      // Render result images — API returns frontImageUrl / backImageUrl
      const mappedResult = {
        frontUrl: result.frontImageUrl ?? result.frontUrl,
        backUrl:  result.backImageUrl  ?? result.backUrl,
      };
      MockupsSection._renderResult(mappedResult);
      Toast.success('Mockup generado correctamente. Estado: Pendiente de aprobación.');
    } catch (err) {
      const msg = err?.message ?? err?.error ?? 'Error desconocido';
      Toast.error(`Error al generar mockup: ${msg}`);
      console.error('[Mockup] Generate error:', err);
      // Keep form values intact — only re-enable button
    } finally {
      if (btn)     btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
      if (btnText) btnText.textContent = 'Generar mockup';
    }
  },

  _renderResult(result) {
    const resultEl = document.getElementById('mockup-result');
    if (!resultEl || !result) return;

    resultEl.innerHTML = `
      <div class="bg-white rounded-2xl shadow-sm border border-emerald-200 p-6">
        <h3 class="font-bold text-brand-blue text-base mb-4">
          Mockup generado — Pendiente de aprobación
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Vista frontal</p>
            <img src="${MockupsSection._esc(result.frontUrl)}"
                 alt="Vista frontal del mockup"
                 class="w-full rounded-xl border border-gray-200 object-contain aspect-square bg-gray-50">
          </div>
          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Vista trasera</p>
            <img src="${MockupsSection._esc(result.backUrl)}"
                 alt="Vista trasera del mockup"
                 class="w-full rounded-xl border border-gray-200 object-contain aspect-square bg-gray-50">
          </div>
        </div>
      </div>
    `;
  },

  // ── Helpers ────────────────────────────────────────────────────────────────

  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(file);
    });
  },

  _formatAgeGroup(ag) {
    return ag === 'children' ? 'Infantil' : ag === 'adult' ? 'Adulto' : (ag ?? '');
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

window.MockupsSection = MockupsSection;
