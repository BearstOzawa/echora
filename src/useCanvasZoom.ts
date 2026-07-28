import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_ZOOM = 60
const MAX_ZOOM = 120
const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 10) / 10))

export default function useCanvasZoom(initialZoom = 100, onZoomChange?: (zoom: number) => void) {
  const [zoom, setZoom] = useState(() => clampZoom(initialZoom))
  const viewportRef = useRef<HTMLDivElement>(null)
  const onZoomChangeRef = useRef(onZoomChange)

  useEffect(() => { onZoomChangeRef.current = onZoomChange }, [onZoomChange])
  useEffect(() => { setZoom(clampZoom(initialZoom)) }, [initialZoom])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom((current) => {
        const next = clampZoom(current - event.deltaY * 0.08)
        onZoomChangeRef.current?.(next)
        return next
      })
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(100)
    onZoomChangeRef.current?.(100)
  }, [])

  return {
    zoom,
    zoomLabel: Math.round(zoom),
    isDefaultZoom: zoom === 100,
    viewportRef,
    resetZoom,
  }
}
