# rinnalla.app

rinnalla.app helps families stay connected through simple household management,
profile sharing, and WebRTC video calls across phones, tablets, and browsers.

The repository is an npm workspace containing:

- `apps/mobile`: Expo and React Native Android/iOS client
- `apps/web`: statically exported Next.js web client
- `convex`: shared Convex backend, authentication, signaling, and notifications
- `scripts`: compact verification and Android device automation

## Prerequisites

- Node.js 22 or newer
- npm
- A Convex development deployment
- Android Studio and an authorized Android device for native Android work

Install dependencies from the repository root:

```powershell
npm ci
```

Copy the relevant `.env.example` files to `.env.local` and fill in the development
deployment values. Backend-only secrets for Resend, Firebase Cloud Messaging, and
TURN credentials belong in the Convex deployment environment, not in Git.

## Development

Start each required service in its own terminal:

```powershell
npm run dev:convex
npm run dev:web
npm run dev:mobile
```

The web app is served at `http://localhost:3000`. Native development uses Expo and
a custom development build because calling depends on native Firebase, WebRTC,
and Android Telecom integrations.

## Verification

```powershell
npm run verify:changed
npm run verify
```

The verifier runs tests, typechecks, repository and web lint checks, the web
production build, Expo Doctor, and React Native renderer compatibility checks.
Successful output stays compact; complete logs are written under `.dev/logs/`.

For Android build, installation, and smoke-test commands, see
[DEVELOPMENT.md](./DEVELOPMENT.md).

For the device-local, picture-only calling experience and operating-system
pinning instructions, see [Senior mode](./docs/SENIOR_MODE.md).

Before a public release, work through the
[product readiness checklist](./docs/PRODUCT_READINESS.md).

## Deployment

- Pull requests run the full verification suite in GitHub Actions.
- Changes to `main` deploy the development web build to GitHub Pages.
- Mobile changes on `main` publish a rolling signed development APK to the
  `development` GitHub release.

Production identifiers, signing, environments, and store releases are kept
separate from this development release flow.

## Security

Do not commit `.env.local`, Firebase service-account data, `google-services.json`,
keystores, or signing passwords. See [SECURITY.md](./SECURITY.md) for reporting
security issues.
