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
  
  /** @type {Object|null} Extracted PDF data (garmentType, ageGroup, detectedSizes) */
  _pdfData: null,

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
      const response = await Api.get('/api/patterns');
      // The API returns { patterns: [...], count: number }
      const data = response?.patterns || [];
      // Sort by createdAt descending (most recent first)
      PatronesSection._patterns = data.sort(
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
          
          <!-- PDF Upload Section (appears first) -->
          <div class="mb-6">
            <p class="text-sm font-semibold text-gray-700 mb-1.5">
              Archivo de referencia <span class="text-gray-400 text-xs font-normal">(opcional)</span>
            </p>
            <p class="text-xs text-gray-500 mb-3">
              <strong>Opción 1 - PDF con medidas:</strong> Sube un PDF del patrón y el sistema extraerá automáticamente el tipo de prenda, grupo etario, tallas y medidas.<br>
              <strong>Opción 2 - Imagen de referencia:</strong> Sube una foto JPG/JPEG como guía visual y completa los datos manualmente.
            </p>
            <div class="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-brand-gold transition-colors">
              <input type="file" id="patron-referenceImage" name="referenceImage"
                     accept=".jpg,.jpeg,.pdf"
                     class="hidden">
              <label for="patron-referenceImage" class="cursor-pointer">
                <svg class="w-10 h-10 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
                <p class="text-sm text-gray-600 font-medium">Haz clic para seleccionar archivo</p>
                <p class="text-xs text-gray-400 mt-1">JPG, JPEG o PDF (máx 25 MB)</p>
              </label>
              <div id="reference-file-name" class="hidden mt-2 text-sm text-brand-blue font-medium"></div>
            </div>
            <span id="err-referenceImage" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
          </div>

          <!-- Manual Entry Section (hidden when PDF is uploaded) -->
          <div id="manual-entry-section">
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
                  <option value="camiseta">Camiseta / Polera</option>
                  <option value="short">Short deportivo</option>
                  <option value="legging">Legging / Calza</option>
                  <option value="sudadera">Sudadera / Buzo</option>
                  <option value="tank-top">Polera sin mangas</option>
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
                  <option value="children">Infantil (2T-16)</option>
                  <option value="adult">Adulto (XS-6XL)</option>
                </select>
                <span id="err-ageGroup" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
              </div>

              <!-- size -->
              <div>
                <label for="patron-size" class="block text-sm font-semibold text-gray-700 mb-1.5">
                  Talla <span class="text-red-500" aria-hidden="true">*</span>
                </label>
                <select id="patron-size" name="size" required disabled
                        class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm
                               focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold
                               disabled:opacity-50 disabled:cursor-not-allowed">
                  <option value="">Primero selecciona grupo etario...</option>
                </select>
                <span id="err-size" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
              </div>

            </div>

            <!-- Measurements section (dynamic based on garment type) -->
            <div class="mt-5">
              <p class="text-sm font-semibold text-gray-700 mb-3">
                Medidas corporales <span class="text-gray-400 font-normal text-xs">(en centímetros)</span> <span class="text-red-500" aria-hidden="true">*</span>
              </p>
              <div id="measurements-container" class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <!-- Dynamic fields will be inserted here -->
                <p class="col-span-full text-sm text-gray-400 italic">
                  Selecciona un tipo de prenda para ver los campos de medidas
                </p>
              </div>
            </div>
          </div>

          <!-- PDF Analysis Section (hidden by default, shown when PDF is uploaded) -->
          <div id="pdf-analysis-section" class="hidden">
            <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
              <div class="flex items-start gap-3">
                <svg class="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <div class="flex-1">
                  <p class="text-sm font-semibold text-blue-900 mb-1">PDF detectado</p>
                  <p class="text-xs text-blue-700">
                    El sistema analizará el PDF y extraerá automáticamente: tipo de prenda (del nombre del archivo), 
                    grupo etario, tallas disponibles y medidas. Podrás escalar a otras tallas después.
                  </p>
                </div>
              </div>
            </div>

            <!-- Progress bar -->
            <div id="pdf-progress-container" class="hidden mb-5">
              <div class="bg-white border border-gray-200 rounded-xl p-4">
                <div class="flex items-center justify-between mb-2">
                  <p class="text-sm font-semibold text-gray-700">
                    <span id="pdf-progress-text">Preparando análisis...</span>
                  </p>
                  <p class="text-xs font-medium text-gray-500">
                    <span id="pdf-progress-percent">0%</span>
                  </p>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                  <div id="pdf-progress-bar" 
                       class="bg-brand-gold h-2.5 rounded-full transition-all duration-500 ease-out"
                       style="width: 0%"></div>
                </div>
              </div>
            </div>

            <!-- Extracted info will be shown here after upload -->
            <div id="pdf-extracted-info" class="hidden">
              <p class="text-sm font-semibold text-gray-700 mb-3">Información extraída del PDF:</p>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-gray-50 rounded-xl p-4">
                <div>
                  <p class="text-xs text-gray-500 mb-1">Tipo de prenda</p>
                  <p id="pdf-garmentType" class="text-sm font-medium text-gray-900">—</p>
                </div>
                <div>
                  <p class="text-xs text-gray-500 mb-1">Grupo etario</p>
                  <p id="pdf-ageGroup" class="text-sm font-medium text-gray-900">—</p>
                </div>
                <div>
                  <p class="text-xs text-gray-500 mb-1">Tallas detectadas</p>
                  <p id="pdf-sizes" class="text-sm font-medium text-gray-900">—</p>
                </div>
              </div>

              <!-- Grading options -->
              <div class="mt-5">
                <p class="text-sm font-semibold text-gray-700 mb-3">
                  Escalado de tallas <span class="text-gray-400 text-xs font-normal">(opcional)</span>
                </p>
                <p class="text-xs text-gray-500 mb-3">
                  Selecciona tallas adicionales para generar variantes del patrón
                </p>
                <div id="grading-options" class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <!-- Checkboxes will be populated here -->
                </div>
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

    // Wire up garmentType change to update measurements
    document.getElementById('patron-garmentType')
      ?.addEventListener('change', PatronesSection._updateMeasurementFields);

    // Wire up ageGroup change to filter sizes
    document.getElementById('patron-ageGroup')
      ?.addEventListener('change', PatronesSection._updateSizeOptions);

    // Wire up reference image change to show filename and switch modes
    document.getElementById('patron-referenceImage')
      ?.addEventListener('change', PatronesSection._handleFileChange);

    // Wire up form events
    document.getElementById('patron-create-form')
      ?.addEventListener('submit', PatronesSection._handleCreateSubmit);
    document.getElementById('btn-patron-cancel')
      ?.addEventListener('click', () => {
        const fc = document.getElementById('patron-form-container');
        if (fc) { fc.innerHTML = ''; fc.classList.add('hidden'); }
      });

    // Focus first field
    document.getElementById('patron-referenceImage')?.focus();
  },

  /**
   * Handle file change - switch between manual and PDF modes
   */
  async _handleFileChange(e) {
    const fileInput = e.target;
    const file = fileInput.files?.[0];
    const fileNameDisplay = document.getElementById('reference-file-name');
    const manualSection = document.getElementById('manual-entry-section');
    const pdfSection = document.getElementById('pdf-analysis-section');
    
    if (!file) {
      // No file selected - show manual mode
      fileNameDisplay?.classList.add('hidden');
      manualSection?.classList.remove('hidden');
      pdfSection?.classList.add('hidden');
      return;
    }

    // Show filename
    fileNameDisplay.textContent = `📄 ${file.name}`;
    fileNameDisplay.classList.remove('hidden');

    const isPdf = file.type === 'application/pdf';

    if (isPdf) {
      // PDF mode - hide manual fields, show PDF analysis
      manualSection?.classList.add('hidden');
      pdfSection?.classList.remove('hidden');

      // Show progress bar
      const progressContainer = document.getElementById('pdf-progress-container');
      const progressBar = document.getElementById('pdf-progress-bar');
      const progressText = document.getElementById('pdf-progress-text');
      const progressPercent = document.getElementById('pdf-progress-percent');
      
      progressContainer?.classList.remove('hidden');

      try {
        // Stage 1: Loading PDF
        progressBar.style.width = '20%';
        progressText.textContent = 'Cargando PDF...';
        progressPercent.textContent = '20%';

        // Extract garment type from filename
        const garmentType = PatronesSection._extractGarmentTypeFromFilename(file.name);

        // Stage 2: Converting to image
        progressBar.style.width = '40%';
        progressText.textContent = 'Convirtiendo PDF a imagen...';
        progressPercent.textContent = '40%';

        const imageDataUrl = await PatronesSection._convertPdfToImage(file);

        // Stage 3: Running OCR (with timeout)
        progressBar.style.width = '60%';
        progressText.textContent = 'Extrayendo texto del patrón...';
        progressPercent.textContent = '60%';

        let ocrText = '';
        try {
          // Add timeout for OCR (15 seconds max)
          ocrText = await Promise.race([
            PatronesSection._extractTextFromImage(imageDataUrl),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('OCR timeout')), 15000)
            )
          ]);
        } catch (ocrError) {
          console.warn('OCR failed or timed out, using fallback detection:', ocrError);
          ocrText = ''; // Will trigger fallback
        }

        // Stage 4: Analyzing text
        progressBar.style.width = '80%';
        progressText.textContent = 'Analizando tallas y medidas...';
        progressPercent.textContent = '80%';

        let detectedSizes = PatronesSection._extractSizesFromText(ocrText);
        
        // Fallback: If no sizes detected, use intelligent defaults
        if (detectedSizes.length === 0) {
          console.warn('No sizes detected from OCR, using intelligent fallback');
          detectedSizes = PatronesSection._detectSizesFromFilename(file.name);
        }

        const ageGroup = PatronesSection._detectAgeGroupFromSizes(detectedSizes);

        // Stage 5: Complete
        progressBar.style.width = '100%';
        progressText.textContent = 'Análisis completado ✓';
        progressPercent.textContent = '100%';

        // Store detected data for form submission
        PatronesSection._pdfData = {
          garmentType,
          ageGroup,
          detectedSizes,
        };

        // Hide progress bar and show results
        setTimeout(() => {
          progressContainer?.classList.add('hidden');
          
          // Show extracted info
          const pdfInfo = document.getElementById('pdf-extracted-info');
          if (pdfInfo) {
            pdfInfo.classList.remove('hidden');
            document.getElementById('pdf-garmentType').textContent = garmentType || 'No detectado';
            document.getElementById('pdf-ageGroup').textContent = ageGroup === 'adult' ? 'Adulto' : 'Infantil';
            document.getElementById('pdf-sizes').textContent = detectedSizes.length > 0 
              ? detectedSizes.join(', ') 
              : 'No detectadas';
            
            // Populate grading options
            PatronesSection._populateGradingOptions(ageGroup, detectedSizes);
          }
        }, 500);

      } catch (error) {
        console.error('Error analyzing PDF:', error);
        progressContainer?.classList.add('hidden');
        Toast.error(`Error al analizar PDF: ${error.message}`);
        
        // Fallback to manual mode
        manualSection?.classList.remove('hidden');
        pdfSection?.classList.add('hidden');
        fileInput.value = ''; // Clear file input
      }

    } else {
      // Image mode - show manual fields, hide PDF section
      manualSection?.classList.remove('hidden');
      pdfSection?.classList.add('hidden');
      
      // Clear PDF data
      PatronesSection._pdfData = null;
    }
  },

  /**
   * Convert PDF first page to image using PDF.js
   */
  async _convertPdfToImage(file) {
    const arrayBuffer = await file.arrayBuffer();
    
    // Configure PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1); // Get first page
    
    const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    return canvas.toDataURL('image/png');
  },

  /**
   * Extract text from image using Tesseract.js OCR
   */
  async _extractTextFromImage(imageDataUrl) {
    try {
      const { data: { text } } = await Tesseract.recognize(
        imageDataUrl,
        'eng', // English language
        {
          logger: (m) => {
            console.log('OCR Progress:', m);
          },
        }
      );
      return text;
    } catch (error) {
      console.error('OCR Error:', error);
      // Fallback: return empty string and let size detection try with filename
      return '';
    }
  },

  /**
   * Extract sizes from OCR text
   */
  _extractSizesFromText(text) {
    // If OCR failed or returned empty text, use default sizes based on common patterns
    if (!text || text.trim().length === 0) {
      console.warn('OCR returned empty text, using fallback detection');
      // Return empty array - will trigger fallback in handleFileChange
      return [];
    }

    const allSizes = [
      // Adult sizes
      'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL',
      // Children sizes  
      '2T', '4T', '6', '8', '10', '12', '14', '16'
    ];

    const foundSizes = [];
    const upperText = text.toUpperCase();

    for (const size of allSizes) {
      // Look for size with word boundaries or common separators
      const patterns = [
        new RegExp(`\\b${size}\\b`, 'i'),           // Exact match with word boundaries
        new RegExp(`${size}[\\s,;:|]`, 'i'),        // Size followed by separator
        new RegExp(`[\\s,;:|]${size}\\b`, 'i'),     // Size preceded by separator
        new RegExp(`talla\\s*${size}`, 'i'),        // "talla M", "talla L"
        new RegExp(`size\\s*${size}`, 'i'),         // "size M", "size L"
      ];

      if (patterns.some(pattern => pattern.test(text))) {
        if (!foundSizes.includes(size)) {
          foundSizes.push(size);
        }
      }
    }

    // Sort sizes in logical order
    const sizeOrder = ['2T', '4T', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];
    foundSizes.sort((a, b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b));

    return foundSizes;
  },

  /**
   * Detect age group from size list
   * Adult sizes: XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL
   * Children sizes: 2T, 4T, 6, 8, 10, 12, 14, 16
   */
  _detectAgeGroupFromSizes(sizes) {
    const adultSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];
    const childrenSizes = ['2T', '4T', '6', '8', '10', '12', '14', '16'];

    // Count matches for each group
    const adultMatches = sizes.filter(size => adultSizes.includes(size)).length;
    const childrenMatches = sizes.filter(size => childrenSizes.includes(size)).length;

    // Return the group with more matches
    return adultMatches >= childrenMatches ? 'adult' : 'children';
  },

  /**
   * Populate grading options based on detected age group and sizes
   */
  _populateGradingOptions(ageGroup, detectedSizes) {
    const container = document.getElementById('grading-options');
    if (!container) return;

    const allSizes = ageGroup === 'adult'
      ? ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL']
      : ['2T', '4T', '6', '8', '10', '12', '14', '16'];

    container.innerHTML = allSizes.map(size => {
      const isDetected = detectedSizes.includes(size);
      return `
        <label class="flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors
                      ${isDetected 
                        ? 'border-brand-gold bg-brand-gold/10' 
                        : 'border-gray-200 hover:border-gray-300'}">
          <input type="checkbox" 
                 name="grading-size" 
                 value="${size}"
                 ${isDetected ? 'checked disabled' : ''}
                 class="w-4 h-4 text-brand-gold border-gray-300 rounded focus:ring-brand-gold focus:ring-2">
          <span class="text-sm font-medium ${isDetected ? 'text-brand-blue' : 'text-gray-700'}">
            ${size} ${isDetected ? '(detectada)' : ''}
          </span>
        </label>
      `;
    }).join('');
  },

  /**
   * Detect sizes from filename as fallback
   * Examples: "Molde Hoodie infantil.pdf" -> children sizes
   *           "Pattern Adult XS-XL.pdf" -> adult sizes
   */
  _detectSizesFromFilename(filename) {
    const lower = filename.toLowerCase();
    
    // Check for age group indicators in filename
    const isChildren = /\b(infantil|ni[ñn]o|ni[ñn]a|kid|child|children)\b/i.test(lower);
    const isAdult = /\b(adulto|adult|dama|caballero|hombre|mujer|men|women)\b/i.test(lower);
    
    if (isChildren) {
      // Return common children sizes
      return ['2T', '4T', '6', '8', '10', '12', '14', '16'];
    } else if (isAdult) {
      // Return common adult sizes
      return ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
    } else {
      // Default: adult sizes (most common)
      return ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
    }
  },

  /**
   * Extract garment type from PDF filename
   * Examples: "Molde Buzo sueter dama.pdf" -> "sudadera"
   *           "camiseta-M.pdf" -> "camiseta"
   */
  _extractGarmentTypeFromFilename(filename) {
    const lower = filename.toLowerCase();
    
    // Map keywords to garment types
    const patterns = {
      'sudadera': ['buzo', 'sudadera', 'sueter', 'hoodie', 'sweater'],
      'camiseta': ['camiseta', 'polera', 'remera', 'tshirt', 't-shirt'],
      'short': ['short', 'pantaloneta'],
      'legging': ['legging', 'calza', 'malla'],
      'tank-top': ['tank', 'musculosa', 'sin mangas'],
    };

    for (const [garmentType, keywords] of Object.entries(patterns)) {
      if (keywords.some(keyword => lower.includes(keyword))) {
        return garmentType;
      }
    }

    return null; // Unable to detect from filename
  },

  _updateSizeOptions(e) {
    const ageGroup = e.target.value;
    const sizeSelect = document.getElementById('patron-size');
    if (!sizeSelect) return;

    // Clear current selection
    sizeSelect.value = '';

    if (!ageGroup) {
      // If no age group selected, disable size select
      sizeSelect.innerHTML = '<option value="">Primero selecciona grupo etario...</option>';
      sizeSelect.disabled = true;
      return;
    }

    // Enable size select
    sizeSelect.disabled = false;

    // Build options based on age group
    if (ageGroup === 'adult') {
      sizeSelect.innerHTML = `
        <option value="">Seleccionar talla...</option>
        <option value="XS">XS</option>
        <option value="S">S</option>
        <option value="M">M</option>
        <option value="L">L</option>
        <option value="XL">XL</option>
        <option value="XXL">XXL</option>
        <option value="3XL">3XL</option>
        <option value="4XL">4XL</option>
        <option value="5XL">5XL</option>
        <option value="6XL">6XL</option>
      `;
    } else if (ageGroup === 'children') {
      sizeSelect.innerHTML = `
        <option value="">Seleccionar talla...</option>
        <option value="2T">2T</option>
        <option value="4T">4T</option>
        <option value="6">6</option>
        <option value="8">8</option>
        <option value="10">10</option>
        <option value="12">12</option>
        <option value="14">14</option>
        <option value="16">16</option>
      `;
    }
  },

  /**
   * Update measurements requirement based on file type
   * (This function is now replaced by _handleFileChange but kept for compatibility)
   */
  _updateMeasurementsRequirement(fileType) {
    // This function is deprecated - mode switching is now handled by _handleFileChange
  },

  _updateMeasurementFields(e) {
    const garmentType = e.target.value;
    const container = document.getElementById('measurements-container');
    if (!container) return;

    // Measurement field definitions per garment type
    // Units displayed in CM, converted to MM when submitting (×10)
    // Based on: Manual de Corte y Confección CIDEP (2012)
    const measurementsByType = {
      'camiseta': [
        { key: 'chest',        label: 'Contorno de pecho',     hint: 'Bajo las axilas, parte más saliente del pecho',  min: 70, max: 140, placeholder: '96',  step: '0.5' },
        { key: 'waist',        label: 'Contorno de cintura',   hint: 'Alrededor de la cintura, medida más corta',       min: 58, max: 120, placeholder: '80',  step: '0.5' },
        { key: 'hip',          label: 'Contorno de cadera',    hint: 'Semiperímetro de la parte más ancha de la cadera',min: 80, max: 135, placeholder: '98',  step: '0.5' },
        { key: 'torsoLength',  label: 'Largo de talle (espalda)', hint: 'Desde hombro hasta cintura, por la columna',  min: 36, max: 58,  placeholder: '42',  step: '0.5' },
        { key: 'shoulderWidth',label: 'Ancho de espalda',      hint: 'De hombro a hombro (mitad de espalda × 2)',      min: 32, max: 52,  placeholder: '38',  step: '0.5' },
      ],
      'sudadera': [
        { key: 'chest',        label: 'Contorno de pecho',     hint: 'Bajo las axilas, parte más saliente del pecho',  min: 70, max: 145, placeholder: '100', step: '0.5' },
        { key: 'waist',        label: 'Contorno de cintura',   hint: 'Alrededor de la cintura, medida más corta',       min: 58, max: 120, placeholder: '84',  step: '0.5' },
        { key: 'hip',          label: 'Contorno de cadera',    hint: 'Semiperímetro de la parte más ancha de la cadera',min: 80, max: 140, placeholder: '100', step: '0.5' },
        { key: 'torsoLength',  label: 'Largo de talle (espalda)', hint: 'Desde hombro hasta cintura, por la columna',  min: 36, max: 58,  placeholder: '43',  step: '0.5' },
        { key: 'shoulderWidth',label: 'Ancho de espalda',      hint: 'De hombro a hombro (mitad de espalda × 2)',      min: 32, max: 52,  placeholder: '39',  step: '0.5' },
        { key: 'sleeveLength', label: 'Largo de manga',        hint: 'Desde hombro hasta muñeca, brazo doblado',       min: 54, max: 68,  placeholder: '60',  step: '0.5' },
      ],
      'tank-top': [
        { key: 'chest',        label: 'Contorno de pecho',     hint: 'Bajo las axilas, parte más saliente del pecho',  min: 70, max: 140, placeholder: '94',  step: '0.5' },
        { key: 'waist',        label: 'Contorno de cintura',   hint: 'Alrededor de la cintura, medida más corta',       min: 58, max: 120, placeholder: '78',  step: '0.5' },
        { key: 'hip',          label: 'Contorno de cadera',    hint: 'Semiperímetro de la parte más ancha de la cadera',min: 80, max: 135, placeholder: '96',  step: '0.5' },
        { key: 'torsoLength',  label: 'Largo de talle (espalda)', hint: 'Desde hombro hasta cintura, por la columna',  min: 36, max: 58,  placeholder: '41',  step: '0.5' },
        { key: 'shoulderWidth',label: 'Ancho de espalda',      hint: 'De hombro a hombro (mitad de espalda × 2)',      min: 32, max: 52,  placeholder: '36',  step: '0.5' },
      ],
      'short': [
        { key: 'waist',        label: 'Contorno de cintura',   hint: 'Alrededor de la cintura, medida más corta',       min: 58, max: 120, placeholder: '80',  step: '0.5' },
        { key: 'hip',          label: 'Contorno de cadera',    hint: 'Semiperímetro de la parte más ancha de la cadera',min: 80, max: 135, placeholder: '98',  step: '0.5' },
        { key: 'legLength',    label: 'Largo de pierna',       hint: 'Desde cintura hasta el largo deseado del short',  min: 20, max: 50,  placeholder: '28',  step: '0.5' },
        { key: 'inseam',       label: 'Tiro (entrepierna)',    hint: 'Desde la cintura hasta la entrepierna',            min: 20, max: 40,  placeholder: '28',  step: '0.5' },
      ],
      'legging': [
        { key: 'waist',        label: 'Contorno de cintura',   hint: 'Alrededor de la cintura, medida más corta',       min: 58, max: 120, placeholder: '76',  step: '0.5' },
        { key: 'hip',          label: 'Contorno de cadera',    hint: 'Semiperímetro de la parte más ancha de la cadera',min: 80, max: 135, placeholder: '96',  step: '0.5' },
        { key: 'legLength',    label: 'Largo de pantalón',     hint: 'Desde cintura hasta el pie, por el lateral',      min: 90, max: 115, placeholder: '102', step: '0.5' },
        { key: 'inseam',       label: 'Tiro (entrepierna)',    hint: 'Desde la cintura hasta la entrepierna',            min: 20, max: 40,  placeholder: '28',  step: '0.5' },
      ],
    };

    const fields = measurementsByType[garmentType];

    if (!fields) {
      container.innerHTML = `
        <p class="col-span-full text-sm text-gray-400 italic">
          Selecciona un tipo de prenda para ver los campos de medidas
        </p>
      `;
      return;
    }

    // Reference table (from CIDEP manual, adult female, ~165cm)
    const referenceTable = {
      'camiseta':  { chest: 96, waist: 80,  hip: 98,  torsoLength: 42, shoulderWidth: 38 },
      'sudadera':  { chest: 100,waist: 84,  hip: 100, torsoLength: 43, shoulderWidth: 39, sleeveLength: 60 },
      'tank-top':  { chest: 94, waist: 78,  hip: 96,  torsoLength: 41, shoulderWidth: 36 },
      'short':     { waist: 80, hip: 98,    legLength: 28, inseam: 28 },
      'legging':   { waist: 76, hip: 96,    legLength: 102, inseam: 28 },
    };

    const ref = referenceTable[garmentType] || {};

    container.innerHTML = `
      <div class="col-span-full mb-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
        <p class="font-semibold mb-1">📐 Medidas en centímetros (cm)</p>
        <p>Las medidas se ingresan en cm según el manual de patronaje. Los valores de referencia son para talla M adulto (~165 cm de estatura).</p>
      </div>
      ${fields.map(f => `
        <div>
          <label for="patron-${f.key}" class="block text-xs font-semibold text-gray-700 mb-1">
            ${f.label} <span class="text-gray-400 font-normal">(cm)</span>
          </label>
          <input id="patron-${f.key}" name="${f.key}" type="number"
                 min="${f.min}" max="${f.max}" step="${f.step}" required
                 class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm
                        focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold"
                 placeholder="${f.placeholder}"
                 title="${f.hint}">
          <p class="text-xs text-gray-400 mt-0.5">${f.hint}</p>
          <span id="err-${f.key}" class="hidden text-xs text-red-600 mt-1" role="alert"></span>
        </div>
      `).join('')}
    `;
  },

  async _handleCreateSubmit(e) {
    e.preventDefault();

    const referenceImageInput = document.getElementById('patron-referenceImage');
    const referenceImageFile = referenceImageInput?.files?.[0];
    const isPdfMode = referenceImageFile?.type === 'application/pdf';

    // Clear previous field errors
    ['garmentType', 'ageGroup', 'size', 'referenceImage'].forEach(f => PatronesSection._clearFieldError(f));

    let hasErrors = false;

    // Validate reference file if provided
    if (referenceImageFile) {
      const validTypes = ['image/jpeg', 'image/jpg', 'application/pdf'];
      const maxSize = 25 * 1024 * 1024; // 25 MB
      
      if (!validTypes.includes(referenceImageFile.type)) {
        PatronesSection._setFieldError('referenceImage', 'Formato inválido. Usa JPG, JPEG o PDF');
        hasErrors = true;
      } else if (referenceImageFile.size > maxSize) {
        PatronesSection._setFieldError('referenceImage', 'Archivo muy grande. Máximo 25 MB');
        hasErrors = true;
      }
    }

    let requestBody;

    if (isPdfMode) {
      // PDF MODE: Extract data from PDF, manual fields not required
      if (!referenceImageFile) {
        Toast.error('Debes seleccionar un archivo PDF');
        hasErrors = true;
      }

      if (hasErrors) return;

      // Use stored PDF data (detected during file upload)
      const pdfData = PatronesSection._pdfData;
      
      if (!pdfData || !pdfData.ageGroup) {
        Toast.error('No se pudo detectar el grupo etario del PDF');
        return;
      }

      if (!pdfData.detectedSizes || pdfData.detectedSizes.length === 0) {
        Toast.error('No se pudieron detectar tallas en el PDF');
        return;
      }

      // Convert PDF to base64
      const base64 = await PatronesSection._fileToBase64(referenceImageFile);

      // Get selected grading sizes (additional sizes user wants to generate)
      const gradingSizes = Array.from(document.querySelectorAll('input[name="grading-size"]:checked:not(:disabled)'))
        .map(cb => cb.value);

      // Use the first detected size as the base size
      const baseSize = pdfData.detectedSizes[0];

      requestBody = {
        mode: 'pdf',
        garmentType: pdfData.garmentType || 'sudadera', // Extracted from filename
        ageGroup: pdfData.ageGroup, // Auto-detected from sizes
        size: baseSize, // Base size (first detected size)
        measurements: {}, // Empty for now, backend should extract from PDF
        detectedSizes: pdfData.detectedSizes, // All sizes found in PDF
        gradingSizes: gradingSizes, // Additional sizes to generate
        referenceImageKey: base64,
        referenceImageName: referenceImageFile.name,
        referenceImageType: referenceImageFile.type,
      };

    } else {
      // MANUAL MODE: Validate all manual fields
      const garmentType = document.getElementById('patron-garmentType')?.value;
      const ageGroup = document.getElementById('patron-ageGroup')?.value;
      const size = document.getElementById('patron-size')?.value;

      if (!garmentType) { PatronesSection._setFieldError('garmentType', 'Selecciona un tipo de prenda'); hasErrors = true; }
      if (!ageGroup)    { PatronesSection._setFieldError('ageGroup', 'Selecciona un grupo etario'); hasErrors = true; }
      if (!size)        { PatronesSection._setFieldError('size', 'Selecciona una talla'); hasErrors = true; }

      // Build measurements object dynamically from available fields
      // Input values are in CM, convert to MM (×10) for the backend
      const measurements = {};
      const measurementKeys = ['chest', 'waist', 'hip', 'torsoLength', 'legLength', 'shoulderWidth', 'inseam', 'sleeveLength'];
      
      measurementKeys.forEach(key => {
        const input = document.getElementById(`patron-${key}`);
        if (input && input.value) {
          const valueCm = parseFloat(input.value);
          const minCm   = parseFloat(input.min);
          const maxCm   = parseFloat(input.max);
          if (isNaN(valueCm) || valueCm < minCm || valueCm > maxCm) {
            PatronesSection._setFieldError(key, `Valor inválido (${minCm}–${maxCm} cm)`);
            hasErrors = true;
          } else {
            // Convert cm → mm for the backend
            measurements[key] = Math.round(valueCm * 10);
          }
        }
      });

      // Validate at least one measurement
      if (Object.keys(measurements).length === 0) {
        Toast.error('Debes ingresar al menos una medida');
        hasErrors = true;
      }

      if (hasErrors) return;

      requestBody = {
        mode: 'manual',
        garmentType,
        ageGroup,
        size,
        measurements,
      };

      // If reference image is provided in manual mode
      if (referenceImageFile) {
        const base64 = await PatronesSection._fileToBase64(referenceImageFile);
        requestBody.referenceImageKey = base64;
        requestBody.referenceImageName = referenceImageFile.name;
        requestBody.referenceImageType = referenceImageFile.type;
      }
    }

    const submitBtn = document.getElementById('btn-patron-submit');
    const spinner   = document.getElementById('patron-submit-spinner');
    const btnText   = document.getElementById('patron-submit-text');

    if (submitBtn) submitBtn.disabled = true;
    if (spinner)   spinner.classList.remove('hidden');
    if (btnText)   btnText.textContent = 'Generando...';

    try {
      await Api.post('/api/patterns/generate', requestBody);
      
      if (isPdfMode) {
        Toast.success('PDF analizado y patrón generado. Aparecerá en la lista pronto.');
      } else {
        Toast.success('Patrón generado correctamente. Aparecerá en la lista pronto.');
      }
      
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

  /**
   * Convert file to base64 string
   */
  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
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
