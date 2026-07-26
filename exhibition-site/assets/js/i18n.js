/**
 * CronusFit i18n System
 *
 * Client-side internationalization module for the Exhibition Site.
 * Supports Spanish (default) and English with localStorage persistence.
 * Switches language without page reload by updating all `data-i18n` elements.
 */

// eslint-disable-next-line no-var
var I18n = (function () {
  'use strict';

  var STORAGE_KEY = 'cronusfit-lang';
  var DEFAULT_LANGUAGE = 'es';
  var SUPPORTED_LANGUAGES = ['es', 'en'];
  var TRANSLATION_BASE_PATH = '/i18n/';

  /** @type {string} */
  var currentLanguage = DEFAULT_LANGUAGE;

  /** @type {Record<string, string>} */
  var translations = {};

  /** @type {Record<string, string>} */
  var fallbackTranslations = {};

  /**
   * Load a translation file by language code.
   * @param {string} lang - Language code ('es' or 'en')
   * @returns {Promise<Record<string, string>>}
   */
  function loadTranslations(lang) {
    var url = TRANSLATION_BASE_PATH + lang + '.json';
    return fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Failed to load translations: ' + response.status);
        }
        return response.json();
      });
  }

  /**
   * Show a non-blocking toast notification to the user.
   * @param {string} message - Message to display
   */
  function showNotification(message) {
    var existing = document.getElementById('i18n-notification');
    if (existing) {
      existing.remove();
    }

    var toast = document.createElement('div');
    toast.id = 'i18n-notification';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText =
      'position:fixed;bottom:1rem;right:1rem;background:#1e3a5f;color:#fff;' +
      'padding:0.75rem 1.25rem;border-radius:0.5rem;font-size:0.875rem;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:9999;' +
      'transition:opacity 0.3s ease;opacity:1;max-width:320px;';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 4000);
  }

  /**
   * Update all DOM elements marked with `data-i18n` attribute.
   * Also updates elements with `data-i18n-placeholder` and `data-i18n-aria`.
   */
  function updateDOM() {
    // Update text content for elements with data-i18n
    var elements = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key);
      }
    }

    // Update placeholder attributes
    var placeholderEls = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < placeholderEls.length; j++) {
      var plEl = placeholderEls[j];
      var plKey = plEl.getAttribute('data-i18n-placeholder');
      if (plKey) {
        plEl.setAttribute('placeholder', t(plKey));
      }
    }

    // Update aria-label attributes
    var ariaEls = document.querySelectorAll('[data-i18n-aria]');
    for (var k = 0; k < ariaEls.length; k++) {
      var arEl = ariaEls[k];
      var arKey = arEl.getAttribute('data-i18n-aria');
      if (arKey) {
        arEl.setAttribute('aria-label', t(arKey));
      }
    }

    // Update the HTML lang attribute
    document.documentElement.setAttribute('lang', currentLanguage);
  }

  /**
   * Get the stored language preference from localStorage.
   * @returns {string|null}
   */
  function getStoredLanguage() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED_LANGUAGES.indexOf(stored) !== -1) {
        return stored;
      }
    } catch (e) {
      // localStorage unavailable — use default
    }
    return null;
  }

  /**
   * Persist the language preference to localStorage.
   * @param {string} lang
   */
  function storeLanguage(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      // Silently fail if localStorage is unavailable
    }
  }

  /**
   * Initialize the i18n system.
   * Loads the stored language or defaults to Spanish.
   * @returns {Promise<void>}
   */
  function init() {
    var storedLang = getStoredLanguage() || DEFAULT_LANGUAGE;

    // Always load Spanish as fallback
    return loadTranslations(DEFAULT_LANGUAGE)
      .then(function (esData) {
        fallbackTranslations = esData;

        if (storedLang === DEFAULT_LANGUAGE) {
          currentLanguage = DEFAULT_LANGUAGE;
          translations = esData;
          updateDOM();
          return;
        }

        // Load the stored language
        return loadTranslations(storedLang)
          .then(function (data) {
            currentLanguage = storedLang;
            translations = data;
            updateDOM();
          })
          .catch(function () {
            // Fall back to Spanish if target language fails to load
            currentLanguage = DEFAULT_LANGUAGE;
            translations = fallbackTranslations;
            updateDOM();
            showNotification(
              fallbackTranslations['error.language_unavailable'] ||
                'El idioma seleccionado no está disponible temporalmente.'
            );
          });
      })
      .catch(function () {
        // Even Spanish failed — use empty translations, DOM stays as-is
        currentLanguage = DEFAULT_LANGUAGE;
        translations = {};
        fallbackTranslations = {};
      });
  }

  /**
   * Switch the active language and persist selection.
   * Updates all data-i18n elements without page reload.
   * @param {string} lang - Target language code ('es' or 'en')
   * @returns {Promise<void>}
   */
  function switchLanguage(lang) {
    if (SUPPORTED_LANGUAGES.indexOf(lang) === -1) {
      return Promise.resolve();
    }

    if (lang === currentLanguage) {
      return Promise.resolve();
    }

    return loadTranslations(lang)
      .then(function (data) {
        currentLanguage = lang;
        translations = data;
        storeLanguage(lang);
        updateDOM();
      })
      .catch(function () {
        // Fall back to Spanish on load failure
        currentLanguage = DEFAULT_LANGUAGE;
        translations = fallbackTranslations;
        storeLanguage(DEFAULT_LANGUAGE);
        updateDOM();
        showNotification(
          fallbackTranslations['error.language_unavailable'] ||
            'El idioma seleccionado no está disponible temporalmente.'
        );
      });
  }

  /**
   * Get a translated string by key.
   * Falls back to Spanish if the key is missing in the current language.
   * Returns the key itself if not found in any language.
   * @param {string} key - Translation key (e.g., 'nav.home')
   * @param {Record<string, string>} [params] - Optional interpolation parameters
   * @returns {string}
   */
  function t(key, params) {
    var value = translations[key] || fallbackTranslations[key] || key;

    if (params) {
      Object.keys(params).forEach(function (param) {
        value = value.replace(new RegExp('\\{' + param + '\\}', 'g'), params[param]);
      });
    }

    return value;
  }

  /**
   * Format an ISO date string according to the current language.
   * Spanish: DD/MM/YYYY
   * English: MM/DD/YYYY
   * @param {string} iso - ISO 8601 date string
   * @returns {string} Formatted date string
   */
  function formatDate(iso) {
    var date = new Date(iso);

    if (isNaN(date.getTime())) {
      return iso; // Return original string if invalid
    }

    var day = String(date.getUTCDate()).padStart(2, '0');
    var month = String(date.getUTCMonth() + 1).padStart(2, '0');
    var year = String(date.getUTCFullYear());

    if (currentLanguage === 'en') {
      return month + '/' + day + '/' + year;
    }

    // Default (es): DD/MM/YYYY
    return day + '/' + month + '/' + year;
  }

  /**
   * Get a product field value in the current language with Spanish fallback.
   * Used for product names/descriptions that have bilingual data.
   * @param {object} fieldObj - Object with language keys, e.g. { es: "...", en: "..." }
   * @returns {string}
   */
  function getProductField(fieldObj) {
    if (!fieldObj || typeof fieldObj !== 'object') {
      return '';
    }

    var value = fieldObj[currentLanguage];
    if (value && value.trim() !== '') {
      return value;
    }

    // Fallback to Spanish silently (no error indicator)
    return fieldObj[DEFAULT_LANGUAGE] || '';
  }

  // Public API
  return {
    get currentLanguage() {
      return currentLanguage;
    },
    get translations() {
      return translations;
    },
    init: init,
    switchLanguage: switchLanguage,
    t: t,
    formatDate: formatDate,
    getProductField: getProductField
  };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    I18n.init();
  });
} else {
  I18n.init();
}
