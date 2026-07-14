import { createRoot } from 'react-dom/client';
import { BovedaProvider } from './lib/store.jsx';
import App from './App.jsx';
import './styles.css';

// Sin StrictMode a propósito: el doble montaje de efectos en dev duplicaría
// las llamadas a las APIs de precios (rate limits de CoinGecko).
createRoot(document.getElementById('root')).render(
  <BovedaProvider>
    <App />
  </BovedaProvider>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
