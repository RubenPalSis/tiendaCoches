// Emails transaccionales con la API HTTP de Brevo (plan gratuito: 300 emails/día, sin tarjeta).
// El remitente tiene que estar verificado en Brevo (Remitentes, dominios e IP dedicadas → Remitentes).
import { logger } from '../lib/log.js';
import { BREVO_API_KEY, EMAIL_FROM } from '../lib/config.js';
import { getSettings } from '../lib/settings.js';

let testTransport;

/** Las pruebas pueden capturar los emails en lugar de enviarlos. */
export function setMailTransportForTests(fn) {
  testTransport = fn;
}

/** Envía un email. Nunca lanza: devuelve true/false para que un fallo de email no rompa un pedido. */
export async function sendMail({ to, subject, html, text }) {
  try {
    const key = BREVO_API_KEY.value().trim();
    if ((!key || key === 'disabled' || !to) && !testTransport) {
      logger.info('Envío de email omitido (Brevo no configurado o sin destinatario)', { subject });
      return false;
    }
    const store = await getSettings('store');
    const from = store.emailFrom || EMAIL_FROM.value() || store.email;
    if (!from) {
      logger.warn('Falta el remitente: EMAIL_FROM en wrangler.toml o Configuración → Tienda');
      return false;
    }
    const replyTo = store.email && store.email !== from ? store.email : undefined;
    const message = { from, fromName: store.name, to, replyTo, subject, html, text };
    if (testTransport) {
      await testTransport(message);
      return true;
    }
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: store.name || undefined, email: from },
        to: [{ email: to }],
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
    return true;
  } catch (err) {
    logger.error('Error enviando email', { subject, message: err.message });
    return false;
  }
}
