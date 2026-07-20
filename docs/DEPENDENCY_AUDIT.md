# Dependency audit baseline

Last reviewed: 2026-07-20

Run `npm audit` and `npm outdated` before dependency-focused changes, then run
`npm run verify` after updating the lockfile. Keep Expo SDK upgrades separate
from ordinary package updates so native compatibility can be tested clearly.

The current audit reports 23 moderate transitive advisories and no high or
critical advisories. They arrive through maintained top-level dependencies,
including Expo tooling, Next.js/PostCSS, Firebase Admin/Google Cloud tooling,
and native build tooling. `npm audit fix --force` proposes incompatible package
changes, so these advisories are accepted temporarily while their upstream
packages provide compatible fixes.

Review this baseline weekly and whenever Dependabot opens an alert. Escalate a
high or critical advisory immediately, or a moderate advisory when it affects a
runtime path exposed to untrusted input. Do not suppress audit output or force a
downgrade solely to make the count zero.
