# Manuscript revisions

Open **Revision queue**, select an imported DOCX, Markdown, or text manuscript, and explicitly register its working snapshot. The migrated draft is a candidate, not an automatically adopted current draft. PDF and image files remain evidence sources.

Select text in the manuscript representation, identify its chapter, and choose replacement, deletion, or insertion before/after. DOCX text does not represent Word pagination or formatting. Save a manual proposal, or preview a selected-passage AI request with the configured provider, model, instruction, context, and evidence before sending. Requests are bounded and cancellable; successful output remains pending. Failed or interrupted requests require explicit retry and a new preview.

Review original and proposed text, rationale, evidence, dependencies, and citation gaps. Substantive approval requires supporting evidence and human confirmation of the exact support, source/edition, locator, and citation wording. An explicitly linked current Intake page confirmation can supply the existing verification. Editorial approval requires confirmation that meaning and factual claims are unchanged. Chapter 3 requires authorization for the selected passage. Editing an approved proposal creates a pending version.

Select approved proposals for a single snapshot to export a separate Word revision packet. Conflicting anchors, changed inputs, missing sources, and citation gaps block export. The packet includes anchors, before/after text, rationale, citations, and a dated change log. Existing files and workspace files cannot be overwritten. Exported does not mean applied: manuscripts and the manuscript/change-log portion of the Three-Green Lock are never updated by this workflow.

## Persistence and validity

SQLite project data stores manuscript-revisions with immutable proposal versions, review events, AI jobs, and export manifests. Immutable original-byte snapshots are stored under workspace files and included in portable workspace archives. Normalized text, paragraph positions, offsets, exact text, context, extraction version, and SHA256 identify anchors. Checks before approval and export compare actual draft/source bytes, relevant ledger and Intake records, and project configuration. Historical proposals remain readable; reassignment creates a pending version against a user-confirmed new anchor, with all exact matches offered explicitly.

## Verification

Automated service/UI coverage includes Unicode and repeated anchors, Chapter 3 boundaries, edits and review invalidation, stale/missing drafts, reassignment, citation gates, conflicts, AI failure/cancellation/restart, portable persistence, and Word packet integrity. A synthetic live ChatGPT proposal was manually reviewed and exported through the desktop Save dialog; both packet pages were rendered and inspected. Responsive checks covered 480, 640, 860, 1024, and 1440 pixels in both themes, plus a short window. Original synthetic manuscript bytes remained unchanged.
