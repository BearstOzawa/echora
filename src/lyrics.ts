import type { Track } from './types'
import { platformBridge } from './platformBridge'

export type LyricLine = {
  time: number
  text: string
  translation?: string
}

type LyricsResponse = {
  lyric?: unknown
  translation?: unknown
  message?: unknown
}

const metadataLine = /^(?:ti|ar|al|by|offset|re|ve|length):/i
const timestampPattern = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const offsetPattern = /^\[offset:([+-]?\d+)\]\s*$/im

const fractionToSeconds = (value: string | undefined) => {
  if (!value) return 0
  return Number(value) / (value.length === 3 ? 1000 : value.length === 2 ? 100 : 10)
}

export const parseLrc = (content: string): Array<Omit<LyricLine, 'translation'>> => {
  const lines: Array<Omit<LyricLine, 'translation'>> = []
  const normalizedContent = content.replace(/^\uFEFF/, '')
  const offsetSeconds = Number(normalizedContent.match(offsetPattern)?.[1] ?? 0) / 1000
  for (const rawLine of normalizedContent.split(/\r?\n/)) {
    const timestamps = Array.from(rawLine.matchAll(timestampPattern))
    if (!timestamps.length) continue
    const text = rawLine.replace(timestampPattern, '').trim()
    if (!text || metadataLine.test(text)) continue
    for (const match of timestamps) {
      const time = Math.max(0, Number(match[1]) * 60 + Number(match[2]) + fractionToSeconds(match[3]) + offsetSeconds)
      if (Number.isFinite(time)) lines.push({ time, text })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

const closestTranslation = (time: number, translations: Array<Omit<LyricLine, 'translation'>>) => {
  let closest: Omit<LyricLine, 'translation'> | undefined
  let distance = Number.POSITIVE_INFINITY
  for (const line of translations) {
    const nextDistance = Math.abs(line.time - time)
    if (nextDistance < distance) {
      closest = line
      distance = nextDistance
    }
    if (line.time > time + 0.5) break
  }
  return distance <= 0.5 ? closest?.text : undefined
}

export const mergeLyrics = (lyric: string, translation = ''): LyricLine[] => {
  const primary = parseLrc(lyric)
  const translated = parseLrc(translation)
  return primary.map((line) => {
    const translatedText = closestTranslation(line.time, translated)
    return translatedText && translatedText !== line.text ? { ...line, translation: translatedText } : line
  })
}

const lyricCache = new Map<string, Promise<LyricLine[]>>()

export const trackLyricsKey = (track: Track) => track.remote
  ? `${track.remote.source}:${track.remote.musicInfo.songmid}`
  : `local:${track.localFileId ?? track.id}`

export const fetchTrackLyrics = (track: Track): Promise<LyricLine[]> => {
  if (!track.remote) return Promise.reject(new Error(track.source === '本地' ? '本地文件暂未发现内嵌歌词' : '这首内容没有可查询的歌词标识'))
  const key = trackLyricsKey(track)
  const cached = lyricCache.get(key)
  if (cached) return cached
  const request = platformBridge.requestJson<LyricsResponse>('music.lyrics', {
    method: 'POST',
    body: { source: track.remote.source, musicInfo: track.remote.musicInfo },
  }).then((response) => {
    const data = response.data
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '歌词加载失败')
    const lines = mergeLyrics(typeof data.lyric === 'string' ? data.lyric : '', typeof data.translation === 'string' ? data.translation : '')
    if (!lines.length) throw new Error('这首歌曲暂时没有同步歌词')
    return lines
  }).catch((error) => {
    lyricCache.delete(key)
    throw error
  })
  lyricCache.set(key, request)
  return request
}
