// Installed by native code before website scripts in embedded account pages. It reports only
// allowlisted exchanges, fixed native script results and its own document to the owning page.
// oxlint-disable unicorn/consistent-function-scoping -- Rust injects this self-contained script.
;(() => {
  const config = __AM_CONFIG__
  if (window.top !== window || Object.hasOwn(window, config.property)) return
  const send = (report) => {
    const internals = window.__TAURI_INTERNALS__
    if (!internals || typeof internals.invoke !== 'function') return
    internals.invoke('account_page_report', { token: config.token, report }).catch(() => {})
  }
  const absolute = (value) => {
    try {
      return new URL(value, location.href).href
    } catch {
      return ''
    }
  }
  const captured = (value) => {
    try {
      const url = new URL(value)
      return (
        url.protocol === 'https:' &&
        config.hosts.includes(url.hostname) &&
        config.prefixes.some((prefix) => url.pathname.startsWith(prefix))
      )
    } catch {
      return false
    }
  }
  const form = (body) =>
    typeof body === 'string'
      ? body.slice(0, 65536)
      : body instanceof URLSearchParams
        ? body.toString().slice(0, 65536)
        : undefined
  // The size marker lets native readers report a budget failure instead of a missing body.
  const content = (body) =>
    typeof body !== 'string'
      ? { bodyState: 'unreadable' }
      : body.length > config.limit
        ? { bodyState: 'too-large' }
        : { bodyState: 'ok', body }
  let sequence = 0

  // Wrap with Proxies so native function identity/toString stay unchanged for website code.
  window.fetch = new Proxy(window.fetch, {
    apply(target, self, args) {
      const result = Reflect.apply(target, self, args)
      const input = args[0]
      const url = absolute(
        typeof input === 'string' ? input : input instanceof URL ? input.href : (input?.url ?? ''),
      )
      if (!captured(url)) return result
      const requestId = `f${++sequence}`
      const method = String(args[1]?.method ?? input?.method ?? 'GET').toUpperCase()
      const postData = form(args[1]?.body)
      send({ kind: 'request', requestId, type: 'Fetch', url, method, postData })
      Promise.resolve(result).then(
        (response) => {
          const finish = (body) =>
            send({
              kind: 'exchange',
              requestId,
              type: 'Fetch',
              url,
              method,
              postData,
              responseUrl: response.url || url,
              status: response.status,
              ...content(body),
            })
          try {
            response
              .clone()
              .text()
              .then(finish, () => finish(undefined))
          } catch {
            finish(undefined)
          }
        },
        (error) =>
          send({ kind: 'failed', requestId, error: String(error?.message ?? error).slice(0, 200) }),
      )
      return result
    },
  })

  const xhr = XMLHttpRequest.prototype
  const requests = new WeakMap()
  xhr.open = new Proxy(xhr.open, {
    apply(target, self, args) {
      requests.set(self, {
        method: String(args[0] ?? 'GET').toUpperCase(),
        url: absolute(String(args[1] ?? '')),
      })
      return Reflect.apply(target, self, args)
    },
  })
  xhr.send = new Proxy(xhr.send, {
    apply(target, self, args) {
      const request = requests.get(self)
      if (request && captured(request.url)) {
        const requestId = `x${++sequence}`
        const postData = form(args[0])
        send({ kind: 'request', requestId, type: 'XHR', ...request, postData })
        self.addEventListener(
          'loadend',
          () => {
            if (!self.status) {
              send({ kind: 'failed', requestId, error: 'net::ERR_FAILED' })
              return
            }
            let body
            try {
              const type = self.responseType
              body =
                type === '' || type === 'text'
                  ? self.responseText
                  : type === 'json'
                    ? JSON.stringify(self.response)
                    : type === 'arraybuffer'
                      ? new TextDecoder().decode(self.response)
                      : undefined
            } catch {
              body = undefined
            }
            send({
              kind: 'exchange',
              requestId,
              type: 'XHR',
              ...request,
              postData,
              responseUrl: self.responseURL || request.url,
              status: self.status,
              ...content(body),
            })
          },
          { once: true },
        )
      }
      return Reflect.apply(target, self, args)
    },
  })

  // Account pages resolve data only. Autoplay must never be audible or keep media running.
  const media = HTMLMediaElement.prototype
  const quiet = (element) => {
    try {
      element.muted = true
      element.pause()
    } catch {}
  }
  media.play = new Proxy(media.play, {
    apply(_target, self) {
      quiet(self)
      return Promise.reject(new DOMException('Playback is disabled.', 'NotAllowedError'))
    },
  })
  addEventListener(
    'play',
    (event) => {
      if (event.target instanceof HTMLMediaElement) quiet(event.target)
    },
    true,
  )

  Object.defineProperty(window, config.property, {
    value: Object.freeze({
      run(id, task) {
        Promise.resolve()
          .then(task)
          .then(
            (value) =>
              send({ kind: 'eval', id, ok: true, value: value === undefined ? null : value }),
            (error) =>
              send({
                kind: 'eval',
                id,
                ok: false,
                error: String(error?.message ?? error).slice(0, 200),
              }),
          )
      },
    }),
  })
  send({ kind: 'hello', url: location.href, userAgent: navigator.userAgent })
  // Native input maps viewport points through the view's obscured top inset.
  const viewport = () => send({ kind: 'viewport', height: innerHeight })
  addEventListener('resize', viewport)
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', viewport, { once: true })
  else viewport()

  if (config.documents && new RegExp(config.documents).test(location.pathname)) {
    const capture = () => {
      const entry = performance.getEntriesByType('navigation')[0]
      send({
        kind: 'document',
        url: location.href,
        status: entry?.responseStatus || 200,
        ...content(document.documentElement.outerHTML),
      })
    }
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', capture, { once: true })
    else capture()
  }
})()
