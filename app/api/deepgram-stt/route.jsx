import { NextResponse } from "next/server"

const STT_TIMEOUT = 20000

export async function POST(req) {
  try {
    const formData = await req.formData()
    const audioFile = formData.get('audio')

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 })
    }

    const buffer = await audioFile.arrayBuffer()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT)

    try {
      if (!process.env.DEEPGRAM_API_KEY) {
        throw new Error("DEEPGRAM_API_KEY is not set")
      }

      console.log(`[STT] Sending ${buffer.byteLength} bytes to Deepgram...`)

      // We use 'nova-2' as standard, but we'll try 'general' if it fails
      const response = await fetch("https://api.deepgram.com/v1/listen?smart_format=true&punctuate=true&model=nova-2", {
        method: "POST",
        headers: {
          "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": audioFile.type || "audio/webm"
        },
        body: buffer,
        signal: controller.signal
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Deepgram STT error (${response.status}):`, errorText)
        return NextResponse.json({ 
          error: `Transcription failed (${response.status})`, 
          details: errorText,
          status: response.status 
        }, { status: response.status })
      }

      const result = await response.json()
      const text = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || ""

      console.log("[STT] Transcribed:", text)
      return NextResponse.json({ text })

    } catch (fetchErr) {
      clearTimeout(timeout)
      console.error("STT fetch error:", fetchErr.message)
      return NextResponse.json({ error: "Transcription timeout or failed", details: fetchErr.message }, { status: 500 })
    }

  } catch (error) {
    console.error("Deepgram STT error:", error)
    return NextResponse.json({ error: "Transcription failed", details: error.message }, { status: 500 })
  }
}
