const owners = new WeakMap();
function closed(message) { return Object.assign(new Error(message), { code: "E_STORAGE_RUNTIME_CLOSED" }); }

/** Register lazy ownership without importing a SQLite implementation. */
export function attachStorageConnectionOwner(context) {
  let owner;
  let loading;
  let closing = false;
  let closePromise;
  const pending = new Set();
  const getOwner = () => loading ??= import("../storage/connection-owner.js").then(module => {
    owner = module.createStorageConnectionOwner();
    return owner;
  });
  const proxy = {
    run(target, callback, options) {
      if (closing) return Promise.reject(closed("Persistent storage runtime is closing or closed"));
      const request = getOwner().then(value => value.run(target, callback, options));
      pending.add(request);
      const finished = () => { pending.delete(request); };
      request.then(finished, finished);
      return request;
    },
    close() {
      if (owner?.isActive()) return Promise.reject(closed("Close the runtime outside an active command"));
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await Promise.all([...pending].map(request => request.catch(() => undefined)));
        if (loading) await (await loading).close();
      })();
      return closePromise;
    },
  };
  owners.set(context, proxy);
  return proxy.close;
}

export function getStorageConnectionOwner(context) {
  return context && typeof context === "object" ? owners.get(context) ?? null : null;
}
