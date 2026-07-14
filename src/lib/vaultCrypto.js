// Cifrado de la bóveda: AES-256-GCM con clave derivada por PBKDF2 (600k iteraciones).
// La contraseña y la clave derivada nunca se persisten; un fallo de descifrado
// (AES-GCM autentica) equivale a contraseña incorrecta.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITER = 600000;

export function b64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function unb64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function newSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveKey(password, salt, iterations = PBKDF2_ITER) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(ct) };
}

export async function decryptJson(key, ivB64, dataB64) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(dataB64));
  return JSON.parse(dec.decode(pt));
}
