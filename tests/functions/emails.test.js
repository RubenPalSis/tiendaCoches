// Las plantillas de email se generan sin errores y escapan los datos del cliente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const t = await import('../../functions/src/email/templates.js');

const store = { name: 'Recambios <Demo>', ownerName: 'Nombre', taxId: '000', email: 'a@b.es', phone: '600' };
const order = {
  id: 'x', number: '2026-00001', total: 4585, subtotal: 3990, shippingCost: 595,
  customer: { firstName: '<script>alert(1)</script>', lastName: 'G', email: 'c@d.es', phone: '600' },
  shippingAddress: { line1: 'C/ Mayor 1', line2: '', postalCode: '28013', city: 'Madrid', province: 'Madrid', country: 'ES', notes: 'Timbre 2' },
  items: [{ name: 'Faro & piloto', reference: 'R1', quantity: 1, unitPrice: 3990 }],
  shipping: { carrier: 'GLS', trackingNumber: 'ABC123', trackingUrl: 'https://gls.test/t?n=ABC123', deliveryTime: '24-72h' },
};

test('plantillas de email: confirmación, envío, cancelación, vendedor y desistimiento', () => {
  const all = [
    t.orderConfirmationEmail(store, order, 'https://tienda.test/pedido?n=x&t=y'),
    t.orderShippedEmail(store, order, 'https://tienda.test/pedido?numero=2026-00001'),
    t.orderCancelledEmail(store, order, true),
    t.sellerNewOrderEmail(store, order, 'https://tienda.test/admin'),
    t.withdrawalReceiptEmail(store, order, 'No me vale', new Date()),
    t.sellerWithdrawalEmail(store, order, 'No me vale'),
  ];
  for (const m of all) {
    assert.ok(m.subject && m.html && m.text);
    assert.ok(!m.html.includes('<script>'), 'datos del cliente escapados');
  }
  assert.match(all[0].html, /45,85/);
  assert.match(all[1].html, /ABC123/);
  assert.match(all[1].html, /gls\.test/);
});
