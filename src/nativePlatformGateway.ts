import { md5 } from 'js-md5'
import type { PlatformOperation, PlatformRequest, PlatformResponse } from './platformBridge'
import { fetchJsonWithRetry } from './upstreamFetch'

type LxQuality = '128k' | '320k' | 'flac' | 'flac24bit'
type OnlineSource = 'tx' | 'wy' | 'kw' | 'mg' | 'kg'
type FetchLike = typeof globalThis.fetch

type SearchTrack = {
  source: OnlineSource
  title: string
  artist: string
  album: string
  durationSeconds: number
  cover: string | null
  qualities: LxQuality[]
  sizeBytesByQuality: Partial<Record<LxQuality, number>>
  musicInfo: Record<string, unknown>
}

const browserHeaders = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36' }

const fetchJson = async (fetcher: FetchLike, url: string | URL, init: RequestInit = {}) => {
  return fetchJsonWithRetry(fetcher, url, init)
}

const decodeLyricEntities = (value: string) => value
  .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&apos;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&gt;/g, '>')
  .replace(/&lt;/g, '<')
  .replace(/&amp;/g, '&')

const lyricTimestamp = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.max(0, seconds - minutes * 60)
  return `[${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}]`
}

const decodeBase64Utf8 = (value: string) => {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const formatInterval = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.round(seconds % 60).toString().padStart(2, '0')}`
const formatSize = (bytes: number) => bytes > 0 ? `${Number((bytes / 1024 / 1024).toFixed(2))}Mb` : null

const buildQualityInfo = (sizes: Partial<Record<LxQuality, number>>, hashes: Partial<Record<LxQuality, string>> = {}) => {
  const order: LxQuality[] = ['128k', '320k', 'flac', 'flac24bit']
  const qualities = order.filter((quality) => (sizes[quality] ?? 0) > 0)
  const normalized = qualities.length ? qualities : ['128k'] as LxQuality[]
  return {
    qualities: normalized,
    types: normalized.map((type) => ({ type, size: formatSize(sizes[type] ?? 0), ...(hashes[type]?.trim() ? { hash: hashes[type].trim() } : {}) })),
    _types: Object.fromEntries(normalized.map((type) => [type, { size: formatSize(sizes[type] ?? 0), ...(hashes[type]?.trim() ? { hash: hashes[type].trim() } : {}) }])),
  }
}

const searchQq = async (fetcher: FetchLike, query: string, limit: number): Promise<SearchTrack[]> => {
  const url = new URL('https://c.y.qq.com/soso/fcgi-bin/client_search_cp')
  Object.entries({ p: '1', n: String(limit), w: query, format: 'json', new_json: '1' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, Referer: 'https://y.qq.com/' } })
  return (Array.isArray(data?.data?.song?.list) ? data.data.song.list : []).flatMap((item: any): SearchTrack[] => {
    if (!item?.mid || !item?.file?.media_mid) return []
    const sizes = { '128k': Number(item.file.size_128mp3 ?? item.file.size_128 ?? 0), '320k': Number(item.file.size_320mp3 ?? item.file.size_320 ?? 0), flac: Number(item.file.size_flac ?? 0), flac24bit: Number(item.file.size_hires ?? 0) }
    const quality = buildQualityInfo(sizes)
    const artist = Array.isArray(item.singer) ? item.singer.map((singer: any) => singer.name).filter(Boolean).join('、') : ''
    const albumMid = item.album?.mid ?? ''
    const interval = Number(item.interval ?? 0)
    const cover = albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : null
    return [{ source: 'tx', title: String(item.name ?? item.title ?? ''), artist, album: String(item.album?.name ?? ''), durationSeconds: interval, cover, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid: item.mid, songId: item.id, name: String(item.name ?? item.title ?? ''), singer: artist, albumName: String(item.album?.name ?? ''), albumId: item.album?.id ?? '', albumMid, strMediaMid: item.file.media_mid, source: 'tx', interval: formatInterval(interval), img: cover, types: quality.types, _types: quality._types, typeUrl: {} } }]
  })
}

const searchNetease = async (fetcher: FetchLike, query: string, limit: number): Promise<SearchTrack[]> => {
  const url = new URL('https://music.163.com/api/search/get/web')
  Object.entries({ s: query, type: '1', offset: '0', total: 'true', limit: String(limit) }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } })
  const list = Array.isArray(data?.result?.songs) ? data.result.songs : []
  const detailUrl = new URL('https://music.163.com/api/song/detail/')
  detailUrl.searchParams.set('ids', JSON.stringify(list.map((item: any) => item.id).filter((id: unknown) => id != null)))
  const detailData = list.length ? await fetchJson(fetcher, detailUrl, { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } }).catch(() => null) : null
  const details = new Map((Array.isArray(detailData?.songs) ? detailData.songs : []).map((item: any) => [item.id, item]))
  return list.flatMap((searchItem: any): SearchTrack[] => {
    const item: any = details.get(searchItem.id) ?? searchItem
    if (item?.id == null) return []
    const artist = Array.isArray(item.artists) ? item.artists.map((singer: any) => singer.name).filter(Boolean).join('、') : ''
    const durationSeconds = Number(item.duration ?? 0) / 1000
    const sizes = { '128k': Number(item.lMusic?.size ?? item.bMusic?.size ?? 1), '320k': Number(item.hMusic?.size ?? 0), flac: Number(item.sqMusic?.size ?? 0), flac24bit: Number(item.hrMusic?.size ?? 0) }
    const quality = buildQualityInfo(sizes)
    const cover = item.album?.picUrl ?? item.album?.blurPicUrl ?? null
    return [{ source: 'wy', title: String(item.name ?? ''), artist, album: String(item.album?.name ?? ''), durationSeconds, cover, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid: item.id, name: String(item.name ?? ''), singer: artist, albumName: String(item.album?.name ?? ''), albumId: item.album?.id ?? '', source: 'wy', interval: formatInterval(durationSeconds), img: cover, lrc: null, types: quality.types, _types: quality._types, typeUrl: {} } }]
  })
}

const parseKuwoSizes = (value: unknown) => {
  const sizes: Partial<Record<LxQuality, number>> = {}
  if (typeof value !== 'string') return sizes
  for (const block of value.split(';')) {
    const bitrate = block.match(/bitrate:(\d+)/)?.[1]
    const bytes = Number(block.match(/size:([\d.]+)Mb/i)?.[1] ?? 0) * 1024 * 1024
    if (bitrate === '128') sizes['128k'] = bytes
    if (bitrate === '320') sizes['320k'] = bytes
    if (bitrate === '2000') sizes.flac = bytes
    if (bitrate === '4000') sizes.flac24bit = bytes
  }
  return sizes
}

const searchKuwo = async (fetcher: FetchLike, query: string, limit: number): Promise<SearchTrack[]> => {
  const url = new URL('http://search.kuwo.cn/r.s')
  Object.entries({ client: 'kt', all: query, pn: '0', rn: String(limit), uid: '794762570', ver: 'kwplayer_ar_9.2.2.1', vipver: '1', show_copyright_off: '1', newver: '1', ft: 'music', cluster: '0', strategy: '2012', encoding: 'utf8', rformat: 'json', vermerge: '1', mobi: '1', issubtitle: '1' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: browserHeaders })
  return (Array.isArray(data?.abslist) ? data.abslist : []).flatMap((item: any): SearchTrack[] => {
    const songmid = String(item?.MUSICRID ?? '').replace(/^MUSIC_/, '')
    if (!songmid) return []
    const sizes = parseKuwoSizes(item.N_MINFO)
    const quality = buildQualityInfo(sizes)
    const durationSeconds = Number(item.DURATION ?? 0)
    const coverPath = String(item.web_albumpic_short || item.web_artistpic_short || '').replace(/^\/+/, '').replace(/^120\//, '')
    const cover = coverPath ? `https://img1.kuwo.cn/star/albumcover/500/${coverPath}` : null
    return [{ source: 'kw', title: String(item.SONGNAME ?? ''), artist: String(item.ARTIST ?? ''), album: String(item.ALBUM ?? ''), durationSeconds, cover, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid, name: String(item.SONGNAME ?? ''), singer: String(item.ARTIST ?? ''), albumName: String(item.ALBUM ?? ''), albumId: item.ALBUMID ?? '', source: 'kw', interval: formatInterval(durationSeconds), img: cover, lrc: null, types: quality.types, _types: quality._types, typeUrl: {} } }]
  })
}

