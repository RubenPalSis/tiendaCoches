import nodemailer from 'nodemailer';
import { logger } from 'firebase-functions';
import { SMTP_URL } from '../lib/config.js';
import { getSettings } from '../lib/settings.js';

let transport;

/** Envía un email. Nunca lanza: devuelve true/false para que un fallo de email no rompa un pedido. */
export async function sendMail({ to, subject, html, text }) {
  try {
    const url = SMTP_URL.value();
    if (!url || url === 'disabled' || !to) {
      logger.info('Envío de email omitido (SMTP no configurado o sin destinatario)', { subject });
      return false;
    }
    const store = await getSettings('store');
    const fromAddress = store.emailFrom || store.email;
    if (!fromAddress) {
      logger.warn('Falta el email remitente en Configuración → Tienda');
      return false;
    }
    transport ??= nodemailer.createTransport(url);
    await transport.sendMail({
      from: { name: store.name, address: fromAddress },
      replyTo: store.email || undefined,
      to,
      subject,
      html,
      text,
    });
    return true;
  } catch (err) {
    logger.error('Error enviando email', { subject, message: err.message });
    return false;
  }
}
