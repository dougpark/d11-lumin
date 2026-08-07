# BookmarksFull Text and Bookmark Synthesis Digest

## Overview
- add 4 new api routes for full text fetching and synthesis digest generation for bookmarks with URLs
- provide a get and patch API for updating the bookmark with the full text and synthesis digest results
- update the UI to show the full text and synthesis digest for each bookmark, with a button to view the full text in a modal or new page
- copy the existing ai daemon process to handle the full text fetching and synthesis digest generation in batches

## Authentication and API Access
- scope bookmark:read
- scope bookmark:write

## DB - Bookmarks Table

- use existing full_text column
- add new full_text_processed_at column to track when the full text was fetched and processed
- add new full_text_status column to track the status of the full text fetch (null, completed, fetch_failed)
- add new ai_synthesis column to store the synthesis digest result
- add new ai_synthesis_processed_at column to track when the synthesis digest was generated

## Question
- would it make sense to create a new table to store these full text and synthesis digest results, instead of adding them to the bookmarks table? this could help keep the bookmarks table more lightweight and focused on the core bookmark data, while the full text and synthesis digest data could be stored in a separate table that is linked to the bookmarks table via a foreign key. this might also make it easier to manage the different processing statuses for the full text and synthesis digest, and to handle cases where the full text fetch fails or is too large to store.

## UI
- full_text and ai_synthesis will be text fields with stored markdown text
- the UI will render the markdown as formatted text, with support for headings, paragraphs, lists, etc.
- the "View Full Text" button will show the full_text content in a modal or new page, rendered as formatted markdown
- the "Synthesis Digest" section will show the ai_synthesis content rendered as formatted markdown, with a timestamp of when it was generated

## Remote API
- a remote daemon will call for batched unprocessed full_text
- include the bookmark id and url in the API response so that the daemon can fetch the full text for each bookmark

- a remote daemon will call for batched unprocessed ai_synthesis
- include the bookmark id and full_text in the API response so that the daemon can generate the synthesis digest for each bookmark

- the remote daemon will fetch the full text for bookmarks that have a url but no full_text, and then call a new API to update the bookmark with the full text and the full_text_processed_at timestamp and full_text_status

- the remote daemon will call a new API to generate the synthesis digest for bookmarks that have a full_text but no ai_synthesis, and then update the bookmark with the ai_synthesis result and timestamp


## consider this in the context of:
- existing ai daemon process.


## Goals
- for items that have a url but no full_text, create a process so that the local daemon can fetch the bookmark informtion, and they will then fetch the full and call a new api to update the bookmark with the full text. This will allow us to have the full text available for the synthesis digest and for showing in the UI when users click to see the full text of an article.

- the local daemon will initiate the fetch for a list of bookmarks that have a url but no full_text, and then for each one it will fetch the full text and call the api to update the bookmark with the full text. This allows us to have the full text available for the synthesis digest and for showing in the UI when users click to see the full text of an article. (similar to the current ai daemon enrichment process)

- what are resonable limits for the length of the full text that we support? do we want to truncate it at a certain point to avoid storing excessively long articles? or do we want to store the full text regardless of length?

- some URL's will be dead and impossible to fetch the full text for. we should have a process for marking those bookmarks as "full text fetch failed" so that we don't keep trying to fetch them indefinitely. this could be a status field in the database that we update when a fetch fails, and then the daemon can skip those bookmarks in future fetch attempts.


## Sequence of operations
1. bookmark is created with url and title
2. ai enrichment process runs and fills in ai_summary, ai_tags, and other enrichment data
3. full text fetch process runs and fills in full_text and updates ai_full_text_processed_at with the current date and time
- if the fetch fails (e.g. 404, bot-block, etc.), update full_text with an error message and set full_text_processed_at to the current date and time, and set full_text_status to "fetch_failed"
4. synthesis digest process runs and fills in ai_synthesis, updates ai_tags if necessary, and updates ai_synthesis_at with the current date and time
- confirms that these should be seperate api's so that different prompts can be used for the enrichment and the synthesis digest, and so that they can run independently of each other. for example, if we want to update the synthesis digest prompt in the future, we can just re-run the synthesis digest process without having to re-run the full text process.
