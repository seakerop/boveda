// Estimación de fuerza de una contraseña maestra. No pretende ser zxcvbn: estima
// la entropía por longitud y variedad de caracteres y penaliza los patrones que
// primero prueba cualquier ataque (repeticiones, secuencias, palabras típicas).

const COMMON = [
  'password', 'contrasena', 'contraseña', 'qwerty', 'abc', '123', 'admin', 'boveda', 'bóveda',
  'dinero', 'iloveyou', 'madrid', 'barcelona', 'españa', 'espana', 'futbol', 'hola', 'secreto',
];

export function pwStrength(pw) {
  if (!pw) return { score: 0, label: '', hint: '' };
  const lower = pw.toLowerCase();
  let pool = 0;
  if (/[a-zñ]/.test(pw)) pool += 27;
  if (/[A-ZÑ]/.test(pw)) pool += 27;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9ñÑ]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(Math.max(pool, 1));
  if (/(.)\1{2,}/.test(pw)) bits -= 10;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf|zxcv)/i.test(pw)) bits -= 12;
  if (COMMON.some((w) => lower.includes(w))) bits -= 18;
  if (/^(19|20)\d{2}$/.test(pw.slice(-4))) bits -= 6;
  // Frases de varias palabras: lo más fácil de recordar y de lo más fuerte.
  const words = pw.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3);
  if (words.length >= 4) bits += 10;

  let score;
  if (pw.length < 8 || bits < 40) score = 1;
  else if (bits < 60) score = 2;
  else if (bits < 80) score = 3;
  else score = 4;
  const label = ['', 'Débil', 'Aceptable', 'Buena', 'Muy fuerte'][score];
  const hint =
    score <= 1
      ? 'Muy fácil de adivinar. Prueba una frase de 4 o más palabras.'
      : score === 2
        ? 'Mejor más larga: una frase de varias palabras es fácil de recordar y muy difícil de romper.'
        : score === 3
          ? 'Bien. Con unas letras más sería excelente.'
          : 'Excelente.';
  return { score, label, hint };
}

export default function PasswordMeter({ password }) {
  const s = pwStrength(password);
  if (!password) return null;
  return (
    <div className={`pw-meter pw-${s.score}`} aria-live="polite">
      <div className="pw-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={i <= s.score ? 'on' : ''} />
        ))}
      </div>
      <div className="pw-text">
        <strong>{s.label}.</strong> {s.hint}
      </div>
    </div>
  );
}
