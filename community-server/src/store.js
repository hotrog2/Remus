import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { ALL_PERMISSIONS, DEFAULT_EVERYONE_PERMS, PERMISSIONS, TIMEOUT_BLOCKED } from "./permissions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeDir = process.env.REMUS_RUNTIME_DIR ? path.resolve(process.env.REMUS_RUNTIME_DIR) : path.join(__dirname, "..");
const DB_PATH = process.env.REMUS_DB_PATH
  ? path.resolve(process.env.REMUS_DB_PATH)
  : path.join(runtimeDir, "data", "db.sqlite");
const LEGACY_DB_PATH = path.join(runtimeDir, "data", "db.json");

const DEFAULT_SETTINGS = {
  auditMaxEntries: 1000,
  timeoutMaxMinutes: 10080
};

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function looksLikeJson(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const text = buffer.toString("utf8").trimStart();
  return text.startsWith("{") || text.startsWith("[");
}

function isSQLiteHeader(buffer) {
  if (!buffer || buffer.length < 16) return false;
  return buffer.slice(0, 16).toString("utf8") === "SQLite format 3\u0000";
}

function prepareDbFile(dbPath, legacyPath) {
  if (!fs.existsSync(dbPath)) return;
  const stat = fs.statSync(dbPath);
  if (!stat.isFile() || stat.size === 0) return;
  const buffer = fs.readFileSync(dbPath);
  if (isSQLiteHeader(buffer)) return;

  if (looksLikeJson(buffer) && legacyPath && !fs.existsSync(legacyPath)) {
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, buffer.toString("utf8"), "utf8");
  }

  const backupPath = `${dbPath}.bak-${Date.now()}`;
  fs.renameSync(dbPath, backupPath);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return safeJsonParse(value, []);
  }
  return [];
}

function normalizeOverrides(value) {
  if (!value || typeof value !== "object") {
    return { roles: {}, members: {} };
  }
  return {
    roles: value.roles && typeof value.roles === "object" ? value.roles : {},
    members: value.members && typeof value.members === "object" ? value.members : {}
  };
}

function normalizeRoleIds(guildId, roleIds) {
  const ids = normalizeArray(roleIds)
    .map((id) => String(id))
    .filter(Boolean);
  if (guildId && !ids.includes(guildId)) {
    ids.unshift(guildId);
  }
  return [...new Set(ids)];
}

function encodeJson(value) {
  return JSON.stringify(value ?? null);
}

function decodeJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  return safeJsonParse(value, fallback);
}

