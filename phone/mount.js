/* Map the recovered client's root-relative resource requests into a static
 * hosting subdirectory. Run before the bridge/wx shim, and in its bundled
 * simulator Worker. Game API calls are still handled by the device bridge.
 */
(() => {
  const host = globalThis;
  const script = host.document?.currentScript?.src || host.location?.href;
  if (!script) return;
  const source = new URL(script), marker = source.pathname.lastIndexOf('/phone/');
  const base = marker >= 0 ? source.pathname.slice(0, marker) : '';
  if (!base || host.__PHONE_MOUNT__) return;
  const mounted = input => {
    const url = new URL(String(input), host.location.href);
    if (url.origin !== source.origin || url.pathname.startsWith(base + '/')) return String(input);
    url.pathname = base + url.pathname;
    return url.href;
  };
  host.__PHONE_MOUNT__ = { base, url: mounted };
  const nativeFetch = host.fetch?.bind(host);
  if (nativeFetch) host.fetch = (input, options) => nativeFetch(input instanceof Request ? new Request(mounted(input.url), input) : mounted(input), options);
  if (host.XMLHttpRequest) {
    const open = host.XMLHttpRequest.prototype.open;
    host.XMLHttpRequest.prototype.open = function (method, url, ...rest) { return open.call(this, method, mounted(url), ...rest); };
  }
  if (host.Worker) {
    const NativeWorker = host.Worker;
    host.Worker = class extends NativeWorker { constructor(url, options) { super(mounted(url), options); } };
  }
  for (const [name, property] of [['HTMLImageElement', 'src'], ['HTMLScriptElement', 'src'], ['HTMLMediaElement', 'src'], ['HTMLLinkElement', 'href']]) {
    const prototype = host[name]?.prototype, descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, property);
    if (descriptor?.set && descriptor.configurable) Object.defineProperty(prototype, property, { ...descriptor, set(value) { descriptor.set.call(this, mounted(value)); } });
  }
  if (host.Element) {
    const setAttribute = host.Element.prototype.setAttribute;
    host.Element.prototype.setAttribute = function (name, value) {
      if ((name === 'src' && /^(IMG|SCRIPT|AUDIO|VIDEO|SOURCE)$/.test(this.tagName)) || (name === 'href' && this.tagName === 'LINK')) value = mounted(value);
      return setAttribute.call(this, name, value);
    };
  }
})();
