# AI-Generated Blog Images
- use the title, tags and blob content to generate an image for the blog post
- insert the image into R2
- create a md link to the image at the top of the blog post content
- save the blog post with the inserted image

# Steps to Generate AI Blog Images
1. Create a new blog post or edit an existing one.
2. Click the "Generate AI Image" button.
3. The system will generate an image based on the blog post's title, tags, and content.
4. The generated image will be uploaded to R2 and a markdown link to the image will be inserted at the top of the blog post content.
5. Save the blog post to keep the changes.  

# UI
- new button on the notes editor to generate AI images for the blog post
- the button triggers the AI image generation process described in the steps above.

# Concerns
- similar to the AI chat feature, the AI image generation may take some time, so the user should be informed of the progress.
- there should be a clear indication when the image generation is complete.
- the user should have the option to regenerate the image if they are not satisfied with the result.
- use the Lumin chat logic as an example for how to handle the AI image generation process, including progress indication and error handling.