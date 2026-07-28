type UpstreamFetchOptions = {
  attemptTimeoutMs?: number
  retries?: number
  retryDelayMs?: number
}

const retryableStatus = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500

class NonRetryableUpstreamError extends Error {}

const upstreamStatusError = (status: number) => {
  if (status === 401 || status === 403) return new NonRetryableUpstreamError('内容服务未授权')
  if (status === 404) return new NonRetryableUpstreamError('内容服务地址不可用')
  if (status === 429) return new Error('内容服务请求频繁')
  if (status === 408) return new Error('内容服务响应超时')
  if (!retryableStatus(status)) return new NonRetryableUpstreamError('内容服务请求失败')
  return new Error(status >= 500 ? '内容服务暂时不可用' : '内容服务请求失败')
}

const normalizeUpstreamError = (error: unknown) => {
  if (error instanceof NonRetryableUpstreamError) return error
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return new Error('内容服务响应超时')
  if (error instanceof TypeError) return new Error('内容服务连接失败')
  return error instanceof Error ? error : new Error('内容服务请求失败')
}

export const fetchJsonWithRetry = async (
  fetcher: typeof fetch,
  url: string | URL,
  init: RequestInit = {},
  options: UpstreamFetchOptions = {},
) => {
  const retries = Math.max(0, Math.round(options.retries ?? 1))
  const attemptTimeoutMs = Math.max(500, Math.round(options.attemptTimeoutMs ?? 6_000))
  const retryDelayMs = Math.max(0, Math.round(options.retryDelayMs ?? 180))
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(attemptTimeoutMs)
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await fetcher(url, { ...init, signal })
      if (!response.ok) {
        const error = upstreamStatusError(response.status)
        if (error instanceof NonRetryableUpstreamError || attempt === retries) throw error
        lastError = error
      } else {
        return response.json() as Promise<any>
      }
    } catch (error) {
      if (init.signal?.aborted) throw error
      if (error instanceof NonRetryableUpstreamError || attempt === retries) throw normalizeUpstreamError(error)
      lastError = error
    }
    if (retryDelayMs) await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
  }
  throw normalizeUpstreamError(lastError)
}
