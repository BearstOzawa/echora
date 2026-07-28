import { describe, expect, it } from 'vitest'
import { normalizedMediaContentType } from './mediaContentType'

describe('media content type normalization', () => {
  it('corrects provider MIME metadata from the actual media extension', () => {
    expect(normalizedMediaContentType('http://stream.example.com/F000track.flac?token=1', 'audio/x-ogg')).toBe('audio/flac')
    expect(normalizedMediaContentType('https://stream.example.com/track.mp3', 'application/octet-stream')).toBe('audio/mpeg')
  })

  it('preserves upstream metadata when the URL has no known extension', () => {
    expect(normalizedMediaContentType('https://stream.example.com/play?id=1', 'audio/aac')).toBe('audio/aac')
  })
})