const searchMigu = async (fetcher: FetchLike, query: string, limit: number): Promise<SearchTrack[]> => {
  const timestamp = Date.now().toString()
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20'
  const sign = md5(`${query}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`)
  const url = new URL('https://jadeite.migu.cn/music_search/v3/search/searchAll')
  Object.entries({ isCorrect: '0', isCopyright: '1', searchSwitch: '{"song":1,"album":0,"singer":0,"tagSong":1,"mvSong":0,"bestShow":1,"songlist":0,"lyricSong":0}', pageSize: String(limit), text: query, pageNo: '1', sort: '0', sid: 'USS' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, uiVersion: 'A_music_3.6.1', deviceId, timestamp, sign, channel: '0146921' } })
  const list = (Array.isArray(data?.songResultData?.resultList) ? data.songResultData.resultList : []).flat().slice(0, limit)
  return list.flatMap((item: any): SearchTrack[] => {
    if (!item?.songId || !item?.copyrightId) return []
    const sizes: Partial<Record<LxQuality, number>> = {}
    for (const format of Array.isArray(item.audioFormats) ? item.audioFormats : []) {
      const bytes = Number(format.asize ?? format.isize ?? 0)
      if (format.formatType === 'PQ') sizes['128k'] = bytes
      if (format.formatType === 'HQ') sizes['320k'] = bytes
      if (format.formatType === 'SQ') sizes.flac = bytes
      if (format.formatType === 'ZQ24') sizes.flac24bit = bytes
    }
    const quality = buildQualityInfo(sizes)
    const artist = Array.isArray(item.singerList) ? item.singerList.map((singer: any) => singer.name).filter(Boolean).join('、') : ''
    const durationSeconds = Number(item.duration ?? 0)
    const rawCover = item.img3 || item.img2 || item.img1
    const cover = rawCover ? (/^https?:/.test(rawCover) ? rawCover : `https://d.musicapp.migu.cn${rawCover}`) : null
    return [{ source: 'mg', title: String(item.name ?? ''), artist, album: String(item.album ?? ''), durationSeconds, cover, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid: item.songId, copyrightId: item.copyrightId, name: String(item.name ?? ''), singer: artist, albumName: String(item.album ?? ''), albumId: item.albumId ?? '', source: 'mg', interval: formatInterval(durationSeconds), img: cover, lrc: null, lrcUrl: item.lrcUrl, mrcUrl: item.mrcurl, trcUrl: item.trcUrl, types: quality.types, _types: quality._types, typeUrl: {} } }]
  })
}

