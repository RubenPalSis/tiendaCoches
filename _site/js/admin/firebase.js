// SDK de Firebase solo para el panel. La configuración pública la sirve Firebase Hosting en
// /__/firebase/init.json, así que no hay claves escritas en el código.
const V = '12.19.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

const [appMod, authMod, fsMod, stMod, fnMod] = await Promise.all([
  import(`${CDN}/firebase-app.js`),
  import(`${CDN}/firebase-auth.js`),
  import(`${CDN}/firebase-firestore.js`),
  import(`${CDN}/firebase-storage.js`),
  import(`${CDN}/firebase-functions.js`),
]);

const config = await fetch('/__/firebase/init.json').then((r) => {
  if (!r.ok) throw new Error('No se pudo cargar la configuración de Firebase');
  return r.json();
});

export const app = appMod.initializeApp(config);
export const auth = authMod.getAuth(app);
export const db = fsMod.getFirestore(app);
export const storage = stMod.getStorage(app);
const functions = fnMod.getFunctions(app, 'europe-west1');

export const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if (isLocal) {
  authMod.connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  fsMod.connectFirestoreEmulator(db, location.hostname, 8080);
  stMod.connectStorageEmulator(storage, location.hostname, 9199);
}

export const fs = fsMod;
export const st = stMod;
export const authApi = authMod;

// Las funciones se llaman a través de Firebase Hosting (/fn/*, mismo dominio): así la política de
// seguridad (CSP connect-src 'self') no necesita permitir dominios externos.
const callable = (name) => fnMod.httpsCallableFromURL(functions, `${location.origin}/fn/${name}`);
const adminActionFn = callable('adminAction');
const syncAdminFn = callable('syncAdminClaim');

/** Comprueba en el servidor si el email está autorizado como administrador y actualiza el permiso. */
export async function syncAdminClaim() {
  try { return (await syncAdminFn()).data; } catch { return { admin: false }; }
}

/** Acciones de backend del panel (pedidos, reembolsos, índice…). */
export async function adminAction(action, payload = {}) {
  try {
    const res = await adminActionFn({ action, ...payload });
    return res.data;
  } catch (err) {
    throw new Error(err.message || 'Error al conectar con el servidor.');
  }
}
