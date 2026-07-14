# Bóveda

App personal para llevar mis inversiones (crypto, bolsa, inmuebles y cash) en un solo
sitio. Es una PWA que funciona entera en el navegador: no hay cuentas ni servidor, todo
se guarda cifrado en el propio dispositivo con una contraseña maestra.

```bash
npm install
npm run dev   # http://localhost:5175
```

## Cómo funciona

Los datos se cifran con AES-256-GCM antes de tocar IndexedDB (la clave sale de la
contraseña con PBKDF2, 600k iteraciones). Sin la contraseña no hay forma de recuperar
nada, no existe "olvidé mi contraseña". La app se bloquea sola con la inactividad y
se puede exportar un backup, que también va cifrado.

Extras de paranoia: un botón para ocultar las cifras (o mostrar solo porcentajes) y la
opción de crear una segunda bóveda con otra contraseña, por si alguien te obliga a
abrir la app.

Los precios vienen de Yahoo Finance (histórico completo, a través de un pequeño proxy
porque no tiene CORS), CoinGecko y el BCE para los tipos de cambio. Ninguna necesita
API key. La evolución del portfolio se reconstruye desde la primera compra y se pinta
en velas semanales con lightweight-charts.

También lleva las deudas: das de alta la hipoteca (fija o variable con Euríbor +
diferencial, que baja del BCE) y el cuadro de amortización se calcula en local, así
que el capital pendiente avanza solo cada mes. El patrimonio grande es el neto
(activos menos deudas) y en la ficha del piso ves el equity. Lo mejor es el simulador
de amortización anticipada: comparas reducir cuota contra reducir plazo y te dice
cuánto ahorras en intereses con cada uno.

## Deploy

`vercel deploy` y ya. No hay variables de entorno.

## Pendiente

- Desbloqueo con huella (WebAuthn)
- El coste de posiciones en divisa extranjera usa el tipo de cambio actual, no el
  del día de compra
