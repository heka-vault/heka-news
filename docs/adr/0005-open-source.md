# 0005. Open source: MIT, Forgejo primary, mirrored to GitHub

- Status: accepted
- Date: 2026-10-18
- Amended by: 0007 (a second CI secret, the Heka Vault read key)

## Context

heka shows its practice through commits. A community site for engineers is better for being
readable, forkable and open to pull requests.

## Decision

- **License: MIT**, © 2026 The Heka Vault, LLC.
- **Forgejo is the primary repository.** Pull requests are reviewed and merged there; Woodpecker
  runs the PR gate (`.woodpecker/ci.yaml`) and deploys `main` to heka's server
  (`.woodpecker/deploy.yaml`).
- **GitHub (`heka-vault/heka-news`) is a push mirror.** Issues and pull requests opened there are
  welcome; maintainers carry accepted changes across.
- **The repository is public, so it names no internals**: no hostnames, internal IP addresses,
  internal codenames, tokens or private URLs. The exceptions are infrastructure config confined
  to `.woodpecker/` and `deploy/` (the LAN registry address and the stack path on the server), as
  in heka's other public site.
- **Secrets never enter the repository.** CI secrets are held by Woodpecker: the Discord webhook
  for the deploy notice, and (ADR 0007) a read key for Heka Vault, from which the deploy fetches
  the site's own secrets into a mode-600 file on the server.

## Consequences

- Anyone can run the site locally with seed data (`bun run seed`).
- A contributor's change passes the same gate a maintainer's does: `bun run check`.
