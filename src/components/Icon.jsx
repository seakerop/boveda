// Iconos de trazo (24×24, currentColor). Dibujados a mano para no depender de
// ninguna librería ni CDN: la CSP solo deja cargar recursos del propio dominio.
const P = {
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4" />
      <path d="M6.3 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.3" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </>
  ),
  percent: (
    <>
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12" />
      <path d="M9 7V4.5h6V7" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  back: (
    <>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  fingerprint: (
    <>
      <path d="M12 11v3.5a8 8 0 0 1-1.5 4.7" />
      <path d="M8.5 9.8A3.5 3.5 0 0 1 15.5 11v2.5c0 1.6-.3 3.2-.9 4.7" />
      <path d="M5.5 15.5c.3-1.1.5-2.3.5-3.5a6 6 0 0 1 10.5-4" />
      <path d="M18.4 10.5c.1.5.1 1 .1 1.5v1.3c0 1.6-.2 3.1-.6 4.6" />
      <path d="M4.2 8.2A9 9 0 0 1 19.5 6" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V3.5" />
      <path d="m7.5 8 4.5-4.5L16.5 8" />
      <path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" />
    </>
  ),
  report: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.5h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  coins: (
    <>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M17.5 10.7a5.5 5.5 0 1 1-6.8 6.8" />
      <path d="M8 7.5h1.5v4" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="m5 15 4.5-4.5 3.5 3.5L19.5 7" />
      <path d="M15 7h4.5v4.5" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  wallet: (
    <>
      <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4H6a2.5 2.5 0 0 0 0 5h13a1.5 1.5 0 0 1 1.5 1.5V18a2 2 0 0 1-2 2H6a2.5 2.5 0 0 1-2.5-2.5v-11" />
      <path d="M16.5 14.5h.01" />
    </>
  ),
  bank: (
    <>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7" />
      <path d="M3 20.5h18" />
    </>
  ),
  income: (
    <>
      <path d="M12 3v18" />
      <path d="M16.5 7.5c-.6-1.4-2.4-2.5-4.5-2.5-2.5 0-4.5 1.4-4.5 3.4s2 2.9 4.5 3.4 4.5 1.4 4.5 3.4-2 3.4-4.5 3.4c-2.2 0-4-1.1-4.6-2.6" />
    </>
  ),
};

export default function Icon({ name, size = 20, className = '', strokeWidth = 1.8, title }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {P[name]}
    </svg>
  );
}

// Avatar de activo: iniciales sobre el color de su segmento.
export function AssetAvatar({ asset, color, size = 36 }) {
  const clean = (s) => s.replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/g, '');
  let label;
  if (asset.type === 'crypto' || asset.type === 'stock') {
    // Ticker sin el sufijo de mercado (TEF.MC → TEF); hasta 4 letras.
    label = clean((asset.symbol || asset.name || '?').split('.')[0]).slice(0, 4);
  } else {
    // Nombres propios ("Piso Jesuitas", "Cuenta ING"): iniciales.
    const words = (asset.name || '?').split(/\s+/).map(clean).filter(Boolean);
    label = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
  }
  label = label.toUpperCase();
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        '--seg': color,
        fontSize: size * (label.length >= 4 ? 0.25 : label.length === 3 ? 0.29 : 0.36),
      }}
      aria-hidden="true"
    >
      {label || '?'}
    </span>
  );
}
