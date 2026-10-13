# Puesta en producción: pasos exactos (todo en planes gratuitos)

Orden recomendado. Los pasos marcados con 👤 requieren una cuenta o un dato que solo puedes aportar tú
o el cliente. El resto se hace con comandos en la terminal de este proyecto.

**Ningún servicio pide tarjeta ni plan de pago:**

| Servicio | Para qué | Límite gratuito |
|---|---|---|
| Cloudflare Workers | Web + servidor (pagos, emails, páginas para Google, panel, tarea horaria) | 100.000 peticiones/día al servidor; archivos de la web sin límite |
| Firebase **Spark** | Login del panel + base de datos (Firestore) | 50.000 lecturas y 20.000 escrituras/día, 1 GB |
| Cloudinary | Fotos de las piezas | 25 créditos/mes (1 crédito ≈ 1 GB de tráfico o de espacio) |
| Brevo | Emails de pedidos | 300 emails/día |
| Stripe (cuenta del cliente) | Cobros | Sin cuota; solo comisión por venta |

Los únicos costes son el dominio (~10–15 €/año) y la comisión de Stripe por venta.

> Las pantallas de estos servicios cambian de vez en cuando: si un botón tiene otro nombre, busca la
> opción equivalente en la misma sección.

---

## 1. 👤 Proyecto de Firebase (plan Spark, sin facturación)

1. Entra en <https://console.firebase.google.com> con la cuenta de Google de ZetaWeb.
2. **Crear un proyecto** → nombre, p. ej. `recambios-nombrecliente`. Anota el **ID del proyecto**
   (p. ej. `recambios-nombrecliente-1a2b3`).
3. **Google Analytics: desactívalo.** Crear proyecto.
4. **No actives el plan Blaze ni Storage ni Functions**: no se usan.

### Authentication (solo para el panel)

1. **Compilación / Build** → **Authentication** → **Comenzar**.
2. **Método de inicio de sesión** → **Correo electrónico/contraseña** → activa solo el primer interruptor → Guardar.
3. **Usuarios** → **Agregar usuario** → email del vendedor y una contraseña provisional larga cualquiera.
   Repite con el email de ZetaWeb si quieres acceso.
4. **Configuración** → **Acciones del usuario** → **desmarca «Habilitar creación (registro)»** → Guardar.
   *(Si no aparece, no pasa nada: el panel exige además email verificado y estar en `ADMIN_EMAILS`.)*

El vendedor pone su propia contraseña en `https://SU-DOMINIO/admin` → «He olvidado mi contraseña».
**Nunca necesitas conocer su contraseña.**

### Firestore

**Build** → **Firestore Database** → **Crear base de datos** → edición **Standard** → ubicación
**europe-west1 (Bélgica)** → **modo de producción** → Crear. *(La ubicación no se puede cambiar después.)*

### Configuración web y cuenta de servicio

```
VALOR QUE NECESITO: configuración web de Firebase (objeto con apiKey, authDomain, projectId…; es pública)
DÓNDE OBTENERLO:    Firebase → ⚙️ Configuración del proyecto → General → Tus apps → icono </> (Web)
                    → apodo «tienda» → Registrar app (sin Hosting) → copia el objeto firebaseConfig
DÓNDE PEGARLO:      wrangler.toml → FIREBASE_WEB_CONFIG, en una sola línea y con comillas simples, p. ej.:
                    FIREBASE_WEB_CONFIG = '{"apiKey":"AIza…","authDomain":"ID.firebaseapp.com","projectId":"ID","appId":"1:…"}'
                    y FIREBASE_PROJECT_ID = "ID-DEL-PROYECTO"
```

```
VALOR QUE NECESITO: clave de la cuenta de servicio (archivo JSON; da acceso del servidor a Firestore y Authentication)
DÓNDE OBTENERLO:    Firebase → ⚙️ Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada
                    → guárdalo en la raíz de este proyecto como service-account.json (git lo ignora)
DÓNDE PEGARLO:      en el paso 3 (secreto FIREBASE_SERVICE_ACCOUNT). Después BORRA el archivo local.
```

## 2. Reglas e índices de Firestore (terminal)

```bash
firebase login --no-localhost        # abre el enlace, entra con la cuenta de ZetaWeb y pega el código
firebase use --add                   # elige el proyecto y escribe «default» como alias
npm run deploy:rules                 # reglas de seguridad e índices (funciona en el plan Spark)
```

Firestore → pestaña **TTL** → **Crear política**: grupo `orders`, campo `deleteAt`; y otra con grupo
`stripeEvents`, campo `deleteAt` (borran solos los pedidos nunca pagados y los eventos antiguos).