export class Store {
  constructor() {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    prepareDbFile(DB_PATH, LEGACY_DB_PATH);
    try {
      this.db = new Database(DB_PATH);
    } catch (error) {
      if (error?.code === "SQLITE_NOTADB") {
        try {
          const backupPath = `${DB_PATH}.bak-${Date.now()}`;
          if (fs.existsSync(DB_PATH)) {
            fs.renameSync(DB_PATH, backupPath);
          }
        } catch {}
        this.db = new Database(DB_PATH);
      } else {
        throw error;
      }
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.importLegacyIfNeeded();
    this.ensureChannelPositions();
    this.ensureNodeGuildPointer();
  }

  ensureChannelPositions() {
    const columns = this.db.prepare("PRAGMA table_info(channels)").all().map((row) => row.name);
    if (!columns.includes("position")) {
      this.db.prepare("ALTER TABLE channels ADD COLUMN position INTEGER").run();
    }

    const rows = this.db
      .prepare("SELECT id, guild_id, category_id, created_at, position FROM channels ORDER BY created_at ASC")
      .all();
    if (!rows.length) return;

    const maxPositions = new Map();
    for (const row of rows) {
      const key = `${row.guild_id}|${row.category_id || ""}`;
      const current = maxPositions.get(key) || 0;
      if (Number.isInteger(row.position) && row.position > current) {
        maxPositions.set(key, row.position);
      }
    }

    const update = this.db.prepare("UPDATE channels SET position = ? WHERE id = ?");
    for (const row of rows) {
      if (Number.isInteger(row.position)) continue;
      const key = `${row.guild_id}|${row.category_id || ""}`;
      const next = (maxPositions.get(key) || 0) + 1;
      maxPositions.set(key, next);
      update.run(next, row.id);
    }
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        username TEXT,
        email TEXT,
        created_at TEXT,
        last_seen_at TEXT
      );

      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        guild_id TEXT,
        name TEXT,
        color TEXT,
        permissions INTEGER,
        hoist INTEGER,
        position INTEGER,
        icon_url TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_roles_guild ON roles(guild_id);

      CREATE TABLE IF NOT EXISTS members (
        guild_id TEXT,
        user_id TEXT,
        nickname TEXT,
        role_ids TEXT,
        joined_at TEXT,
        timeout_until TEXT,
        voice_muted INTEGER,
        voice_deafened INTEGER,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
      CREATE INDEX IF NOT EXISTS idx_members_timeout ON members(timeout_until);

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        guild_id TEXT,
        name TEXT,
        type TEXT,
        category_id TEXT,
        position INTEGER,
        created_by TEXT,
        created_at TEXT,
        permission_overrides TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_channels_guild ON channels(guild_id);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT,
        author_id TEXT,
        content TEXT,
        attachments TEXT,
        reply_to_id TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        channel_id TEXT,
        author_id TEXT,
        name TEXT,
        size INTEGER,
        mime_type TEXT,
        url TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_uploads_channel ON uploads(channel_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_uploads_author ON uploads(author_id);

      CREATE TABLE IF NOT EXISTS bans (
        user_id TEXT PRIMARY KEY,
        banned_at TEXT,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY,
        guild_id TEXT,
        action TEXT,
        actor_id TEXT,
        target_id TEXT,
        data TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit(guild_id, created_at DESC);
    `);

    if (!this.getMeta("settings")) {
      this.setMeta("settings", encodeJson(DEFAULT_SETTINGS));
    }

    const messageColumns = this.db.prepare("PRAGMA table_info(messages)").all().map((row) => row.name);
    if (!messageColumns.includes("reply_to_id")) {
      this.db.prepare("ALTER TABLE messages ADD COLUMN reply_to_id TEXT").run();
    }
  }

  getMeta(key) {
    return this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value || null;
  }

  setMeta(key, value) {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  ensureNodeGuildPointer() {
    const existing = this.getMeta("nodeGuildId");
    if (existing) return;
    const guild = this.db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get();
    if (guild?.id) {
      this.setMeta("nodeGuildId", guild.id);
    }
  }

  importLegacyIfNeeded() {
    const profilesCount = this.db.prepare("SELECT COUNT(1) AS count FROM profiles").get()?.count || 0;
    const guildCount = this.db.prepare("SELECT COUNT(1) AS count FROM guilds").get()?.count || 0;
    if ((profilesCount > 0 || guildCount > 0) || !fs.existsSync(LEGACY_DB_PATH)) {
      return;
    }

    const raw = fs.readFileSync(LEGACY_DB_PATH, "utf8");
    const parsed = safeJsonParse(raw, {});
    const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
    const guilds = Array.isArray(parsed.guilds) ? parsed.guilds : [];
    const channels = Array.isArray(parsed.channels) ? parsed.channels : [];
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const roles = Array.isArray(parsed.roles) ? parsed.roles : [];
    const members = Array.isArray(parsed.members) ? parsed.members : [];
    const uploads = Array.isArray(parsed.uploads) ? parsed.uploads : [];
    const bans = Array.isArray(parsed.bans) ? parsed.bans : [];
    const audit = Array.isArray(parsed.audit) ? parsed.audit : [];

    const insertProfile = this.db.prepare(
      "INSERT OR IGNORE INTO profiles (id, username, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
    );
    const insertGuild = this.db.prepare(
      "INSERT OR IGNORE INTO guilds (id, name, created_at) VALUES (?, ?, ?)"
    );
    const insertRole = this.db.prepare(
      "INSERT OR IGNORE INTO roles (id, guild_id, name, color, permissions, hoist, position, icon_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertMember = this.db.prepare(
      "INSERT OR IGNORE INTO members (guild_id, user_id, nickname, role_ids, joined_at, timeout_until, voice_muted, voice_deafened) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertChannel = this.db.prepare(
      "INSERT OR IGNORE INTO channels (id, guild_id, name, type, category_id, position, created_by, created_at, permission_overrides) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertMessage = this.db.prepare(
      "INSERT OR IGNORE INTO messages (id, channel_id, author_id, content, attachments, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertUpload = this.db.prepare(
      "INSERT OR IGNORE INTO uploads (id, channel_id, author_id, name, size, mime_type, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertBan = this.db.prepare("INSERT OR IGNORE INTO bans (user_id, banned_at, reason) VALUES (?, ?, ?)");
    const insertAudit = this.db.prepare(
      "INSERT OR IGNORE INTO audit (id, guild_id, action, actor_id, target_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    const tx = this.db.transaction(() => {
      for (const profile of profiles) {
        if (!profile?.id) continue;
        insertProfile.run(
          String(profile.id),
          profile.username || profile.displayName || "User",
          profile.email || null,
          profile.createdAt || nowIso(),
          profile.lastSeenAt || null
        );
      }

      for (const guild of guilds) {
        if (!guild?.id) continue;
        insertGuild.run(String(guild.id), guild.name || "Community", guild.createdAt || nowIso());
      }

      for (const role of roles) {
        if (!role?.id || !role?.guildId) continue;
        insertRole.run(
          String(role.id),
          String(role.guildId),
          role.name || "Role",
          role.color || "",
          Number.isInteger(role.permissions) ? role.permissions : 0,
          role.hoist ? 1 : 0,
          Number.isInteger(role.position) ? role.position : 0,
          role.iconUrl || null,
          role.createdAt || nowIso()
        );
      }

      for (const member of members) {
        if (!member?.guildId || !member?.userId) continue;
        insertMember.run(
          String(member.guildId),
          String(member.userId),
          member.nickname || "",
          encodeJson(normalizeRoleIds(String(member.guildId), member.roleIds)),
          member.joinedAt || nowIso(),
          member.timeoutUntil || null,
          member.voiceMuted ? 1 : 0,
          member.voiceDeafened ? 1 : 0
        );
      }

      for (const channel of channels) {
        if (!channel?.id || !channel?.guildId) continue;
        insertChannel.run(
          String(channel.id),
          String(channel.guildId),
          channel.name || "channel",
          channel.type || "text",
          channel.categoryId || null,
          Number.isInteger(channel.position) ? channel.position : 0,
          channel.createdBy || null,
          channel.createdAt || nowIso(),
          encodeJson(channel.permissionOverrides || null)
        );
      }

      for (const message of messages) {
        if (!message?.id || !message?.channelId) continue;
        insertMessage.run(
          String(message.id),
          String(message.channelId),
          message.authorId || "",
          message.content || "",
          encodeJson(message.attachments || []),
          message.replyToId || null,
          message.createdAt || nowIso()
        );
      }

      for (const upload of uploads) {
        if (!upload?.id || !upload?.channelId) continue;
        insertUpload.run(
          String(upload.id),
          String(upload.channelId),
          upload.authorId || "",
          upload.name || "",
          Number(upload.size || 0),
          upload.mimeType || "",
          upload.url || "",
          upload.createdAt || nowIso()
        );
      }

      for (const entry of bans) {
        if (!entry?.userId) continue;
        insertBan.run(String(entry.userId), entry.bannedAt || nowIso(), entry.reason || null);
      }

      for (const entry of audit) {
        if (!entry?.id || !entry?.guildId) continue;
        insertAudit.run(
          String(entry.id),
          String(entry.guildId),
          entry.action || "",
          entry.actorId || null,
          entry.targetId || null,
          encodeJson(entry.data || null),
          entry.createdAt || nowIso()
        );
      }
    });

    tx();

    if (parsed.settings && typeof parsed.settings === "object") {
      this.setMeta("settings", encodeJson({ ...DEFAULT_SETTINGS, ...parsed.settings }));
    }

    const onlyGuild = this.db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get();
    if (onlyGuild?.id) {
      this.setMeta("nodeGuildId", onlyGuild.id);
      this.ensureDefaultRoles(onlyGuild.id);
    }
  }

  getSettings() {
    const raw = this.getMeta("settings");
    const parsed = decodeJson(raw, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(parsed || {}) };
  }

  updateSettings(partial) {
    const current = this.getSettings();
    const next = { ...current, ...(partial || {}) };
    this.setMeta("settings", encodeJson(next));
    return next;
  }

  listProfiles() {
    return this.db.prepare("SELECT * FROM profiles ORDER BY created_at ASC").all();
  }

  getProfile(userId) {
    if (!userId) return null;
    return this.db.prepare("SELECT * FROM profiles WHERE id = ?").get(userId) || null;
  }

  publicUser(userOrId) {
    if (!userOrId) return null;
    if (typeof userOrId === "object") {
      return {
        id: userOrId.id,
        username: userOrId.username,
        createdAt: userOrId.createdAt || userOrId.created_at || null,
        lastSeenAt: userOrId.lastSeenAt || userOrId.last_seen_at || null
      };
    }
    const user = this.getProfile(userOrId);
    if (!user) {
      return {
        id: userOrId,
        username: `User ${String(userOrId).slice(0, 6)}`,
        createdAt: null,
        lastSeenAt: null
      };
    }
    return {
      id: user.id,
      username: user.username || `User ${String(user.id).slice(0, 6)}`,
      createdAt: user.created_at || null,
      lastSeenAt: user.last_seen_at || null
    };
  }

  upsertProfile(user) {
    if (!user?.id) return null;
    const existing = this.getProfile(user.id);
    const username = user.username || existing?.username || "User";
    const createdAt = existing?.created_at || user.createdAt || nowIso();
    const lastSeenAt = user.lastSeenAt || nowIso();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO profiles (id, username, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(user.id, username, existing?.email || null, createdAt, lastSeenAt);
    return this.getProfile(user.id);
  }

  listGuilds() {
    return this.db.prepare("SELECT * FROM guilds ORDER BY created_at ASC").all();
  }

  getGuildById(guildId) {
    if (!guildId) return null;
    const row = this.db.prepare("SELECT * FROM guilds WHERE id = ?").get(guildId);
    if (!row) return null;
    const memberIds = this.db
      .prepare("SELECT user_id FROM members WHERE guild_id = ?")
      .all(guildId)
      .map((entry) => entry.user_id);
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      memberIds
    };
  }

  getNodeGuild() {
    const nodeId = this.getMeta("nodeGuildId");
    if (nodeId) {
      return this.getGuildById(nodeId);
    }
    const first = this.db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get();
    if (first?.id) {
      this.setMeta("nodeGuildId", first.id);
      return this.getGuildById(first.id);
    }
    return null;
  }

  ensureNodeGuild(serverName) {
    let guild = this.getNodeGuild();
    if (guild) {
      return guild;
    }
    guild = this.createGuild(serverName || "Community");
    this.createChannel({ guildId: guild.id, name: "general", type: "text", createdBy: "system" });
    this.createChannel({ guildId: guild.id, name: "Lounge", type: "voice", createdBy: "system" });
    return this.getGuildById(guild.id);
  }

  createGuild(name) {
    const id = uuid();
    const createdAt = nowIso();
    this.db.prepare("INSERT INTO guilds (id, name, created_at) VALUES (?, ?, ?)").run(id, name || "Community", createdAt);
    this.setMeta("nodeGuildId", id);
    this.ensureDefaultRoles(id);
    return this.getGuildById(id);
  }

  ensureDefaultRoles(guildId) {
    if (!guildId) return;
    const roles = this.getRolesForGuild(guildId);
    const hasEveryone = roles.some((role) => role.id === guildId);
    const hasAdmin = roles.some((role) => role.name?.toLowerCase() === "admin");

    if (!hasEveryone) {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO roles (id, guild_id, name, color, permissions, hoist, position, icon_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(guildId, guildId, "@everyone", "", DEFAULT_EVERYONE_PERMS, 0, 0, null, nowIso());
    }

    if (!hasAdmin) {
      const maxPos = roles.reduce((max, role) => Math.max(max, role.position || 0), 0);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO roles (id, guild_id, name, color, permissions, hoist, position, icon_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(uuid(), guildId, "Admin", "#f1c40f", ALL_PERMISSIONS, 1, maxPos + 1, null, nowIso());
    }
  }

  ensureCommunityForUser(userId, serverName) {
    if (!userId) return null;
    let guild = this.getNodeGuild();
    if (!guild) {
      guild = this.createGuild(serverName || "Community");
      this.createChannel({ guildId: guild.id, name: "general", type: "text", createdBy: userId });
      this.createChannel({ guildId: guild.id, name: "Lounge", type: "voice", createdBy: userId });
    }

    this.ensureDefaultRoles(guild.id);
    let member = this.getMember(guild.id, userId);
    if (!member) {
      const adminRole = this.getRolesForGuild(guild.id).find((role) => role.name?.toLowerCase() === "admin");
      const existingMembers = this.listMembers(guild.id);
      const roles = existingMembers.length === 0 && adminRole ? [adminRole.id] : [];
      member = this.createMember(guild.id, userId, roles);
    }
    return this.getGuildById(guild.id);
  }

  createMember(guildId, userId, roleIds = []) {
    const normalized = normalizeRoleIds(guildId, roleIds);
    const joinedAt = nowIso();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO members (guild_id, user_id, nickname, role_ids, joined_at, timeout_until, voice_muted, voice_deafened) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(guildId, userId, "", encodeJson(normalized), joinedAt, null, 0, 0);
    return this.getMember(guildId, userId);
  }

  addMemberToGuild(guildId, userId) {
    const guild = this.getGuildById(guildId);
    if (!guild) return null;
    this.ensureDefaultRoles(guildId);
    const existing = this.getMember(guildId, userId);
    if (!existing) {
      this.createMember(guildId, userId, []);
    }
    return this.getGuildById(guildId);
  }

  getMember(guildId, userId) {
    if (!guildId || !userId) return null;
    const row = this.db
      .prepare("SELECT * FROM members WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId);
    if (!row) return null;
    return {
      guildId: row.guild_id,
      userId: row.user_id,
      nickname: row.nickname || "",
      roleIds: normalizeRoleIds(row.guild_id, decodeJson(row.role_ids, [])),
      joinedAt: row.joined_at || null,
      timeoutUntil: row.timeout_until || null,
      voiceMuted: !!row.voice_muted,
      voiceDeafened: !!row.voice_deafened
    };
  }

  listMembers(guildId) {
    if (!guildId) return [];
    return this.db
      .prepare("SELECT * FROM members WHERE guild_id = ? ORDER BY joined_at ASC")
      .all(guildId)
      .map((row) => ({
        guildId: row.guild_id,
        userId: row.user_id,
        nickname: row.nickname || "",
        roleIds: normalizeRoleIds(row.guild_id, decodeJson(row.role_ids, [])),
        joinedAt: row.joined_at || null,
        timeoutUntil: row.timeout_until || null,
        voiceMuted: !!row.voice_muted,
        voiceDeafened: !!row.voice_deafened
      }));
  }

  updateMember(guildId, userId, updates) {
    const existing = this.getMember(guildId, userId);
    if (!existing) return null;
    const next = {
      nickname: typeof updates?.nickname === "string" ? updates.nickname : existing.nickname,
      roleIds: Array.isArray(updates?.roleIds) ? normalizeRoleIds(guildId, updates.roleIds) : existing.roleIds,
      timeoutUntil: updates?.timeoutUntil !== undefined ? updates.timeoutUntil : existing.timeoutUntil,
      voiceMuted: typeof updates?.voiceMuted === "boolean" ? updates.voiceMuted : existing.voiceMuted,
      voiceDeafened: typeof updates?.voiceDeafened === "boolean" ? updates.voiceDeafened : existing.voiceDeafened
    };

    this.db
      .prepare(
        "UPDATE members SET nickname = ?, role_ids = ?, timeout_until = ?, voice_muted = ?, voice_deafened = ? WHERE guild_id = ? AND user_id = ?"
      )
      .run(
        next.nickname,
        encodeJson(next.roleIds),
        next.timeoutUntil || null,
        next.voiceMuted ? 1 : 0,
        next.voiceDeafened ? 1 : 0,
        guildId,
        userId
      );
    return this.getMember(guildId, userId);
  }

  isGuildMember(guildId, userId) {
    if (!guildId || !userId) return false;
    const row = this.db
      .prepare("SELECT 1 FROM members WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId);
    return !!row;
  }

  getGuildsForUser(userId) {
    if (!userId) return [];
    const rows = this.db
      .prepare(
        "SELECT guilds.id, guilds.name, guilds.created_at FROM guilds INNER JOIN members ON members.guild_id = guilds.id WHERE members.user_id = ?"
      )
      .all(userId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at
    }));
  }

  getRolesForGuild(guildId) {
    if (!guildId) return [];
    return this.db
      .prepare("SELECT * FROM roles WHERE guild_id = ? ORDER BY position ASC")
      .all(guildId)
      .map((row) => ({
        id: row.id,
        guildId: row.guild_id,
        name: row.name,
        color: row.color || "",
        permissions: row.permissions || 0,
        hoist: !!row.hoist,
        position: row.position || 0,
        iconUrl: row.icon_url || null,
        createdAt: row.created_at || null
      }));
  }

  getRoleById(roleId) {
    if (!roleId) return null;
    const row = this.db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId);
    if (!row) return null;
    return {
      id: row.id,
      guildId: row.guild_id,
      name: row.name,
      color: row.color || "",
      permissions: row.permissions || 0,
      hoist: !!row.hoist,
      position: row.position || 0,
      iconUrl: row.icon_url || null,
      createdAt: row.created_at || null
    };
  }

  createRole({ guildId, name, color, permissions, hoist }) {
    const roles = this.getRolesForGuild(guildId);
    const maxPos = roles.reduce((max, role) => Math.max(max, role.position || 0), 0);
    const role = {
      id: uuid(),
      guildId,
      name: name || "Role",
      color: color || "",
      permissions: Number.isInteger(permissions) ? permissions : 0,
      hoist: hoist ? 1 : 0,
      position: maxPos + 1,
      iconUrl: null,
      createdAt: nowIso()
    };
    this.db
      .prepare(
        "INSERT INTO roles (id, guild_id, name, color, permissions, hoist, position, icon_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        role.id,
        role.guildId,
        role.name,
        role.color,
        role.permissions,
        role.hoist,
        role.position,
        role.iconUrl,
        role.createdAt
      );
    return this.getRoleById(role.id);
  }

  updateRole(roleId, updates) {
    const existing = this.getRoleById(roleId);
    if (!existing) return null;
    const next = {
      name: typeof updates?.name === "string" ? updates.name : existing.name,
      color: typeof updates?.color === "string" ? updates.color : existing.color,
      permissions: Number.isInteger(updates?.permissions) ? updates.permissions : existing.permissions,
      hoist: typeof updates?.hoist === "boolean" ? (updates.hoist ? 1 : 0) : existing.hoist ? 1 : 0,
      position: Number.isInteger(updates?.position) ? updates.position : existing.position,
      iconUrl: updates?.iconUrl !== undefined ? updates.iconUrl : existing.iconUrl
    };
    this.db
      .prepare("UPDATE roles SET name = ?, color = ?, permissions = ?, hoist = ?, position = ?, icon_url = ? WHERE id = ?")
      .run(next.name, next.color, next.permissions, next.hoist, next.position, next.iconUrl, roleId);
    return this.getRoleById(roleId);
  }

  deleteRole(roleId) {
    const role = this.getRoleById(roleId);
    if (!role) return false;
    if (role.id === role.guildId) return false;
    const info = this.db.prepare("DELETE FROM roles WHERE id = ?").run(roleId);
    if (info.changes) {
      const members = this.listMembers(role.guildId);
      for (const member of members) {
        if (member.roleIds.includes(roleId)) {
          const next = member.roleIds.filter((id) => id !== roleId);
          this.updateMember(role.guildId, member.userId, { roleIds: next });
        }
      }
    }
    return info.changes > 0;
  }

  getChannelsForGuild(guildId) {
    if (!guildId) return [];
    return this.db
      .prepare("SELECT * FROM channels WHERE guild_id = ? ORDER BY position ASC, created_at ASC")
      .all(guildId)
      .map((row) => ({
        id: row.id,
        guildId: row.guild_id,
        name: row.name,
        type: row.type,
        categoryId: row.category_id || null,
        position: Number.isInteger(row.position) ? row.position : 0,
        createdBy: row.created_by || null,
        createdAt: row.created_at || null,
        permissionOverrides: decodeJson(row.permission_overrides, null)
      }));
  }

  getChannelById(channelId) {
    if (!channelId) return null;
    const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId);
    if (!row) return null;
    return {
      id: row.id,
      guildId: row.guild_id,
      name: row.name,
      type: row.type,
      categoryId: row.category_id || null,
      position: Number.isInteger(row.position) ? row.position : 0,
      createdBy: row.created_by || null,
      createdAt: row.created_at || null,
      permissionOverrides: decodeJson(row.permission_overrides, null)
    };
  }

  getNextChannelPosition(guildId, categoryId) {
    if (!guildId) return 1;
    const row = this.db
      .prepare("SELECT MAX(position) as maxPos FROM channels WHERE guild_id = ? AND category_id IS ?")
      .get(guildId, categoryId || null);
    const maxPos = Number.isInteger(row?.maxPos) ? row.maxPos : 0;
    return maxPos + 1;
  }

  createChannel({ guildId, name, type, createdBy, categoryId = null }) {
    const channel = {
      id: uuid(),
      guildId,
      name: name || "channel",
      type: type || "text",
      categoryId: categoryId || null,
      position: this.getNextChannelPosition(guildId, categoryId || null),
      createdBy: createdBy || null,
      createdAt: nowIso(),
      permissionOverrides: null
    };
    this.db
      .prepare(
        "INSERT INTO channels (id, guild_id, name, type, category_id, position, created_by, created_at, permission_overrides) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        channel.id,
        channel.guildId,
        channel.name,
        channel.type,
        channel.categoryId,
        channel.position,
        channel.createdBy,
        channel.createdAt,
        encodeJson(channel.permissionOverrides)
      );
    return this.getChannelById(channel.id);
  }

  updateChannel(channelId, updates) {
    const existing = this.getChannelById(channelId);
    if (!existing) return null;
    const nextCategoryId = updates?.categoryId !== undefined ? updates.categoryId : existing.categoryId;
    let nextPosition = updates?.position !== undefined ? updates.position : existing.position;
    if (updates?.categoryId !== undefined && updates.categoryId !== existing.categoryId && updates?.position === undefined) {
      nextPosition = this.getNextChannelPosition(existing.guildId, nextCategoryId);
    }
    const next = {
      name: updates?.name !== undefined ? updates.name : existing.name,
      categoryId: nextCategoryId,
      position: Number.isInteger(nextPosition) ? nextPosition : existing.position,
      permissionOverrides: updates?.permissionOverrides !== undefined ? updates.permissionOverrides : existing.permissionOverrides
    };
    this.db
      .prepare("UPDATE channels SET name = ?, category_id = ?, position = ?, permission_overrides = ? WHERE id = ?")
      .run(
        next.name,
        next.categoryId || null,
        next.position,
        encodeJson(next.permissionOverrides),
        channelId
      );
    return this.getChannelById(channelId);
  }

  updateChannelPositions(updates) {
    if (!Array.isArray(updates) || updates.length === 0) return [];
    const apply = this.db.prepare("UPDATE channels SET category_id = ?, position = ? WHERE id = ?");
    const tx = this.db.transaction((items) => {
      for (const item of items) {
        if (!item?.id) continue;
        if (!Number.isInteger(item.position)) continue;
        apply.run(item.categoryId ?? null, item.position, item.id);
      }
    });
    tx(updates);
    const updated = [];
    for (const item of updates) {
      if (!item?.id) continue;
      const channel = this.getChannelById(item.id);
      if (channel) updated.push(channel);
    }
    return updated;
  }

  deleteChannel(channelId) {
    const channel = this.getChannelById(channelId);
    if (!channel) return null;
    const uploads = this.listUploadsByChannel(channelId);
    this.db.prepare("DELETE FROM messages WHERE channel_id = ?").run(channelId);
    this.db.prepare("DELETE FROM uploads WHERE channel_id = ?").run(channelId);
    this.db.prepare("DELETE FROM channels WHERE id = ?").run(channelId);
    return { channel, uploads };
  }

  listUploadsByChannel(channelId) {
    if (!channelId) return [];
    return this.db
      .prepare("SELECT * FROM uploads WHERE channel_id = ? ORDER BY created_at ASC")
      .all(channelId)
      .map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        authorId: row.author_id,
        name: row.name,
        size: row.size,
        mimeType: row.mime_type,
        url: row.url,
        createdAt: row.created_at
      }));
  }

  listUploadsByAuthor(userId) {
    if (!userId) return [];
    return this.db
      .prepare("SELECT * FROM uploads WHERE author_id = ? ORDER BY created_at ASC")
      .all(userId)
      .map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        authorId: row.author_id,
        name: row.name,
        size: row.size,
        mimeType: row.mime_type,
        url: row.url,
        createdAt: row.created_at
      }));
  }

  createUpload({ id, channelId, authorId, name, size, mimeType, url }) {
    const uploadId = id || uuid();
    this.db
      .prepare(
        "INSERT INTO uploads (id, channel_id, author_id, name, size, mime_type, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        uploadId,
        channelId,
        authorId,
        name || "",
        Number(size || 0),
        mimeType || "",
        url || "",
        nowIso()
      );
    return uploadId;
  }

  listUploads(limit = 200) {
    return this.db
      .prepare("SELECT * FROM uploads ORDER BY created_at DESC LIMIT ?")
      .all(limit)
      .map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        authorId: row.author_id,
        name: row.name,
        size: row.size,
        mimeType: row.mime_type,
        url: row.url,
        createdAt: row.created_at
      }));
  }

  createMessage({ channelId, authorId, content, attachments, replyToId }) {
    const message = {
      id: uuid(),
      channelId,
      authorId,
      content: content || "",
      attachments: Array.isArray(attachments) ? attachments : [],
      replyToId: replyToId || null,
      createdAt: nowIso()
    };
    this.db
      .prepare("INSERT INTO messages (id, channel_id, author_id, content, attachments, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        message.id,
        message.channelId,
        message.authorId,
        message.content,
        encodeJson(message.attachments),
        message.replyToId,
        message.createdAt
      );
    return message;
  }

  getMessageById(messageId) {
    if (!messageId) return null;
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    if (!row) return null;
    return {
      id: row.id,
      channelId: row.channel_id,
      authorId: row.author_id,
      content: row.content,
      attachments: decodeJson(row.attachments, []),
      replyToId: row.reply_to_id || null,
      createdAt: row.created_at
    };
  }

  deleteMessage(messageId) {
    if (!messageId) return null;
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    if (!row) return null;
    this.db.prepare("UPDATE messages SET reply_to_id = NULL WHERE reply_to_id = ?").run(messageId);
    this.db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
    const attachments = decodeJson(row.attachments, []);
    if (Array.isArray(attachments)) {
      for (const attachment of attachments) {
        if (!attachment) continue;
        const attachmentId = attachment.id || null;
        if (attachmentId) {
          this.db.prepare("DELETE FROM uploads WHERE id = ?").run(attachmentId);
        } else if (attachment.url) {
          this.db.prepare("DELETE FROM uploads WHERE url = ?").run(attachment.url);
        }
      }
    }
    return {
      id: row.id,
      channelId: row.channel_id,
      authorId: row.author_id,
      content: row.content,
      attachments,
      replyToId: row.reply_to_id || null,
      createdAt: row.created_at
    };
  }

  getMessagesForChannel(channelId, limit = 50) {
    if (!channelId) return [];
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(channelId, limit);
    const mapped = rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      authorId: row.author_id,
      content: row.content,
      attachments: decodeJson(row.attachments, []),
      replyToId: row.reply_to_id || null,
      createdAt: row.created_at
    }));
    return mapped.reverse();
  }

  listMessages(limit = 200) {
    return this.db
      .prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT ?")
      .all(limit)
      .map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        authorId: row.author_id,
        content: row.content,
        attachments: decodeJson(row.attachments, []),
        replyToId: row.reply_to_id || null,
        createdAt: row.created_at
      }));
  }

  toMessageView(message) {
    if (!message) return null;
    const reply = message.replyToId ? this.getMessageById(message.replyToId) : null;
    return {
      id: message.id,
      channelId: message.channelId,
      content: message.content,
      attachments: message.attachments || [],
      replyTo: reply
        ? {
            id: reply.id,
            content: reply.content,
            author: this.publicUser(reply.authorId)
          }
        : null,
      createdAt: message.createdAt,
      author: this.publicUser(message.authorId)
    };
  }

  listAudit(guildId, limit = 200) {
    if (!guildId) return [];
    return this.db
      .prepare("SELECT * FROM audit WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(guildId, limit)
      .map((row) => ({
        id: row.id,
        guildId: row.guild_id,
        action: row.action,
        actorId: row.actor_id,
        targetId: row.target_id,
        data: decodeJson(row.data, null),
        createdAt: row.created_at
      }));
  }

  addAudit({ guildId, action, actorId, targetId, data }) {
    if (!guildId) return null;
    const entry = {
      id: uuid(),
      guildId,
      action: action || "",
      actorId: actorId || null,
      targetId: targetId || null,
      data: data || null,
      createdAt: nowIso()
    };
    this.db
      .prepare("INSERT INTO audit (id, guild_id, action, actor_id, target_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(entry.id, entry.guildId, entry.action, entry.actorId, entry.targetId, encodeJson(entry.data), entry.createdAt);

    const settings = this.getSettings();
    const max = Number(settings.auditMaxEntries || 0);
    if (Number.isFinite(max) && max > 0) {
      const count = this.db.prepare("SELECT COUNT(1) AS count FROM audit WHERE guild_id = ?").get(guildId)?.count || 0;
      if (count > max) {
        const overflow = count - max;
        const ids = this.db
          .prepare("SELECT id FROM audit WHERE guild_id = ? ORDER BY created_at ASC LIMIT ?")
          .all(guildId, overflow)
          .map((row) => row.id);
        if (ids.length) {
          const stmt = this.db.prepare("DELETE FROM audit WHERE id = ?");
          for (const id of ids) {
            stmt.run(id);
          }
        }
      }
    }
    return entry;
  }

  listBans() {
    return this.db
      .prepare("SELECT * FROM bans ORDER BY banned_at DESC")
      .all()
      .map((row) => ({
        userId: row.user_id,
        bannedAt: row.banned_at || null,
        reason: row.reason || null
      }));
  }

  isBanned(userId) {
    if (!userId) return false;
    const row = this.db.prepare("SELECT 1 FROM bans WHERE user_id = ?").get(userId);
    return !!row;
  }

  banUser(userId, reason = null) {
    if (!userId) return null;
    const entry = {
      userId,
      bannedAt: nowIso(),
      reason
    };
    this.db
      .prepare("INSERT OR REPLACE INTO bans (user_id, banned_at, reason) VALUES (?, ?, ?)")
      .run(entry.userId, entry.bannedAt, entry.reason);
    return entry;
  }

  unbanUser(userId) {
    if (!userId) return false;
    const info = this.db.prepare("DELETE FROM bans WHERE user_id = ?").run(userId);
    return info.changes > 0;
  }

  purgeUser(userId) {
    if (!userId) return false;
    this.db.prepare("DELETE FROM members WHERE user_id = ?").run(userId);
    this.db.prepare("DELETE FROM messages WHERE author_id = ?").run(userId);
    this.db.prepare("DELETE FROM uploads WHERE author_id = ?").run(userId);
    this.db.prepare("DELETE FROM profiles WHERE id = ?").run(userId);
    return true;
  }

  getPermissions(guildId, userId, channelId = null) {
    if (!guildId || !userId) return 0;
    const member = this.getMember(guildId, userId);
    if (!member) return 0;
    const roles = this.getRolesForGuild(guildId);
    const roleIds = new Set(normalizeRoleIds(guildId, member.roleIds));

    let perms = 0;
    for (const role of roles) {
      if (roleIds.has(role.id)) {
        perms |= role.permissions || 0;
      }
    }

    if ((perms & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) {
      return ALL_PERMISSIONS;
    }

    const applyOverrides = (overrides) => {
      const normalized = normalizeOverrides(overrides);
      const everyone = normalized.roles?.[guildId];
      if (everyone) {
        perms &= ~(everyone.deny || 0);
        perms |= everyone.allow || 0;
      }

      let roleAllow = 0;
      let roleDeny = 0;
      for (const roleId of roleIds) {
        if (roleId === guildId) continue;
        const override = normalized.roles?.[roleId];
        if (override) {
          roleAllow |= override.allow || 0;
          roleDeny |= override.deny || 0;
        }
      }
      perms &= ~roleDeny;
      perms |= roleAllow;

      const memberOverride = normalized.members?.[userId];
      if (memberOverride) {
        perms &= ~(memberOverride.deny || 0);
        perms |= memberOverride.allow || 0;
      }
    };

    if (channelId) {
      const channel = this.getChannelById(channelId);
      if (channel?.categoryId) {
        const category = this.getChannelById(channel.categoryId);
        if (category?.permissionOverrides) {
          applyOverrides(category.permissionOverrides);
        }
      }
      if (channel?.permissionOverrides) {
        applyOverrides(channel.permissionOverrides);
      }
    }

    if (member.timeoutUntil) {
      const until = new Date(member.timeoutUntil).getTime();
      if (!Number.isNaN(until) && Date.now() < until) {
        perms &= ~TIMEOUT_BLOCKED;
      }
    }

    return perms;
  }

  isChannelAccessible(channelId, userId) {
    const channel = this.getChannelById(channelId);
    if (!channel) return false;
    const perms = this.getPermissions(channel.guildId, userId, channelId);
    return (perms & PERMISSIONS.VIEW_CHANNELS) === PERMISSIONS.VIEW_CHANNELS;
  }
}
