# OnePWS AuditPro

Finding descriptions grow while typing and can be resized vertically by dragging the bottom-right corner. This applies to Audit Execution, the Findings Register and the CAPA finding editor.

## Audit questions

In Audit Execution, questions added to an **Internal Checkpoints** section are automatically saved to **Master Library > Internal Checkpoints** for the audit's department. Admins and auditors can use this feature. The library save is confirmed before the question is added to the active audit; if it fails, the form stays open for retry. Matching questions are reused, and concurrent additions append without replacing the library. Future audits include the saved question. Existing planned/completed audits keep their question snapshots. Questions added to other standard sections remain specific to that audit.

**Search Audit Questions** searches all sections by question text, clause, audit tip and section/standard name. Questions can be answered directly in the results. **Open Section**, the section navigation or **Clear Search** returns to the normal section view. Searching keeps question IDs, answers, notes, findings, progress and submission checks unchanged. Section-wide N/A and Clear actions appear only in the normal section view.

## Business Unit Head setup

1. In **Master Data > Departments**, edit each department and enter its **Business Unit**. Suggestions include CD, CR, PWSFloors and MOT; other names can also be entered.
2. In **Admin Panel > Users**, add or edit a user with the **Manager** role. Set **Manager Access** to **Business Unit Head (assigned units only)** and select the assigned units. A head can oversee multiple units.
3. Save, then refresh or sign in as the head to verify the mapped departments, findings, CAPA, dashboards and audit reports.

Each department has one Business Unit. Historical findings and audits inherit access from their existing department link, so no finding IDs, department codes or audit links need migration. Departments without a Business Unit remain hidden from Business Unit Heads. Configure mappings explicitly; no production assignments are inferred from department codes or email addresses. Map any legacy duplicate department records as well.

Existing managers keep their existing access until explicitly changed to Business Unit Head access. Admin and auditor access stays unchanged. BUH restrictions are enforced on the server for full sync, direct key reads, single and bulk writes, media listing and finding reminders. Global logs, backups and notifications without department scope are not exposed to heads. Scoped saves preserve records belonging to other units. Access changes replace the browser's data on its next refresh/sync and close editors holding the previous scope.

Deploy the client and server together before configuring users. These source changes do not assign existing departments/users or modify production data.

## Validation

- `npm run build:client`
- `npm run lint --prefix client`
- `npm test --prefix server`

The server tests use in-memory records and do not connect to MongoDB or send emails. Before production rollout, verify long descriptions and manual resizing on desktop/mobile, then compare two BUH accounts assigned to different units and check an admin/auditor account retains its existing view.
