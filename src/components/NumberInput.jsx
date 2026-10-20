// Campo numérico de texto con teclado decimal: acepta "0,05" y "0.05" por igual.
// (type="number" rechaza la coma en según qué navegador y deja el valor vacío.)
export default function NumberInput({ value, onChange, suffix, ...rest }) {
  return (
    <span className={`num-input ${suffix ? 'has-suffix' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,\-\s]/g, ''))}
        {...rest}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </span>
  );
}
