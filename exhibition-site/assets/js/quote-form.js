/**
 * CronusFit Quote Form
 *
 * Client-side validation, hCaptcha integration, and form submission
 * for the /cotizacion/ page.
 *
 * Depends on: I18n (i18n.js), hCaptcha script
 */

(function () {
  'use strict';

  // Configuration
  var QUOTE_API_URL = '/api/quotes';
  var SUBMIT_TIMEOUT_MS = 30000;

  // State
  var captchaToken = null;
  var captchaReady = false;
  var isSubmitting = false;

  // DOM References (populated on init)
  var form;
  var submitBtn;
  var successPanel;
  var successMessage;
  var errorBanner;
  var errorBannerMessage;
  var captchaUnavailablePanel;

  /**
   * Sanitize input by stripping HTML tags and encoding special characters.
   * @param {string} input
   * @returns {string}
   */
  function sanitize(input) {
    if (!input) return '';
    // Strip HTML tags
    var stripped = input.replace(/<[^>]*>/g, '');
    // Encode special characters
    stripped = stripped
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
    return stripped;
  }

  /**
   * Show a field-level error message.
   * @param {string} fieldId - The error element ID (e.g., 'error-name')
   * @param {string} messageKey - The i18n translation key
   */
  function showFieldError(fieldId, messageKey) {
    var el = document.getElementById(fieldId);
    if (!el) return;
    el.textContent = I18n.t(messageKey);
    el.classList.remove('hidden');

    // Add error border to the input
    var inputId = fieldId.replace('error-', 'quote-');
    var input = document.getElementById(inputId);
    if (input) {
      input.classList.add('border-red-500');
      input.setAttribute('aria-invalid', 'true');
    }
  }

  /**
   * Clear a field-level error message.
   * @param {string} fieldId
   */
  function clearFieldError(fieldId) {
    var el = document.getElementById(fieldId);
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');

    var inputId = fieldId.replace('error-', 'quote-');
    var input = document.getElementById(inputId);
    if (input) {
      input.classList.remove('border-red-500');
      input.removeAttribute('aria-invalid');
    }
  }

  /**
   * Clear all field errors.
   */
  function clearAllErrors() {
    var errorFields = ['error-name', 'error-email', 'error-phone', 'error-product', 'error-quantity', 'error-age-group', 'error-sizes', 'error-captcha'];
    for (var i = 0; i < errorFields.length; i++) {
      clearFieldError(errorFields[i]);
    }
    errorBanner.classList.add('hidden');
  }

  /**
   * Validate the quote form fields.
   * @returns {boolean} True if valid
   */
  function validateForm() {
    var isValid = true;
    clearAllErrors();

    // Name: 1-100 characters
    var name = document.getElementById('quote-name').value.trim();
    if (!name || name.length < 1 || name.length > 100) {
      showFieldError('error-name', 'quote.error.required');
      isValid = false;
    }

    // Email: RFC 5322 basic validation
    var email = document.getElementById('quote-email').value.trim();
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      showFieldError('error-email', 'quote.error.required');
      isValid = false;
    } else if (!emailRegex.test(email)) {
      showFieldError('error-email', 'quote.error.email_invalid');
      isValid = false;
    }

    // Phone: E.164 format (7-15 digits, may start with +)
    var phone = document.getElementById('quote-phone').value.trim();
    var phoneDigits = phone.replace(/[\s\-()]/g, '');
    var phoneRegex = /^\+?\d{7,15}$/;
    if (!phone) {
      showFieldError('error-phone', 'quote.error.required');
      isValid = false;
    } else if (!phoneRegex.test(phoneDigits)) {
      showFieldError('error-phone', 'quote.error.phone_invalid');
      isValid = false;
    }

    // Product: required
    var productId = document.getElementById('quote-product').value.trim();
    if (!productId) {
      showFieldError('error-product', 'quote.error.required');
      isValid = false;
    }

    // Quantity: 1-10000
    var quantity = parseInt(document.getElementById('quote-quantity').value, 10);
    if (isNaN(quantity) || quantity < 1 || quantity > 10000) {
      showFieldError('error-quantity', 'quote.error.quantity_invalid');
      isValid = false;
    }

    // Age Group: required
    var ageGroup = document.getElementById('quote-age-group').value;
    if (!ageGroup) {
      showFieldError('error-age-group', 'quote.error.required');
      isValid = false;
    }

    // Sizes: at least one selected
    var selectedSizes = getSelectedSizes();
    if (selectedSizes.length === 0) {
      showFieldError('error-sizes', 'quote.error.sizes_required');
      isValid = false;
    }

    // hCaptcha: must be completed
    if (!captchaToken) {
      showFieldError('error-captcha', 'quote.error.captcha');
      isValid = false;
    }

    return isValid;
  }

  /**
   * Get selected size checkboxes for the current age group.
   * @returns {string[]}
   */
  function getSelectedSizes() {
    var ageGroup = document.getElementById('quote-age-group').value;
    if (!ageGroup) return [];

    var containerId = 'sizes-' + ageGroup;
    var container = document.getElementById(containerId);
    if (!container) return [];

    var checkboxes = container.querySelectorAll('input[name="sizes"]:checked');
    var sizes = [];
    for (var i = 0; i < checkboxes.length; i++) {
      sizes.push(checkboxes[i].value);
    }
    return sizes;
  }

  /**
   * Set the form to a loading state.
   * @param {boolean} loading
   */
  function setLoading(loading) {
    isSubmitting = loading;
    submitBtn.disabled = loading;

    if (loading) {
      submitBtn.innerHTML =
        '<svg class="animate-spin h-5 w-5 text-brand-blue" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
        '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>' +
        '</svg>' +
        '<span>' + I18n.t('quote.submitting') + '</span>';
    } else {
      submitBtn.textContent = I18n.t('quote.submit');
    }
  }

  /**
   * Show the success panel with tracking number.
   * @param {string} trackingNumber
   */
  function showSuccess(trackingNumber) {
    form.classList.add('hidden');
    errorBanner.classList.add('hidden');
    successPanel.classList.remove('hidden');
    successMessage.textContent = I18n.t('quote.success', { trackingNumber: trackingNumber });
  }

  /**
   * Show an error banner with a message.
   * @param {string} messageKey - Translation key or literal message
   * @param {object} [params] - Interpolation params
   */
  function showErrorBanner(messageKey, params) {
    errorBanner.classList.remove('hidden');
    errorBannerMessage.textContent = I18n.t(messageKey, params);
    errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Submit the form to the Quote API.
   */
  function submitForm() {
    if (isSubmitting) return;
    if (!validateForm()) return;

    setLoading(true);

    var phone = document.getElementById('quote-phone').value.trim().replace(/[\s\-()]/g, '');
    var payload = {
      clientName: sanitize(document.getElementById('quote-name').value.trim()),
      email: sanitize(document.getElementById('quote-email').value.trim()),
      phone: phone,
      productId: document.getElementById('quote-product').value.trim(),
      quantity: parseInt(document.getElementById('quote-quantity').value, 10),
      ageGroup: document.getElementById('quote-age-group').value,
      sizes: getSelectedSizes(),
      customizationNotes: sanitize(document.getElementById('quote-notes').value.trim()) || undefined,
      captchaToken: captchaToken
    };

    // Remove undefined fields
    if (!payload.customizationNotes) {
      delete payload.customizationNotes;
    }

    var abortController = new AbortController();
    var timeoutId = setTimeout(function () {
      abortController.abort();
    }, SUBMIT_TIMEOUT_MS);

    fetch(QUOTE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal
    })
      .then(function (response) {
        clearTimeout(timeoutId);
        if (response.status === 201) {
          return response.json().then(function (data) {
            showSuccess(data.trackingNumber);
          });
        } else if (response.status === 429) {
          return response.json().then(function (data) {
            var retryAfter = data.retryAfterSeconds || 60;
            showErrorBanner('quote.error.rate_limit', { seconds: String(retryAfter) });
            resetCaptcha();
          });
        } else {
          return response.json().then(function (data) {
            showErrorBanner('quote.error.submit_failed');
            resetCaptcha();
          }).catch(function () {
            showErrorBanner('quote.error.submit_failed');
            resetCaptcha();
          });
        }
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        showErrorBanner('quote.error.submit_failed');
        resetCaptcha();
      })
      .finally(function () {
        setLoading(false);
      });
  }

  /**
   * Reset the hCaptcha widget after a failed submission.
   */
  function resetCaptcha() {
    captchaToken = null;
    if (typeof hcaptcha !== 'undefined') {
      try {
        hcaptcha.reset();
      } catch (e) {
        // Ignore reset errors
      }
    }
  }

  /**
   * Handle age group selection change — show appropriate sizes.
   */
  function onAgeGroupChange() {
    var ageGroup = document.getElementById('quote-age-group').value;
    var sizesContainer = document.getElementById('sizes-container');
    var childrenSizes = document.getElementById('sizes-children');
    var adultSizes = document.getElementById('sizes-adult');

    // Uncheck all sizes when age group changes
    var allCheckboxes = sizesContainer.querySelectorAll('input[name="sizes"]');
    for (var i = 0; i < allCheckboxes.length; i++) {
      allCheckboxes[i].checked = false;
    }

    if (ageGroup === 'children') {
      sizesContainer.classList.remove('hidden');
      childrenSizes.classList.remove('hidden');
      adultSizes.classList.add('hidden');
    } else if (ageGroup === 'adult') {
      sizesContainer.classList.remove('hidden');
      childrenSizes.classList.add('hidden');
      adultSizes.classList.remove('hidden');
    } else {
      sizesContainer.classList.add('hidden');
      childrenSizes.classList.add('hidden');
      adultSizes.classList.add('hidden');
    }

    clearFieldError('error-sizes');
  }

  /**
   * Pre-fill product ID from URL parameter.
   */
  function prefillProductFromURL() {
    var params = new URLSearchParams(window.location.search);
    var productId = params.get('product');
    if (productId) {
      var input = document.getElementById('quote-product');
      input.value = productId;
    }
  }

  /**
   * Update character count for notes textarea.
   */
  function updateCharCount() {
    var notes = document.getElementById('quote-notes');
    var count = document.getElementById('notes-char-count');
    if (notes && count) {
      count.textContent = notes.value.length;
    }
  }

  /**
   * Check if hCaptcha script is loaded and available.
   * If not, show unavailable message and disable submit.
   */
  function checkCaptchaAvailability() {
    // Give hCaptcha some time to load (it's async)
    var checkInterval = setInterval(function () {
      if (typeof hcaptcha !== 'undefined') {
        captchaReady = true;
        clearInterval(checkInterval);
        return;
      }
    }, 500);

    // After 10 seconds, if still not loaded, show unavailable message
    setTimeout(function () {
      if (!captchaReady) {
        clearInterval(checkInterval);
        captchaUnavailablePanel.classList.remove('hidden');
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-disabled', 'true');
      }
    }, 10000);
  }

  /**
   * Initialize the quote form.
   */
  function init() {
    form = document.getElementById('quote-form');
    submitBtn = document.getElementById('quote-submit-btn');
    successPanel = document.getElementById('quote-success');
    successMessage = document.getElementById('quote-success-message');
    errorBanner = document.getElementById('quote-error-banner');
    errorBannerMessage = document.getElementById('quote-error-banner-message');
    captchaUnavailablePanel = document.getElementById('captcha-unavailable');

    if (!form) return;

    // Pre-fill product from URL
    prefillProductFromURL();

    // Age group change handler
    var ageGroupSelect = document.getElementById('quote-age-group');
    ageGroupSelect.addEventListener('change', onAgeGroupChange);

    // Notes character counter
    var notesField = document.getElementById('quote-notes');
    notesField.addEventListener('input', updateCharCount);

    // Form submit handler
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitForm();
    });

    // Clear field errors on input
    var inputs = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('input', function () {
        var errorId = 'error-' + this.id.replace('quote-', '');
        clearFieldError(errorId);
      });
    }

    // Check hCaptcha availability
    checkCaptchaAvailability();
  }

  // hCaptcha callbacks (global scope)
  window.onCaptchaSuccess = function (token) {
    captchaToken = token;
    clearFieldError('error-captcha');
  };

  window.onCaptchaExpired = function () {
    captchaToken = null;
  };

  window.onCaptchaError = function () {
    captchaToken = null;
    captchaUnavailablePanel.classList.remove('hidden');
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-disabled', 'true');
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
