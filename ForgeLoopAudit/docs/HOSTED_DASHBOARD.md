# Hosted team dashboard

The hosted dashboard is a separate, read-only ForgeLoopAudit entry for teams.
It reuses the Audit design system, but it does not use the local Audit API.
The local API needs a project's full `.forgeloop/` state, while the hosted
dashboard needs only committed ForgeLoop evidence bundles.

## Sources

- `hosted.html` and `src/hosted/` contain the React entry.
- `src/shared/hosted.ts` holds the validated JSON contract and derived totals.
- `src/shared/hosted-client.ts` maps API responses to explicit states.
- `vite.hosted.config.ts` builds static assets to `dist/hosted/` with base
  `/dashboard/`:

  ```bash
  npm run build:hosted
  ```

The forgeloop-site project serves the build at `/dashboard/` and provides
`GET /api/dashboard`. That API reads evidence bundles and
"ForgeLoop evidence" check runs through the ForgeLoop Evidence GitHub App. It
is protected by Sign in with Google and two allowlists: Google-verified
emails, and GitHub installation accounts.

## Data rules

- Everything shown is self-reported evidence. Unsigned bundles are labeled
  "Unsigned". A bundle that carries a signature is labeled "Signature
  attached", because the dashboard does not verify signatures. Signature
  verification runs in the ForgeLoop GitHub Action.
- Durations, verification cycles and diagnoses come from the optional
  `metrics` block that `forgeloop evidence-export` derives from the task
  ledger. When a bundle has no metrics, the dashboard shows `—` and never
  estimates a value.
- "Rework" means more than one verification cycle or at least one recorded
  diagnosis.
- The contract rejects any repository or pull-request link that is not a
  `https://github.com/` URL.
- The "Cloud sync tokens" section lists, issues and revokes tokens for
  `forgeloop sync-push` and `sync-pull` through `/api/sync-tokens`. A token can
  be issued only for repositories shown on the dashboard, and it is shown
  once. It stays in component state only, never in browser storage. Demo
  mode never calls the token API.
- The optional `installUrl` drives the "Install GitHub App" button. Only a
  `https://github.com/apps/` link is kept; anything else hides the button.

## States

| API response | Dashboard state |
| --- | --- |
| `200` with a valid summary | Dashboard |
| `401` | Sign-in prompt (Sign in with Google) |
| `403` | Access not granted, with the signed-in email to add to the allowlist |
| `503` | Not configured |
| Anything else, or an invalid payload | Error with retry |

Open `/dashboard/?demo=1` to render the bundled demo fixture without signing
in. The page labels it "Demo data".