const searchKugou = async (fetcher: FetchLike, query: string, limit: number): Promise<SearchTrack[]> => {
  const url = new URL('https://songsearch.kugou.com/song_search_v2')
  Object.entries({ keyword: query, page: '1', pagesize: String(limit), platform: 'WebFilter', userid: '0', clientver: '2000', iscorrection: '1', privilege_filter: '0', filter: '10' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, Referer: 'https://www.kugou.com/' } })
  return (Array.isArray(data?.data?.lists) ? data.data.lists : []).flatMap((item: any): SearchTrack[] => {
    const hash = String(item?.FileHash ?? '').trim()
    if (!hash) return []
    const sizes = { '128k': Number(item.FileSize ?? 0), '320k': Number(item.HQFileSize ?? 0), flac: Number(item.SQFileSize ?? 0), flac24bit: Number(item.ResFileSize ?? item.SuperFileSize ?? 0) }
    const quality = buildQualityInfo(sizes, { '128k': hash, '320k': String(item.HQFileHash ?? ''), flac: String(item.SQFileHash ?? ''), flac24bit: String(item.ResFileHash ?? item.SuperFileHash ?? '') })
    const durationSeconds = Number(item.Duration ?? 0)
    const coverTemplate = String(item.Image ?? item.AlbumPrivilege?.image ?? '')
    const cover = coverTemplate ? coverTemplate.replace('{size}', '500') : null
    const title = String(item.SongName ?? item.OriSongName ?? '')
    const artist = String(item.SingerName ?? item.SingerNameEx ?? '')
    const album = String(item.AlbumName ?? '')
    return [{ source: 'kg', title, artist, album, durationSeconds, cover, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid: item.Audioid ?? item.MixSongID ?? hash, hash, name: title, singer: artist, albumName: album, albumId: item.AlbumID ?? '', source: 'kg', interval: formatInterval(durationSeconds), img: cover, types: quality.types, _types: quality._types, typeUrl: {} } }]
  })
}

type GatewayChart = {
  id: string
  name: string
  description: string
  source: OnlineSource
  updatedAt: string
  tracks: SearchTrack[]
}

type GatewayChartSummary = Omit<GatewayChart, 'tracks'> & {
  cover: string | null
  updateFrequency: string
  preview: Array<{ title: string; artist: string }>
  provenance?: 'live' | 'cached' | 'fallback'
}

const normalizeImageUrl = (value: unknown, size = '500') => typeof value === 'string' && value.trim()
  ? value.trim().replace('{size}', size)
  : null

