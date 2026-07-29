Updated todo list

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/90-security-audit/review-plan.md#1-1), lines 1 to 60

Searched for files matching `**/docs/90-security-audit/findings-2026-07-29-phase1*`, 1 match

Searched for files matching `**/docs/90-security-audit/findings-2026-07-29-phase3*`, 1 match

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/90-security-audit/findings-2026-07-29-phase3-auth.md)

Searched for text `header` (`**/docs/90-security-audit/findings-2026-07-29-phase1-r2.md`), 9 results

## My assessment: Low-to-Moderate concern — with one specific caveat that matters more than the "token vs. password" question itself

Here's the reasoning, grounded in what the audit actually found.

### The token model isn't inherently weaker than userid/password — it's different

A 256-bit random bearer token (`generateToken()` in auth.ts), hashed at rest (SHA-256, same principle as a hashed password), is actually **stronger** than a typical password against several of the most common real-world attack classes:

| Attack | Userid/password | Lumin's token model |
|---|---|---|
| Credential stuffing (reused passwords from other breaches) | Common, effective | Impossible — token isn't reused anywhere else |
| Phishing a human into typing a memorized secret | Common | Much harder — nobody has this memorized, it lives in a password manager/localStorage |
| Brute force / weak password guessing | Mitigated by rate-limiting, still a real risk | Not a risk at all — 2^256 space, not guessable |
| Credential reuse across your other accounts | Common failure mode | N/A — random per-account secret |

So swapping "password" for "long random bearer token" is a *net security improvement* against the attacks that compromise the vast majority of real-world accounts. This part of the model is fine.

### Where the real risk is concentrated: XSS + storage location

The part that actually deserves your attention isn't "token vs. password," it's **where the token lives and what protects it**:

