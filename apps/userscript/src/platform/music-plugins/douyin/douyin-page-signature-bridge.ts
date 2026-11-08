const BRIDGE_KEY = '__anyMusicUserscriptDouyinSignatureBridge__'
const SANDBOXED_BDMS_URL =
  'https://p-pc-weboff.byteimg.com/tos-cn-i-9r5gewecjs/bdms_1.0.1.19_fix.js'

const sandboxedBridgeDocuments = new WeakSet<Document>()

export const DOUYIN_SIGNATURE_BEGIN_EVENT = 'any-music:userscript:douyin-signature:begin'
export const DOUYIN_SIGNATURE_CANCEL_EVENT = 'any-music:userscript:douyin-signature:cancel'
export const DOUYIN_SIGNATURE_RESULT_EVENT = 'any-music:userscript:douyin-signature:result'

/**
 * 建立只负责安全字段生成的隔离签名器。抖音宿主页复用页面当前 BDMS 与 Web SecSDK；
 * 其他宿主页使用无同源权限的 data iframe 和锁定版本 BDMS，避免第三方 SDK 接触宿主
 * DOM、Cookie 或存储。两条路径都阻断 iframe 的数据请求，实际传输始终由 GM HTTP 完成。
 */
export function installDouyinMainWorldSignatureBridge(document: Document): void {
  const hostname = document.location?.hostname ?? ''
  if (!isDouyinHostname(hostname)) {
    installSandboxedBdmsBridge(document)
    return
  }
  const script = document.createElement('script')
  script.textContent = createBridgeSource()
  ;(document.head ?? document.documentElement).append(script)
  script.remove()
}

interface SandboxedSigningRequest {
  id: string
  url: string
  method: string
  body?: string
}

interface SandboxedSignerMessage {
  channel?: string
  type?: string
  id?: string
  url?: string
}

/**
 * 非抖音宿主页不能读取 douyin.com 的同源 SDK 状态。这里把锁定版本 BDMS 放进不含
 * `allow-same-origin` 的沙箱，并用 CSP 禁止其联网；它只能通过 postMessage 返回签名 URL。
 */
function installSandboxedBdmsBridge(document: Document): void {
  if (sandboxedBridgeDocuments.has(document)) return
  const parentWindow = document.defaultView
  if (!parentWindow || !document.documentElement) return
  sandboxedBridgeDocuments.add(document)

  const channel = createSandboxChannel()
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.referrerPolicy = 'no-referrer'

  const pending = new Map<string, SandboxedSigningRequest>()
  let isReady = false
  let hasStarted = false
  const startSigner = (): void => {
    if (hasStarted) return
    hasStarted = true
    frame.src = createSandboxedSignerDataUrl(channel)
    document.documentElement.append(frame)
  }
  const postProbe = (request: SandboxedSigningRequest): void => {
    if (!isReady) return
    frame.contentWindow?.postMessage({ channel, type: 'probe', ...request }, '*')
  }
  const handleBegin = (event: Event): void => {
    const request = parseSandboxedSigningRequest(event)
    if (!request) return
    pending.set(request.id, request)
    // 任意宿主页都会安装轻量事件边界，但远程 BDMS 只在第一次真实抖音请求时加载。
    startSigner()
    postProbe(request)
  }
  const handleCancel = (event: Event): void => {
    const detail = parseEventDetail(event)
    if (!detail || typeof detail.id !== 'string') return
    pending.delete(detail.id)
    frame.contentWindow?.postMessage({ channel, type: 'cancel', id: detail.id }, '*')
  }
  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== frame.contentWindow || !isSandboxedSignerMessage(event.data, channel)) {
      return
    }
    if (event.data.type === 'ready') {
      isReady = true
      for (const request of pending.values()) postProbe(request)
      return
    }
    if (event.data.type !== 'result' || typeof event.data.id !== 'string') return
    const expected = pending.get(event.data.id)
    if (!expected || typeof event.data.url !== 'string') return
    const signedUrl = parseUrl(event.data.url)
    const aBogus = signedUrl?.searchParams.get('a_bogus') ?? ''
    if (!aBogus) return
    pending.delete(expected.id)
    document.dispatchEvent(
      new parentWindow.CustomEvent(DOUYIN_SIGNATURE_RESULT_EVENT, {
        detail: JSON.stringify({
          id: expected.id,
          msToken: signedUrl?.searchParams.get('msToken') ?? '',
          aBogus,
        }),
      }),
    )
  }

  document.addEventListener(DOUYIN_SIGNATURE_BEGIN_EVENT, handleBegin)
  document.addEventListener(DOUYIN_SIGNATURE_CANCEL_EVENT, handleCancel)
  parentWindow.addEventListener('message', handleMessage)
}

