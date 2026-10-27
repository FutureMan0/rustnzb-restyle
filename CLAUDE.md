# CLAUDE.md — rustnzb-restyle

Fork of [TheDancingDeveloper-org/rustnzb](https://github.com/TheDancingDeveloper-org/rustnzb).
Repository map, build/test commands and engineering rules: **read [AGENTS.md](AGENTS.md) first.**

## What this fork changes (keep it when merging upstream)

- **Web UI design** (`apps/rustnzb/frontend`): Ruddarr/iOS-inspired, mobile-first.
  `styles.scss` tokens (`--tint`, `--card`, `--font-*`, light/dark/OLED palettes, tints),
  `ThemeService` (mode + tint), app shell with sidebar + bottom tab bar + "More" sheet,
  phone card list instead of the queue table below 720px,
  bottom sheets for Add NZB (`features/queue/add-nzb-sheet`), queue job details
  (`features/queue/queue-job-sheet`) and article preview (`features/groups/article-preview-sheet`).
- **Routing**: `/queue` and `/history` are separate pages (upstream combines them under
  `/downloads`, which here redirects to `/queue`).
- **Backend extras**: `GET /api/queue/{id}` (used by the job sheet); preempted downloads are
  re-queued instead of paused (`crates/nzb-web/src/queue_manager.rs`, `preempt_if_needed`);
  `[vpn]` / `RUSTNZB_VPN_*` startup mode (`apps/rustnzb/src/main.rs`).
- **Packaging**: GHCR workflow `.github/workflows/docker.yml` + `docker-bake.hcl` (builds the
  cross toolchain from `Dockerfile.ci` because upstream's toolchain image lives in a private
  registry), `docker-compose.yml` with `direct` / `vpn` (Gluetun/ProtonVPN) profiles,
  `docs/unraid.md`. `.gitea/workflows/image.yml` builds the same image with the same bake
  file on a self-hosted Gitea runner and pushes it to that Gitea's container registry
  (repo variable `REGISTRY`; pushes with the job token, or a `REGISTRY_TOKEN` secret if set).

## Two remotes, two CIs

The working copy pushes every commit to a private Gitea repo and to the public GitHub fork.
Gitea Actions reads `.gitea/workflows` and, as long as that directory exists, ignores
`.github/workflows`; GitHub never reads `.gitea/`. So `docker.yml` and `fork-ci.yml` run
only on GitHub and `image.yml` only on Gitea. Deleting `.gitea/workflows` would make Gitea
run the GitHub workflows, and `docker.yml` would fail at the GHCR login. Keep hostnames and
tokens out of `.gitea/` (the repo is public); they live in the Gitea repo settings.

## Merging upstream

```bash
git switch -c merge/upstream-<version>
.github/merge-upstream.sh            # or: .github/merge-upstream.sh v1.7.0
```

The script fetches upstream, merges without committing and drops every upstream workflow
(and `.github/codeql/`). Upstream's workflows run on its self-hosted runners and publish to
its registry, so in the fork they would hang or collide with `docker.yml` on `v*` tags.
The fork's own workflows are `docker.yml` (GHCR image) and `fork-ci.yml` (fmt, clippy,
tests, frontend tests + coverage gate + build on GitHub-hosted runners); keep the list in
`FORK_WORKFLOWS` in the script in sync when adding one. The script does not touch
`.gitea/` (upstream has none).

After resolving conflicts, check before committing:

```bash
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cd apps/rustnzb/frontend && npx ng test --watch=false && npx ng build
```

On Node 26+ the frontend tests need `NODE_OPTIONS=--no-webstorage` (Node's built-in
`localStorage` shadows jsdom's); CI uses Node 22.

The upstream Playwright suite (`e2e/`) asserts upstream's markup and `/downloads` routes;
it is not part of the fork's CI.
