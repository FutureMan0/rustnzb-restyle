## Unraid (Community Applications) Setup

Dieses Repo baut ein Docker-Image nach **GHCR** (GitHub Container Registry). Unraid kann das Image direkt ziehen und über das CA-Template Updates erkennen.

### 1) Image / Tag

- **Image**: `ghcr.io/<DEIN_GHCR_OWNER>/rustnzb-restyle`
- **Tag**: `latest` (empfohlen für „immer neuestes“) oder ein `vX.Y.Z` Tag (wenn du Releases taggst)

Wenn du dieses Repo unter `FutureMan0` verwendest, ist der Owner typischerweise `FutureMan0`.

### 2) Empfohlene Container-Settings

- **Port**: `9090/tcp` (Web UI + API)
- **Volumes**
  - `/config` → App-Konfig & Credentials
  - `/data` → DB / State
  - `/downloads` → Incomplete/Complete Downloads
- **Environment**
  - `PUID`, `PGID` (Unraid User/Group, meistens 99/100 oder 1000/1000 – je nach Setup)
  - `TZ` (z.B. `Europe/Berlin`)
  - `RUST_LOG` (z.B. `info`)

### 3) Healthcheck

- URL: `http://<host>:9090/api/health`

### 4) Updates in Unraid

Wenn du das CA-Template auf `:latest` nutzt, erkennt Unraid neue Image-Digests über **Check for Updates** und kann aktualisieren.
Tag-Strategie: `latest` folgt dem `main`-Branch; versionierte Builds kommen über Git-Tags wie `v1.2.3`.

### 5) Beispiel mit Docker Compose

Siehe `docker-compose.yml` / `docker-compose.example.yml` im Repo. Setze dabei:

- `RUSTNZB_GHCR_OWNER=<DEIN_GHCR_OWNER>`
- optional `RUSTNZB_IMAGE_NAME=rustnzb-restyle` (Default)
