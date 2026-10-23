import { useEffect, useRef, useState } from 'react';
import useModal from './useModal.js';
import Icon from './Icon.jsx';
import VaultDoor, { vaultAnimEnabled } from './VaultDoor.jsx';

// Tutorial de la primera vez que se entra en una bóveda. Se puede saltar en
// cualquier momento y volver a ver desde Ajustes.
const STEPS = [
  {
    art: 'vault',
    title: 'Esta es tu bóveda',
    text: (
      <>
        Aquí reúnes todo lo que tienes y lo que debes: criptomonedas, acciones y fondos, pisos, cuentas y préstamos. Se
        guarda cifrado en este móvil, sin cuentas ni servidores, así que nadie más puede verlo.
      </>
    ),
    tip: 'Te enseño lo básico en un minuto. Puedes saltarlo cuando quieras.',
  },
  {
    icon: 'plus',
    title: 'Añade lo que tienes',
    text: (
      <>
        Con el botón <strong>+</strong> de abajo a la derecha. En cripto y bolsa buscas por nombre (Bitcoin, Apple, un
        ETF…) y los precios se actualizan solos. Un piso se apunta con lo que pagaste y, de vez en cuando, una
        valoración. El dinero del banco va como cuenta.
      </>
    ),
    where: 'Botón + del panel',
  },
  {
    icon: 'coins',
    title: 'Apunta cada operación',
    text: (
      <>
        Entra en un activo y pulsa <strong>Añadir operación</strong>: compras, ventas, dividendos o alquileres. Con eso
        la app calcula sola tu precio medio y lo que ganas. Al vender eliges a qué cuenta va el dinero, para que siga
        contando en tu patrimonio.
      </>
    ),
    tip: 'Si una empresa divide sus acciones en varias (un desdoblamiento), la app te avisa y lo apuntas con un toque.',
  },
  {
    icon: 'bank',
    title: 'Tus préstamos también cuentan',
    text: (
      <>
        Añade la hipoteca o cualquier préstamo desde el mismo botón +. Se resta de tu patrimonio mes a mes, te avisa antes
        de cada revisión del euríbor y tiene un simulador para ver cuánto ahorras si amortizas antes.
      </>
    ),
    where: 'Botón + → Préstamo',
  },
  {
    icon: 'chart',
    title: 'Cómo leer el panel',
    text: (
      <>
        Arriba está tu <strong>patrimonio neto</strong>: lo que tienes menos lo que debes. La{' '}
        <strong>rentabilidad anual</strong> tiene en cuenta cuándo metiste cada euro, así que se puede comparar con lo que
        da un depósito. En la gráfica, la línea discontinua es el dinero que has puesto tú: la distancia hasta las velas es
        lo que has ganado.
      </>
    ),
  },
  {
    icon: 'report',
    title: 'La renta, más fácil',
    text: (
      <>
        En <strong>Informe para la renta</strong> tienes, año a año, lo que ganaste o perdiste al vender, calculado como lo
        hace Hacienda, y los dividendos con su retención. Se puede exportar para tenerlo a mano al hacer la declaración.
      </>
    ),
    tip: 'Es una ayuda para no hacer cuentas a mano: revisa las cifras antes de presentarla.',
    where: 'Al final del panel',
  },
  {
    icon: 'eye',
    title: 'Privacidad y copias',
    text: (
      <>
        El botón del <strong>ojo</strong> oculta las cifras o deja solo porcentajes, por si alguien mira la pantalla. En
        Ajustes puedes activar la huella y el bloqueo automático.
      </>
    ),
    tip: 'Lo más importante: la contraseña no se puede recuperar. Haz un backup de vez en cuando; la app te lo recuerda cada mes.',
    where: 'Barra de arriba y Ajustes',
  },
];

// Destello de cuatro puntas que parpadea alrededor del símbolo.
function Sparkle({ className }) {
  return (
    <svg className={`tour-spark ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0C12.9 7.2 16.8 11.1 24 12 16.8 12.9 12.9 16.8 12 24 11.1 16.8 7.2 12.9 0 12 7.2 11.1 11.1 7.2 12 0Z" />
    </svg>
  );
}

// La puerta del primer paso: aparece cerrada, gira el dial y se abre.
function OpeningDoor() {
  const door = useRef(null);
  const [anim] = useState(vaultAnimEnabled);
  useEffect(() => {
    if (!anim) return;
    let alive = true;
    const t = setTimeout(async () => {
      if (!alive) return;
      door.current?.spin();
      await new Promise((r) => setTimeout(r, 700));
      if (alive) door.current?.open();
    }, 650);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [anim]);
  return <VaultDoor ref={door} size={96} initial={anim ? 'closed' : 'open'} />;
}

export default function Tour({ onDone, onAddFirst }) {
  const [i, setI] = useState(0);
  // Hacia dónde fue el último cambio de paso: el contenido entra desde ese lado.
  const [dir, setDir] = useState(1);
  const touch = useRef(null);
  useModal(onDone);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const jump = (k) => {
    if (k === i || k < 0 || k >= STEPS.length) return;
    setDir(k > i ? 1 : -1);
    setI(k);
  };
  const go = (k) => jump(i + k);

  // Deslizar el dedo pasa de paso, como en cualquier carrusel del móvil.
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(t.clientY - s.y) * 1.5) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="modal-back tour-back">
      <div
        className="modal tour"
        role="dialog"
        aria-modal="true"
        aria-label="Cómo funciona Bóveda"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="tour-top">
          <span className="tour-count">
            {i + 1} de {STEPS.length}
          </span>
          {!last && (
            <button className="btn-text muted-btn" onClick={onDone}>
              Saltar tutorial
            </button>
          )}
        </div>
        <div className={`tour-step ${dir > 0 ? 'from-right' : 'from-left'}`} key={i} aria-live="polite">
          <div className={`tour-art ${last ? 'is-last' : ''}`}>
            <span className="tour-glow" />
            <span className="tour-halo" />
            {step.art === 'vault' ? (
              <span className="tour-pop">
                <OpeningDoor />
              </span>
            ) : (
              <span className="tour-icon tour-pop">
                <Icon name={step.icon} size={32} />
              </span>
            )}
            <Sparkle className="s1" />
            <Sparkle className="s2" />
            <Sparkle className="s3" />
            {last && <Sparkle className="s4" />}
          </div>
          <h2>{step.title}</h2>
          <p className="tour-text">{step.text}</p>
          {step.tip && <p className="tour-tip">{step.tip}</p>}
          {step.where && (
            <span className="tour-where">
              <Icon name="info" size={13} /> {step.where}
            </span>
          )}
        </div>
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((_, k) => (
            <button key={k} tabIndex={-1} className={k === i ? 'on' : k < i ? 'done' : ''} onClick={() => jump(k)} />
          ))}
        </div>
        <div className="tour-nav">
          {i > 0 ? (
            <button className="btn" onClick={() => go(-1)}>
              Atrás
            </button>
          ) : (
            <span />
          )}
          {last ? (
            <button className="btn btn-primary tour-next tour-finish" autoFocus onClick={onAddFirst || onDone}>
              {onAddFirst ? 'Añadir lo primero' : 'Empezar'}
            </button>
          ) : (
            <button className="btn btn-primary tour-next" autoFocus onClick={() => go(1)}>
              Siguiente <Icon name="chevron" size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
