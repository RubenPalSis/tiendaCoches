// Cliente de Firestore por su API REST, con la misma forma que la parte de firebase-admin que usa
// la tienda (doc/collection/where/count/runTransaction, FieldValue, Timestamp).
// firebase-admin no funciona en Cloudflare Workers; así la lógica de pedidos y stock no cambia.
import { FIRESTORE_EMULATOR_HOST, projectId } from './config.js';
import { accessToken } from './google-auth.js';

// ---------- Timestamp y FieldValue ----------

export class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static now() { return Timestamp.fromMillis(Date.now()); }
  static fromDate(date) { return Timestamp.fromMillis(date.getTime()); }
  static fromMillis(ms) {
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(seconds, Math.round((ms - seconds * 1000) * 1e6));
  }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  isEqual(other) { return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds; }
  valueOf() { return String(this.toMillis()).padStart(16, '0'); }
  toJSON() { return this.toDate().toISOString(); }
}

class Sentinel {
  constructor(kind, value) {
    this.kind = kind;
    this.value = value;
  }
}

export const FieldValue = {
  serverTimestamp: () => new Sentinel('serverTimestamp'),
  increment: (n) => new Sentinel('increment', n),
  arrayUnion: (...values) => new Sentinel('arrayUnion', values),
  delete: () => new Sentinel('delete'),
};

// ---------- Conversión de valores ----------

const isPlainObject = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

export function encodeValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Timestamp) return { timestampValue: tsString(v) };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(encodeValue) } : {} };
  if (isPlainObject(v)) return { mapValue: { fields: encodeFields(v) } };
  throw new Error(`Valor no admitido en Firestore: ${v}`);
}

function tsString(ts) {
  const base = new Date(ts.seconds * 1000).toISOString().slice(0, 19);
  return `${base}.${String(ts.nanoseconds).padStart(9, '0')}Z`;
}

function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && !(v instanceof Sentinel)) fields[k] = encodeValue(v);
  return fields;
}

export function decodeValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) {
    const [, frac = ''] = /\.(\d+)Z$/.exec(v.timestampValue) ?? [];
    const seconds = Math.floor(Date.parse(v.timestampValue.replace(/\.\d+Z$/, 'Z')) / 1000);
    return new Timestamp(seconds, Number(frac.padEnd(9, '0').slice(0, 9)) || 0);
  }
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}

const decodeFields = (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));

// ---------- Rutas de campos ----------

const quoteSegment = (s) => (/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(s) ? s : `\`${s.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``);
const fieldPath = (segments) => segments.map(quoteSegment).join('.');

/** Inserta `value` en `target` siguiendo `segments` (crea mapas intermedios). */
function setIn(target, segments, value) {
  let node = target;
  segments.slice(0, -1).forEach((s) => { node = node[s] = isPlainObject(node[s]) ? node[s] : {}; });
  node[segments.at(-1)] = value;
}

/**
 * Recorre los valores y separa los centinelas (FieldValue.*) en transformaciones.
 * @returns {{ data: object, transforms: object[], deletes: string[][] }}
 */
function extractSentinels(entries, prefix = []) {
  const data = {};
  const transforms = [];
  const deletes = [];
  for (const [segments, value] of entries) {
    const path = [...prefix, ...segments];
    if (value instanceof Sentinel) {
      if (value.kind === 'delete') deletes.push(path);
      else if (value.kind === 'serverTimestamp') transforms.push({ fieldPath: fieldPath(path), setToServerValue: 'REQUEST_TIME' });
      else if (value.kind === 'increment') transforms.push({ fieldPath: fieldPath(path), increment: encodeValue(value.value) });
      else if (value.kind === 'arrayUnion') transforms.push({ fieldPath: fieldPath(path), appendMissingElements: { values: value.value.map(encodeValue) } });
      continue;
    }
    if (isPlainObject(value)) {
      const inner = extractSentinels(Object.entries(value).map(([k, v]) => [[k], v]), path);
      setIn(data, segments, inner.data);
      transforms.push(...inner.transforms);
      deletes.push(...inner.deletes);
      continue;
    }
    if (value !== undefined) setIn(data, segments, value);
  }
  return { data, transforms, deletes };
}

/** Rutas hoja de un objeto (para set con merge: los mapas se fusionan en profundidad). */
function leafPaths(obj, prefix = []) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const path = [...prefix, k];
    if (v instanceof Sentinel) {
      if (v.kind === 'delete') out.push(path);
    } else if (isPlainObject(v) && Object.keys(v).length) out.push(...leafPaths(v, path));
    else out.push(path);
  }
  return out;
}

// ---------- Transporte ----------

const ROOT = () => `projects/${projectId()}/databases/(default)/documents`;

function baseUrl() {
  const host = FIRESTORE_EMULATOR_HOST.value();
  return host ? `http://${host}/v1` : 'https://firestore.googleapis.com/v1';
}

