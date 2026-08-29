import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as db from './db.js';
import * as vc from './vaultCrypto.js';
import * as bio from './bioUnlock.js';
import { refreshMarket } from './prices.js';
import { buildDailySeries, computePositions, todayStr } from './portfolio.js';

const EMPTY_VAULT = () => ({
  version: 2,
  settings: { baseCurrency: 'EUR', autoLockMin: 5, lockOnHide: true },
  assets: [],
  transactions: [],
  valuations: [],
  snapshots: {},
  priceCache: {},
  fxCache: {},
  debts: [],
  debtEvents: [],
});

// Migración de bóvedas anteriores (v1 no tenía deudas).
function normalizeVault(d) {
  if (!Array.isArray(d.debts)) d.debts = [];
  if (!Array.isArray(d.debtEvents)) d.debtEvents = [];
  if (!('euriborCache' in d)) d.euriborCache = null;
  if (!d.version || d.version < 2) d.version = 2;
  return d;
}

const Ctx = createContext(null);
export const useBoveda = () => useContext(Ctx);

async function writeVaultRecord(id, key, data, saltB64, iter = vc.PBKDF2_ITER, bioObj = null) {
  const { iv, data: ct } = await vc.encryptJson(key, data);
  await db.putVault({ id, salt: saltB64, iter, iv, data: ct, ...(bioObj ? { bio: bioObj } : {}) });
}

