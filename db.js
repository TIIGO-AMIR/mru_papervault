// Offline storage in the browser (IndexedDB). Files are stored as Blobs.
(function () {
  const DB_NAME = "papervault";
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          const files = db.createObjectStore("files", { keyPath: "id" });
          files.createIndex("owner", "owner");
          db.createObjectStore("papers", { keyPath: "id" });
          db.createObjectStore("downloads", { keyPath: "id" });
          db.createObjectStore("queue", { keyPath: "fileId" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function run(store, mode, action) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  window.PVDB = {
    put: (store, value) => run(store, "readwrite", (s) => s.put(value)),
    get: (store, key) => run(store, "readonly", (s) => s.get(key)),
    del: (store, key) => run(store, "readwrite", (s) => s.delete(key)),
    getAll: (store) => run(store, "readonly", (s) => s.getAll()),
    getByOwner: (store, owner) => run(store, "readonly", (s) => s.index("owner").getAll(owner)),
    clear: (store) => run(store, "readwrite", (s) => s.clear())
  };
})();
