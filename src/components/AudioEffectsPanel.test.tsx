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
    fireEvent.click(screen.getByRole('button', { name: '调音' }))
    fireEvent.change(screen.getByRole('slider', { name: '32 Hz' }), { target: { value: '8' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ bands: [8, ...effectProfiles['人声向前'].curve.slice(1)] }))
  })

  it('keeps device compensation and equalizer changes layered on the selected effect', () => {
    const onChange = vi.fn()
    render(<AudioEffectsPanel settings={defaultAudioEffects} onChange={onChange} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '设备' }))
    fireEvent.click(screen.getByRole('button', { name: /桌面音箱/ }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ effect: defaultAudioEffects.effect, deviceProfile: 'desktop', bands: defaultAudioEffects.bands }))
    expect(screen.getByText('在当前预设上修正通用设备特性，不切换系统输出')).toBeTruthy()
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

  it('shows when the current online track bypasses the processing chain', () => {
    render(<AudioEffectsPanel processingState="bypassed" settings={{ ...defaultAudioEffects, enabled: true }} onChange={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('直连旁路')).toBeTruthy()
    expect(screen.getByTitle('当前在线版本不允许浏览器接入音效处理')).toBeTruthy()
  })

  it('keeps sound controls configurable before effects are enabled', () => {
    const onChange = vi.fn()
    render(<AudioEffectsPanel settings={{ ...defaultAudioEffects, enabled: false }} onChange={onChange} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('slider', { name: '低频量' }), { target: { value: '36' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, bass: 36 }))
    fireEvent.change(screen.getByRole('slider', { name: '细节量' }), { target: { value: '61' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, clarity: 61 }))
    fireEvent.change(screen.getByRole('slider', { name: '空间量' }), { target: { value: '58' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, spatialAmount: 58 }))
  })

  it('maps the loudness selector to the playback settings', () => {
    const onChange = vi.fn()
    render(<AudioEffectsPanel settings={defaultAudioEffects} onChange={onChange} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '调音' }))
    fireEvent.click(screen.getByRole('button', { name: /增强/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ loudnessMode: 'strong', normalize: true }))
    fireEvent.click(screen.getByRole('button', { name: /原始/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ loudnessMode: 'off', normalize: false }))
  })
})
