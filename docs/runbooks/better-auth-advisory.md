# A Better Auth security advisory

Sign-in runs on Better Auth (pinned exactly: 1.7.8 as built; pnpm-workspace.yaml's catalog). Its advisories:
https://github.com/better-auth/better-auth/security/advisories . Watch them (GitHub "Watch → Security alerts" on the
repository, and Dependabot alerts on ours).

## Within a day of an advisory

1. **Does it touch us?** Compare the affected versions with ours, and the affected feature with what we use: email and
   password, the organization plugin (invitations), twoFactor, the database rate-limit store, sessions in Postgres
   (`apps/api/src/modules/identity/auth.ts`). Write down yes or no, and why.
2. **If yes and a fixed version exists:**
   - the fixed version must also pass the 7-day release-age rule (pnpm-workspace.yaml); if it is younger and the
     advisory is serious, add an exact `minimumReleaseAgeExclude` entry with the advisory as its reason and the date it
     can go (docs/DEVELOPMENT.md, "Supply chain");
   - update the catalog pin, `pnpm install`, `pnpm run ci`, and `pnpm run test:db` (the identity, invitation and
     tenancy suites);
   - the usual review and verification, then `deploy.md`.
3. **If yes and there is no fix yet:** turn off the affected feature if we can (for example close invitations by
   revoking pending ones), or put a rule in front of it (Caddy or the API's own hooks), and tell the owner. If sign-in
   itself is unsafe, the owner may stop the pilot's sign-ins (`docker compose stop caddy` serves nothing) while the Desk
   keeps working.
4. **Afterwards:** revoke sessions if the advisory says sessions may be forged or stolen
   (`delete from identity.session;` as the master user signs everyone out), and rotate `PGN_AUTH_SECRET` in SSM if
   the secret may have leaked (it signs sessions and emailed tokens: everyone signs in again, and links in emails
   already sent stop working).

## Record

The advisory id, our answer to step 1, what we did and when.
