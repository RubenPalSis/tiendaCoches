// Esqueleto HTML común. Debe coincidir con el de las páginas estáticas de /public.
import { esc } from '../shared/escape.js';

export const jsonForScript = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

export function renderPage({
  title, description, canonical, ogImage, ogType = 'website', page, script, body,
  jsonLd = [], noindex = false, storeName,
}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:site_name" content="${esc(storeName)}">
<meta property="og:locale" content="es_ES">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="theme-color" content="#0D0F13">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/barlow-condensed-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/app.css">
<script type="module" src="/js/pages/${esc(script)}.js"></script>
${jsonLd.map((d) => `<script type="application/ld+json">${jsonForScript(d)}</script>`).join('\n')}
</head>
<body data-page="${esc(page)}">
<a class="skip-link" href="#main">Saltar al contenido</a>
<div id="site-header" class="site-header-slot"></div>
${body}
<div id="site-footer"></div>
</body>
</html>`;
}
