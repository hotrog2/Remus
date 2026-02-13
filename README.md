# Remus

Remus is a self-hostable chat platform. This repository contains the **Remus Client** and the **Remus Community Server Manager**.  
The **central Remus backend** (account system + token verification) is intentionally **not included** here for security.

## Components

- `client/` – Remus Client (Electron + React)
- `community-server/` – Self-hosted community node + GUI manager
- `sounds/` – Shared UI sound assets

## Features

### Remus Client

- Secret-username login (no email)
- Display names and per-server nicknames
- Persistent server list (join once with invite or URL)
- Text channels with file uploads and progress
- Voice channels with:
  - voice activity, push-to-talk, or always-transmit modes
  - per-user volume controls
  - speaking indicators
- Screenshare with selectable screen/app and viewer switching
- Audio device selection + mic test meter
- Password recovery key flow (shown once on registration)

### Community Server

- Self-hosted single node = single community (guild)
- Text, voice, and category channels
- Roles and permissions (Discord-style)
- Member management: roles, kick, ban, timeouts, mute/deafen
- Audit log + chat history + upload history
- File uploads + download links
- Server icon and invite code display
- Voice + screenshare transport (WebRTC via mediasoup)

### Community Server Manager (GUI)

- Configure `.env` values
- Start/stop/restart server
- View live logs
- Windows Firewall rule helper
- Port verification (local + backend-assisted checks)
- Manage users, roles, bans, audit, messages, uploads

## Architecture (high level)

1. Users sign in to your **central Remus backend** using **secret username + password**.
2. The Remus Client connects to a **community server** via invite code `remus(<server-id>)` or direct URL.
3. The community server validates user tokens against your backend.

## Build

### Remus Client (single EXE)

```powershell
cd .\client
npm install
npm run build:exe
```

Output:
- `client\release\Remus Client 1.0.0.exe`

Or use:
```powershell
.\client\build-client-exe.bat
```

### Remus Community Server Manager (single EXE)

```powershell
cd .\community-server
npm install
npm run build:exe
```

Output:
- `community-server\release\Remus Community Server Manager 1.0.0.exe`

## Run

1. Launch **Remus Community Server Manager**.
2. Configure `.env` (stored in `%APPDATA%\Remus Community Server Manager\runtime\`).
3. Start the server process.
4. Share the invite shown in the manager: `remus(<server-id>)`.

## Configuration

Full details are in `community-server/CONFIG.md`. Highlights:

### Client (`client/.env`)

- `VITE_AUTH_BASE` – URL of your central Remus backend (required)
- `VITE_DEFAULT_COMMUNITY_BASE` – optional default community server URL

### Community Server (`.env` inside runtime)

- `REMUS_MAIN_BACKEND_URL` – central backend URL (required)
- `PORT`, `REMUS_SERVER_NAME`, `REMUS_PUBLIC_URL`, `REMUS_REGION`
- `REMUS_CLIENT_ORIGIN` – comma-separated allowed client origins  
  Local `http://127.0.0.1:*` / `http://localhost:*` are accepted by default for the packaged client.
- `REMUS_ALLOW_FILE_ORIGIN` / `REMUS_ALLOW_NULL_ORIGIN` – **off by default**; not recommended
- `REMUS_FILE_LIMIT_MB`, `REMUS_UPLOADS_DIR`
- `REMUS_MEDIA_ANNOUNCED_IP`, `REMUS_MEDIA_MIN_PORT`, `REMUS_MEDIA_MAX_PORT`, `REMUS_ICE_SERVERS`
- `REMUS_ADMIN_KEY` – optional; admin endpoints are local-only

## Ports and Firewall

Community server hosts must allow:

- TCP: `PORT` (default `4000`)
- UDP: `REMUS_MEDIA_MIN_PORT`–`REMUS_MEDIA_MAX_PORT` (default `40000-49999`)

The server manager can apply Windows Firewall rules and run port checks.

## Notes

- Email is **not used**. Accounts use **secret username + password**.
- Recovery keys are shown **once** during registration.
- The central backend is **not part of this repo** by design.
