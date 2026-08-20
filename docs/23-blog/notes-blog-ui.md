# blog.html

# Add Card Cards or Soft Borders
Instead of full-width horizontal rule dividers (
<hr>
), wrap each blog post in a subtle card container with rounded corners and a soft border or background.

the Lumin blue color can be used for subtle accents, borders, or hover effects to maintain a consistent visual identity.

Example:
.blog-post-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.blog-post-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  border-color: #cbd5e1;
}

# Strip Title Repetition from Excerpts
In your blog.js rendering logic, clean up the string before injecting it into the excerpt DOM node. If the excerpt starts with the title string, strip it out:

// Clean excerpt logic in blog.js
function getCleanExcerpt(title, content) {
  let clean = content.replace(/^#+\s+.*/, ''); // Remove leading markdown H1/H2 headers
  if (clean.toLowerCase().startsWith(title.toLowerCase())) {
    clean = clean.slice(title.length).trim();
  }
  return clean.slice(0, 180) + '...';
}