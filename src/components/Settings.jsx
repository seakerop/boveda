import { useState } from 'react';
import { useBoveda } from '../lib/store.jsx';
import { SEGMENTS } from '../lib/portfolio.js';
import { fmtAgo, fmtDate } from '../lib/dates.js';
import { numToInput, parseNum } from '../lib/format.js';
import Icon from './Icon.jsx';
import NumberInput from './NumberInput.jsx';
import PasswordMeter, { pwStrength } from './PasswordMeter.jsx';
import { setVaultAnimPref, vaultAnimEnabled } from './VaultDoor.jsx';

function PwForm({ label, onSubmit, danger, okMsg = '✓ Hecho' }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setMsg('');
    if (pw.length < 8) return setMsg('Mínimo 8 caracteres.');
    if (pw !== pw2) return setMsg('No coinciden.');
    if (pwStrength(pw).score <= 1 && !window.confirm('Es una contraseña débil, fácil de adivinar. ¿Usarla de todos modos?')) {
      return;
    }
    setBusy(true);
    try {
      await onSubmit(pw);
      setMsg(okMsg);
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
      <input type="password" placeholder="Nueva contraseña" aria-label="Nueva contraseña" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      <PasswordMeter password={pw} />
      <input type="password" placeholder="Repítela" aria-label="Repite la contraseña" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      {msg && <div className={msg.startsWith('✓') ? 'form-ok' : 'form-err'}>{msg}</div>}
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={go}>
        {busy ? 'Cifrando…' : label}
      </button>
    </div>
  );
}

function BioCard() {
  const { bioState, bioOn, enableBio, disableBio } = useBoveda();
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn, okMsg, cancelMsg) {
    setMsg('');
    setBusy(true);
    try {
      await fn();
      setMsg(okMsg);
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
        if (cancelMsg) setMsg(cancelMsg);
      } else {
        setMsg(String(e.message || e));
      }
    } finally {
      setBusy(false);
    }
  }

  function activate() {
    if (pw.length < 8) return setMsg('Escribe tu contraseña maestra para activarla.');
    run(
      async () => {
        await enableBio(pw);
        setPw('');
      },
      '✓ Huella activada en este dispositivo',
      'Cancelado: la huella NO ha quedado activada. Si el sistema llegó a crear una passkey "Bóveda", puedes borrarla en sus ajustes.'
    );
  }

  return (
    <section className="card">
      <div className="card-title">
        <Icon name="fingerprint" size={16} /> Desbloqueo con huella
      </div>
      {!bioState.avail ? (
        <p className="muted">Este dispositivo o navegador no soporta huella o Face ID para webs.</p>
      ) : bioOn ? (
        <>
          <p className="muted">
            Activado en este dispositivo. Tu contraseña sigue funcionando siempre, y cada 14 días se pide igualmente, de
            recordatorio para que no se te olvide. Recuerda: cualquier método de desbloqueo del dispositivo (huella, cara o
            su PIN) abre la bóveda.
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(
                disableBio,
                '✓ Desactivado. La entrada "Bóveda" puede seguir saliendo en los ajustes de tu sistema: es inofensiva y puedes borrarla desde ahí.'
              )
            }
          >
            Desactivar en este dispositivo
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            Desbloquea sin teclear la contraseña usando la verificación de tu dispositivo. Ojo: vale cualquier método del
            sistema — huella, cara o el PIN del equipo —, así que con esto activo la bóveda es tan fuerte como tu bloqueo de
            pantalla. No se guarda nada biométrico, se activa por dispositivo y bóveda, y la contraseña sigue funcionando
            siempre (cada 14 días se pide igualmente, para que no se olvide). Al activar, el sistema te pedirá la
            verificación dos veces seguidas: es normal.
          </p>
          <p className="muted">
            Si usas la cartera señuelo en serio, piénsatelo: la huella crea una passkey visible en el sistema y deja marcada
            qué bóveda la tiene.
          </p>
          <input
            type="password"
            placeholder="Tu contraseña maestra"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            aria-label="Contraseña maestra para activar la huella"
            autoComplete="current-password"
          />
          <button className="btn btn-primary" disabled={busy} onClick={activate}>
            {busy ? 'Esperando al sensor…' : 'Activar en este dispositivo'}
          </button>
        </>
      )}
      {msg && <div className={msg.startsWith('✓') ? 'form-ok' : 'form-err'}>{msg}</div>}
    </section>
  );
}

