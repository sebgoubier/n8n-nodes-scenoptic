# Changelog

## 0.2.0 (2026-10-07)

First release published on npm.

- Scenoptic node: Assembly > Create, Get, Get Many, Update.

## 0.1.0 (not published)

- Scenoptic API credential (base URL + personal access token).
- Scenoptic node: Project > Get Many; Topic > Create, Get, Get Many, Update; Comment > Create, Get Many.
- Scenoptic Trigger: webhook subscription lifecycle, HMAC signature and timestamp check on the raw body, notification filters.
- Example workflow: topic assigned → email.
- Scenoptic Trigger: file events (`file.created`, `file.updated`, `file.deleted`, `file.ready`, `file.failed`) and on-demand conversion events (`conversion.started`, `conversion.completed`, `conversion.failed`).
- Scenoptic Trigger: folder events (`folder.created`, `folder.updated`, `folder.deleted`), member events (`member.added`, `member.updated`, `member.removed`) and assembly events (`assembly.created`, `assembly.updated`, `assembly.deleted`).
- Scenoptic node: Document > Create Folder, Get, Get Download URL, Get Tree, Upload (parts sent to presigned URLs, folder list).
- Scenoptic node: Conversion > Convert (optional bounded wait), Download Artifact, Get, Get Many (`external_ref`, status).
- Example workflow: email attachments → documents and conversions, with a reply to the sender.
