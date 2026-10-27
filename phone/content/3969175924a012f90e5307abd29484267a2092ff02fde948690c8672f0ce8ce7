/* Offline release cache. Immutable bodies are stored ONCE by SHA, not by each
 * Cocos/CDN/legacy alias. A single metadata write commits a verified release;
 * failed/interrupted updates never replace the previous ready manifest.
 */
(() => {
  'use strict';
  // Project Pages are mounted below /repository/. Keep their cache and routes
  // separate from other apps (and the owner's existing site) on that origin.
  const base = (self.location.pathname || '/sw.js').replace(/\/sw\.js$/, '').replace(/\/$/, '');
  const CONTENT = 'wzzb-phone-content-v1' + base, META = 'wzzb-phone-meta-v1' + base;
  const MANIFEST_PATH = '/phone/assets-manifest.json', ACTIVE = '/__phone_cache__/active';
  const origin = self.location.origin;
  let activePromise, running = null, manifestPromise;
  const manifestListeners = new Set();
  const absolute = pathname => new URL(base + pathname, origin).href;
  const forbidden = pathname => /^\/(?:api(?:\/|$)|admin(?:\/|$)|health(?:\/|$)|local\/(?:data(?:\/|$)|admin[^/]*$))/.test(pathname);
  const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  function downloadUrl(file) {
    if (!file.downloadUrl) return absolute(file.url);
    const url = new URL(file.downloadUrl);
    const staticPath = /^\/(?:game_client\/v1\/remote\/|config_files\/v\d+\.bin$|hd\/[^/]+\.(?:png|jpg|webp|json)$|(?:card_model|card_res|common_effs|sounds|map_assets|player_res|hero_soul_res|npc_res_res|static_ani_res|pet_model|role_title|sign|gift|hd)\/v\d+\/)/;
    if (url.origin !== 'https://rzry-cn-cdn.4kwan.com' || url.username || url.password || url.search || url.hash || !staticPath.test(url.pathname)) throw new Error('离线下载源不是允许的静态资源。');
    return url.href;
  }
  function pathnameOf(input) {
    const url = new URL(input, origin);
    let pathname = decodeURIComponent(url.pathname);
    if (url.origin === origin && base && pathname.startsWith(base + '/')) pathname = pathname.slice(base.length);
    if (pathname.includes('\\') || pathname.split('/').includes('..') || forbidden(pathname)) return null;
    return { url, pathname };
  }
  function validateManifest(manifest) {
    if (manifest?.schema === 2) {
      const compact = manifest;
      if (!Array.isArray(compact.types) || !Array.isArray(compact.files) || compact.files.length > 20000) throw new Error('精简资源清单无效。');
      const files = compact.files.map(([sha256, bytes, type, downloadUrl]) => ({ url: '/phone/content/' + sha256, sha256, bytes, contentType: compact.types[type], ...(downloadUrl ? { downloadUrl } : {}) }));
      const routeContentTypes = {}, expand = groups => {
        const routes = Object.create(null);
        for (const [prefix, rows] of Object.entries(groups || {})) for (const [tail, index, type] of rows) {
          if (!Number.isSafeInteger(index) || !files[index] || typeof tail !== 'string') throw new Error('精简资源路由无效。');
          const route = prefix + tail; routes[route] = files[index].url;
          if (type) routeContentTypes[route] = type;
        }
        return routes;
      };
      manifest = { schema: 1, version: compact.version, totalBytes: compact.totalBytes, files, routes: expand(compact.routes), legacyRoutes: expand(compact.legacyRoutes), routeContentTypes, excluded: compact.excluded };
    }
    if (manifest?.schema !== 1 || !/^[a-f0-9]{64}$/.test(manifest.version || '') || !Array.isArray(manifest.files) || !manifest.routes) throw new Error('离线资源清单无效。');
    const seen = new Set(); let total = 0;
    for (const file of manifest.files) {
      if (!/^[a-f0-9]{64}$/.test(file.sha256 || '') || file.url !== '/phone/content/' + file.sha256 || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || seen.has(file.url)) throw new Error('离线文件校验信息无效。');
      downloadUrl(file);
      seen.add(file.url); total += file.bytes;
    }
    if (total !== manifest.totalBytes) throw new Error('离线资源总大小不匹配。');
    for (const [route, canonical] of [...Object.entries(manifest.routes), ...Object.entries(manifest.legacyRoutes || {})]) {
      const parsed = pathnameOf(route);
      if (!parsed || !seen.has(canonical) || (!route.startsWith('/') && !/^https?:\/\/rzry-cn-cdn\.4kwan\.com\//.test(route))) throw new Error('离线资源路由无效。');
    }
    return manifest;
  }
  async function activeManifest() {
    if (!activePromise) activePromise = (async () => {
      const cache = await caches.open(META), saved = await cache.match(absolute(ACTIVE));
      if (!saved) return null;
      try { return validateManifest(await saved.json()); } catch { return null; }
    })();
    return activePromise;
  }
  async function metadataBytes(url, run) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (run?.paused) throw new Error('资源准备已暂停。');
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      run?.controllers.add(controller);
      try {
        const response = await fetch(absolute(url), { cache: 'no-cache', credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error('资源清单读取失败：HTTP ' + response.status);
        return await response.arrayBuffer();
      } catch (error) { lastError = error; }
      finally { clearTimeout(timeout); run?.controllers.delete(controller); }
    }
    throw new Error('资源清单连接超时或下载失败，请重试；已下载的游戏资源和存档会保留。' + (lastError?.message ? '（' + lastError.message + '）' : ''));
  }
  async function readWire(index, progress, run) {
    if (!/^[a-f0-9]{64}$/.test(index.version || '') || !/^[a-f0-9]{64}$/.test(index.payloadSha256 || '') || !Number.isSafeInteger(index.payloadBytes) || index.payloadBytes <= 0 || index.payloadBytes > 32 * 1024 * 1024 || !Array.isArray(index.chunks) || !index.chunks.length || index.chunks.length > 512) throw new Error('资源清单索引无效。');
    let sum = 0;
    for (const [hash, bytes] of index.chunks) { if (!/^[a-f0-9]{64}$/.test(hash || '') || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 128 * 1024) throw new Error('资源清单分段无效。'); sum += bytes; }
    if (sum !== index.payloadBytes) throw new Error('资源清单分段大小不匹配。');
    const bodies = new Array(index.chunks.length); let next = 0, completed = 0;
    progress?.({ totalFiles: index.totalFiles, totalBytes: index.totalBytes, manifestParts: index.chunks.length, manifestPartsLoaded: completed });
    await Promise.all(Array.from({ length: Math.min(4, bodies.length) }, async () => {
      while (next < bodies.length) {
        const i = next++, [hash, bytes] = index.chunks[i];
        const body = await metadataBytes('/phone/manifest-chunks/' + index.version + '/' + hash + '.bin', run);
        if (body.byteLength !== bytes || await sha256(body) !== hash) throw new Error('资源清单分段校验失败，请重试。');
        bodies[i] = new Uint8Array(body); completed++;
        progress?.({ totalFiles: index.totalFiles, totalBytes: index.totalBytes, manifestParts: index.chunks.length, manifestPartsLoaded: completed });
      }
    }));
    const all = new Uint8Array(sum); let offset = 0;
    for (const body of bodies) { all.set(body, offset); offset += body.length; }
    if (await sha256(all) !== index.payloadSha256) throw new Error('资源清单完整性校验失败。');
    return JSON.parse(new TextDecoder().decode(all));
  }
  async function loadManifest(progress, run) {
    if (progress) manifestListeners.add(progress);
    if (!manifestPromise) manifestPromise = readManifest(values => { for (const listener of manifestListeners) listener(values); }, run).finally(() => { manifestPromise = null; });
    try { return await manifestPromise; }
    finally { if (progress) manifestListeners.delete(progress); }
  }
  async function readManifest(progress, run) {
    try {
      let manifest = JSON.parse(new TextDecoder().decode(await metadataBytes(MANIFEST_PATH, run)));
      if (manifest.wireVersion === 1) manifest = await readWire(manifest, progress, run);
      return validateManifest(manifest);
    } catch (error) {
      const active = await activeManifest();
      if (active) return active;
      throw error;
    }
  }
  async function sha256(buffer) {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function validHeaders(response, file) {
    return response?.status === 200 && response.headers.get('X-Phone-SHA256') === file.sha256 && Number(response.headers.get('Content-Length')) === file.bytes;
  }
  async function cachedStats(manifest, verify = false, progress) {
    const cache = await caches.open(CONTENT); let downloadedFiles = 0, downloadedBytes = 0;
    const keys = cache.keys ? new Set((await cache.keys()).map(key => key.url)) : null;
    const candidates = keys ? manifest.files.filter(file => keys.has(absolute(file.url))) : manifest.files;
    let next = 0, checked = 0;
    await Promise.all(Array.from({ length: Math.min(12, candidates.length) }, async () => {
      while (next < candidates.length) {
        const file = candidates[next++], response = await cache.match(absolute(file.url));
        let valid = validHeaders(response, file);
        if (verify && valid) { const body = await response.arrayBuffer(); valid = body.byteLength === file.bytes && await sha256(body) === file.sha256; }
        if (valid) { downloadedFiles++; downloadedBytes += file.bytes; }
        checked++; if (checked % 64 === 0 || checked === candidates.length) progress?.({ cacheCheckedFiles: checked, cacheFilesToCheck: candidates.length });
      }
    }));
    return { downloadedFiles, downloadedBytes };
  }
  function snapshot(manifest, stats, extras = {}) {
    return { version: manifest?.version || null, complete: false, totalFiles: manifest?.files.length || 0, totalBytes: manifest?.totalBytes || 0, downloadedFiles: stats?.downloadedFiles || 0, downloadedBytes: stats?.downloadedBytes || 0, phase: 'idle', ...extras };
  }
  async function inspect(progress) {
    if (running) return { ...running.snapshot };
    const manifest = await loadManifest(values => progress?.(snapshot(null, null, { phase: 'loading-manifest', ...values }))), stats = await cachedStats(manifest, false, values => progress?.(snapshot(manifest, null, { phase: 'checking-cache', ...values }))), active = await activeManifest();
    const complete = active?.version === manifest.version && stats.downloadedFiles === manifest.files.length;
    return snapshot(manifest, stats, { complete, phase: complete ? 'ready' : 'idle', previousVersion: active?.version || null, previousComplete: Boolean(active && (active.version === manifest.version ? complete : (await cachedStats(active)).downloadedFiles === active.files.length)) });
  }
  function notify(run, force = false) {
    const now = Date.now(); if (!force && now - run.lastNotify < 80) return;
    run.lastNotify = now;
    for (const send of run.listeners) send({ type: 'OFFLINE_PROGRESS', snapshot: { ...run.snapshot } });
  }
  async function prepare(send) {
    if (running) { running.listeners.add(send); send({ type: 'OFFLINE_PROGRESS', snapshot: { ...running.snapshot } }); return running.promise; }
    const run = { paused: false, controllers: new Set(), listeners: new Set([send]), snapshot: snapshot(null, null, { phase: 'loading-manifest' }), lastNotify: 0 };
    running = run; notify(run, true);
    run.promise = (async () => {
      let failed = null;
      try {
        const manifest = await loadManifest(values => { Object.assign(run.snapshot, values); notify(run, true); }, run), active = await activeManifest(), cache = await caches.open(CONTENT), stats = { downloadedFiles: 0, downloadedBytes: 0 };
        run.snapshot = snapshot(manifest, stats, { phase: 'checking-cache', previousVersion: active?.version || null }); notify(run, true);
        const previousComplete = Boolean(active && (await cachedStats(active, false, values => { Object.assign(run.snapshot, values); notify(run); })).downloadedFiles === active.files.length);
        Object.assign(run.snapshot, { phase: 'verifying', previousComplete }); notify(run, true);
        let index = 0;
        async function oneFile(file) {
          const existing = await cache.match(absolute(file.url));
          if (validHeaders(existing, file)) {
            const body = await existing.arrayBuffer();
            if (body.byteLength === file.bytes && await sha256(body) === file.sha256) return;
          }
          run.snapshot.phase = 'downloading';
          let lastError;
          // Files are independent checkpoints: a killed worker resumes at the
          // first unverified file, never at byte0 of the whole450MB package.
          for (let attempt = 0; attempt < 2 && !run.paused && !failed; attempt++) {
            const controller = new AbortController(); run.controllers.add(controller);
            const timer = setTimeout(() => controller.abort(), 90000);
            try {
              const source = downloadUrl(file);
              const response = await fetch(source, { cache: 'no-store', credentials: source.startsWith(origin + '/') ? 'same-origin' : 'omit', mode: 'cors', signal: controller.signal });
              if (!response.ok || response.status !== 200) throw new Error('资源下载失败：' + response.status);
              const body = await response.arrayBuffer();
              if (body.byteLength !== file.bytes || await sha256(body) !== file.sha256) throw new Error('资源完整性校验失败：' + file.url);
              if (run.paused) return;
              await cache.put(absolute(file.url), new Response(body, { headers: { 'Content-Type': file.contentType || 'application/octet-stream', 'Content-Length': String(file.bytes), 'X-Phone-SHA256': file.sha256, 'Accept-Ranges': 'bytes', 'ETag': '"' + file.sha256 + '"' } }));
              return;
            } catch (error) {
              lastError = error;
              if (error.name === 'QuotaExceededError') throw error;
            } finally { clearTimeout(timer); run.controllers.delete(controller); }
          }
          if (!run.paused) throw lastError || new Error('资源下载中断。');
        }
        async function worker() {
          while (!run.paused && !failed && index < manifest.files.length) {
            const file = manifest.files[index++];
            try {
              await oneFile(file);
              if (run.paused) return;
              stats.downloadedFiles++; stats.downloadedBytes += file.bytes;
              Object.assign(run.snapshot, stats); notify(run);
            } catch (error) { if (!failed) failed = { error, file: file.url }; for (const controller of run.controllers) controller.abort(); }
          }
        }
        await Promise.all(Array.from({ length: Math.min(4, manifest.files.length) }, worker));
        if (failed) throw failed.error;
        if (run.paused) { run.snapshot.phase = 'paused'; return run.snapshot; }
        if (stats.downloadedFiles !== manifest.files.length) throw new Error('资源包尚未完整下载。');
        // cache.put is the only commit point. Old active release and all shared
        // bodies remain available if this write or any earlier operation fails.
        run.snapshot.phase = 'committing'; notify(run, true);
        const meta = await caches.open(META);
        // Keep each successful manifest, including the old one, available for
        // diagnostics/rollback without duplicating any immutable file bodies.
        if (active) await meta.put(absolute('/__phone_cache__/ready/' + active.version), jsonResponse(active));
        await meta.put(absolute('/__phone_cache__/ready/' + manifest.version), jsonResponse(manifest));
        await meta.put(absolute(ACTIVE), jsonResponse(manifest));
        activePromise = Promise.resolve(manifest);
        Object.assign(run.snapshot, { complete: true, phase: 'ready' }); return run.snapshot;
      } catch (error) {
        Object.assign(run.snapshot, { complete: false, phase: run.paused ? 'paused' : 'error', error: error.name === 'QuotaExceededError' ? '设备存储空间不足；已保留旧离线包和本次已校验的文件。' : String(error.message || error), failedFiles: failed ? [failed.file] : [] });
        return run.snapshot;
      } finally { notify(run, true); running = null; }
    })();
    return run.promise;
  }
  function pause() {
    if (running) { running.paused = true; for (const controller of running.controllers) controller.abort(); }
    return running?.promise || inspect();
  }
  function routeFor(manifest, input) {
    const parsed = pathnameOf(input); if (!parsed) return null;
    const { url, pathname } = parsed;
    const key = url.origin === origin ? pathname : `${url.protocol}//${url.host}${url.pathname}`;
    let canonical = manifest.routes[key];
    // The original router accepts legacy resource families under any /cdn/host
    // wrapper, but only exact known family-relative filenames are eligible.
    const legacy = pathname.replace(/^\/cdn\/[^/]+(?=\/fist_of_truth_)/, '');
    if (!canonical && /^\/fist_of_truth_/.test(legacy)) canonical = manifest.legacyRoutes?.[legacy];
    if (!canonical && url.origin === origin && manifest.files.some(file => file.url === pathname)) canonical = pathname;
    if (!canonical) return null;
    const file = manifest.files.find(file => file.url === canonical);
    return { file, contentType: manifest.routeContentTypes?.[key] || file.contentType };
  }
  async function rangedResponse(request, cached, file, contentType) {
    const headers = new Headers(cached.headers);
    headers.set('Content-Type', contentType || 'application/octet-stream'); headers.set('Accept-Ranges', 'bytes');
    let range = request.headers.get('Range');
    const ifRange = request.headers.get('If-Range');
    if (ifRange && ifRange !== headers.get('ETag')) range = null;
    const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(request.method === 'HEAD' ? null : cached.body, { status: 200, headers });
    const size = file.bytes;
    let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    let end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end || (!match[1] && Number(match[2]) === 0)) {
      headers.set('Content-Range', `bytes */${size}`); headers.set('Content-Length', '0'); return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`); headers.set('Content-Length', String(end - start + 1));
    const body = request.method === 'HEAD' ? null : (await cached.blob()).slice(start, end + 1);
    return new Response(body, { status: 206, headers });
  }
  async function handleFetch(request) {
    const parsed = pathnameOf(request.url);
    if (!parsed || !['GET', 'HEAD'].includes(request.method)) return new Response('Not part of the offline release', { status: 403 });
    if (base && parsed.url.origin === origin && !parsed.url.pathname.startsWith(base + '/')) return new Response('Outside this game installation', { status: 403 });
    const manifest = await activeManifest();
    // Refreshing the installer online must be able to receive a fixed shell,
    // even when a previous complete release cached its old HTML. Game files
    // continue to switch together only after a verified prepare/commit.
    if (request.mode === 'navigate' && ['/', '/index.html', '/phone/', '/phone/index.html', '/phone/update.html'].includes(parsed.pathname)) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
      try { const response = await fetch(request, { cache: 'no-cache', credentials: 'same-origin', signal: controller.signal }); if (response.ok) return response; }
      catch {} finally { clearTimeout(timer); }
    }
    if (parsed.url.origin === origin && parsed.pathname === MANIFEST_PATH) {
      try { return await fetch(request); } catch { return manifest ? jsonResponse(manifest) : new Response('Offline release not prepared', { status: 503 }); }
    }
    const route = manifest && routeFor(manifest, request.url);
    if (route) {
      const cache = await caches.open(CONTENT), cached = await cache.match(absolute(route.file.url));
      if (validHeaders(cached, route.file)) return rangedResponse(request, cached, route.file, route.contentType);
      return new Response('Offline file was removed by the browser; reconnect and prepare again', { status: 503 });
    }
    // No runtime asset proxy or API cache. An initial online install can load
    // its own shell; unrelated/production origins are always blocked.
    if (parsed.url.origin !== origin) return new Response('Remote origin blocked', { status: 403 });
    try { return await fetch(request); } catch { return new Response('Not present in the prepared offline release', { status: 503 }); }
  }
  self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', event => event.respondWith(handleFetch(event.request)));
  self.addEventListener('message', event => {
    const type = event.data?.type;
    if (!['INSPECT_OFFLINE', 'PREPARE_OFFLINE', 'PAUSE_OFFLINE'].includes(type)) return;
    const port = event.ports?.[0], send = data => { try { (port || event.source)?.postMessage({ ...data, requestId: event.data.requestId }); } catch {} };
    const operation = type === 'INSPECT_OFFLINE' ? inspect(value => send({ type: 'OFFLINE_PROGRESS', snapshot: value })) : type === 'PAUSE_OFFLINE' ? pause() : prepare(send);
    event.waitUntil(Promise.resolve(operation).then(result => send({ type: 'OFFLINE_RESULT', ok: result.phase !== 'error', snapshot: result })).catch(error => send({ type: 'OFFLINE_RESULT', ok: false, snapshot: snapshot(null, null, { phase: 'error', error: String(error.message || error) }) })));
  });
})();
