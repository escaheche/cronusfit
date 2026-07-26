/**
 * CronusFit Products Filter
 *
 * Client-side filtering and pagination for the product listing page.
 * Filters by Garment_Type and Age_Group (independent or combined).
 * Max 50 products per page with prev/next pagination controls.
 * Updates displayed products without page reload.
 */

// eslint-disable-next-line no-var
var ProductsFilter = (function () {
  'use strict';

  var PRODUCTS_PER_PAGE = 50;

  /** @type {HTMLElement[]} */
  var allCards = [];

  /** @type {HTMLElement[]} */
  var filteredCards = [];

  /** @type {number} */
  var currentPage = 1;

  /** @type {number} */
  var totalPages = 1;

  // DOM elements
  /** @type {HTMLSelectElement|null} */
  var garmentTypeSelect = null;

  /** @type {HTMLSelectElement|null} */
  var ageGroupSelect = null;

  /** @type {HTMLElement|null} */
  var resultsCountEl = null;

  /** @type {HTMLElement|null} */
  var productsGrid = null;

  /** @type {HTMLElement|null} */
  var emptyStateNoResults = null;

  /** @type {HTMLElement|null} */
  var paginationControls = null;

  /** @type {HTMLButtonElement|null} */
  var prevBtn = null;

  /** @type {HTMLButtonElement|null} */
  var nextBtn = null;

  /** @type {HTMLElement|null} */
  var paginationInfo = null;

  /**
   * Initialize the filter system.
   * Called when DOM is ready.
   */
  function init() {
    // Cache DOM references
    garmentTypeSelect = document.getElementById('filter-garment-type');
    ageGroupSelect = document.getElementById('filter-age-group');
    resultsCountEl = document.getElementById('filter-results-count');
    productsGrid = document.getElementById('products-grid');
    emptyStateNoResults = document.getElementById('empty-state-no-results');
    paginationControls = document.getElementById('pagination-controls');
    prevBtn = document.getElementById('pagination-prev');
    nextBtn = document.getElementById('pagination-next');
    paginationInfo = document.getElementById('pagination-info');

    // If no grid exists (no products published), nothing to filter
    if (!productsGrid) {
      return;
    }

    // Collect all product cards
    allCards = Array.prototype.slice.call(
      productsGrid.querySelectorAll('.product-card')
    );

    if (allCards.length === 0) {
      return;
    }

    // Bind filter events
    if (garmentTypeSelect) {
      garmentTypeSelect.addEventListener('change', onFilterChange);
    }
    if (ageGroupSelect) {
      ageGroupSelect.addEventListener('change', onFilterChange);
    }

    // Bind pagination events
    if (prevBtn) {
      prevBtn.addEventListener('click', onPrevPage);
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', onNextPage);
    }

    // Initial filter application
    applyFilters();
  }

  /**
   * Handle filter dropdown change.
   */
  function onFilterChange() {
    currentPage = 1;
    applyFilters();
  }

  /**
   * Apply current filters and update display.
   */
  function applyFilters() {
    var garmentType = garmentTypeSelect ? garmentTypeSelect.value : '';
    var ageGroup = ageGroupSelect ? ageGroupSelect.value : '';

    // Filter cards based on data attributes
    filteredCards = allCards.filter(function (card) {
      var cardGarmentType = card.getAttribute('data-garment-type') || '';
      var cardAgeGroup = card.getAttribute('data-age-group') || '';

      var matchesGarment = !garmentType || cardGarmentType === garmentType;
      var matchesAge = !ageGroup || cardAgeGroup === ageGroup;

      return matchesGarment && matchesAge;
    });

    // Calculate pagination
    totalPages = Math.max(1, Math.ceil(filteredCards.length / PRODUCTS_PER_PAGE));
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }

    // Update display
    updateProductDisplay();
    updateResultsCount();
    updatePagination();
    updateEmptyState();
  }

  /**
   * Show/hide product cards based on current filter and pagination state.
   */
  function updateProductDisplay() {
    var startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
    var endIndex = startIndex + PRODUCTS_PER_PAGE;

    // Hide all cards first
    for (var i = 0; i < allCards.length; i++) {
      allCards[i].style.display = 'none';
    }

    // Show only filtered cards for the current page
    for (var j = 0; j < filteredCards.length; j++) {
      if (j >= startIndex && j < endIndex) {
        filteredCards[j].style.display = '';
      }
    }

    // Show/hide the grid based on whether there are results
    if (productsGrid) {
      productsGrid.style.display = filteredCards.length > 0 ? '' : 'none';
    }
  }

  /**
   * Update the results count display.
   */
  function updateResultsCount() {
    if (!resultsCountEl) {
      return;
    }

    var count = filteredCards.length;

    // Use the i18n system if available, otherwise use a fallback
    if (typeof I18n !== 'undefined' && I18n.t) {
      resultsCountEl.textContent = I18n.t('filter.results_count', { count: String(count) });
    } else {
      resultsCountEl.textContent = count + ' productos encontrados';
    }

    // Keep the data-i18n attribute for dynamic language switching
    resultsCountEl.setAttribute('data-i18n', 'filter.results_count');
    resultsCountEl.setAttribute('data-i18n-params', JSON.stringify({ count: String(count) }));
  }

  /**
   * Update pagination controls visibility and state.
   */
  function updatePagination() {
    if (!paginationControls) {
      return;
    }

    // Hide pagination if only one page or no results
    if (totalPages <= 1) {
      paginationControls.style.display = 'none';
      return;
    }

    paginationControls.style.display = '';

    // Update prev/next button states
    if (prevBtn) {
      prevBtn.disabled = currentPage <= 1;
    }
    if (nextBtn) {
      nextBtn.disabled = currentPage >= totalPages;
    }

    // Update page info text
    if (paginationInfo) {
      paginationInfo.textContent = currentPage + ' / ' + totalPages;
    }
  }

  /**
   * Update empty state visibility.
   */
  function updateEmptyState() {
    if (!emptyStateNoResults) {
      return;
    }

    var hasActiveFilters = (garmentTypeSelect && garmentTypeSelect.value !== '') ||
                           (ageGroupSelect && ageGroupSelect.value !== '');

    if (filteredCards.length === 0 && hasActiveFilters) {
      emptyStateNoResults.classList.remove('hidden');
    } else {
      emptyStateNoResults.classList.add('hidden');
    }
  }

  /**
   * Navigate to the previous page.
   */
  function onPrevPage() {
    if (currentPage > 1) {
      currentPage--;
      updateProductDisplay();
      updatePagination();
      scrollToTop();
    }
  }

  /**
   * Navigate to the next page.
   */
  function onNextPage() {
    if (currentPage < totalPages) {
      currentPage++;
      updateProductDisplay();
      updatePagination();
      scrollToTop();
    }
  }

  /**
   * Scroll to top of the product grid smoothly.
   */
  function scrollToTop() {
    if (productsGrid) {
      productsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Public API (exposed for testing)
  return {
    init: init,
    applyFilters: applyFilters,
    get currentPage() { return currentPage; },
    get totalPages() { return totalPages; },
    get filteredCount() { return filteredCards.length; },
    get PRODUCTS_PER_PAGE() { return PRODUCTS_PER_PAGE; }
  };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    ProductsFilter.init();
  });
} else {
  ProductsFilter.init();
}
