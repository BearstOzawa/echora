import { useEffect, useRef, useState } from 'react'
import type { ImgHTMLAttributes, SyntheticEvent } from 'react'
import { finishArtworkLoad, scheduleArtworkLoad } from '../artworkLoading'
import { brandMarkPath, normalizeBrandArtwork } from '../brandAssets'

const fallbackArtwork = brandMarkPath
const failedArtworkTtlMs = 5 * 60 * 1000
const failedArtworkCacheLimit = 128
const artworkLoadTimeoutMs = 12_000
const failedArtworkSources = new Map<string, number>()

const resolveArtworkSource = (src: ImgHTMLAttributes<HTMLImageElement>['src']) => {
  const normalized = normalizeBrandArtwork(typeof src === 'string' ? src : undefined)
  if (normalized === fallbackArtwork) return normalized
  const failedAt = failedArtworkSources.get(normalized)
  if (failedAt === undefined) return normalized
  if (Date.now() - failedAt < failedArtworkTtlMs) return fallbackArtwork
  failedArtworkSources.delete(normalized)
  return normalized
}

export default function ArtworkImage({ src, alt = '', loading = 'lazy', onError, onLoad, className = '', style, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [resolvedSrc, setResolvedSrc] = useState(() => resolveArtworkSource(src))
  const [eligible, setEligible] = useState(loading === 'eager')
  const [displaySrc, setDisplaySrc] = useState<string | undefined>(() => loading === 'eager' ? resolveArtworkSource(src) : undefined)
  const fallbackActive = useRef(resolvedSrc === fallbackArtwork)
  const imageRef = useRef<HTMLImageElement>(null)
  const loadTokenRef = useRef<symbol | null>(null)
  const loadTimeoutRef = useRef(0)

  useEffect(() => {
    const nextSrc = resolveArtworkSource(src)
    fallbackActive.current = nextSrc === fallbackArtwork
    setResolvedSrc(nextSrc)
  }, [src])

  useEffect(() => {
    if (loading === 'eager' || typeof IntersectionObserver !== 'function') {
      setEligible(true)
      return
    }
    const image = imageRef.current
    if (!image) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setEligible(true)
      observer.disconnect()
    }, { rootMargin: '320px 0px' })
    observer.observe(image)
    return () => observer.disconnect()
  }, [loading])

  useEffect(() => {
    if (!eligible) return
    if (loading === 'eager') {
      setDisplaySrc(resolvedSrc)
      return
    }
    finishArtworkLoad(loadTokenRef.current)
    loadTokenRef.current = scheduleArtworkLoad(() => {
      setDisplaySrc(resolvedSrc)
      window.clearTimeout(loadTimeoutRef.current)
      loadTimeoutRef.current = window.setTimeout(() => {
        finishArtworkLoad(loadTokenRef.current)
        loadTokenRef.current = null
        if (resolvedSrc === fallbackArtwork) return
        if (failedArtworkSources.size >= failedArtworkCacheLimit) failedArtworkSources.delete(failedArtworkSources.keys().next().value!)
        failedArtworkSources.set(resolvedSrc, Date.now())
        fallbackActive.current = true
        setResolvedSrc(fallbackArtwork)
      }, artworkLoadTimeoutMs)
    })
    return () => {
      window.clearTimeout(loadTimeoutRef.current)
      finishArtworkLoad(loadTokenRef.current)
      loadTokenRef.current = null
    }
  }, [eligible, loading, resolvedSrc])

  useEffect(() => () => {
    window.clearTimeout(loadTimeoutRef.current)
    finishArtworkLoad(loadTokenRef.current)
  }, [])

  const completeLoad = () => {
    window.clearTimeout(loadTimeoutRef.current)
    finishArtworkLoad(loadTokenRef.current)
    loadTokenRef.current = null
  }

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    onError?.(event)
    completeLoad()
    if (fallbackActive.current) return
    if (failedArtworkSources.size >= failedArtworkCacheLimit) failedArtworkSources.delete(failedArtworkSources.keys().next().value!)
    failedArtworkSources.set(resolvedSrc, Date.now())
    fallbackActive.current = true
    setResolvedSrc(fallbackArtwork)
  }

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    onLoad?.(event)
    completeLoad()
    if (resolvedSrc !== fallbackArtwork) failedArtworkSources.delete(resolvedSrc)
  }

  const isFallback = resolvedSrc === fallbackArtwork
  // React 18 forwards the standard image hint only in its lowercase DOM form.
  const fetchPriorityAttribute = { fetchpriority: loading === 'eager' ? 'high' : 'low' } as Record<string, string>
  return <img
    {...props}
    {...fetchPriorityAttribute}
    ref={imageRef}
    src={displaySrc}
    alt={alt}
    loading={loading}
    decoding="async"
    className={`${className} ${isFallback ? 'is-artwork-fallback' : ''}`.trim()}
    style={isFallback ? { ...style, boxSizing: 'border-box', objectFit: 'contain', padding: '14%', background: 'transparent' } : style}
    onError={handleError}
    onLoad={handleLoad}
  />
}
