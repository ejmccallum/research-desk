# Evidence and argument maintenance

Open **Library → Evidence & argument maintenance**, or **Edit records & review corrections** from an existing navigation panel. The editor supports evidence, claims, per-claim evidence relationships, directed source dependencies, chronology, and tasks. It works offline and writes only to the local workspace.

Select a record or create a new one, make changes, explain the reason, and choose **Review changes**. The preview shows field differences, archiving status, verification warnings, and affected records. **Apply reviewed change** commits the preview. Main-process validation rejects outdated revisions, switched workspaces, duplicate connections, unavailable references, invalid relationship/status values, dependency cycles, and reuse of an applied preview. Remote Airtable records and inherited protocol rows remain read-only here.

Corrections propagate along explicit references: evidence to claim relationships and claims, source dependency chains to dependent evidence, and linked chronology/tasks. Dependent prose and completion statuses are not rewritten. Persistent review flags appear in the editor and Workflow checks. Select the relevant flags on a record, explain your review, and apply that review to resolve them. Unstructured historical notes are not inferred as links; establish explicit references before relying on propagation.

Changing quotation, locator, or source assignments resets evidence verification to uncertain. Editing cannot promote citation readiness. Human page verification remains in Intake; manuscript/change-log consistency remains separate. Non-task record changes conservatively mark existing assessment jobs/reports stale while retaining their original findings and ledger snapshots. Start a new assessment to use corrected records.

Chronology retains free-form dates/ranges and uncertainty. Imported Events and Connections records remain visible with the original fields and migration provenance; confirm their dates and explicit links locally. Source dependencies record direction, relationship, and rationale. A missing dependency record does not establish independence.

Archiving retains records and history. Include archived records to restore them through review. Change history records before/after values, reason, actor, timestamp, and affected IDs; **Draft restoration for review** prepares a compensating edit against the current revision. Restoration does not reinstate superseded verification or erase earlier changes. History here covers reviewed maintenance changes; earlier import and creation provenance remains in the original workspace audit/migration storage.

Storage uses an additive `project_data` maintenance record alongside existing SQL evidence/claim/link/task tables. Evidence IDs and raw migration snapshots remain intact. Workspace exports/imports include metadata, flags, and history automatically. No credentials, provider call, remote write, or manuscript edit is involved.

The research assistant's project-record tools retrieve current local ledger records, including chronology and dependencies, with unresolved correction flags and archival status. Current records supersede historical migration fields. A ledger change during a research response invalidates that response's input revision.

## Verification

Automated regressions exercise explicit preview/apply, stale revisions/workspace mismatch, duplicate apply, transitive correction flags, independent verification, relationship restoration, cycles/duplicates, assessment staleness, persistence/export/import, current assistant retrieval, and UI preview/Escape/error recovery. A live Electron synthetic-workspace correction was previewed, applied, and found in history. The editing/review fixture was checked for overflow at 480, 640, 860, 1024, and 1440 pixels in both themes and at 640×360. Real Thesis records were not edited during testing.
