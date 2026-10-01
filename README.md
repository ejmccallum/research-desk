# Research Desk

Research Desk is a white-label, offline-first desktop research workspace. It keeps source originals, evidence records, claims, tasks, and conversations connected without requiring Google Drive, Airtable, or an AI account.

> Status: functional initial release (v0.2.0). Local workspace creation, copy/link import, checksum deduplication, PDF/image/DOCX/text viewing, Markdown/plain-text editing, evidence capture, claims, workflow checks, tasks, side-by-side comparison, portable workspace archives, theming, personal ChatGPT sign-in, and the OpenAI Responses API are implemented. See [Limitations](#limitations) for intentionally incomplete integrations.

## Run locally

Requirements: Node.js 22 or newer and npm. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

```powershell
npm.cmd install
npm.cmd run dev:electron
```

The Vite renderer and Electron main process run in watch mode. A workspace is a user-selected directory containing `workspace.sqlite` and a `files/` directory. Never choose this source repository as a research workspace.

Build and test:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

## Package

```powershell
# Windows NSIS installer on Windows
npm.cmd run package

# Unpacked application for the current OS
npm.cmd run package:dir
```

The Electron Builder configuration targets Windows x64 NSIS and macOS x64/arm64 DMG. macOS artifacts must be built and tested on macOS. Public distribution requires the appropriate Windows code-signing certificate and Apple Developer ID/notarization setup; neither is included.

## How the app stores research

- `workspace.sqlite` contains metadata and analytical records.
- `files/` contains managed source copies under stable UUID-based names.
- Linked files remain in their original location and are less portable. Research Desk detects a broken link and only accepts a relinked file whose SHA-256 checksum matches the original.
- App preferences and encrypted credentials live in Electron's per-user application-data directory, outside workspaces and exports.
- API keys are encrypted with Electron `safeStorage` when OS encryption is available. They are never exposed to the renderer, logged, or exported.

Each imported file is committed as a processing checkpoint. If intake is interrupted, completed files remain recorded; importing the same batch again skips exact checksum matches instead of multiplying records.

## Backup and migration

Use **Settings → Export portable archive**. A `.researchdesk` archive includes the database, all managed files, a versioned manifest, sizes, and SHA-256 integrity hashes. Linked external files are referenced but cannot be embedded silently; copy them into the workspace first if the backup must be self-contained.

On another computer, choose **Import archive** on the welcome screen and select a new empty destination folder. Installing the app itself does **not** synchronize research. Keep periodic archives in a separately backed-up location and test imports occasionally. Credentials are intentionally excluded and must be configured again on the destination computer.

For manual recovery, close Research Desk and back up the entire workspace directory. Restore it as a unit; do not copy only `workspace.sqlite` when managed files exist.

## Personal ChatGPT and API access

Open **Settings → Personal ChatGPT** and select **Continue with ChatGPT**. Research Desk opens OpenAI's authorization page in your system browser and listens for the callback only on `127.0.0.1`. It uses Authorization Code + PKCE and validates the signed identity token, issuer, audience, expiry, state, and nonce. The issued access, refresh, and identity tokens are encrypted with Electron `safeStorage`, never sent to the renderer, and excluded from workspace exports. Tokens refresh automatically and can be revoked with **Disconnect**.

After connection, Research Desk loads the models available to your ChatGPT plan. Model availability and usage limits depend on that plan. The app can invoke supported models, but it cannot access ChatGPT conversation history, memory, uploaded files, or custom GPTs.

As an alternative, open **Settings → OpenAI API Key**, enter an API key, and choose a model available to the API project. Standard API usage is billed separately from ChatGPT. Saving an API key makes it active; choosing a ChatGPT model switches back to the personal connection.

Only the selected document's extracted text (capped for the request), selected text, explicitly attached evidence records, and recent messages in the current Research Desk conversation are sent. Attached context is visible and removable before sending. Requests use `store: false` and streaming; no response is accepted until OpenAI sends `response.completed`. No response is simulated if credentials are absent. See [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), and the [Responses API streaming reference](https://platform.openai.com/docs/api-reference/responses-streaming).

## Optional connections

Google Drive and Airtable setup screens are informational in this release; no connection is claimed.

- A distributable Google Drive integration needs an OAuth client and consent configuration owned by the distributor. The planned read/import flow uses a user picker and the narrow `drive.file` scope, retains provider IDs, and never overwrites originals. See [Google's scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- Airtable access should use a user-created, base-scoped personal access token with read-only permissions, followed by explicit base/table/field mapping. Legacy API keys no longer work. See [Airtable PAT guidance](https://support.airtable.com/docs/creating-personal-access-tokens).

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: React renders the workbench; a sandboxed Electron renderer receives a narrow preload API; the main process owns files, SQLite, archives, credentials, network calls, and system dialogs. User material is never treated as executable instruction.

## Limitations

- Tested in the current environment: Windows production build, unit tests, static/type checks, NSIS installer creation, and an eight-second packaged-app launch smoke test. The installer itself was not interactively installed. macOS packaging is configured but not tested here.
- PDF viewing uses Chromium's native PDF viewer. Page navigation, zoom, text selection, and in-document search are provided by that viewer; a selected PDF passage cannot yet be transferred automatically from the embedded viewer because Chromium isolates its selection. Text/DOCX selections can create evidence directly.
- DOCX rendering is read-only via Mammoth and can differ from Word. Originals are kept intact and can be opened in the system editor. Revision-suggestion export is not yet implemented.
- Custom folders, image region selection, OCR, a batch-state editor, semantic contradiction suggestions, undo UI, saved-conversation reopening, and reviewed revision export are not yet implemented. Schema boundaries support later additions.
- Google Drive and Airtable are documented setup surfaces only. No OAuth/PAT connection or cloud refresh is implemented.
- Workspace retrieval currently uses the selected document and explicit evidence; full-text ranked retrieval is not yet implemented.
- Personal ChatGPT sign-in uses OpenAI's open-source-app preview. It provides model invocation only and cannot import ChatGPT chats or memory. The real account authorization step must be completed interactively by the user in a browser.
- White-label name and accent are configurable. Replacing the packaged executable icon requires supplying build-time icon files.

Synthetic demo data is not installed automatically. The repository contains no personal research, credentials, account IDs, or absolute user paths.
