import { forwardRef, useId, useImperativeHandle, useRef } from 'react';

// La puerta de la caja fuerte de la pantalla de bloqueo. Se maneja desde fuera
// con órdenes (spin, open, deny, intro, close) que cambian clases en el DOM sin
// re-renderizar: las animaciones son CSS y SVG puros (nada que cargar, nada que
// choque con la CSP). Cada orden que tarda devuelve una promesa que se resuelve
// al terminar.

const PREF_KEY = 'boveda:vault-anim';

// Animación activa salvo que el usuario la apague (Ajustes) o el sistema pida
// "reducir movimiento". La preferencia vive en localStorage: no revela nada y
// hace falta antes de desbloquear, cuando los ajustes cifrados aún no se pueden leer.
export function vaultAnimEnabled() {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setVaultAnimPref(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // sin almacenamiento local: se queda con el valor por defecto
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const buzz = (pattern) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // iPhone y escritorio no vibran: sin problema
  }
};

// Ángulo actual (grados) de un elemento con transform de rotación.
function currentAngle(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  const m = t.match(/matrix\(([^)]+)\)/);
  if (!m) return 0;
  const [a, b] = m[1].split(',').map(Number);
  return (Math.atan2(b, a) * 180) / Math.PI;
}

const BOLTS = [0, 45, 90, 135, 180, 225, 270, 315];
const TICKS = Array.from({ length: 12 }, (_, i) => i * 30);

const VaultDoor = forwardRef(function VaultDoor({ size = 104, initial = 'closed' }, ref) {
  const uid = useId().replace(/:/g, '');
  const rootRef = useRef(null);
  const dialRef = useRef(null);

  const root = () => rootRef.current;
  const set = (...cls) => root()?.classList.add(...cls);
  const unset = (...cls) => root()?.classList.remove(...cls);

  // Detiene el giro continuo del dial dejándolo suave en la posición de cero.
  async function settleDial(ms = 320) {
    const dial = dialRef.current;
    if (!dial) return;
    const from = currentAngle(dial);
    unset('is-spinning');
    dial.style.transition = 'none';
    dial.style.transform = `rotate(${from}deg)`;
    void dial.getBoundingClientRect(); // fuerza el repintado con el ángulo de partida
    const to = from >= 0 ? 360 : 0;
    dial.style.transition = `transform ${ms}ms cubic-bezier(.2,.8,.2,1)`;
    dial.style.transform = `rotate(${to}deg)`;
    await wait(ms);
    dial.style.transition = 'none';
    dial.style.transform = '';
  }

  useImperativeHandle(ref, () => ({
    // Giro continuo mientras se descifra (dura lo que tarde la clave).
    spin() {
      unset('is-denied');
      set('is-spinning');
    },
    async stop() {
      await settleDial(260);
    },
    // Apertura completa: el dial se asienta, gira el volante, se retraen los
    // cerrojos ("clac"), la luz pasa a verde y la puerta gira sobre su bisagra.
    async open() {
      await settleDial();
      buzz(12);
      set('is-unlatched');
      await wait(280);
      buzz(28);
      set('is-open');
      await wait(560);
    },
    // Combinación incorrecta: el dial frena en seco y la puerta tiembla.
    async deny() {
      await settleDial(160);
      buzz([30, 40, 30]);
      unset('is-denied');
      void root()?.getBoundingClientRect();
      set('is-denied');
      await wait(480);
      unset('is-denied');
    },
    // Al abrir la app: la puerta aparece y el dial marca una combinación.
    async intro() {
      set('is-intro');
      await wait(1150);
      unset('is-intro');
    },
    // Al volver a bloquear: la puerta (abierta) se cierra y echa los cerrojos.
    async close() {
      set('is-open', 'is-unlatched', 'no-transition');
      void root()?.getBoundingClientRect();
      unset('no-transition');
      unset('is-open');
      await wait(520);
      buzz(20);
      unset('is-unlatched');
      await wait(200);
    },
    // Salta cualquier animación en curso (tocar la pantalla durante la intro).
    skip() {
      unset('is-intro', 'is-spinning', 'is-denied');
    },
    // Centro de la puerta en pantalla (para "entrar" por ella al abrir).
    center() {
      const r = root()?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    },
  }));

  const rim = `rim${uid}`;
  const face = `face${uid}`;
  const glow = `glow${uid}`;
  return (
    <div
      ref={rootRef}
      className={`vault ${initial === 'open' ? 'is-open is-unlatched no-transition' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg className="vault-frame" viewBox="0 0 120 120">
        <defs>
          <radialGradient id={glow} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#8fc0ff" stopOpacity="0.95" />
            <stop offset="0.55" stopColor="#3b6fe0" stopOpacity="0.45" />
            <stop offset="1" stopColor="#3b6fe0" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="3" y="3" width="114" height="114" rx="26" className="vault-frame-box" />
        <circle cx="60" cy="60" r="47" className="vault-hole" />
        <circle cx="60" cy="60" r="47" fill={`url(#${glow})`} className="vault-glow" />
        <rect x="5" y="34" width="7" height="12" rx="2" className="vault-hinge" />
        <rect x="5" y="74" width="7" height="12" rx="2" className="vault-hinge" />
        <circle cx="60" cy="9.5" r="2.6" className="vault-led" />
      </svg>
      <div className="vault-door">
        <svg viewBox="0 0 120 120">
          <defs>
            <linearGradient id={rim} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="120" y2="120">
              <stop offset="0" stopColor="#6aa8f7" />
              <stop offset="1" stopColor="#3b6fe0" />
            </linearGradient>
            <radialGradient id={face} cx="42%" cy="38%" r="70%">
              <stop offset="0" stopColor="#24324a" />
              <stop offset="1" stopColor="#111926" />
            </radialGradient>
          </defs>
          {BOLTS.map((a) => (
            <g key={a} transform={`rotate(${a} 60 60)`}>
              <rect x="98" y="56.5" width="12" height="7" rx="2" className="vault-bolt" />
            </g>
          ))}
          <circle cx="60" cy="60" r="44" fill={`url(#${face})`} stroke={`url(#${rim})`} strokeWidth="3" />
          <circle cx="60" cy="60" r="35" className="vault-ring" />
          <g className="vault-handle">
            {[90, 210, 330].map((a) => {
              const rad = (a * Math.PI) / 180;
              const x = 60 + Math.cos(rad) * 27;
              const y = 60 - Math.sin(rad) * 27;
              return (
                <g key={a}>
                  <line x1="60" y1="60" x2={x} y2={y} />
                  <circle cx={x} cy={y} r="4" />
                </g>
              );
            })}
          </g>
          <g className="vault-dial" ref={dialRef}>
            <circle cx="60" cy="60" r="14" className="vault-dial-face" stroke={`url(#${rim})`} />
            {TICKS.map((a) => (
              <line
                key={a}
                x1="60"
                y1="48.5"
                x2="60"
                y2={a % 90 === 0 ? 51.5 : 50.3}
                transform={`rotate(${a} 60 60)`}
                className="vault-tick"
              />
            ))}
            <line x1="60" y1="60" x2="60" y2="52.5" className="vault-needle" />
            <circle cx="60" cy="60" r="2.4" className="vault-pin" />
          </g>
        </svg>
      </div>
    </div>
  );
});

export default VaultDoor;
