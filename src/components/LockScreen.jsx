import { useEffect, useId, useRef, useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import Icon from './Icon.jsx';
import PasswordMeter, { pwStrength } from './PasswordMeter.jsx';
import VaultDoor, { vaultAnimEnabled } from './VaultDoor.jsx';

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// entry: cómo aparece la pantalla. 'intro' al abrir la app (la puerta aparece y
// marca una combinación), 'closing' al volver a bloquear (la puerta se cierra),
// 'none' en cualquier otro caso.
export default function LockScreen({ entry = 'none' }) {
  const { stage, unlock, unlockWithBio, bioState, createAndOpen, importBackup } = useBoveda();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(stage === 'setup');
  const [bioFails, setBioFails] = useState(0);
  const fileRef = useRef(null);
  const doorRef = useRef(null);
  const screenRef = useRef(null);
  const cardRef = useRef(null);
  const [anim] = useState(vaultAnimEnabled);
  const [intro, setIntro] = useState(anim && entry === 'intro');

  const setup = stage === 'setup' || creating;

  useEffect(() => {
    if (!anim) return;
    let alive = true;
    if (entry === 'intro') {
      doorRef.current?.intro().then(() => alive && setIntro(false));
    } else if (entry === 'closing') {
      doorRef.current?.close();
    }
    return () => {
      alive = false;
    };
  }, [anim, entry]);

  // Tocar la pantalla durante la intro la salta.
  function skipIntro() {
    if (!intro) return;
    doorRef.current?.skip();
    cardRef.current?.classList.add('skip');
    setIntro(false);
  }

  // Se ejecuta con los datos ya descifrados y justo antes de mostrarlos: la
  // puerta se abre y la pantalla "entra" por ella.
  async function openDoor() {
    if (!anim) return;
    await doorRef.current?.open();
    const c = doorRef.current?.center();
    const el = screenRef.current;
    if (el && c) {
      el.style.transformOrigin = `${c.x}px ${c.y}px`;
      el.classList.add('is-leaving');
    }
    await wait(380);
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    skipIntro();
    if (setup) {
      if (pw.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.');
      if (pw !== pw2) return setErr('Las contraseñas no coinciden.');
      if (!ack) return setErr('Debes confirmar que entiendes que es irrecuperable.');
      if (pwStrength(pw).score <= 1 && !window.confirm('Es una contraseña débil, fácil de adivinar. ¿Usarla de todos modos?')) {
        return;
      }
      setBusy(true);
      if (anim) doorRef.current?.spin();
      try {
        await createAndOpen(pw, openDoor);
      } catch (e2) {
        if (anim) await doorRef.current?.stop();
        setErr(String(e2.message || e2));
        setBusy(false);
      }
      return;
    }
    if (!pw) return setErr('Escribe tu contraseña.');
    setBusy(true);
    // El dial gira mientras se deriva la clave: la animación ocupa la espera
    // que ya existe (unas décimas de segundo), no añade una nueva.
    if (anim) doorRef.current?.spin();
    const ok = await unlock(pw, openDoor);
    if (!ok) {
      if (anim) await doorRef.current?.deny();
      setBusy(false);
      setErr('Contraseña incorrecta.');
      setPw('');
    }
  }

  async function withBio() {
    setErr('');
    skipIntro();
    setBusy(true);
    if (anim) doorRef.current?.spin();
    const r = await unlockWithBio(openDoor);
    if (!r.ok) {
      if (anim) {
        if (r.cancelled) await doorRef.current?.stop();
        else await doorRef.current?.deny();
      }
      setBusy(false);
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
    <div className="lock-screen" ref={screenRef} onPointerDown={skipIntro}>
      <div className={`lock-card ${intro ? 'is-intro' : ''}`} ref={cardRef}>
        <div className="lock-logo">
          {anim ? (
            <VaultDoor ref={doorRef} size={104} initial={entry === 'closing' ? 'open' : 'closed'} />
          ) : (
            <BrandMark size={58} />
          )}
        </div>
        <div className="lock-body">
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
            {busy ? (setup ? 'Creando…' : 'Abriendo…') : setup ? 'Crear bóveda' : 'Desbloquear'}
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
      </div>
      <p className="lock-foot">
        <Icon name="lock" size={12} /> Cifrado AES-256 en tu dispositivo · sin cuentas ni servidores
      </p>
    </div>
  );
}
