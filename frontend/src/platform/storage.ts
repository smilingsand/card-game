import type { StorageBoundary } from "@card-game/guandan-core";

export type { StorageBoundary } from "@card-game/guandan-core";

export class StorageUnavailableError extends Error {
  constructor() {
    super("IndexedDB is unavailable in this runtime");
    this.name = "StorageUnavailableError";
  }
}

function requestResult<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function database(name: string, storeName: string): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new StorageUnavailableError());
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** IndexedDB 在调用时才访问，故 SSR/测试可注入其他边界。 */
export function createIndexedDbStorage<Value>(options: {
  readonly databaseName: string;
  readonly storeName: string;
  readonly key: IDBValidKey;
}): StorageBoundary<Value> {
  const withStore = async <Result>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<Result>
  ): Promise<Result> => {
    const db = await database(options.databaseName, options.storeName);
    try {
      const transaction = db.transaction(options.storeName, mode);
      const result = await operation(transaction.objectStore(options.storeName));
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return result;
    } finally {
      db.close();
    }
  };
  return {
    async load() {
      return withStore("readonly", async (store) => requestResult(store.get(options.key)));
    },
    async save(value) {
      await withStore("readwrite", async (store) => requestResult(store.put(value, options.key)));
    },
    async clear() {
      await withStore("readwrite", async (store) => requestResult(store.delete(options.key)));
    }
  };
}
