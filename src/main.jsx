import { createRoot } from 'react-dom/client';
import { BovedaProvider } from './lib/store.jsx';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import '@fontsource-variable/inter';
import './styles.css';

// Sin StrictMode a propósito: el doble montaje de efectos en dev duplicaría
// las llamadas a las APIs de precios (rate limits de CoinGecko).
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <BovedaProvider>
      <App />
    </BovedaProvider>
  </ErrorBoundary>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
