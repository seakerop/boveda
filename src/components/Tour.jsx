import { useRef, useState } from 'react';
import useModal from './useModal.js';
import Icon from './Icon.jsx';
import VaultDoor from './VaultDoor.jsx';

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

export default function Tour({ onDone, onAddFirst }) {
  const [i, setI] = useState(0);
  const touch = useRef(null);
  useModal(onDone);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const go = (k) => setI((v) => Math.min(STEPS.length - 1, Math.max(0, v + k)));

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
        <div className="tour-step" key={i} aria-live="polite">
          <div className="tour-art">
            {step.art === 'vault' ? (
              <VaultDoor size={92} initial="open" />
            ) : (
              <span className="tour-icon">
                <Icon name={step.icon} size={30} />
              </span>
            )}
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
            <button key={k} tabIndex={-1} className={k === i ? 'on' : ''} onClick={() => setI(k)} />
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
            <button className="btn btn-primary" autoFocus onClick={onAddFirst || onDone}>
              {onAddFirst ? 'Añadir lo primero' : 'Empezar'}
            </button>
          ) : (
            <button className="btn btn-primary" autoFocus onClick={() => go(1)}>
              Siguiente
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
