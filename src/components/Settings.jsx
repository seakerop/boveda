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
      <div className="card-title">Desbloqueo con huella</div>
      {!bioState.avail ? (
        <p className="muted">Este dispositivo o navegador no soporta huella o Face ID para webs.</p>
      ) : bioOn ? (
        <>
          <p className="muted">
            Activado en este dispositivo. Tu contraseña sigue funcionando siempre, y cada 14 días
            se pide igualmente, de recordatorio para que no se te olvide. Recuerda: cualquier
            método de desbloqueo del dispositivo (huella, cara o su PIN) abre la bóveda.
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
            Desbloquea sin teclear la contraseña usando la verificación de tu dispositivo. Ojo:
            vale cualquier método del sistema — huella, cara o el PIN del equipo —, así que con
            esto activo la bóveda es tan fuerte como tu bloqueo de pantalla. No se guarda nada
            biométrico, se activa por dispositivo y bóveda, y la contraseña sigue funcionando
            siempre (cada 14 días se pide igualmente, para que no se olvide). Al activar, el
            sistema te pedirá la verificación dos veces seguidas: es normal.
          </p>
          <p className="muted">
            Si usas la cartera señuelo en serio, piénsatelo: la huella crea una passkey visible en
            el sistema y deja marcada qué bóveda la tiene.
          </p>
          <input
            type="password"
            placeholder="Tu contraseña maestra"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            aria-label="Contraseña maestra para activar la huella"
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

      <BioCard />

      <section className="card">
        <div className="card-title">Cambiar contraseña maestra</div>
        <p className="muted">
          Re-cifra toda la bóveda con la nueva contraseña. Si tenías la huella activada, se
          desactiva y tendrás que volver a activarla.
        </p>
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
