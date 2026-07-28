import { useEffect, useMemo, useRef, useState } from 'react'

type RecognitionResult = { isFinal: boolean; 0?: { transcript?: string } }
type RecognitionEvent = { results: ArrayLike<RecognitionResult> }
type RecognitionErrorEvent = { error?: string }
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionConstructor = new () => Recognition
export type SpeechInputStatus = 'idle' | 'requesting' | 'listening' | 'error'

type NativeSpeechEvent =
  | { type: 'status'; status: 'requesting' | 'listening' | 'stopping'; generation: number }
  | { type: 'transcript'; text: string; final: boolean; generation: number }
  | { type: 'ended'; generation: number }
  | { type: 'error'; code: string; generation: number }

const recognitionConstructor = () => {
  const target = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return target.SpeechRecognition ?? target.webkitSpeechRecognition
}

const isIosNativeRuntime = () => typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && /iPad|iPhone|iPod/i.test(navigator.userAgent)

export const parseNativeSpeechEvent = (payload: unknown): NativeSpeechEvent | null => {
  if (typeof payload !== 'string') return null
  try {
    const event = JSON.parse(payload) as Record<string, unknown>
    if (!Number.isInteger(event.generation) || Number(event.generation) < 1) return null
    const generation = Number(event.generation)
    if (event.type === 'status' && ['requesting', 'listening', 'stopping'].includes(String(event.status))) {
      return { type: 'status', status: event.status as 'requesting' | 'listening' | 'stopping', generation }
    }
    if (event.type === 'transcript' && typeof event.text === 'string' && typeof event.final === 'boolean') {
      return { type: 'transcript', text: event.text, final: event.final, generation }
    }
    if (event.type === 'ended') return { type: 'ended', generation }
    if (event.type === 'error' && typeof event.code === 'string') return { type: 'error', code: event.code, generation }
  } catch {
    return null
  }
  return null
}

const invokeNativeSpeech = async (command: 'start_ios_speech_recognition' | 'stop_ios_speech_recognition' | 'cancel_ios_speech_recognition', payload?: Record<string, unknown>) => {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke(command, payload)
}

const speechErrorMessage = (error = '') => {
  if (error === 'not-allowed' || error === 'service-not-allowed') return '麦克风权限未开启，请在系统设置中允许 Echora 使用麦克风'
  if (error === 'no-speech') return '没有听到清晰语音，请重试'
  if (error === 'audio-capture') return '当前设备无法使用麦克风'
  if (error === 'network') return '语音识别服务暂时不可用'
  return '语音输入未能开始，请重试'
}

const permissionErrorMessage = (error: unknown) => {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return '麦克风权限未开启，请在系统设置中允许 Echora 使用麦克风'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '没有找到可用的麦克风'
  return '暂时无法访问麦克风，请检查设备权限'
}

