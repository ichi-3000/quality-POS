const DB_NAME = 'qsims-browser-db';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'main';
const CHANNEL_NAME = 'qsims-db-sync';

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

export async function loadDbSnapshot(): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined') return null;
  let db: IDBDatabase | null = null;
  try {
    db = await openStore();
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SNAPSHOT_KEY);
      req.onsuccess = () => {
        const val = req.result;
        if (!val) {
          resolve(null);
        } else if (val instanceof Uint8Array) {
          resolve(val);
        } else if (val instanceof ArrayBuffer) {
          resolve(new Uint8Array(val));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error || new Error('Failed to read database snapshot'));
    });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function saveDbSnapshot(bytes: Uint8Array): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(new Uint8Array(bytes), SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to save database snapshot'));
    });
  } finally {
    db.close();
  }
}

export async function clearDbSnapshot(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to clear database snapshot'));
    });
  } finally {
    db.close();
  }
}

let syncChannel: BroadcastChannel | null = null;
const tabId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export function subscribeDbSync(onExternalUpdate: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') {
    return () => {};
  }
  if (!syncChannel) {
    syncChannel = new BroadcastChannel(CHANNEL_NAME);
  }
  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; senderId?: string } | null;
    if (data?.type === 'db_updated' && data.senderId !== tabId) {
      onExternalUpdate();
    }
  };
  syncChannel.addEventListener('message', handler);
  return () => {
    syncChannel?.removeEventListener('message', handler);
  };
}

export function broadcastDbUpdate(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  if (!syncChannel) {
    syncChannel = new BroadcastChannel(CHANNEL_NAME);
  }
  syncChannel.postMessage({ type: 'db_updated', senderId: tabId });
}
