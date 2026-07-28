import { describe, expect, it } from 'vitest'
import { mergeLyrics, parseLrc, trackLyricsKey } from './lyrics'
import { initialTracks } from './testFixtures'

describe('timed lyric parsing', () => {
  it('parses multiple timestamps and ignores metadata', () => {
    const result = parseLrc('[ti:Song]\n[00:01.25][00:02.500]第一句\n[01:03]第二句')
    expect(result).toEqual([
      { time: 1.25, text: '第一句' },
      { time: 2.5, text: '第一句' },
      { time: 63, text: '第二句' },
    ])
  })

  it('merges translated lines using their real timestamps', () => {
    const result = mergeLyrics('[00:10.00]Hello\n[00:20.00]World', '[00:10.20]你好\n[00:20.00]世界')
    expect(result).toEqual([
      { time: 10, text: 'Hello', translation: '你好' },
      { time: 20, text: 'World', translation: '世界' },
    ])
  })

  it('applies the LRC timing offset without producing negative timestamps', () => {
    expect(parseLrc('[offset:500]\n[00:01.00]稍后出现')).toEqual([{ time: 1.5, text: '稍后出现' }])
    expect(parseLrc('[offset:-1500]\n[00:01.00]从开头出现')).toEqual([{ time: 0, text: '从开头出现' }])
  })

  it('tracks lyrics by the resolved provider identity instead of the queue id', () => {
    const base = initialTracks[0]
    const musicInfo = { songmid: 'tx-song', name: base.title, singer: base.artist, albumName: base.album, source: 'tx' as const, interval: base.duration, types: [], _types: {}, typeUrl: {} }
    const tx = { ...base, remote: { source: 'tx' as const, musicInfo, availableQualities: ['320k' as const] } }
    const wy = { ...tx, remote: { ...tx.remote, source: 'wy' as const, musicInfo: { ...tx.remote.musicInfo, source: 'wy' as const, songmid: 'wy-song' } } }

    expect(trackLyricsKey(tx)).toBe('tx:tx-song')
    expect(trackLyricsKey(wy)).toBe('wy:wy-song')
  })
})
