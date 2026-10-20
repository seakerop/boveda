// IndexedDB: solo guarda registros ya cifrados. Nada legible sale del módulo de cifrado.
//   vaults  {id, salt, iter, iv, data, bio?}  la bóveda (tus datos)
//   market  {id, iv, data}                    caché de precios de esa bóveda, cifrada
//                                             con la misma clave pero en registro
//                                             aparte: editar una operación no
//                                             re-cifra miles de precios diarios.

const DB_NAME = 'boveda';
const VAULTS = 'vaults';
const MARKET = 'market';

// Relleno indistinguible de un registro cifrado (AES-GCM no se distingue de
// bytes aleatorios). Al descifrarlo falla, y la app lo trata como caché vacía.
function fillerRecord(id) {
  const rnd = (n) => {
    const u = new Uint8Array(n);
    for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536)));
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return { id, iv: rnd(12), data: rnd(2048 + Math.floor(Math.random() * 30000)) };
}

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VAULTS)) db.createObjectStore(VAULTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MARKET)) {
        const market = db.createObjectStore(MARKET, { keyPath: 'id' });
        // Al estrenar el almacén, cada bóveda existente recibe un registro de
        // relleno: así no se distingue cuál se usa (señuelo incluido) por tener
        // o no caché de mercado.
        if (ev.oldVersion >= 1) {
          const keysReq = req.transaction.objectStore(VAULTS).getAllKeys();
          keysReq.onsuccess = () => {
            for (const id of keysReq.result) market.put(fillerRecord(id));
          };
        }
      }
    };
    // Otra pestaña abierta con una versión vieja: se espera a que la suelte.
    req.onblocked = () => {};
    req.onsuccess = () => {
      const db = req.result;
      // Si otra pestaña con una versión más nueva necesita actualizar, se cede.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function run(store, mode, fn) {
  const db = await open();
  try {
    return await tx(db, store, mode, fn);
  } finally {
    db.close();
  }
}

export const allVaults = () => run(VAULTS, 'readonly', (s) => s.getAll());
export const getVault = (id) => run(VAULTS, 'readonly', (s) => s.get(id));
export const putVault = (record) => run(VAULTS, 'readwrite', (s) => s.put(record));
export const getMarket = (id) => run(MARKET, 'readonly', (s) => s.get(id));
export const putMarket = (record) => run(MARKET, 'readwrite', (s) => s.put(record));

// Borra la bóveda y su caché de mercado en una sola transacción.
export async function deleteVault(id) {
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction([VAULTS, MARKET], 'readwrite');
      t.objectStore(VAULTS).delete(id);
      t.objectStore(MARKET).delete(id);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
