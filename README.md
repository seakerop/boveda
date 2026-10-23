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

Se puede desbloquear con huella o Face ID (WebAuthn con la extensión PRF): el chip
seguro del dispositivo envuelve la clave de la bóveda y la suelta solo tras verificar
al usuario. No se guarda nada biométrico y la contraseña sigue pidiéndose cada 14 días
para que no se olvide. Se activa por dispositivo desde Ajustes y se puede revocar.
Que quede claro el intercambio: WebAuthn acepta cualquier método de desbloqueo del
sistema (PIN incluido), así que con la huella activa la bóveda es tan fuerte como tu
bloqueo de pantalla.

Los precios vienen de Yahoo Finance (histórico completo, a través de un pequeño proxy
porque no tiene CORS), CoinGecko y el BCE para los tipos de cambio. Ninguna necesita
API key. La evolución del portfolio se reconstruye desde la primera compra y se pinta
en velas semanales con lightweight-charts, con una línea debajo con el dinero que has
ido metiendo: la distancia entre las dos es lo que has ganado de verdad.

Todo sale de las operaciones: compras, ventas, dividendos, alquileres y gastos de los
pisos. Cada operación en divisa guarda el tipo de cambio de su día, así que el coste en
euros es el que pagaste y no el de convertirlo hoy. Al vender eliges a qué cuenta va el
dinero, para que no desaparezca del patrimonio, y la app separa lo ganado en ventas de
lo que aún no has vendido. Con eso calcula la rentabilidad anual (TIR).

Para la renta hay un informe por año con las ganancias y pérdidas calculadas por FIFO,
que es como lo hace Hacienda (y no coincide con el precio medio), avisando de la regla
de los dos meses, y con los dividendos y sus retenciones. Se exporta a CSV. Es una
ayuda para preparar la declaración, no asesoramiento fiscal.

Avisa cuando toca hacer backup, cuando se acerca la revisión de la hipoteca y cuando la
valoración de un piso se ha quedado vieja. Y puedes fijar un reparto objetivo (tanto en
bolsa, tanto en cripto...) para ver cuánto te desvías.

También lleva las deudas: das de alta la hipoteca (fija o variable con Euríbor +
diferencial, que baja del BCE) y el cuadro de amortización se calcula en local, así
que el capital pendiente avanza solo cada mes. El patrimonio grande es el neto
(activos menos deudas) y en la ficha del piso ves el equity. Lo mejor es el simulador
de amortización anticipada: comparas reducir cuota contra reducir plazo y te dice
cuánto ahorras en intereses con cada uno.

## Deploy

`vercel deploy --prod` y ya. No hay variables de entorno. `vercel.json` lleva una CSP
estricta: la página solo ejecuta su propio código y solo habla con las APIs de precios.

## Pendiente

- Sincronizar entre dispositivos sin servidor que vea los datos (de momento, backup e
  importación)
