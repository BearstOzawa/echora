import type { LxMusicInfo, LxQuality, OnlineSource } from './types'

type InitMessage = {
  type: 'init'
  script: string
  metadata: { name: string; description: string; version: string; author: string }
}

type ResolveMessage = {
  type: 'resolve'
  requestId: string
  source: OnlineSource
  quality: LxQuality
  musicInfo: LxMusicInfo
}

type NetworkResponseMessage = {
  type: 'network-response'
  networkId: string
  response?: { statusCode: number; statusMessage: string; headers: Record<string, string>; body: unknown }
  error?: string
}

type WorkerMessage = InitMessage | ResolveMessage | NetworkResponseMessage

type RequestCallback = (error: Error | null, response: NetworkResponseMessage['response'] | null, body: unknown) => void

const scope = globalThis as typeof globalThis & {
  lx?: Record<string, unknown>
}

const eventHandlers = new Map<string, (data: unknown) => Promise<unknown>>()
const networkCallbacks = new Map<string, RequestCallback>()
let networkCounter = 0

const post = (message: unknown) => globalThis.postMessage(message)

const decodeBuffer = (value: unknown) => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return new Uint8Array(value)
  return new TextEncoder().encode(String(value ?? ''))
}

const bufferToString = (value: unknown, format = 'utf8') => {
  const bytes = decodeBuffer(value)
  if (format === 'hex') return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (format === 'base64') return btoa(String.fromCharCode(...bytes))
  return new TextDecoder().decode(bytes)
}

const unsupportedCrypto = () => { throw new Error('这个音源使用了 Web 预览暂不支持的加密能力') }

const createLxRuntime = (metadata: InitMessage['metadata'], script: string) => ({
  EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
  request(url: string, options: Record<string, unknown> = {}, callback: RequestCallback) {
    const networkId = `network-${Date.now()}-${networkCounter += 1}`
    networkCallbacks.set(networkId, callback)
    post({ type: 'network-request', networkId, url, options })
    return () => networkCallbacks.delete(networkId)
  },
  on(eventName: string, handler: (data: unknown) => Promise<unknown>) {
    if (eventName !== 'request') return Promise.reject(new Error(`不支持的音源事件：${eventName}`))
    eventHandlers.set(eventName, handler)
    return Promise.resolve()
  },
  send(eventName: string, data: unknown) {
    if (eventName === 'inited') post({ type: 'ready', capabilities: data })
    return Promise.resolve()
  },
  utils: {
    crypto: { aesEncrypt: unsupportedCrypto, rsaEncrypt: unsupportedCrypto, randomBytes: unsupportedCrypto, md5: unsupportedCrypto },
    buffer: { from: decodeBuffer, bufToString: bufferToString },
    zlib: { inflate: unsupportedCrypto, deflate: unsupportedCrypto },
  },
  currentScriptInfo: { ...metadata, homepage: '', rawScript: script },
  version: '2.0.0',
  env: 'desktop',
})

const initialize = (message: InitMessage) => {
  eventHandlers.clear()
  scope.lx = createLxRuntime(message.metadata, message.script)

  const silentConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} }
  const ignoredTimer = () => 0
  const blockedNetwork = () => { throw new Error('音源脚本只能通过 LX 请求接口访问网络') }

  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'SharedWorker']) {
    try {
      Object.defineProperty(globalThis, name, { value: undefined, configurable: false })
    } catch {
      // Lexical shadowing below still prevents ordinary direct access.
    }
  }

  const run = new Function('console', 'setTimeout', 'clearTimeout', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', message.script)
  run(silentConsole, ignoredTimer, () => undefined, blockedNetwork, undefined, undefined, undefined, undefined)
  if (!eventHandlers.has('request')) throw new Error('音源没有注册播放地址解析事件')
}

const resolve = async (message: ResolveMessage) => {
  const handler = eventHandlers.get('request')
  if (!handler) throw new Error('音源尚未初始化')
  const result = await handler({
    source: message.source,
    action: 'musicUrl',
    info: { type: message.quality, musicInfo: message.musicInfo },
  })
  if (typeof result !== 'string' || !/^https?:\/\//.test(result)) throw new Error('音源没有返回有效的播放地址')
  return result
}

globalThis.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data
  if (message.type === 'network-response') {
    const callback = networkCallbacks.get(message.networkId)
    if (!callback) return
    networkCallbacks.delete(message.networkId)
    if (message.error) callback(new Error(message.error), null, null)
    else callback(null, message.response ?? null, message.response?.body)
    return
  }
  if (message.type === 'init') {
    try {
      initialize(message)
    } catch (error) {
      post({ type: 'init-error', error: error instanceof Error ? error.message : '音源初始化失败' })
    }
    return
  }
  if (message.type === 'resolve') {
    void resolve(message).then((url) => {
      post({ type: 'resolve-result', requestId: message.requestId, url })
    }).catch((error: unknown) => {
      post({ type: 'resolve-result', requestId: message.requestId, error: error instanceof Error ? error.message : '播放地址解析失败' })
    })
  }
}

export {}
