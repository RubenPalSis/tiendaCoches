# Puesta en producción — pasos exactos

Orden recomendado. Los pasos marcados con 👤 requieren una cuenta o un dato que solo puedes aportar tú
o el cliente. El resto se hace con comandos en la terminal de este proyecto.

> Las pantallas de Firebase y Stripe cambian de vez en cuando: si un botón tiene otro nombre, busca la
> opción equivalente en la misma sección.

---

## 1. 👤 Crear el proyecto de Firebase

1. Entra en <https://console.firebase.google.com> con la cuenta de Google de ZetaWeb.
2. Pulsa **Crear un proyecto** (o «Añadir proyecto»).
3. Nombre: por ejemplo `recambios-nombrecliente`. Anota el **ID del proyecto** que aparece debajo
   (p. ej. `recambios-nombrecliente-1a2b3`).
4. **Google Analytics: desactívalo** (no lo usamos). Pulsa **Crear proyecto**.

## 2. 👤 Activar el plan Blaze (obligatorio para Functions y Storage) y alerta de gasto

1. En la consola del proyecto, abajo a la izquierda, pulsa **Spark** → **Actualizar** (Upgrade).
2. Elige **Blaze (pago por uso)** → crea o vincula una cuenta de facturación con tarjeta.
3. Si te ofrece crear un presupuesto, pon **5 €**. Si no:
   <https://console.cloud.google.com/billing> → tu cuenta → **Presupuestos y alertas** →
   **Crear presupuesto** → proyecto: el de la tienda → importe **5 €** → alertas al 50 %, 90 % y 100 % → Guardar.

Coste esperado con el volumen de una tienda pequeña: 0 € (cuotas gratuitas). La alerta avisa, no corta el servicio.

## 3. 👤 Authentication (solo para el panel)

1. Menú izquierdo → **Compilación / Build** → **Authentication** → **Comenzar**.
2. Pestaña **Método de inicio de sesión** → **Correo electrónico/contraseña** → activa solo el primer
   interruptor → **Guardar**.
3. Pestaña **Usuarios** → **Agregar usuario** → email del vendedor y una contraseña provisional larga
   cualquiera (no hace falta que nadie la recuerde). Repite para el email de ZetaWeb si quieres acceso.
4. Pestaña **Configuración** → **Acciones del usuario** → **desmarca «Habilitar creación (registro)»**
   → Guardar. *(Si no aparece esta opción, no pasa nada: el panel exige además email verificado y que
   el email esté en la lista `ADMIN_EMAILS`.)*
5. Pestaña **Configuración** → **Dominios autorizados**: cuando tengas dominio propio, añádelo aquí.

El vendedor pondrá su propia contraseña: en `https://SU-DOMINIO/admin` → «He olvidado mi contraseña».
Al entrar por primera vez, el panel le pedirá verificar su email (un clic en el enlace que recibe).
**Nunca necesitas conocer su contraseña.**

## 4. 👤 Firestore y Storage

**Firestore:** Build → **Firestore Database** → **Crear base de datos** → edición **Standard** →
ubicación **europe-west1 (Bélgica)** → **modo de producción** → Crear.
*(La ubicación no se puede cambiar después.)*

**Storage:** Build → **Storage** → **Comenzar** → ubicación **US-CENTRAL1** (es de las que no tienen
coste hasta 5 GB; solo guarda fotos públicas de productos, sin datos personales) → modo de producción → Listo.

## 5. Conectar este proyecto con Firebase (terminal)

```bash
firebase login --no-localhost
```
Abre el enlace que aparece, inicia sesión con la cuenta de ZetaWeb, copia el código y pégalo en la terminal.

```bash
firebase use --add
```
Elige el proyecto creado y escribe `default` como alias.

## 6. Administradores del panel

```bash
cp functions/.env.example functions/.env
```
Edita `functions/.env` y pon los emails con acceso al panel, separados por comas:

```
ADMIN_EMAILS=vendedor@sucorreo.com,ruben.palacio@zierzoware.com
SITE_URL=
```

- `ADMIN_EMAILS` es obligatorio: si está vacío, nadie puede entrar al panel. Quitar un email de la
  lista y redesplegar (`firebase deploy --only functions`) le retira el acceso (como máximo en 1 hora
  también para Firestore/Storage).
- `SITE_URL`: déjalo vacío hasta tener dominio propio (se usará `https://ID-PROYECTO.web.app`).
  Con dominio, pon `SITE_URL=https://www.sudominio.es` y redespliega las funciones (paso 11).

## 7. Secretos (claves privadas, nunca en el código)

Para empezar, sin Stripe ni email (se configuran en los pasos 9 y 10):

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY      # pega: sk_test_pendiente
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET  # pega: whsec_pendiente
firebase functions:secrets:set SMTP_URL               # pega: disabled
```

## 8. Primer despliegue

```bash
npm install && (cd functions && npm install)
npm run deploy
```

- Si pregunta si activar APIs (Cloud Functions, Cloud Build, Artifact Registry, Secret Manager,
  Eventarc, Cloud Scheduler…), responde **Y**.
- Si pregunta cuántos días guardar las imágenes de contenedor, responde **1** (evita costes de almacenamiento).
- Al terminar, anota:
  - **Hosting URL**: `https://ID-PROYECTO.web.app` (la tienda).
  - La URL de la función **stripeWebhook** (aparece en el listado; también en Firebase → Functions).

Comprueba en Firebase → Firestore → pestaña **TTL** que existen las políticas `orders.deleteAt` y
`stripeEvents.deleteAt`. Si no aparecen: **Crear política** → grupo `orders`, campo `deleteAt`; y lo
mismo para `stripeEvents`.

Entra en `/admin`, completa **Ajustes → Tienda** (datos legales), **Ajustes → Envíos** (tarifas) y
crea las categorías. Hasta que existan las tarifas de envío, la tienda no acepta pedidos.

### 8 bis. Importar el catálogo de Wallapop a Firebase

El importador necesita una credencial de servicio **temporal**:

1. 👤 Firebase → ⚙️ **Configuración del proyecto** → **Cuentas de servicio** → **Generar nueva clave privada**
   → guarda el archivo en la raíz de este proyecto como `service-account.json` (git lo ignora).
2. En la terminal:

```bash
node scripts/wallapop-import.js fetch evjrr10w7xjk     # si no está ya descargado
GOOGLE_APPLICATION_CREDENTIALS=service-account.json GCLOUD_PROJECT=ID-PROYECTO \
  node scripts/wallapop-import.js import
```

3. **Borra `service-account.json`** y en la misma pantalla de Cuentas de servicio → **Administrar
   permisos de la cuenta de servicio** → elimina la clave creada.
4. Revisa en el panel el **stock** de cada producto (Wallapop no lo indica; se importan con 1 unidad).

## 9. 👤 Stripe

La cuenta debe estar **a nombre del vendedor** (cobra él). Empieza en **modo de prueba**.

1. El vendedor crea la cuenta en <https://dashboard.stripe.com/register>.
2. Con el interruptor **Modo de prueba** activado: **Desarrolladores** → **Claves de API** →
   **Clave secreta** → Revelar → copiar (`sk_test_…`).

```
VALOR QUE NECESITO: clave secreta de Stripe (sk_test_… y más adelante sk_live_…)
DÓNDE OBTENERLO:    Stripe → Desarrolladores → Claves de API → Clave secreta
DÓNDE PEGARLO:      en la terminal, al ejecutar: firebase functions:secrets:set STRIPE_SECRET_KEY
```
*(La pega quien tenga acceso a la cuenta; no hace falta enviarla por chat ni email.)*