function parseSandboxedSigningRequest(event: Event): SandboxedSigningRequest | undefined {
  const detail = parseEventDetail(event)
  if (
    !detail ||
    typeof detail.id !== 'string' ||
    typeof detail.url !== 'string' ||
    typeof detail.method !== 'string'
  ) {
    return undefined
  }
  return {
    id: detail.id,
    url: detail.url,
    method: detail.method,
    body: typeof detail.body === 'string' ? detail.body : undefined,
  }
}

function parseEventDetail(event: Event): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(String((event as CustomEvent).detail ?? '')) as unknown
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function isSandboxedSignerMessage(
  value: unknown,
  channel: string,
): value is SandboxedSignerMessage & { channel: string; type: string } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as SandboxedSignerMessage).channel === channel &&
    typeof (value as SandboxedSignerMessage).type === 'string'
  )
}

function createSandboxChannel(): string {
  return `am-douyin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function createSandboxedSignerDataUrl(channel: string): string {
  const source = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://p-pc-weboff.byteimg.com; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<script>(() => {
  const channel = ${JSON.stringify(channel)};
  const pending = new Map();
  const parseUrl = (value) => { try { return new URL(value); } catch { return undefined; } };
  const abort = () => Promise.reject(new DOMException('Any Music signing probe stopped before transport.', 'AbortError'));
  const baseFetch = (input, init) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const method = String((init && init.method) || (input instanceof Request && input.method) || 'GET');
    const actual = parseUrl(rawUrl);
    for (const [id, expected] of pending) {
      const target = parseUrl(expected.url);
      if (!actual || !target || actual.pathname !== target.pathname || method.toUpperCase() !== expected.method) continue;
      pending.delete(id);
      parent.postMessage({ channel, type: 'result', id, url: actual.href }, '*');
      break;
    }
    return abort();
  };
  window.fetch = baseFetch;
  try { navigator.sendBeacon = () => false; } catch {}
  window.addEventListener('message', (event) => {
    const detail = event.data;
    if (event.source !== parent || !detail || detail.channel !== channel) return;
    if (detail.type === 'cancel') { pending.delete(detail.id); return; }
    if (detail.type !== 'probe' || typeof detail.id !== 'string' || typeof detail.url !== 'string') return;
    detail.method = String(detail.method || 'GET').toUpperCase();
    pending.set(detail.id, detail);
    try {
      const headers = detail.body ? { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } : undefined;
      void Promise.resolve(window.fetch(detail.url, {
        method: detail.method,
        body: detail.body || undefined,
        headers,
      })).catch(() => undefined);
    } catch {}
  });
  window.__anyMusicBdmsReady = () => {
    try {
      window.bdms?.init?.({ aid: 6383, paths: ['/aweme/v1/web/'], pageId: 1 });
      parent.postMessage({ channel, type: 'ready' }, '*');
    } catch {}
  };
})()</script>
<script src=${JSON.stringify(SANDBOXED_BDMS_URL)} onload="window.__anyMusicBdmsReady()"></script>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(source)}`
}

function parseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl)
  } catch {
    return undefined
  }
}

function isDouyinHostname(hostname: string): boolean {
  return hostname === 'douyin.com' || hostname.endsWith('.douyin.com')
}

