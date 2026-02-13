import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";
import cors from "cors";
import express from "express";
import multer from "multer";
import { Server } from "socket.io";
import { v4 as uuid } from "uuid";
import { authMiddleware, socketAuth, getMainBackendUrl } from "./identity.js";
import { configureSocket } from "./socket.js";
import { createSfu } from "./sfu.js";
import { Store } from "./store.js";
import { PERMISSIONS } from "./permissions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  return true;
}

const loadedEnvPaths = new Set();
for (const candidate of [
  process.env.REMUS_ENV_PATH,
  path.join(process.cwd(), ".env"),
  path.join(rootDir, ".env")
]) {
  if (!candidate || loadedEnvPaths.has(candidate)) continue;
  if (loadEnvFile(candidate)) {
    loadedEnvPaths.add(candidate);
  }
}

const runtimeDir = process.env.REMUS_RUNTIME_DIR ? path.resolve(process.env.REMUS_RUNTIME_DIR) : rootDir;
const runtimeEnvPath = path.join(runtimeDir, ".env");
if (!loadedEnvPaths.has(runtimeEnvPath)) {
  if (loadEnvFile(runtimeEnvPath)) {
    loadedEnvPaths.add(runtimeEnvPath);
  }
}

const uploadsDir = process.env.REMUS_UPLOADS_DIR ? path.resolve(process.env.REMUS_UPLOADS_DIR) : path.join(runtimeDir, "uploads");
const roleIconsDir = path.join(runtimeDir, "role-icons");

function validateEnvironment() {
  const errors = [];

  // Validate PORT
  const port = parseInt(process.env.PORT || "4000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: must be between 1-65535, got "${process.env.PORT}"`);
  }

  // Validate REMUS_FILE_LIMIT_MB
  if (process.env.REMUS_FILE_LIMIT_MB) {
    const fileLimit = parseInt(process.env.REMUS_FILE_LIMIT_MB, 10);
    if (!Number.isInteger(fileLimit) || fileLimit < 1) {
      errors.push(`Invalid REMUS_FILE_LIMIT_MB: must be a positive integer, got "${process.env.REMUS_FILE_LIMIT_MB}"`);
    }
  }

  // Validate REMUS_MEDIA_MIN_PORT
  const minPort = parseInt(process.env.REMUS_MEDIA_MIN_PORT || "40000", 10);
  if (!Number.isInteger(minPort) || minPort < 1 || minPort > 65535) {
    errors.push(`Invalid REMUS_MEDIA_MIN_PORT: must be between 1-65535, got "${process.env.REMUS_MEDIA_MIN_PORT}"`);
  }

  // Validate REMUS_MEDIA_MAX_PORT
  const maxPort = parseInt(process.env.REMUS_MEDIA_MAX_PORT || "49999", 10);
  if (!Number.isInteger(maxPort) || maxPort < 1 || maxPort > 65535) {
    errors.push(`Invalid REMUS_MEDIA_MAX_PORT: must be between 1-65535, got "${process.env.REMUS_MEDIA_MAX_PORT}"`);
  } else if (maxPort <= minPort) {
    errors.push(`Invalid REMUS_MEDIA_MAX_PORT: must be greater than REMUS_MEDIA_MIN_PORT (${minPort})`);
  }

  // Validate REMUS_ICE_SERVERS JSON
  if (process.env.REMUS_ICE_SERVERS) {
    try {
      JSON.parse(process.env.REMUS_ICE_SERVERS);
    } catch (err) {
      errors.push(`Invalid REMUS_ICE_SERVERS: must be valid JSON, got parse error: ${err.message}`);
    }
  }

  // Validate REMUS_CLIENT_ORIGIN URLs
  if (process.env.REMUS_CLIENT_ORIGIN) {
    const origins = process.env.REMUS_CLIENT_ORIGIN.split(",").map(s => s.trim()).filter(Boolean);
    for (const origin of origins) {
      try {
        new URL(origin);
      } catch {
        errors.push(`Invalid REMUS_CLIENT_ORIGIN URL: "${origin}"`);
      }
    }
  }

  // Validate REMUS_MAIN_BACKEND_URL
  if (process.env.REMUS_MAIN_BACKEND_URL) {
    try {
      new URL(process.env.REMUS_MAIN_BACKEND_URL);
    } catch {
      errors.push(`Invalid REMUS_MAIN_BACKEND_URL: "${process.env.REMUS_MAIN_BACKEND_URL}"`);
    }
  }

  // Validate REMUS_PUBLIC_URL if provided
  if (process.env.REMUS_PUBLIC_URL) {
    try {
      new URL(process.env.REMUS_PUBLIC_URL);
    } catch {
      errors.push(`Invalid REMUS_PUBLIC_URL: "${process.env.REMUS_PUBLIC_URL}"`);
    }
  }

  if (errors.length > 0) {
    console.error("Environment validation failed:");
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
}

validateEnvironment();

const SERVER_NAME = process.env.REMUS_SERVER_NAME || "My Remus Community";
const PUBLIC_URL = process.env.REMUS_PUBLIC_URL || "";
const REGION = process.env.REMUS_REGION || "local";
const MAIN_BACKEND_URL = getMainBackendUrl();
const VERSION = "1.0.0";
const ICON_VALUE = (process.env.REMUS_SERVER_ICON || "").trim();
const MEDIA_LISTEN_IP = process.env.REMUS_MEDIA_LISTEN_IP || "0.0.0.0";
const MEDIA_ANNOUNCED_IP_RAW = (process.env.REMUS_MEDIA_ANNOUNCED_IP || "").trim();
const MEDIA_MIN_PORT = Number(process.env.REMUS_MEDIA_MIN_PORT || 40000);
const MEDIA_MAX_PORT = Number(process.env.REMUS_MEDIA_MAX_PORT || 49999);
const ADMIN_KEY = process.env.REMUS_ADMIN_KEY || "";
const DEFAULT_ICE_SERVERS = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]
  }
];

