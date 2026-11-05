// Cliente SMTP mínimo para enviar desde Gmail (smtp.gmail.com:465, TLS directo, AUTH PLAIN).
// Usa los sockets TCP de Cloudflare Workers; las pruebas inyectan su propio `connect`.
// El cuerpo va en base64, así que nunca hay líneas que empiecen por "." ni de más de 76 caracteres.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Base64 de un texto UTF-8. */
const b64 = (str) => {
  let bin = '';
  for (const byte of encoder.encode(str)) bin += String.fromCharCode(byte);
  return btoa(bin);
};

const wrap76 = (str) => str.replace(/.{1,76}/g, '$&\r\n');

/** Cabecera con acentos (RFC 2047), partida en trozos para no pasar de 75 caracteres por palabra. */
const encodeHeader = (str) => {
  if (/^[\x20-\x7e]*$/.test(str)) return str;
  const chars = Array.from(str);
  const words = [];
  for (let i = 0; i < chars.length; i += 30) words.push(`=?UTF-8?B?${b64(chars.slice(i, i + 30).join(''))}?=`);
  return words.join('\r\n ');
};

const address = (email, name) => (name ? `${encodeHeader(name)} <${email}>` : `<${email}>`);

/** Mensaje MIME multipart/alternative (texto y HTML). */
export function buildMessage({ from, fromName, to, replyTo, subject, html, text }) {
  const boundary = `=_${crypto.randomUUID()}`;
  const domain = from.split('@')[1] || 'localhost';
  const part = (type, body) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(body)),
  ].join('\r\n');
  return [
    `From: ${address(from, fromName)}`,
    `To: <${to}>`,
    ...(replyTo ? [`Reply-To: <${replyTo}>`] : []),
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', text || ''),
    part('text/html', html || ''),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function cloudflareConnect(host, port) {
  const { connect } = await import('cloudflare:sockets');
  return connect({ hostname: host, port }, { secureTransport: 'on' });
}

/**
 * Envía un email por SMTP. Lanza un Error con la respuesta del servidor si algo falla.
 * @param {object} opts host, port, user, pass, from, fromName, to, replyTo, subject, html, text
 * @param {(host: string, port: number) => Promise<{readable: ReadableStream, writable: WritableStream, close?: Function}>} [connect]
 */
export async function sendSmtp(opts, connect = cloudflareConnect) {
  const { host = 'smtp.gmail.com', port = 465, user, pass, from, to } = opts;
  const socket = await connect(host, port);
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  let buffer = '';

  // Lee una respuesta completa (las multilínea usan "250-…" hasta la última "250 …").
  const read = async () => {
    for (;;) {
      const lines = buffer.split('\r\n');
      const end = lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
      if (end !== -1) {
        buffer = lines.slice(end + 1).join('\r\n');
        return { code: Number(lines[end].slice(0, 3)), text: lines.slice(0, end + 1).join('\n') };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`SMTP: conexión cerrada (${buffer.trim() || 'sin respuesta'})`);
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const expect = async (codes, label) => {
    const res = await read();
    if (!codes.includes(res.code)) throw new Error(`SMTP ${label}: ${res.text}`);
  };
  const send = (line) => writer.write(encoder.encode(`${line}\r\n`));

  try {
    await expect([220], 'saludo');
    await send('EHLO tienda');
    await expect([250], 'EHLO');
    await send(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`);
    await expect([235], 'AUTH');
    await send(`MAIL FROM:<${from}>`);
    await expect([250], 'MAIL FROM');
    await send(`RCPT TO:<${to}>`);
    await expect([250, 251], 'RCPT TO');
    await send('DATA');
    await expect([354], 'DATA');
    await writer.write(encoder.encode(`${buildMessage(opts)}.\r\n`));
    await expect([250], 'envío');
    await send('QUIT');
    await read().catch(() => {}); // el email ya está entregado; solo esperamos el «221» para cerrar limpio
  } finally {
    try { await socket.close?.(); } catch { /* ya cerrada */ }
  }
}
