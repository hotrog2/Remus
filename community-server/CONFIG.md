# Remus Community Server - Configuration Reference

This document describes all environment variables used by the Remus community server.

## Required Variables

### `REMUS_MAIN_BACKEND_URL`
- **Type**: URL
- **Default**: `http://localhost:3001`
- **Description**: URL of the central Remus backend for authentication
- **Example**: `REMUS_MAIN_BACKEND_URL=http://192.168.1.100:3001`

## Server Configuration

### `PORT`
- **Type**: Number (1-65535)
- **Default**: `4000`
- **Description**: Port number the community server listens on
- **Example**: `PORT=4000`

### `REMUS_SERVER_NAME`
- **Type**: String
- **Default**: `"My Remus Community"`
- **Description**: Display name for your community server
- **Example**: `REMUS_SERVER_NAME=Gaming Community`

### `REMUS_PUBLIC_URL`
- **Type**: URL
- **Default**: Empty string
- **Description**: Public URL where this community server is accessible
- **Usage**: Used for server discovery and WebRTC connectivity
- **Example**: `REMUS_PUBLIC_URL=https://community.example.com`

### `REMUS_REGION`
- **Type**: String
- **Default**: `"local"`
- **Description**: Geographic region identifier for server discovery
- **Example**: `REMUS_REGION=us-west`

### `REMUS_SERVER_ICON`
- **Type**: File path or URL
- **Default**: Empty string
- **Description**: Path to server icon image (PNG recommended)
- **Example**: `REMUS_SERVER_ICON=/path/to/icon.png`

## CORS Configuration

### `REMUS_CLIENT_ORIGIN`
- **Type**: Comma-separated list of URLs
- **Default**: `http://localhost:5173`
- **Description**: Allowed origins for CORS requests
- **Security**: Only list trusted client origins. Local `http://127.0.0.1:*` / `http://localhost:*` are accepted by default for the packaged client.
- **Example**: `REMUS_CLIENT_ORIGIN=http://localhost:5173,https://app.example.com`

### `REMUS_ALLOW_FILE_ORIGIN`
- **Type**: Boolean (`1` or `0`)
- **Default**: `0`
- **Description**: Allow `file://` origin for legacy desktop builds
- **Security**: Not recommended. Prefer the default packaged client (uses local `http://127.0.0.1`).
- **Example**: `REMUS_ALLOW_FILE_ORIGIN=1`

### `REMUS_ALLOW_NULL_ORIGIN`
- **Type**: Boolean (`1` or `0`)
- **Default**: `0`
- **Description**: Allow `null` origin
- **Security**: Generally unsafe. Avoid unless you fully understand the risk.
- **Example**: `REMUS_ALLOW_NULL_ORIGIN=0`

## File Upload Configuration

### `REMUS_FILE_LIMIT_MB`
- **Type**: Number (positive integer)
- **Default**: `100`
- **Description**: Maximum file upload size in megabytes
- **Security**: Keep reasonable to prevent abuse. Consider disk space.
- **Example**: `REMUS_FILE_LIMIT_MB=50`

### `REMUS_UPLOADS_DIR`
- **Type**: Directory path
- **Default**: `./uploads`
- **Description**: Directory where uploaded files are stored
- **Example**: `REMUS_UPLOADS_DIR=/var/lib/remus/uploads`

## WebRTC/Media Configuration

### `REMUS_MEDIA_LISTEN_IP`
- **Type**: IP address
- **Default**: `0.0.0.0`
- **Description**: IP address for mediasoup to listen on
- **Usage**: Usually `0.0.0.0` to listen on all interfaces
- **Example**: `REMUS_MEDIA_LISTEN_IP=0.0.0.0`

### `REMUS_MEDIA_ANNOUNCED_IP`
- **Type**: IP address
- **Default**: Auto-detected from public URL
- **Description**: Public IP address announced to WebRTC clients
- **Usage**: Required for voice/video to work across networks
- **Important**: Set this to your server's public IP if behind NAT
- **Example**: `REMUS_MEDIA_ANNOUNCED_IP=203.0.113.1`

### `REMUS_MEDIA_MIN_PORT`
- **Type**: Number (1-65535)
- **Default**: `40000`
- **Description**: Minimum port for WebRTC connections
- **Firewall**: Ensure ports in range are open (UDP)
- **Example**: `REMUS_MEDIA_MIN_PORT=40000`

### `REMUS_MEDIA_MAX_PORT`
- **Type**: Number (1-65535)
- **Default**: `49999`
- **Description**: Maximum port for WebRTC connections
- **Validation**: Must be greater than `REMUS_MEDIA_MIN_PORT`
- **Firewall**: Ensure ports in range are open (UDP)
- **Example**: `REMUS_MEDIA_MAX_PORT=49999`

