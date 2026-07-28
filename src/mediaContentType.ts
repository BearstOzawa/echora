const mediaTypesByExtension: Record<string, string> = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
}

export const normalizedMediaContentType = (remoteUrl: string | URL, upstreamType: string | null) => {
  const pathname = remoteUrl instanceof URL ? remoteUrl.pathname : new URL(remoteUrl).pathname
  const extension = pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase()
  return (extension && mediaTypesByExtension[extension]) || upstreamType || 'application/octet-stream'
}
