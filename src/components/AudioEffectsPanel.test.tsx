import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultAudioEffects, effectProfiles } from '../audioEffects'
import AudioEffectsPanel from './AudioEffectsPanel'

afterEach(cleanup)

describe('AudioEffectsPanel', () => {
  it('writes preset and equalizer changes into the shared playback settings', () => {
    const onChange = vi.fn()
    const view = render(<AudioEffectsPanel settings={defaultAudioEffects} onChange={onChange} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /人声向前/ }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultAudioEffects, effect: '人声向前', bands: [...effectProfiles['人声向前'].curve] })

    view.rerender(<AudioEffectsPanel settings={{ ...defaultAudioEffects, effect: '人声向前', bands: [...effectProfiles['人声向前'].curve] }} onChange={onChange} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '均衡器' }))
    fireEvent.change(screen.getByRole('slider', { name: '32 Hz' }), { target: { value: '8' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ bands: [8, ...effectProfiles['人声向前'].curve.slice(1)] }))
  })

  it('keeps device compensation and equalizer changes layered on the selected effect', () => {
    const onChange = vi.fn()
    render(<AudioEffectsPanel settings={defaultAudioEffects} onChange={onChange} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '设备' }))
    fireEvent.click(screen.getByRole('button', { name: /桌面音箱/ }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ effect: defaultAudioEffects.effect, deviceProfile: 'desktop', bands: defaultAudioEffects.bands }))
    expect(screen.getByText(new RegExp(`在“${defaultAudioEffects.effect}”音效上`))).toBeTruthy()
  })

  it('uses mobile playback-device profiles without desktop-only choices', () => {
    render(<AudioEffectsPanel mobile settings={defaultAudioEffects} onChange={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '设备' }))
    expect(screen.getByRole('button', { name: /手机扬声器/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /无线耳机/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /外接解码器/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /笔记本扬声器/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /桌面音箱/ })).toBeNull()
  })
})
