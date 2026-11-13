/** Trusted source, compiled inside QuickJS. No guest object is inspected in the host realm. */
export const GUEST_BOOTSTRAP = String.raw`
(() => {
  'use strict';
  const standard = globalThis.__amStandard, delay = globalThis.__amDelay;
  const digest = globalThis.__amDigest, hmac = globalThis.__amHmac;
  delete globalThis.__amStandard; delete globalThis.__amDelay; delete globalThis.__amDigest;
  delete globalThis.__amHmac;
  const parse = JSON.parse, stringify = JSON.stringify;
  const ownKeys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor;
  const prototype = Object.getPrototypeOf, create = Object.create;
  const objectPrototype = Object.prototype, arrayPrototype = Array.prototype;
  const isArray = Array.isArray, isInteger = Number.isSafeInteger;
  const callStandard = (operation, value) => parse(standard(operation, stringify(value)));
  const freeze = Object.freeze;
  delete globalThis.SharedArrayBuffer; delete globalThis.Atomics;
  const NativeDate = Date;
  function ProfileDate(...args) {
    const date = new NativeDate(...(args.length ? args : [callStandard('now',null)]));
    return new.target ? date : date.toString();
  }
  ProfileDate.prototype = NativeDate.prototype;
  Object.defineProperty(NativeDate.prototype,'constructor',{value:ProfileDate});
  ProfileDate.now = () => callStandard('now',null);
  ProfileDate.parse = input => NativeDate.parse(input);
  ProfileDate.UTC = (...args) => NativeDate.UTC(...args);
  globalThis.Date = ProfileDate;
  globalThis.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(input = '') { return new Uint8Array(callStandard('encode', String(input))); }
    encodeInto(input, destination) {
      const bytes = this.encode(input);
      if (destination.length < bytes.length) throw new RangeError('Bounded encodeInto destination');
      destination.set(bytes); return { read: input.length, written: bytes.length };
    }
  };
  globalThis.TextDecoder = class TextDecoder {
    constructor(label = 'utf-8', options = {}) {
      if (!['utf-8', 'utf8'].includes(String(label).toLowerCase())) throw new TypeError('UTF-8 only');
      this.fatal = !!options.fatal;
    }
    get encoding() { return 'utf-8'; }
    decode(input = new Uint8Array()) {
      return callStandard('decode', { bytes: Array.from(new Uint8Array(input.buffer || input,
        input.byteOffset || 0, input.byteLength)), fatal: this.fatal });
    }
  };
  globalThis.btoa = value => callStandard('btoa', String(value));
  globalThis.atob = value => callStandard('atob', String(value));
  globalThis.URLSearchParams = class URLSearchParams {
    #pairs;
    constructor(input = '') {
      if (typeof input === 'string') this.#pairs = callStandard('query', input);
      else if (Array.isArray(input)) this.#pairs = input.map(([k,v]) => [String(k),String(v)]);
      else this.#pairs = Object.entries(input).map(([k,v]) => [k,String(v)]);
    }
    append(k,v) { this.#pairs.push([String(k),String(v)]); }
    delete(k) { this.#pairs = this.#pairs.filter(p => p[0] !== String(k)); }
    get(k) { return this.#pairs.find(p => p[0] === String(k))?.[1] ?? null; }
    getAll(k) { return this.#pairs.filter(p => p[0] === String(k)).map(p => p[1]); }
    has(k) { return this.get(k) !== null; }
    set(k,v) { const index = this.#pairs.findIndex(p => p[0] === String(k)); this.delete(k);
      this.#pairs.splice(index < 0 ? this.#pairs.length : index,0,[String(k),String(v)]); }
    sort() { this.#pairs.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); }
    toString() { return callStandard('queryString', this.#pairs); }
    entries() { return this.#pairs.map(p => p.slice())[Symbol.iterator](); }
    keys() { return this.#pairs.map(p => p[0])[Symbol.iterator](); }
    values() { return this.#pairs.map(p => p[1])[Symbol.iterator](); }
    forEach(fn, self) { for (const [k,v] of this.#pairs) fn.call(self,v,k,this); }
    [Symbol.iterator]() { return this.entries(); }
    get size() { return this.#pairs.length; }
  };
  globalThis.URL = class URL {
    #url;
    constructor(input, base) { this.#url = callStandard('url', { input: String(input),
      ...(base === undefined ? {} : { base: String(base) }) }); }
    get href() { return this.#url.href; }
    get origin() { return this.#url.origin; }
    get protocol() { return this.#url.protocol; }
    get hostname() { return this.#url.hostname; }
    get host() { return this.#url.host; }
    get port() { return this.#url.port; }
    get pathname() { return this.#url.pathname; }
    get search() { return this.#url.search; }
    get hash() { return this.#url.hash; }
    get username() { return this.#url.username; }
    get password() { return this.#url.password; }
    get searchParams() { return new URLSearchParams(this.search); }
    toString() { return this.href; }
    toJSON() { return this.href; }
  };
  globalThis.crypto = freeze({ getRandomValues(array) {
    if (!(array instanceof Uint8Array) || array.byteLength > 4096) throw new RangeError('Random budget');
    array.set(callStandard('random', array.byteLength)); return array;
  }});
  globalThis.host = freeze({ crypto: freeze({ sha256(input) { return digest(String(input)); },
    hmacSha256(key,input) { return hmac(String(key),String(input)); } }) });
  // Timers only resolve promises; host callbacks and function references never cross realms.
  globalThis.sleep = ms => delay(ms);
  const timers = new Map(); let nextTimer = 0;
  globalThis.setTimeout = (callback,ms = 0,...args) => {
    if (typeof callback !== 'function' || timers.size >= 32) throw new TypeError('Timer budget');
    const id = ++nextTimer; timers.set(id,true);
    delay(ms).then(() => { if (timers.delete(id)) callback(...args); }); return id;
  };
  globalThis.clearTimeout = id => { timers.delete(id); };
  globalThis.structuredClone = value => parse(encode(value));
  globalThis.console = freeze(Object.fromEntries(['log','info','warn','error','debug'].map(name =>
    [name, (...values) => { callStandard('log', values.map(v => typeof v === 'string' ? v : '[value]').join(' ').slice(0,2048)); }])));
  function encode(value) {
    let nodes = 0;
    const seen = new Set();
    function copy(v, depth) {
      if (++nodes > 10000 || depth > 32) throw new RangeError('Structure budget');
      if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
      if (typeof v === 'number' && isInteger(v) && !Object.is(v,-0)) return v;
      if (typeof v !== 'object' || seen.has(v)) throw new TypeError('JSON values only');
      const array = isArray(v), proto = prototype(v);
      if (proto !== null && proto !== (array ? arrayPrototype : objectPrototype)) throw new TypeError('Custom prototype');
      seen.add(v);
      const out = array ? [] : create(null);
      if (array) Object.setPrototypeOf(out,null);
      let count = 0;
      for (const key of ownKeys(v)) {
        if (array && key === 'length') continue;
        if (typeof key !== 'string' || ['__proto__','constructor','prototype','toJSON'].includes(key)) throw new TypeError('Unsafe key');
        if (array && !/^(0|[1-9][0-9]*)$/.test(key)) throw new TypeError('Array property');
        const d = descriptor(v,key);
        if (!d || !('value' in d) || !d.enumerable) throw new TypeError('Accessor');
        out[key] = copy(d.value,depth+1);
        count++;
      }
      if (array && count !== v.length) throw new TypeError('Sparse array');
      seen.delete(v); return out;
    }
    const result = stringify(copy(value,0));
    if (result.length > 262144) throw new RangeError('Message budget');
    return result;
  }
  return { encode, invoke(namespace,inputJson) {
    if (typeof namespace.default !== 'function') throw new TypeError('Default entry function required');
    return namespace.default(parse(inputJson));
  }};
})()
`
