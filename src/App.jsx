import { useEffect, useState } from 'react';
import { useBoveda } from './lib/store.jsx';
import LockScreen, { BrandMark } from './components/LockScreen.jsx';
import Dashboard from './components/Dashboard.jsx';
import AssetDetail from './components/AssetDetail.jsx';
import AddAsset from './components/AddAsset.jsx';
import Settings from './components/Settings.jsx';
import DebtDetail from './components/DebtDetail.jsx';
import TaxReport from './components/TaxReport.jsx';
import Icon from './components/Icon.jsx';

const PRIVACY_ICON = { normal: 'eye', hidden: 'eyeOff', percent: 'percent' };
const PRIVACY_TITLE = {
  normal: 'Cifras visibles — pulsa para ocultarlas',
  hidden: 'Cifras ocultas — pulsa para ver solo porcentajes',
  percent: 'Solo porcentajes — pulsa para mostrar cifras',
};

function Toasts() {
  const { toasts, dismissToast } = useBoveda();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'ok' ? 'check' : 'info'} size={16} />
          </span>
          <span className="toast-text">{t.text}</span>
          {t.undo && (
            <button
              className="toast-undo"
              onClick={() => {
                t.undo();
                dismissToast(t.id);
              }}
            >
              <Icon name="undo" size={15} /> Deshacer
            </button>
          )}
          <button className="toast-close" aria-label="Cerrar aviso" onClick={() => dismissToast(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const { stage, bootError, privacy, cyclePrivacy, lock, refreshing, doRefresh } = useBoveda();
  const [view, setView] = useState({ name: 'dashboard' });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  // Al bloquear, la próxima sesión empieza en el panel principal.
  useEffect(() => {
    if (stage !== 'open') {
      setView({ name: 'dashboard' });
      setAdding(false);
    }
  }, [stage]);

  if (stage === 'error') {
    return (
      <div className="lock-screen">
        <div className="lock-card">
          <h1>No puedo abrir la bóveda</h1>
          <p className="lock-sub">
            El navegador no deja acceder al almacenamiento de la app. Suele pasar si hay otra pestaña de Bóveda abierta
            con una versión anterior (ciérrala) o en navegación privada. Tus datos no se han tocado.
          </p>
          <button className="btn btn-primary btn-block" onClick={() => location.reload()}>
            Reintentar
          </button>
          {bootError && <p className="bio-note">Detalle técnico: {bootError}</p>}
        </div>
      </div>
    );
  }
  if (stage === 'loading') {
    return (
      <div className="splash">
        <BrandMark size={44} />
      </div>
    );
  }
  if (stage !== 'open') {
    return <LockScreen />;
  }

  const home = () => setView({ name: 'dashboard' });
  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={home} aria-label="Ir al inicio">
          <BrandMark size={26} />
          <span>Bóveda</span>
        </button>
        <div className="topbar-actions">
          <button className="btn-icon" aria-label="Actualizar precios" title="Actualizar precios" onClick={doRefresh} disabled={refreshing}>
            <Icon name="refresh" className={refreshing ? 'spin' : ''} />
          </button>
          <button
            className={`btn-icon ${privacy !== 'normal' ? 'btn-icon-on' : ''}`}
            aria-label={PRIVACY_TITLE[privacy]}
            title={PRIVACY_TITLE[privacy]}
            onClick={cyclePrivacy}
          >
            <Icon name={PRIVACY_ICON[privacy]} />
          </button>
          <button className="btn-icon" aria-label="Ajustes" title="Ajustes" onClick={() => setView({ name: 'settings' })}>
            <Icon name="settings" />
          </button>
          <button className="btn-icon" aria-label="Bloquear" title="Bloquear" onClick={lock}>
            <Icon name="lock" />
          </button>
        </div>
      </header>
      <main>
        {view.name === 'dashboard' && (
          <Dashboard
            onOpenAsset={(id) => setView({ name: 'asset', id })}
            onOpenDebt={(id) => setView({ name: 'debt', id })}
            onOpenTax={() => setView({ name: 'tax' })}
            onOpenSettings={() => setView({ name: 'settings' })}
            onAdd={() => setAdding(true)}
          />
        )}
        {view.name === 'asset' && <AssetDetail key={view.id} assetId={view.id} onBack={home} />}
        {view.name === 'debt' && <DebtDetail key={view.id} debtId={view.id} onBack={home} />}
        {view.name === 'settings' && <Settings onBack={home} onOpenTax={() => setView({ name: 'tax' })} />}
        {view.name === 'tax' && <TaxReport onBack={home} />}
      </main>
      {adding && <AddAsset onClose={() => setAdding(false)} />}
      <Toasts />
    </div>
  );
}
