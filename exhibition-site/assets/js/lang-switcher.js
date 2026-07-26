/**
 * CronusFit Language Switcher
 *
 * Wires the #lang-switcher button to toggle between Spanish and English.
 * Also updates product name elements that have bilingual data attributes.
 * Depends on I18n (i18n.js) being loaded first.
 */

(function () {
  'use strict';

  /**
   * Update all elements with `data-i18n-product-name` attribute.
   * Reads the product name for the current language from data attributes.
   */
  function updateProductNames() {
    var lang = I18n.currentLanguage;
    var elements = document.querySelectorAll('[data-i18n-product-name]');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var name = el.getAttribute('data-product-name-' + lang);
      if (name && name.trim() !== '') {
        el.textContent = name;
      } else {
        // Fallback to Spanish silently (Requirement 3.7)
        var esFallback = el.getAttribute('data-product-name-es');
        if (esFallback) {
          el.textContent = esFallback;
        }
      }
    }
  }

  /**
   * Initialize the language switcher button behavior.
   */
  function init() {
    var btn = document.getElementById('lang-switcher');
    if (!btn) {
      return;
    }

    btn.addEventListener('click', function () {
      var target = I18n.currentLanguage === 'es' ? 'en' : 'es';
      I18n.switchLanguage(target).then(function () {
        updateProductNames();
      });
    });

    // Update product names on initial load based on stored language
    // Wait a tick to ensure I18n.init() has completed (it's async)
    if (I18n.currentLanguage) {
      updateProductNames();
    }
    // Also listen for the case where I18n initializes after this script
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === 'lang') {
          updateProductNames();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
