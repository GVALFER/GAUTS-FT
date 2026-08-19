# Security Policy

## Reporting a vulnerability

Please do not disclose security vulnerabilities through a public issue.

Send a private report to the repository owner with:

- the affected version;
- a clear reproduction;
- the expected and observed behavior;
- the potential impact.

Reports will be reviewed before a public fix or advisory is published.

## Package scope

`@gauts/ft` is an HTTP client. It does not provide authentication, authorization, runtime response validation, secret storage, CSRF protection, or application-level caching. Applications remain responsible for validating remote data and applying their own security policy.

Server header forwarding is disabled by default. `cookie` and `authorization` are not part of the built-in allowlist and must be added explicitly. Applications must only forward credentials and proxy-derived IP headers to trusted destinations.
