// Cliente SMTP (server/src/email/smtp.js) contra un servidor SMTP falso en local: conversación,
// autenticación, mensaje MIME con acentos y errores. No necesita emuladores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect as netConnect } from 'node:net';
import { Duplex } from 'node:stream';
import { sendSmtp, buildMessage } from '../../server/src/email/smtp.js';

/** Servidor SMTP mínimo: guarda los comandos y el mensaje; `authOk` decide la respuesta a AUTH. */
async function fakeSmtp({ authOk = true } = {}) {
  const log = { commands: [], data: '' };
  const server = createServer((sock) => {
    let buf = '';
    let inData = false;
    sock.write('220 smtp.test ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (inData) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end === -1) return;
        log.data = buf.slice(0, end + 2);
        buf = buf.slice(end + 5);
        inData = false;
        sock.write('250 2.0.0 OK\r\n');
      }
      let i;
      while (!inData && (i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        log.commands.push(line);
        if (line.startsWith('EHLO')) sock.write('250-smtp.test\r\n250-AUTH PLAIN LOGIN\r\n250 SMTPUTF8\r\n');
        else if (line.startsWith('AUTH')) sock.write(authOk ? '235 2.7.0 Accepted\r\n' : '535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 BadCredentials\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 Go ahead\r\n'); }
        else if (line === 'QUIT') { sock.end('221 bye\r\n'); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const connect = async () => {
    const sock = netConnect(port, '127.0.0.1');
    await new Promise((r) => sock.once('connect', r));
    const { readable, writable } = Duplex.toWeb(sock);
    return { readable, writable, close: () => sock.destroy() };
  };
  return { log, connect, close: () => server.close() };
}

const MAIL = {
  user: 'tienda@gmail.com', pass: 'abcdabcdabcdabcd', from: 'tienda@gmail.com', fromName: 'Mivotunning Garaje',
  to: 'ana@test.com', replyTo: 'contacto@test.com', subject: 'Pedido confirmado nº 1234 — ¡gracias por tu compra, Ana Pérez!',
  html: '<p>Hola Ana, tu pedido está <b>confirmado</b>.</p>', text: 'Hola Ana, tu pedido está confirmado.\n.\nLínea con punto.',
};

const decodeHeader = (h) => h.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
const partBody = (data, type) => {
  const m = data.match(new RegExp(`Content-Type: ${type}; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`));
  return Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
};

test('envía el email: conversación SMTP, AUTH PLAIN y mensaje MIME', async () => {
  const smtp = await fakeSmtp();
  try {
    await sendSmtp(MAIL, smtp.connect);
    const [ehlo, auth, from, rcpt, data, quit] = smtp.log.commands;
    assert.equal(ehlo, 'EHLO tienda');
    assert.equal(Buffer.from(auth.split(' ')[2], 'base64').toString(), '\0tienda@gmail.com\0abcdabcdabcdabcd');
    assert.equal(from, 'MAIL FROM:<tienda@gmail.com>');
    assert.equal(rcpt, 'RCPT TO:<ana@test.com>');
    assert.equal(data, 'DATA');
    assert.equal(quit, 'QUIT');

    const msg = smtp.log.data;
    assert.ok(msg.split('\r\n').every((l) => l.length <= 998 && !l.startsWith('.')), 'líneas válidas para SMTP');
    assert.match(msg, /^To: <ana@test\.com>$/m);
    assert.match(msg, /^Reply-To: <contacto@test\.com>$/m);
    const subject = msg.match(/^Subject: ((?:.*\r\n )*.*)$/m)[1];
    assert.ok(subject.split('\r\n ').every((w) => w.length <= 75), 'palabras codificadas de 75 caracteres como máximo');
    assert.equal(decodeHeader(subject), MAIL.subject);
    assert.equal(partBody(msg, 'text/plain'), MAIL.text);
    assert.equal(partBody(msg, 'text/html'), MAIL.html);
  } finally {
    smtp.close();
  }
});

test('contraseña rechazada → error con la respuesta de Gmail', async () => {
  const smtp = await fakeSmtp({ authOk: false });
  try {
    await assert.rejects(sendSmtp(MAIL, smtp.connect), /SMTP AUTH: .*BadCredentials/s);
    assert.ok(!smtp.log.commands.some((c) => c.startsWith('MAIL FROM')));
  } finally {
    smtp.close();
  }
});

test('cabeceras sin acentos quedan tal cual', () => {
  const msg = buildMessage({ ...MAIL, fromName: 'Tienda', subject: 'Pedido 1234' });
  assert.match(msg, /^From: Tienda <tienda@gmail\.com>$/m);
  assert.match(msg, /^Subject: Pedido 1234$/m);
});
