# API Tokens in Lumin

Lumin provides a robust API token system that allows users to authenticate with the API using named tokens instead of session tokens. This enables secure programmatic access to the API without exposing session credentials.

## Token Structure

API tokens are stored in the `api_tokens` table with the following fields:
- `id`: Unique identifier
- `user_id`: References the owner user
- `name`: Human-readable name for the token
- `token_hash`: SHA-256 hash of the raw token (never stored in plain text)
- `scopes`: JSON array of permissions (e.g., `["posts:read", "tags:read"]`)
- `last_used_at`: Timestamp of last use
- `expires_at`: Optional expiration timestamp
- `created_at`: Timestamp of creation

## Token Creation

### Endpoint
`POST /api/v1/tokens`

### Request Body
```json
{
  "name": "string",
  "scopes": ["string"],
  "expires_at": "ISO 8601 datetime"
}
```

### Response
```json
{
  "token": "raw_token_string",
  "id": 123,
  "name": "string",
  "scopes": ["string"],
  "expires_at": "ISO 8601 datetime",
  "created_at": "ISO 8601 datetime",
  "notice": "Save this token now — it will not be shown again."
}
```

### Security Notes
- The raw token is returned only once in the response and is never stored
- If lost, the token must be revoked and a new one created
- Token limit is 10 per user (admins are exempt)
- Requires a valid session token for authentication

## Token Usage

### Authentication
API tokens are used in the Authorization header:
```
Authorization: Bearer <token>
```

### Lookup Order
The system checks for API tokens in this order:
1. **Named API tokens** (`api_tokens` table) - Primary method
2. **Session token fallback** (`users.token_hash`) - For development/testing

## Token Management

### List Tokens
`GET /api/v1/tokens` - Returns all tokens for the authenticated user

### Rotate Token
`POST /api/v1/tokens/:id/rotate` - Replaces an existing token with a new one

### Revoke Token
`DELETE /api/v1/tokens/:id` - Removes a token permanently

## Scopes

API tokens support granular permissions:

- `posts:read` - Read bookmarks
- `posts:write` - Create/update bookmarks
- `tags:read` - Read tags
- `tags:write` - Create/update tags
- `ai:process` - Access AI processing features
- `ai:process:rss` - Process RSS feeds with AI
- `ai:process:bookmarks` - Process bookmarks with AI
- `rss:ingest` - Ingest RSS feeds
- `fulltext:process` - Process full-text content
- `synthesis:process` - Process AI synthesis
- `*` - All permissions (use with caution)

## Admin Access

Administrators can access all tokens via:
- `GET /api/admin/tokens` - List all tokens with owner handles
- `DELETE /api/admin/tokens/:id` - Force-revoke any user's token

## Example Usage

```bash
# Create a new API token
curl -X POST https://d11.me/api/v1/tokens \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "scopes": ["posts:read", "posts:write"]}'

# Use the token to access API
curl -X GET https://d11.me/api/v1/posts \
  -H "Authorization: Bearer <api-token>"
```