export type PlaybackShortcutAction =
  | { type: 'toggle-playback' }
  | { type: 'seek-by'; seconds: number }
  | { type: 'seek-to'; progress: 0 | 100 }
  | { type: 'change-volume'; amount: number }
  | { type: 'toggle-mute' }
  | { type: 'previous-track' }
  | { type: 'next-track' }
  | { type: 'exit-song-mode' }

type KeyboardInput = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'target'>

const isInteractiveTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button, input, select, textarea, a, [contenteditable="true"], [role="slider"], [role="menu"], [role="dialog"]'))

export const resolvePlaybackShortcut = (event: KeyboardInput, seekStepSeconds = 5): PlaybackShortcutAction | null => {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  const key = event.key.toLocaleLowerCase()

  if (key === 'mediaplaypause') return event.repeat ? null : { type: 'toggle-playback' }
  if (key === 'mediatrackprevious') return event.repeat ? null : { type: 'previous-track' }
  if (key === 'mediatracknext') return event.repeat ? null : { type: 'next-track' }
  if (key === 'audiovolumemute') return event.repeat ? null : { type: 'toggle-mute' }
  if (key === 'audiovolumeup') return { type: 'change-volume', amount: 5 }
  if (key === 'audiovolumedown') return { type: 'change-volume', amount: -5 }

  if (isInteractiveTarget(event.target)) return null
  if (key === 'escape') return event.repeat ? null : { type: 'exit-song-mode' }
  if (key === ' ' || key === 'spacebar' || event.code === 'Space') return event.repeat ? null : { type: 'toggle-playback' }
  if (key === 'arrowleft') return event.shiftKey ? (event.repeat ? null : { type: 'previous-track' }) : { type: 'seek-by', seconds: -seekStepSeconds }
  if (key === 'arrowright') return event.shiftKey ? (event.repeat ? null : { type: 'next-track' }) : { type: 'seek-by', seconds: seekStepSeconds }
  if (key === 'arrowup') return { type: 'change-volume', amount: 5 }
  if (key === 'arrowdown') return { type: 'change-volume', amount: -5 }
  if (key === 'm') return event.repeat ? null : { type: 'toggle-mute' }
  if (key === 'home') return event.repeat ? null : { type: 'seek-to', progress: 0 }
  if (key === 'end') return event.repeat ? null : { type: 'seek-to', progress: 100 }
  return null
}
