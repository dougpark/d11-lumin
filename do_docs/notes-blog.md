# blog
- make a Lumin blog feature with a blog.html page and a blog.json API route
- update the notes.html page to add a checkbox to make the note a blog post, and if so, add it to the blog.json feed
- copy any note attachments to the cdn-bucket and add a copy-link to the note.json object
- and changes to the note should be reflected in the blog.json feed, including any attachment copy-links

# blog
- checkbox on notes editor
- checkbox for draft/published
- add a new metadata Title on notes editor (always shown)
- add a new metadata Tags on notes editor (always shown), maintain a notes tag list for reusable tags
- add a new metadata Excerpt on notes editor (only shown when the note is marked as a blog post)
- add a new metadata Slug on notes editor (only shown when the note is marked as a blog post)

- when checked as a blog attachments should become public on the cdn-bucket and a copy-link added to the note.json object
- if unchecked from blog then the note.json object should be removed from the blog.json feed and any attachments should be deleted from the cdn-bucket
- blog posts are public

# blog view
- blog.html page to view blog posts, with a list of posts and a single post view
- list view (show recent 50 posts) with title, date, and excerpt
- search view
- tag search and view
- previous and next post navigation

# RSS feed
- add a new RSS feed for the blog posts, with title, date, full-text, and link to the blog post

# Features

Building this blog extension directly into Lumin transforms your private notes manager into an integrated static publishing platform.
Data Flow Architecture
┌─────────────────────────────────────────────────────────────────┐
│                      LUMIN DASHBOARD (d11.me)                   │
│                                                                 │
│  ┌──────────────┐     Toggle Public     ┌────────────────────┐  │
│  │ Private Note │ ───────────────────>  │ Storage Operations │  │
│  │ (Attachments)│                       └─────────┬──────────┘  │
└──────┬────────────────────────────────────────────┼─────────────┘
       │                                            │
       │ Reads JSON Feed                            │ Syncs Assets & Feeds
       ▼                                            ▼
┌──────────────┐                          ┌──────────────────┐
│ Public Blog  │                          │  Public CDN      │
│ (blog.html)  │                          │ (cdn.d11cloud)   │
└──────────────┘                          └──────────────────┘

## Key System Requirements & API Design
1. Example - Database Schema Extension (Notes D1)
- existing notes table has tag_list, not currently exposed in the notes UI
Extend your existing note object to track publishing state and public media URLs:
interface LuminNote {
  id: string;
  title: string;
  content: string; // Markdown body
  isBlog: boolean;
  isPublished: boolean;
  publishedAt: string | null;
  tags: string[];
  attachments: Array<{
    id: string;
    filename: string;
    privatePath: string;
    cdnUrl?: string; // e.g., https://cdn.d11cloud.com/blog/notes/123/image.png
  }>;
}

## Storage Synchronization State Machine
When saving or updating a note in your API backend, evaluate the publishing toggle transition:
• State Change: Private \rightarrow Public (isBlog: true, isPublished: true) 
• Iterate over all note attachments. 
• Fetch attachment bytes from your private storage bucket and issue an env.CDN_BUCKET.put() call to copy them over to blog/{noteId}/{filename}. 
• Set long-term cache headers (public, max-age=31536000, immutable). 
• Replace internal attachment links in the blog post payload with the generated cdnUrl. 
• Append/update the post entry in your cached blog.json dataset.
• State Change: Public \rightarrow Private (isBlog: false OR isPublished: false) 
• Remove the entry from the blog.json index. 
• Call env.CDN_BUCKET.delete() for all attached CDN keys linked to this note. 
• Trigger a Cloudflare Cache Purge for the deleted CDN asset URLs and the blog.json feed endpoint.

## Recommended Features for Usability
To make blog.html smooth to navigate and easy to publish from, add these structural touches:

