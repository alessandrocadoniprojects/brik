# Codex delivery workflow

1. Intake
   - Convert the request into measurable acceptance criteria.
   - Record protected areas and required approvals.

2. Audit
   - Read the real code.
   - Map current behavior, consumers, tests, and deployment impact.
   - Stop if the canonical implementation cannot be identified.

3. Plan
   - Create a minimal change plan.
   - Name files to change and files not to touch.
   - Define checks and rollback.

4. Build
   - Work in `codex/<task>`.
   - Keep the change scoped.
   - Do not deploy.

5. Technical review
   - Inspect the diff.
   - Run checks.
   - Reject duplication, unverified assumptions, unsafe environment usage, and unrelated changes.

6. Security review
   - Check secrets, auth, permissions, injection, data isolation, webhook handling, and environment boundaries.

7. Visual/product review
   - Required for UI, UX, templates, landing pages, and generated sites.
   - Compare reference and render directly.
   - Record blocking differences.

8. Integrate into staging
   - Merge only after all required reviewer verdicts are PASS.
   - Deploy the `staging` branch through the staging pipeline.

9. Staging verification
   - Test the actual public staging URL.
   - Capture logs, screenshots, relevant flows, and regression evidence.

10. Production candidate
    - Create a release record.
    - Human owner approves promotion.
    - Merge or promote the exact reviewed commit to `main`.

11. Production verification
    - Run only production-safe smoke checks.
    - Confirm rollback readiness.