const loadQqChart = async (fetcher: FetchLike, topId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg')
  Object.entries({ topid: String(topId), tpl: '3', page: 'detail', type: 'top', song_begin: '0', song_num: String(limit), g_tk: '5381', format: 'json' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, Referer: 'https://y.qq.com/' } })
  const tracks = (Array.isArray(data?.songlist) ? data.songlist : []).flatMap((entry: any): SearchTrack[] => {
    const item = entry?.data
    if (!item?.songmid) return []
    const sizes = { '128k': Number(item.size128 ?? 0), '320k': Number(item.size320 ?? 0), flac: Number(item.sizeflac ?? 0), flac24bit: Number(item.sizehires ?? 0) }
    const quality = buildQualityInfo(sizes)
    const artist = Array.isArray(item.singer) ? item.singer.map((singer: any) => singer.name).filter(Boolean).join('、') : ''
    const cover = item.albummid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.albummid}.jpg` : null
    const durationSeconds = Number(item.interval ?? 0)
    return [{ source: 'tx', title: String(item.songname ?? ''), artist, album: String(item.albumname ?? ''), durationSeconds, cover, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid: item.songmid, songId: item.songid, name: String(item.songname ?? ''), singer: artist, albumName: String(item.albumname ?? ''), albumId: item.albumid ?? '', albumMid: item.albummid ?? '', strMediaMid: item.strMediaMid ?? item.songmid, source: 'tx', interval: formatInterval(durationSeconds), img: cover, types: quality.types, _types: quality._types, typeUrl: {} } }]
  })
  return { id: `tx:${topId}`, name: String(data?.topinfo?.ListName ?? data?.topinfo?.listName ?? `QQ 榜单 ${topId}`), description: 'QQ 音乐官方榜单', source: 'tx', updatedAt: String(data?.date ?? ''), tracks }
}

const loadNeteaseChart = async (fetcher: FetchLike, playlistId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('https://music.163.com/api/playlist/detail')
  Object.entries({ id: String(playlistId), n: String(limit) }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } })
  const playlist = data?.result
  const tracks = (Array.isArray(playlist?.tracks) ? playlist.tracks.slice(0, limit) : []).flatMap((item: any): SearchTrack[] => {
    if (item?.id == null) return []
    const sizes = { '128k': Number(item.lMusic?.size ?? item.bMusic?.size ?? 1), '320k': Number(item.hMusic?.size ?? 0), flac: Number(item.sqMusic?.size ?? 0), flac24bit: Number(item.hrMusic?.size ?? 0) }
    const quality = buildQualityInfo(sizes)
    const artist = Array.isArray(item.artists) ? item.artists.map((singer: any) => singer.name).filter(Boolean).join('、') : ''
    const durationSeconds = Number(item.duration ?? 0) / 1000
    const cover = item.album?.picUrl ?? item.album?.blurPicUrl ?? null
    return [{ source: 'wy', title: String(item.name ?? ''), artist, album: String(item.album?.name ?? ''), durationSeconds, cover, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid: item.id, name: String(item.name ?? ''), singer: artist, albumName: String(item.album?.name ?? ''), albumId: item.album?.id ?? '', source: 'wy', interval: formatInterval(durationSeconds), img: cover, types: quality.types, _types: quality._types, typeUrl: {} } }]
  })
  const updatedAt = playlist?.updateTime ? new Date(Number(playlist.updateTime)).toISOString().slice(0, 10) : ''
  return { id: `wy:${playlistId}`, name: String(playlist?.name ?? `网易云榜单 ${playlistId}`), description: '网易云音乐官方榜单', source: 'wy', updatedAt, tracks }
}

const loadKuwoChart = async (fetcher: FetchLike, rankId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('http://kbangserver.kuwo.cn/ksong.s')
  Object.entries({ from: 'pc', fmt: 'json', pn: '0', rn: String(limit), type: 'bang', data: 'content', id: String(rankId) }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: browserHeaders })
  const tracks = (Array.isArray(data?.musiclist) ? data.musiclist : []).flatMap((item: any): SearchTrack[] => {
    if (item?.id == null) return []
    const sizes = { '128k': 1, '320k': 1, ...(String(item.formats ?? '').includes('ALFLAC') ? { flac: 1 } : {}) }
    const quality = buildQualityInfo(sizes)
    const durationSeconds = Number(item.song_duration ?? item.duration ?? 0)
    return [{ source: 'kw', title: String(item.name ?? ''), artist: String(item.artist ?? ''), album: String(item.album ?? ''), durationSeconds, cover: null, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid: String(item.id), name: String(item.name ?? ''), singer: String(item.artist ?? ''), albumName: String(item.album ?? ''), albumId: item.albumid ?? '', source: 'kw', interval: formatInterval(durationSeconds), img: null, types: quality.types, _types: quality._types, typeUrl: {} } }]
  })
  return { id: `kw:${rankId}`, name: String(data?.name ?? data?.title ?? `酷我榜单 ${rankId}`), description: '酷我音乐官方榜单', source: 'kw', updatedAt: String(data?.pub ?? ''), tracks }
}

const loadKugouChart = async (fetcher: FetchLike, rankId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('http://mobilecdnbj.kugou.com/api/v3/rank/song')
  Object.entries({ version: '9108', ranktype: '1', plat: '0', pagesize: String(limit), area_code: '1', page: '1', rankid: String(rankId), with_res_tag: '0', show_portrait_mv: '1' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, Referer: 'https://www.kugou.com/' } })
  const tracks = (Array.isArray(data?.data?.info) ? data.data.info : []).flatMap((item: any): SearchTrack[] => {
    const standardHash = String(item?.hash ?? '').trim()
    if (!standardHash) return []
    const sizes = { '128k': Number(item.filesize ?? 0), '320k': Number(item['320filesize'] ?? 0), flac: Number(item.sqfilesize ?? 0), flac24bit: Number(item.filesize_high ?? 0) }
    const quality = buildQualityInfo(sizes, { '128k': standardHash, '320k': String(item['320hash'] ?? ''), flac: String(item.sqhash ?? ''), flac24bit: String(item.hash_high ?? '') })
    const durationSeconds = Number(item.duration ?? 0)
    const title = String(item.songname ?? item.filename ?? '')
    const artist = Array.isArray(item.authors) ? item.authors.map((author: any) => author.author_name).filter(Boolean).join('、') : String(item.singername ?? '')
    const album = String(item.remark ?? item.album_name ?? '')
    const cover = normalizeImageUrl(item.album_sizable_cover ?? item.albumpic)
    return [{ source: 'kg', title, artist, album, durationSeconds, cover, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid: item.audio_id ?? item.album_audio_id ?? standardHash, hash: standardHash, name: title, singer: artist, albumName: album, albumId: item.album_id ?? '', source: 'kg', interval: formatInterval(durationSeconds), img: cover, types: quality.types, _types: quality._types, typeUrl: {} } }]
  })
  return { id: `kg:${rankId}`, name: String(data?.data?.rankinfo?.rankname ?? `酷狗榜单 ${rankId}`), description: '酷狗音乐官方榜单', source: 'kg', updatedAt: '', tracks }
}

const miguChartDefinitions = [[27553319, '尖叫新歌榜'], [27186466, '尖叫热歌榜'], [27553408, '尖叫原创榜'], [75959118, '音乐风向榜']] as const

const miguDurationSeconds = (value: unknown) => {
  if (typeof value === 'number') return value
  const parts = String(value ?? '').split(':').map(Number)
  return parts.some((part) => !Number.isFinite(part)) ? 0 : parts.reduce((total, part) => total * 60 + part, 0)
}

const miguChartTrack = (entry: any): SearchTrack[] => {
  const item = entry?.objectInfo ?? entry
  if (!item?.songId || !item?.copyrightId) return []
  const formats = [...(Array.isArray(item.rateFormats) ? item.rateFormats : []), ...(Array.isArray(item.newRateFormats) ? item.newRateFormats : [])]
  const sizes: Partial<Record<LxQuality, number>> = {}
  for (const format of formats) {
    const type = String(format?.formatType ?? format?.resourceType ?? format?.format ?? '').toUpperCase()
    const bytes = Number(format?.size ?? format?.asize ?? format?.fileSize ?? 1)
    if (type.includes('ZQ24') || type.includes('24BIT')) sizes.flac24bit = bytes
    else if (type.includes('SQ') || type.includes('FLAC')) sizes.flac = bytes
    else if (type.includes('HQ') || type.includes('320')) sizes['320k'] = bytes
    else if (type.includes('PQ') || type.includes('128')) sizes['128k'] = bytes
  }
  if (!Object.keys(sizes).length) sizes['128k'] = 1
  const quality = buildQualityInfo(sizes)
  const rawCover = (Array.isArray(item.albumImgs) ? item.albumImgs.find((image: any) => image?.img)?.img : '') || item.img3 || item.img2 || item.img1
  const cover = rawCover ? (/^https?:/.test(rawCover) ? rawCover : rawCover.startsWith('//') ? `https:${rawCover}` : `https://d.musicapp.migu.cn${rawCover}`) : null
  const artist = Array.isArray(item.singers) ? item.singers.map((singer: any) => singer?.name).filter(Boolean).join('、') : String(item.singer ?? '')
  const durationSeconds = miguDurationSeconds(item.length ?? item.duration)
  return [{ source: 'mg', title: String(item.songName ?? item.name ?? ''), artist, album: String(item.album ?? item.albumName ?? ''), durationSeconds, cover, qualities: quality.qualities, sizeBytesByQuality: sizes, musicInfo: { songmid: item.songId, copyrightId: item.copyrightId, name: String(item.songName ?? item.name ?? ''), singer: artist, albumName: String(item.album ?? item.albumName ?? ''), albumId: item.albumId ?? '', source: 'mg', interval: formatInterval(durationSeconds), img: cover, lrc: null, lrcUrl: item.lrcUrl, mrcUrl: item.mrcUrl, trcUrl: item.trcUrl, types: quality.types, _types: quality._types, typeUrl: {} } }]
}