### `REMUS_ICE_SERVERS`
- **Type**: JSON array
- **Default**: `[{"urls":["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}]`
- **Description**: STUN/TURN servers for WebRTC NAT traversal
- **Usage**: Provide TURN servers for reliable connectivity behind restrictive NATs
- **Example**:
```json
REMUS_ICE_SERVERS=[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:turn.example.com:3478"],"username":"user","credential":"pass"}]
```

## Database Configuration

### `REMUS_DB_PATH`
- **Type**: File path
- **Default**: `./data/db.sqlite`
- **Description**: Path to SQLite database file
- **Example**: `REMUS_DB_PATH=/var/lib/remus/community.db`

### `REMUS_RUNTIME_DIR`
- **Type**: Directory path
- **Default**: Current directory
- **Description**: Directory for runtime data (database, uploads, icons)
- **Example**: `REMUS_RUNTIME_DIR=/var/lib/remus`

## Security Configuration

### `REMUS_ADMIN_KEY`
- **Type**: String
- **Default**: Empty string
- **Description**: Admin API key for privileged operations
- **Security**: Required for admin endpoints
- **Example**: `REMUS_ADMIN_KEY=your-admin-key-here`

## Debug Configuration

### `DEBUG`
- **Type**: Boolean (`1` or `0`)
- **Default**: `0` (enabled in development mode)
- **Description**: Enable verbose debug logging for troubleshooting
- **Performance**: Disable in production for better performance
- **Example**: `DEBUG=1`

### `NODE_ENV`
- **Type**: String
- **Default**: Not set
- **Description**: Node.js environment mode
- **Options**: `development`, `production`
- **Example**: `NODE_ENV=production`

## Example Production Configuration

```env
# Server
PORT=4000
REMUS_SERVER_NAME=Production Community
REMUS_PUBLIC_URL=https://community.example.com
REMUS_REGION=us-west-1

# Backend connection
REMUS_MAIN_BACKEND_URL=https://api.example.com

# CORS
REMUS_CLIENT_ORIGIN=https://app.example.com

# File uploads
REMUS_FILE_LIMIT_MB=50
REMUS_UPLOADS_DIR=/var/lib/remus/uploads

# WebRTC - IMPORTANT: Set public IP!
REMUS_MEDIA_ANNOUNCED_IP=203.0.113.1
REMUS_MEDIA_MIN_PORT=40000
REMUS_MEDIA_MAX_PORT=49999

# ICE servers (add TURN for production)
REMUS_ICE_SERVERS=[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:turn.example.com:3478"],"username":"user","credential":"pass"}]

# Database
REMUS_RUNTIME_DIR=/var/lib/remus

# No debug in production
DEBUG=0
NODE_ENV=production
```

## Example Development Configuration

```env
# Server
PORT=4000
REMUS_SERVER_NAME=Dev Community
REMUS_PUBLIC_URL=http://localhost:4000
REMUS_REGION=local

# Backend connection (local)
REMUS_MAIN_BACKEND_URL=http://localhost:3001

# CORS
REMUS_CLIENT_ORIGIN=http://localhost:5173

# File uploads
REMUS_FILE_LIMIT_MB=100

# WebRTC - local testing
REMUS_MEDIA_ANNOUNCED_IP=127.0.0.1
REMUS_MEDIA_MIN_PORT=40000
REMUS_MEDIA_MAX_PORT=49999

# Debug enabled
DEBUG=1
NODE_ENV=development
```

## Firewall Configuration

For voice/video to work, ensure these ports are open:

**TCP**:
- `4000` (or your configured PORT)

**UDP**:
- `40000-49999` (or your configured REMUS_MEDIA_MIN_PORT to REMUS_MEDIA_MAX_PORT range)

Example iptables rules:
```bash
# Allow TCP port 4000
sudo iptables -A INPUT -p tcp --dport 4000 -j ACCEPT

# Allow UDP ports 40000-49999
sudo iptables -A INPUT -p udp --dport 40000:49999 -j ACCEPT
```

## Validation

The server validates all environment variables at startup. If any validation fails, the server will exit with an error message.

**Common validation errors**:
- Invalid PORT: Must be 1-65535
- Invalid REMUS_MEDIA_MAX_PORT: Must be greater than REMUS_MEDIA_MIN_PORT
- Invalid REMUS_ICE_SERVERS: Must be valid JSON
- Invalid URLs: Must be valid HTTP/HTTPS URLs

## Troubleshooting Voice/Video Issues

If users cannot connect to voice channels:

1. **Check REMUS_MEDIA_ANNOUNCED_IP**: Must be your server's public IP if hosting remotely
2. **Check firewall**: UDP ports REMUS_MEDIA_MIN_PORT to REMUS_MEDIA_MAX_PORT must be open
3. **Check NAT**: If behind NAT/router, forward UDP port range
4. **Check ICE servers**: Add TURN servers for restrictive network environments
5. **Enable DEBUG=1**: Check logs for WebRTC connection errors