3. **Desarrolladores** → **Webhooks** → **Añadir destino / endpoint**:
   - URL: la de la función `stripeWebhook` del paso 8.
   - Eventos: `checkout.session.completed`, `checkout.session.expired`,
     `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`.
   - Guardar → en el detalle del webhook, **Clave de firma** → Revelar → copiar (`whsec_…`).

```
VALOR QUE NECESITO: clave de firma del webhook (whsec_…)
DÓNDE OBTENERLO:    Stripe → Desarrolladores → Webhooks → (tu endpoint) → Clave de firma
DÓNDE PEGARLO:      firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

4. Redesplegar las funciones para que lean los secretos: `firebase deploy --only functions`
5. Recomendado en Stripe → **Configuración**:
   - **Métodos de pago**: tarjetas, Apple Pay y Google Pay activados.
   - **Imagen de marca**: logo y color (se ven en la página de pago).
   - **Emails a clientes** → «Pagos correctos»: activado (recibo automático de Stripe).

**Pruebas (modo test):** tarjeta `4242 4242 4242 4242` (pago correcto), `4000 0000 0000 0002`
(rechazada), `4000 0025 0000 3155` (pide autenticación). Cualquier fecha futura y CVC.
Comprueba que el pedido aparece en el panel como **Pagado** y que el stock baja.

**Pasar a real:** cuando el vendedor complete la verificación de Stripe (identidad y cuenta bancaria),
repite los pasos 2–4 con el interruptor de prueba desactivado (`sk_live_…` y un webhook nuevo en modo real).

## 10. 👤 Emails (confirmación, envío, avisos al vendedor)

Recomendado: **Brevo** (gratis hasta 300 emails/día) con el dominio de la tienda.

1. Cuenta en <https://www.brevo.com> → **Remitentes, dominios e IP** → **Dominios** → añadir el dominio
   → añade en el DNS del dominio los registros que indica (DKIM, DMARC) → Verificar.
2. **SMTP y API** → pestaña **SMTP** → **Generar una nueva clave SMTP** → copia el **usuario (login)** y la clave.
3. En la terminal:

```bash
firebase functions:secrets:set SMTP_URL
# pega: smtp://LOGIN:CLAVE@smtp-relay.brevo.com:587
firebase deploy --only functions
```
Si el login o la clave contienen `@`, `:` o `/`, sustitúyelos por `%40`, `%3A` o `%2F`.

4. En el panel → Ajustes → Tienda: **Remitente** = una dirección de ese dominio (p. ej. `pedidos@sudominio.es`)
   y **Email de avisos** = donde el vendedor quiere recibir los pedidos.

## 11. 👤 Dominio propio

Firebase → **Hosting** → **Agregar dominio personalizado** → escribe el dominio → añade en tu
proveedor de dominio los registros DNS que indica → espera la verificación (minutos u horas; el
certificado HTTPS es automático). Añade el dominio en Authentication → Dominios autorizados.

Después, en `functions/.env` pon `SITE_URL=https://www.sudominio.es` y ejecuta
`firebase deploy --only functions` (los enlaces de Stripe, emails, canonical y sitemap usan ese dominio).

## 12. 👤 Google Search Console

<https://search.google.com/search-console> → Añadir propiedad → **Dominio** → verificación DNS →
**Sitemaps** → enviar `https://SU-DOMINIO/sitemap.xml`.

## 13. Checklist final antes de abrir

- [ ] Alta de autónomo / situación fiscal confirmada por la gestoría.
- [ ] Textos legales revisados por un profesional y datos del vendedor completos (sin avisos «[pendiente…]»).
- [ ] Tarifas de envío GLS reales en Ajustes → Envíos.
- [ ] Pedido de prueba completo en modo test: pago, email, panel, marcar enviado con seguimiento.
- [ ] Pago rechazado y pago cancelado probados (el stock vuelve).
- [ ] Stripe en modo real y webhook real configurados.
- [ ] Dominio, HTTPS y Search Console.
- [ ] Alerta de presupuesto creada.
