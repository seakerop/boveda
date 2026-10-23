import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as db from './db.js';
import * as vc from './vaultCrypto.js';
import * as bio from './bioUnlock.js';
import { ensureBenchmark, refreshMarket } from './prices.js';
import { buildDailySeries, computePositions } from './portfolio.js';
import { applyBackfill, backfillPatch, DEFAULT_SETTINGS, normalizeVault, VAULT_VERSION } from './migrate.js';
import { todayStr } from './dates.js';

const EMPTY_VAULT = () => ({
  version: VAULT_VERSION,
  settings: { ...DEFAULT_SETTINGS },
  assets: [],
  transactions: [],
  valuations: [],
  debts: [],
  debtEvents: [],
});

const EMPTY_MARKET = () => ({ priceCache: {}, fxCache: {}, euriborCache: null, benchCache: {} });

const Ctx = createContext(null);
export const useBoveda = () => useContext(Ctx);

async function writeVaultRecord(id, key, data, saltB64, iter = vc.PBKDF2_ITER, bioObj = null) {
  const { iv, data: ct } = await vc.encryptJson(key, data);
  await db.putVault({ id, salt: saltB64, iter, iv, data: ct, ...(bioObj ? { bio: bioObj } : {}) });
}

async function writeMarketRecord(id, key, market) {
  const { iv, data } = await vc.encryptJson(key, market);
  await db.putMarket({ id, iv, data });
}

const REFRESH_EVERY_MS = 5 * 60 * 1000;