export default function useSpeechInput(onText: (value: string) => void) {
  const nativeIos = useMemo(isIosNativeRuntime, [])
  const supported = useMemo(() => nativeIos || (typeof window !== 'undefined' && Boolean(recognitionConstructor())), [nativeIos])
  const recognitionRef = useRef<Recognition | null>(null)
  const onTextRef = useRef(onText)
  const baseTextRef = useRef('')
  const generationRef = useRef(0)
  const errorGenerationRef = useRef(-1)
  const noticeTimerRef = useRef<number | null>(null)
  const [status, setStatus] = useState<SpeechInputStatus>('idle')
  const [message, setMessage] = useState('')
  onTextRef.current = onText

  const clearNoticeTimer = () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = null
  }

  const reset = () => {
    generationRef.current += 1
    errorGenerationRef.current = -1
    clearNoticeTimer()
    recognitionRef.current?.abort()
    recognitionRef.current = null
    if (nativeIos) void invokeNativeSpeech('cancel_ios_speech_recognition').catch(() => undefined)
    baseTextRef.current = ''
    setStatus('idle')
    setMessage('')
  }

  useEffect(() => {
    if (!nativeIos) return () => {
      generationRef.current += 1
      clearNoticeTimer()
      recognitionRef.current?.abort()
    }
    let cancelled = false
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stopListening = await listen<string>('echora://ios-speech', ({ payload }) => {
        const event = parseNativeSpeechEvent(payload)
        if (!event || event.generation !== generationRef.current) return
        if (event.type === 'status') {
          if (event.status === 'requesting') {
            setStatus('requesting')
            setMessage('正在等待语音与麦克风授权')
          } else if (event.status === 'listening') {
            setStatus('listening')
            setMessage('正在聆听，请开始说话')
          } else {
            setMessage('正在结束听写')
          }
          return
        }
        if (event.type === 'transcript') {
          const transcript = event.text.trim()
          onTextRef.current([baseTextRef.current, transcript].filter(Boolean).join(baseTextRef.current && transcript ? ' ' : ''))
          setMessage('正在听写，点击麦克风结束')
          return
        }
        if (event.type === 'error') {
          errorGenerationRef.current = event.generation
          setStatus('error')
          setMessage(speechErrorMessage(event.code))
          return
        }
        setStatus('idle')
        setMessage('语音输入已结束')
        noticeTimerRef.current = window.setTimeout(() => {
          if (generationRef.current === event.generation) setMessage('')
        }, 1800)
      })
      if (cancelled) stopListening()
      else unlisten = stopListening
    }).catch(() => {
      if (!cancelled) {
        setStatus('error')
        setMessage('原生语音服务未能连接，请重试')
      }
    })
    return () => {
      cancelled = true
      generationRef.current += 1
      clearNoticeTimer()
      unlisten?.()
      void invokeNativeSpeech('cancel_ios_speech_recognition').catch(() => undefined)
    }
  }, [nativeIos])

  const stop = () => {
    if (nativeIos) {
      setMessage('正在结束听写')
      void invokeNativeSpeech('stop_ios_speech_recognition').catch(() => {
        setStatus('error')
        setMessage('语音输入未能结束，请重试')
      })
      return
    }
    if (!recognitionRef.current) return
    setMessage('正在结束听写')
    recognitionRef.current.stop()
  }

  const start = async (baseText: string) => {
    if (nativeIos) {
      const generation = generationRef.current + 1
      generationRef.current = generation
      errorGenerationRef.current = -1
      clearNoticeTimer()
      baseTextRef.current = baseText.trim()
      setStatus('requesting')
      setMessage('正在等待语音与麦克风授权')
      try {
        await invokeNativeSpeech('start_ios_speech_recognition', { generation })
      } catch {
        if (generationRef.current !== generation) return
        setStatus('error')
        setMessage('原生语音服务未能启动，请重试')
      }
      return
    }
    const Constructor = recognitionConstructor()
    if (!Constructor) {
      setStatus('error')
      setMessage('当前环境暂不支持语音输入')
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    errorGenerationRef.current = -1
    clearNoticeTimer()
    recognitionRef.current?.abort()
    recognitionRef.current = null
    baseTextRef.current = baseText.trim()
    setStatus('requesting')
    setMessage('正在等待麦克风授权')

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Microphone access unavailable', 'NotSupportedError')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      if (generationRef.current !== generation) return

      const recognition = new Constructor()
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onresult = (event) => {
        if (generationRef.current !== generation) return
        const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join('').trim()
        onText([baseTextRef.current, transcript].filter(Boolean).join(baseTextRef.current && transcript ? ' ' : ''))
        setMessage('正在听写，点击麦克风结束')
      }
      recognition.onerror = (event) => {
        if (generationRef.current !== generation) return
        errorGenerationRef.current = generation
        setStatus('error')
        setMessage(speechErrorMessage(event.error))
        recognitionRef.current = null
      }
      recognition.onend = () => {
        if (generationRef.current !== generation) return
        recognitionRef.current = null
        if (errorGenerationRef.current === generation) return
        setStatus('idle')
        setMessage('语音输入已结束')
        noticeTimerRef.current = window.setTimeout(() => {
          if (generationRef.current === generation) setMessage('')
        }, 1800)
      }
      recognitionRef.current = recognition
      setStatus('listening')
      setMessage('正在聆听，请开始说话')
      try {
        recognition.start()
      } catch (error) {
        recognitionRef.current = null
        errorGenerationRef.current = generation
        setStatus('error')
        setMessage(permissionErrorMessage(error))
      }
    } catch (error) {
      if (generationRef.current !== generation) return
      setStatus('error')
      setMessage(permissionErrorMessage(error))
    }
  }

  return { supported, listening: status === 'listening', requesting: status === 'requesting', status, message, start, stop, reset }
}
