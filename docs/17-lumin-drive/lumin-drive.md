# Lumin Drive
- expand the notes R2 table
- add a couple of new columns: 
- is_drive, // flag to indicate if this r2 object is a note attachment or a lumin drive object
- drive_path // the virtual path of the lumin drive object, e.g., /My Drive/Folder1/File.txt

# UI
- add a new sub-system for lumin drive, with a new route /drive
- a google drive-like interface for browsing lumin drive objects, with a tree view of folders and files
- tag view for lumin drive objects, with the ability to filter by tags
- view by human tags or ai tags and ai summary
- 

# AI Enrichment
- add AI enrichment for lumin drive objects, including generating tags and summaries for files and folders


# API
- add a new API endpoint for lumin drive, e.g., /api/drive
- the API should support CRUD operations for lumin drive objects, including creating folders, uploading files, renaming, moving, and deleting objects
- the API should also support searching for lumin drive objects 

# Security
- ensure that lumin drive objects are only accessible to the user who owns them, and any shared objects are only accessible to the users they are shared with
- implement access control for lumin drive objects
- enforce permissions for all CRUD operations on lumin drive objects
