import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import postcss from 'postcss'
import { fetchJsonWithRetry } from './src/upstreamFetch'
import { normalizedMediaContentType } from './src/mediaContentType'

type LxQuality = '128k' | '320k' | 'flac' | 'flac24bit'

type SearchTrack = {
  source: 'tx' | 'wy' | 'kw' | 'mg' | 'kg'
  title: string
  artist: string
  album: string
  durationSeconds: number
  cover: string | null
  qualities: LxQuality[]
  sizeBytesByQuality: Partial<Record<LxQuality, number>>
  musicInfo: Record<string, unknown>
}

const gatewayPrefix = '/__echora/music'
const aiGatewayPath = '/__echora/ai/request'
const browserHeaders = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36' }

const jsonResponse = (response: import('node:http').ServerResponse, status: number, data: unknown) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(data))
}

const readJsonBody = async (request: import('node:http').IncomingMessage) => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1024 * 1024) throw new Error('请求内容过大')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

const isPrivateHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true
  const private172 = host.match(/^172\.(\d+)\./)
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31)
}

const parseRemoteUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('远端地址无效')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || isPrivateHost(url.hostname)) throw new Error('远端地址不受支持')
  return url
}

const parseAiRemoteUrl = (value: unknown, provider: unknown) => {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('AI 接口地址无效')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('AI 接口地址不受支持')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback = host === 'localhost' || host === '::1' || /^127\./.test(host)
  if (isPrivateHost(host) && !(provider === 'ollama' && isLoopback)) throw new Error('AI 接口地址不受支持')
  return url
}

const fetchJson = async (url: string | URL, init: RequestInit = {}) => {
  return fetchJsonWithRetry(fetch, url, init)
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

const searchQq = async (query: string, limit: number): Promise<SearchTrack[]> => {
  const url = new URL('https://c.y.qq.com/soso/fcgi-bin/client_search_cp')
  Object.entries({ p: '1', n: String(limit), w: query, format: 'json', new_json: '1' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://y.qq.com/' } })
  const list = Array.isArray(data?.data?.song?.list) ? data.data.song.list : []
  return list.flatMap((item: any): SearchTrack[] => {
    if (!item?.mid || !item?.file?.media_mid) return []
    const sizes = {
      '128k': Number(item.file.size_128mp3 ?? item.file.size_128 ?? 0),
      '320k': Number(item.file.size_320mp3 ?? item.file.size_320 ?? 0),
      flac: Number(item.file.size_flac ?? 0),
      flac24bit: Number(item.file.size_hires ?? 0),
    }
    const quality = buildQualityInfo(sizes)
    const artist = Array.isArray(item.singer) ? item.singer.map((singer: any) => singer.name).filter(Boolean).join('、') : ''
    const albumMid = item.album?.mid ?? ''
    const interval = Number(item.interval ?? 0)
    const cover = albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : null
    return [{
      source: 'tx',
      title: String(item.name ?? item.title ?? ''),
      artist,
      album: String(item.album?.name ?? ''),
      durationSeconds: interval,
      cover,
      qualities: quality.qualities,
      sizeBytesByQuality: sizes,
      musicInfo: {
        songmid: item.mid,
        songId: item.id,
        name: String(item.name ?? item.title ?? ''),
        singer: artist,
        albumName: String(item.album?.name ?? ''),
        albumId: item.album?.id ?? '',
        albumMid,
        strMediaMid: item.file.media_mid,
        source: 'tx',
        interval: formatInterval(interval),
        img: cover,
        types: quality.types,
        _types: quality._types,
        typeUrl: {},
      },
    }]
  })
}

const searchNetease = async (query: string, limit: number): Promise<SearchTrack[]> => {
  const url = new URL('https://music.163.com/api/search/get/web')
  Object.entries({ s: query, type: '1', offset: '0', total: 'true', limit: String(limit) }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } })
  const list = Array.isArray(data?.result?.songs) ? data.result.songs : []
  const detailUrl = new URL('https://music.163.com/api/song/detail/')
  detailUrl.searchParams.set('ids', JSON.stringify(list.map((item: any) => item.id).filter((id: unknown) => id != null)))
  const detailData = list.length ? await fetchJson(detailUrl, { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } }).catch(() => null) : null
  const details = new Map((Array.isArray(detailData?.songs) ? detailData.songs : []).map((item: any) => [item.id, item]))
  return list.flatMap((searchItem: any): SearchTrack[] => {
    const item: any = details.get(searchItem.id) ?? searchItem
    if (item?.id == null) return []
    const artist = Array.isArray(item.artists) ? item.artists.map((singer: any) => singer.name).filter(Boolean).join('、') : ''
    const durationSeconds = Number(item.duration ?? 0) / 1000
    const sizes: Partial<Record<LxQuality, number>> = {
      '128k': Number(item.lMusic?.size ?? item.bMusic?.size ?? 1),
      '320k': Number(item.hMusic?.size ?? 0),
      flac: Number(item.sqMusic?.size ?? 0),
      flac24bit: Number(item.hrMusic?.size ?? 0),
    }
    const quality = buildQualityInfo(sizes)
    const cover = item.album?.picUrl ?? item.album?.blurPicUrl ?? null
    return [{
      source: 'wy',
      title: String(item.name ?? ''),
      artist,
      album: String(item.album?.name ?? ''),
      durationSeconds,
      cover,
      qualities: quality.qualities,
      sizeBytesByQuality: sizes,
      musicInfo: {
        songmid: item.id,
        name: String(item.name ?? ''),
        singer: artist,
        albumName: String(item.album?.name ?? ''),
        albumId: item.album?.id ?? '',
        source: 'wy',
        interval: formatInterval(durationSeconds),
        img: cover,
        lrc: null,
        types: quality.types,
        _types: quality._types,
        typeUrl: {},
      },
    }]
  })
}

const parseKuwoSizes = (value: unknown) => {
  const sizes: Partial<Record<LxQuality, number>> = {}
  if (typeof value !== 'string') return sizes
  for (const block of value.split(';')) {
    const bitrate = block.match(/bitrate:(\d+)/)?.[1]
    const sizeText = block.match(/size:([\d.]+)Mb/i)?.[1]
    const bytes = sizeText ? Number(sizeText) * 1024 * 1024 : 0
    if (bitrate === '128') sizes['128k'] = bytes
    if (bitrate === '320') sizes['320k'] = bytes
    if (bitrate === '2000') sizes.flac = bytes
    if (bitrate === '4000') sizes.flac24bit = bytes
  }
  return sizes
}

