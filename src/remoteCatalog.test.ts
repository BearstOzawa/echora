import { beforeEach, describe, expect, it } from 'vitest'
import { initialTracks } from './testFixtures'
import { readRemoteCatalog, remoteCatalogStorageKey, writeRemoteCatalog } from './remoteCatalog'

describe('remote catalog storage', () => {
  beforeEach(() => localStorage.clear())

  it('stores only unresolved remote metadata under the current schema key', () => {
    const resolved = {
      ...initialTracks[0],
      audioUrl: 'https://media.example/temporary.mp3',
      remote: { ...initialTracks[0].remote!, resolvedQuality: '320k' as const, resolvedAt: Date.now(), playbackToken: 'signed-playback-token' },
    }

    writeRemoteCatalog([resolved])

    expect(localStorage.getItem('echora.remoteCatalog')).toBeNull()
    expect(localStorage.getItem(remoteCatalogStorageKey)).not.toBeNull()
    expect(readRemoteCatalog()[0]).toMatchObject({ id: resolved.id, audioUrl: undefined, remote: { resolvedQuality: undefined, resolvedAt: undefined, playbackToken: undefined } })
  })

  it('does not restore entries written by obsolete catalog rules', () => {
    localStorage.setItem('echora.remoteCatalog', JSON.stringify([initialTracks[0]]))
    expect(readRemoteCatalog()).toEqual([])
  })
})
