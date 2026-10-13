// Adaptador mínimo Request/Response (Workers) ⇄ req/res al estilo Express, el que usaba Cloud Functions.
// Así los manejadores de la API y de las páginas no cambian.

/** Construye un `req` a partir de un Request. Lee el cuerpo una sola vez (texto y JSON). */
export async function toReq(request) {
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  headers.host ??= url.host; // Cloudflare siempre la envía; un Request creado a mano puede no llevarla
  const rawBody = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text();
  let body = rawBody;
  if (/application\/json/.test(headers['content-type'] ?? '')) {
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
  }
  return {
    method: request.method,
    url: url.pathname + url.search,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers,
    body,
    rawBody,
    ip: headers['cf-connecting-ip'] || '',
  };
}

/** `res` que acumula estado, cabeceras y cuerpo; toResponse() lo convierte en Response. */
export function createRes() {
  const res = {
    statusCode: 200,
    headers: new Headers(),
    body: null,
    set(name, value) { res.headers.set(name, value); return res; },
    status(code) { res.statusCode = code; return res; },
    json(data) {
      if (!res.headers.has('Content-Type')) res.headers.set('Content-Type', 'application/json; charset=utf-8');
      res.body = JSON.stringify(data);
      return res;
    },
    send(data) {
      if (!res.headers.has('Content-Type')) res.headers.set('Content-Type', 'text/html; charset=utf-8');
      res.body = data;
      return res;
    },
    redirect(code, location) {
      res.statusCode = code;
      res.headers.set('Location', location);
      res.body = null;
      return res;
    },
    toResponse() { return new Response(res.body, { status: res.statusCode, headers: res.headers }); },
  };
  return res;
}
