// Emails transaccionales con la API HTTP de Brevo (plan gratuito: 300 emails/día, sin tarjeta).
// Los Workers no pueden abrir conexiones SMTP con facilidad; la API HTTP es más sencilla y fiable.
import { logger } from '../lib/log.js';
import { BREVO_API_KEY } from '../lib/config.js';
import { getSettings } from '../lib/settings.js';

let testTransport;

/** Las pruebas pueden capturar los emails en lugar de enviarlos. */
export function setMailTransportForTests(fn) {
  testTransport = fn;
}

/** Envía un email. Nunca lanza: devuelve true/false para que un fallo de email no rompa un pedido. */
export async function sendMail({ to, subject, html, text }) {
  try {
    const key = BREVO_API_KEY.value();
    if ((!key || key === 'disabled' || !to) && !testTransport) {
      logger.info('Envío de email omitido (Brevo no configurado o sin destinatario)', { subject });
      return false;
    }
    const store = await getSettings('store');
    const fromAddress = store.emailFrom || store.email;
    if (!fromAddress) {
      logger.warn('Falta el email remitente en Configuración → Tienda');
      return false;
    }
    const message = {
      sender: { name: store.name, email: fromAddress },
      to: [{ email: to }],
      ...(store.email ? { replyTo: { email: store.email } } : {}),
      subject,
      htmlContent: html,
      textContent: text,
    };
    if (testTransport) {
      await testTransport(message);
      return true;
    }
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(message),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
    return true;
  } catch (err) {
    logger.error('Error enviando email', { subject, message: err.message });
    return false;
  }
}
