Run a security review of the Tages configuration.

Check: encryption key is set (TAGES_ENCRYPTION_KEY), auth tokens are not expired, HSTS header is configured, CSP does not include unsafe-eval in production, RLS is enabled on all tables. Report pass/fail for each.
