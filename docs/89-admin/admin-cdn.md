# cdn-admin

Question: Should this be its own cdn-admin.html page to keep source files smaller? it would just be a link from the admin.html page? this has turned into a pretty large feature.

- create a CDN admin section in the admin.html page
- connect to env.CDN_BUCKET on Cloudflare, add to wrangler.toml
- Provide a management console to manage CDN objects
- LIST, PUT, DELETE with download and view links

# Cloudflare bucket name
- cdn-bucket

# Cache Headers
- Example:
```
await env.CDN_BUCKET.put(key, fileBody, {
  httpMetadata: {
    cacheControl: 'public, max-age=31536000, immutable',
    contentType: fileType,
  },
});
```

# Full Feature List
To turn your cdn-admin into a fully production-ready media manager within your Lumin dashboard, here are the essential functional additions to build into your backend Worker API and frontend UI:

## Core File & Asset Management
• Drag-and-Drop Batch Uploads: A UI drop zone supporting multiple files simultaneously, complete with progress indicators for larger uploads.

• Smart Content-Type Detection: Automatic MIME type setting based on file extension (.png, .webp, .svg, .json, .woff2, etc.) fallback to application/octet-stream.

• One-Click Link Copying: Fast "Copy URL" buttons ([https://cdn.d11cloud.com/path/to/asset.png](https://cdn.d11cloud.com/path/to/asset.png)) and "Copy Markdown" tags (![alt](https://cdn.d11cloud.com/...)) for immediate pasting into your blog or notes manager.

• Inline Asset Previews: Instant image thumbnails, audio/video player controls, and syntax-highlighted text/json preview drawers directly inside the admin panel.


## Edge & Cache Control
• Cache Invalidation / Purging Button: Call Cloudflare's Cache API via your Worker when an object is replaced or deleted, purging [https://cdn.d11cloud.com/filename](https://cdn.d11cloud.com/filename) so edge nodes don't continue serving stale cached files.

### Preset Cache-Control Selectors: 
- A dropdown in the upload UI to select cache strategies before sending the PUT request: 
• Default - Immutable Assets: public, max-age=31536000, immutable (Images, Fonts, Hashed JS/CSS) 
• Mutable/Dynamic: public, max-age=3600, must-revalidate (Frequently updated configs, JSON files) 
• No Cache: no-store, no-cache (Sensitive or temporary files)

## Dashboard UX & Organization
• Folder / Path Namespaces: Input field during upload to prefix assets with virtual directories (e.g., blog/2026/, avatars/, fonts/), accompanied by simple prefix filtering in your LIST query.
- List columns: Object, Type, Size, Modified, copy-link, preview-button, 3-dot-menu

• File Overwrite Warnings: Prompt for confirmation if a PUT request targets an existing key name to prevent accidental overwrites.

• Quick Stats Bar: Summary metrics header showing total object count, total bucket size, and key space usage returned from env.CDN_BUCKET.list().

## Security & Bulk Operations

• Multi-Select Bulk Actions: Checkboxes next to listed items to allow multi-file batch deletion (env.CDN_BUCKET.delete([key1, key2])).

• CSRF & Upload Safeguards: Maximum file size checks in the Worker script to prevent accidental client-side memory locks or massive payload timeouts.