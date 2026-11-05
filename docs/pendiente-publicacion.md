# Pendiente para publicar la tienda

Lista de tareas para poner Mivotunning en producción (noviembre 2026) **sin pagar nada salvo el
dominio** y **sin meter la tarjeta en ningún sitio**. Los pasos detallados de cada servicio están en [puesta-en-produccion.md](puesta-en-produccion.md).

## Lo que cuesta

| Servicio | Para qué | Coste | ¿Pide tarjeta? |
|---|---|---|---|
| Dominio | Dirección de la web | **~10–15 €/año** (lo único que se paga) | No: pagar por transferencia o PayPal |
| Cloudflare Workers (Free) | Web, servidor, DNS, HTTPS, tarea horaria | 0 € | No |
| Firebase **Spark** | Login del panel y base de datos | 0 € | No |
| Cloudinary (Free) | Fotos de las piezas | 0 € | No |
| Gmail (mivotunning@gmail.com) | Emails de pedidos | 0 € | No |
| Google Search Console | Aparecer en Google | 0 € | No |
| Stripe | Cobrar con tarjeta | 0 € al mes | No (el vendedor da su IBAN para cobrar) |

**Stripe** no tiene cuota, pero en cada venta se queda una comisión (con tarjetas europeas, en torno
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
- Emails: usar la cuenta de Gmail gratuita. No hace falta Google Workspace ni contratar correo con el dominio.
- Si cualquier pantalla pide una tarjeta, es que se está contratando algo de pago: cancelar y volver atrás.
- Dominio: mirar el **precio de renovación**, no solo el del primer año (muchas webs ponen el primero a
  1 € y luego cobran 20–30 €). No contratar extras: hosting, correo, «SSL», «protección SEO»… Cloudflare
  da gratis el DNS y el HTTPS.

## Ya hecho

- Proyecto de Firebase `mivotunning-f973f` conectado (`.firebaserc` y `wrangler.toml`).
- Acceso al panel solo para mivotunning@gmail.com (`ADMIN_EMAILS`).
- Datos del vendedor: Ivaylo Marinov Ivanov, NIE X9388829E, Aceña Vieja 16 bajo, 09491 Fresnillo de
  las Dueñas (Burgos); mivotunning@gmail.com; +34 642 72 42 85 (teléfono y WhatsApp).
- Tarifa GLS Business Parcel 2026 aplicada automáticamente desde el código.
- DNI / NIE / CIF obligatorio en el checkout.
- Scripts para importar el catálogo de Wallapop y para pasar a las categorías y marcas nuevas.
- Emails enviados desde mivotunning@gmail.com por SMTP (gratis, sin Brevo). Los de un pedido llegan
  **solo** al comprador y a mivotunning@gmail.com (`ORDER_ALERT_EMAILS`; el panel no lo cambia).
- `secretos.env` (git lo ignora) para apuntar todos los tokens, y `npm run secrets` para subirlos a Cloudflare.
- `.vscode/` en el `.gitignore`.
- Tests en verde en local (unitarios 86/86, e2e y responsive), 5 de noviembre de 2026.

## 1. Datos del vendedor (bloquean la apertura)

- [ ] Alta de autónomo y situación fiscal confirmadas por la gestoría.
- [ ] Garantía de piezas usadas: en el panel pone «0», y la página de devoluciones mostraría «plazo de
      garantía de 0». El mínimo legal para un consumidor es **1 año** (art. 120 TRLGDCU): poner «1 año».
- [ ] Textos de `public/legal/` (aviso legal, privacidad, condiciones, devoluciones, cookies): leerlos
      con el vendedor y pedir a su gestoría que les eche un vistazo. Así no hay que pagar un abogado aparte.
- [ ] Zonas de envío (Península, Portugal, ¿Baleares?) y si hay envío gratis a partir de cierto importe.

## 2. Firebase (gratis, plan Spark)

- [ ] Authentication: activar email/contraseña, crear el usuario mivotunning@gmail.com y desactivar el registro.
- [ ] Crear Firestore en `europe-west1`, en modo producción.
- [ ] `npm run deploy:rules` (reglas e índices).
- [ ] Generar `service-account.json` (hace falta para los secretos y la importación).

## 3. Cloudflare (gratis, plan Free)

- [ ] Crear la cuenta (sin tarjeta) y un token de API con la plantilla «Editar Cloudflare Workers».
      Ponerlo en `secretos.env` (`CLOUDFLARE_API_TOKEN`).
- [ ] Rellenar el resto de `secretos.env` (se puede dejar Stripe para el paso 6) y ejecutar `npm run secrets`.
- [ ] Primer `npm run deploy`. La tienda queda en `tienda.<cuenta>.workers.dev`, gratis y con HTTPS.
- [ ] Añadir ese dominio `.workers.dev` en Firebase → Authentication → Dominios autorizados.

## 4. Fotos y catálogo (Cloudinary gratis)

- [ ] Crear la cuenta de Cloudinary (plan Free, sin tarjeta) y rellenar `CLOUDINARY_CLOUD_NAME` y
      `CLOUDINARY_API_KEY` en `wrangler.toml` y `CLOUDINARY_API_SECRET` en `secretos.env`. Sin esto
      el vendedor no puede subir fotos desde el panel.
- [ ] Importar el catálogo a Firestore (`scripts/import-catalog.js` o `wallapop-import.js import`).
- [ ] Revisar el stock (todas las piezas se importan con 1 unidad), el peso y las medidas del paquete,
      que hacen falta para calcular la tarifa GLS.
- [ ] Borrar `service-account.json` del equipo.

## 5. Emails (Gmail gratis)

- [ ] Activar la verificación en 2 pasos en mivotunning@gmail.com y crear una contraseña de aplicación
      en <https://myaccount.google.com/apppasswords>.
- [ ] Ponerla en `secretos.env` (`GMAIL_APP_PASSWORD`) y ejecutar `npm run secrets`.
- [ ] Panel → Ajustes → Tienda: remitente vacío o mivotunning@gmail.com.

## 6. Stripe (sin cuota; comisión por venta)

- [ ] El vendedor crea la cuenta a su nombre y te invita como Desarrollador.
- [ ] Poner `sk_test_…` en `secretos.env`, crear el webhook `/stripe/webhook` con sus 5 eventos, poner su
      `whsec_…` y ejecutar `npm run secrets`.
- [ ] Probar en modo test: pago correcto, rechazado, con 3D Secure y cancelado (el stock tiene que volver).
- [ ] Pasar a real: el vendedor completa la verificación, se ponen `sk_live_…` y el `whsec_…` de un
      webhook nuevo en modo real, y se vuelve a ejecutar `npm run secrets`.

## 7. Panel (`/admin`)

- [ ] Ajustes → Tienda: comprobar los datos legales (el aviso «Configuración pendiente» del dashboard
      tiene que desaparecer).
- [ ] Ajustes → Envíos: comprobar las tarifas GLS y activar o desactivar zonas.
- [ ] Activar el checkout.
- [ ] Crear una pieza desde el móvil con fotos y comprobar que sale en la tienda.

## 8. Dominio (lo único que se paga)

- [ ] Comprar el dominio en un registrador que acepte **transferencia bancaria o PayPal** (muchos
      registradores españoles lo aceptan; comprobar los métodos de pago antes de registrarse). Solo el
      dominio, sin extras, y mirando el precio de renovación. No comprarlo en Cloudflare: pide tarjeta o PayPal.
- [ ] En el registrador, cambiar los servidores de nombres por los dos que da Cloudflare (gratis).
- [ ] Cloudflare: añadir el dominio (plan Free) y los dominios personalizados `www` y raíz en el Worker.
- [ ] `SITE_URL` en `wrangler.toml` y `npm run deploy`.
- [ ] Añadir el dominio en Firebase → Authentication → Dominios autorizados.
- [ ] Cambiar la URL del webhook de Stripe al dominio nuevo.
- [ ] Google Search Console (gratis): verificar el dominio por DNS y enviar `sitemap.xml`.

## 9. Pruebas y cierre

- [ ] `npm test`, `npm run test:e2e` y `npm run test:responsive` en verde justo antes de abrir.
- [ ] Un pedido completo de principio a fin: pago, email al comprador y a mivotunning@gmail.com, panel,
      marcar como enviado con seguimiento GLS y consultarlo en `/pedido`.
- [ ] Que no quede ningún «[pendiente: …]» en las páginas legales, de contacto o de envíos (se rellenan
      solos al completar el panel).
- [ ] Comprobar que ninguna cuenta tiene tarjeta guardada ni plan de pago: Firebase en **Spark**, Cloudflare en
      **Free** y Cloudinary en **Free**.
- [ ] Decidir si se quita la vista previa de GitHub Pages (también gratis), para no tener dos webs indexadas.
