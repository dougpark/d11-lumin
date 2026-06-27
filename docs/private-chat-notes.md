# Private Notes
- built into the chat system, but not visible to the other users
- selectable by the user, and can be shared via a unique URL
- select on the Channels page in a new section called "Private Notes"
- user can create a new private-note channel 
- default private-note channel is called "My Notes"

# Keys
- user-id and note_id are the primary key for the notes table
- a note can move from one channel to another, but the note_id remains the same 

# existing channels table
- add a new channel type called "private-note", default to "chat"

# db (not a valid schema, just a reference for the database structure)
- Notes table
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE, -- part of primary key
  note_id     INTEGER PRIMARY KEY AUTOINCREMENT, -- part of primary key
  channel_id  INTEGER NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES notes (user_id, note_id) ON DELETE CASCADE,
  pinned      INTEGER NOT NULL DEFAULT 0, -- 0 = not pinned, 1 = pinned
  type        TEXT    NOT NULL DEFAULT 'note', -- 'note' or 'tidbit'
  content     TEXT    NOT NULL,
  upvotes     INTEGER NOT NULL DEFAULT 0,
  downvotes   INTEGER NOT NULL DEFAULT 0,
  tag_list        TEXT    NOT NULL DEFAULT '[]',
  ai_tags      TEXT    NOT NULL DEFAULT '[]',
  ai_summary   TEXT    NOT NULL DEFAULT '',
  ai_processed_at TEXT    DEFAULT NULL          -- NULL = not yet processed by AI
  is_hidden   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_modified_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  is_public       INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)), -- default to private
  is_archived     INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  share_url             TEXT    NOT NULL, -- unique short UUID based URL for sharing this note when public
  share_expires_at      TEXT,   -- optional expiration date for the share URL (NULL = never expires)
  attachment_count       INTEGER NOT NULL DEFAULT 0, -- number of attachments associated with this note

- attachments_list table
  note_user_id INTEGER NOT NULL,
  note_id     INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0, -- order of attachments for this note
  attachment_id INTEGER NOT NULL REFERENCES attachments (id) ON DELETE CASCADE, -- part of primary key
  FOREIGN KEY (note_user_id, note_id) REFERENCES notes (user_id, note_id) ON DELETE CASCADE,

- attachment table
  attachment_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT    NOT NULL,
  content_type TEXT   NOT NULL, -- MIME type of the attachment (e.g., image/png, application/pdf)
  size        INTEGER NOT NULL,
  url         TEXT    NOT NULL, -- URL to the attachment file (e.g., Cloudflare R2)
  tag_list        TEXT    NOT NULL DEFAULT '[]',
  summary     TEXT    NOT NULL DEFAULT '',
  ai_tags      TEXT    NOT NULL DEFAULT '[]',
  ai_summary   TEXT    NOT NULL DEFAULT '',
  ai_processed_at TEXT    DEFAULT NULL,          -- NULL = not yet processed by AI
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

# Full text search
- create a virtual table for full text search on the notes content
- including the content, tag_list, ai_tags, and ai_summary fields

# UI/UX
- the notes list should replace the messages list when the user selects a note channel
- the search icon should search the notes content, tags, and AI-generated tags and summary
- search should be a bubble that appears above the notes list, and should be dismissible to clear the search results and return to the notes list
- similar composer UI as the chat composer, but with a "Save Note" icon button instead of "Send"

- Recommended UX Pattern: "The Card View"
To avoid the "messy chat" problem, differentiate your notes from regular messages visually. When a record in your notes table is rendered:
	1.	Container: Render the chat bubble with a distinct background color to signal it is a note, not a conversation.
	2.	Metadata Ribbon: Below the content, include a small strip showing the ai_summary (if available), the tags as pill-shaped badges, and the number of attachments.
	3.	The "Channel" Separation: On your Channels page, having a "Private Notes" section is intuitive. Clicking this should behave exactly like a chat channel

- Attachments + icon to the left of the composer input field, allowing users to attach files to their notes. The attachment icon should open a file picker dialog, and once a file is selected, it should be uploaded to Cloudflare R2 and associated with the note.

# Cloudflare R2 Object Storage
- Store attachments in Cloudflare R2 for scalability and reliability.
- non-public access to attachments should be managed via signed URLs, ensuring that only the Lumin app can access them. This prevents unauthorized access to sensitive content.
- stream attachments directly to R2 from the client side, reducing server load and improving upload speeds. Use Cloudflare Workers to generate signed URLs for secure uploads.
