# Architecture

## Process boundaries

The React/TypeScript renderer is presentation-only. Electron runs it with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`. A preload script exposes named operations rather than raw IPC, filesystem, shell, or network access. Navigation and new windows are denied except explicit HTTPS links opened by the main process.

The Electron main process owns:

- workspace creation and SQLite persistence through `WorkspaceStore`;
- local file validation, hashing, managed copies, linked paths, and relinking;
- DOCX extraction and conversion;
- versioned ZIP archive export/import and path traversal checks;
- OS-encrypted provider credentials;
- OpenAI requests and cancellation;
- native file dialogs and reveal-in-folder operations.

## Data model

Stable UUIDs identify workspaces, files, batches, evidence, claims, evidence/claim relationships, tasks, conversations, messages, and history entries. Evidence-to-claim relationships have independent roles (`supports`, `qualifies`, `contradicts`, `context`) and an explicit dependency group field so later editions or retellings need not be counted as independent witnesses.

Receipt, extraction status, verification, claim assessment, and task status are stored separately. The app deliberately has no catch-all “verified source” flag.

## Workspace archive

Format version 1 is a ZIP container with `manifest.json`, `workspace.sqlite`, and managed `files/`. Every payload has a SHA-256 digest and byte size. Import rejects absolute paths, traversal paths, missing entries, version mismatches, and digest mismatches. Application settings and secrets are outside the workspace and are not exported.

## Extension points

Provider work belongs in the main process behind narrow IPC operations. Planned Drive and catalogue adapters should produce immutable imported snapshots carrying provider IDs, source URLs, authority labels, and refresh timestamps. Refresh must be explicit and must never overwrite originals. Bidirectional synchronization should not be added until conflict behavior is designed and tested.

AI providers should implement a common streaming contract and receive a preflight context bundle chosen by the user. Context is always delimited as untrusted research material. Substantive proposed record or manuscript changes should become reviewable change objects, not direct mutations.