function createBridgeSource(): string {
  return `(() => {
    const bridgeKey = ${JSON.stringify(BRIDGE_KEY)};
    if (window[bridgeKey]) return;
    const beginEvent = ${JSON.stringify(DOUYIN_SIGNATURE_BEGIN_EVENT)};
    const cancelEvent = ${JSON.stringify(DOUYIN_SIGNATURE_CANCEL_EVENT)};
    const resultEvent = ${JSON.stringify(DOUYIN_SIGNATURE_RESULT_EVENT)};
    const pending = new Map();
    const nativeFetch = window.fetch.bind(window);
    let signingFetch;
    let discoveryTimer;

    const parseDetail = (event) => {
      try { return JSON.parse(String(event.detail || '')); } catch { return undefined; }
    };
    const parseUrl = (value) => {
      try { return new URL(value, location.origin); } catch { return undefined; }
    };
    const matches = (actual, expected, method) => {
      if (!actual || !expected || method.toUpperCase() !== expected.method) return false;
      const target = parseUrl(expected.url);
      if (!target || actual.origin !== target.origin || actual.pathname !== target.pathname) return false;
      for (const [key, value] of target.searchParams) {
        if (actual.searchParams.get(key) !== value) return false;
      }
      return true;
    };
    const createAbort = (runtime) => Promise.reject(
      new runtime.DOMException('Any Music signing probe stopped before transport.', 'AbortError'),
    );
    const applyWebSignature = (actual) => {
      if (!['/aweme/v1/web/aweme/favorite/', '/aweme/v1/web/aweme/listcollection/'].includes(actual.pathname)) {
        return { url: actual, headers: {} };
      }
      try {
        const signUrl = window.useWebSecsdkApi?.('webSignUrl');
        const result = signUrl?.(actual.href);
        return { url: parseUrl(result?.url) || actual, headers: result?.headers || {} };
      } catch {
        return { url: actual, headers: {} };
      }
    };
    const publishSignature = (id, expected, actual) => {
      const signed = applyWebSignature(actual);
      const signedUrl = signed.url;
      const aBogus = signedUrl.searchParams.get('a_bogus') || '';
      if (!aBogus) return false;
      pending.delete(id);
      document.dispatchEvent(new CustomEvent(resultEvent, { detail: JSON.stringify({
        id,
        msToken: signedUrl.searchParams.get('msToken') || expected.msToken || '',
        aBogus,
        timestamp: signedUrl.searchParams.get('timestamp') || '',
        webSignature: signedUrl.searchParams.get('x-secsdk-web-signature')
          || signed.headers['x-secsdk-web-signature'] || '',
        webExpire: signed.headers['x-secsdk-web-expire'] || '',
      }) }));
      return true;
    };
    const createCaptureFetch = (runtime) => function anyMusicDouyinCaptureFetch(input, init) {
      const rawUrl = typeof input === 'string' || input instanceof runtime.URL
        ? String(input)
        : input.url;
      const method = String((init && init.method) || (input instanceof runtime.Request && input.method) || 'GET');
      const actual = parseUrl(rawUrl);
      for (const [id, expected] of pending) {
        if (!matches(actual, expected, method)) continue;
        publishSignature(id, expected, actual);
        return createAbort(runtime);
      }
      // 非探针请求完全交还页面原始 fetch；Any Music 的数据传输仍由 GM HTTP 完成。
      return nativeFetch(input, init);
    };
    const captureFetch = createCaptureFetch(window);
    window.fetch = captureFetch;
    const runSigningProbe = (id, expected) => {
      if (!signingFetch || expected.started) return;
      expected.started = true;
      try {
        const headers = expected.body
          ? { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
          : undefined;
        const response = signingFetch(expected.url, {
          method: expected.method,
          body: expected.body || undefined,
          headers,
        });
        void Promise.resolve(response).catch(() => undefined);
      } catch {
        // 捕获 fetch 同步抛出的 AbortError；结果事件已在抛错前发送。
      }
    };
    const flushPending = () => {
      for (const [id, expected] of pending) runSigningProbe(id, expected);
    };
    const discoverSigningFetch = () => {
      if (pending.size === 0) return;
      if (window.fetch !== captureFetch) {
        signingFetch = window.fetch.bind(window);
        if (discoveryTimer) clearTimeout(discoveryTimer);
        discoveryTimer = undefined;
        flushPending();
        return;
      }
      if (!discoveryTimer) {
        discoveryTimer = setTimeout(() => {
          discoveryTimer = undefined;
          discoverSigningFetch();
        }, 50);
      }
    };

    document.addEventListener(beginEvent, (event) => {
      const detail = parseDetail(event);
      if (!detail || typeof detail.id !== 'string' || typeof detail.url !== 'string') return;
      detail.started = false;
      pending.set(detail.id, detail);
      runSigningProbe(detail.id, detail);
      discoverSigningFetch();
    });
    document.addEventListener(cancelEvent, (event) => {
      const detail = parseDetail(event);
      if (detail && typeof detail.id === 'string') pending.delete(detail.id);
      if (pending.size === 0 && discoveryTimer) {
        clearTimeout(discoveryTimer);
        discoveryTimer = undefined;
      }
    });
    Object.defineProperty(window, bridgeKey, { configurable: false, value: true });
  })();`
}
