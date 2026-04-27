'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'

// Browser SpeechRecognition is vendor-prefixed on some browsers (notably iOS
// Safari, which exposes only `webkitSpeechRecognition`). We narrow to the
// minimum surface we need.
type SpeechRecognitionEvent = Event & {
  results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }> & { isFinal?: boolean }>
  resultIndex: number
}

interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: Event) => void) | null
  onend: (() => void) | null
}

type Ctor = new () => SpeechRecognition

function getRecognitionCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Mic button + live transcription. Tap to start; tap again to stop. Each
 * recognised utterance (final result) is appended to the field via `onAppend`.
 *
 * Supported in Chrome, Edge, Safari (incl. iOS). Firefox has no support — we
 * hide the button rather than show a broken affordance.
 */
export function VoiceInput({
  onAppend,
  className = '',
}: {
  onAppend: (text: string) => void
  className?: string
}) {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognition | null>(null)

  // The recognition object's `onresult` closure is created once when we call
  // `start()`. If we capture `onAppend` directly there, it sees the parent's
  // state at start-time only, which is why subsequent utterances appeared to
  // wipe the field — every chunk computed `appendSpoken(stale-value, t)` and
  // setState'd that. Tracking the latest callback in a ref makes every chunk
  // read the freshest closure.
  const onAppendRef = useRef(onAppend)
  useEffect(() => { onAppendRef.current = onAppend })

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null)
    return () => {
      recRef.current?.abort?.()
    }
  }, [])

  function start() {
    setError(null)
    const Ctor = getRecognitionCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = navigator.language || 'en-NZ'
    rec.continuous = true     // keep listening across pauses
    rec.interimResults = true // surface interim results (we only commit finals)

    rec.onresult = (e) => {
      // Web Speech delivers cumulative results; iterate from `resultIndex`.
      let finalChunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const alt = result[0]
        if (result.isFinal) finalChunk += alt.transcript
      }
      const trimmed = finalChunk.trim()
      if (trimmed) onAppendRef.current(trimmed)
    }
    rec.onerror = () => {
      setError('Voice capture failed')
      setListening(false)
    }
    rec.onend = () => setListening(false)

    try {
      rec.start()
      recRef.current = rec
      setListening(true)
    } catch {
      setError('Could not start voice capture')
    }
  }

  function stop() {
    recRef.current?.stop?.()
    setListening(false)
  }

  if (!supported) return null

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      title={listening ? 'Stop voice capture' : 'Speak to fill this field'}
      aria-label={listening ? 'Stop voice capture' : 'Start voice capture'}
      className={`flex items-center justify-center h-9 w-9 rounded-full transition-colors flex-shrink-0 ${
        listening
          ? 'bg-red-500 text-white animate-pulse'
          : 'bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600'
      } ${className}`}
    >
      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      {error && <span className="sr-only">{error}</span>}
    </button>
  )
}
