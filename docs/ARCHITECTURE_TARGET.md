# Target environment

## Production
- branch: `main`
- public domain: `thebrik.it`
- isolated application process
- isolated production database
- production secrets
- live Stripe only
- production publishing domain
- manual promotion only

## Staging
- branch: `staging`
- public test domain: `staging.thebrik.it`
- isolated application process
- isolated staging database
- staging-only secrets
- Stripe test mode only
- staging publishing domain, for example `*.preview.thebrik.it`
- email allowlist or email sink
- `noindex, nofollow`
- access restricted through Cloudflare Access or equivalent

## Mandatory isolation
The staging environment must not share:
- database credentials
- session secrets
- Stripe live keys
- Stripe webhook secret
- Cloudflare production publishing token
- production publish domain
- production email sending behavior
- production storage buckets
- production queues or cron jobs
