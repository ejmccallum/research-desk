# Test and release checklist

Automated tests cover persistent reopen, exact duplicate handling, evidence locators, archive integrity/import, and the credential-free state. Before publishing a build, also run this manual smoke test:

1. Start with a fresh app-data directory and create a workspace outside the repository.
2. Import TXT, Markdown, image, PDF, and DOCX samples as managed copies. Link another local file.
3. Restart the app, reopen the workspace, and open each source.
4. Reimport an unchanged file and confirm it is reported as a duplicate.
5. Select text, create evidence with a locator, create a claim, and link the evidence.
6. Move a linked source, confirm the broken-link check, then relink the identical file.
7. Export and import the workspace; compare record and file counts. Confirm no API key appears in the archive.
8. With no key configured, confirm the assistant shows setup and cannot send. With a disposable test key, verify streaming, cancellation, context disclosure, and an intentional authentication failure.
9. Confirm the Google Drive and Airtable panels say setup is required and do not claim a connection.

Release claims must list the exact OS and architecture tested. A build that merely completes cross-platform configuration is not evidence that the resulting installer works on that platform.
