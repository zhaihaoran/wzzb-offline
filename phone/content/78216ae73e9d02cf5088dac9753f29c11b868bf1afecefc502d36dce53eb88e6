let singleton;

/** One simulator worker per window. All messages and durable writes are queued
 * by that worker; the original client never connects to a network game server.
 */
export function createPhoneTransport({ WorkerClass = globalThis.Worker, timeout = 60000 } = {}) {
  if (singleton) return singleton;
  const worker = new WorkerClass('/phone/simulator-worker.js', { type: 'module', name: 'wangzhe-offline-simulator' });
  const pending = new Map(), observers = new Set();
  let nextId = 0, closed = false, fatal = null;
  const broadcast = event => { for (const fn of observers) { try { fn(event); } catch (error) { console.error(error); } } };
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(data.id);
    if (data.ok === false) {
      const error = Object.assign(new Error(data.error?.message || data.error || '手机模拟服务处理失败。'), { code: data.error?.code });
      broadcast({ kind: 'error', error }); item.reject(error); return;
    }
    for (const event of data.events || []) broadcast({ kind: 'socket', ...event });
    broadcast({ kind: 'saved', revision: data.revision });
    item.resolve(data.result);
  };
  worker.onerror = event => {
    fatal = new Error(event.message || '手机模拟服务未能启动，请重新打开游戏。');
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(fatal); }
    pending.clear(); broadcast({ kind: 'error', error: fatal });
  };
  function request(op, fields = {}) {
    if (closed || fatal) return Promise.reject(fatal || new Error('手机模拟服务已关闭。'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id); reject(new Error('手机处理超时，请重新打开游戏检查存档状态。'));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ ...fields, id, op }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  singleton = {
    request,
    status: () => request('status'),
    export: () => request('export'),
    import: save => request('import', { save }),
    subscribe(fn) { observers.add(fn); return () => observers.delete(fn); },
    close() {
      if (closed) return;
      closed = true; worker.terminate();
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('手机模拟服务已关闭。')); }
      pending.clear(); observers.clear(); singleton = undefined;
    },
  };
  return singleton;
}
