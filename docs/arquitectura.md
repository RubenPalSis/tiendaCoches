# Arquitectura

## Visión general

Todo funciona con planes gratuitos y sin tarjeta (ver docs/puesta-en-produccion.md).

```
Visitante ──► Cloudflare Workers (red global de Cloudflare)
              ├─ Static Assets: HTML/CSS/JS de /public (sin SDK de Firebase en la tienda pública)
              └─ Worker (server/src/worker.js), solo para las rutas dinámicas:
                 ├─ /api/*          catálogo (caché de Cloudflare), checkout, pedido, estadísticas
                 ├─ /producto/*, /categoria/*, /sitemap.xml, /robots.txt   HTML renderizado (SEO + JSON-LD)
                 ├─ /stripe/webhook (firma verificada)
                 ├─ /fn/adminAction, /fn/syncAdminClaim   funciones del panel (protocolo «callable» de Firebase)
                 └─ cada hora (Cron Trigger): reservas caducadas, admins retirados, reconstrucción del índice
Worker ──REST──► Firestore + Authentication (Firebase Spark) con una cuenta de servicio
Panel /admin ──► Firebase Auth + Firestore (reglas: custom claim admin) + /fn/* + fotos directas a Cloudinary
Emails ──► API HTTP de Brevo
```

Firestore en `europe-west1`. El Worker no usa `firebase-admin` (no funciona en Workers): habla con las
APIs REST de Firestore y Authentication (`server/src/lib/firestore.js`, `identity.js`, `google-auth.js`),
con la misma forma que el SDK para que la lógica de pedidos y stock no dependa de la plataforma.

## Decisiones clave

| Decisión | Motivo |
|---|---|
| La tienda pública no carga el SDK de Firebase | Web más ligera; no se puede leer Firestore desde el navegador → sin scraping ni lecturas masivas |
| Índice de catálogo en un documento (`catalog/index`) servido por `/api/catalog` con caché de Cloudflare (1 min) | Pocas lecturas sin importar el nº de productos; búsqueda/filtros instantáneos en el navegador. Límite ~2.500 productos (1 MiB); se avisa en logs si se acerca |
| El índice lo actualiza el servidor, no un disparador | En el plan Spark no hay disparadores de Firestore: el panel avisa a `/fn/adminAction` (`syncProducts`, `syncCategories`) tras guardar, el checkout/webhook/cancelaciones lo actualizan tras cambiar stock, y la tarea horaria lo reconstruye por si algo falló |
| Productos y categorías renderizados en servidor | Título, descripción, canonical, Open Graph y JSON-LD `Product` sin depender de JavaScript |
| Reserva de stock al iniciar el pago | Imposible vender dos veces la misma unidad (crítico con piezas únicas) |
| Confirmación solo por webhook | La página de éxito no confirma nada; el webhook verifica firma, sesión, importe y moneda |
| Fotos comprimidas en el navegador (WebP 1600 px) y subidas directamente a Cloudinary con firma del servidor | Rápido desde el móvil; las versiones de 400 y 800 px las sirve Cloudinary por URL (`c_limit,w_400`); solo un administrador obtiene firmas |
| Sin cookies; estadísticas agregadas propias | Sin banner de cookies ni servicios externos |
| Admin por lista `ADMIN_EMAILS` + email verificado → custom claim | Claim comprobado en reglas de Firestore y en el Worker (que verifica el token de sesión con las claves públicas de Google) |

## Flujo de compra y stock

1. `POST /api/checkout` con `{items:[{id,qty}], customer, acceptTerms}` (nunca precios).
2. Transacción Firestore: productos existen y activos, `stock >= qty`, precios reales, envío calculado
   con `settings/shipping` → `stock -= qty`, `reserved += qty`, pedido `pending` con nº correlativo.
3. Sesión de Stripe Checkout con importes validados, `expires_at` = +31 min. Si Stripe falla → se devuelve el stock.
4. Webhook `checkout.session.completed` (idempotente por `event.id`): `reserved -= qty`, `soldCount += qty`,
   pedido `paid`, estadísticas, emails.
5. `checkout.session.expired` / cancelación del comprador → stock devuelto.
6. Red de seguridad: tarea cada hora (Cron Trigger) libera reservas caducadas sin webhook.
7. Pago tardío de una reserva ya liberada: se vende si queda stock; si no, el pedido se marca «Revisar».

Concurrencia: las transacciones de Firestore (API REST, con reintentos si chocan) bloquean los documentos leídos; probado con 8 compras
simultáneas de la última unidad (solo 1 la consigue). Límite práctico de ~1 escritura/s sostenida por
documento, irrelevante para este volumen.

## Modelo de datos (Firestore)

