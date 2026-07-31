import type { Env } from '../index.ts'

export interface OllamaRequest {
    model: string
    prompt: string
    stream: boolean
}

export interface OllamaResponse {
    model: string
    created_at: string
    response: string
    done: boolean
    context: number[]
    total_duration: number
    load_duration: number
    prompt_eval_count: number
    prompt_eval_duration: number
    eval_count: number
    eval_duration: number
}

// Rate limiting: track requests per user
const userRequestTimestamps = new Map<string, number[]>()
const MAX_REQUESTS_PER_USER_PER_MINUTE = 6 // 1 per 10 seconds
const RATE_LIMIT_WINDOW_MS = 60000

export function checkRateLimit(userId: string): boolean {
    const now = Date.now()
    const userTimestamps = userRequestTimestamps.get(userId) || []

    // Filter out old requests outside the window
    const recentTimestamps = userTimestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)

    if (recentTimestamps.length >= MAX_REQUESTS_PER_USER_PER_MINUTE) {
        userRequestTimestamps.set(userId, recentTimestamps)
        return false // Rate limit exceeded
    }

    // Add current timestamp
    recentTimestamps.push(now)
    userRequestTimestamps.set(userId, recentTimestamps)

    // Bound the map's lifetime memory footprint — this isolate may live for
    // hours and see many distinct users, so drop any other tracked user whose
    // entire window has gone stale rather than letting entries accumulate forever.
    for (const [key, timestamps] of userRequestTimestamps) {
        if (key !== userId && !timestamps.some((ts) => now - ts < RATE_LIMIT_WINDOW_MS)) {
            userRequestTimestamps.delete(key)
        }
    }

    return true
}

export async function callOllama(
    env: Env,
    prompt: string,
    systemPrompt?: string,
): Promise<{ success: boolean; response?: string; error?: string; duration?: number }> {
    try {
        const startTime = Date.now()

        // Combine system prompt with user prompt
        const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt

        const body: OllamaRequest = {
            model: 'gemma4:e4b',
            prompt: fullPrompt,
            stream: false,
        }

        console.log(`Sending request to Ollama at ${env.OLLAMA_URL}`)

        // Create abort controller with 25-second timeout (leaving 5s buffer for Workers limit)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 25000)

        try {
            const response = await fetch(env.OLLAMA_URL, {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    'Content-Type': 'application/json',
                    'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
                    'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            })

            clearTimeout(timeoutId)

            const duration = Date.now() - startTime
            console.log(`Ollama request completed in ${duration} ms with status ${response.status}`)

            if (!response.ok) {
                console.log(`Ollama request failed with status ${response.status}: ${response.statusText}`);
                return {
                    success: false,
                    error: `Ollama HTTP ${response.status}: ${response.statusText}`,
                    duration,
                }
            }

            const data: OllamaResponse = await response.json()

            // Trim response to max 500 words as per system prompt
            const words = data.response.split(/\s+/)
            const trimmedResponse = words.length > 500 ? words.slice(0, 500).join(' ') + '...' : data.response

            return {
                success: true,
                response: trimmedResponse.trim(),
                duration,
            }
        } catch (fetchError) {
            clearTimeout(timeoutId)
            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                return {
                    success: false,
                    error: 'Ollama request timeout (>25 seconds)',
                    duration: Date.now() - startTime,
                }
            }
            throw fetchError
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
            success: false,
            error: `Ollama request failed: ${errorMessage}`,
        }
    }
}

export const SYSTEM_PROMPT = `You are a playful assistant that answers questions and provides information. You are knowledgeable about a wide range of topics and can provide clear and concise explanations. You are also able to generate creative content, such as stories, poems, and code snippets. You are polite, respectful, and professional in your responses. Limit your responses to 500 words or less. If the user asks for a response that is too long, politely decline and suggest they ask for a summary or a shorter version instead.`
// export const SYSTEM_PROMPT = `You are a swashbuckling pirate assistant that answers questions accurately while speaking in authentic nautical pirate banter. You are knowledgeable about a wide range of topics and can provide clear and concise explanations. You are also able to generate creative content, such as stories, poems, and code snippets. You are polite, respectful, and professional in your responses. Limit your responses to 500 words or less. If the user asks for a response that is too long, politely decline and suggest they ask for a summary or a shorter version instead.`
