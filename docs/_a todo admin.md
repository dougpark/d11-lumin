
## Admin API Tokens
- BREAD
- expire
- Rotate? 


## Admin RSS Feeds
- BREAD


---

**3. Admin RSS Feeds BREAD**

This is the most immediately useful given the work we just did. Admin can:
- List all feeds with last_fetched_at, item count
- Add new feed (insert into rss_feeds)
- Edit name / toggle is_active (pause a feed without deleting)
- Delete feed (cascade-delete its rss_items)

No code needed to seed feeds via wrangler commands anymore.

**5. Admin API Tokens BREAD**

List all tokens across all users (useful for the daemon token scenario we just discussed). Revoke any token. 
- set token scope

- can a user set their own api tokens? what are valid scopes? 
- access their own bookmarks public and private
- add new personal bookmarks
- public api for public bookmarks by user or tag?



