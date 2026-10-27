/** Same original HTTP/WebSocket contracts delivered inside this device. */
export function installPhoneBridge(global, transport) {
  const nativeFetch = global.fetch.bind(global), peers = new Map();
  const isApi = url => url.pathname.startsWith('/api/') || ['/cdn/www.44755.com/user-api_wlogin', '/cdn/api.44755.com/payment/bond_adv_param'].includes(url.pathname);
  let serial = 0;
  transport.subscribe(event => {
    if (event.kind === 'socket') peers.get(String(event.socketId))?.receive(event.data);
    const status = global.document?.getElementById('save-status');
    if (status && event.kind === 'saved') status.textContent = '存档已保存到手机';
    if (status && event.kind === 'error') status.textContent = '保存失败：' + event.error.message;
  });
  global.fetch = async function (input, options) {
    const request = new Request(input, options), url = new URL(request.url);
    if (!isApi(url)) return nativeFetch(request);
    if (url.pathname === '/api/client-log') return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
    const result = await transport.request('http', {
      method: request.method, url: url.href,
      body: ['GET', 'HEAD'].includes(request.method) ? '' : await request.text(),
      headers: { ...Object.fromEntries(request.headers), host: url.host },
    });
    if (!result) return new Response(JSON.stringify({ state: -404, message: '此手机单机接口不存在。' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status || 200, headers: result.headers || { 'Content-Type': 'application/json' } });
  };
  // Several recovered platform modules use XHR directly rather than wx.request.
  // Keep their ordinary event contract while routing only game API requests to
  // the same device Worker; native XHR continues to serve cached art and audio.
  if (global.XMLHttpRequest) {
    const prototype = global.XMLHttpRequest.prototype, states = new WeakMap();
    const native = Object.fromEntries(['open', 'send', 'abort', 'setRequestHeader', 'getResponseHeader', 'getAllResponseHeaders'].map(name => [name, prototype[name]]));
    const names = ['readyState', 'status', 'statusText', 'response', 'responseText', 'responseURL'];
    function notify(xhr, name) { xhr.dispatchEvent(new Event(name)); }
    prototype.open = function (method, input, async = true, ...rest) {
      const url = new URL(input, global.location?.href || 'http://localhost/');
      if (!isApi(url)) {
        if (states.has(this)) { for (const name of names) delete this[name]; states.delete(this); }
        return native.open.call(this, method, input, async, ...rest);
      }
      if (!async) throw new DOMException('本机游戏接口需要异步请求', 'InvalidAccessError');
      const state = { method, url, headers: {}, readyState: 1, status: 0, statusText: '', response: '', responseText: '', responseURL: url.href, cancelled: false };
      states.set(this, state);
      for (const name of names) Object.defineProperty(this, name, { configurable: true, get: () => state[name] });
      notify(this, 'readystatechange');
    };
    prototype.setRequestHeader = function (name, value) { const state = states.get(this); if (!state) return native.setRequestHeader.call(this, name, value); state.headers[name] = value; };
    prototype.getResponseHeader = function (name) { const state = states.get(this); return state ? state.responseHeaders?.get(name) || null : native.getResponseHeader.call(this, name); };
    prototype.getAllResponseHeaders = function () { const state = states.get(this); return state ? [...(state.responseHeaders || [])].map(([name, value]) => name + ': ' + value + '\r\n').join('') : native.getAllResponseHeaders.call(this); };
    prototype.abort = function () { const state = states.get(this); if (!state) return native.abort.call(this); state.cancelled = true; state.readyState = 0; notify(this, 'abort'); notify(this, 'loadend'); };
    prototype.send = function (body) {
      const state = states.get(this); if (!state) return native.send.call(this, body);
      notify(this, 'loadstart');
      global.fetch(state.url.href, { method: state.method, headers: state.headers, ...(!['GET', 'HEAD'].includes(state.method.toUpperCase()) && body != null ? { body } : {}) }).then(async response => {
        const text = await response.text(); if (state.cancelled) return;
        Object.assign(state, { status: response.status, statusText: response.statusText, responseHeaders: response.headers, readyState: 2 }); notify(this, 'readystatechange');
        state.readyState = 3; notify(this, 'readystatechange'); state.responseText = text;
        state.response = this.responseType === 'json' ? JSON.parse(text) : this.responseType === 'arraybuffer' ? new TextEncoder().encode(text).buffer : text;
        state.readyState = 4; notify(this, 'readystatechange'); notify(this, 'load'); notify(this, 'loadend');
      }).catch(() => { if (state.cancelled) return; state.readyState = 4; notify(this, 'readystatechange'); notify(this, 'error'); notify(this, 'loadend'); });
    };
  }
  class PhoneWebSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      super(); this.id = String(++serial); this.url = String(url); this.readyState = 0;
      this.bufferedAmount = 0; this.extensions = ''; this.protocol = ''; this.binaryType = 'blob';
      peers.set(this.id, this);
      transport.request('socket', { event: 'open', socketId: this.id, url: this.url }).then(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1; this.emit('open', new Event('open'));
      }).catch(error => this.failed(error));
    }
    emit(name, event) { this.dispatchEvent(event); this['on' + name]?.call(this, event); }
    receive(data) { if (this.readyState === 1) this.emit('message', new MessageEvent('message', { data })); }
    send(data) {
      if (this.readyState !== 1) throw new DOMException('手机通道尚未就绪。', 'InvalidStateError');
      transport.request('socket', { event: 'message', socketId: this.id, data }).catch(error => this.failed(error));
    }
    failed(error) { this.emit('error', new Event('error')); this.close(1011, error.message.slice(0, 100)); }
    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      transport.request('socket', { event: 'close', socketId: this.id }).catch(() => {}).finally(() => {
        this.readyState = 3; peers.delete(this.id);
        this.emit('close', new CloseEvent('close', { code, reason, wasClean: code === 1000 }));
      });
    }
  }
  Object.assign(PhoneWebSocket.prototype, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  global.WebSocket = PhoneWebSocket;
  global.__PHONE_TRANSPORT__ = transport;
  return { nativeFetch, peers };
}
