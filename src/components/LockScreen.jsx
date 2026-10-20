import { useId, useRef, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import Icon from './Icon.jsx';
import PasswordMeter, { pwStrength } from './PasswordMeter.jsx';

// Marca de la app: el dial de la caja fuerte.
export function BrandMark({ size = 28 }) {
  const g = `bm${useId().replace(/:/g, '')}`;
  const stroke = `url(#${g})`;
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="brand-svg">
      <defs>
        {/* userSpaceOnUse: con el degradado relativo a la caja, la aguja vertical
            (caja de ancho cero) no se pintaría. */}
        <linearGradient id={g} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0" stopColor="#6aa8f7" />
          <stop offset="1" stopColor="#3b6fe0" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="38" height="38" rx="11" fill="none" stroke={stroke} strokeWidth="3.4" />
      <circle cx="24" cy="24" r="9" fill="none" stroke={stroke} strokeWidth="3.4" />
      <line x1="24" y1="24" x2="24" y2="17.5" stroke={stroke} strokeWidth="3.4" strokeLinecap="round" />
      <line x1="24" y1="24" x2="29.5" y2="27.2" stroke={stroke} strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

export default function LockScreen() {
  const { stage, unlock, unlockWithBio, bioState, createAndOpen, importBackup } = useBoveda();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(stage === 'setup');
  const [bioFails, setBioFails] = useState(0);
  const fileRef = useRef(null);

  const setup = stage === 'setup' || creating;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (setup) {
      if (pw.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.');
      if (pw !== pw2) return setErr('Las contraseñas no coinciden.');
      if (!ack) return setErr('Debes confirmar que entiendes que es irrecuperable.');
      if (pwStrength(pw).score <= 1 && !window.confirm('Es una contraseña débil, fácil de adivinar. ¿Usarla de todos modos?')) {
        return;
      }
      setBusy(true);
      try {
        await createAndOpen(pw);
      } catch (e2) {
        setErr(String(e2.message || e2));
        setBusy(false);
      }
      return;
    }
    if (!pw) return setErr('Escribe tu contraseña.');
    setBusy(true);
    const ok = await unlock(pw);
    setBusy(false);
    if (!ok) {
      setErr('Contraseña incorrecta.');
      setPw('');
    }
  }

  async function withBio() {
    setErr('');
    setBusy(true);
    const r = await unlockWithBio();
    setBusy(false);
    if (!r.ok) {
      // Un "cancelado" también cuenta: WebAuthn no distingue entre cancelar y
      // una credencial borrada del sistema, y eso falla en silencio en bucle.
      setBioFails((c) => c + 1);
      if (!r.cancelled && r.error) setErr(r.error);
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
      setErr('✓ Backup importado. Desbloquéalo con su contraseña.');
    } catch (e2) {
      setErr(String(e2.message || e2));
    }
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-logo">
          <BrandMark size={58} />
        </div>
        <h1>Bóveda</h1>
        <p className="lock-sub">
          {setup ? 'Crea tu bóveda. Todo se guarda cifrado en este dispositivo.' : 'Introduce tu contraseña para descifrar tus datos.'}
        </p>
        <form onSubmit={submit}>
          <input
            type="password"
            placeholder="Contraseña maestra"
            value={pw}
            autoFocus
            onChange={(e) => setPw(e.target.value)}
            aria-label="Contraseña maestra"
            autoComplete={setup ? 'new-password' : 'current-password'}
          />
          {setup && (
            <>
              <PasswordMeter password={pw} />
              <input
                type="password"
                placeholder="Repite la contraseña"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                aria-label="Repite la contraseña"
                autoComplete="new-password"
              />
              <label className="ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>
                  Entiendo que <strong>sin esta contraseña los datos son irrecuperables</strong>: no hay recuperación
                  posible por diseño.
                </span>
              </label>
            </>
          )}
          {err && <div className={err.startsWith('✓') ? 'form-ok' : 'form-err'}>{err}</div>}
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? (setup ? 'Creando…' : 'Descifrando…') : setup ? 'Crear bóveda' : 'Desbloquear'}
          </button>
        </form>
        {!setup && bioState.ready && (
          <button className="btn btn-bio" disabled={busy} onClick={withBio}>
            <Icon name="fingerprint" size={20} /> Entrar con huella
          </button>
        )}
        {!setup && bioState.ready && bioFails >= 2 && (
          <p className="bio-note">
            ¿No responde? Entra con tu contraseña. Si la huella sigue sin funcionar, puede que la passkey se borrara del
            sistema: desactívala y actívala de nuevo en Ajustes.
          </p>
        )}
        {!setup && bioState.expired && (
          <p className="bio-note">
            Han pasado 14 días: hoy toca escribir la contraseña, de recordatorio para que no se te olvide. Después la huella
            vuelve a estar disponible.
          </p>
        )}
        <div className="lock-actions">
          <button className="btn-text" onClick={() => fileRef.current?.click()}>
            Importar backup
          </button>
          {stage !== 'setup' && (
            <button
              className="btn-text"
              onClick={() => {
                setCreating((c) => !c);
                setErr('');
              }}
            >
              {creating ? 'Volver a desbloquear' : 'Crear otra bóveda'}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
      </div>
      <p className="lock-foot">
        <Icon name="lock" size={12} /> Cifrado AES-256 en tu dispositivo · sin cuentas ni servidores
      </p>
    </div>
  );
}