function parseIceServers(raw) {
  if (!raw) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const cleaned = list
      .filter((item) => item && typeof item === "object" && item.urls)
      .map((item) => ({
        urls: item.urls,
        username: item.username,
        credential: item.credential
      }));
    return cleaned.length ? cleaned : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

const ICE_SERVERS = parseIceServers(process.env.REMUS_ICE_SERVERS);

function resolveAnnouncedIp(explicit, publicUrl) {
  if (explicit) return explicit;
  if (!publicUrl) return "";
  try {
    const host = new URL(publicUrl).hostname;
    return net.isIP(host) ? host : "";
  } catch {
    return "";
  }
}

const MEDIA_ANNOUNCED_IP = resolveAnnouncedIp(MEDIA_ANNOUNCED_IP_RAW, PUBLIC_URL);

const configuredOrigins = (process.env.REMUS_CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowFileOrigin = process.env.REMUS_ALLOW_FILE_ORIGIN === "1";
const allowNullOrigin = process.env.REMUS_ALLOW_NULL_ORIGIN === "1";
const allowedOrigins = new Set([
  ...configuredOrigins,
  ...(allowFileOrigin ? ["file://"] : []),
  ...(allowNullOrigin ? ["null"] : [])
]);

function isLocalOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function checkOrigin(origin, callback) {
  if (!origin || allowedOrigins.has(origin) || isLocalOrigin(origin)) {
    return callback(null, true);
  }
  return callback(new Error("Origin not allowed"), false);
}

function normalizeIp(address) {
  if (!address) return "unknown";
  if (address === "::1") return "127.0.0.1";
  if (address.startsWith("::ffff:")) return address.slice(7);
  return address;
}

function isLocalRequest(req) {
  const ip = normalizeIp(req.socket?.remoteAddress || "");
  return ip === "127.0.0.1";
}

const rateBuckets = new Map();
function allowRate(key, limit, windowMs) {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count += 1;
  return true;
}

function rateLimitOr(res, key, limit, windowMs) {
  if (!allowRate(key, limit, windowMs)) {
    res.status(429).json({ error: "Too many requests. Please slow down." });
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(403).json({ error: "Admin API disabled" });
  }
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: "Admin API is local-only" });
  }
  const key = req.headers["x-remus-admin-key"];
  if (typeof key !== "string" || key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Invalid admin key" });
  }
  return next();
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(roleIconsDir)) {
  fs.mkdirSync(roleIconsDir, { recursive: true });
}

function deleteUploadFiles(entries) {
  for (const entry of entries || []) {
    const url = String(entry?.url || "");
    if (!url.startsWith("/uploads/")) continue;
    const filename = url.replace("/uploads/", "");
    if (!filename) continue;
    const filePath = path.join(uploadsDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }
}

function sanitizeFilename(input) {
  const base = path.basename(String(input || "file"));
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_");
  return cleaned.slice(0, 120) || "file";
}

function resolveServerIcon() {
  if (!ICON_VALUE) {
    return { iconUrl: null, filePath: null };
  }

  if (ICON_VALUE.startsWith("http://") || ICON_VALUE.startsWith("https://")) {
    return { iconUrl: ICON_VALUE, filePath: null };
  }

  const iconPath = path.isAbsolute(ICON_VALUE) ? ICON_VALUE : path.join(runtimeDir, ICON_VALUE);
  if (!fs.existsSync(iconPath)) {
    return { iconUrl: null, filePath: null };
  }

  return { iconUrl: "/api/server/icon", filePath: iconPath };
}

const serverIcon = resolveServerIcon();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: checkOrigin,
    credentials: true
  }
});
let SERVER_ID = "";

function computeServerId() {
  const guild = store.getNodeGuild();
  if (guild?.id) {
    return String(guild.id).trim().slice(0, 8);
  }
  return "";
}