export function BovedaProvider({ children }) {
  const [stage, setStage] = useState('loading'); // loading | setup | locked | open
  const [vault, setVault] = useState(null);
  const [market, setMarket] = useState(EMPTY_MARKET);
  const [quotes, setQuotes] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [marketErrors, setMarketErrors] = useState([]);
  const [privacy, setPrivacy] = useState('normal'); // normal | hidden | percent
  const [toasts, setToasts] = useState([]);
  // Huella: disponibilidad del dispositivo y estado en la pantalla de bloqueo
  // (ready = hay bóvedas desbloqueables; expired = las hay pero toca contraseña).
  const [bioState, setBioState] = useState({ avail: false, ready: false, expired: false });
  const [bioOn, setBioOn] = useState(false); // la bóveda abierta tiene huella activa

  const keyRef = useRef(null);
  const bioRef = useRef(null); // alta de huella {credId, prfSalt, iv, data, pwAt} del registro abierto
  const iterRef = useRef(vc.PBKDF2_ITER);
  const idRef = useRef(null);
  const saltRef = useRef(null);
  const vaultRef = useRef(null);
  const marketRef = useRef(EMPTY_MARKET());
  const saveChain = useRef(Promise.resolve());
  const refreshSig = useRef('');
  const refreshBusy = useRef(false);
  const refreshPending = useRef(false);
  const lastRefreshRef = useRef(0);
  const suspendHideLock = useRef(false);
  vaultRef.current = vault;
  marketRef.current = market;

  // Lo que ven los componentes: la bóveda con las cachés de mercado al lado.
  const data = useMemo(() => (vault ? { ...vault, ...market } : null), [vault, market]);
  const dataRef = useRef(null);
  dataRef.current = data;

  const refreshBio = useCallback(async () => {
    const avail = await bio.bioSupported();
    if (!avail) return setBioState({ avail: false, ready: false, expired: false });
    const vaults = await db.allVaults();
    const enrolled = vaults.filter((v) => v.bio);
    const fresh = enrolled.filter((v) => bio.pwFresh(v.bio));
    setBioState({ avail, ready: fresh.length > 0, expired: !fresh.length && enrolled.length > 0 });
  }, []);

  const [bootError, setBootError] = useState(null);
  useEffect(() => {
    db.allVaults()
      .then((v) => setStage(v.length ? 'locked' : 'setup'))
      .catch((e) => {
        // Sin acceso a IndexedDB (navegación privada estricta, otra pestaña con
        // una versión vieja abierta…): mejor decirlo que quedarse cargando.
        setBootError(String(e?.message || e?.name || e));
        setStage('error');
      });
    refreshBio().catch(() => {});
  }, [refreshBio]);

  // Con la app bloqueada, recalcular el estado de la huella al volver el foco:
  // si la ventana de 14 días expira con la pestaña abierta, el botón se retira.
  useEffect(() => {
    if (stage !== 'locked') return;
    const onFocus = () => refreshBio();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [stage, refreshBio]);

  // ---------- avisos (toasts) ----------
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (text, opts = {}) => {
      const id = crypto.randomUUID();
      setToasts((t) => [...t.slice(-2), { id, text, kind: opts.kind || 'info', undo: opts.undo || null }]);
      setTimeout(() => dismissToast(id), opts.ms || (opts.undo ? 7000 : 4000));
      return id;
    },
    [dismissToast]
  );

  // ---------- persistencia ----------
  // Una sola cola para todas las escrituras: se ejecutan en orden y cada una
  // aísla su error (la cola sigue viva aunque una falle). Quien encola recibe la
  // promesa de SU escritura, para poder reaccionar si falla.
  const enqueue = useCallback((fn) => {
    const job = saveChain.current.then(fn);
    saveChain.current = job.catch(() => {});
    return job;
  }, []);

  const saveFailed = useRef(0);
  const reportSaveError = useCallback(
    (e) => {
      console.error('Error guardando la bóveda:', e);
      // Un aviso por ráfaga de errores, no uno por edición.
      if (Date.now() - saveFailed.current > 15000) {
        saveFailed.current = Date.now();
        notify(`No se pudo guardar el último cambio (${e?.name || 'error'}). Si se repite, haz un backup y recarga la app.`, {
          kind: 'error',
          ms: 10000,
        });
      }
    },
    [notify]
  );

  const persist = useCallback(
    (d) => {
      const key = keyRef.current;
      const id = idRef.current;
      const salt = saltRef.current;
      const iter = iterRef.current;
      const bioObj = bioRef.current;
      if (!key || !id) return;
      enqueue(() => writeVaultRecord(id, key, d, salt, iter, bioObj)).catch(reportSaveError);
    },
    [enqueue, reportSaveError]
  );

  const persistMarket = useCallback(
    (m) => {
      const key = keyRef.current;
      const id = idRef.current;
      if (!key || !id) return;
      enqueue(() => writeMarketRecord(id, key, m)).catch((e) => console.error('Error guardando la caché de mercado:', e));
    },
    [enqueue]
  );

  const mutate = useCallback(
    (fn) => {
      setVault((prev) => {
        if (!prev) return prev;
        const next = fn(structuredClone(prev)) || prev;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const updateMarket = useCallback(
    (fn) => {
      setMarket((prev) => {
        const next = fn(prev);
        persistMarket(next);
        return next;
      });
    },
    [persistMarket]
  );

  const resetSession = useCallback(() => {
    keyRef.current = null;
    bioRef.current = null;
    iterRef.current = vc.PBKDF2_ITER;
    idRef.current = null;
    saltRef.current = null;
    refreshSig.current = '';
    lastRefreshRef.current = 0;
    setVault(null);
    setMarket(EMPTY_MARKET());
    setQuotes({});
    setMarketErrors([]);
    setLastRefresh(null);
    setToasts([]);
    setPrivacy('normal');
    setBioOn(false);
  }, []);

  const lock = useCallback(() => {
    resetSession();
    setStage('locked');
    refreshBio();
  }, [refreshBio, resetSession]);

  async function createVaultRecord(password) {
    const salt = vc.newSalt();
    const key = await vc.deriveKey(password, salt);
    const id = crypto.randomUUID();
    const saltB64 = vc.b64(salt);
    const d = EMPTY_VAULT();
    await writeVaultRecord(id, key, d, saltB64);
    // Toda bóveda (señuelo incluido) tiene su registro de caché desde el
    // principio: que exista o no, no delata cuál se usa a diario.
    await writeMarketRecord(id, key, EMPTY_MARKET());
    return { id, key, saltB64, d };
  }

  // beforeOpen (opcional): se espera justo antes de mostrar los datos. La pantalla
  // de bloqueo lo usa para la animación de la caja fuerte abriéndose.
  const runBeforeOpen = async (beforeOpen) => {
    if (!beforeOpen) return;
    try {
      await beforeOpen();
    } catch {
      // una animación que falle nunca debe impedir abrir la bóveda
    }
  };

  const createAndOpen = useCallback(async (password, beforeOpen) => {
    const { id, key, saltB64, d } = await createVaultRecord(password);
    await runBeforeOpen(beforeOpen);
    keyRef.current = key;
    bioRef.current = null;
    iterRef.current = vc.PBKDF2_ITER;
    idRef.current = id;
    saltRef.current = saltB64;
    setBioOn(false);
    setMarket(EMPTY_MARKET());
    setVault(d);
    setStage('open');
  }, []);

  const createDecoy = useCallback(async (password) => {
    await createVaultRecord(password);
  }, []);

  // Abre un registro ya descifrado: carga su caché de mercado y migra si toca.
  const openRecord = useCallback(
    async (record, key, rawData) => {
      const { vault: v, legacy, migrated } = normalizeVault(rawData);
      let m = EMPTY_MARKET();
      let marketOk = false;
      try {
        const rec = await db.getMarket(record.id);
        if (rec) {
          m = { ...m, ...(await vc.decryptJson(key, rec.iv, rec.data)) };
          marketOk = true;
        }
      } catch {
        // caché ilegible (o relleno aleatorio de la actualización): se
        // reconstruye sola con el próximo refresco
      }
      const marketWasEmpty = !Object.keys(m.priceCache || {}).length;
      if (Object.keys(legacy).length && marketWasEmpty) m = { ...m, ...legacy };
      keyRef.current = key;
      bioRef.current = record.bio || null;
      iterRef.current = record.iter || vc.PBKDF2_ITER;
      idRef.current = record.id;
      saltRef.current = record.salt;
      setBioOn(!!record.bio);
      setMarket(m);
      setVault(v);
      setStage('open');
      // Primero la caché y después la bóveda: si la app se cerrase entre las dos
      // escrituras, la bóveda vieja (con las cachés dentro) sigue intacta.
      if (!marketOk || Object.keys(legacy).length) persistMarket(m);
      if (migrated) persist(v);
    },
    [persist, persistMarket]
  );

  const unlock = useCallback(
    async (password, beforeOpen) => {
      const vaults = await db.allVaults();
      for (const v of vaults) {
        let key;
        let d;
        try {
          key = await vc.deriveKey(password, vc.unb64(v.salt), v.iter || vc.PBKDF2_ITER);
          d = await vc.decryptJson(key, v.iv, v.data);
        } catch {
          continue; // contraseña no válida para esta bóveda: probar la siguiente
        }
        // Entrar con contraseña re-arma el recordatorio de la huella (pwAt).
        if (v.bio) {
          v.bio = { ...v.bio, pwAt: Date.now() };
          const rec = { ...v };
          enqueue(() => db.putVault(rec)).catch(() => {});
        }
        await runBeforeOpen(beforeOpen);
        await openRecord(v, key, d);
        return true;
      }
      return false;
    },
    [openRecord, enqueue]
  );

  // Desbloqueo con huella: una verificación contra las bóvedas con huella
  // vigente; la que responda se abre. Sin registros vigentes no hay botón.
  const unlockWithBio = useCallback(async (beforeOpen) => {
    try {
      const vaults = await db.allVaults();
      const fresh = vaults.filter((v) => v.bio && bio.pwFresh(v.bio));
      if (!fresh.length) {
        refreshBio(); // retira el botón y muestra la nota de los 14 días
        return { ok: false, error: 'Hoy toca escribir la contraseña.' };
      }
      const { record, keyBits } = await bio.bioUnlock(fresh);
      const key = await vc.keyFromBits(keyBits);
      const d = await vc.decryptJson(key, record.iv, record.data);
      await runBeforeOpen(beforeOpen);
      await openRecord(record, key, d);
      return { ok: true };
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return { ok: false, cancelled: true };
      return { ok: false, error: bio.bioErrMsg(e) };
    }
  }, [openRecord, refreshBio]);

  // Activar la huella exige la contraseña maestra en el momento: confirma que
  // el dueño la sabe (y por eso re-arma pwAt), y evita retener los bits de la
  // clave en memoria durante toda la sesión.
  const enableBio = useCallback(
    async (password) => {
      await saveChain.current; // que el registro leído refleje escrituras encoladas (no rechaza nunca)
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
      const id = idRef.current;
      const snap = { key: keyRef.current, salt: saltRef.current, iter: iterRef.current, bio: bioRef.current };
      try {
        await enqueue(() => writeVaultRecord(id, snap.key, vaultRef.current, snap.salt, snap.iter, snap.bio));
      } catch (e) {
        bioRef.current = null;
        throw new Error(`No se pudo guardar la huella (${e?.name || 'error'}).`);
      }
      setBioOn(true);
      refreshBio();
    },
    [enqueue, refreshBio]
  );

  const disableBio = useCallback(async () => {
    const prevBio = bioRef.current;
    bioRef.current = null;
    setBioOn(false);
    // Por la cola de guardado: un persist en vuelo no debe re-escribir la huella.
    const id = idRef.current;
    try {
      await enqueue(async () => {
        const rec = await db.getVault(id);
        if (rec?.bio) {
          delete rec.bio;
          await db.putVault(rec);
        }
      });
    } catch (e) {
      bioRef.current = prevBio;
      setBioOn(!!prevBio);
      throw e;
    } finally {
      refreshBio();
    }
  }, [enqueue, refreshBio]);

  const changePassword = useCallback(
    async (newPassword) => {
      const salt = vc.newSalt();
      const key = await vc.deriveKey(newPassword, salt);
      const prev = { key: keyRef.current, salt: saltRef.current, iter: iterRef.current, bio: bioRef.current };
      // Las referencias cambian YA para que cualquier guardado posterior use la
      // clave nueva; un persist encolado antes (clave vieja) se ejecuta antes y
      // queda sobrescrito. La huella envolvía la clave vieja: se desactiva.
      keyRef.current = key;
      saltRef.current = vc.b64(salt);
      iterRef.current = vc.PBKDF2_ITER;
      bioRef.current = null;
      setBioOn(false);
      const id = idRef.current;
      const saltB64 = saltRef.current;
      try {
        await enqueue(async () => {
          await writeVaultRecord(id, key, vaultRef.current, saltB64);
          await writeMarketRecord(id, key, marketRef.current);
        });
      } catch (e) {
        // Si no se pudo escribir, todo vuelve a la contraseña de antes (y se
        // reescribe con ella, por si algo llegó a guardarse con la nueva).
        keyRef.current = prev.key;
        saltRef.current = prev.salt;
        iterRef.current = prev.iter;
        bioRef.current = prev.bio;
        setBioOn(!!prev.bio);
        enqueue(() => writeVaultRecord(id, prev.key, vaultRef.current, prev.salt, prev.iter, prev.bio)).catch(
          reportSaveError
        );
        throw new Error(`No se pudo cambiar la contraseña (${e?.name || 'error'}): sigue siendo la anterior.`);
      }
      refreshBio();
    },
    [enqueue, refreshBio, reportSaveError]
  );

  // Backup: en el móvil se abre el menú "Compartir" del sistema (WhatsApp, Drive,
  // Archivos…), que en una PWA instalada es mucho más fiable que una descarga.
  // En escritorio, descarga normal. Solo la bóveda: los precios se vuelven a bajar.
  const exportBackup = useCallback(async () => {
    await saveChain.current;
    const rec = await db.getVault(idRef.current);
    if (!rec) throw new Error('No se encontró la bóveda.');
    const payload = {
      format: 'boveda-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      salt: rec.salt,
      iter: rec.iter,
      iv: rec.iv,
      data: rec.data,
    };
    const name = `boveda-backup-${todayStr()}.json`;
    const json = JSON.stringify(payload);
    let shared = false;
    const mobile = window.matchMedia?.('(pointer: coarse)').matches;
    if (mobile && typeof File !== 'undefined') {
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        // La hoja de compartir pasa la app a segundo plano: que no se bloquee
        // mientras eliges dónde guardar el backup.
        suspendHideLock.current = true;
        try {
          await navigator.share({ files: [file], title: 'Backup de Bóveda' });
          shared = true;
        } catch (e) {
          if (e?.name === 'AbortError') return { ok: false, cancelled: true };
          // NotAllowedError u otro: se cae a la descarga normal
        } finally {
          suspendHideLock.current = false;
        }
      }
    }
    if (!shared) {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    mutate((d) => {
      d.settings.lastBackupAt = todayStr();
      return d;
    });
    return { ok: true, shared };
  }, [mutate]);

  const importBackup = useCallback(async (file) => {
    const text = await file.text();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error('El archivo no es un backup de Bóveda válido');
    }
    if (j.format !== 'boveda-backup' || !j.salt || !j.iv || !j.data) {
      throw new Error('El archivo no es un backup de Bóveda válido');
    }
    const iter = j.iter || vc.PBKDF2_ITER;
    // Un archivo manipulado con iteraciones desorbitadas colgaría el desbloqueo.
    if (!Number.isInteger(iter) || iter < 100000 || iter > 5000000) {
      throw new Error('El archivo no es un backup de Bóveda válido');
    }
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
    const key = keyRef.current;
    keyRef.current = null; // corta nuevos persists antes de borrar
    // Por la cola: un persist ya encolado no debe re-crear la bóveda borrada.
    try {
      await enqueue(() => db.deleteVault(id));
    } catch (e) {
      keyRef.current = key; // no se borró: la sesión sigue como estaba
      throw new Error(`No se pudo borrar la bóveda (${e?.name || 'error'}).`);
    }
    const rest = await db.allVaults();
    resetSession();
    setStage(rest.length ? 'locked' : 'setup');
    refreshBio();
  }, [enqueue, refreshBio, resetSession]);

  // ---------- mercado ----------
  const doRefreshRef = useRef(null);
  const doRefresh = useCallback(async () => {
    const d = dataRef.current;
    if (!d) return;
    if (refreshBusy.current) {
      // Ya hay uno en marcha: se repite al terminar (p. ej. si acabas de añadir un activo).
      refreshPending.current = true;
      return;
    }
    if (!d.assets.length && !d.debts?.length) return;
    const id = idRef.current;
    refreshBusy.current = true;
    refreshPending.current = false;
    setRefreshing(true);
    try {
      const res = await refreshMarket(d);
      if (idRef.current !== id) return; // se bloqueó o cambió de bóveda mientras tanto
      setQuotes(res.quotes);
      setMarketErrors(res.errors);
      updateMarket((m) => {
        // Solo activos que siguen existiendo: un refresco que empezó antes de
        // borrar un activo no debe resucitar su histórico.
        const alive = new Set((vaultRef.current?.assets || []).map((a) => a.id));
        const priceCache = Object.fromEntries(Object.entries(res.priceCache).filter(([k]) => alive.has(k)));
        return { ...m, priceCache, fxCache: res.fxCache, euriborCache: res.euriborCache };
      });
      const now = Date.now();
      lastRefreshRef.current = now;
      setLastRefresh(now);
    } catch (e) {
      setMarketErrors([String(e.message || e)]);
    } finally {
      refreshBusy.current = false;
      setRefreshing(false);
      if (refreshPending.current && idRef.current === id) {
        refreshPending.current = false;
        setTimeout(() => doRefreshRef.current?.(), 0);
      }
    }
  }, [updateMarket]);
  doRefreshRef.current = doRefresh;

  const loadBenchmark = useCallback(
    async (symbol) => {
      const id = idRef.current;
      const m = marketRef.current;
      const res = await ensureBenchmark(symbol, m.benchCache, m.fxCache);
      if (idRef.current !== id) return; // otra bóveda abierta mientras tanto
      updateMarket((cur) => ({ ...cur, benchCache: res.benchCache, fxCache: { ...cur.fxCache, ...res.fxCache } }));
    },
    [updateMarket]
  );

  const forgetPrices = useCallback(
    (assetId) => {
      updateMarket((m) => {
        if (!m.priceCache?.[assetId]) return m;
        const priceCache = { ...m.priceCache };
        delete priceCache[assetId];
        return { ...m, priceCache };
      });
    },
    [updateMarket]
  );

  // Refrescar mercado al abrir y cuando cambia la composición de la cartera.
  useEffect(() => {
    if (stage !== 'open' || !vault) return;
    const sig = JSON.stringify([
      vault.assets.map((a) => a.id).sort(),
      vault.transactions.length,
      (vault.debts || []).map((d) => d.id + (d.rate?.type || '')).sort(),
    ]);
    if (sig !== refreshSig.current) {
      refreshSig.current = sig;
      doRefresh();
    }
  }, [stage, vault, doRefresh]);

  // Y cada 5 minutos mientras la app está en pantalla (o al volver a ella).
  useEffect(() => {
    if (stage !== 'open') return;
    const tick = () => {
      if (!document.hidden && Date.now() - lastRefreshRef.current >= REFRESH_EVERY_MS) doRefresh();
    };
    const timer = setInterval(tick, 60 * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [stage, doRefresh]);

  // Completa divisa y cambio histórico de operaciones antiguas en cuanto hay datos.
  useEffect(() => {
    if (stage !== 'open' || !vault) return;
    const patch = backfillPatch(vault, market);
    if (!patch) return;
    mutate((d) => applyBackfill(d, patch));
  }, [stage, vault, market, mutate]);

  const positions = useMemo(() => (data ? computePositions(data, quotes) : []), [data, quotes]);
  const series = useMemo(() => (data ? buildDailySeries(data) : []), [data]);

  // Auto-bloqueo por inactividad y al pasar a segundo plano (con 20s de gracia:
  // un cambio fugaz de app no obliga a re-teclear la contraseña).
  useEffect(() => {
    if (stage !== 'open') return;
    let timer;
    let hideTimer;
    const arm = () => {
      clearTimeout(timer);
      const min = vaultRef.current?.settings?.autoLockMin ?? 5;
      if (min > 0) timer = setTimeout(lock, min * 60000);
    };
    const onVis = () => {
      if (!vaultRef.current?.settings?.lockOnHide) return;
      clearTimeout(hideTimer);
      if (document.hidden) {
        hideTimer = setTimeout(() => {
          if (document.hidden && !suspendHideLock.current) lock();
        }, 20000);
      }
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
    bootError,
    data,
    quotes,
    positions,
    series,
    refreshing,
    lastRefresh,
    marketErrors,
    privacy,
    cyclePrivacy,
    setPrivacy,
    toasts,
    notify,
    dismissToast,
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
    loadBenchmark,
    forgetPrices,
    changePassword,
    exportBackup,
    importBackup,
    wipeVault,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