const searchKuwo = async (query: string, limit: number): Promise<SearchTrack[]> => {
  const url = new URL('http://search.kuwo.cn/r.s')
  const params = { client: 'kt', all: query, pn: '0', rn: String(limit), uid: '794762570', ver: 'kwplayer_ar_9.2.2.1', vipver: '1', show_copyright_off: '1', newver: '1', ft: 'music', cluster: '0', strategy: '2012', encoding: 'utf8', rformat: 'json', vermerge: '1', mobi: '1', issubtitle: '1' }
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: browserHeaders })
  const list = Array.isArray(data?.abslist) ? data.abslist : []
  return list.flatMap((item: any): SearchTrack[] => {
    const songmid = String(item?.MUSICRID ?? '').replace(/^MUSIC_/, '')
    if (!songmid) return []
    const sizes = parseKuwoSizes(item.N_MINFO)
    const quality = buildQualityInfo(sizes)
    const durationSeconds = Number(item.DURATION ?? 0)
    const coverPath = item.web_albumpic_short || item.web_artistpic_short
    const normalizedCoverPath = String(coverPath ?? '').replace(/^\/+/, '').replace(/^120\//, '')
    const cover = normalizedCoverPath ? `https://img1.kuwo.cn/star/albumcover/500/${normalizedCoverPath}` : null
    return [{
      source: 'kw',
      title: String(item.SONGNAME ?? ''),
      artist: String(item.ARTIST ?? ''),
      album: String(item.ALBUM ?? ''),
      durationSeconds,
      cover,
      qualities: quality.qualities,
      sizeBytesByQuality: sizes,
      musicInfo: {
        songmid,
        name: String(item.SONGNAME ?? ''),
        singer: String(item.ARTIST ?? ''),
        albumName: String(item.ALBUM ?? ''),
        albumId: item.ALBUMID ?? '',
        source: 'kw',
        interval: formatInterval(durationSeconds),
        img: cover,
        lrc: null,
        types: quality.types,
        _types: quality._types,
        typeUrl: {},
      },
    }]
  })
}

const searchMigu = async (query: string, limit: number): Promise<SearchTrack[]> => {
  const timestamp = Date.now().toString()
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20'
  const sign = createHash('md5').update(`${query}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`).digest('hex')
  const url = new URL('https://jadeite.migu.cn/music_search/v3/search/searchAll')
  const params = { isCorrect: '0', isCopyright: '1', searchSwitch: '{"song":1,"album":0,"singer":0,"tagSong":1,"mvSong":0,"bestShow":1,"songlist":0,"lyricSong":0}', pageSize: String(limit), text: query, pageNo: '1', sort: '0', sid: 'USS' }
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: { ...browserHeaders, uiVersion: 'A_music_3.6.1', deviceId, timestamp, sign, channel: '0146921' } })
  const groups = Array.isArray(data?.songResultData?.resultList) ? data.songResultData.resultList : []
  const list = groups.flat().slice(0, limit)
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
    return [{
      source: 'mg',
      title: String(item.name ?? ''),
      artist,
      album: String(item.album ?? ''),
      durationSeconds,
      cover,
      qualities: quality.qualities,
      sizeBytesByQuality: sizes,
      musicInfo: {
        songmid: item.songId,
        copyrightId: item.copyrightId,
        name: String(item.name ?? ''),
        singer: artist,
        albumName: String(item.album ?? ''),
        albumId: item.albumId ?? '',
        source: 'mg',
        interval: formatInterval(durationSeconds),
        img: cover,
        lrc: null,
        lrcUrl: item.lrcUrl,
        mrcUrl: item.mrcurl,
        trcUrl: item.trcUrl,
        types: quality.types,
        _types: quality._types,
        typeUrl: {},
      },
    }]
  })
}

const searchKugou = async (query: string, limit: number): Promise<SearchTrack[]> => {
  const url = new URL('https://songsearch.kugou.com/song_search_v2')
  const params = { keyword: query, page: '1', pagesize: String(limit), platform: 'WebFilter', userid: '0', clientver: '2000', iscorrection: '1', privilege_filter: '0', filter: '10' }
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://www.kugou.com/' } })
  const list = Array.isArray(data?.data?.lists) ? data.data.lists : []
  return list.flatMap((item: any): SearchTrack[] => {
    const standardHash = String(item?.FileHash ?? '').trim()
    if (!standardHash) return []
    const sizes: Partial<Record<LxQuality, number>> = {
      '128k': Number(item.FileSize ?? 0),
      '320k': Number(item.HQFileSize ?? 0),
      flac: Number(item.SQFileSize ?? 0),
      flac24bit: Number(item.ResFileSize ?? item.SuperFileSize ?? 0),
    }
    const quality = buildQualityInfo(sizes, {
      '128k': standardHash,
      '320k': String(item.HQFileHash ?? ''),
      flac: String(item.SQFileHash ?? ''),
      flac24bit: String(item.ResFileHash ?? item.SuperFileHash ?? ''),
    })
    const durationSeconds = Number(item.Duration ?? 0)
    const coverTemplate = String(item.Image ?? item.AlbumPrivilege?.image ?? '')
    const cover = coverTemplate ? coverTemplate.replace('{size}', '500') : null
    const title = String(item.SongName ?? item.OriSongName ?? '')
    const artist = String(item.SingerName ?? item.SingerNameEx ?? '')
    const album = String(item.AlbumName ?? '')
    return [{
      source: 'kg', title, artist, album, durationSeconds, cover,
      qualities: quality.qualities, sizeBytesByQuality: sizes,
      musicInfo: {
        songmid: item.Audioid ?? item.MixSongID ?? standardHash,
        hash: standardHash,
        name: title,
        singer: artist,
        albumName: album,
        albumId: item.AlbumID ?? '',
        source: 'kg',
        interval: formatInterval(durationSeconds),
        img: cover,
        types: quality.types,
        _types: quality._types,
        typeUrl: {},
      },
    }]
  })
}