### Notes Editor Enhancements (notes.html)
• Auto-Generated Excerpts: Automatically parse the first 160 characters of clean text from your Markdown note to use as the blog post abstract in list views.
• Inline Image CDN Replacer: A editor utility button that automatically converts local attachment syntax (![alt](local://file.jpg)) into standard CDN image tags (![alt](https://cdn.d11cloud.com/...)) upon publication.
• Slug Field Override: Provide an optional "Custom URL Slug" input in the note metadata panel (e.g., my-post-title), falling back to a sanitized version of the note title if left blank.

### Public Reader Page (blog.html)
• Lightweight Client-Side Search & Tag Filtering: Since you are fetching a consolidated blog.json array containing the latest 50 posts, implement client-side filtering via JavaScript for immediate tag clicks and search queries without secondary server round-trips.
• URL Hash / Query State Routing: Support clean routing states (e.g., blog.html?post=slug-name, blog.html?tag=typescript, or blog.html?q=searchterm) so you can link directly to specific posts or filtered views.
• Canonical & OpenGraph Meta Injector: Have your Worker or frontend dynamically append OpenGraph image and description tags based on the single post view for clean link previews when sharing on social platforms.

# Performance Goals

A Cloudflare Worker will easily handle this whole lifecycle in a single request, and listing 50 entries on blog.html is trivial for D1.
Handling the Toggle in One Request
When you check or uncheck "Publish to Blog" in notes.html, the Worker executes a quick step-by-step routine in a single API call:
1. DB Transaction: A D1 batch query updates the is_blog and is_published columns on the note record in milliseconds.
2. Attachment Sync (Parallel I/O): • Publishing: The Worker reads attachment streams from your internal storage and streams them directly into env.CDN_BUCKET.put(). Using Promise.all(), multiple attachments upload concurrently. • Unpublishing: It executes env.CDN_BUCKET.delete(filename) for each attachment.
3. Cache Invalidation: The Worker sends a quick fetch() call to the Cloudflare Cache Purge API for [https://cdn.d11cloud.com/blog/](https://cdn.d11cloud.com/blog/)*.
Worker subrequest execution handles I/O wait times effortlessly, so copying a few 5 MB images to R2 will take under a second total.
Fetching 50 Blog Entries on blog.html
Querying 50 records from D1 is virtually instantaneous:
• Direct D1 SQL Performance: A query like SELECT id, title, slug, excerpt, published_at, tags FROM notes WHERE is_blog = 1 AND is_published = 1 ORDER BY published_at DESC LIMIT 50; takes roughly 1ms to 3ms to execute on D1.
• Minimal Payload: Retaining only the excerpt (not the full Markdown body) keeps the entire JSON response under ~30 KB.
• Edge Caching blog.json: Set a 5-minute cache header on the blog.json Worker endpoint: return Response.json(posts, {   headers: {     'Cache-Control': 'public, max-age=300, s-maxage=300',   }, });  Most visits to blog.html won't hit D1 at all—Cloudflare’s edge will instantly serve the cached blog.json payload, rendering the post list almost instantly.

# RSS Goals
Generating an RSS (or Atom) feed for Lumin is extremely straightforward and adds practically zero performance overhead.
Since you already have a blog.json route querying D1, adding /rss.xml (or /feed.xml) requires almost the exact same logic—except instead of returning a JSON array, your Worker formats the records into valid XML.
Worker Route Implementation
You can construct the XML string directly in TypeScript using simple template literals:
// Route: GET /rss.xml
if (url.pathname === '/rss.xml') {
  // 1. Fetch the latest 20 published blog posts from D1
  const { results: posts } = await env.DB.prepare(`
    SELECT id, title, slug, excerpt, content, published_at 
    FROM notes 
    WHERE is_blog = 1 AND is_published = 1 
    ORDER BY published_at DESC 
    LIMIT 20
  `).all();

  // 2. Build the XML RSS feed
  const rssItems = posts.map(post => `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>https://d11.me/blog.html?post=${post.slug || post.id}</link>
      <guid isPermaLink="true">https://d11.me/blog.html?post=${post.slug || post.id}</guid>
      <pubDate>${new Date(post.published_at).toUTCString()}</pubDate>
      <description><![CDATA[${post.excerpt || post.content.slice(0, 250)}...]]></description>
    </item>
  `).join('');

  const rssXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2000/svg">
  <channel>
    <title>d11.me Blog</title>
    <link>https://d11.me/blog.html</link>
    <description>Notes and thoughts from d11.me</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="https://d11.me/rss.xml" rel="self" type="application/rss+xml" />
    ${rssItems}
  </channel>
</rss>`;

  // 3. Serve as RSS XML with Edge Caching
  return new Response(rssXml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600', // Cache at edge for 1 hour
    },
  });
}

Best Practices for Your Feed
• Feed Discovery: Add a <link> tag inside the <head> of your blog.html (and index) so feed readers (NetNewsWire, Feedly, etc.) auto-detect it: <link rel="alternate" type="application/rss+xml" title="d11.me Blog Feed" href="/rss.xml" />
• Include CDN Images in Feed: Because your publishing workflow automatically rewrites attachment URLs to [https://cdn.d11cloud.com/](https://cdn.d11cloud.com/)..., any images embedded in your Markdown body will render directly inside external RSS readers without broken links.
• Cache Purging: When you check or uncheck "Publish to Blog" in notes.html, trigger a cache purge for /rss.xml alongside blog.json via the Cloudflare Cache API.

# Page Performance & SEO
• Edge Caching: Both blog.json and rss.xml should be cached at the edge for 5–60 minutes, depending on your update frequency. This ensures that most requests are served instantly from Cloudflare’s edge network without hitting your D1 database.
• SEO-Friendly URLs: Use the slug field to generate clean, human-readable URLs for each blog post (e.g., /blog.html?post=my-first-post). If no slug is provided, fallback to using the note ID.
• OpenGraph & Twitter Cards: Dynamically inject OpenGraph meta tags into the <head> of blog.html for each post view, including title, description (excerpt), and image (first attachment or a default image). This improves link previews when sharing on social media platforms.   

# Page Layout & Styling
• Responsive Design: Ensure that blog.html is mobile-friendly, with a responsive layout that adapts to different screen sizes. Use CSS Flexbox or Grid for layout, and media queries for responsive adjustments

Hardcoding the header and footer directly into blog.html is the simplest, most performant approach—no build steps, template engines, or runtime layout fetching required.
Standard Static Setup (blog.html)
Structure blog.html using clean semantic HTML tags (<header>, <main>, <footer>):
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog — d11.me</title>
  <link rel="alternate" type="application/rss+xml" title="d11.me RSS Feed" href="/rss.xml">
  <link rel="stylesheet" href="/style.css">
</head>
<body>

  <!-- Shared Header -->
  <header class="site-header">
    <nav>
      <a href="/" class="brand">d11.me</a>
      <div class="nav-links">
        <a href="/blog.html">Blog</a>
        <a href="/rss.xml">RSS</a>
      </div>
    </nav>
  </header>

  <!-- Dynamic Content Slot -->
  <main id="app">
    <!-- blog.js renders list or single post here -->
  </main>

  <!-- Shared Footer -->
  <footer class="site-footer">
    <p>&copy; 2026 d11.me &bull; Powered by Lumin & Cloudflare Workers</p>
  </footer>

  <script src="/blog.js"></script>
</body>
</html>

Keep Client-Side Navigation Snappy
Because blog.html handles both the 50-post list view and single-post views (e.g., via blog.html?post=slug), the hardcoded header and footer stay permanently in place while your JavaScript swaps out the content inside <main id="app">:
• URL Routing: Parse window.location.search in blog.js. If ?post= is present, fetch and render that single note. Otherwise, render the list view.
• Instant Switching: Intercept internal post links so switching between posts or returning to the list updates the browser history via history.pushState() without triggering a full page reload.
Alternative: JavaScript Web Components (If Reusing Across Pages)
If you decide later to share the exact same header or footer across other public pages (like a homepage or archive) without copy-pasting HTML, wrap them in Native Web Components:
// header.js
class SiteHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header class="site-header">
        <nav>
          <a href="/" class="brand">d11.me</a>
          <a href="/blog.html">Blog</a>
        </nav>
      </header>
    `;
  }
}
customElements.define('site-header', SiteHeader);

Then in any HTML file:
<site-header></site-header>

For a simple personal site, hardcoding directly into blog.html keeps maintenance minimal and performance maximum.
