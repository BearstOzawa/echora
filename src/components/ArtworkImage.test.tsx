import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ArtworkImage from './ArtworkImage'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ArtworkImage', () => {
  it('uses the Echora mark when remote artwork cannot load', () => {
    render(<ArtworkImage src="https://music.example/missing.jpg" alt="歌曲封面" />)
    const image = screen.getByAltText('歌曲封面') as HTMLImageElement
    fireEvent.error(image)
    expect(image.getAttribute('src')).toBe('/echora-mark-v2.svg')
    expect(image.classList.contains('is-artwork-fallback')).toBe(true)
    fireEvent.error(image)
    expect(image.getAttribute('src')).toBe('/echora-mark-v2.svg')
  })

  it('does not request the same failed artwork again during the retry window', () => {
    const missingArtwork = 'https://music.example/repeated-missing.jpg'
    const first = render(<ArtworkImage src={missingArtwork} alt="第一处封面" />)
    fireEvent.error(screen.getByAltText('第一处封面'))
    first.unmount()

    render(<ArtworkImage src={missingArtwork} alt="第二处封面" />)
    expect(screen.getByAltText('第二处封面').getAttribute('src')).toBe('/echora-mark-v2.svg')
  })

  it('preserves the image load callback', () => {
    const onLoad = vi.fn()
    render(<ArtworkImage src="https://music.example/cover.jpg" alt="可用封面" onLoad={onLoad} />)
    fireEvent.load(screen.getByAltText('可用封面'))
    expect(onLoad).toHaveBeenCalledOnce()
  })

  it('releases a stalled artwork request and falls back after the load timeout', () => {
    vi.useFakeTimers()
    render(<ArtworkImage src="https://music.example/stalled.jpg" alt="超时封面" />)
    const image = screen.getByAltText('超时封面') as HTMLImageElement

    expect(image.getAttribute('src')).toBe('https://music.example/stalled.jpg')
    act(() => vi.advanceTimersByTime(12_000))

    expect(image.getAttribute('src')).toBe('/echora-mark-v2.svg')
    expect(image.classList.contains('is-artwork-fallback')).toBe(true)
  })
})