1. **The token is stored in `localStorage` and a non-`HttpOnly` cookie** ([Phase 3 finding #2](docs/90-security-audit/findings-2026-07-29-phase3-auth.md#L27)) — both fully readable by JavaScript.
2. **There is no Content-Security-Policy header** — findings-2026-07-29-phase1-r2.md added `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, but no `CSP`. CSP is the one control that could meaningfully blunt an XSS bug's ability to exfiltrate a token even if one slips through.
3. **The client is a large, multi-file, hand-written inline-JS SPA** (AGENTS.md) — bigger attack surface for an XSS bug than a framework with automatic output-encoding.

With a traditional userid/password model, the equivalent failure (session cookie theft via XSS) is usually mitigated by `HttpOnly` cookies — JS literally can't read the cookie even if XSS occurs. Lumin's architecture **can't use that backstop**, by design, because the client needs to read the token itself to attach it as a Bearer header for cross-origin/import-tool use cases. That's the actual tradeoff: **not weaker crypto, but one fewer layer of defense-in-depth if XSS ever occurs.**

### Why I still land on "Low-to-Moderate," not "High"

- The one concrete stored-XSS vector found in this codebase (spoofed-SVG upload rendering inline) was **found and fixed** in Phase 1.
- This is a single-user-per-account personal tool, not a multi-tenant SaaS — there's no cross-tenant blast radius; compromising one token only exposes that one person's data.
- You now have a **rotation/kill-switch** (the feature we just built) — a leaked token is no longer permanently valid; you can invalidate it in one click without waiting for it to matter.
- Signed R2 download tokens are separately scoped, short-TTL (300s), HMAC-verified — even if the session token leaked, an attacker gets live account access, but historical direct-R2-URL exposure isn't a separate leak path.

### What I'd actually prioritize, in order, if you want to reduce this further

1. **Add a `Content-Security-Policy` header** — this is the single highest-leverage next step given the storage model can't be `HttpOnly`. A reasonably strict CSP (even `default-src 'self'`, tightened per-page) would materially reduce the odds an XSS bug can reach `localStorage`/cookie and exfiltrate the token to an attacker's origin.
2. Keep the XSS-prevention discipline from Phase 1 alive — the token-in-JS model makes **any future stored-XSS bug** effectively equivalent to leaking a password *and* bypassing all your future MFA (there is none, since this is possession-based auth), so it deserves outsized scrutiny in code review going forward.
3. The remaining item — the cookie being non-`HttpOnly` by necessity — I'd leave as an accepted tradeoff rather than chase the "server-issued cookie" redesign from Phase 3 finding #2, unless you specifically need that isolation; it's a bigger, cross-file change for a second-order improvement once CSP exists.

**Bottom line:** the token-vs-password architectural choice is not itself a weakness — it's arguably more robust against the attacks that account for most real-world breaches. Your actual residual risk is "does an XSS bug ever get introduced," because there's no `HttpOnly`/CSP backstop if one does. Want me to draft and add a CSP header now? That's the one concrete, high-value action left on this thread.

Created 3 todos

Updated todo list

Searched for regex `onclick=|onchange=|onsubmit=|oninput=|onerror=` (`**/src/client/**`), 101 results

Searched for regex `eval\(|new Function\(|cdn\.tailwindcss\.com|fonts\.googleapis|fonts\.gstatic|<script src=` (`**/src/client/**`), 64 results

No matches found. Your search pattern might be excluded completely by either the search.exclude settings or .*ignore files.
If you believe that it should have results, you can check into the .*ignore files and the exclude setting (here are some excluded patterns for reference:[**/node_modules,**/bower_components,**/*.code-search]).
Then if you want to include those files you can call the tool again by setting "includeIgnoredFiles" to true.

Searched for regex `style="\$\{|style=\"\S*\$\{|\.style\.|<iframe` (`**/src/client/**`), 49 results

Searched for regex `favicon_url|preview_image|og_image|<img src=` (`**/src/client/app.html`), 7 results

Grounded this in what's actually in the client code (16 HTML pages) rather than guessing — here's what a CSP would break and what it wouldn't.

## Short answer

A **strict** CSP (the kind that actually stops inline-script XSS) would break the app immediately across every page. A **practical** CSP (allows the patterns this codebase already relies on, but locks down exfiltration/embedding) is low-risk and still closes the most important gap. I'd recommend the practical version now.

## What would break with a strict CSP

1. **Tailwind CDN, on every single page** — `<script src="https://cdn.tailwindcss.com">` appears in all 16 client HTML files (settings.html, app.html, etc.). Worse: Tailwind's CDN engine works by **injecting a `<style>` tag into the page at runtime** as it scans your classes — there's no way around needing `style-src 'unsafe-inline'` for this without dropping the CDN entirely, which conflicts with AGENTS.md's explicit "Tailwind CDN — no build step, no bundler" convention.

2. **100+ inline event-handler attributes** — `onclick=`, `onchange=`, `oninput=`, `onsubmit=` are used pervasively (`onclick="goTo('login')"`, `onclick="testFeed()"`, `onsubmit="event.preventDefault(); doLogin()"`, etc., across app.html, admin.html, station.html, import-pinboard.html and more). CSP treats these as inline scripts. A strict `script-src` would silently disable **every button and form in the app** the moment it's enabled.

3. **All the app logic itself is inline `<script>` blocks** — this is the actual architecture (per AGENTS.md: "self-contained SPA... vanilla JS, no bundler"). Also blocked by a strict CSP unless every script tag gets a per-request nonce — which requires introducing server-side HTML templating. Today, client HTML is imported as static raw text and served as-is (the `@ts-expect-error` Text-module pattern) — there's no per-request injection point for a nonce today. Adding one is a real architecture change, not a header tweak.

4. **Google Fonts** — several pages (notes.html, explore.html, import-browser.html, import-pinboard.html) load `fonts.googleapis.com`/`fonts.gstatic.com`. Needs explicit `style-src`/`font-src` allowlisting or fonts silently fail (falls back to system font — not a hard break, but a visual regression).

5. **Bookmark favicons/preview images** — app.html renders `<img src="${b.favicon_url}">` where `favicon_url` is an **arbitrary third-party domain** (whatever site the user bookmarked). `img-src` can't be locked to `'self'` — it needs to allow `https:` broadly, or every favicon across the dashboard silently disappears (the existing `onerror="this.style.display='none'"` hides them gracefully, but you'd lose the feature).

## What's already clean (good news)

- No `eval()` / `new Function()` anywhere in client — `script-src` never needs `'unsafe-eval'`.
- No `<iframe>` anywhere — `frame-src 'none'` is free and safe.
- No client-side `fetch()`/WebSocket calls to third-party domains — every API call goes to same-origin `/api/*`. This means **`connect-src 'self'` is safe to set and costs nothing**, which is exactly the directive that matters most for your actual concern (an XSS payload being able to phone home with the stolen token).

## Recommended approach: "practical" CSP now, not a strict one

Something like:

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' https: data:;
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
```

This breaks nothing — it allows exactly the patterns the app already uses (`unsafe-inline` for both script and style, Tailwind CDN, Google Fonts, arbitrary favicon images) — while still adding real value: `connect-src 'self'` blocks an XSS payload from exfiltrating the `localStorage` token to any external server, `object-src 'none'`/`base-uri 'self'`/`form-action 'self'`/`frame-ancestors 'none'` close off several other injection/clickjacking vectors, at zero cost since none of those patterns exist in this app anyway.

The tradeoff: because `'unsafe-inline'` is required for script-src, this **doesn't** stop an XSS payload from *executing* — only from talking to an external origin afterward. Eliminating that residual risk would mean the strict-CSP path (converting all `onclick=` to `addEventListener`, adding per-request nonces) — a legitimate future project, but a much bigger lift than a header.

## Rollout safety, given no staging/direct-to-prod deploys

I'd suggest shipping it first as `Content-Security-Policy-Report-Only` for one deploy cycle — the browser logs any violation to devtools console without blocking anything, so you can click through all 16 pages and confirm nothing unexpected got missed, then flip it to enforcing.

Want me to implement this (the practical CSP, report-only first)?

Created 3 todos


Updated todo list

Searched for regex `X-Content-Type-Options|Referrer-Policy|X-Frame-Options|app\.use` (`**/src/index.ts`), 23 results

Read [](file:///Users/dougpark/Projects/d11-lumin/src/index.ts#85-85), lines 85 to 115

Now adding the report-only CSP header alongside the existing baseline headers. 

Replacing 14 lines with 40 lines in [](file:///Users/dougpark/Projects/d11-lumin/src/index.ts)


```

```
Now type-check and confirm. 

Ran terminal command:  bun x tsc --noEmit -p tsconfig.json

Clean. Added `Content-Security-Policy-Report-Only` to the global response-header middleware in index.ts, applied to every response.

**Policy shipped (report-only, blocks nothing):**
```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' https: data:;
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
```

**Next steps for you:**
1. After deploy, open each client page (or at least app.html, settings.html, drive.html, notes.html, chat.html) with devtools console open — any violation will log there as `[Report Only]` without breaking anything.
2. Since there's no `report-uri`/`report-to` endpoint configured, violations only surface in each browser's own devtools console — nothing is centrally collected. That's fine for a manual click-through validation pass; let me know if you'd want a `report-to` endpoint later to catch violations from real usage instead of manual testing.
3. Once you've clicked through the app and confirmed the console is clean, tell me and I'll flip the header to enforcing `Content-Security-Policy`.

Type-check passed clean (only the header/policy change — no other files touched).

Created 4 todos

Made changes.