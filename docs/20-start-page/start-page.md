# start page

## creeate a start page
- Lumin header at the top
- Main content area is a grid of icons
  - Each icon represents a different feature or section of the app
  - Icons should be visually distinct and easily tappable on mobile devices
  - based on the /vendor/suite-menu.js
- mobile and desktop layouts should be responsive
  - Ensure the grid of icons adapts to different screen sizes
  - Icons should remain easily tappable on smaller screens and well-spaced on larger screens  

## start.html
- The `start.html` file should include the Lumin header at the top and a main content area with a grid of icons representing different features or sections of the app.



## admin
- based on the /vendor/suite-menu.js
- admin icons should only be visible for admin users

## non logged in users
- For users who are not logged in, the start page should display only the features or sections that are accessible without authentication.
- The grid of icons should adapt to show only the relevant options for non-logged-in users.
- news is the only non-logged-in accessible feature.
- Ensure that any attempt to access restricted features prompts the user to log in or register.

## login / register
- in the header should have a login/register link or button for users to access the authentication pages.

