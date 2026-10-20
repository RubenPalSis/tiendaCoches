# Envíos con GLS

## Situación actual: gestión manual (implementada)

No se asume ninguna integración con GLS. El flujo funciona tanto si el vendedor lleva los paquetes a
una agencia/ParcelShop como si usa el portal de GLS:

1. El cliente introduce su dirección; el coste de envío se calcula con las **reglas configurables**
   (Panel → Ajustes → Envíos): zonas por país y prefijo de código postal, tramos por peso total y
   envío gratis desde un importe. No hay precios de GLS escritos en el código.
2. Stripe confirma el pago por webhook → el pedido aparece «Pagado» y el vendedor recibe un email.
3. El vendedor prepara el paquete (hoja de pedido imprimible, botón «Copiar dirección»).
4. Gestiona el envío con GLS como siempre.
5. Introduce el número de seguimiento → «Marcar como enviado» → email al cliente con el número y,
   si está configurada, la URL de seguimiento (`trackingUrlTemplate` con `{tracking}`).
6. «Marcar como entregado».

### Peso, medidas y peso volumétrico

Cada unidad vendida es un bulto. El envío se cobra por el **peso facturable** del pedido: la suma, bulto
a bulto, del mayor entre el peso real y el peso volumétrico (`largo × ancho × alto (cm) ÷ divisor`), que
es como factura GLS. Se busca el tramo de la zona con ese peso.

- **Peso real:** «tamaño del paquete» de la ficha (2/5/15/30 kg) o peso exacto.
- **Medidas** (opcionales, en cm, con embalaje): largo, ancho y alto en la ficha. Sin medidas solo cuenta el peso real.
- **Ajustes → Envíos → Peso volumétrico y medidas:**
  - `volumetricDivisor` (5000 por defecto; 0 = solo peso real). **Confirmar con GLS** el de su contrato.
  - `bulkyLength`: un bulto cuyo lado más largo supera esta medida es voluminoso y suma el recargo
    `bulkySurcharge` de la zona (por bulto, también con envío gratis).
  - `maxLength`: por encima no se puede pagar online; se pide al cliente que solicite presupuesto.
- En el pedido, el panel muestra el peso facturable, el real y los bultos con sus medidas para
  documentar el envío en GLS.

Código: `public/js/shared/shipping.js` (el mismo cálculo en el navegador y en el servidor).

### Tarifa del cliente: GLS Business Parcel 2026

La tarifa del documento «Tarifas paquetería 2026 TI D.pdf» está en el código
(`public/js/shared/gls-tariff.js`) y **se aplica sola**: la primera vez que el Worker lee
`settings/shipping` tras el despliegue (`server/src/shipping/gls-tariff.js`, llamado desde
`getSettings`) sustituye las zonas y precios en Firestore y deja la marca
`meta/migrations.shipping-gls-business-parcel-2026`. No vuelve a ejecutarse: lo que el vendedor cambie
después en Ajustes → Envíos se respeta. Los envíos anteriores quedan en
`meta/shipping-before-gls-business-parcel-2026`.

- Precios del documento **sin IVA** → se guardan con el IVA que paga el cliente (precio × 1,21, al
  céntimo) en península, Baleares y Portugal. El checkout cobra el importe guardado tal cual (no suma IVA).
- Canarias (24,52 €, solo 1 kg) y Andorra se guardan **sin IVA y desactivadas**: están fuera del
  territorio del IVA español (aduana/DUA). Activarlas es una decisión fiscal del vendedor.
- Ceuta y Melilla: **sin precio en el documento** → zonas desactivadas y sin tramos; aunque se activen,
  no se puede pagar el envío. Madeira y Azores (CP 9…) no tienen zona.
- Solo los tramos del documento (1, 3, 5, 10 y 15 kg; en Baleares y Canarias solo 1 kg). **Sin kg
  adicional**: por encima del último tramo el cliente no puede pagar online y se le pide presupuesto.
- Divisor volumétrico 5000; Canarias (marítimo) 3000 en su zona.
- Límites por paquete: **largo + perímetro ≤ 300 cm** (`maxGirth`) y **40 kg** reales (`maxPackageWeight`).
- Seguimiento: la página oficial de GLS España pide número y código postal y no admite el número en la
  URL, así que se enlaza sin parámetros; el email y el pedido muestran el número.
- El botón **«Cargar tarifa GLS Business Parcel 2026»** del panel vuelve a poner la tarifa en el
  formulario (no guarda hasta pulsar «Guardar envíos»).
- Se conservan el envío gratis, el plazo y el recargo por voluminoso de las zonas con el mismo id.
- Los suplementos opcionales de GLS (reembolso, recogida, SMS…) no se cobran en la tienda.

## Integración futura (preparada, NO implementada)

`server/src/shipping/providers/` define una interfaz común:

```js
createShipment(order) → { trackingNumber, trackingUrl?, labelPdfBase64? }
getStatus(trackingNumber) → { status, delivered }
```

Hoy solo existe `manual.js`. Para automatizar:

1. Crear `providers/gls.js` con esa interfaz, según la documentación oficial que facilite GLS al cliente.
2. Guardar credenciales con `npx wrangler secret put GLS_…` (nunca en el código).
3. Añadir en el panel un botón «Crear envío en GLS» (recomendado frente a hacerlo automáticamente al
   pagar, para que el vendedor confirme bulto y peso) que llame a `createShipment`, guarde el
   tracking en el pedido y lo marque como enviado (misma lógica que hoy `setStatus('shipped')`).

## Qué hay que preguntar al cliente (sin pedir contraseñas)

1. ¿Envía como particular (agencia/ParcelShop) o tiene contrato/cuenta de cliente con GLS?
2. ¿Cómo crea hoy los envíos? (portal web de GLS, la agencia lo recoge, en mostrador…)
3. ¿Qué tarifas paga por peso/destino? ¿A qué destinos quiere enviar? ¿Qué divisor de peso volumétrico
   aplica GLS a su cuenta, qué medidas máximas admite y cuánto cobra por bulto voluminoso o fuera de medidas?
4. Que pregunte a su agencia GLS: «¿Ofrecéis integración para tiendas online (API o módulo web)?
   ¿Qué requisitos tiene y qué documentación técnica dais?». Solo necesitamos el nombre del servicio
   y la documentación; las credenciales se configurarían directamente como secretos.
5. Un ejemplo de enlace de seguimiento de GLS de un envío suyo, para configurar `trackingUrlTemplate`.
