# Required staging startup guards

The application must refuse to start when `APP_ENV=staging` and any of these conditions are true:

- database name or host matches the known production database
- Stripe mode is not `test`
- app base URL equals the production URL
- publishing base domain equals the production publishing domain
- Cloudflare token is the production publishing token
- unrestricted email delivery is enabled

Implement these guards only after auditing the current environment loader and configuration architecture.
Do not create a second configuration system when a canonical one already exists.
