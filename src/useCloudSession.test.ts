import { describe, expect, it } from 'vitest'
import { describeCloudIdentity } from './useCloudSession'

const session = {
  token: 'test-token',
  user: { id: 'user-1', username: 'listener', displayName: 'Listener', role: 'user' as const, avatarUrl: null, createdAt: 1 },
}

describe('describeCloudIdentity', () => {
  it('presents sign-in without framing the product as a sync feature', () => {
    expect(describeCloudIdentity(null, true, 'idle')).toMatchObject({ connected: false, stateLabel: '未登录', caption: '登录 Echora' })
  })

  it('only surfaces connection state when it is actionable', () => {
    expect(describeCloudIdentity(session, true, 'current')).toMatchObject({ connected: true, stateLabel: '在线', caption: '@listener' })
    expect(describeCloudIdentity(session, false, 'offline')).toMatchObject({ connected: true, stateLabel: '离线', privacy: '下载与本地音乐保留在当前设备' })
  })
})
