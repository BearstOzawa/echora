import { describe, expect, it } from 'vitest'
import { readAppearance } from './App'

const storage = (value: string | null): Pick<Storage, 'getItem'> => ({
  getItem: () => value,
})

describe('appearance initialization', () => {
  it('keeps an explicit user preference', () => {
    expect(readAppearance(storage('light'), true)).toBe('light')
    expect(readAppearance(storage('dark'), false)).toBe('dark')
  })

  it('follows the system appearance on a fresh installation', () => {
    expect(readAppearance(storage(null), false)).toBe('light')
    expect(readAppearance(storage(null), true)).toBe('dark')
  })
})
