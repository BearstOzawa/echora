import type { OnlineSource, Source } from './types'

export type SourceBrandKey = OnlineSource | 'local'

const sourceKeys: Record<Source, SourceBrandKey> = {
  QQ: 'tx',
  网易云: 'wy',
  酷我: 'kw',
  酷狗: 'kg',
  咪咕: 'mg',
  本地: 'local',
}

export const sourceBrandKey = (source: Source | OnlineSource): SourceBrandKey => {
  if (source === 'tx' || source === 'wy' || source === 'kw' || source === 'kg' || source === 'mg') return source
  return sourceKeys[source] ?? 'local'
}
