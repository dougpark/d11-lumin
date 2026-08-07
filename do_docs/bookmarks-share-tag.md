# share all the bookmarks with a tag

- i need a url to share all the bookmarks with a tag.  for example, if i have a tag called "food", i want to be able to share all the bookmarks with that tag.  this is useful for sharing a collection of bookmarks with others.
- it should share public bookmarks if the user is not logged in, and it should share public and private bookmarks if the user is logged in.  
- the page should have a similar view as the main bookmarks page, but it should only show the bookmarks with the tag.


# UI/UX on existing bookmarks page
- in the bookmarks left nav, there should be a "share" icon next to the tag name.  clicking on the icon should open a modal with the url to share the bookmarks with that tag.  the modal should also have a button to copy the url to the clipboard.
- this is in addition to the existing Explore icon.

## new share page
- the shared page should be view only and not provide any edit capabilities.  it should also not provide any options to add or remove tags, or to add or remove bookmarks from the tag.  it should only show the bookmarks with the tag, and provide a way to view the bookmark details and open the bookmark url.
- it should provide a way to copy the bookmark to the logged in users account, similar to the News/RSS list can be added to the users bookmarks. this should be a button on each bookmark in the list, and it should only be available if the user is logged in.  if the user is not logged in, it should show a message to log in to copy the bookmark.
- for each bookmark it should show the existing bookmark details, including:
    - the ft button to show the full text popup
    - the src button to show the original description and tags
    - the copy-short-link button to copy the short link to the clipboard
- add a new button, similar to news, to add the bookmark to the users bookmarks, for logged in users.


# URL
- existing bookmarks page: https://d11.me/
- Example url: https://d11.me/<handle>/share/<tag>  (this should be a new route, not a query param on the existing bookmarks page)

# security question
- how can this url be limited to only shared tags and not be used to view all bookmarks for a user?
- if we track a shared tag then there needs to be a way to manage shared tags and remove them.

# existing similar route
- this is not the same as the existing route: https://d11.me/e/<tag>
- which only provides a limited view of the bookmarks with the tag

# Question
- is this a unique enough page to make a new /share page? or just modify the existing bookmarks page and disable all the edit capabilities?  i think it is unique enough to make a new /share page, but i want to get your opinion.
