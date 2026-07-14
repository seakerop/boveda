# Bóveda

PWA personal para trackear todo tu patrimonio (crypto, bolsa, inmuebles y cash) en un solo
sitio, **cifrado de extremo a extremo en tu dispositivo**. Sin cuentas, sin servidor de datos.

## Arrancar

```bash
npm install
npm run dev     # http://localhost:5175
```

## Seguridad — cómo funciona

- **Todo cifrado en reposo**: la bóveda completa (operaciones, valoraciones, cachés de
  precios, snapshots) se guarda en IndexedDB como un único blob AES-256-GCM. La clave se
  deriva de tu contraseña maestra con PBKDF2-SHA256 (600.000 iteraciones). Ni la contraseña
  ni la clave se persisten jamás.
- **Sin contraseña no hay datos**: AES-GCM autentica; una contraseña incorrecta simplemente
  no descifra. No existe recuperación por diseño.
- **Auto-bloqueo** por inactividad (configurable) y al pasar la app a segundo plano.
- **Cartera señuelo**: puedes crear una segunda bóveda con otra contraseña. Al desbloquear,
  se abre la bóveda que corresponda a la contraseña introducida — son indistinguibles.
- **Tres modos de pantalla** (botón del ojo): cifras visibles, ocultas (•••••) o solo
  porcentajes (las gráficas pasan a eje porcentual: se ve la forma, no cuánto tienes).
- **Backups cifrados**: exporta un archivo con el mismo cifrado; se importa desde la
  pantalla de bloqueo.
- **Cero fugas**: sin analytics; a las APIs de precios solo viajan tickers públicos, nunca
  cantidades.

## Datos de mercado (todo gratuito, sin API keys)

| Fuente | Uso |
|---|---|
| Yahoo Finance | bolsa Y crypto: histórico diario completo (pares BTC-EUR, ETH-EUR…) + cotización, vía proxy propio `/api/yahoo` |
| CoinGecko | crypto: buscador de monedas y precio actual con cambio 24h; respaldo de histórico (su API gratuita limita a 365 días) |
| frankfurter.dev (BCE) | tipos de cambio diarios históricos y actuales |

Se eligió Yahoo para bolsa porque es el único free-tier con histórico completo ilimitado y
buena cobertura de bolsa europea (necesario para reconstruir las velas del portfolio);
Alpha Vantage (25 req/día) o Finnhub (sin histórico gratis) no llegan. El proxy
(`api/yahoo.js` en Vercel, middleware de `vite.config.js` en dev) existe porque Yahoo no
permite CORS; solo expone `search` y `chart`, no es un proxy abierto.

El histórico del portfolio se **reconstruye hacia atrás** desde tu primera operación con
precios históricos diarios, y se agrega en velas semanales. Los inmuebles se interpolan
linealmente entre tus valoraciones manuales. Un snapshot diario mantiene la vela de la
semana en curso.

## Simplificaciones asumidas (MVP)

- El coste medio de posiciones en divisa extranjera se convierte a EUR con el tipo de
  cambio **actual**, no el de la fecha de compra (el valor de mercado sí usa FX histórico).
- Las velas semanales se agregan de cierres diarios (no hay máximo/mínimo intradía).
- Desbloqueo biométrico (WebAuthn): pendiente; hoy el desbloqueo es solo por contraseña.

## Deploy (Vercel)

```bash
vercel deploy
```

No hay variables de entorno que configurar (ninguna API necesita key). `vercel.json` ya
tiene el rewrite de SPA excluyendo `/api/*`.