const loadMiguChart = async (fetcher: FetchLike, columnId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do')
  Object.entries({ columnId: String(columnId), needAll: '0' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(fetcher, url, { headers: browserHeaders })
  const column = data?.data?.columnInfo ?? data?.columnInfo
  const tracks = (Array.isArray(column?.contents) ? column.contents : []).slice(0, limit).flatMap(miguChartTrack)
  const fallbackName = miguChartDefinitions.find(([id]) => id === columnId)?.[1] ?? `咪咕榜单 ${columnId}`
  return { id: `mg:${columnId}`, name: String(column?.columnTitle ?? fallbackName), description: '咪咕音乐官方榜单', source: 'mg', updatedAt: String(column?.columnUpdateTime ?? ''), tracks }
}

const chartFallbacks: Record<OnlineSource, Array<[number, string]>> = {
  tx: [[26, '巅峰榜·热歌'], [62, '巅峰榜·飙升'], [27, '巅峰榜·新歌'], [4, '巅峰榜·流行指数']],
  wy: [[19723756, '飙升榜'], [3779629, '新歌榜'], [3778678, '热歌榜'], [2884035, '原创榜']],
  kw: [[16, '酷我热歌榜'], [93, '酷我飙升榜'], [17, '酷我新歌榜'], [187, '流行趋势榜']],
  kg: [[8888, 'TOP500'], [6666, '飙升榜'], [82831, '网络热歌榜'], [52144, '短视频热歌榜']],
  mg: miguChartDefinitions.map(([id, name]) => [id, name]),
}

const fallbackChartCatalog = (source: OnlineSource): GatewayChartSummary[] => chartFallbacks[source].map(([id, name]) => ({ id: `${source}:${id}`, name, description: `${source === 'tx' ? 'QQ' : source === 'wy' ? '网易云' : source === 'kw' ? '酷我' : source === 'kg' ? '酷狗' : '咪咕'}音乐官方榜单`, source, updatedAt: '', cover: null, updateFrequency: source === 'mg' ? '每日更新' : '', preview: [], provenance: 'fallback' }))

const loadQqChartCatalog = async (fetcher: FetchLike): Promise<GatewayChartSummary[]> => {
  const data = await fetchJson(fetcher, 'https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?format=json&g_tk=5381&uin=0&inCharset=utf-8&outCharset=utf-8&notice=0&platform=h5&needNewCode=1', { headers: { ...browserHeaders, Referer: 'https://y.qq.com/' } })
  return (Array.isArray(data?.data?.topList) ? data.data.topList : []).flatMap((item: any): GatewayChartSummary[] => item?.id == null || !item?.topTitle ? [] : [{ id: `tx:${item.id}`, name: String(item.topTitle), description: 'QQ 音乐官方榜单', source: 'tx', updatedAt: '', cover: normalizeImageUrl(item.picUrl), updateFrequency: '', preview: (Array.isArray(item.songList) ? item.songList : []).slice(0, 3).map((track: any) => ({ title: String(track.songname ?? ''), artist: String(track.singername ?? '') })) }])
}

const loadNeteaseChartCatalog = async (fetcher: FetchLike): Promise<GatewayChartSummary[]> => {
  const data = await fetchJson(fetcher, 'https://music.163.com/api/toplist/detail', { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } })
  return (Array.isArray(data?.list) ? data.list : []).flatMap((item: any): GatewayChartSummary[] => item?.id == null || !item?.name ? [] : [{ id: `wy:${item.id}`, name: String(item.name), description: '网易云音乐官方榜单', source: 'wy', updatedAt: item.updateTime ? new Date(Number(item.updateTime)).toISOString().slice(0, 10) : '', cover: normalizeImageUrl(item.coverImgUrl), updateFrequency: String(item.updateFrequency ?? ''), preview: (Array.isArray(item.tracks) ? item.tracks : []).slice(0, 3).map((track: any) => ({ title: String(track.first ?? ''), artist: String(track.second ?? '') })) }])
}

const loadKuwoChartCatalog = async (fetcher: FetchLike): Promise<GatewayChartSummary[]> => {
  const data = await fetchJson(fetcher, 'http://qukudata.kuwo.cn/q.k?op=query&cont=tree&node=2&pn=0&rn=1000&fmt=json&level=2', { headers: browserHeaders })
  return (Array.isArray(data?.child) ? data.child : []).flatMap((item: any): GatewayChartSummary[] => String(item?.source ?? '') !== '1' || item?.sourceid == null || !item?.name ? [] : [{ id: `kw:${item.sourceid}`, name: String(item.name), description: String(item.disname || '酷我音乐官方榜单'), source: 'kw', updatedAt: '', cover: normalizeImageUrl(item.pic), updateFrequency: '', preview: [] }])
}

const loadKugouChartCatalog = async (fetcher: FetchLike): Promise<GatewayChartSummary[]> => {
  const data = await fetchJson(fetcher, 'http://mobilecdnbj.kugou.com/api/v5/rank/list?version=9108&plat=0&showtype=2&parentid=0&apiver=6&area_code=1&withsong=1', { headers: { ...browserHeaders, Referer: 'https://www.kugou.com/' } })
  return (Array.isArray(data?.data?.info) ? data.data.info : []).flatMap((item: any): GatewayChartSummary[] => Number(item?.isvol) !== 1 || item?.rankid == null || !item?.rankname ? [] : [{ id: `kg:${item.rankid}`, name: String(item.rankname), description: '酷狗音乐官方榜单', source: 'kg', updatedAt: '', cover: normalizeImageUrl(item.banner7url || item.imgurl), updateFrequency: String(item.update_frequency ?? ''), preview: (Array.isArray(item.songinfo) ? item.songinfo : []).slice(0, 3).map((track: any) => ({ title: String(track.name ?? ''), artist: String(track.author ?? '') })) }])
}

const loadMiguChartCatalog = async (fetcher: FetchLike): Promise<GatewayChartSummary[]> => {
  const settled = await Promise.allSettled(miguChartDefinitions.map(([id]) => loadMiguChart(fetcher, id, 3)))
  return settled.flatMap((result): GatewayChartSummary[] => {
    if (result.status === 'rejected') return []
    const { tracks, ...summary } = result.value
    return [{ ...summary, cover: tracks[0]?.cover ?? null, updateFrequency: '每日更新', preview: tracks.slice(0, 3).map((track) => ({ title: track.title, artist: track.artist })) }]
  })
}

const chartCatalogCache = new Map<OnlineSource, { expiresAt: number; charts: GatewayChartSummary[] }>()
const chartDetailCache = new Map<string, { expiresAt: number; chart: GatewayChart }>()

const getChartCatalog = async (fetcher: FetchLike, source: OnlineSource) => {
  const cached = chartCatalogCache.get(source)
  if (cached && cached.expiresAt > Date.now()) return cached.charts.map((chart) => ({ ...chart, provenance: 'cached' as const }))
  const loaders = { tx: loadQqChartCatalog, wy: loadNeteaseChartCatalog, kw: loadKuwoChartCatalog, kg: loadKugouChartCatalog, mg: loadMiguChartCatalog }
  let charts: GatewayChartSummary[]
  try {
    const loaded = await loaders[source](fetcher)
    charts = loaded.length ? loaded.map((chart) => ({ ...chart, provenance: 'live' as const })) : fallbackChartCatalog(source)
  } catch {
    charts = fallbackChartCatalog(source)
  }
  chartCatalogCache.set(source, { expiresAt: Date.now() + 10 * 60_000, charts })
  return charts
}

const chartCatalog = async (fetcher: FetchLike, request: PlatformRequest): Promise<PlatformResponse<unknown>> => {
  const configured = request.query?.get('sources')
  const sources = (configured ?? 'tx,wy,kw,kg,mg').split(',').filter((source): source is OnlineSource => ['tx', 'wy', 'kw', 'kg', 'mg'].includes(source))
  const settled = await Promise.allSettled(Array.from(new Set(sources)).map((source) => getChartCatalog(fetcher, source)))
  const charts = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
  return charts.length ? { ok: true, status: 200, data: { charts } } : { ok: false, status: 502, data: { message: '音乐平台榜单目录暂时不可用' } }
}

const chartDetail = async (fetcher: FetchLike, request: PlatformRequest): Promise<PlatformResponse<unknown>> => {
  const source = request.params?.source
  const boardId = request.params?.boardId
  if (!source || !['tx', 'wy', 'kw', 'kg', 'mg'].includes(source) || !boardId || !/^\d+$/.test(boardId)) return { ok: false, status: 400, data: { message: '榜单标识无效' } }
  const limit = Math.min(50, Math.max(1, Number(request.query?.get('limit') ?? 50) || 50))
  const cacheKey = `${source}:${boardId}:${limit}`
  const cached = chartDetailCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return { ok: true, status: 200, data: { chart: cached.chart } }
  const numericId = Number(boardId)
  const loaders = { tx: loadQqChart, wy: loadNeteaseChart, kw: loadKuwoChart, kg: loadKugouChart, mg: loadMiguChart }
  const chart = await loaders[source as OnlineSource](fetcher, numericId, limit)
  if (!chart.tracks.length) return { ok: false, status: 502, data: { message: '这个榜单暂时没有返回歌曲' } }
  chartDetailCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, chart })
  return { ok: true, status: 200, data: { chart } }
}

