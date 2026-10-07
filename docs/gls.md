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

El peso de cada pieza sale del «tamaño del paquete» (2/5/15/30 kg) o de un peso exacto.

## Integración futura (preparada, NO implementada)

`functions/src/shipping/providers/` define una interfaz común:

```js
createShipment(order) → { trackingNumber, trackingUrl?, labelPdfBase64? }
getStatus(trackingNumber) → { status, delivered }
```

Hoy solo existe `manual.js`. Para automatizar:

1. Crear `providers/gls.js` con esa interfaz, según la documentación oficial que facilite GLS al cliente.
2. Guardar credenciales con `firebase functions:secrets:set GLS_…` (nunca en el código).
3. Añadir en el panel un botón «Crear envío en GLS» (recomendado frente a hacerlo automáticamente al
   pagar, para que el vendedor confirme bulto y peso) que llame a `createShipment`, guarde el
   tracking en el pedido y lo marque como enviado (misma lógica que hoy `setStatus('shipped')`).

## Qué hay que preguntar al cliente (sin pedir contraseñas)

1. ¿Envía como particular (agencia/ParcelShop) o tiene contrato/cuenta de cliente con GLS?
2. ¿Cómo crea hoy los envíos? (portal web de GLS, la agencia lo recoge, en mostrador…)
3. ¿Qué tarifas paga por peso/destino? ¿A qué destinos quiere enviar?
4. Que pregunte a su agencia GLS: «¿Ofrecéis integración para tiendas online (API o módulo web)?
   ¿Qué requisitos tiene y qué documentación técnica dais?». Solo necesitamos el nombre del servicio
   y la documentación; las credenciales se configurarían directamente como secretos.
5. Un ejemplo de enlace de seguimiento de GLS de un envío suyo, para configurar `trackingUrlTemplate`.
