# homepage
- the /homepage route can be set in a browsers default homepage for a new page or a new tab. the user will be able to define using tags what bookmarks they want to see on the homepage.  this is useful for a user that wants to see their bookmarks in a specific order, or wants to see a specific set of bookmarks on their homepage.

## New Settings Section - Homepage
- look at: settings.html
- new setting that allows the user to set a homepage url. If set, the /homepage route will redirect to that url. If not set, it will redirect to /n
- verify a valid url

## New route - /homepage
- look at: index.ts
- redirect to the url in settings.homepage if it is set, otherwise redirect to /n

## New Start Card 
- look at: start.html and public/vendor/suite-menu.js
- on the start.html page add a new card for homepage
- direct to /homepage 

