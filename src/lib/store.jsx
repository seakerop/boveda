import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as db from './db.js';
import * as vc from './vaultCrypto.js';
import { refreshMarket } from './prices.js';
import { buildDailySeries, computePositions, todayStr } from './portfolio.js';

const EMPTY_VAULT = () => ({
  version: 1,
  settings: { baseCurrency: 'EUR', autoLockMin: 5, lockOnHide: true },
  assets: [],
  transactions: [],
  valuations: [],
  snapshots: {},
  priceCache: {},
  fxCache: {},
});

const Ctx = createContext(null);
export const useBoveda = () => useContext(Ctx);

async function writeVaultRecord(id, key, data, saltB64) {
  const { iv, data: ct } = await vc.encryptJson(key, data);
  await db.putVault({ id, salt: saltB64, iter: vc.PBKDF2_ITER, iv, data: ct });
}

export function BovedaProvider({ children }) {
  const [stage, setStage] = useState('loading'); // loading | setup | locked | open
  const [data, setData] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [marketErrors, setMarketErrors] = useState([]);
  const [privacy, setPrivacy] = useState('normal'); // normal | hidden | percent

  const keyRef = useRef(null);
  const idRef = useRef(null);
  const saltRef = useRef(null);
  const dataRef = useRef(null);
  const saveChain = useRef(Promise.resolve());
  const refreshSig = useRef('');
  dataRef.current = data;

  useEffect(() => {
    db.allVaults().then((v) => setStage(v.length ? 'locked' : 'setup'));
  }, []);

  const persist = useCallback((d) => {
    const key = keyRef.current;
    const id = idRef.current;
    const salt = saltRef.current;
    if (!key || !id) return;
    saveChain.current = saveChain.current
      .then(() => writeVaultRecord(id, key, d, salt))
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
    idRef.current = null;
    saltRef.current = null;
    refreshSig.current = '';
    setData(null);
    setQuotes({});
    setMarketErrors([]);
    setPrivacy('normal');
    setStage('locked');
  }, []);

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
    idRef.current = id;
    saltRef.current = saltB64;
    setData(d);
    setStage('open');
  }, []);

  const createDecoy = useCallback(async (password) => {
    await createVaultRecord(password);
  }, []);

  const unlock = useCallback(async (password) => {
    const vaults = await db.allVaults();
    for (const v of vaults) {
      try {
        const key = await vc.deriveKey(password, vc.unb64(v.salt), v.iter || vc.PBKDF2_ITER);
        const d = await vc.decryptJson(key, v.iv, v.data);
        keyRef.current = key;
        idRef.current = v.id;
        saltRef.current = v.salt;
        setData(d);
        setStage('open');
        return true;
      } catch {
        // contraseña no válida para esta bóveda: probar la siguiente
      }
    }
    return false;
  }, []);

  const changePassword = useCallback(async (newPassword) => {
    const salt = vc.newSalt();
    const key = await vc.deriveKey(newPassword, salt);
    keyRef.current = key;
    saltRef.current = vc.b64(salt);
    await writeVaultRecord(idRef.current, key, dataRef.current, saltRef.current);
  }, []);

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
    await db.putVault({ id: crypto.randomUUID(), salt: j.salt, iter: j.iter || vc.PBKDF2_ITER, iv: j.iv, data: j.data });
    setStage('locked');
  }, []);

  const wipeVault = useCallback(async () => {
    await db.deleteVault(idRef.current);
    const rest = await db.allVaults();
    keyRef.current = null;
    idRef.current = null;
    saltRef.current = null;
    setData(null);
    setQuotes({});
    setStage(rest.length ? 'locked' : 'setup');
  }, []);

  const doRefresh = useCallback(async () => {
    const d = dataRef.current;
    if (!d || !d.assets.length) return;
    setRefreshing(true);
    try {
      const { quotes: q, priceCache, fxCache, errors } = await refreshMarket(d);
      setQuotes(q);
      setMarketErrors(errors);
      mutate((cur) => {
        cur.priceCache = priceCache;
        cur.fxCache = fxCache;
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
    const sig = JSON.stringify([data.assets.map((a) => a.id).sort(), data.transactions.length]);
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
