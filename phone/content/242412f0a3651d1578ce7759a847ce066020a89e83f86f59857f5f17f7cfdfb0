/** Browser API used by the compact PWA install screen. Cache state belongs to
 * this origin's ServiceWorker; no Node endpoint, Mac save or admin is queried.
 */
export function createOfflineCache({ serviceWorkerUrl = "/wzzb-offline/sw.js?v=20261027-playability1", scope = "/wzzb-offline/", navigator = globalThis.navigator } = {}) {
  let registrationPromise, sequence = 0;
  async function register() {
    if (!navigator?.serviceWorker) throw new Error('此浏览器不支持离线安装，请使用HTTPS地址在Safari中打开。');
    if (!registrationPromise) registrationPromise = (async () => {
      // Reopening an installed app must not wait for a vanished deployment or
      // a failed script-update request. Existing active workers work offline.
      let registration = await navigator.serviceWorker.getRegistration(scope);
      const baseUrl = globalThis.location?.href || 'https://phone.invalid/';
      const expectedScope = new URL(scope, baseUrl).href, expectedScript = new URL(serviceWorkerUrl, baseUrl).href;
      if (registration?.scope && registration.scope !== expectedScope) registration = null;
      if (registration?.active && (!registration.active.scriptURL || registration.active.scriptURL === expectedScript)) {
        if (navigator.onLine !== false) registration.update?.().catch(() => {});
        return registration;
      }
      try { registration = await navigator.serviceWorker.register(serviceWorkerUrl, { scope, updateViaCache: 'none' }); }
      catch (error) { registration = await navigator.serviceWorker.getRegistration(scope); if (!registration) throw error; }
      const candidate = registration.installing || registration.waiting;
      if (candidate && candidate.state !== 'activated') await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('离线服务更新超时，请保持联网后重新打开本页。')); }, 15000);
        const cleanup = () => { clearTimeout(timer); candidate.removeEventListener('statechange', changed); };
        const changed = () => { if (candidate.state === 'activated') { cleanup(); resolve(); } else if (candidate.state === 'redundant') { cleanup(); reject(new Error('离线服务未能更新，请重试。')); } };
        candidate.addEventListener('statechange', changed); changed();
      });
      if (!registration.active) registration = await navigator.serviceWorker.ready;
      return registration;
    })().catch(error => { registrationPromise = null; throw error; });
    return registrationPromise;
  }
  async function command(type, { onProgress } = {}) {
    const registration = await register(), worker = registration.active;
    if (!worker) throw new Error('离线服务尚未启动，请重试。');
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel(); let timer;
      const cleanup = () => { clearTimeout(timer); channel.port1.close(); };
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => { cleanup(); reject(new Error('离线准备已中断；保持页面前台并重试即可续传。')); }, 180000); };
      channel.port1.onmessage = event => {
        arm(); const message = event.data;
        if (message?.type === 'OFFLINE_PROGRESS') { onProgress?.(message.snapshot); return; }
        if (message?.type !== 'OFFLINE_RESULT') return;
        cleanup(); onProgress?.(message.snapshot);
        if (message.ok) resolve(message.snapshot);
        else { const error = new Error(message.snapshot?.error || '离线准备失败，请重试。'); error.snapshot = message.snapshot; reject(error); }
      };
      arm();
      try { worker.postMessage({ type, requestId: ++sequence }, [channel.port2]); }
      catch (error) { cleanup(); reject(error); }
    });
  }
  return {
    register,
    inspect: options => command('INSPECT_OFFLINE', options),
    async prepare(options = {}) {
      // A browser may decline persistence. Integrity/ready status does not
      // depend on that grant; UI may display the returned persistence result.
      let persistent = false;
      try { persistent = Boolean(await navigator.storage?.persist?.()); } catch {}
      const result = await command('PREPARE_OFFLINE', options); return { ...result, persistent };
    },
    pause: () => command('PAUSE_OFFLINE'),
  };
}
