import { describe, expect, it } from 'vitest'
import { readUserProfile, writeUserProfile } from './userProfile'

describe('local user profile', () => {
  it('persists an editable local identity without requiring an account', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) }
    writeUserProfile({ id: 'local-test', displayName: '小林', createdAt: 42 }, storage)
    expect(readUserProfile(storage)).toEqual({ id: 'local-test', displayName: '小林', createdAt: 42 })
  })
})
