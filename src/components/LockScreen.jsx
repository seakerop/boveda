import { useRef, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';

export default function LockScreen() {
  const { stage, unlock, createAndOpen, importBackup } = useBoveda();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(stage === 'setup');
  const fileRef = useRef(null);

  const setup = stage === 'setup' || creating;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (setup) {
      if (pw.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.');
      if (pw !== pw2) return setErr('Las contraseñas no coinciden.');
      if (!ack) return setErr('Debes confirmar que entiendes que es irrecuperable.');
      setBusy(true);
      try {
        await createAndOpen(pw);
      } catch (e2) {
        setErr(String(e2.message || e2));
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    const ok = await unlock(pw);
    setBusy(false);
    if (!ok) {
      setErr('Contraseña incorrecta.');
      setPw('');
    }
  }

  async function onImport(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErr('');
    try {
      await importBackup(f);
      setCreating(false);
      setErr('Backup importado. Desbloquéalo con su contraseña.');
    } catch (e2) {
      setErr(String(e2.message || e2));
    }
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-logo" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="56" height="56">
            <rect x="6" y="6" width="36" height="36" rx="9" fill="none" stroke="#3987e5" strokeWidth="3" />
            <circle cx="24" cy="24" r="8.5" fill="none" stroke="#3987e5" strokeWidth="3" />
            <line x1="24" y1="24" x2="24" y2="18" stroke="#3987e5" strokeWidth="3" strokeLinecap="round" />
            <line x1="24" y1="24" x2="29" y2="27" stroke="#3987e5" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <h1>Bóveda</h1>
        <p className="lock-sub">
          {setup
            ? 'Crea tu bóveda. Todo se guarda cifrado en este dispositivo.'
            : 'Introduce tu contraseña para descifrar tus datos.'}
        </p>
        <form onSubmit={submit}>
          <input
            type="password"
            placeholder="Contraseña maestra"
            value={pw}
            autoFocus
            onChange={(e) => setPw(e.target.value)}
            aria-label="Contraseña maestra"
          />
          {setup && (
            <>
              <input
                type="password"
                placeholder="Repite la contraseña"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                aria-label="Repite la contraseña"
              />
              <label className="ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>
                  Entiendo que <strong>sin esta contraseña los datos son irrecuperables</strong>: no hay
                  recuperación posible por diseño.
                </span>
              </label>
            </>
          )}
          {err && <div className="form-err">{err}</div>}
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? 'Descifrando…' : setup ? 'Crear bóveda' : 'Desbloquear'}
          </button>
        </form>
        <div className="lock-actions">
          <button className="btn-link" onClick={() => fileRef.current?.click()}>
            Importar backup cifrado
          </button>
          {stage !== 'setup' && (
            <button className="btn-link" onClick={() => setCreating((c) => !c)}>
              {creating ? 'Volver a desbloquear' : 'Crear otra bóveda'}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
      </div>
    </div>
  );
}
