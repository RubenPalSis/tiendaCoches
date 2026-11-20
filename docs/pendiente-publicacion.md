# Pendiente para publicar la tienda

Lista mínima para empezar a vender Mivotunning desde `workers.dev`, sin cuota mensual ni tarjeta.
Stripe descuenta una comisión por cada pago. Pasos detallados: [puesta-en-produccion.md](puesta-en-produccion.md).

## Lo que queda por hacer

Revisión del 20 de noviembre de 2026. La web en `workers.dev` responde (HTTP 200); esto no confirma
que el flujo de compra en producción esté listo.

### Antes de abrir la tienda

- [ ] Confirmar con la gestoría el tratamiento fiscal aplicable a las ventas de la tienda.
- [ ] Panel → Ajustes → Envíos: revisar tarifas GLS, zonas, stock, peso y medidas de cada paquete;
      ajustar pesos y medidas para que el precio de envío sea correcto.
- [ ] Crear el webhook live de Stripe, guardar su secreto de firma actual en `secretos.env`, volver a
      ejecutar `npm run secrets` y después probar un pago, email, pedido y stock.
- [ ] Activar el checkout para clientes después de verificar el webhook.
- [x] Firebase sigue en Spark y Cloudflare, Cloudinary y Brevo en planes gratuitos, sin servicios de pago
      (confirmado por el usuario el 20 de noviembre).

## Lo que cuesta

| Servicio | Para qué | Coste | ¿Pide tarjeta? |
|---|---|---|---|
| Cloudflare Workers (Free) | Web, servidor, DNS, HTTPS, tarea horaria | 0 € | No |
| Firebase **Spark** | Login del panel y base de datos | 0 € | No |
| Cloudinary (Free) | Fotos de las piezas | 0 € | No |
| Brevo (Free) | Emails de pedidos (300/día) | 0 € | No |
| Stripe | Cobrar con tarjeta | 0 € al mes | No (el vendedor da su IBAN para cobrar) |

**Stripe** no tiene cuota mensual, pero en cada venta se queda una comisión (con tarjetas europeas, en torno
al 1,5 % + 0,25 €). No es una factura aparte: se descuenta del cobro antes de que llegue a la cuenta del
vendedor. Todos los cobros con tarjeta online la tienen; la única forma de no pagarla sería cobrar por
transferencia bancaria, que la tienda no tiene programado.

Los costes del negocio (autónomo, gestoría, envíos GLS, que paga el comprador) no son de la web y no
entran aquí.

### Reglas para que siga siendo gratis

- Firebase: **nunca** pasar al plan Blaze ni activar Storage o Functions. Con Spark, si se supera el
  límite diario, la base de datos deja de responder hasta el día siguiente, pero nunca cobra.
- Cloudflare: no contratar «Workers Paid» ni añadir método de pago. Si se pasan las 100.000 peticiones
  diarias, las sobrantes fallan, pero no se cobra nada. Para esta tienda es un margen muy amplio.
- Cloudinary: plan Free, sin tarjeta. Si se agotan los 25 créditos mensuales, deja de servir fotos
  nuevas hasta el mes siguiente. Para un catálogo de este tamaño sobra.
- Emails: Brevo en plan Free (300 al día). No contratar ningún plan de Brevo ni Google Workspace, ni correo con el dominio.
- Si cualquier pantalla pide una tarjeta, es que se está contratando algo de pago: cancelar y volver atrás.

## Ya hecho

- Proyecto de Firebase `mivotunning-f973f` conectado (`.firebaserc` y `wrangler.toml`).
- Acceso al panel solo para mivotunning@gmail.com (`ADMIN_EMAILS`).
- Datos del vendedor: Ivaylo Marinov Ivanov, NIE X9388829E, Aceña Vieja 16 bajo, 09491 Fresnillo de
  las Dueñas (Burgos); mivotunning@gmail.com; +34 642 72 42 85 (teléfono y WhatsApp).
- Tarifa GLS Business Parcel 2026 aplicada automáticamente desde el código.
- DNI / NIE / CIF obligatorio en el checkout.
- Scripts para importar el catálogo de Wallapop y para pasar a las categorías y marcas nuevas.
- Emails con Brevo (API, plan gratuito) y remitente mivotunning@gmail.com. Los de un pedido llegan
  **solo** al comprador y a mivotunning@gmail.com (`ORDER_ALERT_EMAILS`; el panel no lo cambia).
- `secretos.env` (git lo ignora) para apuntar todos los tokens, y `npm run secrets` para subirlos a Cloudflare.
- `.vscode/` en el `.gitignore`.
- No quedan textos tipo `"[pendiente: ...]"` en páginas legales, contacto o envíos; si faltan datos, se muestran mensajes genéricos y no un placeholder técnico.
- Garantía de piezas usadas «1 año» por defecto; el panel no deja guardar menos de 1 año.
- Firestore creado en `europe-west1` (comprobado el 12 de noviembre de 2026).
- Clave API de Brevo (`xkeysib-…`) guardada en `secretos.env`.
- Tests en verde en local (unitarios 83/83, e2e y responsive), 20 de noviembre de 2026.

## 1. Datos del vendedor (bloquean la apertura)

- [x] Ivailo confirma que está dado de alta como autónomo (20 de noviembre).
- [ ] Confirmar con la gestoría el tratamiento fiscal aplicable a las ventas de la tienda.
- [x] Garantía de piezas usadas: «1 año» por defecto (mínimo legal, art. 120 TRLGDCU). El panel no deja
      guardar menos y, si en Firestore queda un valor no válido (había «0»), la web muestra «1 año».
      «1 año» guardado en Ajustes → Tienda; datos legales revisados y aviso «Configuración pendiente» eliminado
      (confirmado por el usuario el 20 de noviembre).
