// IndexedDB: solo guarda registros de bóveda ya cifrados {id, salt, iter, iv, data}.
// Nada legible sale del módulo de cifrado.

const DB_NAME = 'boveda';
const STORE = 'vaults';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function allVaults() {
  const db = await open();
  try {
    return await tx(db, 'readonly', (s) => s.getAll());
  } finally {
    db.close();
  }
}

export async function getVault(id) {
  const db = await open();
  try {
    return await tx(db, 'readonly', (s) => s.get(id));
  } finally {
    db.close();
  }
}

export async function putVault(record) {
  const db = await open();
  try {
    return await tx(db, 'readwrite', (s) => s.put(record));
  } finally {
    db.close();
  }
}

export async function deleteVault(id) {
  const db = await open();
  try {
    return await tx(db, 'readwrite', (s) => s.delete(id));
  } finally {
    db.close();
  }
}
