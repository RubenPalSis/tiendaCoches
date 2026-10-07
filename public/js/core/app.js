// Arranque común de todas las páginas públicas: catálogo, cabecera, pie, carrito y estadísticas.
import { getCatalog, STATIC_MODE, DEMO_MESSAGE } from './api.js';
import { qs, on } from './dom.js';
import * as cart from '../services/cart.js';
import { track } from '../services/tracker.js';
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { createCartDrawer } from '../components/cart-drawer.js';
import { toast } from '../components/toast.js';

const FALLBACK_CATALOG = {
  products: [], categories: [], store: { name: 'Tienda', tagline: '', topbar: [] },
  shipping: { zones: [], carrier: 'GLS' }, checkout: { enabled: true, maxQtyPerLine: 10 },
};

let cartDrawer;

/** Lee la cantidad elegida en la ficha de producto, si el botón pertenece a ella. */
function selectedQty(button) {
  if (!button.closest('#buy-box') && !button.hasAttribute('data-buy-bar')) return 1;
  const value = parseInt(qs('#qty')?.value ?? '1', 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function bindAddToCart(catalog) {
  on(document, 'click', '[data-add-to-cart]', (event, button) => {
    event.preventDefault();
    const product = catalog.products.find((p) => p.id === button.dataset.addToCart);
    if (!product || product.stock <= 0) {
      toast('Este producto ya no está disponible.', { type: 'error' });
      return;
    }
    const { added, limited } = cart.add(product, selectedQty(button), catalog.checkout?.maxQtyPerLine);
    if (!added) {
      toast(`Ya tienes en el carrito todas las unidades disponibles de este producto.`, { type: 'error' });
      return;
    }
    track('cart', product.id);
    if (limited) toast('Hemos añadido solo las unidades disponibles.', { type: 'info' });
    button.classList.add('is-done');
    setTimeout(() => button.classList.remove('is-done'), 1200);
    cartDrawer?.open();
  });
}

/**
 * @returns {Promise<{ catalog: object, error?: Error }>}
 */
export async function initApp() {
  let catalog;
  let error;
  try {
    catalog = await getCatalog();
  } catch (err) {
    error = err;
    catalog = FALLBACK_CATALOG;
  }

  // Títulos genéricos de las páginas estáticas → nombre real de la tienda.
  if (catalog.store?.name) document.title = document.title.replace('Tienda online', catalog.store.name);
  if (STATIC_MODE) catalog.checkout = { ...catalog.checkout, enabled: false, closedMessage: DEMO_MESSAGE };

  cartDrawer = createCartDrawer(catalog);
  renderHeader(catalog, { onOpenCart: () => cartDrawer.open() });
  renderFooter(catalog);
  bindAddToCart(catalog);
  track('pv');

  if (error) toast('No hemos podido cargar el catálogo. Recarga la página en unos segundos.', { type: 'error', timeout: 8000 });
  return { catalog, error };
}

export { toast };
