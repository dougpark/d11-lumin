
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

### API Token Thoughts:
- some are global like RSS and bookmarks

- some are per user like the personal API tokens for accessing private bookmarks via the API or a CLI tool.

- scope definitions - how to select on create or do we just have a list of possbiel scopes and then assign them to tokens?

- should users be able to create their own API tokens? what scopes - read only, read/write, etc. - what UI would they use to manage them?

- global api tokens can do rss, bookmarks or all

- do we keep tokens so can reuse them or help users with their tokens?

- what does rotate really mean? do we just create a new token and delete the old one? or do we update the token value in place?

### UI

List all tokens across all users (useful for the daemon token scenario we just discussed). Revoke any token. 
- set token scope

- can a user set their own api tokens? what are valid scopes? 
- access their own bookmarks public and private
- add new personal bookmarks
- public api for public bookmarks by user or tag?



