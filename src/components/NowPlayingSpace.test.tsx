import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackProgressStore } from '../playbackProgress'
import { initialTracks } from '../testFixtures'
import NowPlayingSpace from './NowPlayingSpace'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const renderNowPlaying = () => {
  const actions = {
    onSeek: vi.fn(),
    onPlayTrack: vi.fn(),
    onOpenArtist: vi.fn(),
    onOpenAlbum: vi.fn(),
  }
  render(<NowPlayingSpace track={initialTracks[2]} isPlaying progressStore={createPlaybackProgressStore(30)} lyrics={[{ time: 0, text: '第一句' }, { time: 47, text: '真实歌词', translation: 'Real lyric' }]} lyricsStatus="ready" lyricsMessage="" relatedTracks={[initialTracks[0]]} reducedMotion={false} {...actions} />)
  return actions
}

describe('NowPlayingSpace', () => {
  it('keeps the desktop and web song page in split view', () => {
    render(<NowPlayingSpace track={initialTracks[2]} isPlaying={false} progressStore={createPlaybackProgressStore()} lyrics={[{ time: 0, text: '第一句' }]} lyricsStatus="ready" lyricsMessage="" relatedTracks={[]} reducedMotion onSeek={vi.fn()} onPlayTrack={vi.fn()} onOpenArtist={vi.fn()} onOpenAlbum={vi.fn()} />)
    expect(screen.getByRole('region', { name: '同步歌词' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: initialTracks[2].title })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '显示歌词' })).toBeNull()
  })

  it('uses record and lyrics as the two mobile modes', () => {
    render(<NowPlayingSpace mobile track={initialTracks[2]} isPlaying={false} progressStore={createPlaybackProgressStore()} lyrics={[{ time: 0, text: '第一句' }]} lyricsStatus="ready" lyricsMessage="" relatedTracks={[]} reducedMotion onSeek={vi.fn()} onPlayTrack={vi.fn()} onOpenArtist={vi.fn()} onOpenAlbum={vi.fn()} />)
    expect(screen.queryByRole('region', { name: '同步歌词' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '显示歌词' }))
    expect(screen.getByRole('region', { name: '同步歌词' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /第一句/ }))
    expect(screen.queryByRole('region', { name: '同步歌词' })).toBeNull()
  })

  it('seeks directly from an interactive lyric line', () => {
    const actions = renderNowPlaying()
    fireEvent.click(screen.getByRole('button', { name: /真实歌词/ }))
    expect(actions.onSeek).toHaveBeenCalledWith((47 / initialTracks[2].durationSeconds) * 100)
  })

  it('leaves exit and playback controls to the global player', () => {
    renderNowPlaying()
    expect(screen.queryByRole('button', { name: '返回上一页' })).toBeNull()
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
    expect(document.querySelector('.now-playing-spectrum')).toBeNull()
    expect(screen.getByAltText(`${initialTracks[2].title} 封面`).closest('.now-playing-cover-stage')).toBeTruthy()
  })

  it('shows a real loading state instead of demo lyrics', () => {
    render(<NowPlayingSpace track={initialTracks[2]} isPlaying={false} progressStore={createPlaybackProgressStore()} lyrics={[]} lyricsStatus="loading" lyricsMessage="正在载入歌词" relatedTracks={[]} reducedMotion onSeek={vi.fn()} onPlayTrack={vi.fn()} onOpenArtist={vi.fn()} onOpenAlbum={vi.fn()} />)
    expect(screen.getByText('正在载入歌词')).toBeTruthy()
    expect(screen.queryByText('City lights are folding into blue')).toBeNull()
  })

  it('persists lyric sizing and updates density metrics together', () => {
    const actions = {
      onSeek: vi.fn(),
      onPlayTrack: vi.fn(),
      onOpenArtist: vi.fn(),
      onOpenAlbum: vi.fn(),
    }
    render(<NowPlayingSpace track={initialTracks[2]} isPlaying progressStore={createPlaybackProgressStore(30)} lyrics={[{ time: 0, text: '第一句' }]} lyricsStatus="ready" lyricsMessage="" relatedTracks={[]} reducedMotion={false} fontControlsOpen {...actions} />)
    fireEvent.change(screen.getByRole('slider', { name: '歌词字号级别' }), { target: { value: '1' } })
    expect(localStorage.getItem('echora.lyricFontLevel')).toBe('1')
    const pane = screen.getByRole('region', { name: '同步歌词' })
    expect(pane.style.getPropertyValue('--lyric-content-width')).toBe('')
    expect(pane.style.getPropertyValue('--lyric-line-height')).toBe('60px')
    fireEvent.change(screen.getByRole('slider', { name: '歌词字号级别' }), { target: { value: '-5' } })
    expect(localStorage.getItem('echora.lyricFontLevel')).toBe('-5')
    expect(pane.style.getPropertyValue('--lyric-scale-position')).toBe('0%')
    expect(pane.style.getPropertyValue('--lyric-content-width')).toBe('')
  })

  it('does not render a lyric-side font trigger', () => {
    renderNowPlaying()
    expect(screen.queryByRole('button', { name: '调整歌词字号' })).toBeNull()
  })

  it('shows real track information and playable related songs', () => {
    const actions = renderNowPlaying()
    fireEvent.click(screen.getByRole('button', { name: '歌曲信息' }))
    expect(screen.getByRole('tabpanel', { name: '歌曲信息' })).toBeTruthy()
    expect(screen.getByText(initialTracks[2].quality)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '相关歌曲' }))
    fireEvent.click(screen.getByRole('button', { name: /Slow Satellites/ }))
    expect(actions.onPlayTrack).toHaveBeenCalledWith(initialTracks[0])
  })

  it('opens artist and album entities from song mode', () => {
    const actions = renderNowPlaying()
    fireEvent.click(screen.getByRole('button', { name: initialTracks[2].artist }))
    fireEvent.click(screen.getByRole('button', { name: initialTracks[2].album }))
    expect(actions.onOpenArtist).toHaveBeenCalledWith(initialTracks[2])
    expect(actions.onOpenAlbum).toHaveBeenCalledWith(initialTracks[2])
  })
})
