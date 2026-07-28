import { useEffect, useMemo, useRef } from 'react'
import { echoraCloudUrl } from '../cloudApi'
import type { CloudAuthChallenge as Challenge } from '../cloudApi'

type Props = {
  challenge: Challenge
  onComplete: (token: string) => void
  onError: () => void
}

const challengeNonce = () => typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `challenge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export default function CloudAuthChallenge({ challenge, onComplete, onError }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const completeRef = useRef(false)
  const nonce = useMemo(challengeNonce, [challenge.action, challenge.siteKey])
  const cloudOrigin = useMemo(() => new URL(echoraCloudUrl).origin, [])
  const source = useMemo(() => {
    const url = new URL('/challenge', echoraCloudUrl)
    url.searchParams.set('siteKey', challenge.siteKey)
    url.searchParams.set('action', challenge.action)
    url.searchParams.set('nonce', nonce)
    return url.toString()
  }, [challenge.action, challenge.siteKey, nonce])

  useEffect(() => {
    completeRef.current = false
    const receive = (event: MessageEvent) => {
      if (event.origin !== cloudOrigin || event.source !== frameRef.current?.contentWindow || completeRef.current) return
      const data = event.data as { type?: unknown; nonce?: unknown; action?: unknown; token?: unknown } | null
      if (!data || data.nonce !== nonce || data.action !== challenge.action) return
      if (data.type === 'echora:turnstile' && typeof data.token === 'string' && data.token) {
        completeRef.current = true
        onComplete(data.token)
      } else if (data.type === 'echora:turnstile-error') {
        completeRef.current = true
        onError()
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [challenge.action, cloudOrigin, nonce, onComplete, onError])

  return <div className="account-cloud-challenge">
    <iframe ref={frameRef} src={source} title="安全验证" />
  </div>
}
