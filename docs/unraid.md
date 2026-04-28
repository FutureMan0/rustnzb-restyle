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
  - `RUSTNZB_VPN_ENABLED` (`true`/`false`, überschreibt `config.toml`)
  - `RUSTNZB_VPN_PROVIDER` (für dieses Setup: `protonvpn`)
  - `RUSTNZB_VPN_TRANSPORT` (`wireguard` oder `openvpn`)
  - `RUSTNZB_VPN_PROFILE` (Region, z.B. `nl`, `de`, `ch`)

### 3) ProtonVPN mit Gluetun (Kill-Switch)

Empfohlener Betrieb: `rustnzb` nutzt den Netzwerk-Stack eines Gluetun-Containers.

- Gluetun mit `VPN_SERVICE_PROVIDER=protonvpn` konfigurieren.
- Proton-Secrets nur als ENV setzen:
  - OpenVPN: `OPENVPN_USER`, `OPENVPN_PASSWORD`
  - WireGuard: `WIREGUARD_PRIVATE_KEY`, `WIREGUARD_ADDRESSES`
- Kill-Switch aktiv lassen (`FIREWALL=on`).
- Nur den benötigten Web-Port am Gluetun-Container freigeben.

### 4) VPN an/aus steuern (TOML + ENV)

In `config.toml`:

```toml
[vpn]
enabled = false
provider = "protonvpn"
transport = "wireguard"
profile = "nl"
```

Umgebungsvariablen haben Priorität vor TOML:

- VPN aktivieren: `RUSTNZB_VPN_ENABLED=true`
- VPN deaktivieren: `RUSTNZB_VPN_ENABLED=false`

Das ist absichtlich nur ein Laufzeit-/Orchestrierungs-Schalter: Der Tunnel wird von Gluetun bereitgestellt, nicht von `rustnzb` selbst.

### 5) Healthcheck

- URL: `http://<host>:9090/api/health`

### 6) Updates in Unraid

Wenn du das CA-Template auf `:latest` nutzt, erkennt Unraid neue Image-Digests über **Check for Updates** und kann aktualisieren.
Tag-Strategie: `latest` folgt dem `main`-Branch; versionierte Builds kommen über Git-Tags wie `v1.2.3`.

### 7) Beispiel mit Docker Compose

Siehe `docker-compose.yml` / `docker-compose.example.yml` im Repo. Setze dabei:

- `RUSTNZB_GHCR_OWNER=<DEIN_GHCR_OWNER>`
- optional `RUSTNZB_IMAGE_NAME=rustnzb-restyle` (Default)
- ohne VPN: `COMPOSE_PROFILES=direct docker compose up -d`
- mit ProtonVPN: `COMPOSE_PROFILES=vpn RUSTNZB_VPN_ENABLED=true docker compose up -d`

### 8) Sicherheits-Hinweise

- Verwende für NNTP immer TLS (`ssl = true`, typischerweise Port `563`).
- Setze in `config.toml` einen API-Key für API/UI-Zugriff.