const interleave = (groups: SearchTrack[][]) => {
  const tracks: SearchTrack[] = []
  const max = Math.max(0, ...groups.map((group) => group.length))
  for (let index = 0; index < max; index += 1) {
    for (const group of groups) if (group[index]) tracks.push(group[index])
  }
  return tracks
}

const handleSearch = async (requestUrl: URL, response: import('node:http').ServerResponse) => {
  const query = requestUrl.searchParams.get('query')?.trim() ?? ''
  if (!query) return jsonResponse(response, 400, { message: '请输入要搜索的音乐' })
  const limit = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get('limit') ?? 20) || 20))
  const searchers = { tx: searchQq, wy: searchNetease, kw: searchKuwo, mg: searchMigu, kg: searchKugou } as const
  const requestedSources = requestUrl.searchParams.get('sources')
  const sources = requestedSources === null
    ? Object.keys(searchers) as Array<keyof typeof searchers>
    : requestedSources.split(',').filter((source): source is keyof typeof searchers => source in searchers)
  if (!sources.length) return jsonResponse(response, 503, { message: '音乐服务暂时不可用' })
  const settled = await Promise.allSettled(sources.map((source) => searchers[source](query, limit)))
  const groups = settled.map((result) => result.status === 'fulfilled' ? result.value : [])
  const sourceStatuses = settled.map((result, index) => ({
    source: sources[index],
    status: result.status === 'rejected' ? 'error' as const : result.value.length ? 'available' as const : 'empty' as const,
    message: result.status === 'rejected'
      ? (result.reason instanceof Error ? result.reason.message : '内容服务请求失败').slice(0, 160)
      : result.value.length ? `已返回 ${result.value.length} 首` : '服务已响应，暂无匹配结果',
  }))
  const tracks = interleave(groups)
  if (!tracks.length) return jsonResponse(response, 502, { message: '所有音乐平台暂时都没有返回结果', sourceStatuses })
  return jsonResponse(response, 200, { tracks, availableSources: sources.filter((_source, index) => groups[index].length), sourceStatuses })
}

type GatewayChart = {
  id: string
  name: string
  description: string
  source: SearchTrack['source']
  updatedAt: string
  tracks: SearchTrack[]
}

type GatewayChartPreview = {
  title: string
  artist: string
}

type GatewayChartSummary = Omit<GatewayChart, 'tracks'> & {
  cover: string | null
  updateFrequency: string
  preview: GatewayChartPreview[]
  provenance?: 'live' | 'cached' | 'fallback'
}

const normalizeImageUrl = (value: unknown, size = '500') => {
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim().replace('{size}', size)
}

