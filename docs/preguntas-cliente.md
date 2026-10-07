# Preguntas para el cliente

Mensaje listo para enviar por WhatsApp o email:

```text
¡Hola! Para terminar de preparar tu tienda online necesito que me respondas a estas preguntas.
No hace falta que sepas nada técnico, contesta con lo que sepas:

SOBRE TI Y LO QUE VENDES
1. ¿Estás dado de alta como autónomo? Si no, ¿tienes gestoría o alguien que te lleve
   los papeles? (Es importante consultarlo antes de abrir la tienda.)
2. Las piezas que vendes, ¿son nuevas, usadas o de las dos?
3. Si son usadas, ¿de dónde salen? (desguaces autorizados, coches propios, compras a particulares...)
4. ¿Cuántas piezas tienes a la venta más o menos ahora mismo? ¿Cuántas publicas al mes?
5. ¿Qué tipo de piezas vendes más? ¿De alguna marca de coche en concreto?
6. ¿Tienes fotos de las piezas o las haces tú con el móvil?

ENVÍOS
7. Ahora mismo, ¿cómo envías? ¿Con el envío de Wallapop, llevando el paquete a GLS,
   o de otra forma?
8. ¿Sabes cuánto te cuesta un envío con GLS? Si no, ¿podrías preguntar en tu agencia GLS
   el precio para un paquete de 2 kg, 5 kg, 10 kg y 20 kg a cualquier sitio de la Península?
9. ¿Quieres enviar solo a la Península o también a Baleares, Canarias o Portugal?
10. ¿Quieres ofrecer envío gratis a partir de cierto importe? ¿Cuánto?
11. ¿Envías piezas muy grandes o pesadas (puertas, capós, motores)?
12. ¿Me pasas un enlace de seguimiento de GLS de algún envío tuyo? (para que el cliente
    pueda seguir su paquete desde la tienda)

DEVOLUCIONES Y ATENCIÓN
13. ¿Qué garantía das en las piezas usadas? (tu gestoría te dirá el mínimo legal)
14. ¿Qué teléfono o WhatsApp quieres que aparezca para dudas de los clientes?

PAGOS Y WEB
15. ¿Tienes ya un nombre para la tienda? ¿Y un logo?
16. ¿Tienes un dominio (por ejemplo, mitienda.es)? Si no, ¿te parece bien comprar uno
    (unos 10-15 € al año)?
17. Para cobrar con tarjeta necesitarás crear una cuenta en Stripe a tu nombre
    (te enviaré una guía paso a paso). ¿Te parece bien?
18. ¿A qué email quieres que te lleguen los avisos de pedidos nuevos?

Importante: NUNCA me envíes contraseñas. Si en algún momento hace falta entrar en
alguna cuenta, te explicaré cómo hacerlo tú.
```

## Dónde se configura cada respuesta

| Respuesta | Dónde va |
|---|---|
| 1, 2, 3, 13 | Revisión legal/fiscal; plazo de garantía en Panel → Ajustes → Tienda |
| 4 | Confirma que el índice del catálogo es suficiente (hasta ~2.500 piezas) |
| 7–12 | Panel → Ajustes → Envíos (zonas, tarifas, gratis desde, enlace de seguimiento) |
| 14, 18 | Panel → Ajustes → Tienda |
| 15 | `public/assets/img/logo-mark.svg`, `favicon.svg`, `public/css/tokens.css` y nombre en Ajustes |
| 16 | Paso 11 de la puesta en producción |
| 17 | Paso 9 de la puesta en producción |
