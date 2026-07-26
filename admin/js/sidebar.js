/**
 * sidebar.js — Sidebar Navigation
 * Admin Panel CronusFit
 *
 * Renders the nav items, handles active state, badge updates, and mobile hamburger.
 * Req: 2.5, 2.6, 2.7, 6.7
 */

// ── Navigation items definition ─────────────────────────────────────────────

const NAV_ITEMS = [
  {
    hash: '#patrones',
    label: 'Patrones',
    icon: `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                   d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414
                      A1 1 0 0121 9.414V19a2 2 0 01-2 2z"/>
           </svg>`,
    badge: false,
  },
  {
    hash: '#cotizaciones',
    label: 'Cotizaciones',
    icon: `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                   d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
                      M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
           </svg>`,
    badge: false,
  },
  {
    hash: '#mockups',
    label: 'Mockups',
    icon: `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                   d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14
                      m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
           </svg>`,
    badge: false,
  },
  {
    hash: '#aprobaciones',
    label: 'Aprobaciones',
    icon: `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                   d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
           </svg>`,
    badge: true,
  },
  {
    hash: '#publicaciones',
    label: 'Publicaciones',
    icon: `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                   d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945
                      M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064
                      M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
           </svg>`,
    badge: false,
  },
  {
    hash: '#redes',
    label: 'Redes Sociales',
    icon: `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                   d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342
                      m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316
                      m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684
                      3 3 0 00-5.368-2.684z"/>
           </svg>`,
    badge: false,
  },
];

// ── Sidebar module ───────────────────────────────────────────────────────────

const Sidebar = {
  /**
   * Render nav items into #sidebar-nav and wire mobile hamburger.
   * Called once by app.js on DOMContentLoaded.
   */
  init() {
    Sidebar._renderNav();
    Sidebar._wireHamburger();
    Sidebar._wireLogout();
  },

  _renderNav() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    nav.innerHTML = NAV_ITEMS.map(item => `
      <a href="${item.hash}"
         data-nav-hash="${item.hash}"
         class="nav-item flex items-center gap-3 px-4 py-2.5 mx-2 rounded-xl text-white/75
                hover:text-white hover:bg-white/10 transition-all duration-150 text-sm font-medium
                focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
         aria-label="${item.label}">
        ${item.icon}
        <span class="flex-1">${item.label}</span>
        ${item.badge
          ? `<span data-badge="${item.hash}"
                   class="hidden items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full
                          bg-brand-gold text-brand-blue text-xs font-bold">
              0
            </span>`
          : ''
        }
      </a>
    `).join('');
  },

  /**
   * Mark the nav item matching `hash` as active.
   * Removes nav-active from all others.
   * @param {string} hash — e.g. '#patrones'
   */
  setActive(hash) {
    document.querySelectorAll('[data-nav-hash]').forEach(el => {
      const isActive = el.dataset.navHash === hash;
      el.classList.toggle('nav-active', isActive);
      // Remove default hover styles when active
      if (isActive) {
        el.classList.remove('text-white/75', 'hover:text-white', 'hover:bg-white/10');
      } else {
        el.classList.add('text-white/75', 'hover:text-white', 'hover:bg-white/10');
      }
    });
  },

  /**
   * Update the badge counter for a nav item.
   * Shows the badge if count > 0, hides it if count === 0.
   * @param {string} hash — e.g. '#aprobaciones'
   * @param {number} count
   */
  updateBadge(hash, count) {
    const badge = document.querySelector(`[data-badge="${hash}"]`);
    if (!badge) return;

    badge.textContent = count;

    if (count > 0) {
      badge.classList.remove('hidden');
      badge.classList.add('inline-flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('inline-flex');
    }
  },

  // ── Mobile hamburger ───────────────────────────────────────────────────────

  _wireHamburger() {
    const hamburger = document.getElementById('btn-hamburger');
    const sidebar   = document.getElementById('sidebar');
    const overlay   = document.getElementById('sidebar-overlay');

    if (!hamburger || !sidebar) return;

    hamburger.addEventListener('click', () => {
      const isOpen = !sidebar.classList.contains('-translate-x-full');
      if (isOpen) {
        Sidebar._closeMobileSidebar(sidebar, overlay, hamburger);
      } else {
        Sidebar._openMobileSidebar(sidebar, overlay, hamburger);
      }
    });

    overlay?.addEventListener('click', () => {
      Sidebar._closeMobileSidebar(sidebar, overlay, hamburger);
    });

    // Close sidebar when a nav item is selected on mobile
    document.querySelectorAll('[data-nav-hash]').forEach(el => {
      el.addEventListener('click', () => {
        if (window.innerWidth < 768) {
          Sidebar._closeMobileSidebar(sidebar, overlay, hamburger);
        }
      });
    });
  },

  _openMobileSidebar(sidebar, overlay, hamburger) {
    sidebar.classList.remove('-translate-x-full');
    overlay?.classList.remove('hidden');
    hamburger?.setAttribute('aria-expanded', 'true');
    // Trap focus inside sidebar
    sidebar.focus?.();
  },

  _closeMobileSidebar(sidebar, overlay, hamburger) {
    sidebar.classList.add('-translate-x-full');
    overlay?.classList.add('hidden');
    hamburger?.setAttribute('aria-expanded', 'false');
  },

  // ── Logout ─────────────────────────────────────────────────────────────────

  _wireLogout() {
    const logoutBtn = document.getElementById('btn-logout');
    if (!logoutBtn) return;

    logoutBtn.addEventListener('click', () => {
      if (typeof AuthGuard !== 'undefined') {
        AuthGuard.clear('logout');
      } else {
        sessionStorage.removeItem('cf_jwt');
        location.hash = '#login';
      }
    });
  },
};

window.Sidebar = Sidebar;
