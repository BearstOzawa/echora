import { describe, expect, it } from 'vitest'
import { initialTracks } from './testFixtures'
import { collapseTrackVariants, groupAlbums, groupArtists } from './libraryDiscovery'

describe('library discovery', () => {
  it('groups albums by artist and album instead of title alone', () => {
    const duplicateName = { ...initialTracks[1], id: 9001, artist: 'Another Artist', album: initialTracks[0].album }
    const groups = groupAlbums([initialTracks[0], duplicateName])
    expect(groups).toHaveLength(2)
  })

  it('keeps all works under a navigable artist group', () => {
    const secondWork = { ...initialTracks[0], id: 9002, title: 'Second Work' }
    expect(groupArtists([initialTracks[0], secondWork])[0].tracks).toHaveLength(2)
  })

  it('collapses the same recording across platforms while preferring the best quality', () => {
    const qq = {
      ...initialTracks[0],
      id: 9101,
      source: 'QQ' as const,
      remote: { source: 'tx' as const, musicInfo: {} as never, availableQualities: ['128k' as const, '320k' as const] },
    }
    const netease = {
      ...qq,
      id: 9102,
      source: '网易云' as const,
      remote: { source: 'wy' as const, musicInfo: {} as never, availableQualities: ['128k' as const, '320k' as const, 'flac' as const] },
    }
    const live = { ...qq, id: 9103, title: `${qq.title} Live` }
    expect(collapseTrackVariants([qq, netease, live])).toEqual([netease, live])
  })
})
