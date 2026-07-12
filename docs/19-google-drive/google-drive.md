# google drive integration
## Overview
- update existing lumin drive page to integrate Google Drive functionality
- add a left side panel to select source from Lumin Drive or Google Drive
- ensure seamless switching between Lumin Drive and Google Drive within the application
- integrate Google Drive to allow users to store and manage files directly from the application
- support for uploading, downloading, and organizing files within Google Drive
- ensure proper authentication and authorization using OAuth 2.0
- follow the Lumin UI/UX guidelines for any Google Drive related UI components

## provide a google drive metadata table in D1
- include columns for file name, size, type, last modified date, and any other relevant metadata for Google Drive files
- ai_tags
- ai_summary
- ai_processed_at
- human_tags
- human_summary
- human_processed_at

## Feature
- button to copy the file object into Lumin drive
- so can be linked to Lumin Notes and other Lumin applications

## AI Analysis
- include a new AI analysis for Google Drive files, generating AI tags, summaries, and processing timestamps for each file based on its content

## Primary UI
- 3 panel layout: left side panel for source selection (Lumin Drive or Google Drive), main panel for file browsing, and right side panel for AI analysis and metadata display
- provide a file browser interface to navigate through Google Drive folders and files
- allow users to upload new files and create new folders within Google Drive
- enable downloading of files from Google Drive to the local device
- support drag-and-drop functionality for file uploads
- provide context menus for file operations such as rename, delete, and move
- display file metadata such as name, size, type, and last modified date
- ensure responsive design for both desktop and mobile views while maintaining usability