/**
 * CronusFit Quote Form
 */
(function () {
  'use strict';

  var QUOTE_API_URL = 'https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod/quotes';
  var SUBMIT_TIMEOUT_MS = 30000;
  var captchaToken = null;
  var isSubmitting = false;
  var form, submitBtn, successPanel, successMessage, errorBanner, errorBannerMessage, captchaUnavailablePanel;

  function sanitize(input) {
    if (!input) return '';
    var stripped = input.replace(/<[^>]*>/g, '');
    stripped = stripped
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
    return stripped;
  }

  function showFieldError(fieldId, messageKey) {
    var el = document.getElementById(fieldId);
    if (!el) return;
    el.textContent = I18n ? I18n.t(messageKey) : messageKey;
    el.classList.remove('hidden');
    var inputId = fieldId.replace('error-', 'quote-');
    var input = document.getElementById(inputId);
    if (input) {
      input.classList.add('border-red-500');
      input.setAttribute('aria-invalid', 'true');
    }
  }

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

  function clearAllErrors() {
    ['error-name', 'error-email', 'error-phone', 'error-product', 'error-quantity', 'error-age-group', 'error-sizes', 'error-captcha'].forEach(clearFieldError);
    if (errorBanner) errorBanner.classList.add('hidden');
  }

  function validateForm() {
    var isValid = true;
    clearAllErrors();

    var name = document.getElementById('quote-name').value.trim();
    if (!name || name.length < 1 || name.length > 100) {
      showFieldError('error-name', 'quote.error.required');
      isValid = false;
    }

    var email = document.getElementById('quote-email').value.trim();
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      showFieldError('error-email', 'quote.error.required');
      isValid = false;
    } else if (!emailRegex.test(email)) {
      showFieldError('error-email', 'quote.error.email_invalid');
      isValid = false;
    }

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

    var productId = document.getElementById('quote-product').value.trim();
    if (!productId) {
      showFieldError('error-product', 'quote.error.required');
      isValid = false;
    }

    var quantity = parseInt(document.getElementById('quote-quantity').value, 10);
    if (isNaN(quantity) || quantity < 1 || quantity > 10000) {
      showFieldError('error-quantity', 'quote.error.quantity_invalid');
      isValid = false;
    }

    var ageGroup = document.getElementById('quote-age-group').value;
    if (!ageGroup) {
      showFieldError('error-age-group', 'quote.error.required');
      isValid = false;
    }

    var selectedSizes = getSelectedSizes();
    if (selectedSizes.length === 0) {
      showFieldError('error-sizes', 'quote.error.sizes_required');
      isValid = false;
    }

    // CRÍTICO: Obtener token de hCaptcha directamente
    if (typeof hcaptcha !== 'undefined') {
      try {
        captchaToken = hcaptcha.getResponse();
      } catch (e) {
        captchaToken = null;
      }
    }
    
    if (!captchaToken) {
      showFieldError('error-captcha', 'quote.error.captcha');
      isValid = false;
    }

    return isValid;
  }

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

  function setLoading(loading) {
    isSubmitting = loading;
    submitBtn.disabled = loading;
    if (loading) {
      submitBtn.innerHTML = '<svg class="animate-spin h-5 w-5 text-brand-blue" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span>Enviando...</span>';
    } else {
      submitBtn.textContent = 'Enviar Solicitud';
    }
  }

  function showSuccess(trackingNumber) {
    form.classList.add('hidden');
    if (errorBanner) errorBanner.classList.add('hidden');
    successPanel.classList.remove('hidden');
    successMessage.textContent = '¡Solicitud enviada con éxito! Tu número de seguimiento es: ' + trackingNumber;
  }

  function showErrorBanner(message) {
    if (!errorBanner) return;
    errorBanner.classList.remove('hidden');
    errorBannerMessage.textContent = message;
    errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetCaptcha() {
    captchaToken = null;
    if (typeof hcaptcha !== 'undefined') {
      try {
        hcaptcha.reset();
      } catch (e) { /* ignore */ }
    }
  }

  function onAgeGroupChange() {
    var ageGroup = document.getElementById('quote-age-group').value;
    var sizesContainer = document.getElementById('sizes-container');
    var childrenSizes = document.getElementById('sizes-children');
    var adultSizes = document.getElementById('sizes-adult');
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
    }
    clearFieldError('error-sizes');
  }

  function prefillProductFromURL() {
    var params = new URLSearchParams(window.location.search);
    var productId = params.get('product');
    if (productId) {
      var input = document.getElementById('quote-product');
      input.value = productId;
    }
  }

  function updateCharCount() {
    var notes = document.getElementById('quote-notes');
    var count = document.getElementById('notes-char-count');
    if (notes && count) {
      count.textContent = notes.value.length;
    }
  }

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
            showErrorBanner('Límite excedido. Intenta en ' + retryAfter + ' segundos');
            resetCaptcha();
          });
        } else {
          return response.json().then(function (data) {
            showErrorBanner('Error al enviar. Intenta de nuevo.');
            resetCaptcha();
          }).catch(function () {
            showErrorBanner('Error al enviar. Intenta de nuevo.');
            resetCaptcha();
          });
        }
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        showErrorBanner('Error de conexión. Verifica tu internet.');
        resetCaptcha();
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function init() {
    form = document.getElementById('quote-form');
    submitBtn = document.getElementById('quote-submit-btn');
    successPanel = document.getElementById('quote-success');
    successMessage = document.getElementById('quote-success-message');
    errorBanner = document.getElementById('quote-error-banner');
    errorBannerMessage = document.getElementById('quote-error-banner-message');
    captchaUnavailablePanel = document.getElementById('captcha-unavailable');

    if (!form) return;

    prefillProductFromURL();

    var ageGroupSelect = document.getElementById('quote-age-group');
    ageGroupSelect.addEventListener('change', onAgeGroupChange);

    var notesField = document.getElementById('quote-notes');
    notesField.addEventListener('input', updateCharCount);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitForm();
    });

    var inputs = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('input', function () {
        var errorId = 'error-' + this.id.replace('quote-', '');
        clearFieldError(errorId);
      });
    }
  }

  // Callbacks globales para hCaptcha
  window.onCaptchaSuccess = function (token) {
    captchaToken = token;
    clearFieldError('error-captcha');
  };

  window.onCaptchaExpired = function () {
    captchaToken = null;
  };

  window.onCaptchaError = function () {
    captchaToken = null;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();