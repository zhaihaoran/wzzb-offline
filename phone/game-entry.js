import { createPhoneTransport } from './transport.js';
import { installPhoneBridge } from './client-bridge.js';

function script(src) {
  return new Promise((resolve, reject) => {
    const node = document.createElement('script'); node.src = src; node.onload = resolve;
    node.onerror = () => reject(new Error('游戏文件未准备完整：' + src)); document.head.append(node);
  });
}
try {
  document.getElementById('loading-text').textContent = '正在打开手机存档与单机模拟逻辑…';
  const transport = createPhoneTransport(); await transport.status();
  installPhoneBridge(window, transport);
  await script('/local/runtime.js');
  await script('/local/wx-shim.js');
  // Main-thread synchronous XHR bypasses Service Worker handling in browsers.
  // Seed the exact startup files in wx's in-memory filesystem asynchronously
  // before the recovered engine asks for its synchronous settings JSON.
  for (const url of ['/src/settings.365db.json']) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('离线启动配置读取失败：' + url);
    const bytes = await response.arrayBuffer(), fs = window.wx.getFileSystemManager();
    for (const alias of [url, url.slice(1), new URL(url, location.href).href]) fs.writeFileSync(alias, bytes);
  }
  for (const src of ['/original/game.js', '/local/project-bundle.js', '/local/bootstrap.js', '/local/game-controls.js']) await script(src);
  const link = document.querySelector('a.footer-link');
  if (link) { link.href = "/wzzb-offline/phone/"; link.target = '_self'; link.textContent = '离线与存档'; }
  document.getElementById('save-status').textContent = '存档保存在手机';
  const unlock = () => {
    try { if (window.screen.orientation?.lock) window.screen.orientation.lock('landscape').catch(() => {}); } catch {}
  };
  document.getElementById('GameCanvas').addEventListener('pointerdown', unlock, { once: true });
} catch (error) {
  document.getElementById('loading-text').textContent = '手机单机版未能启动';
  const details = document.getElementById('error-details'); details.hidden = false; details.textContent = error.message + '\n请返回离线准备页检查资源或导入存档。';
}
