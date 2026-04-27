---
name: inline-suggestions
description: 'Create high-signal inline suggestions for code and docs during reviews and edits. Use when asked to suggest exact line-level improvements, patch-ready replacements, or comment-ready suggestions in existing files.'
argument-hint: 'Files or diff areas to review, plus any style constraints'
user-invocable: true
disable-model-invocation: false
---

# Inline Suggestions

Produce precise, low-noise inline suggestions for both source code and documentation that a developer can apply directly.

## When To Use
- User asks for inline suggestions, line edits, patch-ready snippets, or review comments with concrete replacements.
- User wants minimal discussion and actionable text for direct application.
- Reviewing changed code or docs and proposing safer, clearer alternatives.

## Inputs
- Target files, symbols, or diff sections.
- Constraints: style guide, performance goals, compatibility, or security requirements.
- Optional strict format request (for example, comment-ready code suggestion blocks).

## Procedure
1. Locate exact target scope.
2. Read enough surrounding context to avoid breaking behavior.
3. Identify only high-value edits:
- Correctness bugs
- Security or data-safety risks
- Behavioral regressions
- Readability or maintainability improvements that reduce future defects
- Clarity and accuracy issues in docs that can mislead implementation or operations
4. For each suggestion, provide:
- What to change (exact replacement text)
- Why the change helps (one short sentence)
- Expected impact (correctness, safety, clarity, performance)
5. Keep edits surgical:
- Preserve public APIs unless asked otherwise.
- Do not reformat unrelated lines.
- Match existing indentation and style.
- For docs, preserve voice, heading structure, and existing terminology.
6. Validate suggestions:
- Confirm syntax is valid.
- Ensure changed names and imports are consistent.
- Check that suggested behavior matches user intent.

## Output Formats
Use the format requested by the user. If no format is requested, use this default:

1. File and location
2. Suggested replacement snippet
3. One-line rationale

Example:

File: path/to/file.ts (near function doWork)

```ts
// Replace
if (value) run(value)

// With
if (value != null) run(value)
```

Reason: avoids dropping valid falsy values like 0 or empty string.

## Decision Rules
- If context is missing, ask one focused clarifying question before suggesting risky changes.
- If multiple valid fixes exist, present the safest default first and list one alternative.
- If suggestion could alter externally visible behavior, explicitly call it out.

## Completion Checks
- Every suggestion is specific and directly applicable.
- No suggestion depends on unstated assumptions.
- High-severity issues are listed before minor improvements.
- Suggestions are consistent with repository conventions.

## Guardrails
- Avoid speculative refactors.
- Avoid broad style-only churn unless requested.
- Prefer fewer, stronger suggestions over long low-value lists.
