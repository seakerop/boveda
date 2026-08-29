// Desbloqueo con huella: WebAuthn + extensión PRF. El autenticador del propio
// dispositivo guarda un secreto en su chip seguro y, tras verificar al usuario,
// deriva de él una salida pseudoaleatoria (PRF) con la que envolvemos (AES-GCM)
// los bits de la clave de la bóveda. No se guarda nada biométrico: solo el id
// de la credencial, la sal del PRF y la clave envuelta — inservibles sin el
// hardware y sin la verificación. Dos verdades incómodas, asumidas de diseño:
// (1) "verificación" es CUALQUIER gesto de desbloqueo del sistema (PIN del
// equipo incluido), así que con la huella activa la bóveda es tan fuerte como
// el bloqueo de pantalla; (2) la ventana PW_EVERY_MS es un recordatorio para
// que la contraseña no se olvide, no una frontera criptográfica — vive en un
// campo en claro y nada impide a quien controle el dispositivo saltársela.

import { b64, unb64 } from './vaultCrypto.js';

const enc = new TextEncoder();

export const PW_EVERY_MS = 14 * 24 * 3600 * 1000; // 14 días

// Un pwAt en el futuro (reloj mal puesto) no cuenta como vigente.
export const pwFresh = (bio) => {
  if (!bio) return false;
  const dt = Date.now() - (bio.pwAt || 0);
  return dt >= 0 && dt < PW_EVERY_MS;
};

// Errores de WebAuthn en cristiano; el nombre técnico va entre paréntesis.
export function bioErrMsg(e) {
  const n = e?.name || '';
  if (n === 'NotSupportedError') return 'Tu navegador no soporta esta parte del desbloqueo con huella.';
  if (n === 'SecurityError') return 'El navegador ha bloqueado la operación de huella.';
  if (n === 'OperationError') return 'No se pudo descifrar con la huella. Entra con tu contraseña.';
  return `No se pudo completar la operación de huella${n ? ` (${n})` : ''}.`;
}

const b64url = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function bioSupported() {
  try {
    return (
      !!window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

// La salida PRF no se usa directamente como clave: pasa por HKDF-SHA256.
async function wrapKeyFromPrf(prfOut) {
  const material = await crypto.subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('boveda-bio-wrap-v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Alta: crea la credencial de plataforma, comprueba que soporta PRF, obtiene la
// salida PRF con una segunda verificación (muchas plataformas solo la devuelven
// en get()) y envuelve los bits de la clave de la bóveda.
export async function enrollBio(keyBits) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Bóveda' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'Bóveda',
        displayName: 'Bóveda',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      extensions: { prf: {} },
    },
  });
  if (!cred.getClientExtensionResults().prf?.enabled) {
    // La API obliga a crear la credencial antes de saber si hay PRF: si no lo
    // hay, queda una passkey huérfana en el sistema que la web no puede borrar.
    throw new Error(
      'Este dispositivo no soporta el desbloqueo con huella (le falta la extensión PRF). ' +
        'Puede haberse creado una passkey "Bóveda" en el sistema: es inofensiva y puedes borrarla desde los ajustes del dispositivo.'
    );
  }
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: cred.rawId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const prfOut = assertion.getClientExtensionResults().prf?.results?.first;
  if (!prfOut) throw new Error('El dispositivo no devolvió la clave de la huella. Prueba de nuevo.');
  const wrapKey = await wrapKeyFromPrf(prfOut);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, keyBits);
  // pwAt lo pone el store: solo un desbloqueo real por contraseña re-arma la ventana.
  return {
    credId: b64(new Uint8Array(cred.rawId)),
    prfSalt: b64(prfSalt),
    iv: b64(iv),
    data: b64(wrapped),
  };
}

// Desbloqueo: una sola verificación contra cualquiera de las credenciales
// dadas de alta; el autenticador decide cuál se usa y con su salida PRF
// desenvolvemos los bits de la clave de esa bóveda.
export async function bioUnlock(records) {
  const evalByCredential = {};
  const allowCredentials = records.map((r) => {
    const id = unb64(r.bio.credId);
    evalByCredential[b64url(id)] = { first: unb64(r.bio.prfSalt) };
    return { type: 'public-key', id };
  });
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials,
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { evalByCredential } },
    },
  });
  const usedId = b64(new Uint8Array(assertion.rawId));
  const record = records.find((r) => r.bio.credId === usedId);
  const prfOut = assertion.getClientExtensionResults().prf?.results?.first;
  if (!record || !prfOut) throw new Error('No se pudo verificar la huella. Usa tu contraseña.');
  const wrapKey = await wrapKeyFromPrf(prfOut);
  const keyBits = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(record.bio.iv) },
    wrapKey,
    unb64(record.bio.data)
  );
  return { record, keyBits };
}
