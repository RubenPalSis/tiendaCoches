# Arquitectura

## Visión general

```
Visitante ──► Firebase Hosting (CDN)
              ├─ HTML/CSS/JS estático (sin SDK de Firebase en la tienda pública)
              ├─ /api/*          → Function `api`  (catálogo cacheado, checkout, pedido, estadísticas)
              ├─ /producto/*     → Function `seo`  (HTML renderizado en servidor: SEO + JSON-LD)
              ├─ /categoria/*    → Function `seo`
              └─ /sitemap.xml, /robots.txt → Function `seo`
Stripe ──webhook──► Function `stripeWebhook` (firma verificada) ──► Firestore
Panel /admin ──► Firebase Auth + Firestore + Storage (reglas: custom claim admin) + callable `adminAction`
```

Región: Functions y Firestore en `europe-west1`. Bucket de Storage en `us-central1` (gratis hasta 5 GB,
solo fotos públicas).

## Decisiones clave

| Decisión | Motivo |
|---|---|
| La tienda pública no carga el SDK de Firebase | Web más ligera; no se puede leer Firestore desde el navegador → sin scraping ni lecturas masivas |
| Índice de catálogo en un documento (`catalog/index`) servido por `/api/catalog` con caché CDN (5 min) | 1 lectura por fallo de caché sin importar el nº de productos; búsqueda/filtros instantáneos en el navegador. Límite ~2.500 productos (1 MiB); se avisa en logs si se acerca |
| Productos y categorías renderizados en servidor | Título, descripción, canonical, Open Graph y JSON-LD `Product` sin depender de JavaScript |
| Reserva de stock al iniciar el pago | Imposible vender dos veces la misma unidad (crítico con piezas únicas) |
| Confirmación solo por webhook | La página de éxito no confirma nada; el webhook verifica firma, sesión, importe y moneda |
| Fotos comprimidas en el navegador del vendedor (WebP 400/800/1600 px) | Gratis y rápido desde el móvil, sin extensiones de pago |
| Sin cookies; estadísticas agregadas propias | Sin banner de cookies ni servicios externos |
| Admin por lista `ADMIN_EMAILS` + email verificado → custom claim | Sin descargar claves privadas; claim comprobado en reglas y funciones |

## Flujo de compra y stock

1. `POST /api/checkout` con `{items:[{id,qty}], customer, acceptTerms}` (nunca precios).
2. Transacción Firestore: productos existen y activos, `stock >= qty`, precios reales, envío calculado
   con `settings/shipping` → `stock -= qty`, `reserved += qty`, pedido `pending` con nº correlativo.
3. Sesión de Stripe Checkout con importes validados, `expires_at` = +31 min. Si Stripe falla → se devuelve el stock.
4. Webhook `checkout.session.completed` (idempotente por `event.id`): `reserved -= qty`, `soldCount += qty`,
   pedido `paid`, estadísticas, emails.
5. `checkout.session.expired` / cancelación del comprador → stock devuelto.
6. Red de seguridad: tarea cada hora (`releaseExpiredReservations`) libera reservas caducadas sin webhook.
7. Pago tardío de una reserva ya liberada: se vende si queda stock; si no, el pedido se marca «Revisar».

Concurrencia: las transacciones del Admin SDK bloquean los documentos leídos; probado con 8 compras
simultáneas de la última unidad (solo 1 la consigue). Límite práctico de ~1 escritura/s sostenida por
documento, irrelevante para este volumen.

## Modelo de datos (Firestore)

