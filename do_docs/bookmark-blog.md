# Copy Bookmark to Blog Feature

- add a button to the bookmark list card menu to "create blog post"
- between the edit and "make private" buttons
- this copies the bookmark info into a new note 
- create a new note folder "Blog Link-List" if it doesn't exist
- create a new note with the bookmark 
- title: bookmark title -> note title
- slug: based on the bookmark title
- Excerpt: bookmark description (250 characters) -> note excerpt
- bookmark text/description -> note body as blockquote (> ...)
- url -> markdown link in the body/attribution (via [base url](URL))
- tags -> note tags
- date -> note date (to keep the historical order of notes)
- set the note as a blog post (frontmatter: blog: true)
- set as draft
- add a 'blog' tag to the bookmark to flag that it has been copied to a blog post

## bookmark URL 
- in the main note body after the blockquote, add a markdown link to the bookmark URL 
- Read the full article at [base URL](URL)
- Example:
  Read the full article at [blog.apple.com](https://blog.apple.com/123/12/apple-announces-new-products/)