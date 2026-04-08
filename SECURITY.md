# Security Policy

## Security Contact

To report a security vulnerability, please use one of the following channels:

- **Email**: security@tages.ai
- **GitHub Security Advisory**: [Submit a private report](https://github.com/ryantlee25-droid/tages/security/advisories/new)

Please do not open a public GitHub issue for security vulnerabilities.

## Disclosure Process

1. **Report**: Submit your findings via the contact methods above. Include a description of the vulnerability, steps to reproduce, and potential impact.
2. **Acknowledgment**: We will acknowledge receipt of your report within **48 hours**.
3. **Assessment**: We will investigate and assess the severity of the issue.
4. **Patch**: We aim to release fixes according to the following SLAs based on severity:
   - **Critical**: 7 days
   - **High**: 30 days
   - **Medium**: 90 days
5. **Disclosure**: We coordinate public disclosure with the reporter after a fix is available. We will credit researchers who wish to be acknowledged.

## Scope

The following assets are in scope for security research:

- Cloud dashboard (tages.ai web application)
- MCP server (`@tages/server` package)
- CLI (`@tages/cli` package)
- Supabase schema and database access controls
- npm packages published under the `@tages` organization

## Out of Scope

The following are not in scope:

- Third-party Supabase infrastructure (report issues to [Supabase](https://supabase.com/security))
- GitHub Actions runners and GitHub-managed infrastructure
- A user's own deployment infrastructure or self-hosted instances
- Vulnerabilities in third-party dependencies (report upstream; notify us if Tages is uniquely impacted)
- Social engineering attacks against Tages staff or users

## Safe Harbor

Tages supports responsible security research. We will not pursue civil or criminal action against researchers who:

- Report vulnerabilities in good faith using the channels above
- Avoid accessing, modifying, or deleting data belonging to other users
- Do not perform denial-of-service attacks or disrupt service availability
- Limit testing to their own accounts and data
- Disclose findings to us before making them public

We ask that researchers act in good faith toward our users and follow this policy. In return, we commit to working with you to understand and resolve the issue promptly.