export class FirestoreError extends Error {
  constructor(status, body) {
    super(`Firestore ${status}: ${body?.error?.message ?? JSON.stringify(body)}`);
    this.status = status;
    this.code = body?.error?.status ?? '';
  }
}

async function call(path, body, method = 'POST') {
  const token = FIRESTORE_EMULATOR_HOST.value() ? 'owner' : await accessToken();
  const res = await fetch(`${baseUrl()}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new FirestoreError(res.status, data);
  return data;
}

// ---------- Documentos y consultas ----------

const AUTO_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function autoId() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => AUTO_ID_CHARS[b % AUTO_ID_CHARS.length]).join('');
}

class DocumentSnapshot {
  constructor(ref, doc) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = !!doc;
    this._data = doc ? decodeFields(doc.fields ?? {}) : undefined;
  }
  data() { return this._data; }
  get(field) { return field.split('.').reduce((o, k) => o?.[k], this._data); }
}

class DocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split('/').at(-1);
  }
  get name() { return `${ROOT()}/${this.path}`; }
  collection(name) { return new CollectionReference(this.db, `${this.path}/${name}`); }
  async get() { return (await this.db.getAll(this))[0]; }
  set(data, options) { return this.db._commit([buildSet(this, data, options)]); }
  update(data) { return this.db._commit([buildUpdate(this, data)]); }
  delete() { return this.db._commit([{ delete: this.name }]); }
}

const OPS = {
  '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL', 'array-contains': 'ARRAY_CONTAINS', in: 'IN', 'not-in': 'NOT_IN',
  'array-contains-any': 'ARRAY_CONTAINS_ANY',
};

class Query {
  constructor(db, collectionPath, spec = { where: [], orderBy: [], limit: 0 }) {
    this.db = db;
    this.collectionPath = collectionPath;
    this.spec = spec;
  }
  where(field, op, value) {
    if (!OPS[op]) throw new Error(`Operador no admitido: ${op}`);
    return new Query(this.db, this.collectionPath, { ...this.spec, where: [...this.spec.where, { field, op, value }] });
  }
  orderBy(field, direction = 'asc') {
    return new Query(this.db, this.collectionPath, { ...this.spec, orderBy: [...this.spec.orderBy, { field, direction }] });
  }
  limit(n) { return new Query(this.db, this.collectionPath, { ...this.spec, limit: n }); }

  _structured() {
    const parts = this.collectionPath.split('/');
    const filters = this.spec.where.map(({ field, op, value }) => ({
      fieldFilter: { field: { fieldPath: fieldPath(field.split('.')) }, op: OPS[op], value: encodeValue(value) },
    }));
    const q = { from: [{ collectionId: parts.at(-1) }] };
    if (filters.length === 1) q.where = filters[0];
    if (filters.length > 1) q.where = { compositeFilter: { op: 'AND', filters } };
    if (this.spec.orderBy.length) {
      q.orderBy = this.spec.orderBy.map(({ field, direction }) => ({
        field: { fieldPath: fieldPath(field.split('.')) }, direction: direction === 'desc' ? 'DESCENDING' : 'ASCENDING',
      }));
    }
    if (this.spec.limit) q.limit = this.spec.limit;
    return { parent: parts.length > 1 ? `${ROOT()}/${parts.slice(0, -1).join('/')}` : ROOT(), structuredQuery: q };
  }

  async get(transaction) {
    const { parent, structuredQuery } = this._structured();
    const rows = await call(`${parent}:runQuery`, { structuredQuery, ...(transaction ? { transaction } : {}) });
    const docs = rows.filter((r) => r.document).map((r) => {
      const path = r.document.name.slice(ROOT().length + 1);
      return new DocumentSnapshot(new DocumentReference(this.db, path), r.document);
    });
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  count() {
    return {
      get: async () => {
        const { parent, structuredQuery } = this._structured();
        const rows = await call(`${parent}:runAggregationQuery`, {
          structuredAggregationQuery: { structuredQuery, aggregations: [{ alias: 'count', count: {} }] },
        });
        const count = Number(rows[0]?.result?.aggregateFields?.count?.integerValue ?? 0);
        return { data: () => ({ count }) };
      },
    };
  }
}

class CollectionReference extends Query {
  constructor(db, path) {
    super(db, path);
    this.path = path;
    this.id = path.split('/').at(-1);
  }
  doc(id = autoId()) { return new DocumentReference(this.db, `${this.path}/${id}`); }
}

// ---------- Escrituras ----------

function buildSet(ref, data, { merge = false } = {}) {
  const { data: fields, transforms, deletes } = extractSentinels(Object.entries(data).map(([k, v]) => [[k], v]));
  if (!merge && deletes.length) throw new Error('FieldValue.delete() solo se admite con merge o update');
  const write = { update: { name: ref.name, fields: encodeFields(fields) } };
  if (merge) write.updateMask = { fieldPaths: leafPaths(data).map(fieldPath) };
  if (transforms.length) write.updateTransforms = transforms;
  return write;
}

function buildUpdate(ref, data) {
  // En update las claves son rutas ("stripe.sessionId") y los mapas se sustituyen enteros.
  const entries = Object.entries(data).map(([k, v]) => [k.split('.'), v]);
  const { data: fields, transforms } = extractSentinels(entries);
  const mask = entries
    .filter(([, v]) => v !== undefined && (!(v instanceof Sentinel) || v.kind === 'delete'))
    .map(([segments]) => fieldPath(segments));
  const write = {
    update: { name: ref.name, fields: encodeFields(fields) },
    updateMask: { fieldPaths: mask },
    currentDocument: { exists: true },
  };
  if (transforms.length) write.updateTransforms = transforms;
  return write;
}

class Transaction {
  constructor(db, id) {
    this.db = db;
    this.id = id;
    this.writes = [];
  }
  async get(refOrQuery) {
    if (refOrQuery instanceof Query) return refOrQuery.get(this.id);
    return (await this.db.getAll(refOrQuery, { transaction: this.id }))[0];
  }
  getAll(...refs) { return this.db.getAll(...refs, { transaction: this.id }); }
  set(ref, data, options) { this.writes.push(buildSet(ref, data, options)); return this; }
  update(ref, data) { this.writes.push(buildUpdate(ref, data)); return this; }
  delete(ref) { this.writes.push({ delete: ref.name }); return this; }
}

const isContention = (err) => err instanceof FirestoreError && (err.status === 409 || err.code === 'ABORTED');

class Firestore {
  collection(path) { return new CollectionReference(this, path); }
  doc(path) { return new DocumentReference(this, path); }

  /** Lee varios documentos (en orden). El último argumento puede ser { transaction }. */
  async getAll(...args) {
    const opts = isPlainObject(args.at(-1)) ? args.pop() : {};
    if (!args.length) return [];
    const rows = await call(`${ROOT()}:batchGet`, {
      documents: args.map((r) => r.name),
      ...(opts.transaction ? { transaction: opts.transaction } : {}),
    });
    const byName = new Map(rows.map((r) => [r.found?.name ?? r.missing, r.found ?? null]));
    return args.map((ref) => new DocumentSnapshot(ref, byName.get(ref.name)));
  }

  _commit(writes, transaction) {
    return call(`${ROOT()}:commit`, { writes, ...(transaction ? { transaction } : {}) });
  }

  batch() {
    const writes = [];
    const b = {
      set: (ref, data, options) => { writes.push(buildSet(ref, data, options)); return b; },
      update: (ref, data) => { writes.push(buildUpdate(ref, data)); return b; },
      delete: (ref) => { writes.push({ delete: ref.name }); return b; },
      commit: () => (writes.length ? this._commit(writes) : Promise.resolve()),
    };
    return b;
  }

  /**
   * Transacción con reintentos. Como en firebase-admin, si dos transacciones tocan los mismos
   * documentos, Firestore aborta una y se vuelve a ejecutar con los datos nuevos.
   */
  async runTransaction(fn, { maxAttempts = 5 } = {}) {
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { transaction } = await call(`${ROOT()}:beginTransaction`, {
        options: { readWrite: {} },
      });
      const tx = new Transaction(this, transaction);
      let committed = false;
      try {
        const result = await fn(tx);
        await this._commit(tx.writes, transaction);
        committed = true;
        return result;
      } catch (err) {
        if (!committed) await call(`${ROOT()}:rollback`, { transaction }).catch(() => {});
        if (!isContention(err)) throw err;
        lastError = err;
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt + Math.random() * 50));
      }
    }
    throw lastError;
  }
}

export const db = new Firestore();
