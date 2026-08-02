/**
 * CronusFit Quote Form - Versión mejorada con mejor manejo de hCaptcha
 */
(function () {
  'use strict';

  var QUOTE_API_URL = 'https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod/quotes';
  var SUBMIT_TIMEOUT_MS = 30000;
  var captchaToken = null;
  var isSubmitting = false;
  var hcaptchaWidgetId = null;
  var form, submitBtn, successPanel, successMessage, errorBanner, errorBannerMessage;

  // Funciones de utilidad
  function sanitize(input) {
    if (!input) return '';
    var stripped = input.replace(/<[^>]*>/g, '');
    return stripped.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  function showFieldError(fieldId, message) {
    var el = document.getElementById(fieldId);
    if (!el) return;
    el.textContent = message;
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

  // Validación del formulario
  function validateForm() {
    var isValid = true;
    clearAllErrors();

    var name = document.getElementById('quote-name').value.trim();
    if (!name || name.length < 1 || name.length > 100) {
      showFieldError('error-name', 'El nombre es obligatorio');
      isValid = false;
    }

    var email = document.getElementById('quote-email').value.trim();
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      showFieldError('error-email', 'El email es obligatorio');
      isValid = false;
    } else if (!emailRegex.test(email)) {
      showFieldError('error-email', 'Email inválido');
      isValid = false;
    }

    var phone = document.getElementById('quote-phone').value.trim();
    var phoneDigits = phone.replace(/[\s\-()]/g, '');
    var phoneRegex = /^\+?\d{7,15}$/;
    if (!phone) {
      showFieldError('error-phone', 'El teléfono es obligatorio');
      isValid = false;
    } else if (!phoneRegex.test(phoneDigits)) {
      showFieldError('error-phone', 'Teléfono inválido');
      isValid = false;
    }

    var productId = document.getElementById('quote-product').value.trim();
    if (!productId) {
      showFieldError('error-product', 'El producto es obligatorio');
      isValid = false;
    }

    var quantity = parseInt(document.getElementById('quote-quantity').value, 10);
    if (isNaN(quantity) || quantity < 1 || quantity > 10000) {
      showFieldError('error-quantity', 'Cantidad inválida');
      isValid = false;
    }

    var ageGroup = document.getElementById('quote-age-group').value;
    if (!ageGroup) {
      showFieldError('error-age-group', 'Selecciona un grupo etario');
      isValid = false;
    }

    var selectedSizes = getSelectedSizes();
    if (selectedSizes.length === 0) {
      showFieldError('error-sizes', 'Selecciona al menos una talla');
      isValid = false;
    }

    // CRÍTICO: Obtener token de hCaptcha
    try {
      if (typeof hcaptcha !== 'undefined') {
        captchaToken = hcaptcha.getResponse();
      }
    } catch (e) {
      console.error('Error obteniendo token hCaptcha:', e);
      captchaToken = null;
    }
    
    if (!captchaToken) {
      showFieldError('error-captcha', 'Por favor completa la verificación CAPTCHA');
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
    successMessage.textContent = '¡Solicitud enviada! Tu número de seguimiento es: ' + trackingNumber;
  }

  function showErrorBanner(message) {
    if (!errorBanner) return;
    errorBanner.classList.remove('hidden');
    errorBannerMessage.textContent = message;
    errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetCaptcha() {
    captchaToken = null;
    if (typeof hcaptcha !== 'undefined' && typeof hcaptcha.reset === 'function') {
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

    console.log('Enviando cotización:', payload);

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
        console.log('Respuesta API:', response.status);
        if (response.status === 201) {
          return response.json().then(function (data) {
            showSuccess(data.trackingNumber);
          });
        } else if (response.status === 429) {
          showErrorBanner('Demasiados intentos. Espera unos minutos.');
          resetCaptcha();
        } else {
          return response.json().then(function (data) {
            showErrorBanner('Error: ' + (data.message || 'Intenta de nuevo'));
            resetCaptcha();
          }).catch(function () {
            showErrorBanner('Error al enviar. Intenta de nuevo.');
            resetCaptcha();
          });
        }
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        console.error('Error en fetch:', err);
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

    if (!form) {
      console.error('Formulario no encontrado');
      return;
    }

    // Pre-llenar producto desde URL
    var params = new URLSearchParams(window.location.search);
    var productId = params.get('product');
    if (productId) {
      var input = document.getElementById('quote-product');
      if (input) input.value = productId;
    }

    // Age group change
    var ageGroupSelect = document.getElementById('quote-age-group');
    if (ageGroupSelect) {
      ageGroupSelect.addEventListener('change', onAgeGroupChange);
    }

    // Character counter
    var notesField = document.getElementById('quote-notes');
    var notesCharCount = document.getElementById('notes-char-count');
    if (notesField && notesCharCount) {
      notesField.addEventListener('input', function () {
        notesCharCount.textContent = notesField.value.length;
      });
    }

    // Form submit
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitForm();
    });

    // Clear errors on input
    var inputs = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('input', function () {
        var errorId = 'error-' + this.id.replace('quote-', '');
        clearFieldError(errorId);
      });
    }

    // Verificar hCaptcha después de cargar
    setTimeout(function checkHCaptcha() {
      if (typeof hcaptcha !== 'undefined') {
        console.log('hCaptcha cargado correctamente');
        // Renderizar explícitamente si es necesario
        if (!hcaptchaWidgetId) {
          try {
            hcaptchaWidgetId = hcaptcha.render('hcaptcha-widget', {
              sitekey: '3e2ae7d0-297c-4b58-8160-7546c482c552',
              callback: function (token) {
                console.log('Token hCaptcha obtenido');
                captchaToken = token;
                clearFieldError('error-captcha');
              },
              'expired-callback': function () {
                captchaToken = null;
                showFieldError('error-captcha', 'El CAPTCHA expiró');
              },
              'error-callback': function () {
                captchaToken = null;
                showFieldError('error-captcha', 'Error con el CAPTCHA');
              }
            });
          } catch (e) {
            console.error('Error renderizando hCaptcha:', e);
          }
        }
      } else {
        console.warn('hCaptcha aún no cargado, reintentando...');
        setTimeout(checkHCaptcha, 500);
      }
    }, 1000);
  }

  // Inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();