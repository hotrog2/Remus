# Remus

Remus is split into two backend roles:

- `server/` = central backend only (account registration/login + self-host registration)
- `community-server/` = self-hosted community node (chat/channels/files/voice/screenshare)

The Remus platform does not host community chat servers. Users self-host `community-server` instances.

## Architecture

1. Users authenticate against the central backend (`server/`).
2. The desktop client connects to a selected self-hosted `community-server` URL.
3. The community server validates user tokens with central backend endpoint `/api/auth/verify`.
4. Community server sends heartbeat to central backend using its host token.

## Repository layout

- `server/`: central backend (auth + host registry)
- `community-server/`: self-hosted chat backend
- `client/`: desktop client (React + Electron)
- Root scripts: helper scripts for local dev setup/start

## Central backend (platform)

### Features

- Secret-username registration/login
- JWT auth (`/api/auth/register`, `/api/auth/login`, `/api/me`)
- Token verification endpoint for community servers (`/api/auth/verify`)
- Self-host registration endpoints:
  - `POST /api/hosts` (create host token)
  - `GET /api/hosts/my`
  - `GET /api/hosts/public`
  - `POST /api/hosts/heartbeat`

### Run

```powershell
.\server\start-server.bat
```

## Community server (self-hosted node)

### Features

- Guild/channel/message APIs
- File uploads
- Socket.IO realtime events
- Voice/screen-share signaling
- Auth delegated to central backend (`REMUS_MAIN_BACKEND_URL`)
- Built-in GUI manager for setup/operations:
  - edit server settings (`.env`)
  - start/stop server process
  - view live server logs
  - open runtime folder (`.env`, `data`, `uploads`)

### Run manager in dev

```powershell
cd .\community-server
npm install
npm run start
```

This opens the Community Server Manager GUI.

### Build single-file EXE (portable)

```powershell
cd .\community-server
npm install
npm run build:exe
```

Output:

- `community-server\release\Remus Community Server Manager 1.0.0.exe`

On first launch, the EXE creates runtime files in:

- `%APPDATA%\Remus Community Server Manager\runtime\`

## Desktop client (.exe)

Build:

```powershell
.\client\build-client-exe.bat
```

Run:

- `client\release\Remus-win32-x64\Remus.exe`

The client logs into central backend, then you connect it to a community server URL from inside the UI.

## Full local dev start

```powershell
.\setup.bat
.\server\start-server.bat
cd .\community-server
npm run start
```

Then launch the client EXE:

- `client\release\Remus-win32-x64\Remus.exe`

## Generate a self-host registration file

1. Login and obtain a user JWT from central backend (`/api/auth/login`).
2. Generate host env file:

```powershell
.\server\create-remus-server-file.bat --token <JWT> --name "My Community" --publicUrl "http://my-host:4000" --out remus-community.env
```

3. Give host user the Community Server Manager EXE + generated env values.
4. Host user opens the Community Server Manager EXE, pastes values, then starts server.

## Environment variables

### Central backend (`server/.env`)

- `PORT` default `3001`
- `REMUS_CLIENT_ORIGIN` default `http://localhost:5173,null,file://`
- `REMUS_JWT_SECRET` JWT signing secret
- `REMUS_PUBLIC_BACKEND_URL` URL embedded in generated host files

### Community server (`.env` in runtime folder)

- EXE runtime path: `%APPDATA%\Remus Community Server Manager\runtime\.env`
- Dev mode path: `community-server/.env`

- `PORT` default `4000`
- `REMUS_SERVER_NAME`
- `REMUS_PUBLIC_URL`
- `REMUS_REGION`
- `REMUS_MAIN_BACKEND_URL` central backend URL
- `REMUS_HOST_TOKEN` host token from central backend
- `REMUS_CLIENT_ORIGIN` allowed client origins
- `REMUS_FILE_LIMIT_MB` upload max size in MB

### Client (`client/.env`)

- `VITE_AUTH_BASE` central backend URL
- `VITE_DEFAULT_COMMUNITY_BASE` optional prefilled community URL
