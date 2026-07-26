/**
 * sections/login.js — Login View
 * Admin Panel CronusFit
 *
 * Renders the Cognito-backed login form with WCAG 2.1 AA compliance:
 * - Explicit <label for="..."> on every input
 * - Visible focus ring via focus:ring-4 focus:ring-brand-gold/40
 * - Error span with role="alert" aria-live="assertive"
 */

const LoginSection = {
  render() {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    appContent.innerHTML = `
      <div class="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div class="w-full max-w-md">

          <!-- Brand card -->
          <div class="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 sm:p-10">

            <!-- Logo + title -->
            <div class="text-center mb-8">
              <img src="../assets/images/logo-cronusfit.png"
                   alt="CronusFit"
                   class="h-16 w-auto mx-auto mb-4">
              <h1 class="text-2xl font-bold text-brand-blue">CronusFit</h1>
              <p class="text-brand-gold text-xs font-semibold uppercase tracking-[0.2em] mt-1">
                Panel de Administración
              </p>
            </div>

            <!-- Login form -->
            <form id="login-form" novalidate>

              <!-- Error alert -->
              <span id="login-error"
                    role="alert"
                    aria-live="assertive"
                    class="hidden block text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5">
              </span>

              <!-- Username field -->
              <div class="mb-5">
                <label for="login-username"
                       class="block text-sm font-semibold text-gray-700 mb-2">
                  Correo electrónico
                </label>
                <input id="login-username"
                       name="username"
                       type="email"
                       autocomplete="email"
                       required
                       class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 text-sm
                              text-gray-900 placeholder-gray-400
                              focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold
                              transition-colors duration-200"
                       placeholder="admin@cronusfit.cl"
                       aria-required="true">
              </div>

              <!-- Password field -->
              <div class="mb-7">
                <label for="login-password"
                       class="block text-sm font-semibold text-gray-700 mb-2">
                  Contraseña
                </label>
                <input id="login-password"
                       name="password"
                       type="password"
                       autocomplete="current-password"
                       required
                       class="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 text-sm
                              text-gray-900 placeholder-gray-400
                              focus:outline-none focus:ring-4 focus:ring-brand-gold/40 focus:border-brand-gold
                              transition-colors duration-200"
                       placeholder="••••••••"
                       aria-required="true">
              </div>

              <!-- Submit button -->
              <button id="login-submit"
                      type="submit"
                      data-requires-network
                      class="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base">
                <span id="login-btn-text">Iniciar sesión</span>
                <!-- Loading spinner (hidden by default) -->
                <svg id="login-spinner"
                     class="hidden w-5 h-5 animate-spin"
                     fill="none"
                     viewBox="0 0 24 24"
                     aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10"
                          stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </button>

            </form>

            <!-- Brand footer -->
            <p class="text-center text-xs text-gray-400 mt-6">
              CronusFit &copy; ${new Date().getFullYear()} — Acceso restringido
            </p>

          </div>
        </div>
      </div>
    `;

    // Wire up form submission
    const form = document.getElementById('login-form');
    form.addEventListener('submit', LoginSection._handleSubmit);

    // Autofocus username on render
    const usernameInput = document.getElementById('login-username');
    if (usernameInput) usernameInput.focus();
  },

  /**
   * Handle login form submission.
   * Shows loading spinner, calls AuthGuard.login, handles success/failure.
   */
  async _handleSubmit(e) {
    e.preventDefault();

    const username = document.getElementById('login-username')?.value?.trim() ?? '';
    const password = document.getElementById('login-password')?.value ?? '';
    const submitBtn = document.getElementById('login-submit');
    const spinner = document.getElementById('login-spinner');
    const btnText = document.getElementById('login-btn-text');
    const errorSpan = document.getElementById('login-error');

    // Hide any previous error
    if (errorSpan) {
      errorSpan.classList.add('hidden');
      errorSpan.textContent = '';
    }

    if (!username || !password) {
      if (errorSpan) {
        errorSpan.textContent = 'Por favor ingresa tu correo y contraseña.';
        errorSpan.classList.remove('hidden');
      }
      return;
    }

    // Show loading state
    if (submitBtn) submitBtn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Verificando...';

    try {
      await AuthGuard.login(username, password);
      // On success → navigate to #patrones
      location.hash = '#patrones';
    } catch (_err) {
      // On failure → show inline error, stay on #login
      if (errorSpan) {
        errorSpan.textContent = 'Credenciales incorrectas. Verifica tu correo y contraseña.';
        errorSpan.classList.remove('hidden');
      }
    } finally {
      // Always restore button state (only matters on failure; success navigates away)
      if (submitBtn) submitBtn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
      if (btnText) btnText.textContent = 'Iniciar sesión';
    }
  },
};

window.LoginSection = LoginSection;
