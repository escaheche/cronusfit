/**
 * router.js — Hash Router
 * Admin Panel CronusFit
 *
 * Gestiona la navegación SPA sin recarga. Escucha hashchange y DOMContentLoaded.
 * Cualquier fragmento no listado en ROUTES redirige a #patrones.
 */

// Rutas válidas → función de render
// Las secciones se cargan como scripts en index.html antes de este módulo,
// por lo que sus globales (LoginSection, PatronesSection, etc.) están disponibles.
const ROUTES = {
  '#login':         () => LoginSection.render(),
  '#patrones':      () => PatronesSection.render(),
  '#cotizaciones':  () => CotizacionesSection.render(),
  '#mockups':       () => MockupsSection.render(),
  '#aprobaciones':  () => AprobacionesSection.render(),
  '#publicaciones': () => PublicacionesSection.render(),
  '#redes':         () => RedesSection.render(),
};

// Nombres de sección para el #page-title
const SECTION_TITLES = {
  '#login':         'Iniciar sesión',
  '#patrones':      'Patrones',
  '#cotizaciones':  'Cotizaciones',
  '#mockups':       'Mockups',
  '#aprobaciones':  'Aprobaciones',
  '#publicaciones': 'Publicaciones',
  '#redes':         'Redes Sociales',
};

/**
 * Navega a la sección correspondiente al hash dado.
 * - Rutas protegidas pasan por AuthGuard.check() (todo excepto #login).
 * - Fragmentos desconocidos redirigen a #patrones.
 * @param {string} hash — p.ej. '#patrones'
 */
function navigate(hash) {
  // Normalizar: si el hash no existe en ROUTES, redirigir a #patrones
  const resolvedHash = ROUTES[hash] ? hash : '#patrones';

  // Si el hash original no era válido, actualizar la URL y navegar al correcto
  if (resolvedHash !== hash) {
    location.hash = resolvedHash;
    // El hashchange event disparará navigate de nuevo con el hash correcto
    return;
  }

  // Proteger rutas: todo excepto #login requiere JWT válido
  if (resolvedHash !== '#login') {
    AuthGuard.check();
    // Si AuthGuard.check() redirigió a #login, location.hash cambió
    // y el handler de hashchange se encargará del resto. Salir.
    if (location.hash === '#login' && resolvedHash !== '#login') {
      return;
    }
  }

  // Limpiar contenido previo
  const appContent = document.getElementById('app-content');
  if (appContent) {
    appContent.innerHTML = '';
  }

  // Renderizar la sección
  ROUTES[resolvedHash]();

  // Actualizar título de página
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) {
    pageTitle.textContent = SECTION_TITLES[resolvedHash] ?? '';
  }

  // Actualizar sidebar
  if (typeof Sidebar !== 'undefined') {
    Sidebar.setActive(resolvedHash);
  }
}

// Listeners de navegación
window.addEventListener('hashchange', () => navigate(location.hash));

window.addEventListener('DOMContentLoaded', () => {
  navigate(location.hash || '#patrones');
});

// Exportar como global para que otros módulos puedan llamar navigate()
window.Router = { navigate };
