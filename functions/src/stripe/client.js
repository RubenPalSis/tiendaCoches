import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '../lib/config.js';
import { PublicError } from '../lib/http.js';

let client;
let testOverride;

/** Cliente de Stripe (perezoso). Los tests pueden inyectar un doble con setStripeForTests. */
export function getStripe() {
  if (testOverride) return testOverride;
  const key = STRIPE_SECRET_KEY.value();
  if (!key || !key.startsWith('sk_') || /dummy|pendiente/.test(key)) {
    throw new PublicError(503, 'payments_not_configured', 'Los pagos todavía no están configurados en esta tienda.');
  }
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

export function setStripeForTests(fake) {
  testOverride = fake;
}