## 3. 👤 Cloudflare: conectar la terminal y configurar

### Conectar esta terminal con tu cuenta

```
VALOR QUE NECESITO: token de API de Cloudflare
DÓNDE OBTENERLO:    dash.cloudflare.com → icono de perfil (arriba a la derecha) → Perfil → Tokens de API
                    → Crear token → plantilla «Editar Cloudflare Workers» → Usar plantilla
                    → Recursos de la cuenta: tu cuenta · Recursos de zona: Todas las zonas → Continuar → Crear token
DÓNDE PEGARLO:      en la terminal de este proyecto (no lo envíes por chat ni email):
                    export CLOUDFLARE_API_TOKEN=el-token-copiado
```

Comprueba con `npx wrangler whoami` que aparece tu cuenta. *(El token solo vive en esa terminal; si la
cierras, vuelve a hacer el `export`.)*

### Variables públicas (`wrangler.toml` → `[vars]`)

- `ADMIN_EMAILS`: emails con acceso al panel separados por comas, p. ej.
  `"vendedor@sucorreo.com,ruben.palacio@zierzoware.com"`. Si está vacío, nadie puede entrar al panel.
  Quitar un email y volver a publicar le retira el acceso (la tarea horaria cierra también sus sesiones).
- `FIREBASE_PROJECT_ID` y `FIREBASE_WEB_CONFIG`: del paso 1.
- `SITE_URL`: déjalo vacío hasta tener dominio propio.
- `CLOUDINARY_*`: en el paso 5.

### Secretos (nunca en el código)

```bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < service-account.json
rm service-account.json
npx wrangler secret put STRIPE_SECRET_KEY        # de momento escribe: sk_test_pendiente
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # de momento escribe: whsec_pendiente
npx wrangler secret put BREVO_API_KEY            # de momento escribe: disabled
npx wrangler secret put CLOUDINARY_API_SECRET    # de momento escribe: pendiente
```

*(La primera vez puede decir que el Worker no existe y ofrecer crearlo: responde que sí.)*

## 4. Primer despliegue

```bash
npm install
npm run deploy
```

Al terminar muestra la dirección de la tienda: `https://tienda.TU-SUBDOMINIO.workers.dev`.

```
VALOR QUE NECESITO: dominio de la tienda (el .workers.dev y, más adelante, el propio)
DÓNDE OBTENERLO:    salida de `npm run deploy`
DÓNDE PEGARLO:      Firebase → Authentication → Configuración → Dominios autorizados → Agregar dominio
                    (sin https://; sin esto el panel no puede iniciar sesión)
```

Entra en `/admin`, completa **Ajustes → Tienda** (datos legales), **Ajustes → Envíos** (tarifas) y
crea las categorías. Hasta que existan las tarifas de envío, la tienda no acepta pedidos.

Registros del servidor: Cloudflare → **Workers y Pages** → `tienda` → **Registros**, o `npx wrangler tail`.

## 5. 👤 Cloudinary (fotos)

1. Cuenta gratuita en <https://cloudinary.com/users/register_free> (sin tarjeta).
2. En el **Dashboard** (o **Settings → API Keys**) aparecen los tres datos:

```
VALOR QUE NECESITO: Cloud name y API key (públicos)
DÓNDE OBTENERLO:    Cloudinary → Dashboard / Settings → API Keys
DÓNDE PEGARLO:      wrangler.toml → CLOUDINARY_CLOUD_NAME y CLOUDINARY_API_KEY
```
```
VALOR QUE NECESITO: API secret
DÓNDE OBTENERLO:    Cloudinary → Settings → API Keys → «API Secret» (Reveal)
DÓNDE PEGARLO:      npx wrangler secret put CLOUDINARY_API_SECRET
```

3. `npm run deploy`. Prueba en el panel a crear una pieza con una foto.

### Importar el catálogo de Wallapop

Necesita la clave de la cuenta de servicio (paso 1) **de forma temporal** y los datos de Cloudinary:

```bash
node scripts/wallapop-import.js fetch evjrr10w7xjk     # si no está ya descargado
GOOGLE_APPLICATION_CREDENTIALS=service-account.json GCLOUD_PROJECT=ID-PROYECTO \
CLOUDINARY_CLOUD_NAME=… CLOUDINARY_API_KEY=… CLOUDINARY_API_SECRET=… \
  node scripts/wallapop-import.js import
rm service-account.json
```

Sube las fotos a Cloudinary, crea los productos y reconstruye el índice de la tienda. Revisa después
en el panel el **stock** de cada pieza (Wallapop no lo indica; se importan con 1 unidad).

