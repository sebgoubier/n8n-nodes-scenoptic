# n8n-nodes-scenoptic

n8n community nodes for the [Scenoptic](https://cde.scenoptic.com) CDE (common data environment for BIM projects).

- **Scenoptic**: action node (projects, documents, assemblies, on-demand conversions, BCF topics and comments).
- **Scenoptic Trigger**: starts a workflow from Scenoptic webhooks (BCF events, notifications).

The nodes only use the public, documented Scenoptic API: <https://cde.scenoptic.com/api/docs> (OpenAPI: `/api/openapi.json`).

## Credentials

Create a **personal access token** in Scenoptic (avatar menu > *My account* > *Access tokens*), then add a **Scenoptic API** credential in n8n:

| Field | Value |
|---|---|
| Base URL | `https://cde.scenoptic.com`, or the URL of your on-premise installation |
| Access Token | `scn_pat_…` |

The token is sent as `Authorization: Bearer`. The *Test* button calls `GET /foundation/1.1/current-user`.

Scopes the nodes need:

| Scope | Used by |
|---|---|
| `projects:read` | project lists |
| `files:read` | Document *Get*, *Get Tree*, *Get Download URL*, folder lists; Assembly *Get*, *Get Many* |
| `files:write` | Document *Upload*, *Create Folder*; Assembly *Create*, *Update* |
| `conversions:read` | Conversion *Get*, *Get Many*, *Download Artifact*, and *Convert* with *Wait for Completion* |
| `conversions:write` | Conversion *Convert* |
| `bcf:read` | Topic and Comment *Get* / *Get Many* |
| `bcf:write` | Topic *Create* / *Update*, Comment *Create* |
| `webhooks:manage` | Scenoptic Trigger (creates and deletes its subscription) |

A token can be limited to some projects. A missing scope shows up in n8n as `INSUFFICIENT_SCOPE`.

## Scenoptic node

| Resource | Operations |
|---|---|
| Assembly | Create, Get, Get Many, Update |
| Topic (BCF issue) | Create, Get, Get Many, Update |
| Comment | Create, Get Many |
| Conversion | Convert, Download Artifact, Get, Get Many |
| Document | Create Folder, Get, Get Download URL, Get Tree, Upload |
| Project | Get Many |

- **Topic > Get Many** filters on status and assignee, and accepts an extra BCF API `$filter` (`eq`, `ne`, `lt`, `le`, `gt`, `ge` joined by `and`). *Return All* pages through the results 100 at a time.
- **Topic > Update** reads the topic first, then sends it back with your changes: the BCF API replaces a topic as a whole, and a field missing from the request would be cleared. Fields you do not add keep their value; a field you add and leave empty is cleared.
- Type, status, priority, stage and labels must be values allowed by the project's BCF extensions, otherwise Scenoptic answers `BCF_EXTENSIONS`.
- In a comment, `@email` mentions and notifies a project member.
- **Document > Upload** sends a binary field of the input item (default `data`) to a folder of the project. The document name is the binary file name, or the *File Name* option; its extension selects the converter. The file is sent in parts directly to storage, on presigned URLs (the access token is never sent there), then confirmed: Scenoptic converts it like any uploaded document, and `file.ready` / `file.failed` tell the result. The whole file is held in memory during the upload.
- **Document > Get Tree** returns one item per folder and per document, each with `type` (`folder` or `document`) and `path` (`Architecture/Plans/R+1.ifc`). It can be limited to a folder and its subfolders.
- **Document > Get** returns the document with its artifacts; each artifact `url` is a fresh signed link, valid for a limited time.
- **Document > Get Download URL** returns a time-limited URL of the original file. Only the project owner can get it.
- **Conversion > Convert** converts a binary field without adding it to the project tree: the conversion only exists through the API. *External Reference* (a case number, an email `Message-ID`…) comes back in conversion events and filters *Get Many*; *Keep Original File* sets how many days Scenoptic keeps the uploaded file (1 to 365, 30 by default), the artifacts being kept until the conversion is deleted.
  - Without *Wait for Completion*, the node returns as soon as the upload is confirmed (`status: uploaded`); continue the workflow with the Scenoptic Trigger on `conversion.completed` / `conversion.failed`.
  - With it, the node reads the conversion every *Poll Interval* seconds until it is `ready` or `error`, for at most *Max Wait* seconds (1 hour at most). A failed conversion is returned (`status: error`, `error.code`), not raised; going past *Max Wait* is an error, and the conversion goes on in Scenoptic.
- **Conversion > Get** returns the status and, once `ready`, the artifacts with fresh signed links (valid for about an hour: read the conversion again rather than storing them).
- **Assembly** groups documents of the project tree that are viewed together (*Document IDs*: a comma-separated list, or an array from an expression). On-demand conversions cannot be part of one (`WRONG_PROJECT`). *Update* changes only the fields you add; *Document IDs* replaces the whole list. *Get Many* returns the most recent first.
- **Conversion > Download Artifact** reads the conversion and downloads the artifacts of the chosen kind (`glb`, `properties`, `structure`, `thumbnail`, `pdf`…) into a binary field, one item per artifact. The signed link is called without the access token.

## Scenoptic Trigger

Starts a workflow when Scenoptic sends a webhook.

- **Project**: the project to listen to.
- **Events**: one or more of
  - `bcf.topic.*`, `bcf.comment.*`, `bcf.viewpoint.*` (`created`, `updated`, `deleted`);
  - `file.created` (upload finished), `file.updated` (renamed or moved), `file.deleted`, `file.ready` (converted), `file.failed`;
  - `conversion.started`, `conversion.completed`, `conversion.failed` (on-demand conversions created through the API);
  - `folder.created`, `folder.updated` (renamed or moved), `folder.deleted` (one event per deleted subfolder too);
  - `member.added`, `member.updated` (role changed), `member.removed` (including members who leave);
  - `assembly.created`, `assembly.updated` (renamed or files changed), `assembly.deleted`;
  - `notification.created`.
- **Options**
  - *Assigned To*: keep only `notification.created` events sent to this email address (for `topic.assigned`, the person the topic was assigned to).
  - *Notification Kinds*: keep only these notification kinds (`topic.assigned`, `topic.mentioned`, `topic.commented`, `topic.status_changed`, `topic.due_date_passed`).

  Both filters only apply to `notification.created`; other events always pass.

When the workflow is activated, the node creates a webhook subscription in Scenoptic (scope `webhooks:manage`, role *contributor* or higher in the project). When it is deactivated, the subscription is deleted. Listening for a test event in the editor creates a separate subscription for the test URL, so it never touches the production one.

### Public URL required

Scenoptic only delivers to **public HTTPS** URLs (port 443 or 8443). A private, local or plain-HTTP address is refused with `WEBHOOK_URL_FORBIDDEN`. If your n8n instance runs behind a proxy or tunnel, set its `WEBHOOK_URL` environment variable to the public HTTPS address.

On n8n 2.x, activation is applied in the background: if Scenoptic refuses the subscription, the workflow still shows as active, and the error (`… [WEBHOOK_URL_FORBIDDEN]`) appears in the workflow's publication status as a trigger that failed to activate.

### Security

- Every delivery is checked against the `Scenoptic-Signature` header (`t=<unix>,v1=<HMAC-SHA256>`), computed on the **raw request body**. A missing or wrong signature, or a timestamp more than 5 minutes away from the n8n clock, is answered with `401` and the workflow does not run.
- The signing secret is returned by Scenoptic only once, when the subscription is created. The node keeps it in the workflow's static data and nowhere else: it is never logged and never part of the node output.
- Deliveries are *at least once* and their order is not guaranteed. If a duplicate run matters, deduplicate on `id`.
- `ping` deliveries (sent from Scenoptic to test a subscription) are acknowledged without running the workflow.

### Output

One item per event: the CloudEvents attributes (`id`, `type`, `source`, `subject`, `time`, `scenopticactor`…), `event` (short type, e.g. `notification.created`), `project_id`, and the fields of `data` at the top level (`topic`, `comment`, `notification`, `file`, `conversion`…). A link to a topic in Scenoptic is `<base URL>/projects/<project_id>?section=bcf&topic=<topic.guid>`.

File and conversion events carry ids and state only: `file.id`, `file.name`, `file.status`, `file.error.code`… or `conversion.id`, `conversion.external_ref`, `conversion.status`… plus `links.self`, the API path of the resource. They never include artifact links: read the resource with the Scenoptic node or an HTTP Request (same credential) to get fresh ones.

## Example workflow: topic assigned → email

[`examples/topic-assigned-to-email.json`](examples/topic-assigned-to-email.json) sends an email each time a BCF topic is assigned to someone: assignee, title, priority, due date, and a link that opens the topic in Scenoptic.

1. In n8n, import the JSON file, then:
   - in **Topic assigned**, select your Scenoptic API credential and the project;
   - in **Send email**, select an SMTP credential (Gmail works through SMTP with an app password) and set the sender and recipient addresses. You can also replace this node with the Gmail node.
2. Activate the workflow.

Scenoptic sends an assignment notification when a topic's assignee changes (topic update), not when someone assigns a topic to themselves. For an on-premise installation, change `https://cde.scenoptic.com` in the link to your base URL.

## Example workflow: email attachments → documents and conversions

[`examples/email-attachments-to-documents-and-conversions.json`](examples/email-attachments-to-documents-and-conversions.json) reads a mailbox and answers the sender once their models are converted:

1. **Incoming email** (n8n IMAP trigger) reads unread mails with their attachments.
2. **One item per attachment** splits the attachments. Models (`.ifc` by default, see `MODEL_EXTENSIONS` in the code) go to **Convert the model**, an on-demand conversion whose *External Reference* is `mail:<Message-ID>`; every other attachment is filed by **File the document** in the chosen folder.
3. **Conversion finished** (Scenoptic Trigger, `conversion.completed` and `conversion.failed`) starts the second part. **Find the sender** keeps only the conversions started by this workflow, **Get the conversion** reads the result, and the sender gets **Reply: converted** (with a GLB link valid for one hour) or **Reply: failed** (with the error code).

The sender's address is never sent to Scenoptic: it is kept in the n8n workflow static data, keyed by the external reference, for 7 days. Static data is only saved for executions started by the active workflow, not for manual test runs.

To use it, import the JSON file, then select your credentials (IMAP, Scenoptic API, SMTP), the project in the three Scenoptic nodes, the folder in **File the document**, and the sender address of both replies. The access token needs `files:write`, `conversions:write`, `conversions:read` and `webhooks:manage`.

## Installing

On a self-hosted instance, go to *Settings > Community Nodes > Install* and enter `n8n-nodes-scenoptic`.

To install it manually, run `npm install n8n-nodes-scenoptic --legacy-peer-deps` in `~/.n8n/nodes`, then restart n8n. Without `--legacy-peer-deps`, npm also tries to install the `n8n-workflow` peer dependency, which n8n already provides.

## Errors

Scenoptic answers errors as `application/problem+json`. The nodes read the stable `code` field (for example `INSUFFICIENT_SCOPE`, `TOPIC_NOT_FOUND`, `QUOTA_BYTES`, `WEBHOOK_URL_FORBIDDEN`) and show it in brackets at the end of the error message; the server's `detail` text is shown as the description.

## Development

This package is built with the official n8n tooling ([`@n8n/node-cli`](https://www.npmjs.com/package/@n8n/node-cli)). It is a standalone npm package, kept out of the Scenoptic pnpm workspace.

```bash
npm ci
npm run build      # n8n-node build
npm run lint       # n8n-node lint (strict mode, n8n Cloud rules)
npm test           # vitest
npm run typecheck  # sources and tests
npm run dev        # local n8n with the nodes loaded (http://localhost:5678)
```

The package's `.npmrc` sets `legacy-peer-deps=true`: the optional peer dependencies pulled in by `@n8n/node-cli` (LangChain, among others) are not installed, so that `npm install` and `npm ci` resolve the same tree. When regenerating `package-lock.json`, pass `--cpu=x64 --cpu=arm64 --cpu=wasm32 --os=win32 --os=linux --os=darwin` so the lock file also covers the optional native bindings of the other platforms.

The tests check every route the nodes call, and every webhook event type, against a copy of the public OpenAPI file (`test/fixtures/openapi.json`, the content of `/api/openapi.json`).

### Releasing

The package is developed in the main Scenoptic repository and copied here as "Sync from Scenoptic" commits. Issues are welcome here; pull requests are ported to the main repository by hand.

To release, update `version` in `package.json` and `CHANGELOG.md`, then push a `v<version>` tag. The *Publish* workflow runs the checks, builds the package and publishes it to npm with a provenance attestation (npm trusted publishing, `npm` environment).

## License

MIT