const interleave = (groups: SearchTrack[][]) => {
  const tracks: SearchTrack[] = []
  for (let index = 0; index < Math.max(0, ...groups.map((group) => group.length)); index += 1) {
    for (const group of groups) if (group[index]) tracks.push(group[index])
  }
  return tracks
}

const search = async (fetcher: FetchLike, request: PlatformRequest): Promise<PlatformResponse<unknown>> => {
  const query = request.query?.get('query')?.trim() ?? ''
  if (!query) return { ok: false, status: 400, data: { message: '请输入要搜索的音乐' } }
  const limit = Math.min(50, Math.max(1, Number(request.query?.get('limit') ?? 20) || 20))
  const searchers = { tx: searchQq, wy: searchNetease, kw: searchKuwo, mg: searchMigu, kg: searchKugou } as const
  const configured = request.query?.get('sources')
  const sources = configured === null || configured === undefined ? Object.keys(searchers) as OnlineSource[] : configured.split(',').filter((source): source is OnlineSource => source in searchers)
  if (!sources.length) return { ok: false, status: 503, data: { message: '音乐服务暂时不可用' } }
  const settled = await Promise.allSettled(sources.map((source) => searchers[source](fetcher, query, limit)))
  const groups = settled.map((result) => result.status === 'fulfilled' ? result.value : [])
  const sourceStatuses = settled.map((result, index) => ({
    source: sources[index],
    status: result.status === 'rejected' ? 'error' as const : result.value.length ? 'available' as const : 'empty' as const,
    message: result.status === 'rejected'
      ? (result.reason instanceof Error ? result.reason.message : '内容服务请求失败').slice(0, 160)
      : result.value.length ? `已返回 ${result.value.length} 首` : '服务已响应，暂无匹配结果',
  }))
  const tracks = interleave(groups)
  return tracks.length
    ? { ok: true, status: 200, data: { tracks, availableSources: sources.filter((_source, index) => groups[index].length), sourceStatuses } }
    : { ok: false, status: 502, data: { message: '所有音乐平台暂时都没有返回结果', sourceStatuses } }
}

