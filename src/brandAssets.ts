export const brandMarkPath = '/echora-mark-v2.svg'
export const legacyBrandMarkPath = '/brand-mark.svg'

export const normalizeBrandArtwork = (value?: string | null) => {
  if (!value || value === legacyBrandMarkPath) return brandMarkPath
  return value
}

export const isBrandArtwork = (value?: string | null) => !value || value === brandMarkPath || value === legacyBrandMarkPath