const store = new Store();
store.ensureNodeGuild(SERVER_NAME);
socketAuth(io, (user) => {
  if (store.isBanned(user.id)) {
    return;
  }
  store.upsertProfile(user);
  store.ensureCommunityForUser(user.id, SERVER_NAME);
});
const sfu = await createSfu({
  listenIp: MEDIA_LISTEN_IP,
  announcedIp: MEDIA_ANNOUNCED_IP,
  rtcMinPort: MEDIA_MIN_PORT,
  rtcMaxPort: MEDIA_MAX_PORT
});
const socketAdmin = configureSocket(io, store, sfu);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${uuid()}-${sanitizeFilename(file.originalname)}`)
  }),
  limits: {
    fileSize: Number(process.env.REMUS_FILE_LIMIT_MB || 100) * 1024 * 1024
  }
});

app.use(
  cors({
    origin: checkOrigin,
    credentials: true
  })
);

// Security headers middleware
app.use((req, res, next) => {
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");

  // Enable XSS protection (legacy browsers)
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Content Security Policy
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"
  );

  // HTTPS-only in production (if using HTTPS)
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
});

app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(uploadsDir));
app.use("/role-icons", express.static(roleIconsDir));

function requireNotBanned(req, res, next) {
  const userId = req.auth?.user?.id;
  if (userId && store.isBanned(userId)) {
    return res.status(403).json({ error: "You are banned from this community." });
  }
  return next();
}

function requirePermission(req, res, perm, channelId = null) {
  const guildId = req.params.guildId || req.body.guildId;
  if (!guildId) {
    return res.status(400).json({ error: "Guild ID is required" });
  }
  const allowed = (store.getPermissions(guildId, req.auth.user.id, channelId) & perm) === perm;
  if (!allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return null;
}

function getMemberTopPosition(guildId, userId) {
  const roles = store.getRolesForGuild(guildId);
  const member = store.getMember(guildId, userId);
  const roleIds = new Set([guildId, ...(member?.roleIds || [])]);
  return roles
    .filter((role) => roleIds.has(role.id))
    .reduce((max, role) => Math.max(max, role.position || 0), 0);
}

function hasAdmin(guildId, userId) {
  return (store.getPermissions(guildId, userId) & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR;
}

function canManageRole(guildId, actorId, roleId) {
  if (hasAdmin(guildId, actorId)) return true;
  if (roleId === guildId) {
    return (store.getPermissions(guildId, actorId) & PERMISSIONS.MANAGE_SERVER) === PERMISSIONS.MANAGE_SERVER;
  }
  const actorTop = getMemberTopPosition(guildId, actorId);
  const role = store.getRoleById(roleId);
  const rolePos = role?.position || 0;
  return actorTop > rolePos;
}

function canManageMember(guildId, actorId, targetId) {
  if (actorId === targetId) return true;
  if (hasAdmin(guildId, actorId)) return true;
  const actorTop = getMemberTopPosition(guildId, actorId);
  const targetTop = getMemberTopPosition(guildId, targetId);
  return actorTop > targetTop;
}

function serializeMember(member) {
  if (!member) return null;
  const profile = store.getProfile(member.userId);
  return {
    id: member.userId,
    username: profile?.username || `User ${String(member.userId).slice(0, 6)}`,
    nickname: member.nickname || "",
    roleIds: member.roleIds || [],
    timeoutUntil: member.timeoutUntil || null,
    voiceMuted: !!member.voiceMuted,
    voiceDeafened: !!member.voiceDeafened,
    joinedAt: member.joinedAt || null
  };
}

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    app: "Remus Community Server",
    name: SERVER_NAME,
    iconUrl: serverIcon.iconUrl,
    iceServers: ICE_SERVERS,
    ts: new Date().toISOString()
  });
});

app.get("/api/server/info", (_, res) => {
  if (!SERVER_ID) {
    SERVER_ID = computeServerId();
  }
  res.json({
    name: SERVER_NAME,
    publicUrl: PUBLIC_URL || null,
    serverId: SERVER_ID || null,
    region: REGION,
    mainBackendUrl: MAIN_BACKEND_URL,
    iconUrl: serverIcon.iconUrl,
    iceServers: ICE_SERVERS
  });
});

app.get("/api/server/icon", (_, res) => {
  if (!serverIcon.filePath) {
    return res.status(404).json({ error: "No icon configured" });
  }

  const ext = path.extname(serverIcon.filePath).toLowerCase();
  const type =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "application/octet-stream";

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type(type);
  return res.sendFile(serverIcon.filePath);
});

app.get("/api/guilds", authMiddleware, requireNotBanned, (req, res) => {
  store.upsertProfile(req.auth.user);
  const guild = store.ensureCommunityForUser(req.auth.user.id, SERVER_NAME);
  const guilds = guild
    ? [
        {
          ...guild,
          members: store.listMembers(guild.id).map((member) => serializeMember(member)),
          roles: store.getRolesForGuild(guild.id),
          permissions: store.getPermissions(guild.id, req.auth.user.id),
          iconUrl: serverIcon.iconUrl,
          channels: store.getChannelsForGuild(guild.id)
        }
      ]
    : [];
  res.json({ guilds });
});

app.post("/api/guilds", authMiddleware, (req, res) => {
  return res.status(405).json({
    error: "This community node maps to exactly one guild. Guild creation is disabled."
  });
});

app.post("/api/guilds/:guildId/join", authMiddleware, requireNotBanned, (req, res) => {
  store.upsertProfile(req.auth.user);
  const guild = store.addMemberToGuild(req.params.guildId, req.auth.user.id);
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }

  io.to(`guild:${guild.id}`).emit("guild:memberJoined", {
    guildId: guild.id,
    user: serializeMember(store.getMember(guild.id, req.auth.user.id))
  });

  return res.json({ guild });
});

app.post("/api/guilds/:guildId/leave", authMiddleware, (req, res) => {
  const guildId = req.params.guildId;
  const userId = req.auth.user.id;
  if (!store.isGuildMember(guildId, userId)) {
    return res.json({ ok: true });
  }

  const uploads = store.listUploadsByAuthor(userId);
  store.purgeUser(userId);
  deleteUploadFiles(uploads);

  io.to(`guild:${guildId}`).emit("guild:memberLeft", { guildId, userId });
  socketAdmin?.disconnectUser?.(userId, "left");
  return res.json({ ok: true });
});

app.get("/api/guilds/:guildId/channels", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  if (!store.isGuildMember(guildId, req.auth.user.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const channels = store
    .getChannelsForGuild(guildId)
    .filter((channel) => store.isChannelAccessible(channel.id, req.auth.user.id));
  return res.json({ channels });
});

app.post("/api/guilds/:guildId/channels", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_CHANNELS);
  if (permError) return;

  const name = (req.body.name || "").trim().slice(0, 40);
  const type = req.body.type === "voice" ? "voice" : req.body.type === "category" ? "category" : "text";
  const categoryId = req.body.categoryId || null;

  if (!name) {
    return res.status(400).json({ error: "Channel name is required" });
  }

  const channel = store.createChannel({ guildId, name, type, createdBy: req.auth.user.id, categoryId });
  io.to(`guild:${guildId}`).emit("channel:new", channel);
  store.addAudit({ guildId, action: "channel.create", actorId: req.auth.user.id, targetId: channel.id, data: { name, type } });
  return res.status(201).json({ channel });
});

app.patch("/api/guilds/:guildId/channels/order", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_CHANNELS);
  if (permError) return;

  const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
  const filtered = [];
  for (const item of updates) {
    const id = item?.id;
    if (!id) continue;
    const channel = store.getChannelById(id);
    if (!channel || channel.guildId !== guildId) continue;
    const position = Number.isInteger(item.position) ? item.position : null;
    if (position === null) continue;
    const categoryId = item.categoryId === "" ? null : item.categoryId ?? channel.categoryId ?? null;
    filtered.push({ id, position, categoryId });
  }

  if (!filtered.length) {
    return res.status(400).json({ error: "No valid channel updates provided" });
  }

  const updated = store.updateChannelPositions(filtered);
  for (const channel of updated) {
    io.to(`guild:${guildId}`).emit("channel:update", channel);
  }
  store.addAudit({ guildId, action: "channel.reorder", actorId: req.auth.user.id });
  return res.json({ ok: true, channels: updated });
});

app.patch("/api/channels/:channelId", authMiddleware, requireNotBanned, (req, res) => {
  const channelId = req.params.channelId;
  const channel = store.getChannelById(channelId);
  if (!channel) {
    return res.status(404).json({ error: "Channel not found" });
  }
  req.params.guildId = channel.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_CHANNELS, channelId);
  if (permError) return;

  const name = typeof req.body.name === "string" ? req.body.name.trim() : undefined;
  const categoryId = req.body.categoryId ?? undefined;
  const overrides = req.body.permissionOverrides;

  const updated = store.updateChannel(channelId, {
    name,
    categoryId: categoryId === "" ? null : categoryId,
    permissionOverrides: overrides
  });
  io.to(`guild:${channel.guildId}`).emit("channel:update", updated);
  store.addAudit({ guildId: channel.guildId, action: "channel.update", actorId: req.auth.user.id, targetId: channelId });
  return res.json({ channel: updated });
});

app.delete("/api/channels/:channelId", authMiddleware, requireNotBanned, (req, res) => {
  const channelId = req.params.channelId;
  const channel = store.getChannelById(channelId);
  if (!channel) {
    return res.status(404).json({ error: "Channel not found" });
  }
  req.params.guildId = channel.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_CHANNELS, channelId);
  if (permError) return;

  const removed = store.deleteChannel(channelId);
  if (removed?.uploads?.length) {
    deleteUploadFiles(removed.uploads);
  }
  io.to(`guild:${channel.guildId}`).emit("channel:delete", { channelId });
  store.addAudit({ guildId: channel.guildId, action: "channel.delete", actorId: req.auth.user.id, targetId: channelId });
  return res.json({ ok: true });
});

app.get("/api/guilds/:guildId/roles", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  if (!store.isGuildMember(guildId, req.auth.user.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return res.json({ roles: store.getRolesForGuild(guildId) });
});

app.post("/api/guilds/:guildId/roles", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_ROLES);
  if (permError) return;

  const name = (req.body.name || "").trim().slice(0, 40);
  if (!name) {
    return res.status(400).json({ error: "Role name is required" });
  }
  const permissions = Number.isInteger(req.body.permissions) ? req.body.permissions : 0;
  const color = (req.body.color || "").trim();
  const hoist = !!req.body.hoist;
  const role = store.createRole({ guildId, name, color, permissions, hoist });
  store.addAudit({ guildId, action: "role.create", actorId: req.auth.user.id, targetId: role.id, data: { name } });
  return res.status(201).json({ role });
});

app.patch("/api/roles/:roleId", authMiddleware, requireNotBanned, (req, res) => {
  const roleId = req.params.roleId;
  const role = store.getRoleById(roleId);
  if (!role) {
    return res.status(404).json({ error: "Role not found" });
  }
  req.params.guildId = role.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_ROLES);
  if (permError) return;
  if (!canManageRole(role.guildId, req.auth.user.id, roleId)) {
    return res.status(403).json({ error: "Role hierarchy prevents this action" });
  }

  const updated = store.updateRole(roleId, {
    name: typeof req.body.name === "string" ? req.body.name.trim() : undefined,
    color: typeof req.body.color === "string" ? req.body.color.trim() : undefined,
    permissions: Number.isInteger(req.body.permissions) ? req.body.permissions : undefined,
    hoist: typeof req.body.hoist === "boolean" ? req.body.hoist : undefined,
    position: Number.isInteger(req.body.position) ? req.body.position : undefined
  });
  store.addAudit({ guildId: role.guildId, action: "role.update", actorId: req.auth.user.id, targetId: roleId });
  return res.json({ role: updated });
});

const roleIconUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

app.post("/api/roles/:roleId/icon", authMiddleware, requireNotBanned, roleIconUpload.single("icon"), (req, res) => {
  const roleId = req.params.roleId;
  const role = store.getRoleById(roleId);
  if (!role) {
    return res.status(404).json({ error: "Role not found" });
  }
  req.params.guildId = role.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_ROLES);
  if (permError) return;
  if (!canManageRole(role.guildId, req.auth.user.id, roleId)) {
    return res.status(403).json({ error: "Role hierarchy prevents this action" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No icon uploaded" });
  }
  const ext = path.extname(req.file.originalname || ".png").toLowerCase() || ".png";
  const filename = `role-${roleId}-${Date.now()}${ext}`;
  const dest = path.join(roleIconsDir, filename);
  fs.writeFileSync(dest, req.file.buffer);
  const iconUrl = `/role-icons/${filename}`;
  const updated = store.updateRole(roleId, { iconUrl });
  store.addAudit({ guildId: role.guildId, action: "role.icon", actorId: req.auth.user.id, targetId: roleId });
  return res.json({ role: updated });
});

app.delete("/api/roles/:roleId", authMiddleware, requireNotBanned, (req, res) => {
  const roleId = req.params.roleId;
  const role = store.getRoleById(roleId);
  if (!role) {
    return res.status(404).json({ error: "Role not found" });
  }
  if (role.id === role.guildId) {
    return res.status(400).json({ error: "@everyone cannot be deleted" });
  }
  req.params.guildId = role.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_ROLES);
  if (permError) return;
  if (!canManageRole(role.guildId, req.auth.user.id, roleId)) {
    return res.status(403).json({ error: "Role hierarchy prevents this action" });
  }
  const removed = store.deleteRole(roleId);
  if (removed) {
    store.addAudit({ guildId: role.guildId, action: "role.delete", actorId: req.auth.user.id, targetId: roleId });
  }
  return res.json({ ok: removed });
});

app.get("/api/guilds/:guildId/members", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  if (!store.isGuildMember(guildId, req.auth.user.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return res.json({ members: store.listMembers(guildId).map((member) => serializeMember(member)) });
});

app.patch("/api/guilds/:guildId/members/:userId/nickname", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const userId = req.params.userId;
  if (req.auth.user.id !== userId) {
    return res.status(403).json({ error: "Only the user can change their nickname" });
  }
  if (!store.isGuildMember(guildId, userId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const nickname = (req.body.nickname || "").trim().slice(0, 32);
  const updated = store.updateMember(guildId, userId, { nickname });
  io.to(`guild:${guildId}`).emit("member:update", serializeMember(updated));
  store.addAudit({ guildId, action: "member.nickname", actorId: userId, targetId: userId });
  return res.json({ member: serializeMember(updated) });
});

app.patch("/api/guilds/:guildId/members/:userId/roles", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const targetId = req.params.userId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_ROLES);
  if (permError) return;
  if (!canManageMember(guildId, req.auth.user.id, targetId)) {
    return res.status(403).json({ error: "Role hierarchy prevents this action" });
  }
  const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds.filter(Boolean) : [];
  const actorTop = getMemberTopPosition(guildId, req.auth.user.id);
  const allowed = roleIds.filter((roleId) => {
    if (roleId === guildId) return false;
    const role = store.getRoleById(roleId);
    return role && role.guildId === guildId && role.position < actorTop;
  });
  const updated = store.updateMember(guildId, targetId, { roleIds: allowed });
  io.to(`guild:${guildId}`).emit("member:update", serializeMember(updated));
  store.addAudit({ guildId, action: "member.roles", actorId: req.auth.user.id, targetId });
  return res.json({ member: serializeMember(updated) });
});

app.patch("/api/guilds/:guildId/members/:userId/timeout", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const targetId = req.params.userId;
  const permError = requirePermission(req, res, PERMISSIONS.TIMEOUT_MEMBERS);
  if (permError) return;
  if (!canManageMember(guildId, req.auth.user.id, targetId)) {
    return res.status(403).json({ error: "Role hierarchy prevents this action" });
  }
  const minutes = Number(req.body.minutes || 0);
  const maxMinutes = store.getSettings().timeoutMaxMinutes || 10080;
  const clamped = minutes <= 0 ? 0 : Math.min(Math.max(minutes, 1), maxMinutes);
  const timeoutUntil = clamped ? new Date(Date.now() + clamped * 60 * 1000).toISOString() : null;
  const updated = store.updateMember(guildId, targetId, { timeoutUntil });
  io.to(`guild:${guildId}`).emit("member:update", serializeMember(updated));
  store.addAudit({ guildId, action: "member.timeout", actorId: req.auth.user.id, targetId, data: { minutes: clamped } });
  return res.json({ member: serializeMember(updated) });
});

app.patch("/api/guilds/:guildId/members/:userId/voice", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const targetId = req.params.userId;
  const canMute = (store.getPermissions(guildId, req.auth.user.id) & PERMISSIONS.VOICE_MUTE_MEMBERS) === PERMISSIONS.VOICE_MUTE_MEMBERS;
  const canDeafen =
    (store.getPermissions(guildId, req.auth.user.id) & PERMISSIONS.VOICE_DEAFEN_MEMBERS) === PERMISSIONS.VOICE_DEAFEN_MEMBERS;
  if (!canMute && !canDeafen) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!canManageMember(guildId, req.auth.user.id, targetId)) {
    return res.status(403).json({ error: "Role hierarchy prevents this action" });
  }
  const updates = {};
  if (typeof req.body.voiceMuted === "boolean" && canMute) {
    updates.voiceMuted = req.body.voiceMuted;
  }
  if (typeof req.body.voiceDeafened === "boolean" && canDeafen) {
    updates.voiceDeafened = req.body.voiceDeafened;
  }
  const updated = store.updateMember(guildId, targetId, updates);
  io.to(`guild:${guildId}`).emit("member:update", serializeMember(updated));
  socketAdmin?.forceMuteUser?.(targetId);
  store.addAudit({ guildId, action: "member.voice", actorId: req.auth.user.id, targetId, data: updates });
  return res.json({ member: serializeMember(updated) });
});

app.post("/api/guilds/:guildId/members/:userId/kick", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const targetId = req.params.userId;
  const permError = requirePermission(req, res, PERMISSIONS.KICK_MEMBERS);
  if (permError) return;
  if (!canManageMember(guildId, req.auth.user.id, targetId)) {
    return res.status(403).json({ error: "Role hierarchy prevents this action" });
  }

  const uploads = store.listUploadsByAuthor(targetId);
  store.purgeUser(targetId);
  deleteUploadFiles(uploads);
  io.to(`guild:${guildId}`).emit("guild:memberLeft", { guildId, userId: targetId });
  socketAdmin?.disconnectUser?.(targetId, "kicked");
  store.addAudit({ guildId, action: "member.kick", actorId: req.auth.user.id, targetId });
  return res.json({ ok: true });
});

app.post("/api/guilds/:guildId/members/:userId/ban", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const targetId = req.params.userId;
  const permError = requirePermission(req, res, PERMISSIONS.BAN_MEMBERS);
  if (permError) return;
  if (!canManageMember(guildId, req.auth.user.id, targetId)) {
    return res.status(403).json({ error: "Role hierarchy prevents this action" });
  }

  const uploads = store.listUploadsByAuthor(targetId);
  store.banUser(targetId);
  store.purgeUser(targetId);
  deleteUploadFiles(uploads);
  io.to(`guild:${guildId}`).emit("guild:memberLeft", { guildId, userId: targetId });
  socketAdmin?.disconnectUser?.(targetId, "banned");
  store.addAudit({ guildId, action: "member.ban", actorId: req.auth.user.id, targetId });
  return res.json({ ok: true });
});

app.post("/api/guilds/:guildId/members/:userId/move", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const targetId = req.params.userId;
  const permError = requirePermission(req, res, PERMISSIONS.VOICE_MOVE_MEMBERS);
  if (permError) return;
  if (!canManageMember(guildId, req.auth.user.id, targetId)) {
    return res.status(403).json({ error: "Role hierarchy prevents this action" });
  }
  const channelId = String(req.body.channelId || "");
  if (!channelId) {
    return res.status(400).json({ error: "Channel ID is required" });
  }
  socketAdmin?.moveUser?.(targetId, channelId);
  store.addAudit({ guildId, action: "member.move", actorId: req.auth.user.id, targetId, data: { channelId } });
  return res.json({ ok: true });
});

app.get("/api/guilds/:guildId/audit", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.VIEW_AUDIT_LOG);
  if (permError) return;
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
  const entries = store.listAudit(guildId, limit);
  return res.json({ entries });
});

app.get("/api/guilds/:guildId/settings", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  if (!store.isGuildMember(guildId, req.auth.user.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return res.json({ settings: store.getSettings() });
});

app.patch("/api/guilds/:guildId/settings", authMiddleware, requireNotBanned, (req, res) => {
  const guildId = req.params.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_SERVER);
  if (permError) return;
  const settings = store.updateSettings({
    auditMaxEntries: Number.isInteger(req.body.auditMaxEntries) ? req.body.auditMaxEntries : undefined,
    timeoutMaxMinutes: Number.isInteger(req.body.timeoutMaxMinutes) ? req.body.timeoutMaxMinutes : undefined
  });
  store.addAudit({ guildId, action: "server.settings", actorId: req.auth.user.id, data: settings });
  return res.json({ settings });
});

app.get("/api/channels/:channelId/messages", authMiddleware, requireNotBanned, (req, res) => {
  const channelId = req.params.channelId;
  const channel = store.getChannelById(channelId);
  if (!channel || channel.type !== "text") {
    return res.status(400).json({ error: "Messages are only available for text channels" });
  }

  req.params.guildId = channel.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.READ_HISTORY, channelId);
  if (permError) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const messages = store.getMessagesForChannel(channelId, limit).map((message) => store.toMessageView(message));
  return res.json({ messages });
});

app.post("/api/channels/:channelId/messages", authMiddleware, requireNotBanned, (req, res) => {
  const channelId = req.params.channelId;
  const channel = store.getChannelById(channelId);
  if (!channel || channel.type !== "text") {
    return res.status(400).json({ error: "Messages are only available for text channels" });
  }
  req.params.guildId = channel.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.SEND_MESSAGES, channelId);
  if (permError) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const content = (req.body.content || "").toString().trim().slice(0, 2000);
  const attachments = Array.isArray(req.body.attachments)
    ? req.body.attachments.filter((item) => item && typeof item.url === "string")
    : [];

  if (!content && attachments.length === 0) {
    return res.status(400).json({ error: "Message cannot be empty" });
  }

  const message = store.createMessage({
    channelId,
    authorId: req.auth.user.id,
    content,
    attachments
  });

  const view = store.toMessageView(message);
  io.to(`channel:${channelId}`).emit("message:new", view);
  return res.status(201).json({ message: view });
});

app.delete("/api/channels/:channelId/messages/:messageId", authMiddleware, requireNotBanned, (req, res) => {
  const channelId = req.params.channelId;
  const messageId = req.params.messageId;
  const channel = store.getChannelById(channelId);
  if (!channel || channel.type !== "text") {
    return res.status(400).json({ error: "Messages are only available for text channels" });
  }
  req.params.guildId = channel.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.MANAGE_MESSAGES, channelId);
  if (permError) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const removed = store.deleteMessage(messageId);
  if (removed) {
    if (removed.attachments?.length) {
      deleteUploadFiles(removed.attachments);
    }
    io.to(`channel:${channelId}`).emit("message:delete", { messageId, channelId });
    store.addAudit({ guildId: channel.guildId, action: "message.delete", actorId: req.auth.user.id, targetId: messageId });
  }
  return res.json({ ok: true });
});

app.post("/api/files/upload", authMiddleware, requireNotBanned, upload.single("file"), (req, res) => {
  const channelId = req.body.channelId;
  const channel = channelId ? store.getChannelById(channelId) : null;
  if (!channel) {
    return res.status(403).json({ error: "Forbidden" });
  }
  req.params.guildId = channel.guildId;
  const permError = requirePermission(req, res, PERMISSIONS.ATTACH_FILES, channelId);
  if (permError) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!rateLimitOr(res, `upload:${req.auth.user.id}`, 30, 60_000)) {
    return;
  }

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // Validate file extension - block executable and potentially dangerous files
  const BLOCKED_EXTENSIONS = [".exe", ".bat", ".cmd", ".com", ".scr", ".vbs", ".js", ".jar", ".msi", ".dll", ".so", ".dylib", ".sh", ".ps1"];
  const fileExt = path.extname(req.file.originalname || "").toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(fileExt)) {
    // Delete the uploaded file
    try {
      fs.unlinkSync(req.file.path);
    } catch {}
    return res.status(400).json({ error: "File type not allowed for security reasons" });
  }

  const displayName = sanitizeFilename(req.file.originalname || "file");
  const attachment = {
    id: uuid(),
    name: displayName,
    size: req.file.size,
    mimeType: req.file.mimetype,
    url: `/uploads/${req.file.filename}`
  };

  store.createUpload({
    id: attachment.id,
    channelId,
    authorId: req.auth.user.id,
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.mimeType,
    url: attachment.url
  });

  return res.status(201).json({ attachment });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const guild = store.getNodeGuild();
  const users = store.listProfiles().map((profile) => ({
    id: profile.id,
    username: profile.username,
    email: profile.email || null,
    createdAt: profile.createdAt,
    lastSeenAt: profile.lastSeenAt || null,
    isMember: guild ? guild.memberIds.includes(profile.id) : false,
    isBanned: store.isBanned(profile.id)
  }));
  return res.json({ users });
});

app.get("/api/admin/bans", requireAdmin, (req, res) => {
  const bans = store.listBans().map((entry) => ({
    userId: entry.userId,
    bannedAt: entry.bannedAt || null,
    profile: store.getProfile(entry.userId)
  }));
  return res.json({ bans });
});

app.post("/api/admin/bans/:userId/unban", requireAdmin, (req, res) => {
  const userId = req.params.userId;
  const ok = store.unbanUser(userId);
  if (!ok) {
    return res.status(404).json({ error: "User not banned" });
  }
  return res.json({ ok: true });
});

app.post("/api/admin/users/:userId/kick", requireAdmin, (req, res) => {
  const userId = req.params.userId;
  const guild = store.getNodeGuild();
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }
  const uploads = store.listUploadsByAuthor(userId);
  store.purgeUser(userId);
  deleteUploadFiles(uploads);
  io.to(`guild:${guild.id}`).emit("guild:memberLeft", { guildId: guild.id, userId });
  socketAdmin?.disconnectUser?.(userId, "kicked");
  return res.json({ ok: true });
});

app.post("/api/admin/users/:userId/ban", requireAdmin, (req, res) => {
  const userId = req.params.userId;
  const guild = store.getNodeGuild();
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }
  store.banUser(userId);
  const uploads = store.listUploadsByAuthor(userId);
  store.purgeUser(userId);
  deleteUploadFiles(uploads);
  io.to(`guild:${guild.id}`).emit("guild:memberLeft", { guildId: guild.id, userId });
  socketAdmin?.disconnectUser?.(userId, "banned");
  return res.json({ ok: true });
});

app.get("/api/admin/messages", requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
  const messages = store.listMessages(limit).map((message) => {
    const channel = store.getChannelById(message.channelId);
    return {
      ...message,
      channel: channel ? { id: channel.id, name: channel.name, type: channel.type } : null,
      author: store.publicUser(message.authorId)
    };
  });
  return res.json({ messages });
});

app.get("/api/admin/uploads", requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
  const uploads = store.listUploads(limit).map((upload) => {
    const channel = store.getChannelById(upload.channelId);
    return {
      ...upload,
      channel: channel ? { id: channel.id, name: channel.name, type: channel.type } : null,
      author: store.publicUser(upload.authorId)
    };
  });
  return res.json({ uploads });
});

app.get("/api/admin/roles", requireAdmin, (req, res) => {
  const guild = store.getNodeGuild();
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }
  return res.json({ roles: store.getRolesForGuild(guild.id) });
});

app.post("/api/admin/roles", requireAdmin, (req, res) => {
  const guild = store.getNodeGuild();
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }
  const name = (req.body.name || "").trim().slice(0, 40);
  if (!name) {
    return res.status(400).json({ error: "Role name is required" });
  }
  const permissions = Number.isInteger(req.body.permissions) ? req.body.permissions : 0;
  const color = (req.body.color || "").trim();
  const hoist = !!req.body.hoist;
  const role = store.createRole({ guildId: guild.id, name, color, permissions, hoist });
  return res.status(201).json({ role });
});

app.patch("/api/admin/roles/:roleId", requireAdmin, (req, res) => {
  const roleId = req.params.roleId;
  const role = store.getRoleById(roleId);
  if (!role) {
    return res.status(404).json({ error: "Role not found" });
  }
  const updated = store.updateRole(roleId, {
    name: typeof req.body.name === "string" ? req.body.name.trim() : undefined,
    color: typeof req.body.color === "string" ? req.body.color.trim() : undefined,
    permissions: Number.isInteger(req.body.permissions) ? req.body.permissions : undefined,
    hoist: typeof req.body.hoist === "boolean" ? req.body.hoist : undefined
  });
  return res.json({ role: updated });
});

app.delete("/api/admin/roles/:roleId", requireAdmin, (req, res) => {
  const roleId = req.params.roleId;
  if (roleId === store.getNodeGuild()?.id) {
    return res.status(400).json({ error: "@everyone cannot be deleted" });
  }
  const removed = store.deleteRole(roleId);
  return res.json({ ok: removed });
});

app.post("/api/admin/roles/:roleId/icon", requireAdmin, roleIconUpload.single("icon"), (req, res) => {
  const roleId = req.params.roleId;
  const role = store.getRoleById(roleId);
  if (!role) {
    return res.status(404).json({ error: "Role not found" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No icon uploaded" });
  }
  const ext = path.extname(req.file.originalname || ".png").toLowerCase() || ".png";
  const filename = `role-${roleId}-${Date.now()}${ext}`;
  const dest = path.join(roleIconsDir, filename);
  fs.writeFileSync(dest, req.file.buffer);
  const iconUrl = `/role-icons/${filename}`;
  const updated = store.updateRole(roleId, { iconUrl });
  return res.json({ role: updated });
});

app.get("/api/admin/members", requireAdmin, (req, res) => {
  const guild = store.getNodeGuild();
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }
  return res.json({ members: store.listMembers(guild.id).map((member) => serializeMember(member)) });
});

app.patch("/api/admin/members/:userId/roles", requireAdmin, (req, res) => {
  const guild = store.getNodeGuild();
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }
  const userId = req.params.userId;
  const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds.filter(Boolean) : [];
  const updated = store.updateMember(guild.id, userId, { roleIds });
  return res.json({ member: serializeMember(updated) });
});

app.patch("/api/admin/members/:userId/timeout", requireAdmin, (req, res) => {
  const guild = store.getNodeGuild();
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }
  const userId = req.params.userId;
  const minutes = Number(req.body.minutes || 0);
  const maxMinutes = store.getSettings().timeoutMaxMinutes || 10080;
  const clamped = minutes <= 0 ? 0 : Math.min(Math.max(minutes, 1), maxMinutes);
  const timeoutUntil = clamped ? new Date(Date.now() + clamped * 60 * 1000).toISOString() : null;
  const updated = store.updateMember(guild.id, userId, { timeoutUntil });
  return res.json({ member: serializeMember(updated) });
});

app.patch("/api/admin/members/:userId/voice", requireAdmin, (req, res) => {
  const guild = store.getNodeGuild();
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }
  const userId = req.params.userId;
  const updates = {};
  if (typeof req.body.voiceMuted === "boolean") {
    updates.voiceMuted = req.body.voiceMuted;
  }
  if (typeof req.body.voiceDeafened === "boolean") {
    updates.voiceDeafened = req.body.voiceDeafened;
  }
  const updated = store.updateMember(guild.id, userId, updates);
  return res.json({ member: serializeMember(updated) });
});

app.get("/api/admin/audit", requireAdmin, (req, res) => {
  const guild = store.getNodeGuild();
  if (!guild) {
    return res.status(404).json({ error: "Guild not found" });
  }
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
  const entries = store.listAudit(guild.id, limit);
  return res.json({ entries });
});

app.get("/api/admin/settings", requireAdmin, (req, res) => {
  return res.json({ settings: store.getSettings() });
});

app.patch("/api/admin/settings", requireAdmin, (req, res) => {
  const settings = store.updateSettings({
    auditMaxEntries: Number.isInteger(req.body.auditMaxEntries) ? req.body.auditMaxEntries : undefined,
    timeoutMaxMinutes: Number.isInteger(req.body.timeoutMaxMinutes) ? req.body.timeoutMaxMinutes : undefined
  });
  return res.json({ settings });
});

app.use((error, _, res, __) => {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File is too large" });
  }
  return res.status(500).json({ error: "Internal server error" });
});

async function sendHeartbeat() {
  try {
    if (!SERVER_ID) {
      SERVER_ID = computeServerId();
    }
    const response = await fetch(`${MAIN_BACKEND_URL}/api/hosts/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: SERVER_NAME,
        publicUrl: PUBLIC_URL,
        serverId: SERVER_ID,
        region: REGION,
        version: VERSION
      })
    });
  } catch {
    // Silent: self-hosted servers should keep running if central registry is temporarily down.
  }
}

// Error logging middleware
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  const userId = req.auth?.user?.id || "anonymous";

  console.error(`[${timestamp}] ERROR - ${method} ${url}`);
  console.error(`  User: ${userId}`);
  console.error(`  Error: ${err.message || String(err)}`);
  if (err.stack) {
    console.error(`  Stack: ${err.stack}`);
  }

  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message || "An error occurred"
  });
});

const PORT = Number(process.env.PORT || 4000);
server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Update PORT or stop the process using it.`);
  } else {
    console.error(`Server startup error: ${error?.message || String(error)}`);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Remus community server listening on http://localhost:${PORT}`);
  void sendHeartbeat();
  setInterval(() => {
    void sendHeartbeat();
  }, 30_000);
});
