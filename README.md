# ZetaWeb Ecommerce — Tienda de recambios

Tienda online sin WordPress/Shopify: HTML + CSS + JavaScript, Firebase (Hosting, Authentication,
Firestore, Storage, Cloud Functions), pagos con Stripe Checkout y envíos con GLS (gestión manual,
preparada para automatizar).

- **Compradores:** sin registro. Catálogo con búsqueda instantánea, filtros, ficha de producto,
  carrito, checkout en una página, pago en Stripe, confirmación y consulta de pedido.
- **Vendedor:** panel en `/admin` (móvil primero) para publicar piezas con fotos, gestionar pedidos y
  seguimiento GLS, categorías, ajustes de envío y estadísticas.

## Documentación

| Documento | Para quién |
|---|---|
| [docs/puesta-en-produccion.md](docs/puesta-en-produccion.md) | Pasos exactos para publicar la tienda (Firebase, Stripe, email, dominio) |
| [docs/manual-vendedor.md](docs/manual-vendedor.md) | Manual sencillo del panel para el cliente |
| [docs/arquitectura.md](docs/arquitectura.md) | Arquitectura, modelo de datos, seguridad, costes y decisiones técnicas |
| [docs/gls.md](docs/gls.md) | Envíos GLS: flujo manual actual y plan de integración futura |
| [docs/preguntas-cliente.md](docs/preguntas-cliente.md) | Información pendiente del cliente |

## Vista previa en GitHub Pages (provisional, sin Firebase)

Versión estática para enseñar y revisar la tienda: catálogo real, búsqueda, filtros, fichas, carrito
y textos legales. **Los pagos, pedidos y el panel están desactivados** (aviso visible) hasta publicar en Firebase.

- Se publica sola con cada push a `main` (`.github/workflows/pages.yml`) en
  `https://rubenpalsis.github.io/tiendaCoches/`.
- Probar en local: `node scripts/build-static.js --serve` → <http://localhost:8000/tiendaCoches/>
- Datos: `demo/` (productos, categorías, ajustes y fotos). Para actualizar el catálogo desde Wallapop:

```bash
node scripts/wallapop-import.js fetch evjrr10w7xjk   # descarga anuncios y fotos (data/, no se sube)
node scripts/wallapop-import.js demo                 # regenera demo/
```

Nombre, textos, redes y logo de la vista previa: `demo/settings.json`.

## Desarrollo local

Requisitos: Node 22+, Java 21+ (emuladores), `npm i -g firebase-tools`.

```bash
npm install && (cd functions && npm install)
cp functions/.env.example functions/.env.local   # emails admin para el emulador
npm run dev          # emuladores: tienda en http://localhost:5000, UI en http://localhost:4000
npm run seed         # (otra terminal) catálogo de demo/ + ajustes de prueba + admin: admin@demo.test / demo1234
```

El emulador no necesita cuenta de Firebase (proyecto `demo-tienda`). Sin claves de Stripe el checkout
muestra «Los pagos todavía no están configurados» (esperado).

## Tests

```bash
npm test                 # reglas + backend (arranca sus propios emuladores: para `npm run dev` antes)
npm run test:e2e         # navegador: comprador, panel y roles (requiere `npm run dev` + `npm run seed`)
npm run test:responsive  # capturas 320–1920 px y detección de scroll horizontal
```

## Estructura

```
public/                 Firebase Hosting (sin paso de compilación)
  css/tokens.css        identidad visual (colores, tipografías) ← cambiar por cliente
  js/shared/            código compartido navegador/servidor (precios, envíos, validación…)
  js/pages/             una entrada por página de la tienda
  js/admin/             panel de administración (SPA por hash)
  legal/                plantillas legales (revisar con un profesional)
functions/src/          Cloud Functions: API, checkout, webhook Stripe, SEO/SSR, emails, panel
firestore.rules         reglas de seguridad (probadas en tests/rules)
storage.rules
scripts/                copy-shared (predeploy), seed-demo (solo emulador), wallapop-import, build-static
demo/                   catálogo estático (vista previa en GitHub Pages y datos del emulador)
tests/                  rules/, functions/, e2e/
```

## Reutilizar para otro cliente

1. `public/css/tokens.css` (colores/tipografías), colores de emails en `functions/src/email/templates.js`,
   `public/assets/img/logo-mark.svg` + `favicon.svg`, y logo/imagen de portada (Ajustes → Tienda: `logoUrl`, `heroImage`).
2. Nombre, datos legales, contacto, envíos: desde el panel → Ajustes (se guardan en Firestore).
3. Productos y categorías: desde el panel.
4. Nuevo proyecto Firebase + cuenta Stripe del cliente (ver puesta en producción).
