import { useState } from 'react';
import { useBoveda } from '../lib/store.jsx';

function PwForm({ label, onSubmit, danger }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setMsg('');
    if (pw.length < 8) return setMsg('Mínimo 8 caracteres.');
    if (pw !== pw2) return setMsg('No coinciden.');
    setBusy(true);
    try {
      await onSubmit(pw);
      setMsg('✓ Hecho');
      setPw('');
      setPw2('');
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-block">
      <input type="password" placeholder="Nueva contraseña" value={pw} onChange={(e) => setPw(e.target.value)} />
      <input type="password" placeholder="Repítela" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      {msg && <div className={msg.startsWith('✓') ? 'form-ok' : 'form-err'}>{msg}</div>}
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={go}>
        {busy ? 'Cifrando…' : label}
      </button>
    </div>
  );
}

export default function Settings({ onBack }) {
  const { data, mutate, changePassword, createDecoy, exportBackup, wipeVault, lock } = useBoveda();
  const [confirmWipe, setConfirmWipe] = useState('');
  const s = data.settings;

  return (
    <div className="detail settings">
      <div className="detail-head">
        <button className="btn-icon" aria-label="Volver" onClick={onBack}>←</button>
        <div className="detail-title">Ajustes</div>
      </div>

      <section className="card">
        <div className="card-title">Bloqueo</div>
        <label className="setting-row">
          <span>Auto-bloqueo por inactividad (minutos, 0 = nunca)</span>
          <input
            type="number"
            min="0"
            max="120"
            value={s.autoLockMin}
            onChange={(e) => mutate((d) => { d.settings.autoLockMin = Math.max(0, parseInt(e.target.value || '0', 10)); return d; })}
          />
        </label>
        <label className="setting-row">
          <span>Bloquear al pasar a segundo plano</span>
          <input
            type="checkbox"
            checked={s.lockOnHide}
            onChange={(e) => mutate((d) => { d.settings.lockOnHide = e.target.checked; return d; })}
          />
        </label>
        <button className="btn" onClick={lock}>Bloquear ahora</button>
      </section>

      <section className="card">
        <div className="card-title">Cambiar contraseña maestra</div>
        <p className="muted">Re-cifra toda la bóveda con la nueva contraseña.</p>
        <PwForm label="Cambiar contraseña" onSubmit={changePassword} />
      </section>

      <section className="card">
        <div className="card-title">Cartera señuelo</div>
        <p className="muted">
          Crea una segunda bóveda con su propia contraseña. Si alguien te obliga a abrir la app,
          desbloquea con esa contraseña y verá una cartera independiente (rellénala con datos
          modestos). Usa una contraseña distinta de la real.
        </p>
        <PwForm label="Crear señuelo" onSubmit={createDecoy} />
      </section>

      <section className="card">
        <div className="card-title">Backup</div>
        <p className="muted">
          El backup se exporta <strong>cifrado</strong> con tu contraseña actual: puedes guardarlo
          donde quieras. Se importa desde la pantalla de bloqueo.
        </p>
        <button className="btn btn-primary" onClick={exportBackup}>Exportar backup cifrado</button>
      </section>

      <section className="card danger-zone">
        <div className="card-title">Zona de peligro</div>
        <p className="muted">Borra esta bóveda de este dispositivo. Sin un backup, es irreversible.</p>
        <input
          placeholder='Escribe "BORRAR" para confirmar'
          value={confirmWipe}
          onChange={(e) => setConfirmWipe(e.target.value)}
        />
        <button className="btn btn-danger" disabled={confirmWipe !== 'BORRAR'} onClick={wipeVault}>
          Borrar bóveda definitivamente
        </button>
      </section>
    </div>
  );
}