| Colección | Contenido | Acceso |
|---|---|---|
| `products/{id}` | name, slug, price (céntimos), comparePrice, stock, reserved, soldCount, weight (g), length/width/height (cm, paquete), condition, conditionNotes, reference, brand, model, compatibility, description, categoryId, images[{sm,md,lg,publicId}], active, featured, createdAt, updatedAt | admin (validado por reglas; `reserved`/`soldCount` solo backend) |
| `categories/{slug}` | name, slug, description, order, image, active | admin |
| `orders/{id}` | number, accessTokenHash, paymentStatus, orderStatus, customer, shippingAddress, items (snapshot), subtotal, shippingCost, total, shipping{carrier, zone, weight (facturable), realWeight, bulky, bulkySurcharge, trackingNumber, trackingUrl, shippedAt…}, stripe{sessionId, paymentIntentId}, legal{termsVersion, acceptedAt}, history[], withdrawal, deleteAt (borrado por la tarea horaria si no se paga) | lectura admin; escritura solo el servidor |
| `settings/store` · `shipping` · `checkout` | datos de la tienda, reglas de envío, opciones de venta | admin (lo público se sirve por `/api/catalog`) |
| `catalog/index` | índice compacto de productos activos + categorías | solo el servidor |
| `statistics/day_YYYY-MM-DD` | pageViews, productViews{id}, addToCart, checkoutStarted, orders, revenue, itemsSold, productSales{id} | lectura admin |
| `counters/orders`, `stripeEvents/{id}` | nº de pedido, idempotencia del webhook (se borran a los 30 días) | solo el servidor |

Importes en céntimos (enteros) y pesos en gramos.

## Seguridad

- Reglas de Firestore con denegación por defecto y validación de tipos/rangos (tests en `tests/rules`).
- Secretos del Worker (`wrangler secret put`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BREVO_API_KEY`,
  `CLOUDINARY_API_SECRET`, `FIREBASE_SERVICE_ACCOUNT`. La cuenta de servicio es la credencial más sensible:
  solo vive como secreto en Cloudflare y se borra del equipo tras configurarla.
- Cabeceras: CSP estricta, HSTS, `nosniff`, `frame-ancestors 'none'`; panel con `no-store` y `noindex`
  (`public/_headers` para los archivos y `server/src/lib/security-headers.js` para el Worker; un test comprueba que coinciden).
- Todo el HTML dinámico se genera con un template tag que escapa por defecto (`js/shared/escape.js`).
- Consulta de pedidos sin cuenta: enlace con token aleatorio (solo se guarda su hash) o número + email.
- Límite de peticiones por IP en checkout, consulta de pedidos, desistimiento y estadísticas
  (orientativo: las cabeceras de IP se pueden falsear) y límites que no dependen de la IP: máximo
  2 pagos pendientes por email y 30 en toda la tienda.
- El panel llama a sus funciones en el mismo dominio (`/fn/*`); las fotos se suben a `api.cloudinary.com` con una firma de un solo uso.
- Enlaces públicos (Stripe, emails, SEO) generados desde `SITE_URL` o el dominio de la petición (Cloudflare solo entrega al Worker peticiones de sus propios dominios).
- Una reserva solo se libera si Stripe confirma que la sesión ya no se puede pagar; los pedidos guardan qué
  líneas descontaron stock (`stockTaken`) para reponer solo eso al cancelar.
- Rol admin: claim + email en `ADMIN_EMAILS` + email verificado; la tarea horaria retira el claim a quien salga de la lista.
- Transiciones de estado de pedidos validadas en servidor dentro de una transacción.

## Costes

| Servicio | Coste |
|---|---|
| Cloudflare Workers (Free) | 0 €: 100.000 peticiones/día al Worker; los archivos estáticos no cuentan |
| Firebase Spark (Auth + Firestore) | 0 €: 50.000 lecturas y 20.000 escrituras/día; si se superan, deja de responder hasta el día siguiente (nunca cobra) |
| Cloudinary (Free) | 0 €: 25 créditos/mes |
| Brevo (Free) | 0 €: 300 emails/día |
| Stripe | comisión por transacción, sin cuota mensual (ver stripe.com/es/pricing) |
| Dominio | ~10–15 €/año |

Consumo aproximado de Firestore: cada visita a la tienda es 1 escritura de estadísticas; el catálogo
se lee como mucho una vez por minuto y centro de datos de Cloudflare; un pedido son unas 10–15 operaciones.

## Limitaciones conocidas

- **Bloqueo de stock malintencionado:** alguien podría crear pagos que nunca completa para dejar piezas
  «reservadas» 30 minutos. Está acotado (2 por email, 30 en total, 20 líneas por pedido), pero no
  eliminado. Si ocurre, la siguiente medida es Firebase App Check con reCAPTCHA en el checkout
  (implica cookies de Google y actualizar la política de cookies).
- Cambios de precio/stock tardan hasta ~1 min en verse en el catálogo (caché); el checkout siempre valida en tiempo real.
- Límite de 10 ms de CPU por petición en el plan gratuito de Workers: el servidor solo hace trabajo ligero
  (el tiempo esperando a Firestore o Stripe no cuenta).
- El limitador de peticiones por IP vive en memoria de cada instancia del Worker (orientativo).
- La web no emite facturas legales (Verifactu u obligaciones fiscales: consultar con la gestoría).
- Envíos a Canarias, Ceuta y Melilla excluidos por defecto (IVA/aduanas).