function TargetsCard() {
  const { data, mutate, notify } = useBoveda();
  const current = data.settings.targets || null;
  const [vals, setVals] = useState(() =>
    Object.fromEntries(SEGMENTS.map((s) => [s.key, current ? numToInput(current[s.key] || 0) : '']))
  );
  const [err, setErr] = useState('');
  const nums = Object.fromEntries(SEGMENTS.map((s) => [s.key, vals[s.key] === '' ? 0 : parseNum(vals[s.key])]));
  const sum = Object.values(nums).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  function save() {
    setErr('');
    if (Object.values(nums).some((v) => !Number.isFinite(v) || v < 0 || v > 100)) return setErr('Cada objetivo va de 0 a 100.');
    if (Math.abs(sum - 100) > 0.5) return setErr(`Tienen que sumar 100 % (ahora suman ${numToInput(Math.round(sum * 10) / 10)} %).`);
    mutate((d) => {
      d.settings.targets = nums;
      return d;
    });
    notify('Reparto objetivo guardado', { kind: 'ok' });
  }
  function clear() {
    mutate((d) => {
      delete d.settings.targets;
      return d;
    });
    setVals(Object.fromEntries(SEGMENTS.map((s) => [s.key, ''])));
    notify('Reparto objetivo quitado');
  }

  return (
    <section className="card">
      <div className="card-title">
        <Icon name="target" size={16} /> Reparto objetivo
      </div>
      <p className="muted">
        Cuánto quieres tener en cada tipo de activo. En Distribución verás cuánto te desvías de cada objetivo, para saber
        dónde poner el próximo euro.
      </p>
      <div className="targets-grid">
        {SEGMENTS.map((s) => (
          <label key={s.key} className="target-field">
            <span>
              <span className="dot" style={{ background: s.color }} /> {s.label}
            </span>
            <NumberInput
              value={vals[s.key]}
              onChange={(v) => setVals((o) => ({ ...o, [s.key]: v }))}
              placeholder="0"
              suffix="%"
              aria-label={`Objetivo ${s.label}`}
            />
          </label>
        ))}
      </div>
      <div className={`targets-sum ${Math.abs(sum - 100) <= 0.5 ? 'up' : ''}`}>
        Suma: {numToInput(Math.round(sum * 10) / 10)} %
      </div>
      {err && <div className="form-err">{err}</div>}
      <div className="btn-row">
        <button className="btn btn-primary" onClick={save}>
          Guardar objetivo
        </button>
        {current && (
          <button className="btn" onClick={clear}>
            Quitar
          </button>
        )}
      </div>
    </section>
  );
}

