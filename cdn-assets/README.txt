This folder is git-tracked and mirrors the public "cdn-bucket" R2 bucket
(https://cdn.d11cloud.com). Each file's path here becomes its object key —
e.g. cdn-assets/brand/og-default.png uploads to cdn.d11cloud.com/brand/og-default.png.

Drop new/updated files in here, then run:

    just sync-cdn

This is only for hand-authored, site-wide static assets (brand marks, OG
banners, etc). Per-post attachments are mirrored automatically by the notes
publishing flow (src/utils/cdn.ts) and don't belong here.

Design master files (.psd, .ai, .sketch, .fig, etc.) can live alongside their
exported .png/.jpg in a "_src/" subfolder, e.g.:

    cdn-assets/brand/og-default.png
    cdn-assets/brand/_src/og-default.psd

sync-cdn-assets.sh skips everything under _src/ (and any of those source
extensions found elsewhere) so masters stay in git history without ever
being uploaded as public CDN objects.