| Colección | Contenido | Acceso |
|---|---|---|
| `products/{id}` | name, slug, price (céntimos), comparePrice, stock, reserved, soldCount, weight (g), condition, conditionNotes, reference, brand, model, compatibility, description, categoryId, images[{sm,md,lg,paths}], active, featured, createdAt, updatedAt | admin (validado por reglas; `reserved`/`soldCount` solo backend) |
| `categories/{slug}` | name, slug, description, order, image, active | admin |
| `orders/{id}` | number, accessTokenHash, paymentStatus, orderStatus, customer, shippingAddress, items (snapshot), subtotal, shippingCost, total, shipping{carrier, zone, weight, trackingNumber, trackingUrl, shippedAt…}, stripe{sessionId, paymentIntentId}, legal{termsVersion, acceptedAt}, history[], withdrawal, deleteAt (TTL si no se paga) | lectura admin; escritura solo Functions |
| `settings/store` · `shipping` · `checkout` | datos de la tienda, reglas de envío, opciones de venta | admin (lo público se sirve por `/api/catalog`) |
| `catalog/index` | índice compacto de productos activos + categorías | solo Functions |
| `statistics/day_YYYY-MM-DD` | pageViews, productViews{id}, addToCart, checkoutStarted, orders, revenue, itemsSold, productSales{id} | lectura admin |
| `counters/orders`, `stripeEvents/{id}` | nº de pedido, idempotencia del webhook (TTL 30 días) | solo Functions |

Importes en céntimos (enteros) y pesos en gramos.

## Seguridad

- Reglas de Firestore/Storage con denegación por defecto y validación de tipos/rangos (tests en `tests/rules`).
- Secretos en Secret Manager: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_URL`.
- Cabeceras: CSP estricta, HSTS, `nosniff`, `frame-ancestors 'none'`; panel con `no-store` y `noindex`.
- Todo el HTML dinámico se genera con un template tag que escapa por defecto (`js/shared/escape.js`).
- Consulta de pedidos sin cuenta: enlace con token aleatorio (solo se guarda su hash) o número + email.
- Límite de peticiones por IP en checkout, consulta de pedidos, desistimiento y estadísticas
  (orientativo: las cabeceras de IP se pueden falsear) y límites que no dependen de la IP: máximo
  2 pagos pendientes por email y 30 en toda la tienda; `maxInstances` en todas las funciones.
- El panel llama a sus funciones por Hosting (`/fn/*`, mismo dominio): CSP `connect-src` sin dominios externos de Functions.
- Enlaces públicos (Stripe, emails, SEO) generados desde `SITE_URL` o el dominio del proyecto, nunca desde cabeceras.
- Una reserva solo se libera si Stripe confirma que la sesión ya no se puede pagar; los pedidos guardan qué
  líneas descontaron stock (`stockTaken`) para reponer solo eso al cancelar.
- Rol admin: claim + email en `ADMIN_EMAILS` + email verificado; la tarea horaria retira el claim a quien salga de la lista.
- Transiciones de estado de pedidos validadas en servidor dentro de una transacción.

## Costes

| Servicio | Coste esperado |
|---|---|
| Firebase (Blaze) | 0 € con este volumen (cuotas gratuitas); obligatorio para Functions/Storage |
| Secret Manager, Cloud Scheduler (1 tarea), Artifact Registry | ~0 € (limpieza de imágenes a 1 día) |
| Stripe | comisión por transacción, sin cuota mensual (ver stripe.com/es/pricing) |
| Email (Brevo) | 0 € hasta 300 emails/día |
| Dominio | ~10–20 €/año |

## Limitaciones conocidas

- **Bloqueo de stock malintencionado:** alguien podría crear pagos que nunca completa para dejar piezas
  «reservadas» 30 minutos. Está acotado (2 por email, 30 en total, 20 líneas por pedido), pero no
  eliminado. Si ocurre, la siguiente medida es Firebase App Check con reCAPTCHA en el checkout
  (implica cookies de Google y actualizar la política de cookies).
- Cambios de precio/stock tardan hasta ~5 min en verse en el catálogo (caché); el checkout siempre valida en tiempo real.
- Arranque en frío de Functions (1–3 s en la primera petición tras inactividad); la CDN lo amortigua.
- La web no emite facturas legales (Verifactu u obligaciones fiscales: consultar con la gestoría).
- Envíos a Canarias, Ceuta y Melilla excluidos por defecto (IVA/aduanas).
