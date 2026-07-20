For reviewing Cloudflare Worker code against security and privacy expectations, here's what I'd suggest:

## Model
Use a strong reasoning model for this — code security review benefits a lot from careful, contextual reasoning rather than pattern-matching. Claude Sonnet 5 or Claude Opus 4.8 (via Claude.ai, Claude Code, or the API) is a good fit. If you're running this through Claude Code against a real repo, that's actually the more effective setup versus pasting a single file into chat — it can see how the worker fits into the rest of your project (env bindings, wrangler.toml, secrets handling, etc.), which matters a lot for this kind of review.

## Prompt

Something like this works well as a starting point — adjust the specifics to your worker's actual purpose:

```
You are reviewing a Cloudflare Worker for security and privacy issues before deployment.
Review the code below (and any referenced files) for:

**Security**
- Input validation and sanitization (headers, query params, body, cookies)
- Injection risks (SQL/NoSQL if using D1/KV/external DB, HTML/script injection if rendering output)
- Authentication/authorization logic — is it enforced on every relevant path, not just the "main" one?
- Secrets handling — are API keys/tokens ever hardcoded, logged, or exposed in responses/error messages?
- CORS configuration — is it scoped appropriately, or wide open?
- Rate limiting / abuse potential (unbounded loops, expensive operations triggered by user input)
- SSRF risk if the worker makes outbound fetch() calls based on user-supplied URLs
- Proper use of Cloudflare bindings (KV, D1, R2, Durable Objects) — any risk of one user accessing another's data?
- Error handling — do error responses leak stack traces, internal paths, or config details?

**Privacy**
- What user data is collected, logged, or forwarded to third parties (analytics, logging services)?
- Is PII ever written to KV/D1/logs unnecessarily or without expiration?
- Are IP addresses, geo data, or headers being stored longer than needed?
- Any data sent to external APIs that shouldn't be (e.g. full request bodies to a logging endpoint)?

For each issue found: quote the relevant code, explain the risk concretely (not just "this could be a problem"), and suggest a specific fix. Flag false-positive-prone areas explicitly rather than staying silent if you're unsure — I'd rather evaluate a maybe-issue myself than have it skipped.

Don't flag purely stylistic issues unless they have a security/privacy implication.

[paste code or point to files]
```

A few tips on why this works:
- Asking it to **quote code + explain concretely** cuts down on vague "consider validating input" filler.
- Telling it to **flag uncertain cases rather than skip them** matters — models tend to under-report in ambiguous territory unless told otherwise.
- The **Cloudflare-specific checklist** (bindings, Durable Objects, SSRF via fetch) is what generic "review my code for security issues" prompts usually miss, since a lot of the model's default security training data skews toward traditional server/backend patterns rather than edge-worker specifics.

One honest caveat: this kind of review is good for catching common classes of bugs, but it's not a substitute for a real security audit if the worker handles sensitive data at any real scale — treat it as a strong first pass, not a sign-off.