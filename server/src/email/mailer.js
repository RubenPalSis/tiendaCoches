// Emails transaccionales enviados desde la cuenta de Gmail de la tienda (SMTP con contraseña de aplicación).
// Gmail firma los mensajes (DKIM), así que llegan bien, y quedan en «Enviados» de la cuenta. Límite: ~500/día.
import { logger } from '../lib/log.js';
import { GMAIL_USER, GMAIL_APP_PASSWORD } from '../lib/config.js';
import { getSettings } from '../lib/settings.js';
import { sendSmtp } from './smtp.js';

let testTransport;

/** Las pruebas pueden capturar los emails en lugar de enviarlos. */
export function setMailTransportForTests(fn) {
  testTransport = fn;
}

/** Envía un email. Nunca lanza: devuelve true/false para que un fallo de email no rompa un pedido. */
export async function sendMail({ to, subject, html, text }) {
  try {
    const user = GMAIL_USER.value();
    const pass = GMAIL_APP_PASSWORD.value().replace(/\s+/g, ''); // Google la muestra en grupos de 4
    if ((!user || !pass || pass === 'disabled' || !to) && !testTransport) {
      logger.info('Envío de email omitido (Gmail no configurado o sin destinatario)', { subject });
      return false;
    }
    const store = await getSettings('store');
    // Gmail solo deja enviar como la propia cuenta o un alias verificado en «Enviar como».
    const from = store.emailFrom || user;
    const message = {
      from,
      fromName: store.name,
      to,
      replyTo: store.email && store.email !== from ? store.email : undefined,
      subject,
      html,
      text,
    };
    if (testTransport) {
      await testTransport(message);
      return true;
    }
    await sendSmtp({ ...message, user, pass });
    return true;
  } catch (err) {
    logger.error('Error enviando email', { subject, message: err.message });
    return false;
  }
}
