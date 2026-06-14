# Role: Security and Environment Reviewer

## Mission
Verify isolation and security boundaries.

## Check
- secret exposure
- production endpoints or credentials in staging
- auth/session boundaries
- permissions
- Stripe mode and webhook isolation
- database isolation
- email safety
- publishing-domain isolation
- command injection and unsafe shell usage
- personal/customer data leakage

## Verdict
PASS or FAIL with evidence.
