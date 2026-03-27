import OpenAI from "openai";
import { NextResponse } from "next/server";
import { supabase } from "@/services/supabaseClient";

const MODELS = [
  "meta-llama/llama-3.3-8b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemma-3-4b-it:free",
  "microsoft/phi-3-mini-128k-instruct:free",
]

async function callAIWithFallback(openai, prompt) {
  for (const model of MODELS) {
    try {
      console.log(`[Evaluate] Trying: ${model}`)
      const completion = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 3000,
      })
      const content = completion.choices[0]?.message?.content
      if (content) {
        console.log(`[Evaluate] Success: ${model}`)
        return content
      }
    } catch (err) {
      console.warn(`[Evaluate] ${model} failed: ${err?.status} ${err?.message}`)
      continue
    }
  }
  throw new Error("All AI models failed")
}

export async function POST(req) {
  try {
    const {
      transcriptId,
      transcript,
      candidateName,
      candidateEmail,
      jobPosition,
      jobDescription,
      questionList,
      interviewId,
      isCompleted = true,
    } = await req.json();

    if (!transcript || transcript.length === 0) {
      console.warn("[Evaluate] No transcript — saving placeholder")
      const { data } = await supabase
        .from("interview_evaluations")
        .insert({
          transcript_id: transcriptId ?? null,
          interview_id:  interviewId  ?? "unknown",
          candidate_name: candidateName ?? "Unknown",
          candidate_email: candidateEmail ?? null,
          job_position: jobPosition ?? null,
          overall_score: 0,
          communication_score: 0,
          technical_knowledge_score: 0,
          confidence_score: 0,
          problem_solving_score: 0,
          recommendation: "Reject",
          recommendation_reason: "No transcript was captured for this session.",
          qualification_status: "not_qualified",
          detailed_feedback: "The interview was ended before any responses were captured.",
          overall_feedback: "No transcript captured.",
          strengths: [],
          improvements: [],
          question_scores: [],
          category_scores: {},
          status: "incomplete",
          email_sent: false,
        })
        .select().single()
      return NextResponse.json({ error: "No transcript", evaluation: data }, { status: 400 })
    }

    const formattedTranscript = transcript
      .map(t => `${t.speaker === 'agent' ? 'AI Recruiter' : 'Candidate'}: ${t.text}`)
      .join('\n\n')

    const formattedQuestions = Array.isArray(questionList) && questionList.length > 0
      ? questionList.map((q, i) => `${i + 1}. ${q?.question ?? q}`).join('\n')
      : 'Not provided'

    const prompt = `You are a senior HR expert. Analyze this job interview and return a JSON evaluation.

Job Position: ${jobPosition || 'Not specified'}
Job Description: ${jobDescription || 'Not provided'}

Interview Questions:
${formattedQuestions}

Interview Transcript:
${formattedTranscript}

CONTEXT:
The candidate ${isCompleted ? 'completed the full interview' : 'ended the interview early before all questions were finished'}.

EVALUATION CRITERIA:
1. STAR METHOD: For each candidate answer, evaluate if they provided Situation, Task, Action, and Result.
2. SCORING (0-100):
   - Communication: Clarity, pace, and tone.
   - Technical Knowledge: Accuracy of answers.
   - Confidence: Decisiveness and lack of fillers.
   - Problem Solving: Logical approach to challenges.
3. NOTE: If the interview was ended early, evaluate ONLY the questions that were answered. Do not penalize the score for missing questions, but note the early exit in the recommendation reason.

Return ONLY valid JSON with NO markdown, NO code fences, NO explanation:
{
  "overall_score": <0-100>,
  "communication_score": <0-100>,
  "technical_knowledge_score": <0-100>,
  "confidence_score": <0-100>,
  "problem_solving_score": <0-100>,
  "recommendation": "Hire|Consider|Reject",
  "recommendation_reason": "<1-2 sentences>",
  "detailed_feedback": "<3-4 paragraphs covering behavioral and technical aspects>",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["area 1", "area 2", "area 3"],
  "star_analysis": [
    { 
      "question": "<text>", 
      "score": <0-100>, 
      "situation": "<summary>",
      "task": "<summary>",
      "action": "<summary>",
      "result": "<summary>",
      "feedback": "<1-2 sentences>" 
    }
  ],
  "behavioral_summary": {
    "communication_notes": "<text>",
    "confidence_notes": "<text>",
    "problem_solving_notes": "<text>"
  }
}

recommendation must be exactly: "Hire" (score>=75), "Consider" (50-74), or "Reject" (<50)`

    const openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    })

    const aiContent = await callAIWithFallback(openai, prompt)

    let evaluation
    try {
      // Improved JSON extraction
      const cleaned = aiContent.replace(/```json/g, '').replace(/```/g, '').trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error("No valid JSON structure found in AI response")
      
      evaluation = JSON.parse(jsonMatch[0])
    } catch (e) {
      console.error("[Evaluate] Parse error:", e, "\nAI Response was:", aiContent)
      return NextResponse.json({ error: "Analysis failed to format correctly", details: e.message }, { status: 500 })
    }

    // Defensive mapping for database
    const finalScores = {
      overall: evaluation.overall_score ?? 0,
      comm:    evaluation.communication_score ?? evaluation.overall_score ?? 0,
      tech:    evaluation.technical_knowledge_score ?? evaluation.overall_score ?? 0,
      conf:    evaluation.confidence_score ?? evaluation.overall_score ?? 0,
      solve:   evaluation.problem_solving_score ?? evaluation.overall_score ?? 0
    }

    const rec = String(evaluation.recommendation || 'Consider').toLowerCase()
    const normalizedRec = rec.includes('hire') ? 'Hire' : rec.includes('reject') ? 'Reject' : 'Consider'
    const qualStatus = normalizedRec === 'Hire' ? 'qualified' : normalizedRec === 'Reject' ? 'not_qualified' : 'pending'

    const { data, error: dbError } = await supabase
      .from("interview_evaluations")
      .insert({
        transcript_id:             transcriptId ?? null,
        interview_id:              interviewId  ?? "unknown",
        candidate_name:            candidateName || "Unknown",
        candidate_email:           candidateEmail ?? null,
        job_position:              jobPosition    ?? null,
        overall_score:             finalScores.overall,
        communication_score:       finalScores.comm,
        technical_knowledge_score: finalScores.tech,
        confidence_score:          finalScores.conf,
        problem_solving_score:     finalScores.solve,
        recommendation:            normalizedRec,
        recommendation_reason:     evaluation.recommendation_reason ?? "Evaluation completed.",
        qualification_status:      qualStatus,
        detailed_feedback:         evaluation.detailed_feedback ?? "No detailed feedback provided.",
        overall_feedback:          evaluation.detailed_feedback ?? "Evaluation complete.",
        strengths:                 Array.isArray(evaluation.strengths) ? evaluation.strengths : [],
        improvements:              Array.isArray(evaluation.improvements) ? evaluation.improvements : [],
        question_scores:           evaluation.star_analysis ?? evaluation.question_scores ?? [],
        category_scores: {
          "Technical Skills": finalScores.tech,
          "Communication":    finalScores.comm,
          "Confidence":        finalScores.conf,
          "Problem Solving":   finalScores.solve,
          "Behavioral Notes":  evaluation.behavioral_summary ?? {}
        },
        status:     isCompleted ? 'completed' : 'incomplete',
        email_sent: false,
      })
      .select().single()

    if (dbError) {
      console.error("[Evaluate] DB error:", dbError)
      return NextResponse.json({ error: "Failed to save to database" }, { status: 500 })
    }

    return NextResponse.json({ success: true, evaluation: data })

  } catch (e) {
    console.error("[Evaluate] Route error:", e)
    return NextResponse.json({ error: e.message || "Failed to evaluate" }, { status: 500 })
  }
}