## 6. 👤 Stripe

La cuenta debe estar **a nombre del vendedor** (cobra él) y te invita como miembro del equipo
(Configuración → Equipo → Añadir miembro → tu email, rol «Desarrollador»). Empieza en **modo de prueba**.

```
VALOR QUE NECESITO: clave secreta de Stripe (sk_test_… y más adelante sk_live_…)
DÓNDE OBTENERLO:    Stripe → Desarrolladores → Claves de API → Clave secreta → Revelar
DÓNDE PEGARLO:      npx wrangler secret put STRIPE_SECRET_KEY
```

**Desarrolladores** → **Webhooks** → **Añadir destino / endpoint**:
- URL: `https://SU-DOMINIO/stripe/webhook` (de momento, el `.workers.dev`).
- Eventos: `checkout.session.completed`, `checkout.session.expired`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`.

```
VALOR QUE NECESITO: clave de firma del webhook (whsec_…)
DÓNDE OBTENERLO:    Stripe → Desarrolladores → Webhooks → (tu endpoint) → Clave de firma → Revelar
DÓNDE PEGARLO:      npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Los secretos se aplican al momento (no hace falta volver a publicar). Recomendado en Stripe →
**Configuración**: tarjetas, Apple Pay y Google Pay activados; logo y color; recibos por email activados.

**Pruebas (modo test):** tarjeta `4242 4242 4242 4242` (correcto), `4000 0000 0000 0002` (rechazada),
`4000 0025 0000 3155` (pide autenticación). Cualquier fecha futura y CVC. Comprueba que el pedido
aparece en el panel como **Pagado** y que el stock baja.

**Pasar a real:** cuando el vendedor complete la verificación de Stripe, repite este paso con el modo
de prueba desactivado (`sk_live_…` y un webhook nuevo en modo real).

## 7. 👤 Emails con Brevo

1. Cuenta gratuita en <https://www.brevo.com>.
2. **Remitentes, dominios e IP** → **Dominios** → añade el dominio de la tienda → añade en su DNS los
   registros que indica (DKIM, DMARC) → Verificar. *(Hasta tener dominio puedes verificar un remitente
   suelto en «Remitentes».)*

```
VALOR QUE NECESITO: clave de API de Brevo (xkeysib-…)
DÓNDE OBTENERLO:    Brevo → menú de la cuenta → SMTP y API → pestaña «Claves API» → Generar una nueva clave API
DÓNDE PEGARLO:      npx wrangler secret put BREVO_API_KEY
```

3. En el panel → Ajustes → Tienda: **Remitente** = una dirección del dominio verificado (p. ej.
   `pedidos@sudominio.es`) y **Email de avisos** = donde el vendedor quiere recibir los pedidos.

## 8. 👤 Dominio propio

El dominio tiene que estar gestionado por Cloudflare (gratis):

1. Cloudflare → **Añadir un dominio** → plan **Free** → Cloudflare te da 2 servidores de nombres.
2. En la web donde compraste el dominio, cambia sus servidores de nombres por esos dos (puede tardar unas horas).
3. Cloudflare → **Workers y Pages** → `tienda` → **Configuración** → **Dominios y rutas** → **Añadir** →
   **Dominio personalizado** → `www.sudominio.es` (y otro con `sudominio.es`). El HTTPS es automático.
4. `wrangler.toml` → `SITE_URL = "https://www.sudominio.es"` → `npm run deploy`.
5. Añade el dominio en Firebase → Authentication → Dominios autorizados.
6. Cambia la URL del webhook de Stripe al nuevo dominio.

## 9. 👤 Google Search Console

<https://search.google.com/search-console> → Añadir propiedad → **Dominio** → verificación DNS (en
Cloudflare → DNS) → **Sitemaps** → enviar `https://SU-DOMINIO/sitemap.xml`.

## 10. Checklist final antes de abrir

- [ ] Alta de autónomo / situación fiscal confirmada por la gestoría.
- [ ] Textos legales revisados y datos del vendedor completos (sin avisos «[pendiente…]»).
- [ ] Tarifas de envío GLS reales en Ajustes → Envíos.
- [ ] Pieza creada desde el móvil con fotos (Cloudinary) y visible en la tienda.
- [ ] Pedido de prueba completo en modo test: pago, email, panel, marcar enviado con seguimiento.
- [ ] Pago rechazado y pago cancelado probados (el stock vuelve).
- [ ] Stripe en modo real y webhook real configurados.
- [ ] Dominio, HTTPS, dominio autorizado en Firebase y Search Console.
- [ ] Firebase sigue en plan **Spark** (sin facturación) y `service-account.json` borrado del equipo.