export default function Settings({ onBack, onOpenTax, onOpenTour }) {
  const { data, mutate, changePassword, createDecoy, exportBackup, wipeVault, lock, notify } = useBoveda();
  const [confirmWipe, setConfirmWipe] = useState('');
  const reducedMotion = (() => {
    try {
      return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  })();
  const [vaultAnim, setVaultAnim] = useState(() => vaultAnimEnabled());
  const [lockDraft, setLockDraft] = useState(String(data.settings.autoLockMin));

  async function doWipe() {
    try {
      await wipeVault();
    } catch (e) {
      notify(String(e.message || e), { kind: 'error' });
    }
  }
  const [busyBackup, setBusyBackup] = useState(false);
  const s = data.settings;

  async function doBackup() {
    setBusyBackup(true);
    try {
      const r = await exportBackup();
      if (r.ok) notify(r.shared ? 'Backup compartido' : 'Backup descargado', { kind: 'ok' });
    } catch (e) {
      notify(String(e.message || e), { kind: 'error' });
    } finally {
      setBusyBackup(false);
    }
  }

  return (
    <div className="detail settings">
      <div className="detail-head">
        <button className="btn-icon" aria-label="Volver" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div className="detail-titles">
          <div className="detail-title">Ajustes</div>
        </div>
      </div>

      <section className="card">
        <div className="card-title">
          <Icon name="shield" size={16} /> Backup
        </div>
        <p className="muted">
          Tus datos solo existen en este dispositivo. El backup sale <strong>cifrado</strong> con tu contraseña: guárdalo
          donde quieras (Drive, correo, un USB). Se recupera desde la pantalla de bloqueo. Lleva todas tus
          operaciones; los precios se vuelven a descargar al restaurarlo (de alguna cripto pequeña solo hay
          histórico del último año).
        </p>
        <div className="backup-status">
          {s.lastBackupAt ? (
            <>
              Último backup: <strong>{fmtDate(s.lastBackupAt)}</strong> ({fmtAgo(s.lastBackupAt)})
            </>
          ) : (
            <span className="down">Todavía no has hecho ningún backup.</span>
          )}
        </div>
        <button className="btn btn-primary" onClick={doBackup} disabled={busyBackup}>
          <Icon name="share" size={18} /> {busyBackup ? 'Preparando…' : 'Hacer backup ahora'}
        </button>
      </section>

      <section className="card">
        <div className="card-title">
          <Icon name="lock" size={16} /> Bloqueo
        </div>
        <label className="setting-row">
          <span>Bloqueo automático tras (minutos sin usarla, 0 = nunca)</span>
          <input
            type="number"
            min="0"
            max="120"
            inputMode="numeric"
            value={lockDraft}
            onChange={(e) => {
              // Solo se guarda un número válido: vaciar el campo para reescribirlo
              // no debe dejar la app en "no bloquear nunca".
              setLockDraft(e.target.value);
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v >= 0 && v <= 120) {
                mutate((d) => {
                  d.settings.autoLockMin = v;
                  return d;
                });
              }
            }}
            onBlur={() => setLockDraft(String(s.autoLockMin))}
          />
        </label>
        <label className="setting-row">
          <span>Bloquear al pasar a segundo plano</span>
          <input
            type="checkbox"
            className="switch"
            checked={s.lockOnHide}
            onChange={(e) =>
              mutate((d) => {
                d.settings.lockOnHide = e.target.checked;
                return d;
              })
            }
          />
        </label>
        <label className="setting-row">
          <span>
            Animación de la caja fuerte al abrir
            {reducedMotion && <small className="setting-hint">Desactivada porque tu sistema pide reducir movimiento.</small>}
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={vaultAnim}
            disabled={reducedMotion}
            onChange={(e) => {
              setVaultAnimPref(e.target.checked);
              setVaultAnim(e.target.checked);
            }}
          />
        </label>
        <button className="btn" onClick={lock}>
          Bloquear ahora
        </button>
      </section>

      <BioCard />

      <TargetsCard />

      <section className="card">
        <button className="link-tile flat" onClick={onOpenTax}>
          <Icon name="report" size={18} />
          <span>
            <strong>Informe para la renta</strong>
            <small>Ganancias por FIFO, dividendos y alquileres de cada año</small>
          </span>
          <Icon name="chevron" size={16} className="link-chev" />
        </button>
      </section>

      <section className="card">
        <button className="link-tile flat" onClick={onOpenTour}>
          <Icon name="info" size={18} />
          <span>
            <strong>Cómo funciona la app</strong>
            <small>Vuelve a ver el tutorial del principio</small>
          </span>
          <Icon name="chevron" size={16} className="link-chev" />
        </button>
      </section>

      <section className="card">
        <div className="card-title">Cambiar contraseña maestra</div>
        <p className="muted">
          Vuelve a cifrar toda la bóveda con la nueva contraseña. Si tenías la huella activada, se desactiva y tendrás que volver a
          activarla. Los backups anteriores siguen abriéndose con la contraseña antigua.
        </p>
        <PwForm label="Cambiar contraseña" onSubmit={changePassword} okMsg="✓ Contraseña cambiada" />
      </section>

      <section className="card">
        <div className="card-title">Cartera señuelo</div>
        <p className="muted">
          Crea una segunda bóveda con su propia contraseña. Si alguien te obliga a abrir la app, desbloquea con esa
          contraseña y verá una cartera independiente (rellénala con datos modestos). Usa una contraseña distinta de la real.
        </p>
        <PwForm label="Crear señuelo" onSubmit={createDecoy} okMsg="✓ Señuelo creado: bloquea y entra con su contraseña para rellenarlo" />
      </section>

      <section className="card danger-zone">
        <div className="card-title">Zona de peligro</div>
        <p className="muted">Borra esta bóveda de este dispositivo. Sin un backup, es irreversible.</p>
        <input placeholder='Escribe "BORRAR" para confirmar' aria-label='Escribe BORRAR para confirmar' value={confirmWipe} onChange={(e) => setConfirmWipe(e.target.value)} />
        <button className="btn btn-danger" disabled={confirmWipe !== 'BORRAR'} onClick={doWipe}>
          Borrar bóveda definitivamente
        </button>
      </section>
    </div>
  );
}
