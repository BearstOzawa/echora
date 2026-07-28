import { useEffect, useState } from 'react'
import { cloudAuth, readCloudSession } from './cloudApi'
import type { CloudSession } from './cloudApi'
import { flushCloudOutbox, synchronizeCloudData } from './cloudSync'

export type CloudSyncPhase = 'idle' | 'syncing' | 'current' | 'offline' | 'error'

export const describeCloudIdentity = (session: CloudSession | null, online: boolean, syncPhase: CloudSyncPhase) => {
  if (!session) return {
    connected: false,
    stateLabel: '未登录',
    caption: '登录 Echora',
    summary: '账户未登录',
    detail: '在线音乐和设备内容仍可使用',
    location: '设备',
    privacy: '下载与本地音乐保留在当前设备',
  }
  const stateLabel = !online || syncPhase === 'offline'
    ? '离线'
    : syncPhase === 'syncing'
      ? '正在连接'
      : syncPhase === 'error'
        ? '等待重试'
        : '在线'
  return {
    connected: true,
    stateLabel,
    caption: `@${session.user.username}${stateLabel === '在线' ? '' : ` · ${stateLabel}`}`,
    summary: 'Echora 账户',
    detail: stateLabel === '离线' ? '恢复连接后会继续处理账户更改' : stateLabel === '等待重试' ? '连接恢复后会自动重试' : '账户数据可在各设备使用',
    location: 'Echora Cloud',
    privacy: '下载与本地音乐保留在当前设备',
  }
}

export const useCloudSession = () => {
  const [session, setSession] = useState<CloudSession | null>(readCloudSession)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [syncPhase, setSyncPhase] = useState<CloudSyncPhase>(() => navigator.onLine ? 'idle' : 'offline')

  useEffect(() => {
    const sessionChanged = (event: Event) => setSession((event as CustomEvent<CloudSession | null>).detail)
    const connected = () => setOnline(true)
    const disconnected = () => setOnline(false)
    window.addEventListener('echora:cloud-session', sessionChanged)
    window.addEventListener('online', connected)
    window.addEventListener('offline', disconnected)
    return () => {
      window.removeEventListener('echora:cloud-session', sessionChanged)
      window.removeEventListener('online', connected)
      window.removeEventListener('offline', disconnected)
    }
  }, [])

  useEffect(() => {
    if (!session || !online) {
      setSyncPhase(online ? 'idle' : 'offline')
      return
    }
    let cancelled = false
    setSyncPhase('syncing')
    void Promise.all([cloudAuth.me(), synchronizeCloudData(session)]).then(() => {
      if (!cancelled) setSyncPhase('current')
    }).catch(() => {
      if (!cancelled) setSyncPhase('error')
    })
    return () => { cancelled = true }
  }, [online, session?.token])

  useEffect(() => {
    if (!session || !online) return
    let timer = 0
    const flush = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        setSyncPhase('syncing')
        void flushCloudOutbox(session).then(() => setSyncPhase('current')).catch(() => setSyncPhase('error'))
      }, 900)
    }
    window.addEventListener('echora:cloud-outbox', flush)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('echora:cloud-outbox', flush)
    }
  }, [online, session?.token])

  return { session, online, syncPhase }
}
