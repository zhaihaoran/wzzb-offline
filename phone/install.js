const MB = 1000 * 1000;
export const MAX_SAVE_BYTES = 25 * MB;
export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes >= 1000 * MB) return `${(bytes / (1000 * MB)).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${bytes} B`;
}
export function verifiedComplete(snapshot) {
  return snapshot?.complete === true && Number(snapshot.totalFiles) > 0 && Number(snapshot.totalBytes) > 0 &&
    Number(snapshot.downloadedFiles) >= Number(snapshot.totalFiles) && Number(snapshot.downloadedBytes) >= Number(snapshot.totalBytes);
}

/** Dependency injection keeps DOM behavior testable without a server, worker,
 * filesystem, or any access to the desktop save. All game data is opaque here. */
export async function bootPhoneInstaller({ document: doc = globalThis.document, window: host = globalThis.window, navigator: browser = globalThis.navigator, cache, transport } = {}) {
  const byId = id => { const element = doc.getElementById(id); if (!element) throw new Error(`Missing installer element: ${id}`); return element; };
  const ui = Object.fromEntries(['ready-badge', 'cache-message', 'total-size', 'downloaded-size', 'download-progress', 'file-progress', 'network-status', 'version-status', 'cache-error', 'failed-files', 'prepare-button', 'pause-button', 'enter-button', 'reload-button', 'standalone-status', 'context-message', 'storage-status', 'storage-space', 'export-button', 'choose-import-button', 'save-download-link', 'import-file', 'import-review', 'import-file-info', 'confirm-import-button', 'cancel-import-button', 'save-message', 'save-error'].map(id => [id, byId(id)]));
  const state = { snapshot: null, cacheBusy: false, saveBusy: false, pauseRequested: false, pendingImport: null, transport: null, cache: null, supported: false, disposed: false, lastCacheMessage: '', exportUrl: null };
  const removers = [];
  function listen(target, type, handler) { target?.addEventListener?.(type, handler); removers.push(() => target?.removeEventListener?.(type, handler)); }
  const text = (id, value) => { ui[id].textContent = value; };
  const showError = (id, message) => { text(id, message || ''); ui[id].hidden = !message; };
  const errorText = error => String(error?.message || error || '发生未知错误');
  const online = () => browser.onLine !== false;
  const controlsPage = () => Boolean(browser.serviceWorker?.controller);
  const secure = () => host.isSecureContext !== false && (host.location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(host.location.hostname));
  function render() {
    if (state.disposed) return;
    const snapshot = state.snapshot, complete = verifiedComplete(snapshot), controlled = controlsPage();
    const enter = complete && controlled && !state.cacheBusy && state.supported;
    text('network-status', online() ? '网络已连接' : '当前离线');
    text('total-size', Number(snapshot?.totalBytes) > 0 ? formatBytes(snapshot.totalBytes) : '正在统计');
    text('downloaded-size', snapshot ? formatBytes(snapshot.downloadedBytes || 0) : '—');
    const percent = Number(snapshot?.totalBytes) > 0 ? Math.min(100, Math.max(0, 100 * Number(snapshot.downloadedBytes || 0) / Number(snapshot.totalBytes))) : 0;
    ui['download-progress'].value = percent;
    ui['download-progress'].setAttribute('aria-valuetext', `${percent.toFixed(1)}% 已验证`);
    text('file-progress', snapshot ? `${Number(snapshot.downloadedFiles) || 0} / ${Number(snapshot.totalFiles) || 0} 个文件已验证` : '正在检查缓存');
    let badge = '尚未就绪', badgeState = 'pending';
    if (enter) { badge = '可离线'; badgeState = 'ready'; }
    else if (complete && !controlled) badge = '需启用离线服务';
    else if (state.cacheBusy) { badge = state.pauseRequested ? '正在暂停' : '正在准备'; badgeState = 'busy'; }
    else if (snapshot?.phase === 'paused') badge = '已暂停';
    else if (snapshot?.error) { badge = '尚未完成'; badgeState = 'error'; }
    text('ready-badge', badge); ui['ready-badge'].dataset.state = badgeState;
    ui['enter-button'].disabled = !enter;
    ui['prepare-button'].disabled = !state.supported || state.cacheBusy || !online() || !state.cache;
    text('prepare-button', complete ? '检查离线资源' : Number(snapshot?.downloadedFiles) > 0 ? '继续准备离线资源' : '准备离线资源');
    ui['pause-button'].hidden = !state.cacheBusy; ui['pause-button'].disabled = state.pauseRequested;
    ui['reload-button'].hidden = !complete || controlled || state.cacheBusy;
    let message = state.lastCacheMessage;
    if (enter) message = '当前入口的资源已完整缓存，离线服务已启用，可以进入游戏。主屏幕入口请再次确认相同状态。';
    else if (complete && !controlled && !state.cacheBusy) message = '资源已完整缓存。请刷新本页，让离线服务接管页面后再进入游戏。';
    else if (!online() && !complete && !state.cacheBusy) message = '当前离线，资源尚未准备完整。连接网络后可从已验证的文件继续下载。';
    text('cache-message', message || '资源尚未准备完整，请保持联网并点击“准备离线资源”。');
    const version = String(snapshot?.version || '');
    text('version-status', version ? `资源版本 ${version.slice(0, 16)}${version.length > 16 ? '…' : ''}${snapshot?.previousComplete && !complete ? ' · 旧版完整缓存仍保留，本次更新尚未完成' : ''}` : '');
    const failed = Array.isArray(snapshot?.failedFiles) ? snapshot.failedFiles : [];
    ui['failed-files'].replaceChildren();
    for (const item of failed.slice(0, 5)) { const li = doc.createElement('li'); li.textContent = typeof item === 'string' ? item : String(item.url || item.path || item.error || '资源校验失败'); ui['failed-files'].append(li); }
    if (failed.length > 5) { const li = doc.createElement('li'); li.textContent = `另有 ${failed.length - 5} 个文件未完成，可继续重试。`; ui['failed-files'].append(li); }
    ui['failed-files'].hidden = failed.length === 0;
    ui['export-button'].disabled = !state.transport || state.saveBusy;
    ui['choose-import-button'].disabled = !state.transport || state.saveBusy;
    ui['confirm-import-button'].disabled = !state.pendingImport || state.saveBusy;
    ui['cancel-import-button'].disabled = state.saveBusy;
    ui['import-review'].hidden = !state.pendingImport;
  }
  function updateSnapshot(snapshot) {
    if (!snapshot || state.disposed) return;
    state.snapshot = snapshot;
    if (snapshot.error) showError('cache-error', `准备未完成：${errorText(snapshot.error)}。已验证资源会保留，可以继续重试。`);
    render();
  }
  async function storageInfo(requestPersistence = false) {
    const storage = browser.storage;
    if (!storage) { text('storage-status', '浏览器未提供持久存储状态。请定期导出手机存档。'); return; }
    try {
      const persistent = requestPersistence && typeof storage.persist === 'function' ? await storage.persist() : typeof storage.persisted === 'function' ? await storage.persisted() : null;
      text('storage-status', persistent === true ? '已获得持久存储许可；仍建议定期导出存档备份。' : persistent === false ? '未获得持久存储许可。系统可能清理浏览器数据，请保留导出的存档备份。' : '此浏览器不提供持久存储许可结果，请定期导出存档。');
    } catch { text('storage-status', '未能确认持久存储许可，请定期导出存档。'); }
    try { const estimate = await storage.estimate?.(); if (estimate && Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)) text('storage-space', `本站已用约 ${formatBytes(estimate.usage)}，浏览器可用空间约 ${formatBytes(Math.max(0, estimate.quota - estimate.usage))}。`); }
    catch { text('storage-space', '浏览器未能提供可用空间估算。'); }
  }
  async function refresh() {
    if (!state.cache || state.cacheBusy) return;
    showError('cache-error', ''); state.lastCacheMessage = '正在核对离线资源完整性…'; render();
    try { updateSnapshot(await state.cache.inspect()); state.lastCacheMessage = verifiedComplete(state.snapshot) ? '' : '资源尚未准备完整，请点击按钮下载；已验证的文件可继续使用。'; }
    catch (error) { state.lastCacheMessage = '未能读取完整的离线资源状态。保持联网后重试。'; showError('cache-error', errorText(error)); }
    render();
  }
  async function prepare() {
    if (!state.supported || !state.cache || state.cacheBusy || !online()) return;
    state.cacheBusy = true; state.pauseRequested = false; state.lastCacheMessage = '正在下载并逐个校验资源，请保持此页打开。中断后可继续。'; showError('cache-error', ''); render();
    await storageInfo(true);
    try {
      const snapshot = await state.cache.prepare({ onProgress: updateSnapshot }); updateSnapshot(snapshot);
      state.lastCacheMessage = state.pauseRequested || snapshot?.phase === 'paused' ? '下载已暂停，已验证的文件会保留。联网时可继续准备。' : verifiedComplete(snapshot) ? '' : '资源尚未准备完整。已验证的文件会保留，请继续重试。';
    } catch (error) {
      if (error?.snapshot) updateSnapshot(error.snapshot);
      state.lastCacheMessage = state.pauseRequested ? '下载已暂停，已验证的文件会保留，可稍后继续。' : '下载或校验未完成，当前还不能离线进入游戏。';
      if (!state.pauseRequested) showError('cache-error', `${errorText(error)}。请保持联网后继续重试。`);
    } finally { state.cacheBusy = false; state.pauseRequested = false; render(); }
  }
  async function pause() {
    if (!state.cacheBusy || state.pauseRequested) return;
    state.pauseRequested = true; render();
    try { const snapshot = await state.cache.pause(); if (snapshot && typeof snapshot === 'object') updateSnapshot(snapshot); }
    catch (error) { showError('cache-error', `暂停请求未完成：${errorText(error)}`); state.pauseRequested = false; render(); }
  }
  async function transportCall(method, fields = {}) {
    const service = state.transport;
    if (!service) throw new Error('手机存档服务尚未就绪，请保持联网后刷新重试');
    if (typeof service[method] === 'function') return method === 'import' ? service[method](fields.save) : service[method]();
    if (typeof service.request !== 'function') throw new Error('手机存档服务接口不可用');
    return service.request(method, fields);
  }
  async function exportSave() {
    if (!state.transport || state.saveBusy) return;
    state.saveBusy = true; showError('save-error', ''); render();
    try {
      const save = await transportCall('export');
      if (!save || typeof save !== 'object') throw new Error('手机存档服务未返回有效存档');
      const blob = new host.Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
      if (state.exportUrl) host.URL.revokeObjectURL(state.exportUrl);
      const url = state.exportUrl = host.URL.createObjectURL(blob), link = ui['save-download-link'];
      link.href = url; link.download = `王者争霸-手机存档-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      link.hidden = false; link.click();
      text('save-message', '已生成导出文件。若未自动下载，请点“保存导出的存档文件”，并确认已保存到“文件”或通过分享菜单备份。');
    } catch (error) { showError('save-error', `导出未完成：${errorText(error)}`); }
    finally { state.saveBusy = false; render(); }
  }
  async function chooseImport(file) {
    state.pendingImport = null; showError('save-error', ''); render();
    if (!file) return;
    try {
      if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_SAVE_BYTES) throw new Error('请选择非空且不超过25 MB的手机存档 JSON 文件');
      const save = JSON.parse(await file.text());
      if (!save || typeof save !== 'object' || Array.isArray(save)) throw new Error('存档内容应为手机导出的 JSON 对象');
      state.pendingImport = { save, name: file.name, bytes: file.size };
      text('import-file-info', `已选择：${file.name}（${formatBytes(file.size)}）`);
      text('save-message', '存档尚未导入。核对文件后，点击“导入这个存档”确认替换。');
    } catch (error) { showError('save-error', `未选择有效存档：${errorText(error)}`); }
    render();
  }
  async function confirmImport() {
    if (!state.pendingImport || state.saveBusy || !state.transport) return;
    state.saveBusy = true; showError('save-error', ''); render();
    try {
      await transportCall('import', { save: state.pendingImport.save });
      state.pendingImport = null; ui['import-file'].value = '';
      text('save-message', '存档已导入本设备。进入游戏，或重新打开游戏以使用导入的进度。');
    } catch (error) { showError('save-error', `导入未完成：${errorText(error)}。请重新选择兼容的手机备份文件。`); }
    finally { state.saveBusy = false; render(); }
  }
  listen(ui['prepare-button'], 'click', prepare); listen(ui['pause-button'], 'click', pause);
  listen(ui['enter-button'], 'click', () => { if (!ui['enter-button'].disabled) host.location.assign("/wzzb-offline/game.html"); });
  listen(ui['reload-button'], 'click', () => host.location.reload());
  listen(ui['export-button'], 'click', exportSave); listen(ui['choose-import-button'], 'click', () => ui['import-file'].click());
  listen(ui['import-file'], 'change', () => chooseImport(ui['import-file'].files?.[0]));
  listen(ui['confirm-import-button'], 'click', confirmImport);
  listen(ui['cancel-import-button'], 'click', () => { state.pendingImport = null; ui['import-file'].value = ''; text('save-message', '已取消导入，未替换手机存档。'); render(); });
  listen(browser.serviceWorker, 'controllerchange', render); listen(host, 'online', render); listen(host, 'offline', render);
  const standalone = browser.standalone === true || host.matchMedia?.('(display-mode: standalone)').matches;
  text('standalone-status', standalone ? '当前已从主屏幕打开。资源显示“可离线”后，可用飞行模式自行验证启动。' : '当前在浏览器中。添加后请从主屏幕联网打开，再确认同一入口显示“可离线”；需要迁移进度时，请先导出再导入。');
  state.supported = Boolean(browser.serviceWorker && secure());
  text('context-message', secure() ? '首次准备需保持联网；请在之后实际使用的主屏幕入口中完成资源准备和存档导入。' : '此地址不具备离线安装所需的安全连接。请在 iPhone Safari 打开提供的 HTTPS 地址。');
  if (!state.supported) { state.lastCacheMessage = '当前浏览器或连接不支持此离线安装方式，请使用 iPhone Safari 的 HTTPS 页面。'; showError('cache-error', '离线服务尚未启用，当前不能标记为可离线。'); }
  render();
  await Promise.allSettled([
    (async () => { if (!state.supported) return; try { state.cache = cache || (await import('./offline-cache.js')).createOfflineCache(); await refresh(); } catch (error) { showError('cache-error', `资源准备服务尚未就绪：${errorText(error)}`); render(); } })(),
    (async () => { try { state.transport = await (transport || (await import('./transport.js')).createPhoneTransport()); const info = await transportCall('status'); text('save-message', Number.isFinite(info?.revision) ? `手机存档服务已就绪 · 版本 ${info.revision}。` : '手机存档服务已就绪，可以导入或导出本机进度。'); } catch (error) { state.transport = null; text('save-message', '手机存档服务尚未就绪。'); showError('save-error', errorText(error)); } render(); })(),
    storageInfo(),
  ]);
  return { prepare, pause, refresh, exportSave, chooseImport, confirmImport, get state() { return state; }, destroy() { state.disposed = true; for (const remove of removers) remove(); if (state.exportUrl) host.URL.revokeObjectURL(state.exportUrl); } };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') bootPhoneInstaller().then(controller => { window.__PHONE_INSTALLER__ = controller; }).catch(error => { const node = document.getElementById('cache-error'); if (node) { node.hidden = false; node.textContent = `安装准备页未能启动：${String(error?.message || error)}`; } });