const loadQqChart = async (topId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg')
  Object.entries({ topid: String(topId), tpl: '3', page: 'detail', type: 'top', song_begin: '0', song_num: String(limit), g_tk: '5381', format: 'json' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://y.qq.com/' } })
  const tracks = (Array.isArray(data?.songlist) ? data.songlist : []).flatMap((entry: any): SearchTrack[] => {
    const item = entry?.data
    if (!item?.songmid) return []
    const sizes: Partial<Record<LxQuality, number>> = {
      '128k': Number(item.size128 ?? 0),
      '320k': Number(item.size320 ?? 0),
      flac: Number(item.sizeflac ?? 0),
      flac24bit: Number(item.sizehires ?? 0),
    }
    const quality = buildQualityInfo(sizes)
    const artist = Array.isArray(item.singer) ? item.singer.map((singer: any) => singer.name).filter(Boolean).join('、') : ''
    const cover = item.albummid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.albummid}.jpg` : null
    return [{
      source: 'tx', title: String(item.songname ?? ''), artist, album: String(item.albumname ?? ''), durationSeconds: Number(item.interval ?? 0), cover,
      qualities: quality.qualities, sizeBytesByQuality: sizes,
      musicInfo: { songmid: item.songmid, songId: item.songid, name: String(item.songname ?? ''), singer: artist, albumName: String(item.albumname ?? ''), albumId: item.albumid ?? '', albumMid: item.albummid ?? '', strMediaMid: item.strMediaMid ?? item.songmid, source: 'tx', interval: formatInterval(Number(item.interval ?? 0)), img: cover, types: quality.types, _types: quality._types, typeUrl: {} },
    }]
  })
  const name = String(data?.topinfo?.ListName ?? data?.topinfo?.listName ?? `QQ 榜单 ${topId}`)
  return { id: `tx:${topId}`, name, description: 'QQ 音乐官方榜单', source: 'tx', updatedAt: String(data?.date ?? ''), tracks }
}

const loadNeteaseChart = async (playlistId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('https://music.163.com/api/playlist/detail')
  Object.entries({ id: String(playlistId), n: String(limit) }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } })
  const playlist = data?.result
  const tracks = (Array.isArray(playlist?.tracks) ? playlist.tracks.slice(0, limit) : []).flatMap((item: any): SearchTrack[] => {
    if (item?.id == null) return []
    const sizes: Partial<Record<LxQuality, number>> = {
      '128k': Number(item.lMusic?.size ?? item.bMusic?.size ?? 1),
      '320k': Number(item.hMusic?.size ?? 0),
      flac: Number(item.sqMusic?.size ?? 0),
      flac24bit: Number(item.hrMusic?.size ?? 0),
    }
    const quality = buildQualityInfo(sizes)
    const artist = Array.isArray(item.artists) ? item.artists.map((singer: any) => singer.name).filter(Boolean).join('、') : ''
    const durationSeconds = Number(item.duration ?? 0) / 1000
    const cover = item.album?.picUrl ?? item.album?.blurPicUrl ?? null
    return [{
      source: 'wy', title: String(item.name ?? ''), artist, album: String(item.album?.name ?? ''), durationSeconds, cover,
      qualities: quality.qualities, sizeBytesByQuality: sizes,
      musicInfo: { songmid: item.id, name: String(item.name ?? ''), singer: artist, albumName: String(item.album?.name ?? ''), albumId: item.album?.id ?? '', source: 'wy', interval: formatInterval(durationSeconds), img: cover, types: quality.types, _types: quality._types, typeUrl: {} },
    }]
  })
  const updatedAt = playlist?.updateTime ? new Date(Number(playlist.updateTime)).toISOString().slice(0, 10) : ''
  return { id: `wy:${playlistId}`, name: String(playlist?.name ?? `网易云榜单 ${playlistId}`), description: '网易云音乐官方榜单', source: 'wy', updatedAt, tracks }
}

const loadKuwoChart = async (rankId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('http://kbangserver.kuwo.cn/ksong.s')
  Object.entries({ from: 'pc', fmt: 'json', pn: '0', rn: String(limit), type: 'bang', data: 'content', id: String(rankId) }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: browserHeaders })
  const tracks = (Array.isArray(data?.musiclist) ? data.musiclist : []).flatMap((item: any): SearchTrack[] => {
    if (item?.id == null) return []
    const hasFlac = String(item.formats ?? '').includes('ALFLAC')
    const sizes: Partial<Record<LxQuality, number>> = { '128k': 1, '320k': 1, ...(hasFlac ? { flac: 1 } : {}) }
    const quality = buildQualityInfo(sizes)
    const durationSeconds = Number(item.song_duration ?? item.duration ?? 0)
    return [{
      source: 'kw', title: String(item.name ?? ''), artist: String(item.artist ?? ''), album: String(item.album ?? ''), durationSeconds, cover: null,
      qualities: quality.qualities, sizeBytesByQuality: sizes,
      musicInfo: { songmid: String(item.id), name: String(item.name ?? ''), singer: String(item.artist ?? ''), albumName: String(item.album ?? ''), albumId: item.albumid ?? '', source: 'kw', interval: formatInterval(durationSeconds), img: null, types: quality.types, _types: quality._types, typeUrl: {} },
    }]
  })
  return { id: `kw:${rankId}`, name: String(data?.name ?? data?.title ?? `酷我榜单 ${rankId}`), description: '酷我音乐官方榜单', source: 'kw', updatedAt: String(data?.pub ?? ''), tracks }
}

const loadKugouChart = async (rankId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('http://mobilecdnbj.kugou.com/api/v3/rank/song')
  const params = { version: '9108', ranktype: '1', plat: '0', pagesize: String(limit), area_code: '1', page: '1', rankid: String(rankId), with_res_tag: '0', show_portrait_mv: '1' }
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://www.kugou.com/' } })
  const list = Array.isArray(data?.data?.info) ? data.data.info : []
  const tracks = list.flatMap((item: any): SearchTrack[] => {
    const standardHash = String(item?.hash ?? '').trim()
    if (!standardHash) return []
    const sizes: Partial<Record<LxQuality, number>> = {
      '128k': Number(item.filesize ?? 0),
      '320k': Number(item['320filesize'] ?? 0),
      flac: Number(item.sqfilesize ?? 0),
      flac24bit: Number(item.filesize_high ?? 0),
    }
    const quality = buildQualityInfo(sizes, {
      '128k': standardHash,
      '320k': String(item['320hash'] ?? ''),
      flac: String(item.sqhash ?? ''),
      flac24bit: String(item.hash_high ?? ''),
    })
    const durationSeconds = Number(item.duration ?? 0)
    const title = String(item.songname ?? item.filename ?? '')
    const artist = Array.isArray(item.authors) ? item.authors.map((author: any) => author.author_name).filter(Boolean).join('、') : String(item.singername ?? '')
    const album = String(item.remark ?? item.album_name ?? '')
    const coverTemplate = String(item.album_sizable_cover ?? item.albumpic ?? '')
    const cover = coverTemplate ? coverTemplate.replace('{size}', '500') : null
    return [{
      source: 'kg', title, artist, album, durationSeconds, cover,
      qualities: quality.qualities, sizeBytesByQuality: sizes,
      musicInfo: { songmid: item.audio_id ?? item.album_audio_id ?? standardHash, hash: standardHash, name: title, singer: artist, albumName: album, albumId: item.album_id ?? '', source: 'kg', interval: formatInterval(durationSeconds), img: cover, types: quality.types, _types: quality._types, typeUrl: {} },
    }]
  })
  return { id: `kg:${rankId}`, name: String(data?.data?.rankinfo?.rankname ?? `酷狗榜单 ${rankId}`), description: '酷狗音乐官方榜单', source: 'kg', updatedAt: '', tracks }
}

const miguChartDefinitions = [
  [27553319, '尖叫新歌榜'],
  [27186466, '尖叫热歌榜'],
  [27553408, '尖叫原创榜'],
  [75959118, '音乐风向榜'],
] as const

const miguDurationSeconds = (value: unknown) => {
  if (typeof value === 'number') return value
  const parts = String(value ?? '').split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
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
  return [{
    source: 'mg',
    title: String(item.songName ?? item.name ?? ''),
    artist,
    album: String(item.album ?? item.albumName ?? ''),
    durationSeconds,
    cover,
    qualities: quality.qualities,
    sizeBytesByQuality: sizes,
    musicInfo: {
      songmid: item.songId,
      copyrightId: item.copyrightId,
      name: String(item.songName ?? item.name ?? ''),
      singer: artist,
      albumName: String(item.album ?? item.albumName ?? ''),
      albumId: item.albumId ?? '',
      source: 'mg',
      interval: formatInterval(durationSeconds),
      img: cover,
      lrc: null,
      lrcUrl: item.lrcUrl,
      mrcUrl: item.mrcUrl,
      trcUrl: item.trcUrl,
      types: quality.types,
      _types: quality._types,
      typeUrl: {},
    },
  }]
}

const loadMiguChart = async (columnId: number, limit: number): Promise<GatewayChart> => {
  const url = new URL('https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do')
  Object.entries({ columnId: String(columnId), needAll: '0' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: browserHeaders })
  const column = data?.data?.columnInfo ?? data?.columnInfo
  const tracks = (Array.isArray(column?.contents) ? column.contents : []).slice(0, limit).flatMap(miguChartTrack)
  const fallbackName = miguChartDefinitions.find(([id]) => id === columnId)?.[1] ?? `咪咕榜单 ${columnId}`
  return {
    id: `mg:${columnId}`,
    name: String(column?.columnTitle ?? fallbackName),
    description: '咪咕音乐官方榜单',
    source: 'mg',
    updatedAt: String(column?.columnUpdateTime ?? ''),
    tracks,
  }
}

const fallbackChartCatalogs: Partial<Record<SearchTrack['source'], GatewayChartSummary[]>> = {
  tx: [
    [26, '巅峰榜·热歌'], [62, '巅峰榜·飙升'], [27, '巅峰榜·新歌'], [4, '巅峰榜·流行指数'],
  ].map(([id, name]) => ({ id: `tx:${id}`, name: String(name), description: 'QQ 音乐官方榜单', source: 'tx', updatedAt: '', cover: null, updateFrequency: '', preview: [] })),
  wy: [
    [19723756, '飙升榜'], [3779629, '新歌榜'], [3778678, '热歌榜'], [2884035, '原创榜'],
  ].map(([id, name]) => ({ id: `wy:${id}`, name: String(name), description: '网易云音乐官方榜单', source: 'wy', updatedAt: '', cover: null, updateFrequency: '', preview: [] })),
  kw: [
    [16, '酷我热歌榜'], [93, '酷我飙升榜'], [17, '酷我新歌榜'], [187, '流行趋势榜'],
  ].map(([id, name]) => ({ id: `kw:${id}`, name: String(name), description: '酷我音乐官方榜单', source: 'kw', updatedAt: '', cover: null, updateFrequency: '', preview: [] })),
  kg: [
    [8888, 'TOP500'], [6666, '飙升榜'], [82831, '网络热歌榜'], [52144, '短视频热歌榜'],
  ].map(([id, name]) => ({ id: `kg:${id}`, name: String(name), description: '酷狗音乐官方榜单', source: 'kg', updatedAt: '', cover: null, updateFrequency: '', preview: [] })),
  mg: miguChartDefinitions.map(([id, name]) => ({ id: `mg:${id}`, name, description: '咪咕音乐官方榜单', source: 'mg', updatedAt: '', cover: null, updateFrequency: '每日更新', preview: [] })),
}

const chartCatalogCache = new Map<SearchTrack['source'], { expiresAt: number; charts: GatewayChartSummary[] }>()
const chartDetailCache = new Map<string, { expiresAt: number; chart: GatewayChart }>()

const loadQqChartCatalog = async (): Promise<GatewayChartSummary[]> => {
  const url = new URL('https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg')
  Object.entries({ format: 'json', g_tk: '5381', uin: '0', inCharset: 'utf-8', outCharset: 'utf-8', notice: '0', platform: 'h5', needNewCode: '1' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://y.qq.com/' } })
  const list = Array.isArray(data?.data?.topList) ? data.data.topList : []
  return list.flatMap((item: any): GatewayChartSummary[] => {
    if (item?.id == null || !item?.topTitle) return []
    return [{
      id: `tx:${item.id}`,
      name: String(item.topTitle),
      description: 'QQ 音乐官方榜单',
      source: 'tx',
      updatedAt: '',
      cover: normalizeImageUrl(item.picUrl),
      updateFrequency: '',
      preview: (Array.isArray(item.songList) ? item.songList : []).slice(0, 3).map((track: any) => ({ title: String(track.songname ?? ''), artist: String(track.singername ?? '') })),
    }]
  })
}

const loadNeteaseChartCatalog = async (): Promise<GatewayChartSummary[]> => {
  const data = await fetchJson('https://music.163.com/api/toplist/detail', { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } })
  const list = Array.isArray(data?.list) ? data.list : []
  return list.flatMap((item: any): GatewayChartSummary[] => {
    if (item?.id == null || !item?.name) return []
    return [{
      id: `wy:${item.id}`,
      name: String(item.name),
      description: '网易云音乐官方榜单',
      source: 'wy',
      updatedAt: item.updateTime ? new Date(Number(item.updateTime)).toISOString().slice(0, 10) : '',
      cover: normalizeImageUrl(item.coverImgUrl),
      updateFrequency: String(item.updateFrequency ?? ''),
      preview: (Array.isArray(item.tracks) ? item.tracks : []).slice(0, 3).map((track: any) => ({ title: String(track.first ?? ''), artist: String(track.second ?? '') })),
    }]
  })
}

const loadKuwoChartCatalog = async (): Promise<GatewayChartSummary[]> => {
  const data = await fetchJson('http://qukudata.kuwo.cn/q.k?op=query&cont=tree&node=2&pn=0&rn=1000&fmt=json&level=2', { headers: browserHeaders })
  const list = Array.isArray(data?.child) ? data.child : []
  return list.flatMap((item: any): GatewayChartSummary[] => {
    if (String(item?.source ?? '') !== '1' || item?.sourceid == null || !item?.name) return []
    return [{
      id: `kw:${item.sourceid}`,
      name: String(item.name),
      description: String(item.disname || '酷我音乐官方榜单'),
      source: 'kw',
      updatedAt: '',
      cover: normalizeImageUrl(item.pic),
      updateFrequency: '',
      preview: [],
    }]
  })
}

const loadKugouChartCatalog = async (): Promise<GatewayChartSummary[]> => {
  const data = await fetchJson('http://mobilecdnbj.kugou.com/api/v5/rank/list?version=9108&plat=0&showtype=2&parentid=0&apiver=6&area_code=1&withsong=1', { headers: { ...browserHeaders, Referer: 'https://www.kugou.com/' } })
  const list = Array.isArray(data?.data?.info) ? data.data.info : []
  return list.flatMap((item: any): GatewayChartSummary[] => {
    if (Number(item?.isvol) !== 1 || item?.rankid == null || !item?.rankname) return []
    return [{
      id: `kg:${item.rankid}`,
      name: String(item.rankname),
      description: '酷狗音乐官方榜单',
      source: 'kg',
      updatedAt: '',
      cover: normalizeImageUrl(item.banner7url || item.imgurl),
      updateFrequency: String(item.update_frequency ?? ''),
      preview: (Array.isArray(item.songinfo) ? item.songinfo : []).slice(0, 3).map((track: any) => ({ title: String(track.name ?? ''), artist: String(track.author ?? '') })),
    }]
  })
}

const loadMiguChartCatalog = async (): Promise<GatewayChartSummary[]> => {
  const settled = await Promise.allSettled(miguChartDefinitions.map(([id]) => loadMiguChart(id, 3)))
  const charts = settled.flatMap((result): GatewayChartSummary[] => {
    if (result.status !== 'fulfilled') return []
    const chart = result.value
    const { tracks, ...summary } = chart
    return [{
      ...summary,
      cover: tracks[0]?.cover ?? null,
      updateFrequency: '每日更新',
      preview: tracks.slice(0, 3).map((track) => ({ title: track.title, artist: track.artist })),
    }]
  })
  return charts
}

const chartCatalogLoaders: Partial<Record<SearchTrack['source'], () => Promise<GatewayChartSummary[]>>> = {
  tx: loadQqChartCatalog,
  wy: loadNeteaseChartCatalog,
  kw: loadKuwoChartCatalog,
  kg: loadKugouChartCatalog,
  mg: loadMiguChartCatalog,
}

const getChartCatalog = async (source: SearchTrack['source']) => {
  const cached = chartCatalogCache.get(source)
  if (cached && cached.expiresAt > Date.now()) return cached.charts
  const loader = chartCatalogLoaders[source]
  if (!loader) return []
  let charts: GatewayChartSummary[] = []
  try {
    const loaded = await loader()
    charts = loaded.length
      ? loaded.map((chart) => ({ ...chart, provenance: 'live' as const }))
      : (fallbackChartCatalogs[source] ?? []).map((chart) => ({ ...chart, provenance: 'fallback' as const }))
  } catch {
    charts = (fallbackChartCatalogs[source] ?? []).map((chart) => ({ ...chart, provenance: 'fallback' as const }))
  }
  if (charts.length) chartCatalogCache.set(source, { expiresAt: Date.now() + 10 * 60_000, charts })
  return charts
}

const handleChartCatalog = async (requestUrl: URL, response: import('node:http').ServerResponse) => {
  const requested = (requestUrl.searchParams.get('sources') ?? 'tx,wy,kw,kg,mg').split(',').filter((source): source is SearchTrack['source'] => source in chartCatalogLoaders)
  const settled = await Promise.allSettled(Array.from(new Set(requested)).map((source) => getChartCatalog(source)))
  const charts = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
  if (!charts.length) return jsonResponse(response, 502, { message: '音乐平台榜单目录暂时不可用' })
  return jsonResponse(response, 200, { charts })
}

const handleChartDetail = async (source: string, id: string, requestUrl: URL, response: import('node:http').ServerResponse) => {
  if (!['tx', 'wy', 'kw', 'kg', 'mg'].includes(source) || !/^\d+$/.test(id)) return jsonResponse(response, 400, { message: '榜单标识无效' })
  const limit = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get('limit') ?? 50) || 50))
  const cacheKey = `${source}:${id}:${limit}`
  const cached = chartDetailCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return jsonResponse(response, 200, { chart: cached.chart })
  const numericId = Number(id)
  const loaders = {
    tx: () => loadQqChart(numericId, limit),
    wy: () => loadNeteaseChart(numericId, limit),
    kw: () => loadKuwoChart(numericId, limit),
    kg: () => loadKugouChart(numericId, limit),
    mg: () => loadMiguChart(numericId, limit),
  }
  const chart = await loaders[source as keyof typeof loaders]()
  if (!chart.tracks.length) return jsonResponse(response, 502, { message: '这个榜单暂时没有返回歌曲' })
  chartDetailCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, chart })
  return jsonResponse(response, 200, { chart })
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

const fetchLyrics = async (source: string, musicInfo: Record<string, any>) => {
  const songmid = musicInfo.songmid
  if (songmid == null || songmid === '') throw new Error('歌曲缺少歌词标识')

  if (source === 'wy') {
    const url = new URL('https://music.163.com/api/song/lyric')
    Object.entries({ id: String(songmid), lv: '-1', tv: '-1', rv: '-1', kv: '-1' }).forEach(([key, value]) => url.searchParams.set(key, value))
    const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://music.163.com/' } })
    return { lyric: String(data?.lrc?.lyric ?? ''), translation: String(data?.tlyric?.lyric ?? '') }
  }

  if (source === 'tx') {
    const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg')
    Object.entries({ songmid: String(songmid), format: 'json', nobase64: '1' }).forEach(([key, value]) => url.searchParams.set(key, value))
    const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://y.qq.com/' } })
    return { lyric: decodeLyricEntities(String(data?.lyric ?? '')), translation: decodeLyricEntities(String(data?.trans ?? '')) }
  }

  if (source === 'kw') {
    const url = new URL('https://kuwo.cn/openapi/v1/www/lyric/getlyric')
    url.searchParams.set('musicId', String(songmid))
    const data = await fetchJson(url, { headers: { ...browserHeaders, Referer: 'https://www.kuwo.cn/' } })
    const lines = Array.isArray(data?.data?.lrclist) ? data.data.lrclist : []
    const lyric = lines.map((line: any) => `${lyricTimestamp(Number(line.time ?? 0))}${String(line.lineLyric ?? '').trim()}`).join('\n')
    return { lyric, translation: '' }
  }

  if (source === 'mg') {
    const lyricUrl = parseRemoteUrl(musicInfo.lrcUrl)
    const upstream = await fetch(lyricUrl, { headers: browserHeaders, signal: AbortSignal.timeout(12_000) })
    if (!upstream.ok) throw new Error(`咪咕歌词服务返回 ${upstream.status}`)
    return { lyric: await upstream.text(), translation: '' }
  }

  if (source === 'kg') {
    const lyricHeaders = { ...browserHeaders, 'User-Agent': 'Kugou2012-9020-ExpandSearchHeadTip-Protocol878', Referer: 'https://www.kugou.com/' }
    const searchUrl = new URL('https://lyrics.kugou.com/search')
    Object.entries({ ver: '1', man: 'yes', client: 'pc', hash: String(musicInfo.hash ?? songmid) }).forEach(([key, value]) => searchUrl.searchParams.set(key, value))
    const searchData = await fetchJson(searchUrl, { headers: lyricHeaders })
    const candidate = Array.isArray(searchData?.candidates) ? searchData.candidates[0] : null
    if (!candidate?.id || !candidate?.accesskey) return { lyric: '', translation: '' }
    const downloadUrl = new URL('https://lyrics.kugou.com/download')
    Object.entries({ ver: '1', client: 'pc', id: String(candidate.id), accesskey: String(candidate.accesskey), fmt: 'lrc', charset: 'utf8' }).forEach(([key, value]) => downloadUrl.searchParams.set(key, value))
    const downloadData = await fetchJson(downloadUrl, { headers: lyricHeaders })
    const content = typeof downloadData?.content === 'string' ? downloadData.content : ''
    return { lyric: content ? Buffer.from(content, 'base64').toString('utf8') : '', translation: '' }
  }

  throw new Error('当前平台暂不支持歌词')
}

const handleLyricsRequest = async (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
  const payload = await readJsonBody(request)
  const source = typeof payload.source === 'string' ? payload.source : ''
  const musicInfo = payload.musicInfo && typeof payload.musicInfo === 'object' ? payload.musicInfo as Record<string, any> : {}
  if (!['tx', 'wy', 'kw', 'mg', 'kg'].includes(source)) return jsonResponse(response, 400, { message: '歌词平台无效' })
  const result = await fetchLyrics(source, musicInfo)
  if (!result.lyric.trim()) return jsonResponse(response, 404, { message: '这首歌曲暂时没有歌词' })
  return jsonResponse(response, 200, result)
}

const normalizeRequestBody = (options: Record<string, any>) => {
  if (typeof options.body === 'string') return options.body
  if (options.form && typeof options.form === 'object') return new URLSearchParams(Object.entries(options.form).map(([key, value]) => [key, String(value)])).toString()
  if (options.formData && typeof options.formData === 'object') return new URLSearchParams(Object.entries(options.formData).map(([key, value]) => [key, String(value)])).toString()
  return undefined
}

const applyMiguListenCompatibility = (target: URL) => {
  const isLegacyScriptRequest = target.hostname === 'app.c.nf.migu.cn' && target.pathname === '/MIGUM2.0/strategy/listen-url/v2.4'
  if (!isLegacyScriptRequest) return false
  target.pathname = '/MIGUM2.0/v2.0/content/listen-url'
  target.searchParams.set('netType', '00')
  target.searchParams.set('resourceType', '2')
  return true
}

const handleSourceRequest = async (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
  const payload = await readJsonBody(request)
  const target = parseRemoteUrl(payload.url)
  const miguCompatibilityRequest = applyMiguListenCompatibility(target)
  const options = payload.options && typeof payload.options === 'object' ? payload.options as Record<string, any> : {}
  const headers = new Headers()
  if (options.headers && typeof options.headers === 'object') {
    for (const [key, value] of Object.entries(options.headers)) {
      if (value == null || ['host', 'content-length', 'connection', 'cookie'].includes(key.toLowerCase())) continue
      headers.set(key, String(value))
    }
  }
  if (!headers.has('user-agent')) headers.set('user-agent', browserHeaders['User-Agent'])
  const method = typeof options.method === 'string' ? options.method.toUpperCase() : 'GET'
  const upstream = await fetch(target, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : normalizeRequestBody(options), signal: AbortSignal.timeout(Math.min(60_000, Math.max(1000, Number(options.timeout ?? 20_000)))) })
  const rawBody = await upstream.text()
  let body: any = rawBody
  try { body = JSON.parse(rawBody) } catch { /* text response */ }
  if (miguCompatibilityRequest) {
    const playableUrl = typeof body?.data?.url === 'string' ? body.data.url : ''
    body = playableUrl
      ? { code: 200, msg: 'ok', data: { url: playableUrl } }
      : { code: 403, msg: String(body?.data?.dialogInfo?.text ?? body?.info ?? '这首咪咕歌曲当前没有可用的试听地址'), data: null }
  }
  return jsonResponse(response, 200, {
    statusCode: upstream.status,
    statusMessage: upstream.statusText,
    headers: Object.fromEntries(upstream.headers),
    body,
  })
}

const handleAiRequest = async (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
  const payload = await readJsonBody(request)
  const target = parseAiRemoteUrl(payload.url, payload.provider)
  const sourceHeaders = payload.headers && typeof payload.headers === 'object' ? payload.headers as Record<string, unknown> : {}
  const allowedHeaders = new Set(['authorization', 'content-type', 'x-api-key', 'anthropic-version'])
  const headers = new Headers()
  for (const [key, value] of Object.entries(sourceHeaders)) {
    if (value != null && allowedHeaders.has(key.toLowerCase())) headers.set(key, String(value))
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body ?? {}),
      redirect: 'error',
      signal: controller.signal,
    })
    const rawBody = await upstream.text()
    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      body = { message: upstream.ok ? 'AI 服务返回了无法解析的响应' : rawBody.slice(0, 500) || `AI 服务返回 ${upstream.status}` }
    }
    return jsonResponse(response, upstream.status, body)
  } catch (error) {
    const timedOut = controller.signal.aborted
    return jsonResponse(response, timedOut ? 504 : 502, { message: timedOut ? 'AI 服务响应超时' : '无法连接 AI 服务，请检查接口地址和网络' })
  } finally {
    clearTimeout(timeout)
  }
}

const handleMedia = async (request: import('node:http').IncomingMessage, requestUrl: URL, response: import('node:http').ServerResponse) => {
  const target = parseRemoteUrl(requestUrl.searchParams.get('url'))
  const headers: Record<string, string> = { ...browserHeaders, 'Accept-Encoding': 'identity' }
  if (request.headers.range) headers.Range = request.headers.range
  const controller = new AbortController()
  const connectTimer = setTimeout(() => controller.abort(), 30_000)
  const upstream = await fetch(target, { headers, redirect: 'follow', signal: controller.signal }).finally(() => clearTimeout(connectTimer))
  response.statusCode = upstream.status
  const passthroughHeaders = ['content-type', 'content-range', 'accept-ranges', 'last-modified', 'etag']
  if (!upstream.headers.get('content-encoding')) passthroughHeaders.push('content-length')
  for (const header of passthroughHeaders) {
    const value = upstream.headers.get(header)
    if (value) response.setHeader(header, value)
  }
  response.setHeader('Content-Type', normalizedMediaContentType(target, upstream.headers.get('content-type')))
  response.setHeader('Cache-Control', 'private, max-age=300')
  if (!upstream.body) return response.end()
  const stream = Readable.fromWeb(upstream.body as any)
  stream.on('error', () => {
    if (!response.destroyed) response.destroy()
  })
  response.on('close', () => {
    controller.abort()
    if (!stream.destroyed) stream.destroy()
  })
  stream.pipe(response)
}

const installMusicGateway = (server: { middlewares: { use: (handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, next: () => void) => void) => void } }) => {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith(gatewayPrefix) && !request.url?.startsWith('/__echora/ai')) return next()
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1')
      if (request.method === 'POST' && requestUrl.pathname === aiGatewayPath) return await handleAiRequest(request, response)
      if (request.method === 'GET' && requestUrl.pathname === `${gatewayPrefix}/search`) return await handleSearch(requestUrl, response)
      if (request.method === 'GET' && (requestUrl.pathname === `${gatewayPrefix}/charts/catalog` || requestUrl.pathname === `${gatewayPrefix}/charts`)) return await handleChartCatalog(requestUrl, response)
      const chartDetailMatch = requestUrl.pathname.match(new RegExp(`^${gatewayPrefix}/charts/(tx|wy|kw|kg|mg)/(\\d+)$`))
      if (request.method === 'GET' && chartDetailMatch) return await handleChartDetail(chartDetailMatch[1], chartDetailMatch[2], requestUrl, response)
      if (request.method === 'POST' && requestUrl.pathname === `${gatewayPrefix}/request`) return await handleSourceRequest(request, response)
      if (request.method === 'POST' && requestUrl.pathname === `${gatewayPrefix}/lyrics`) return await handleLyricsRequest(request, response)
      if (request.method === 'GET' && requestUrl.pathname === `${gatewayPrefix}/media`) return await handleMedia(request, requestUrl, response)
      return jsonResponse(response, 404, { message: '音乐网关路径不存在' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '音乐网关请求失败'
      return jsonResponse(response, 502, { message })
    }
  })
}

const musicGateway = (): Plugin => ({
  name: 'echora-music-gateway',
  configureServer: installMusicGateway,
  configurePreviewServer: installMusicGateway,
})

const platformSelector = (selector: string, platform: 'desktop' | 'mobile') => {
  const gate = `html[data-ui-platform="${platform}"]`
  const trimmed = selector.trim()
  if (trimmed.startsWith('html')) return trimmed.replace(/^html\b/, gate)
  if (trimmed.startsWith(':root')) return trimmed.replace(/^:root\b/, gate)
  return `${gate} ${trimmed}`
}

const isInsideKeyframes = (rule: postcss.Rule) => {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return true
    parent = parent.parent
  }
  return false
}

const platformCssBoundaries = (): Plugin => ({
  name: 'echora-platform-css-boundaries',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?', 1)[0]
    if (!file.endsWith('/styles.css') && !file.endsWith('/material.css')) return null
    const root = postcss.parse(code, { from: file })
    root.walkAtRules('media', (media) => {
      const maxWidth = media.params.match(/\(max-width:\s*(\d+)px\)/i)
      const minDesktop = media.params.match(/\(min-width:\s*821px\)/i)
      const mobileBoundary = maxWidth ? Number(maxWidth[1]) : null
      const platform = mobileBoundary !== null && mobileBoundary <= 980 ? 'mobile' : minDesktop ? 'desktop' : null
      if (!platform) return
      media.walkRules((rule) => {
        if (isInsideKeyframes(rule)) return
        rule.selectors = rule.selectors.map((selector) => platformSelector(selector, platform))
      })
      if (platform !== 'mobile' || mobileBoundary !== 820) return
      const remaining = media.params
        .split(/\s+and\s+/i)
        .filter((part) => !/\(max-width:\s*820px\)/i.test(part))
        .join(' and ')
        .trim()
      if (remaining) media.params = remaining
      else media.replaceWith(...(media.nodes ?? []))
    })
    return { code: root.toString(), map: null }
  },
})

const configuredUiPlatform = process.env.VITE_ECHORA_UI_PLATFORM
const selectorPlatform = (selector: string): 'desktop' | 'mobile' | null => {
  const hasDesktop = /data-(?:ui-platform|platform-entry|form-factor)=["']desktop["']/.test(selector)
  const hasMobile = /data-(?:ui-platform|platform-entry|form-factor)=["']mobile["']/.test(selector)
  if (hasDesktop === hasMobile) return null
  return hasDesktop ? 'desktop' : 'mobile'
}

const platformCssPruning = (): Plugin => ({
  name: 'echora-platform-css-pruning',
  enforce: 'pre',
  transform(code, id) {
    const platform = process.env.VITE_ECHORA_UI_PLATFORM
    const file = id.split('?', 1)[0]
    if ((platform !== 'desktop' && platform !== 'mobile') || !file.endsWith('.css')) return null
    const root = postcss.parse(code, { from: file })
    root.walkRules((rule) => {
      if (isInsideKeyframes(rule)) return
      const selectors = rule.selectors.filter((selector) => selectorPlatform(selector) !== (platform === 'desktop' ? 'mobile' : 'desktop'))
      if (!selectors.length) rule.remove()
      else rule.selectors = selectors
    })
    root.walkAtRules((rule) => {
      if (!rule.nodes?.length) rule.remove()
    })
    return { code: root.toString(), map: null }
  },
})

const developmentPort = configuredUiPlatform === 'mobile' ? 1421 : configuredUiPlatform === 'desktop' ? 1422 : 1420
const tauriDevelopmentHost = process.env.TAURI_DEV_HOST
const applicationPackage = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const applicationBuildId = process.env.ECHORA_BUILD_ID?.trim() || applicationPackage.version
const versionManifest = (): Plugin => ({
  name: 'echora-version-manifest',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: `${JSON.stringify({ version: applicationPackage.version, buildId: applicationBuildId })}\n`,
    })
  },
})

export default defineConfig({
  plugins: [react(), platformCssBoundaries(), platformCssPruning(), musicGateway(), versionManifest()],
  define: {
    __ECHORA_VERSION__: JSON.stringify(applicationPackage.version),
    __ECHORA_BUILD_ID__: JSON.stringify(applicationBuildId),
  },
  server: {
    host: tauriDevelopmentHost ?? '127.0.0.1',
    port: developmentPort,
    strictPort: true,
    hmr: tauriDevelopmentHost ? { protocol: 'ws', host: tauriDevelopmentHost, port: developmentPort } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  clearScreen: false,
})
