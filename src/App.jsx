import { useState } from 'react';
import { useBoveda } from './lib/store.jsx';
import LockScreen from './components/LockScreen.jsx';
import Dashboard from './components/Dashboard.jsx';
import AssetDetail from './components/AssetDetail.jsx';
import AddAsset from './components/AddAsset.jsx';
import Settings from './components/Settings.jsx';

const PRIVACY_ICON = { normal: '👁', hidden: '🙈', percent: '％' };
const PRIVACY_TITLE = {
  normal: 'Cifras visibles — pulsa para ocultarlas',
  hidden: 'Cifras ocultas — pulsa para modo porcentajes',
  percent: 'Modo porcentajes — pulsa para mostrar cifras',
};

export default function App() {
  const { stage, privacy, cyclePrivacy, lock, refreshing, doRefresh } = useBoveda();
  const [view, setView] = useState({ name: 'dashboard' });
  const [adding, setAdding] = useState(false);

  if (stage === 'loading') {
    return <div className="splash">Bóveda</div>;
  }
  if (stage !== 'open') {
    return <LockScreen />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: 'dashboard' })}>
          <span className="brand-mark">◆</span> Bóveda
        </button>
        <div className="topbar-actions">
          <button
            className={`btn-icon ${refreshing ? 'spin' : ''}`}
            aria-label="Actualizar precios"
            title="Actualizar precios"
            onClick={doRefresh}
          >
            ↻
          </button>
          <button className="btn-icon" aria-label={PRIVACY_TITLE[privacy]} title={PRIVACY_TITLE[privacy]} onClick={cyclePrivacy}>
            {PRIVACY_ICON[privacy]}
          </button>
          <button className="btn-icon" aria-label="Ajustes" title="Ajustes" onClick={() => setView({ name: 'settings' })}>
            ⚙
          </button>
          <button className="btn-icon" aria-label="Bloquear" title="Bloquear" onClick={lock}>
            🔒
          </button>
        </div>
      </header>
      <main>
        {view.name === 'dashboard' && (
          <Dashboard onOpenAsset={(id) => setView({ name: 'asset', id })} onAdd={() => setAdding(true)} />
        )}
        {view.name === 'asset' && <AssetDetail assetId={view.id} onBack={() => setView({ name: 'dashboard' })} />}
        {view.name === 'settings' && <Settings onBack={() => setView({ name: 'dashboard' })} />}
      </main>
      {adding && <AddAsset onClose={() => setAdding(false)} />}
    </div>
  );
}
