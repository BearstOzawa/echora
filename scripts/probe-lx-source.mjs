import { readFile } from 'node:fs/promises'

const [scriptPath, source, quality, musicInfoJson] = process.argv.slice(2)

if (!scriptPath || !source || !quality || !musicInfoJson) {
  console.error('Usage: node scripts/probe-lx-source.mjs <script> <source> <quality> <music-info-json>')
  process.exitCode = 1
} else {
  const requests = []
  let requestHandler
  let capabilities

  const redactUrl = (value) => {
    const url = new URL(value)
    for (const key of ['key', 'apikey', 'api_key', 'token']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]')
    }
    return url.toString()
  }

  const normalizeBody = (options) => {
    if (typeof options.body === 'string') return options.body
    const fields = options.form ?? options.formData
    if (!fields || typeof fields !== 'object') return undefined
    return new URLSearchParams(Object.entries(fields).map(([key, value]) => [key, String(value)])).toString()
  }

  const request = (value, options = {}, callback) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.min(60_000, Math.max(1000, Number(options.timeout ?? 20_000))))
    void (async () => {
      const url = new URL(value)
      if ((url.hostname === '97abc.com' || url.hostname === 'www.97abc.com') && url.pathname === '/count.php') {
        requests.push({ url: redactUrl(url), blocked: 'telemetry' })
        callback(null, { statusCode: 204, statusMessage: 'No Content', headers: {}, body: {} }, {})
        return
      }
      const headers = new Headers(options.headers ?? {})
      const method = typeof options.method === 'string' ? options.method.toUpperCase() : 'GET'
      const response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : normalizeBody(options),
        signal: controller.signal,
      })
      const rawBody = await response.text()
      let body = rawBody
      try { body = JSON.parse(rawBody) } catch { /* Keep text responses as text. */ }
      const record = {
        url: redactUrl(url),
        method,
        statusCode: response.status,
        body: typeof body === 'string' ? body.slice(0, 300) : body,
      }
      requests.push(record)
      callback(null, {
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: Object.fromEntries(response.headers),
        body,
      }, body)
    })().catch((error) => {
      requests.push({ url: redactUrl(value), error: error instanceof Error ? error.message : String(error) })
      callback(error instanceof Error ? error : new Error(String(error)), null, null)
    }).finally(() => clearTimeout(timeout))
    return () => controller.abort()
  }

  globalThis.lx = {
    EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
    request,
    on(eventName, handler) {
      if (eventName === 'request') requestHandler = handler
      return Promise.resolve()
    },
    send(eventName, data) {
      if (eventName === 'inited') capabilities = data
      return Promise.resolve()
    },
    currentScriptInfo: {
      name: 'lx-玉宁熙',
      description: 'QQ/WY/KW/KG音源',
      version: 'v1.2.0',
      author: 'ynx(2363768762)',
      homepage: '',
      rawScript: '',
    },
    version: '2.0.0',
    env: 'desktop',
  }

  const apiKey = process.env.ECHORA_SOURCE_KEY?.trim() ?? ''
  let script = await readFile(scriptPath, 'utf8')
  if (apiKey) {
    script = script.replace(/((?:const|let|var)\s+YuNingXi\s*=\s*)(['"])(.*?)\2/, (_match, prefix) => `${prefix}${JSON.stringify(apiKey)}`)
  }
  script = script
    .replace(/_0x119038\(\);/g, 'void 0;')
    .replace(/new _0x48e944\(_0x3a74\)\[['"]FdUIJe['"]\]\(\);/g, 'void 0;')
    .replace(/new _0x515145\(_0x14f3\)\[['"]tsKThZ['"]\]\(\);/g, 'void 0;')

  try {
    Function('console', 'setTimeout', 'clearTimeout', script)(
      { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      () => 0,
      () => undefined,
    )
    if (!requestHandler) throw new Error('音源脚本没有注册播放地址解析事件')
    const musicInfo = JSON.parse(musicInfoJson)
    const url = await requestHandler({ source, action: 'musicUrl', info: { type: quality, musicInfo } })
    console.log(JSON.stringify({ result: 'success', url: redactUrl(url), capabilities, requests }, null, 2))
  } catch (error) {
    console.log(JSON.stringify({ result: 'error', message: error instanceof Error ? error.message : String(error), capabilities, requests }, null, 2))
    process.exitCode = 2
  } finally {
    delete globalThis.lx
  }
}
