# gopher featuers
lumin provides an API for gopher to use to poll for RSS and bookmarks to add AI-enhanced tags and summaries

- 
# Gemma 4 accepts the following file types natively. If the file is not one of these types, gopher will need to extract the text or render the pages as images first before sending it to the AI enrichment API.
Modality	What Gemma 4 Accepts	What You Must Do Locally First (Gopher)
Text	Plain text (.txt, .md, .json, .csv, code files)	Pass directly as a text prompt string.
Images	Standard formats (.jpg, .png, .webp)	Pass directly to the model's vision input layer.
Audio	Standard audio files (.wav, .mp3)	Pass directly to the model's native audio input layer.
Documents	Cannot read .pdf, .docx, or .xlsx natively as binary files.	Must extract the text or render the pages as images first.
Archives/Binaries	Cannot read .zip, .tar, .exe, .dmg, etc.	Skip completely; generate a generic tag based on filename only.