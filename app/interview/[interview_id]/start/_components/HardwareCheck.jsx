'use client'
import React, { useState, useRef, useEffect } from 'react'
import { Mic, Volume2, CheckCircle2, AlertCircle, Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

export default function HardwareCheck({ onComplete, userName }) {
  const [step, setStep] = useState('mic') // mic, speaker, ready
  const [micLevel, setMicLevel] = useState(0)
  const [isRecording, setIsRecording] = useState(false)
  const [audioUrl, setAudioUrl] = useState(null)
  const [error, setError] = useState(null)
  
  const streamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const animationFrameRef = useRef(null)

  const startMicTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength
        setMicLevel(Math.min(average * 2, 100))
        animationFrameRef.current = requestAnimationFrame(updateLevel)
      }
      updateLevel()
      setError(null)
    } catch (err) {
      setError("Microphone access denied. Please check your browser settings.")
    }
  }

  const recordTest = () => {
    setIsRecording(true)
    audioChunksRef.current = []
    mediaRecorderRef.current = new MediaRecorder(streamRef.current)
    mediaRecorderRef.current.ondataavailable = (e) => audioChunksRef.current.push(e.data)
    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      setAudioUrl(URL.createObjectURL(blob))
    }
    mediaRecorderRef.current.start()
    setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
        setIsRecording(false)
      }
    }, 3000)
  }

  useEffect(() => {
    startMicTest()
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-3xl shadow-xl border border-gray-100 animate-in fade-in zoom-in duration-500">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">System Check</h2>
        <p className="text-gray-500 text-sm mt-1">Let's make sure everything is perfect, {userName}.</p>
      </div>

      {error ? (
        <div className="bg-red-50 p-4 rounded-2xl flex gap-3 items-start border border-red-100">
          <AlertCircle className="text-red-500 h-5 w-5 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Mic Step */}
          <div className={`transition-opacity ${step === 'mic' ? 'opacity-100' : 'opacity-40 cursor-not-allowed'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg text-primary">
                  <Mic className="h-5 w-5" />
                </div>
                <span className="font-semibold text-gray-700">Microphone Check</span>
              </div>
              {audioUrl && <CheckCircle2 className="text-green-500 h-5 w-5" />}
            </div>
            
            <div className="space-y-4">
              <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-75" 
                  style={{ width: `${micLevel}%` }}
                />
              </div>
              
              {!audioUrl ? (
                <Button 
                  onClick={recordTest} 
                  disabled={isRecording} 
                  className="w-full py-6 rounded-xl font-bold"
                >
                  {isRecording ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recording 3s...</>
                  ) : (
                    "Record a Sample"
                  )}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setAudioUrl(null)}>
                    Re-record
                  </Button>
                  <Button className="flex-1 rounded-xl" onClick={() => setStep('speaker')}>
                    Sounds Good
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Speaker Step */}
          <div className={`transition-opacity ${step === 'speaker' ? 'opacity-100' : 'opacity-40'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
                <Volume2 className="h-5 w-5" />
              </div>
              <span className="font-semibold text-gray-700">Speaker Check</span>
            </div>
            <Button 
              variant="secondary" 
              className="w-full py-6 rounded-xl font-bold"
              disabled={step !== 'speaker'}
              onClick={() => {
                const audio = new Audio(audioUrl)
                audio.play()
                setTimeout(() => setStep('ready'), 3500)
              }}
            >
              <Play className="mr-2 h-4 w-4" /> Playback Sample
            </Button>
          </div>

          {step === 'ready' && (
            <Button 
              onClick={onComplete} 
              className="w-full py-8 text-lg font-bold rounded-2xl bg-green-600 hover:bg-green-700 shadow-lg shadow-green-200"
            >
              Everything Works! Start Interview
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
