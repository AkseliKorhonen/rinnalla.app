# Product readiness checklist

The development clients are intentionally separate from a production release.
Complete this checklist before publishing to an app store or inviting users who
depend on the service.

## Identity and distribution

- [x] Use `app.rinnalla` as the permanent Android application ID.
- [x] Register `app.rinnalla` as a Firebase Android client and use its
  `google-services.json` in local and CI development builds.
- [x] Rename the GitHub repository to `rinnalla.app` and update the Pages base
  path, APK URL, repository metadata, and editor settings.
- [ ] Separate development and production Firebase, Convex, signing, package,
  and release configurations.
- [ ] Establish semantic app versions and a release/changelog process.

Changing an Android application ID after store publication creates a different
application. Do the identifier and Firebase migration together; changing only
one breaks push notifications and native builds.

## User data and support

- [ ] Add account deletion and document which related family, call, token, and
  storage records are deleted or retained.
- [ ] Define retention and scheduled cleanup for completed calls and ICE
  candidates.
- [ ] Verify old profile-image blobs and invalid push tokens are removed.
- [ ] Publish privacy, terms, and support pages appropriate for the release
  regions and app-store requirements.

## Reliability and observability

- [ ] Add privacy-conscious crash reporting for web and native clients.
- [ ] Add backend delivery/error monitoring for Resend, FCM, and TURN credential
  failures without logging tokens or personal call data.
- [ ] Exercise the device smoke suite on at least one phone and one tablet after
  every native dependency or notification change.
- [ ] Test foreground, background, terminated, and locked-device call flows on
  supported Android versions.

## Security and maintenance

- [ ] Review Dependabot pull requests weekly and keep Expo SDK upgrades separate
  from feature work.
- [ ] Triage `npm audit` results manually; do not apply forced dependency
  downgrades to silence transitive advisories.
- [ ] Enable repository branch protection and require the Verify workflow.
- [ ] Confirm GitHub and Convex secrets have named owners and a rotation process.