const lyrics = async (fetcher: FetchLike, request: PlatformRequest): Promise<PlatformResponse<unknown>> => {
  const payload = request.body && typeof request.body === 'object' ? request.body as Record<string, any> : {}
  const source = typeof payload.source === 'string' ? payload.source : ''
  const musicInfo = payload.musicInfo && typeof payload.musicInfo === 'object' ? payload.musicInfo as Record<string, any> : {}
  const songmid = musicInfo.songmid
  if (!['tx', 'wy', 'kw', 'mg', 'kg'].includes(source)) return { ok: false, status: 400, data: { message: '歌词平台无效' } }
  if (songmid == null || songmid === '') return { ok: false, status: 400, data: { message: '歌曲缺少歌词标识' } }

  let lyric = ''
  let translation = ''

  if (source === 'wy') {
    const url = new URL('https://music.163.com/api/song/lyric')
    Object.entries({ id: String(songmid), lv: '-1', tv: '-1', rv: '-1', kv: '-1' }).forEach(([key, value]) => url.searchParams.set(key, value))
    const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } })
    lyric = String(data?.lrc?.lyric ?? '')
    translation = String(data?.tlyric?.lyric ?? '')
  } else if (source === 'tx') {
    const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg')
    Object.entries({ songmid: String(songmid), format: 'json', nobase64: '1' }).forEach(([key, value]) => url.searchParams.set(key, value))
    const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, Referer: 'https://y.qq.com/' } })
    lyric = decodeLyricEntities(String(data?.lyric ?? ''))
    translation = decodeLyricEntities(String(data?.trans ?? ''))
  } else if (source === 'kw') {
    const url = new URL('https://kuwo.cn/openapi/v1/www/lyric/getlyric')
    url.searchParams.set('musicId', String(songmid))
    const data = await fetchJson(fetcher, url, { headers: { ...browserHeaders, Referer: 'https://www.kuwo.cn/' } })
    const lines = Array.isArray(data?.data?.lrclist) ? data.data.lrclist : []
    lyric = lines.map((line: any) => `${lyricTimestamp(Number(line.time ?? 0))}${String(line.lineLyric ?? '').trim()}`).join('\n')
  } else if (source === 'mg') {
    const lyricUrl = parseRemoteUrl(musicInfo.lrcUrl)
    const upstream = await fetcher(lyricUrl, { headers: browserHeaders, signal: AbortSignal.timeout(12_000) })
    if (!upstream.ok) throw new Error(`咪咕歌词服务返回 ${upstream.status}`)
    lyric = await upstream.text()
  } else {
    const lyricHeaders = { ...browserHeaders, 'User-Agent': 'Kugou2012-9020-ExpandSearchHeadTip-Protocol878', Referer: 'https://www.kugou.com/' }
    const searchUrl = new URL('https://lyrics.kugou.com/search')
    Object.entries({ ver: '1', man: 'yes', client: 'pc', hash: String(musicInfo.hash ?? songmid) }).forEach(([key, value]) => searchUrl.searchParams.set(key, value))
    const searchData = await fetchJson(fetcher, searchUrl, { headers: lyricHeaders })
    const candidate = Array.isArray(searchData?.candidates) ? searchData.candidates[0] : null
    if (candidate?.id && candidate?.accesskey) {
      const downloadUrl = new URL('https://lyrics.kugou.com/download')
      Object.entries({ ver: '1', client: 'pc', id: String(candidate.id), accesskey: String(candidate.accesskey), fmt: 'lrc', charset: 'utf8' }).forEach(([key, value]) => downloadUrl.searchParams.set(key, value))
      const downloadData = await fetchJson(fetcher, downloadUrl, { headers: lyricHeaders })
      const content = typeof downloadData?.content === 'string' ? downloadData.content : ''
      lyric = content ? decodeBase64Utf8(content) : ''
    }
  }

  return lyric.trim()
    ? { ok: true, status: 200, data: { lyric, translation } }
    : { ok: false, status: 404, data: { message: '这首歌曲暂时没有歌词' } }
}

