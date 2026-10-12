# CLAUDE.md — rustnzb-restyle

Fork of [TheDancingDeveloper-org/rustnzb](https://github.com/TheDancingDeveloper-org/rustnzb).
Repository map, build/test commands and engineering rules: **read [AGENTS.md](AGENTS.md) first.**

## What this fork changes (keep it when merging upstream)

- **Web UI design** (`apps/rustnzb/frontend`): Ruddarr/iOS-inspired, mobile-first.
  `styles.scss` tokens (`--tint`, `--card`, `--font-*`, light/dark/OLED palettes, tints),
  `ThemeService` (mode + tint), app shell with sidebar + bottom tab bar + "More" sheet,
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
  `docs/unraid.md`.

## Merging upstream

```bash
git fetch upstream
git merge upstream/main
```

Upstream workflows under `.github/workflows/` (except `docker.yml`) target upstream's
self-hosted runners; disable them in the fork's Actions settings.
