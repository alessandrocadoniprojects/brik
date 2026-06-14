# Brik — Codex operating rules

## Absolute rules
1. Audit before editing.
2. Identify the existing implementation, all consumers, duplicate systems, regression risks, and canonical source.
3. Never modify production directly.
4. Never read, print, copy, commit, or expose production secrets or customer data.
5. Never deploy to production without explicit human approval.
6. Never run production database migrations automatically.
7. Never use live Stripe credentials in development or staging.
8. Never publish staging-generated sites on the production publishing domain.
9. Preserve backward compatibility unless a breaking change is explicitly approved.
10. Keep each task isolated in its own Git branch or worktree.
11. Run the repository's existing checks before and after changes.
12. Do not claim completion when checks, screenshots, logs, or acceptance evidence are missing.

## Required task report
Every implementation report must include:
- goal
- files inspected
- current implementation found
- risks and dependencies
- files changed
- commands executed
- exact check results
- remaining risks
- rollback method
- staging URL or reason it is unavailable

## Protected areas
Changes in these areas require explicit human approval before implementation:
- authentication and sessions
- payments and Stripe webhooks
- publishing and Cloudflare integration
- production deployment
- database schema and migrations
- secrets and environment loading
- siteSession and generation orchestration
- user limits, credits, billing, and entitlements

## Visual template acceptance
Visual fidelity to the approved reference is the primary acceptance criterion.
A template cannot advance to integration, dynamization, or production while blocking visual differences remain.
For pizzeria templates, complete “Familiare Quartiere” end-to-end first.

## Branch policy
- `main`: production only
- `staging`: integrated staging candidate
- `codex/<task>`: isolated implementation
- `review/<task>`: optional remediation after review

## Definition of ready for staging
- implementation checks pass
- no protected-area change without approval
- no secret or production endpoint introduced
- acceptance evidence attached
- rollback documented
- reviewer verdict is PASS

## Definition of ready for production
- deployed and verified on staging
- acceptance criteria fully met
- regression checks pass
- security review passes
- visual review passes when UI is affected
- release checklist complete
- human owner explicitly approves promotion