const parseRemoteUrl = (value: unknown, allowLoopback = false) => {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('远端地址无效')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('远端地址不受支持')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback = host === 'localhost' || host === '::1' || /^127\./.test(host)
  if (!allowLoopback && (loopback || /^10\./.test(host) || /^192\.168\./.test(host) || host.endsWith('.local'))) throw new Error('远端地址不受支持')
  return url
}

const sourceRequest = async (fetcher: FetchLike, request: PlatformRequest): Promise<PlatformResponse<unknown>> => {
  const payload = request.body && typeof request.body === 'object' ? request.body as Record<string, any> : {}
  const target = parseRemoteUrl(payload.url)
  const compatibility = target.hostname === 'app.c.nf.migu.cn' && target.pathname === '/MIGUM2.0/strategy/listen-url/v2.4'
  if (compatibility) {
    target.pathname = '/MIGUM2.0/v2.0/content/listen-url'
    target.searchParams.set('netType', '00')
    target.searchParams.set('resourceType', '2')
  }
  const options = payload.options && typeof payload.options === 'object' ? payload.options : {}
  const headers = new Headers()
  for (const [key, value] of Object.entries(options.headers ?? {})) if (value != null && !['host', 'content-length', 'connection', 'cookie'].includes(key.toLowerCase())) headers.set(key, String(value))
  if (!headers.has('user-agent')) headers.set('user-agent', browserHeaders['User-Agent'])
  const method = typeof options.method === 'string' ? options.method.toUpperCase() : 'GET'
  const form = options.form ?? options.formData
  const body = typeof options.body === 'string' ? options.body : form && typeof form === 'object' ? new URLSearchParams(Object.entries(form).map(([key, value]) => [key, String(value)])).toString() : undefined
  const upstream = await fetcher(target, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, signal: AbortSignal.timeout(Math.min(60_000, Math.max(1000, Number(options.timeout ?? 20_000)))) })
  const raw = await upstream.text()
  let responseBody: unknown = raw
  try { responseBody = JSON.parse(raw) } catch { /* text response */ }
  if (compatibility) {
    const playableUrl = typeof (responseBody as any)?.data?.url === 'string' ? (responseBody as any).data.url : ''
    responseBody = playableUrl ? { code: 200, msg: 'ok', data: { url: playableUrl } } : { code: 403, msg: String((responseBody as any)?.data?.dialogInfo?.text ?? (responseBody as any)?.info ?? '这首咪咕歌曲当前没有可用的试听地址'), data: null }
  }
  return { ok: true, status: 200, data: { statusCode: upstream.status, statusMessage: upstream.statusText, headers: Object.fromEntries(upstream.headers), body: responseBody } }
}

const aiRequest = async (fetcher: FetchLike, request: PlatformRequest): Promise<PlatformResponse<unknown>> => {
  const payload = request.body && typeof request.body === 'object' ? request.body as Record<string, any> : {}
  const target = parseRemoteUrl(payload.url, payload.provider === 'ollama')
  const allowedHeaders = new Set(['authorization', 'content-type', 'x-api-key', 'anthropic-version'])
  const headers = new Headers()
  for (const [key, value] of Object.entries(payload.headers ?? {})) if (value != null && allowedHeaders.has(key.toLowerCase())) headers.set(key, String(value))
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const upstream = await fetcher(target, { method: 'POST', headers, body: typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body ?? {}), signal: AbortSignal.timeout(45_000) })
  const raw = await upstream.text()
  let data: unknown
  try { data = JSON.parse(raw) } catch { data = { message: raw.slice(0, 500) || `AI 服务返回 ${upstream.status}` } }
  return { ok: upstream.ok, status: upstream.status, data }
}

export const requestNativePlatform = async <T>(fetcher: FetchLike, operation: PlatformOperation, request: PlatformRequest = {}): Promise<PlatformResponse<T>> => {
  try {
    if (operation === 'music.search') return await search(fetcher, request) as PlatformResponse<T>
    if (operation === 'music.chartCatalog') return await chartCatalog(fetcher, request) as PlatformResponse<T>
    if (operation === 'music.chartDetail') return await chartDetail(fetcher, request) as PlatformResponse<T>
    if (operation === 'music.lyrics') return await lyrics(fetcher, request) as PlatformResponse<T>
    if (operation === 'music.sourceRequest') return await sourceRequest(fetcher, request) as PlatformResponse<T>
    if (operation === 'ai.request') return await aiRequest(fetcher, request) as PlatformResponse<T>
    return { ok: false, status: 501, data: { message: '这项原生能力将在下一阶段接入' } as T }
  } catch (error) {
    return { ok: false, status: 502, data: { message: error instanceof Error ? error.message : '原生网络请求失败' } as T }
  }
}
