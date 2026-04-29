#!/usr/bin/env bun
// fulltext-synthesis-example.js — Full-text fetching + AI synthesis via the Lumin daemon APIs
//
// These two pipelines run as background daemons — separate from the user-facing bookmark API.
// Each requires a named API token with the matching scope, created in the Lumin token UI:
//
//   fulltext:process  — for /api/ft/*
//   synthesis:process — for /api/synthesis/*
//
// Usage:
//   FT_TOKEN=your_fulltext_token SYNTH_TOKEN=your_synthesis_token bun run docs/fulltext-synthesis-example.js
//
// Both can be the same token if it has both scopes.

const BASE = process.env.LUMIN_BASE ?? 'https://d11.me'
const FT_TOKEN = process.env.FT_TOKEN
const SYNTH_TOKEN = process.env.SYNTH_TOKEN ?? FT_TOKEN

if (!FT_TOKEN) { console.error('Set FT_TOKEN env var (named API token with fulltext:process scope)'); process.exit(1) }
if (!SYNTH_TOKEN) { console.error('Set SYNTH_TOKEN env var (named API token with synthesis:process scope)'); process.exit(1) }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function headers(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function api(path, token, opts = {}) {
    const res = await fetch(`${BASE}${path}`, { headers: headers(token), ...opts })
    const json = await res.json()
    if (!res.ok) throw new Error(`${res.status} ${path}: ${json.error ?? JSON.stringify(json)}`)
    return json
}

// ─── Pipeline 1: Full-text fetching ──────────────────────────────────────────
//
// Flow:
//   GET /api/ft/queue   → list of bookmarks that have no full_text yet
//   fetch each URL      → extract readable text (bring your own extractor)
//   PATCH /api/ft/items → write results back (status: 'completed' | 'fetch_failed')
//
// Skips bookmarks that previously failed. Pass ?force=true to retry them.

async function runFullTextPipeline() {
    console.log('\n── Full-text pipeline ───────────────────────────────────────')

    // 1. Pull up to 10 bookmarks that still need full-text fetching
    const queue = await api('/api/ft/queue?limit=10', FT_TOKEN)
    console.log(`Queue: ${queue.count} to process, ${queue.total_pending} total pending`)

    if (queue.count === 0) { console.log('Nothing to do.'); return }

    // 2. Fetch full text for each URL — replace with your own extractor
    //    (e.g. Readability, Firecrawl, Jina Reader, a headless browser, etc.)
    const results = await Promise.allSettled(
        queue.items.map(async ({ id, url, title }) => {
            try {
                // Example: use Jina Reader (free, no auth needed)
                const jinaUrl = `https://r.jina.ai/${url}`
                const res = await fetch(jinaUrl, { headers: { 'X-Return-Format': 'text' }, signal: AbortSignal.timeout(15_000) })
                if (!res.ok) throw new Error(`Jina returned ${res.status}`)
                const full_text = await res.text()
                console.log(`  ✓ ${id} "${title ?? url}" (${full_text.length} chars)`)
                return { id, full_text, status: 'completed' }
            } catch (err) {
                console.log(`  ✕ ${id} "${title ?? url}": ${err.message}`)
                return { id, status: 'fetch_failed' }
            }
        }),
    )

    const batch = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)

    if (batch.length === 0) { console.log('All fetches failed.'); return }

    // 3. Write results back — server truncates full_text to 50,000 chars
    const written = await api('/api/ft/items', FT_TOKEN, {
        method: 'PATCH',
        body: JSON.stringify(batch),
    })
    console.log(`Wrote ${written.updated} results back.`)
}

// ─── Pipeline 2: AI synthesis ─────────────────────────────────────────────────
//
// Flow:
//   GET /api/synthesis/queue → bookmarks where full_text is ready but ai_synthesis is missing
//   generate a synthesis     → call your preferred LLM (OpenAI, Anthropic, Ollama, etc.)
//   PATCH /api/synthesis/items → write the markdown digest back (max 5,000 chars)

const SYNTHESIS_PROMPT = (title, url, text) => `\
You are a research analyst. Write a concise synthesis of the article below.

Structure:
- 2-3 sentence summary
- Key points (bullet list, max 5)
- Why it matters (1 sentence)

Article: "${title ?? url}"
---
${text.slice(0, 8000)}
---
Respond in markdown only. Be direct and precise.`

async function synthesiseWithOllama(title, url, fullText) {
    // Example: local Ollama instance — swap in any LLM API you prefer
    const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama3.2',
            prompt: SYNTHESIS_PROMPT(title, url, fullText),
            stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
    const data = await res.json()
    return data.response?.trim() ?? ''
}

async function runSynthesisPipeline() {
    console.log('\n── Synthesis pipeline ───────────────────────────────────────')

    // 1. Pull bookmarks whose full-text is ready but synthesis is missing
    const queue = await api('/api/synthesis/queue?limit=5', SYNTH_TOKEN)
    console.log(`Queue: ${queue.count} to process, ${queue.total_pending} total pending`)

    if (queue.count === 0) { console.log('Nothing to do.'); return }

    // 2. Generate synthesis for each (sequentially to avoid overwhelming the LLM)
    const results = []
    for (const { id, title, url, full_text } of queue.items) {
        try {
            const ai_synthesis = await synthesiseWithOllama(title, url, full_text)
            console.log(`  ✓ ${id} "${title ?? url}" (${ai_synthesis.length} chars)`)
            results.push({ id, ai_synthesis })
        } catch (err) {
            console.log(`  ✕ ${id} "${title ?? url}": ${err.message}`)
            // Synthesis failures are not written back — item stays in queue for retry
        }
    }

    if (results.length === 0) { console.log('No syntheses generated.'); return }

    // 3. Write synthesis digests back (markdown, max 5,000 chars each)
    const written = await api('/api/synthesis/items', SYNTH_TOKEN, {
        method: 'PATCH',
        body: JSON.stringify(results),
    })
    console.log(`Wrote ${written.updated} synthesis digests back.`)
}

// ─── Run both pipelines once ──────────────────────────────────────────────────
// In production, run this on a schedule (cron, Cloudflare Queues, etc.)

await runFullTextPipeline()
await runSynthesisPipeline()
console.log('\nDone.')
