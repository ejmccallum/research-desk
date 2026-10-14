# Standalone readiness

## Status — 14 October 2026

Current target: Mac only, as requested by the user. Windows installation and cross-OS migration are no longer release requirements.

This is a personal-use readiness milestone, not a signed public release. All execution tests use synthetic workspaces and isolated application profiles. The real Thesis workspace is not used for destructive, migration, or crash testing.

| Check | Result |
| --- | --- |
| Mac ARM64 packaged offline core | Passed: bundled SQLite, DOCX, PDF/image rendering, OCR, project templates, renderer/preload, and study artwork |
| Reviewed Word packet export | Passed using a synthetic editorial proposal; original manuscript unchanged |
| Self-contained backup restore | Passed after deleting original linked sources; file hashes, IDs, records, proposal approval and history compared |
| Forced termination | Passed: persisted partial chat, interrupted revision, paused assessment with findings, and multi-page extraction checkpoint recovery |
| Mac Intel package | Built; execution unverified on this ARM64 host without x86 translation |
| Windows installation and execution | Out of scope |
| Mac → Windows → Mac migration | Out of scope |
| Signing/notarization | Not configured; personal-use unsigned packages only |

The final suite passed **146 tests**, type checking, and the production build. A read-only mounted DMG was copied to a clean temporary installation; that installed copy passed the same checks. Native UI inspection confirmed the restored workspace, saved index, missing provider credentials, preserved proposal approval/export state, and interrupted requests. See [recorded results and installer checksums](readiness/mac-arm64-2026-10-14.json).

Detailed synthetic results are produced by the packaged test runner as JSON and logs. Build success alone does not establish installation or runtime success on another platform.

## Install and use

On Mac, open the matching ARM64 or Intel DMG and copy Research Desk into your Applications folder. Unsigned packages can encounter operating-system trust prompts; signing and notarization are outside this milestone.

Create a workspace or open its folder. Local reading, prepared-content search, OCR, evidence maintenance, human review, manuscript proposals, and Word packet export do not need provider credentials. AI requests and remote-source refresh require connectivity and a configured account. Credentials remain in the local machine's encrypted settings and never travel in workspace backups.

In Settings, choose **Export portable archive**. Available external links are copied into the archive's database as managed files. The original workspace keeps its links; the archive records their original locations as provenance. Missing or externally changed files block export until relinked or reviewed. Stored extracted text and checkpoints travel; regenerable OCR caches and application settings do not.

To restore or migrate, copy the `.researchdesk` archive to the destination computer, choose **Import archive**, and select an empty folder. The complete archive and database are checked before that folder is published. The success dialog reports verified payloads, converted links, and unavailable legacy links. Version-1 archives remain supported; older backups may require relinking sources they did not include. Reconnect AI, Drive, or Airtable accounts in Settings as needed.

Export does not apply manuscript proposals in Word or confer human verification. Restoring unchanged bytes preserves existing confirmations without upgrading inherited labels.

## Reproduce the checks

Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. Build on the corresponding host using `npx electron-builder --mac --arm64 --x64`.

Run the packaged diagnostic harness, with an empty output directory:

```sh
node scripts/readiness.mjs '/path/to/Research Desk executable' local '/absolute/temporary/output'
```

The runner launches the executable with no development-server environment and a temporary working directory. It creates a fresh profile, exercises local services, exports a backup, deletes original fixture sources, restores into a different folder, and force-kills a separate process during live synthetic jobs. It reopens that workspace and checks recovery. Provider responses in crash tests are deterministic substitutes: no real credentials or research are sent.

The test blocks Chromium HTTP/WebSocket requests and main-process fetch; it does not change the computer's network settings or claim to be an OS firewall test. OCR workers use bundled language assets. Packaged renderer loading is a smoke check, not a replacement for manual UI inspection.

`.github/workflows/standalone-readiness.yml` now runs Mac tests, builds both Mac architectures, and checks the packaged app on the runner's native architecture. It retains logs and installers. The [Mac job completed successfully](https://github.com/ejmccallum/research-desk/actions/runs/38653381246/job/116157306101): all 146 tests, type checking, build, packaging, and the offline/restoration/crash checks passed. Windows and cross-OS jobs have been removed.

For isolated manual UI checks, `RESEARCH_DESK_TEST_PROFILE=/absolute/temporary/profile` selects a separate profile. `RESEARCH_DESK_READINESS_ROOT` and `RESEARCH_DESK_READINESS_PHASE` are reserved for the diagnostic harness; do not point them at a real workspace.

## Known execution limits

Intel Mac execution remains unverified; its installer is built. The completed native Mac CI run and local Apple Silicon installation tests establish Mac ARM64 readiness for the synthetic scenarios. A restored-copy trial with actual research material remains the next validation step.