export function BovedaProvider({ children }) {
  const [stage, setStage] = useState('loading'); // loading | setup | locked | open
  const [data, setData] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [marketErrors, setMarketErrors] = useState([]);
  const [privacy, setPrivacy] = useState('normal'); // normal | hidden | percent
  // Huella: disponibilidad del dispositivo y estado en la pantalla de bloqueo
  // (ready = hay bóvedas desbloqueables; expired = las hay pero toca contraseña).
  const [bioState, setBioState] = useState({ avail: false, ready: false, expired: false });
  const [bioOn, setBioOn] = useState(false); // la bóveda abierta tiene huella activa

  const keyRef = useRef(null);
  const bioRef = useRef(null); // alta de huella {credId, prfSalt, iv, data, pwAt} del registro abierto
  const iterRef = useRef(vc.PBKDF2_ITER);
  const idRef = useRef(null);
  const saltRef = useRef(null);
  const dataRef = useRef(null);
  const saveChain = useRef(Promise.resolve());
  const refreshSig = useRef('');
  dataRef.current = data;

  const refreshBio = useCallback(async () => {
    const avail = await bio.bioSupported();
    if (!avail) return setBioState({ avail: false, ready: false, expired: false });
    const vaults = await db.allVaults();
    const enrolled = vaults.filter((v) => v.bio);
    const fresh = enrolled.filter((v) => bio.pwFresh(v.bio));
    setBioState({ avail, ready: fresh.length > 0, expired: !fresh.length && enrolled.length > 0 });
  }, []);

  useEffect(() => {
    db.allVaults().then((v) => setStage(v.length ? 'locked' : 'setup'));
    refreshBio();
  }, [refreshBio]);

  // Con la app bloqueada, recalcular el estado de la huella al volver el foco:
  // si la ventana de 14 días expira con la pestaña abierta, el botón se retira.
  useEffect(() => {
    if (stage !== 'locked') return;
    const onFocus = () => refreshBio();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [stage, refreshBio]);

  const persist = useCallback((d) => {
    const key = keyRef.current;
    const id = idRef.current;
    const salt = saltRef.current;
    const iter = iterRef.current;
    const bioObj = bioRef.current;
    if (!key || !id) return;
    saveChain.current = saveChain.current
      .then(() => writeVaultRecord(id, key, d, salt, iter, bioObj))
      .catch((e) => console.error('Error guardando la bóveda:', e));
  }, []);

  const mutate = useCallback(
    (fn) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = fn(structuredClone(prev)) || prev;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const lock = useCallback(() => {
    keyRef.current = null;
    bioRef.current = null;
    iterRef.current = vc.PBKDF2_ITER;
    idRef.current = null;
    saltRef.current = null;
    refreshSig.current = '';
    setData(null);
    setQuotes({});
    setMarketErrors([]);
    setPrivacy('normal');
    setBioOn(false);
    setStage('locked');
    refreshBio();
  }, [refreshBio]);

  async function createVaultRecord(password, initial) {
    const salt = vc.newSalt();
    const key = await vc.deriveKey(password, salt);
    const id = crypto.randomUUID();
    const saltB64 = vc.b64(salt);
    const d = initial || EMPTY_VAULT();
    await writeVaultRecord(id, key, d, saltB64);
    return { id, key, saltB64, d };
  }

  const createAndOpen = useCallback(async (password) => {
    const { id, key, saltB64, d } = await createVaultRecord(password);
    keyRef.current = key;
    bioRef.current = null;
    iterRef.current = vc.PBKDF2_ITER;
    idRef.current = id;
    saltRef.current = saltB64;
    setBioOn(false);
    setData(d);
    setStage('open');
  }, []);

  const createDecoy = useCallback(async (password) => {
    await createVaultRecord(password);
  }, []);

  const openRecord = useCallback((record, key, d) => {
    keyRef.current = key;
    bioRef.current = record.bio || null;
    iterRef.current = record.iter || vc.PBKDF2_ITER;
    idRef.current = record.id;
    saltRef.current = record.salt;
    setBioOn(!!record.bio);
    setData(d);
    setStage('open');
  }, []);

  const unlock = useCallback(async (password) => {
    const vaults = await db.allVaults();
    for (const v of vaults) {
      try {
        const key = await vc.deriveKey(password, vc.unb64(v.salt), v.iter || vc.PBKDF2_ITER);
        const d = normalizeVault(await vc.decryptJson(key, v.iv, v.data));
        // Entrar con contraseña re-arma el recordatorio de la huella (pwAt).
        if (v.bio) {
          v.bio = { ...v.bio, pwAt: Date.now() };
          db.putVault(v).catch(() => {});
        }
        openRecord(v, key, d);
        return true;
      } catch {
        // contraseña no válida para esta bóveda: probar la siguiente
      }
    }
    return false;
  }, [openRecord]);

  // Desbloqueo con huella: una verificación contra las bóvedas con huella
  // vigente; la que responda se abre. Sin registros vigentes no hay botón.
  const unlockWithBio = useCallback(async () => {
    try {
      const vaults = await db.allVaults();
      const fresh = vaults.filter((v) => v.bio && bio.pwFresh(v.bio));
      if (!fresh.length) {
        refreshBio(); // retira el botón y muestra la nota de los 14 días
        return { ok: false, error: 'Hoy toca escribir la contraseña.' };
      }
      const { record, keyBits } = await bio.bioUnlock(fresh);
      const key = await vc.keyFromBits(keyBits);
      const d = normalizeVault(await vc.decryptJson(key, record.iv, record.data));
      openRecord(record, key, d);
      return { ok: true };
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return { ok: false, cancelled: true };
      return { ok: false, error: bio.bioErrMsg(e) };
    }
  }, [openRecord, refreshBio]);

  // Activar la huella exige la contraseña maestra en el momento: confirma que
  // el dueño la sabe (y por eso re-arma pwAt), y evita retener los bits de la
  // clave en memoria durante toda la sesión.
  const enableBio = useCallback(async (password) => {
    await saveChain.current; // que el registro leído refleje escrituras encoladas
    const rec = await db.getVault(idRef.current);
    if (!rec) throw new Error('No se encontró la bóveda.');
    let bits;
    try {
      bits = await vc.deriveBits(password, vc.unb64(rec.salt), rec.iter || vc.PBKDF2_ITER);
      await vc.decryptJson(await vc.keyFromBits(bits), rec.iv, rec.data);
    } catch {
      throw new Error('Contraseña incorrecta.');
    }
    const enrolled = await bio.enrollBio(bits);
    bioRef.current = { ...enrolled, pwAt: Date.now() };
    setBioOn(true);
    persist(dataRef.current);
    refreshBio();
  }, [persist, refreshBio]);

  const disableBio = useCallback(async () => {
    bioRef.current = null;
    setBioOn(false);
    // Por la cadena de guardado: un persist en vuelo no debe re-escribir la huella.
    saveChain.current = saveChain.current.then(async () => {
      const rec = await db.getVault(idRef.current);
      if (rec?.bio) {
        delete rec.bio;
        await db.putVault(rec);
      }
    });
    await saveChain.current;
    refreshBio();
  }, [refreshBio]);

  const changePassword = useCallback(async (newPassword) => {
    const salt = vc.newSalt();
    const key = await vc.deriveKey(newPassword, salt);
    keyRef.current = key;
    saltRef.current = vc.b64(salt);
    iterRef.current = vc.PBKDF2_ITER;
    // La clave cambia, así que la envoltura de la huella deja de valer:
    // se desactiva y hay que volver a activarla desde Ajustes.
    bioRef.current = null;
    setBioOn(false);
    // Por la cadena de guardado: un persist encolado con la clave vieja (y su
    // huella) no debe aterrizar después y resucitar la contraseña anterior.
    const id = idRef.current;
    const saltB64 = saltRef.current;
    saveChain.current = saveChain.current.then(() => writeVaultRecord(id, key, dataRef.current, saltB64));
    await saveChain.current;
    refreshBio();
  }, [refreshBio]);

  const exportBackup = useCallback(async () => {
    const rec = await db.getVault(idRef.current);
    if (!rec) return;
    const payload = {
      format: 'boveda-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      salt: rec.salt,
      iter: rec.iter,
      iv: rec.iv,
      data: rec.data,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boveda-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const importBackup = useCallback(async (file) => {
    const text = await file.text();
    const j = JSON.parse(text);
    if (j.format !== 'boveda-backup' || !j.salt || !j.iv || !j.data) {
      throw new Error('El archivo no es un backup de Bóveda válido');
    }
    const iter = j.iter || vc.PBKDF2_ITER;
    // Si la bóveda de origen sigue en este dispositivo (misma sal), restaurar
    // encima en vez de duplicarla: la contraseña es la misma, así que la
    // huella que tuviera sigue valiendo (envuelve la clave, no los datos).
    const vaults = await db.allVaults();
    const twin = vaults.find((v) => v.salt === j.salt && (v.iter || vc.PBKDF2_ITER) === iter);
    if (twin) {
      await db.putVault({ ...twin, iv: j.iv, data: j.data });
    } else {
      await db.putVault({ id: crypto.randomUUID(), salt: j.salt, iter, iv: j.iv, data: j.data });
    }
    setStage('locked');
  }, []);

  const wipeVault = useCallback(async () => {
    const id = idRef.current;
    keyRef.current = null; // corta nuevos persists antes de borrar
    bioRef.current = null;
    idRef.current = null;
    saltRef.current = null;
    // Por la cadena: un persist ya encolado no debe re-crear la bóveda borrada.
    saveChain.current = saveChain.current.then(() => db.deleteVault(id));
    await saveChain.current;
    const rest = await db.allVaults();
    setData(null);
    setQuotes({});
    setBioOn(false);
    setStage(rest.length ? 'locked' : 'setup');
    refreshBio();
  }, [refreshBio]);

  const doRefresh = useCallback(async () => {
    const d = dataRef.current;
    if (!d || (!d.assets.length && !d.debts?.length)) return;
    setRefreshing(true);
    try {
      const { quotes: q, priceCache, fxCache, euriborCache, errors } = await refreshMarket(d);
      setQuotes(q);
      setMarketErrors(errors);
      mutate((cur) => {
        cur.priceCache = priceCache;
        cur.fxCache = fxCache;
        cur.euriborCache = euriborCache;
        return cur;
      });
    } catch (e) {
      setMarketErrors([String(e.message || e)]);
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  // Refrescar mercado al abrir y cuando cambia la composición de la cartera.
  useEffect(() => {
    if (stage !== 'open' || !data) return;
    const sig = JSON.stringify([
      data.assets.map((a) => a.id).sort(),
      data.transactions.length,
      (data.debts || []).map((d) => d.id + (d.rate?.type || '')).sort(),
    ]);
    if (sig !== refreshSig.current) {
      refreshSig.current = sig;
      doRefresh();
    }
  }, [stage, data, doRefresh]);

  const positions = useMemo(() => (data ? computePositions(data, quotes) : []), [data, quotes]);
  const series = useMemo(() => (data ? buildDailySeries(data) : []), [data]);

  // Snapshot diario: mantiene la vela de la semana en curso y el histórico propio.
  useEffect(() => {
    if (stage !== 'open' || !series.length) return;
    const last = series[series.length - 1];
    if (last.date !== todayStr()) return;
    const prev = dataRef.current?.snapshots?.[last.date];
    if (prev && Math.abs(prev.total - last.total) < 0.005) return;
    mutate((d) => {
      d.snapshots[last.date] = {
        total: last.total,
        crypto: last.crypto,
        stock: last.stock,
        realestate: last.realestate,
        cash: last.cash,
      };
      return d;
    });
  }, [stage, series, mutate]);

  // Auto-bloqueo por inactividad y al pasar a segundo plano (con 20s de gracia:
  // un cambio fugaz de app no obliga a re-teclear la contraseña).
  useEffect(() => {
    if (stage !== 'open') return;
    let timer;
    let hideTimer;
    const arm = () => {
      clearTimeout(timer);
      const min = dataRef.current?.settings?.autoLockMin ?? 5;
      if (min > 0) timer = setTimeout(lock, min * 60000);
    };
    const onVis = () => {
      if (!dataRef.current?.settings?.lockOnHide) return;
      clearTimeout(hideTimer);
      if (document.hidden) hideTimer = setTimeout(() => { if (document.hidden) lock(); }, 20000);
    };
    const evs = ['pointerdown', 'keydown', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    document.addEventListener('visibilitychange', onVis);
    arm();
    return () => {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      evs.forEach((e) => window.removeEventListener(e, arm));
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [stage, lock]);

  const cyclePrivacy = useCallback(() => {
    setPrivacy((p) => (p === 'normal' ? 'hidden' : p === 'hidden' ? 'percent' : 'normal'));
  }, []);

  const value = {
    stage,
    data,
    quotes,
    positions,
    series,
    refreshing,
    marketErrors,
    privacy,
    cyclePrivacy,
    unlock,
    unlockWithBio,
    bioState,
    bioOn,
    enableBio,
    disableBio,
    createAndOpen,
    createDecoy,
    lock,
    mutate,
    doRefresh,
    changePassword,
    exportBackup,
    importBackup,
    wipeVault,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
