# Intake and assessment

Open **Intake & assessments** from the Library or home dashboard.

1. Name a delivery. Add managed copies or select existing local library files. Exact duplicates attach to their existing file records.
2. Group the delivered files by source and edition/archival unit. Record uncertainties, intended extent, and expected printed-page ranges. Confirm identity explicitly.
3. Build the page inventory. This runs local extraction/OCR only for selected group files. Check order, printed labels, gaps, duplicate captures, and legibility. DOCX/plain-text units are sections, not print pages.
4. Mark the intended delivery complete. Select groups and preview the provider, model and material to be sent. Start assessment explicitly.
5. Review the saved report and accept evidence, relationship or task proposals individually. No proposal edits the manuscript.
6. Compare corrected transcription against the original image, confirm human verification, enter precise citation details, then confirm citation readiness. Manuscript/change-log consistency remains a separate Three-Green Lock requirement.

## Meaning of status

Receipt does not imply extraction; extraction does not imply reading. AI reading and AI image inspection have separate timestamped events. Neither implies human verification. Citation readiness requires a current human verification event, confirmed source identity, a locator, citation details and nonempty transcription. Imported historical labels do not satisfy these requirements.

Review history is retained, while current confirmations are filtered against the page and source-group fingerprint. Changes to bytes, transcription, source assignments or project configuration mark affected assessments stale. Old reports and exact source snapshots remain available; stale reports cannot be accepted. External missing files must be restored before review can continue.

Expected ranges are descriptive rather than automatically parsed: gaps and duplicate captures must be recorded in page issues/notes. A report discloses partial or unknown completeness and never equates a received excerpt with a complete book.

## Persistence and boundaries

The additive `intake_state` SQLite table stores the versioned delivery, group, inventory, review-event and assessment records. Workspace exports already include this database, so reports, source snapshots and acceptance provenance travel with the workspace. OCR cache and transient page renderings are regenerable and credentials are excluded.

One intake operation runs at a time. Assessment records pin file checksums, source assignments, model/provider, adopted project configuration and the consulted ledger snapshot. Text is processed in bounded parts; findings checkpoint per inventory unit. Report synthesis checkpoints in batches of six units. Pause/cancel aborts the active provider call; restart recovers running jobs as paused. Explicit resume/retry retains successful checkpoints. A failed in-progress unit may be repeated. Unsupported image input fails visibly instead of silently downgrading to text-only verification.

Report synthesis compares existing claims and up to 30 source-linked evidence records per batch, disclosing the selected versus relevant count. Source findings remain available in full. A bounded transcription excerpt is included for synthesis of long sections; proposals are checked against the complete stored transcription. Reports are not an exhaustive audit of the entire thesis corpus.

Accepting proposals is transactional and idempotent. Evidence remains machine-extracted unless its page transcription has a current human verification. Relationship proposals refer only to existing local claims. Tasks retain their report/page/checksum provenance in the acceptance history. No remote ledger writes occur.

The IPC interface requires workspace IDs and optimistic revisions. The main process checks group membership, source availability, checksums, current input fingerprints and proposal references. No AI operation starts on ordinary import or application launch.

## Validation

Automated tests cover complete-delivery gating, grouping/revision guards, independent verification stages, stale inputs, restart/workspace interruption, checkpoint retry, invalid quotations, idempotent acceptance, portable restoration, and offline PDF/image rendering. UI tests cover provider previews and current versus historical confirmations. Existing responsive tests cover overlays, Escape/focus restoration and resized-panel docking.

An isolated Electron fixture was rendered in evening/daylight themes at 480, 640, 860, 1024 and 1440 pixels, plus 640×360. No horizontal overflow was measured. Synthetic provider responses validate failure and recovery paths. On 14 October 2026, live desktop testing with a separate synthetic workspace also passed local OCR, image assessment through the connected ChatGPT model, pause/resume, report generation, evidence acceptance, renderer reload, and app-restart persistence. The full suite passed 109 tests; type checking and production build passed.

The live test exposed an ambiguity where printed page label “12” was treated as twelve expected pages. Assessment payloads now name this field `expectedPrintedPageLabelsOrRanges`, keep `expectedPageCount` unknown, and explicitly prohibit inferring missing pages from labels. A regression test covers both provider stages; a second live assessment correctly reported one supplied page labelled 12 with no documented missing pages. No Thesis material was sent or changed by these synthetic assessments.

Workspace-switch testing also exposed stale document tabs from the prior workspace. Tabs and intake selection now reset on workspace identity changes, covered by a renderer regression test. The Thesis workspace was restored after live testing.
