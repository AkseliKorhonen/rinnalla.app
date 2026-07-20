# Security policy

Please report suspected vulnerabilities privately to `support@rinnalla.app`.
Do not open a public issue containing credentials, personal data, access tokens,
or reproducible details for an unpatched vulnerability.

The public GitHub releases are development builds. Security fixes are applied to
the current development branch; no older development APK version is supported.

Repository secrets belong in GitHub Actions, Convex deployment variables, or
ignored local credential files. If a credential is exposed, revoke and rotate it
before removing it from source history.
