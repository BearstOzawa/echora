import { describe, expect, it } from 'vitest'
import { sourceBrandKey } from './sourceBrand'

describe('music source branding', () => {
  it('maps every platform and local music to a stable brand key', () => {
    expect(['QQ', '网易云', '酷我', '酷狗', '咪咕', '本地'].map((source) => sourceBrandKey(source as Parameters<typeof sourceBrandKey>[0]))).toEqual(['tx', 'wy', 'kw', 'kg', 'mg', 'local'])
    expect(sourceBrandKey('mg')).toBe('mg')
  })
})