- [x] Textos de `public/legal/` (aviso legal, privacidad, condiciones, devoluciones, cookies): revisados el
      12 de noviembre de 2026 (en privacidad: la web la aloja Cloudflare y los emails los envía Brevo) y dados
      por buenos el 17 de noviembre de 2026.
- [x] Zonas de envío activas: Península, Baleares (Mallorca; Menorca, Ibiza y Formentera) y Portugal
      continental. Desactivadas: Canarias, Ceuta, Melilla y Andorra. Sin envío gratis.

## 2. Firebase (gratis, plan Spark)

- [x] Authentication: Ivailo confirma que puede entrar con su usuario (20 de noviembre).
- [x] Crear Firestore en `europe-west1`, en modo producción.
- [x] `npm run deploy:rules` (reglas e índices), 17 de noviembre de 2026. Firebase en plan Spark y usuario
      mivotunning@gmail.com creado (comprobado el mismo día).
- [x] Generar la clave de la cuenta de servicio (hace falta para los secretos y la importación).
- [x] `tienda.mivotunning.workers.dev` autorizado en Authentication (confirmado el 20 de noviembre).

## 3. Cloudflare (gratis, plan Free)

- [x] Crear la cuenta (sin tarjeta) y un token de API con la plantilla «Editar Cloudflare Workers».
      El token de `secretos.env` funciona y permite consultar el Worker (20 de noviembre).
- [x] Rellenar `secretos.env` y subir secretos con `npm run secrets`. Los cinco nombres esperados aparecen
      en Cloudflare (comprobado el 20 de noviembre); no se pueden consultar sus valores.
- [x] Primer `npm run deploy`. La tienda está en `https://tienda.mivotunning.workers.dev`, gratis y con HTTPS
      (último despliegue documentado: 17 de noviembre de 2026; URL comprobada con HTTP 200 el 20 de noviembre).

## 4. Fotos y catálogo (Cloudinary gratis)

- [x] Crear la cuenta de Cloudinary (plan Free, sin tarjeta; cloud name `k89cwscu`) y rellenar `CLOUDINARY_CLOUD_NAME` y
      `CLOUDINARY_API_KEY` en `wrangler.toml` y `CLOUDINARY_API_SECRET` en `secretos.env`. Sin esto
      el vendedor no puede subir fotos desde el panel.
- [x] Importar el catálogo a Firestore: 46 productos y 9 categorías, todos activos y con fotos (comprobado
      el 17 de noviembre de 2026).
- [ ] Revisar el stock (todas las piezas se importan con 1 unidad), el peso y las medidas del paquete,
      que hacen falta para calcular la tarifa GLS.
- [x] Borrar `service-account.json` del equipo (ausente en la comprobación local del 20 de noviembre).

## 5. Emails (Brevo gratis, 300/día)

- [x] Crear la cuenta de Brevo (plan Free, sin tarjeta) con mivotunning@gmail.com.
- [x] Remitentes → añadir y verificar mivotunning@gmail.com (llega un código a ese correo).
- [x] SMTP y API → Claves API → generar una (`xkeysib-…`) y ponerla en `secretos.env` (`BREVO_API_KEY`).
      Los datos SMTP (smtp-relay.brevo.com) no hacen falta: la tienda usa la API.
- [x] `BREVO_API_KEY` subida a Cloudflare. Emails enviándose bien (comprobado el 12 de noviembre de 2026).

## 6. Stripe (sin cuota; comisión por venta)

- [x] Acceso a Stripe recibido (confirmado por el usuario, 20 de noviembre).
- [x] Cuenta y claves de Stripe configuradas (confirmado por el usuario, 20 de noviembre).
- [ ] Crear el webhook live para `https://tienda.mivotunning.workers.dev/stripe/webhook` con los eventos
      `checkout.session.completed`, `checkout.session.expired`,
      `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` y `charge.refunded`;
      guardar su `whsec_…` actual en `secretos.env` y volver a ejecutar `npm run secrets`.
- [x] `npm run secrets` se ejecutó correctamente el 20 de noviembre; Cloudflare lista `STRIPE_WEBHOOK_SECRET`.
      Volver a ejecutarlo después de guardar el `whsec_…` del webhook nuevo; el valor no es visible desde Cloudflare.
- [ ] Probar un pago y confirmar que webhook, email, pedido y stock funcionan.

## 7. Panel (`/admin`)

- [x] Ajustes → Tienda: datos legales comprobados, garantía «1 año» guardada y aviso «Configuración pendiente» eliminado
      (confirmado por el usuario el 20 de noviembre).
- [ ] Ajustes → Envíos: comprobar las tarifas GLS, zonas y datos de los paquetes.
- [ ] Activar el checkout para clientes después de verificar el webhook live.

## 8. Pruebas y cierre

- [x] `npm test` (83/83), `npm run test:e2e` y `npm run test:responsive` en verde el 20 de noviembre
      de 2026; repetir antes de abrir si hay cambios posteriores.
- [ ] La compra de prueba en modo test se completó antes de abrir el checkout a clientes.
- [x] Que no quede ningún «[pendiente: …]» en las páginas legales, de contacto o de envíos (se rellenan
      solos al completar el panel). En la app ya se muestra texto genérico si faltan datos y no un placeholder técnico.
- [ ] Comprobar que ninguna cuenta tiene tarjeta guardada ni plan de pago: Firebase en **Spark**, Cloudflare en
      **Free** y Cloudinary en **Free**.
