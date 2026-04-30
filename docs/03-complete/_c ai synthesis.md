# AI Synthesis API in Lumin

The AI Synthesis API provides a mechanism to generate deep analysis and summaries of bookmarked content using AI. It's designed to work as part of a background processing pipeline alongside full-text fetching.

## Overview

The AI synthesis process is implemented as a two-step pipeline:
1. **Full-text fetching** - Extracts readable content from URLs
2. **AI synthesis** - Generates markdown summaries using AI

These steps run as separate background daemons that communicate with the main API via dedicated endpoints.

## API Endpoints

### GET /api/synthesis/queue

Returns a batch of bookmarks ready for AI synthesis processing.

#### Query Parameters
- `limit=1-50` (default: 20) - Number of items to return
- `offset=0` (default: 0) - Offset for pagination
- `force=true` (default: false) - Include items that already have synthesis

#### Response
```json
{
  "items": [
    {
      "id": 123,
      "title": "Example Title",
      "url": "https://example.com",
      "full_text": "Extracted full text content..."
    }
  ],
  "count": 5,
  "total_pending": 123
}
```

### PATCH /api/synthesis/items

Writes AI synthesis results back to the database for a batch of bookmarks.

#### Request Body
```json
[
  {
    "id": 123,
    "ai_synthesis": "Markdown synthesis content..."
  }
]
```

#### Response
```json
{
  "updated": 5
}
```

## Selection Criteria

Bookmarks are selected for AI synthesis based on the following criteria:

1. **Archived Status**: `is_archived = 0` (only unarchived bookmarks)
2. **Visibility**: Either:
   - `is_public = 1` (public bookmarks)
   - `u.ai_allow_private = 1` (user allows AI processing of private bookmarks)
3. **Full-text Status**: `full_text_status = 'completed'` (full-text must be fetched)
4. **Synthesis Status**: `ai_synthesis IS NULL` (no existing synthesis)

The `force=true` parameter can override the last criterion to include items that already have synthesis.

## Batch Size and Processing

- **Default batch size**: 20 items
- **Maximum batch size**: 50 items
- **Processing mode**: Sequential (one item at a time)
- **Timeout**: 60 seconds per item

## Required Permissions

Access to the AI synthesis API requires a named API token with the `synthesis:process` scope.

## Example Usage

The following example shows how to implement a synthesis daemon using the API:

```javascript
const BASE = 'https://d11.me'
const TOKEN = 'your_synthesis_token'

async function runSynthesisPipeline() {
  // 1. Get a batch of items to process
  const queue = await fetch(`${BASE}/api/synthesis/queue?limit=5`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  }).then(r => r.json())

  if (queue.count === 0) return

  // 2. Process each item (example using local Ollama)
  const results = []
  for (const { id, title, url, full_text } of queue.items) {
    try {
      const ai_synthesis = await callYourLLM(title, url, full_text)
      results.push({ id, ai_synthesis })
    } catch (err) {
      console.log(`Failed to process ${id}: ${err.message}`)
    }
  }

  // 3. Write results back
  if (results.length > 0) {
    await fetch(`${BASE}/api/synthesis/items`, {
      method: 'PATCH',
      headers: { 
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(results)
    })
  }
}
```

## Implementation Notes

- The synthesis API is designed for background processing and should not be used for real-time requests
- Items are processed sequentially to avoid overwhelming LLMs or API rate limits
- Synthesis failures are not written back to the queue, allowing for retry
- The `ai_synthesis` field is stored as markdown text (max 5,000 characters)
- The system maintains a queue of pending items for efficient processing

## Integration Example

See `docs/fulltext-synthesis-example.js` for a complete implementation example that shows how to:
1. Fetch full-text content from URLs
2. Generate AI synthesis using a local LLM (Ollama example)
3. Write results back to the Lumin API

This example demonstrates a complete background processing pipeline that can be scheduled to run periodically.