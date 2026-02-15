import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Device } from "mediasoup-client";
import {
  apiAuth,
  apiCommunity,
  getConfiguredAuthBase,
  getDefaultCommunityBase,
  getAuthBase,
  setAuthBase,
  sanitizeCommunityBase,
  toAbsoluteUrl
} from "./api";

const CLIENT_SETTINGS_KEY = "remus_client_settings";
const JOINED_SERVERS_KEY = "remus_joined_servers";
const SELECTED_SERVER_KEY = "remus_selected_server";
const VOICE_VOLUMES_KEY = "remus_voice_volumes";
const LAST_READ_MESSAGES_KEY = "remus_last_read_messages";
const MESSAGE_DRAFTS_KEY = "remus_message_drafts";
const PERMISSIONS = {
  ADMINISTRATOR: 1 << 0,
  VIEW_CHANNELS: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  MANAGE_SERVER: 1 << 4,
  VIEW_AUDIT_LOG: 1 << 5,
  SEND_MESSAGES: 1 << 6,
  READ_HISTORY: 1 << 7,
  MANAGE_MESSAGES: 1 << 8,
  ATTACH_FILES: 1 << 9,
  VOICE_CONNECT: 1 << 10,
  VOICE_SPEAK: 1 << 11,
  VOICE_MUTE_MEMBERS: 1 << 12,
  VOICE_DEAFEN_MEMBERS: 1 << 13,
  VOICE_MOVE_MEMBERS: 1 << 14,
  SCREENSHARE: 1 << 15,
  KICK_MEMBERS: 1 << 16,
  BAN_MEMBERS: 1 << 17,
  TIMEOUT_MEMBERS: 1 << 18
};

const PERMISSION_OPTIONS = [
  { key: "VIEW_CHANNELS", label: "View Channels", bit: PERMISSIONS.VIEW_CHANNELS },
  { key: "MANAGE_CHANNELS", label: "Manage Channels", bit: PERMISSIONS.MANAGE_CHANNELS },
  { key: "MANAGE_ROLES", label: "Manage Roles", bit: PERMISSIONS.MANAGE_ROLES },
  { key: "MANAGE_SERVER", label: "Manage Server", bit: PERMISSIONS.MANAGE_SERVER },
  { key: "VIEW_AUDIT_LOG", label: "View Audit Log", bit: PERMISSIONS.VIEW_AUDIT_LOG },
  { key: "SEND_MESSAGES", label: "Send Messages", bit: PERMISSIONS.SEND_MESSAGES },
  { key: "READ_HISTORY", label: "Read Message History", bit: PERMISSIONS.READ_HISTORY },
  { key: "MANAGE_MESSAGES", label: "Manage Messages", bit: PERMISSIONS.MANAGE_MESSAGES },
  { key: "ATTACH_FILES", label: "Attach Files", bit: PERMISSIONS.ATTACH_FILES },
  { key: "VOICE_CONNECT", label: "Voice: Connect", bit: PERMISSIONS.VOICE_CONNECT },
  { key: "VOICE_SPEAK", label: "Voice: Speak", bit: PERMISSIONS.VOICE_SPEAK },
  { key: "VOICE_MUTE_MEMBERS", label: "Voice: Mute Members", bit: PERMISSIONS.VOICE_MUTE_MEMBERS },
  { key: "VOICE_DEAFEN_MEMBERS", label: "Voice: Deafen Members", bit: PERMISSIONS.VOICE_DEAFEN_MEMBERS },
  { key: "VOICE_MOVE_MEMBERS", label: "Voice: Move Members", bit: PERMISSIONS.VOICE_MOVE_MEMBERS },
  { key: "SCREENSHARE", label: "Screenshare", bit: PERMISSIONS.SCREENSHARE },
  { key: "KICK_MEMBERS", label: "Kick Members", bit: PERMISSIONS.KICK_MEMBERS },
  { key: "BAN_MEMBERS", label: "Ban Members", bit: PERMISSIONS.BAN_MEMBERS },
  { key: "TIMEOUT_MEMBERS", label: "Timeout Members", bit: PERMISSIONS.TIMEOUT_MEMBERS },
  { key: "ADMINISTRATOR", label: "Administrator", bit: PERMISSIONS.ADMINISTRATOR }
];

const CHANNEL_PERMISSION_OPTIONS = [
  { key: "VIEW_CHANNELS", label: "View Channels", bit: PERMISSIONS.VIEW_CHANNELS },
  { key: "SEND_MESSAGES", label: "Send Messages", bit: PERMISSIONS.SEND_MESSAGES },
  { key: "READ_HISTORY", label: "Read History", bit: PERMISSIONS.READ_HISTORY },
  { key: "ATTACH_FILES", label: "Attach Files", bit: PERMISSIONS.ATTACH_FILES },
  { key: "VOICE_CONNECT", label: "Voice Connect", bit: PERMISSIONS.VOICE_CONNECT },
  { key: "VOICE_SPEAK", label: "Voice Speak", bit: PERMISSIONS.VOICE_SPEAK },
  { key: "SCREENSHARE", label: "Screenshare", bit: PERMISSIONS.SCREENSHARE }
];
const DEFAULT_CLIENT_SETTINGS = {
  audioInputId: "",
  audioOutputId: "",
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceMode: "voice_activity",
  pushToTalkKey: "KeyV",
  voiceActivationThreshold: 8,
  muteMicOnJoin: false,
  deafenOnJoin: false,
  autoReconnectCommunity: true
};

const VOICE_MODE_OPTIONS = [
  { value: "voice_activity", label: "Voice Activity" },
  { value: "push_to_talk", label: "Push to Talk" },
  { value: "continuous", label: "Always Transmit" }
];

const PUSH_TO_TALK_KEYS = [
  { value: "KeyV", label: "V" },
  { value: "ControlLeft", label: "Left Ctrl" },
  { value: "ControlRight", label: "Right Ctrl" },
  { value: "AltLeft", label: "Left Alt" },
  { value: "ShiftLeft", label: "Left Shift" },
  { value: "Space", label: "Space" }
];

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀"];

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures.
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage remove failures.
  }
}

function loadClientSettings() {
  try {
    const raw = safeStorageGet(CLIENT_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_CLIENT_SETTINGS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_CLIENT_SETTINGS };
    }
    const merged = {
      ...DEFAULT_CLIENT_SETTINGS,
      ...parsed
    };
    const mode = String(merged.voiceMode || DEFAULT_CLIENT_SETTINGS.voiceMode);
    if (!VOICE_MODE_OPTIONS.some((item) => item.value === mode)) {
      merged.voiceMode = DEFAULT_CLIENT_SETTINGS.voiceMode;
    }
    const pttKey = String(merged.pushToTalkKey || DEFAULT_CLIENT_SETTINGS.pushToTalkKey);
    if (!PUSH_TO_TALK_KEYS.some((item) => item.value === pttKey)) {
      merged.pushToTalkKey = DEFAULT_CLIENT_SETTINGS.pushToTalkKey;
    }
    const threshold = Number(merged.voiceActivationThreshold);
    merged.voiceActivationThreshold = Number.isFinite(threshold) ? Math.min(Math.max(Math.round(threshold), 1), 100) : 8;
    return merged;
  } catch {
    return { ...DEFAULT_CLIENT_SETTINGS };
  }
}

function loadVoiceVolumes() {
  try {
    const raw = safeStorageGet(VOICE_VOLUMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const normalized = {};
    for (const [userId, value] of Object.entries(parsed)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      normalized[userId] = Math.min(Math.max(Math.round(numeric), 0), 100);
    }
    return normalized;
  } catch {
    return {};
  }
}

function loadLastReadMessages() {
  try {
    const raw = safeStorageGet(LAST_READ_MESSAGES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveLastReadMessages(lastReadMessages) {
  try {
    safeStorageSet(LAST_READ_MESSAGES_KEY, JSON.stringify(lastReadMessages));
  } catch {
    // Ignore errors
  }
}

function loadMessageDrafts() {
  try {
    const raw = safeStorageGet(MESSAGE_DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveMessageDrafts(drafts) {
  try {
    safeStorageSet(MESSAGE_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // Ignore errors
  }
}

function dedupeServers(servers) {
  const unique = [];
  const seen = new Set();
  for (const server of servers) {
    if (!server?.url) continue;
    const key = server.url;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(server);
  }
  return unique;
}

function parseRemusAlias(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const patterns = [
    /^remus\(([^)]+)\)$/i,
    /^https?:\/\/remus\(([^)]+)\)\/?$/i,
    /^remus:\/\/([^/]+)$/i,
    /^remus:([^/]+)$/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim().toLowerCase();
    }
  }
  if (/^[a-z0-9-]{4,64}$/i.test(raw)) {
    return raw.toLowerCase();
  }
  return "";
}

function loadJoinedServers() {
  const defaults = sanitizeCommunityBase(getDefaultCommunityBase() || "");
  const legacy = sanitizeCommunityBase(safeStorageGet("remus_community_base") || "");

  try {
    const raw = safeStorageGet(JOINED_SERVERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const fromStorage = Array.isArray(parsed)
      ? parsed
          .map((item) => ({
            id: sanitizeCommunityBase(String(item?.id || item?.url || "")),
            url: sanitizeCommunityBase(String(item?.url || "")),
            name: String(item?.name || "").trim(),
            iconUrl: String(item?.iconUrl || "").trim(),
            code: String(item?.code || "").trim().toLowerCase(),
            displayUrl: String(item?.displayUrl || "").trim(),
            iceServers: Array.isArray(item?.iceServers) ? item.iceServers : []
          }))
          .filter((item) => item.id && item.url)
      : [];

    const migrated = [...fromStorage];
    for (const candidate of [legacy, defaults]) {
      if (!candidate) continue;
      if (!migrated.some((item) => item.url === candidate)) {
        migrated.push({
          id: candidate,
          url: candidate,
          name: ""
        });
      }
    }

    return dedupeServers(migrated);
  } catch {
    const fallback = [];
    for (const candidate of [legacy, defaults]) {
      if (!candidate) continue;
      fallback.push({
        id: candidate,
        url: candidate,
        name: ""
      });
    }
    return dedupeServers(fallback);
  }
}

function getInitialSelectedServerId(joinedServers) {
  const settings = loadClientSettings();
  if (!settings.autoReconnectCommunity) {
    return null;
  }

  const remembered = sanitizeCommunityBase(safeStorageGet(SELECTED_SERVER_KEY) || "");
  if (remembered && joinedServers.some((item) => item.id === remembered)) {
    return remembered;
  }

  return joinedServers[0]?.id || null;
}

function sanitizeSettingsForDevices(settings, inputs, outputs) {
  const next = { ...settings };
  if (next.audioInputId && !inputs.some((item) => item.deviceId === next.audioInputId)) {
    next.audioInputId = "";
  }
  if (next.audioOutputId && !outputs.some((item) => item.deviceId === next.audioOutputId)) {
    next.audioOutputId = "";
  }
  return next;
}

function settingsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function initials(input) {
  const text = (input || "").trim();
  if (!text) return "?";
  return text
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function sanitizeIceServers(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .filter((item) => item && typeof item === "object" && item.urls)
    .map((item) => ({
      urls: item.urls,
      username: item.username,
      credential: item.credential
    }));
}

function normalizeOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") {
    return { roles: {}, members: {} };
  }
  return {
    roles: overrides.roles && typeof overrides.roles === "object" ? overrides.roles : {},
    members: overrides.members && typeof overrides.members === "object" ? overrides.members : {}
  };
}

function computeMemberPermissions({ guild, member, channel }) {
  if (!guild || !member) return 0;
  const roles = Array.isArray(guild.roles) ? guild.roles : [];
  const everyoneId = guild.id;
  const roleIds = new Set([everyoneId, ...(member.roleIds || [])]);

  let perms = 0;
  for (const role of roles) {
    if (roleIds.has(role.id)) {
      perms |= role.permissions || 0;
    }
  }

  if (perms & PERMISSIONS.ADMINISTRATOR) {
    return Object.values(PERMISSIONS).reduce((mask, value) => mask | value, 0);
  }

  const applyOverrides = (overrides) => {
    const normalized = normalizeOverrides(overrides);
    const everyoneOverride = normalized.roles?.[everyoneId];
    if (everyoneOverride) {
      perms &= ~(everyoneOverride.deny || 0);
      perms |= everyoneOverride.allow || 0;
    }

    let roleAllow = 0;
    let roleDeny = 0;
    for (const roleId of roleIds) {
      if (roleId === everyoneId) continue;
      const override = normalized.roles?.[roleId];
      if (override) {
        roleAllow |= override.allow || 0;
        roleDeny |= override.deny || 0;
      }
    }
    perms &= ~roleDeny;
    perms |= roleAllow;

    const memberOverride = normalized.members?.[member.id];
    if (memberOverride) {
      perms &= ~(memberOverride.deny || 0);
      perms |= memberOverride.allow || 0;
    }
  };

  if (channel) {
    if (channel.categoryId) {
      const category = (guild.channels || []).find((entry) => entry.id === channel.categoryId);
      if (category?.permissionOverrides) {
        applyOverrides(category.permissionOverrides);
      }
    }
    if (channel.permissionOverrides) {
      applyOverrides(channel.permissionOverrides);
    }
  }

  if (member.timeoutUntil) {
    const until = new Date(member.timeoutUntil).getTime();
    if (!Number.isNaN(until) && Date.now() < until) {
      perms &= ~(PERMISSIONS.SEND_MESSAGES | PERMISSIONS.ATTACH_FILES | PERMISSIONS.VOICE_SPEAK | PERMISSIONS.SCREENSHARE);
    }
  }

  return perms;
}

function requestFullscreen(element) {
  if (!element) return;
  const handler =
    element.requestFullscreen ||
    element.webkitRequestFullscreen ||
    element.msRequestFullscreen ||
    element.mozRequestFullScreen;
  if (handler) {
    handler.call(element);
  }
}

function resolveAssetUrl(path) {
  if (!path) return "";
  try {
    return new URL(path, window.location.href).toString();
  } catch {
    return path;
  }
}

function withTokenQuery(url, token) {
  if (!url || !token) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("token", token);
    return parsed.toString();
  } catch {
    return url;
  }
}

function BrandLogo({ className = "", alt = "Remus logo" }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <span className={`brand-fallback ${className}`.trim()}>R</span>;
  }

  return (
    <img
      src={resolveAssetUrl("remus-logo.png")}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

function GuildIcon({ iconUrl, fallback, className = "" }) {
  const [failed, setFailed] = useState(false);

  if (!iconUrl || failed) {
    return <span className={`guild-initials ${className}`.trim()}>{fallback}</span>;
  }

  return (
    <img
      src={iconUrl}
      alt={fallback || "Server icon"}
      className={`guild-icon ${className}`.trim()}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
function StreamCard({ userLabel, stream, outputDeviceId, muted, volume }) {
  const mediaRef = useRef(null);
  const hasVideo = stream.getVideoTracks().length > 0;

  useEffect(() => {
    if (mediaRef.current) {
      mediaRef.current.srcObject = stream;
      mediaRef.current.muted = muted;
      mediaRef.current.volume = Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 1;
      mediaRef.current.playsInline = true;
      mediaRef.current.autoplay = true;
      mediaRef.current
        .play()
        .catch(() => {});
    }
  }, [muted, stream, volume]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !outputDeviceId || typeof media.setSinkId !== "function") {
      return;
    }
    media.setSinkId(outputDeviceId).catch(() => {});
  }, [outputDeviceId]);

  return (
    <div className="stream-card">
      <strong>{userLabel}</strong>
      {hasVideo ? (
        <button type="button" className="fullscreen-btn" onClick={() => requestFullscreen(mediaRef.current)}>
          Fullscreen
        </button>
      ) : null}
      {hasVideo ? (
        <video ref={mediaRef} autoPlay playsInline className="remote-video" />
      ) : (
        <>
          <audio ref={mediaRef} autoPlay />
          <p className="audio-only">Audio stream active</p>
        </>
      )}
    </div>
  );
}

function AuthView({ mode, setMode, form, setForm, onSubmit, onRecover, error }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">
          <BrandLogo className="auth-logo" />
          <span>Remus</span>
        </h1>
        <p>Self-hostable, secure, and always free chat built for communities.</p>
        <form onSubmit={onSubmit}>
          <label htmlFor="loginName">Secret Username</label>
          <input
            id="loginName"
            value={form.loginName}
            onChange={(event) => setForm((prev) => ({ ...prev, loginName: event.target.value }))}
            placeholder="Only you know this"
            autoComplete="username"
            required
          />

          {mode === "register" ? (
            <>
              <label htmlFor="loginNameConfirm">Confirm Secret Username</label>
              <input
                id="loginNameConfirm"
                value={form.loginNameConfirm}
                onChange={(event) => setForm((prev) => ({ ...prev, loginNameConfirm: event.target.value }))}
                placeholder="Re-enter secret username"
                autoComplete="off"
                required
              />

              <label htmlFor="displayName">Display Name</label>
              <input
                id="displayName"
                value={form.displayName}
                onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
                placeholder="Name shown to others"
                autoComplete="nickname"
                required
              />
            </>
          ) : null}

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            placeholder="Enter password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />

          {mode === "register" ? (
            <>
              <label htmlFor="passwordConfirm">Confirm Password</label>
              <input
                id="passwordConfirm"
                type="password"
                value={form.passwordConfirm}
                onChange={(event) => setForm((prev) => ({ ...prev, passwordConfirm: event.target.value }))}
                placeholder="Re-enter password"
                autoComplete="new-password"
                required
              />
            </>
          ) : null}

          <button type="submit">{mode === "login" ? "Login" : "Create Account"}</button>
        </form>

        <div className="auth-switch">
          <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Need an account? Register" : "Already have an account? Login"}
          </button>
        </div>

        {mode === "login" ? (
          <div className="auth-switch">
            <button type="button" className="link-btn" onClick={onRecover}>
              Forgot password? Use recovery key
            </button>
          </div>
        ) : null}

        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </div>
  );
}

export default function App() {
  const configuredAuthBase = getConfiguredAuthBase();
  const [resolvedAuthBase, setResolvedAuthBase] = useState(() => sanitizeCommunityBase(getConfiguredAuthBase() || ""));
  const authBase = getAuthBase();
  const [backendStatus, setBackendStatus] = useState("checking");
  const [backendError, setBackendError] = useState("");
  const [backendSettingsOpen, setBackendSettingsOpen] = useState(false);
  const [backendSettingsValue, setBackendSettingsValue] = useState(() => sanitizeCommunityBase(getConfiguredAuthBase() || ""));
  const [backendSettingsError, setBackendSettingsError] = useState("");
  const [token, setToken] = useState(() => safeStorageGet("remus_token") || "");
  const [joinedServers, setJoinedServers] = useState(() => loadJoinedServers());
  const [selectedServerId, setSelectedServerId] = useState(() => getInitialSelectedServerId(loadJoinedServers()));
  const [addServerOpen, setAddServerOpen] = useState(false);
  const [addServerUrl, setAddServerUrl] = useState("");
  const [addServerBusy, setAddServerBusy] = useState(false);
  const [addServerError, setAddServerError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    loginName: "",
    loginNameConfirm: "",
    displayName: "",
    password: "",
    passwordConfirm: ""
  });
  const [authError, setAuthError] = useState("");

  const [user, setUser] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [communityStatus, setCommunityStatus] = useState("disconnected");
  const [communityConnectVersion, setCommunityConnectVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clientSettings, setClientSettings] = useState(() => loadClientSettings());
  const [settingsDraft, setSettingsDraft] = useState(() => loadClientSettings());
  const [settingsNotice, setSettingsNotice] = useState("");
  const [requestingAudioPermission, setRequestingAudioPermission] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameNotice, setNicknameNotice] = useState("");
  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [audioDevicesError, setAudioDevicesError] = useState("");
  const [micTestActive, setMicTestActive] = useState(false);
  const [micTestError, setMicTestError] = useState("");
  const [micMonitorActive, setMicMonitorActive] = useState(false);
  const [supportsOutputSelection, setSupportsOutputSelection] = useState(
    () => typeof HTMLMediaElement !== "undefined" && typeof HTMLMediaElement.prototype.setSinkId === "function"
  );
  const [screenPickerOpen, setScreenPickerOpen] = useState(false);
  const [screenSources, setScreenSources] = useState([]);
  const [screenPickerError, setScreenPickerError] = useState("");
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [passwordResetForm, setPasswordResetForm] = useState({ password: "", confirm: "" });
  const [passwordResetError, setPasswordResetError] = useState("");
  const [recoveryKeyOpen, setRecoveryKeyOpen] = useState(false);
  const [recoveryKeyValue, setRecoveryKeyValue] = useState("");
  const [recoveryKeyNotice, setRecoveryKeyNotice] = useState("");
  const [accountRecoveryOpen, setAccountRecoveryOpen] = useState(false);
  const [accountRecoveryForm, setAccountRecoveryForm] = useState({
    loginName: "",
    recoveryKey: "",
    password: "",
    confirm: ""
  });
  const [accountRecoveryError, setAccountRecoveryError] = useState("");
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [serverSettingsTab, setServerSettingsTab] = useState("roles");
  const [rolesState, setRolesState] = useState([]);
  const [membersState, setMembersState] = useState([]);
  const [auditState, setAuditState] = useState([]);
  const [serverSettingsState, setServerSettingsState] = useState({ auditMaxEntries: 2000, timeoutMaxMinutes: 10080 });
  const [serverSettingsError, setServerSettingsError] = useState("");
  const [roleDraft, setRoleDraft] = useState(null);
  const [roleDraftError, setRoleDraftError] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);
  const [memberActionBusy, setMemberActionBusy] = useState({});
  const [memberTimeoutDraft, setMemberTimeoutDraft] = useState({});
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false);
  const [channelSettingsChannel, setChannelSettingsChannel] = useState(null);
  const [channelNameDraft, setChannelNameDraft] = useState("");
  const [channelCategoryDraft, setChannelCategoryDraft] = useState("");
  const [channelOverridesDraft, setChannelOverridesDraft] = useState({ roles: {}, members: {} });
  const [channelRoleTarget, setChannelRoleTarget] = useState("");
  const [channelMemberTarget, setChannelMemberTarget] = useState("");
  const [channelSettingsError, setChannelSettingsError] = useState("");

  const [guilds, setGuilds] = useState([]);
  const [selectedGuildId, setSelectedGuildId] = useState(null);
  const [channels, setChannels] = useState([]);
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [lastReadMessages, setLastReadMessages] = useState(() => loadLastReadMessages());
  const [unreadChannels, setUnreadChannels] = useState(new Set());

  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [compose, setCompose] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [toastNotifications, setToastNotifications] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingContent, setEditingContent] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(null);

  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState("text");
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [channelMenu, setChannelMenu] = useState({ open: false, x: 0, y: 0 });
  const [channelContextMenu, setChannelContextMenu] = useState({ open: false, x: 0, y: 0, channel: null });
  const [voiceVolumes, setVoiceVolumes] = useState(() => loadVoiceVolumes());
  const [voiceVolumeMenu, setVoiceVolumeMenu] = useState({ open: false, x: 0, y: 0, userId: "", name: "" });
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: "", message: "", onConfirm: null, confirmText: "Confirm", cancelText: "Cancel", danger: false });

  const [joinedVoiceChannelId, setJoinedVoiceChannelId] = useState(null);
  const [voiceParticipants, setVoiceParticipants] = useState([]);
  const [speakingUsers, setSpeakingUsers] = useState({});
  const [voiceChannelState, setVoiceChannelState] = useState({});
  const [inputLevelPercent, setInputLevelPercent] = useState(0);
  const [voiceUsernames, setVoiceUsernames] = useState({});
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [screenStreams, setScreenStreams] = useState([]);
  const [activeScreenShareUserId, setActiveScreenShareUserId] = useState(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenPreviewStream, setScreenPreviewStream] = useState(null);
  const [serverDeafened, setServerDeafened] = useState(false);

  const screenPreviewRef = useRef(null);
  const messageSearchRef = useRef(null);
  const messageListRef = useRef(null);
  const socketRef = useRef(null);
  const socketIdRef = useRef(null);
  const selectedGuildIdRef = useRef(null);
  const selectedChannelIdRef = useRef(null);
  const joinedVoiceChannelRef = useRef(null);
  const selectedServerIdRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const dragChannelRef = useRef(null);

  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const producersRef = useRef(new Map());
  const consumersRef = useRef(new Map());
  const consumerInfoRef = useRef(new Map());
  const producerConsumersRef = useRef(new Map());
  const pendingProducersRef = useRef([]);
  const remoteStreamsRef = useRef(new Map());
  const screenStreamsRef = useRef(new Map());
  const localAudioStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const localSpeakingRef = useRef(false);
  const localDetectedSpeechRef = useRef(false);
  const pushToTalkPressedRef = useRef(false);
  const lastInputLevelRef = useRef(0);
  const monitorIntervalRef = useRef(null);
  const monitorAudioContextRef = useRef(null);
  const monitorSourceRef = useRef(null);
  const monitorAnalyserRef = useRef(null);
  const monitorDataRef = useRef(null);
  const monitorStreamRef = useRef(null);
  const micTestStreamRef = useRef(null);
  const clientSettingsRef = useRef(clientSettings);
  const serverMuteRef = useRef(false);
  const voiceJoinAudioRef = useRef(null);
  const voiceLeaveAudioRef = useRef(null);
  const voiceSoundUrlsRef = useRef({ join: "", leave: "" });
  const soundUnlockedRef = useRef(false);
  const audioContextRef = useRef(null);
  const soundBuffersRef = useRef({ join: null, leave: null });
  const soundBuffersLoadedRef = useRef(false);
  const soundBuffersErrorRef = useRef("");
  const voicePresenceRef = useRef({ channelId: null, userIds: new Set(), initialized: false });
  const openConfirmDialog = useCallback((options) => {
    setConfirmDialog({
      open: true,
      title: options.title || "Confirm Action",
      message: options.message || "Are you sure?",
      onConfirm: options.onConfirm,
      confirmText: options.confirmText || "Confirm",
      cancelText: options.cancelText || "Cancel",
      danger: options.danger !== undefined ? options.danger : true
    });
  }, []);

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog({ open: false, title: "", message: "", onConfirm: null, confirmText: "Confirm", cancelText: "Cancel", danger: false });
  }, []);

  const handleConfirmAction = useCallback(() => {
    if (confirmDialog.onConfirm) {
      confirmDialog.onConfirm();
    }
    closeConfirmDialog();
  }, [confirmDialog, closeConfirmDialog]);
  const selectedServer = useMemo(() => joinedServers.find((server) => server.id === selectedServerId) || null, [joinedServers, selectedServerId]);
  const communityBase = useMemo(() => selectedServer?.url || "", [selectedServer]);
  const serverDisplayUrl = useMemo(
    () => selectedServer?.code ? `remus(${selectedServer.code})` : selectedServer?.displayUrl || "",
    [selectedServer]
  );
  const selectedGuild = useMemo(() => guilds.find((guild) => guild.id === selectedGuildId) || null, [guilds, selectedGuildId]);
  const selectedChannel = useMemo(() => channels.find((channel) => channel.id === selectedChannelId) || null, [channels, selectedChannelId]);
  const currentMember = useMemo(() => selectedGuild?.members?.find((member) => member?.id === user?.id) || null, [selectedGuild, user]);

  const filteredMessages = useMemo(() => {
    if (!messageSearchQuery.trim()) return messages;
    const query = messageSearchQuery.toLowerCase();
    return messages.filter((msg) => {
      const content = msg.content?.toLowerCase() || "";
      const author = (msg.author?.username || msg.author?.nickname || "").toLowerCase();
      const attachments = msg.attachments?.map((att) => att.name?.toLowerCase() || "").join(" ") || "";
      return content.includes(query) || author.includes(query) || attachments.includes(query);
    });
  }, [messages, messageSearchQuery]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery || !selectedGuild?.members) return [];
    const query = mentionQuery.toLowerCase();
    return selectedGuild.members
      .filter((m) => m.username?.toLowerCase().includes(query) || m.displayName?.toLowerCase().includes(query))
      .slice(0, 5);
  }, [mentionQuery, selectedGuild]);

  // Persist last read messages to localStorage
  useEffect(() => {
    saveLastReadMessages(lastReadMessages);
  }, [lastReadMessages]);

  // Clear unread indicator when switching to a channel
  useEffect(() => {
    if (!selectedChannelId) return;

    setUnreadChannels((prev) => {
      if (!prev.has(selectedChannelId)) return prev;
      const next = new Set(prev);
      next.delete(selectedChannelId);
      return next;
    });

    // Mark channel as read
    if (selectedChannel?.type === "text" && messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      const channelKey = `${communityBase}:${selectedChannelId}`;
      setLastReadMessages((prev) => ({
        ...prev,
        [channelKey]: latestMessage.id
      }));
    }
  }, [selectedChannelId, selectedChannel, messages, communityBase]);

  useEffect(() => {
    const joinUrl = resolveAssetUrl("sounds/voice_join.wav");
    const leaveUrl = resolveAssetUrl("sounds/voice_leave.wav");
    voiceSoundUrlsRef.current = { join: joinUrl, leave: leaveUrl };

    const configure = (audio, url) => {
      if (!audio) return;
      if (audio.src !== url) {
        audio.src = url;
      }
      audio.preload = "auto";
      audio.volume = 0.6;
      audio.muted = false;
    };

    configure(voiceJoinAudioRef.current, joinUrl);
    configure(voiceLeaveAudioRef.current, leaveUrl);
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (Context) {
        audioContextRef.current = new Context();
      }
    }
    return audioContextRef.current;
  }, []);

  const loadSoundBuffer = useCallback(
    async (type, url) => {
      const ctx = ensureAudioContext();
      if (!ctx || !url) return;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(buffer);
        soundBuffersRef.current[type] = audioBuffer;
      } catch (error) {
        soundBuffersErrorRef.current = error?.message || "Failed to load sound.";
      }
    },
    [ensureAudioContext]
  );

  const unlockSounds = useCallback(async () => {
    if (soundUnlockedRef.current) return;

    try {
      const ctx = ensureAudioContext();
      if (ctx?.state === "suspended") {
        await ctx.resume();
      }
    } catch {}

    if (!soundBuffersLoadedRef.current) {
      soundBuffersLoadedRef.current = true;
      const { join, leave } = voiceSoundUrlsRef.current;
      await Promise.all([loadSoundBuffer("join", join), loadSoundBuffer("leave", leave)]);
    }

    const unlockElement = async (audio) => {
      if (!audio) return;
      const prevMuted = audio.muted;
      const prevVolume = audio.volume;
      audio.muted = true;
      audio.volume = 0;
      try {
        await audio.play();
        audio.pause();
      } catch {}
      audio.muted = prevMuted;
      audio.volume = prevVolume;
    };

    await unlockElement(voiceJoinAudioRef.current);
    await unlockElement(voiceLeaveAudioRef.current);
    soundUnlockedRef.current = true;
  }, [ensureAudioContext, loadSoundBuffer]);

  const playTestSound = useCallback(async () => {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      setSettingsNotice("Audio output test is not supported in this runtime.");
      return;
    }

    try {
      const ctx = new Context();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close().catch(() => {});
      }, 250);
      setSettingsNotice("Playing test sound.");
      setTimeout(() => setSettingsNotice(""), 1200);
    } catch {
      setSettingsNotice("Unable to play test sound.");
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      void unlockSounds();
    };
    window.addEventListener("pointerdown", handler);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
    };
  }, [unlockSounds]);

  useEffect(() => {
    const outputId = clientSettings.audioOutputId;
    if (!outputId) return;
    const applySink = (audio) => {
      if (audio && typeof audio.setSinkId === "function") {
        audio.setSinkId(outputId).catch(() => {});
      }
    };
    applySink(voiceJoinAudioRef.current);
    applySink(voiceLeaveAudioRef.current);
  }, [clientSettings.audioOutputId]);

  const basePermissions = useMemo(
    () => computeMemberPermissions({ guild: selectedGuild, member: currentMember, channel: null }),
    [currentMember, selectedGuild]
  );
  const selectedChannelPermissions = useMemo(
    () => (selectedChannel ? computeMemberPermissions({ guild: selectedGuild, member: currentMember, channel: selectedChannel }) : 0),
    [currentMember, selectedChannel, selectedGuild]
  );
  const canSendMessages = (selectedChannelPermissions & PERMISSIONS.SEND_MESSAGES) === PERMISSIONS.SEND_MESSAGES;
  const canManageMessages = (selectedChannelPermissions & PERMISSIONS.MANAGE_MESSAGES) === PERMISSIONS.MANAGE_MESSAGES;
  const canAttachFiles = (selectedChannelPermissions & PERMISSIONS.ATTACH_FILES) === PERMISSIONS.ATTACH_FILES;
  const canManageChannels = (basePermissions & PERMISSIONS.MANAGE_CHANNELS) === PERMISSIONS.MANAGE_CHANNELS;
  const canManageRoles = (basePermissions & PERMISSIONS.MANAGE_ROLES) === PERMISSIONS.MANAGE_ROLES;
  const canManageServer = (basePermissions & PERMISSIONS.MANAGE_SERVER) === PERMISSIONS.MANAGE_SERVER;
  const canViewAudit = (basePermissions & PERMISSIONS.VIEW_AUDIT_LOG) === PERMISSIONS.VIEW_AUDIT_LOG;
  const canKick = (basePermissions & PERMISSIONS.KICK_MEMBERS) === PERMISSIONS.KICK_MEMBERS;
  const canBan = (basePermissions & PERMISSIONS.BAN_MEMBERS) === PERMISSIONS.BAN_MEMBERS;
  const canTimeout = (basePermissions & PERMISSIONS.TIMEOUT_MEMBERS) === PERMISSIONS.TIMEOUT_MEMBERS;
  const canMuteMembers = (basePermissions & PERMISSIONS.VOICE_MUTE_MEMBERS) === PERMISSIONS.VOICE_MUTE_MEMBERS;
  const canDeafenMembers = (basePermissions & PERMISSIONS.VOICE_DEAFEN_MEMBERS) === PERMISSIONS.VOICE_DEAFEN_MEMBERS;
  const sortedRoles = useMemo(
    () => [...rolesState].sort((a, b) => (b.position || 0) - (a.position || 0)),
    [rolesState]
  );

  const checkBackend = useCallback(async () => {
    const candidates = [];
    const normalizedConfigured = sanitizeCommunityBase(configuredAuthBase || "");
    if (normalizedConfigured) candidates.push(normalizedConfigured);

    const storedBase = sanitizeCommunityBase(safeStorageGet("remus_auth_base") || "");
    if (storedBase) candidates.push(storedBase);

    const fallbackBases = [
      "http://api-remus.com:3001"
    ];
    for (const base of fallbackBases) {
      candidates.push(base);
    }

    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];

    if (!uniqueCandidates.length) {
      setBackendStatus("offline");
      setBackendError("Backend URL is not configured.");
      return;
    }

    setBackendStatus("checking");
    setBackendError("");

    let lastError = null;
    const isLocalBase = (base) => base.includes("localhost");

    for (const base of uniqueCandidates) {
      const controller = new AbortController();
      const timeoutMs = isLocalBase(base) ? 1500 : 5000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${base.replace(/\/$/, "")}/api/health`, {
          method: "GET",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Backend unavailable (HTTP ${response.status})`);
        }

        setAuthBase(base);
        safeStorageSet("remus_auth_base", base);
        setResolvedAuthBase(base);
        setBackendStatus("online");
        setBackendError("");
        clearTimeout(timeoutId);
        return;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    setBackendStatus("offline");
    const message = String(lastError?.message || "");
    if (lastError?.name === "AbortError" || message.toLowerCase().includes("aborted")) {
      setBackendError("Connection timed out. Backend did not respond.");
    } else if (message.toLowerCase().includes("failed to fetch")) {
      setBackendError("Unable to reach backend. Check network/firewall and URL.");
    } else {
      setBackendError(message || "Unable to reach backend.");
    }
  }, [configuredAuthBase]);

  const openBackendSettings = useCallback(() => {
    const current = sanitizeCommunityBase(resolvedAuthBase || configuredAuthBase || authBase || "");
    setBackendSettingsValue(current);
    setBackendSettingsError("");
    setBackendSettingsOpen(true);
  }, [authBase, configuredAuthBase, resolvedAuthBase]);

  const closeBackendSettings = useCallback(() => {
    setBackendSettingsOpen(false);
  }, []);

  const saveBackendSettings = useCallback(() => {
    const normalized = sanitizeCommunityBase(backendSettingsValue);
    if (!normalized) {
      setBackendSettingsError("Enter a backend URL.");
      return;
    }
    setAuthBase(normalized);
    safeStorageSet("remus_auth_base", normalized);
    setResolvedAuthBase(normalized);
    setBackendSettingsOpen(false);
    void checkBackend();
  }, [backendSettingsValue, checkBackend]);

  const refreshAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioDevicesError("Audio device discovery is not supported in this environment.");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((item) => item.kind === "audioinput");
      const outputs = devices.filter((item) => item.kind === "audiooutput");

      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      setAudioDevicesError("");
      setSupportsOutputSelection(typeof HTMLMediaElement !== "undefined" && typeof HTMLMediaElement.prototype.setSinkId === "function");
      setClientSettings((prev) => sanitizeSettingsForDevices(prev, inputs, outputs));
      setSettingsDraft((prev) => sanitizeSettingsForDevices(prev, inputs, outputs));
    } catch (error) {
      setAudioDevicesError(error.message || "Failed to load audio devices.");
    }
  }, []);

  const requestAudioPermissions = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioDevicesError("Microphone permission API is unavailable.");
      setSettingsNotice("");
      return;
    }

    try {
      setRequestingAudioPermission(true);
      setSettingsNotice("Requesting microphone permission...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      await refreshAudioDevices();
      setAudioDevicesError("");
      setSettingsNotice("Microphone access granted.");
    } catch (error) {
      setAudioDevicesError(error.message || "Microphone permission was denied.");
      setSettingsNotice("");
    } finally {
      setRequestingAudioPermission(false);
    }
  }, [refreshAudioDevices]);

  useEffect(() => {
    selectedGuildIdRef.current = selectedGuildId;
  }, [selectedGuildId]);

  useEffect(() => {
    selectedServerIdRef.current = selectedServerId;
  }, [selectedServerId]);

  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId;
  }, [selectedChannelId]);

  useEffect(() => {
    joinedVoiceChannelRef.current = joinedVoiceChannelId;
  }, [joinedVoiceChannelId]);

  useEffect(() => {
    clientSettingsRef.current = clientSettings;
  }, [clientSettings]);

  useEffect(() => {
    serverMuteRef.current = !!currentMember?.voiceMuted;
    setServerDeafened(!!currentMember?.voiceDeafened);
  }, [currentMember?.voiceDeafened, currentMember?.voiceMuted]);

  useEffect(() => {
    safeStorageSet(CLIENT_SETTINGS_KEY, JSON.stringify(clientSettings));
  }, [clientSettings]);

  useEffect(() => {
    safeStorageSet(JOINED_SERVERS_KEY, JSON.stringify(joinedServers));
  }, [joinedServers]);

  useEffect(() => {
    safeStorageSet(VOICE_VOLUMES_KEY, JSON.stringify(voiceVolumes));
  }, [voiceVolumes]);

  useEffect(() => {
    if (!settingsOpen) {
      setSettingsDraft(clientSettings);
    }
  }, [clientSettings, settingsOpen]);


  useEffect(() => {
    if (selectedServerId && !joinedServers.some((server) => server.id === selectedServerId)) {
      setSelectedServerId(joinedServers[0]?.id || null);
    }
  }, [joinedServers, selectedServerId]);

  useEffect(() => {
    if (clientSettings.autoReconnectCommunity && selectedServerId) {
      safeStorageSet(SELECTED_SERVER_KEY, selectedServerId);
    } else {
      safeStorageRemove(SELECTED_SERVER_KEY);
    }

    // Cleanup old single-server key after migration.
    safeStorageRemove("remus_community_base");
  }, [clientSettings.autoReconnectCommunity, selectedServerId]);

  useEffect(() => {
    if (screenPreviewRef.current) {
      const video = screenPreviewRef.current;
      video.srcObject = screenPreviewStream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      if (screenPreviewStream) {
        video.play().catch(() => {});
      }
    }
  }, [screenPreviewStream]);

  useEffect(() => {
    void checkBackend();
  }, [checkBackend]);

  useEffect(() => {
    if (!settingsOpen) return;
    void refreshAudioDevices();
  }, [refreshAudioDevices, settingsOpen]);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) {
      return undefined;
    }

    const onDeviceChange = () => {
      void refreshAudioDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [refreshAudioDevices]);

  const syncRemoteStreams = useCallback(() => {
    const values = [];
    for (const [userId, stream] of remoteStreamsRef.current.entries()) {
      values.push({ userId, stream });
    }
    setRemoteStreams(values);
  }, []);

  const syncScreenStreams = useCallback(() => {
    const values = [];
    for (const [userId, stream] of screenStreamsRef.current.entries()) {
      values.push({ userId, stream });
    }
    setScreenStreams(values);
  }, []);

  const socketRequest = useCallback((event, payload = {}) => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket) {
        reject(new Error("Socket is not connected."));
        return;
      }

      socket.timeout(10000).emit(event, payload, (error, response) => {
        if (error) {
          reject(new Error(error.message || "Request timed out."));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response || {});
      });
    });
  }, []);

  const setMicTrackEnabled = useCallback((enabled) => {
    if (!localAudioStreamRef.current) return;
    for (const track of localAudioStreamRef.current.getAudioTracks()) {
      track.enabled = !!enabled;
    }
  }, []);

  const playVoiceSound = useCallback((type) => {
    const ctx = ensureAudioContext();
    const buffer = soundBuffersRef.current[type];
    if (ctx && buffer) {
      try {
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        gain.gain.value = 0.6;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);
        return;
      } catch {}
    }

    let audio = type === "join" ? voiceJoinAudioRef.current : voiceLeaveAudioRef.current;
    if (!audio) {
      const fallbackUrl = type === "join" ? voiceSoundUrlsRef.current.join : voiceSoundUrlsRef.current.leave;
      if (!fallbackUrl) return;
      audio = new Audio(fallbackUrl);
      audio.volume = 0.6;
    }
    try {
      if (!soundUnlockedRef.current) {
        void unlockSounds();
      }
      if (audio.readyState === 0) {
        audio.load();
      }
      audio.currentTime = 0;
      const promise = audio.play();
      if (promise?.catch) {
        promise.catch(() => {});
      }
    } catch {}
  }, [ensureAudioContext, unlockSounds]);

  const updateVoicePresenceSounds = useCallback(
    (channelId, userIds) => {
      if (!channelId || channelId !== joinedVoiceChannelRef.current) return;
      const ref = voicePresenceRef.current;
      if (ref.channelId !== channelId) {
        ref.channelId = channelId;
        ref.userIds = new Set();
        ref.initialized = false;
      }

      const incoming = new Set((userIds || []).filter(Boolean));
      if (!ref.initialized) {
        ref.userIds = incoming;
        ref.initialized = true;
        return;
      }

      const me = socketIdRef.current || user?.id;
      let joined = false;
      let left = false;
      for (const id of incoming) {
        if (id !== me && !ref.userIds.has(id)) {
          joined = true;
        }
      }
      for (const id of ref.userIds) {
        if (id !== me && !incoming.has(id)) {
          left = true;
        }
      }

      if (joined) {
        playVoiceSound("join");
      }
      if (left) {
        playVoiceSound("leave");
      }

      ref.userIds = incoming;
    },
    [playVoiceSound, user?.id]
  );

  const emitLocalSpeaking = useCallback(
    (speaking) => {
      const nextSpeaking = !!speaking;
      if (localSpeakingRef.current === nextSpeaking) return;
      localSpeakingRef.current = nextSpeaking;

      const sessionId = socketIdRef.current;
      if (sessionId) {
        setSpeakingUsers((prev) => {
          const next = { ...prev };
          if (nextSpeaking) {
            next[sessionId] = true;
          } else {
            delete next[sessionId];
          }
          return next;
        });
      }

      const socket = socketRef.current;
      const channelId = joinedVoiceChannelRef.current;
      if (socket && channelId) {
        socket.emit("voice:speaking", { channelId, speaking: nextSpeaking });
      }
    },
    []
  );

  const recomputeTransmissionState = useCallback(
    (inputLevel = 0) => {
      const settings = clientSettingsRef.current;
      const threshold = Math.min(Math.max(Number(settings.voiceActivationThreshold || 8) / 200, 0.005), 1);
      const speakingDetected = inputLevel >= threshold;

      if (!localDetectedSpeechRef.current && speakingDetected) {
        localDetectedSpeechRef.current = true;
      } else if (localDetectedSpeechRef.current && inputLevel < threshold * 0.7) {
        localDetectedSpeechRef.current = false;
      }

      let transmit = true;
      if (settings.voiceMode === "push_to_talk") {
        transmit = pushToTalkPressedRef.current;
      } else if (settings.voiceMode === "voice_activity") {
        transmit = localDetectedSpeechRef.current;
      }

      if (serverMuteRef.current) {
        transmit = false;
      }

      setMicTrackEnabled(transmit);

      const speakingNow =
        settings.voiceMode === "voice_activity" ? localDetectedSpeechRef.current : transmit && speakingDetected;
      emitLocalSpeaking(speakingNow);
    },
    [emitLocalSpeaking, setMicTrackEnabled]
  );

  const stopLocalAudioMonitor = useCallback(() => {
    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }

    if (monitorSourceRef.current) {
      monitorSourceRef.current.disconnect();
      monitorSourceRef.current = null;
    }

    if (monitorAnalyserRef.current) {
      monitorAnalyserRef.current.disconnect();
      monitorAnalyserRef.current = null;
    }

    if (monitorAudioContextRef.current) {
      monitorAudioContextRef.current.close().catch(() => {});
      monitorAudioContextRef.current = null;
    }

    if (monitorStreamRef.current) {
      const monitorStream = monitorStreamRef.current;
      const isShared =
        monitorStream === localAudioStreamRef.current || monitorStream === micTestStreamRef.current;
      if (!isShared) {
        for (const track of monitorStream.getTracks()) {
          track.stop();
        }
      }
      monitorStreamRef.current = null;
    }

    monitorDataRef.current = null;
    lastInputLevelRef.current = 0;
    setInputLevelPercent(0);
    setMicMonitorActive(false);
    localDetectedSpeechRef.current = false;
    pushToTalkPressedRef.current = false;
    emitLocalSpeaking(false);
  }, [emitLocalSpeaking]);

  const startLocalAudioMonitor = useCallback(
    (stream) => {
      stopLocalAudioMonitor();

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx || !stream) {
        recomputeTransmissionState(0);
        return;
      }

      try {
        const ctx = new AudioCtx();
        const monitorStream = typeof stream.clone === "function" ? stream.clone() : stream;
        monitorStreamRef.current = monitorStream;
        const source = ctx.createMediaStreamSource(monitorStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);

        monitorAudioContextRef.current = ctx;
        monitorSourceRef.current = source;
        monitorAnalyserRef.current = analyser;
        const canUseFloat = typeof analyser.getFloatTimeDomainData === "function";
        monitorDataRef.current = canUseFloat ? new Float32Array(analyser.fftSize) : new Uint8Array(analyser.fftSize);
        setMicMonitorActive(true);

        monitorIntervalRef.current = setInterval(() => {
          if (!monitorAnalyserRef.current || !monitorDataRef.current) return;
          const data = monitorDataRef.current;
          if (data instanceof Float32Array) {
            monitorAnalyserRef.current.getFloatTimeDomainData(data);
          } else {
            monitorAnalyserRef.current.getByteTimeDomainData(data);
          }

          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const normalized = data instanceof Float32Array ? data[i] : (data[i] - 128) / 128;
            sum += normalized * normalized;
          }
          const rms = Math.sqrt(sum / data.length);
          const rawLevel = Math.min(Math.max(rms * 12, 0), 1);
          const smoothLevel = Math.min(Math.max(lastInputLevelRef.current * 0.65 + rawLevel * 0.35, 0), 1);
          lastInputLevelRef.current = smoothLevel;
          setInputLevelPercent(Math.round(smoothLevel * 100));
          recomputeTransmissionState(smoothLevel);
        }, 80);

        recomputeTransmissionState(0);
      } catch {
        recomputeTransmissionState(0);
      }
    },
    [recomputeTransmissionState, stopLocalAudioMonitor]
  );

  const stopMicTest = useCallback(() => {
    if (micTestStreamRef.current) {
      for (const track of micTestStreamRef.current.getTracks()) {
        track.stop();
      }
      micTestStreamRef.current = null;
    }
    setMicTestActive(false);
    setMicTestError("");

    if (!joinedVoiceChannelRef.current) {
      stopLocalAudioMonitor();
    }
  }, [stopLocalAudioMonitor]);

  const startMicTest = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicTestError("Microphone permission API is unavailable.");
      setMicTestActive(false);
      return;
    }

    setMicTestError("");

    if (joinedVoiceChannelRef.current && localAudioStreamRef.current) {
      setMicTestActive(true);
      return;
    }

    try {
      const audioConstraints = {
        echoCancellation: !!settingsDraft.echoCancellation,
        noiseSuppression: !!settingsDraft.noiseSuppression,
        autoGainControl: !!settingsDraft.autoGainControl
      };

      if (settingsDraft.audioInputId) {
        audioConstraints.deviceId = { exact: settingsDraft.audioInputId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });

      micTestStreamRef.current = stream;
      setMicTestActive(true);
      startLocalAudioMonitor(stream);
    } catch (error) {
      setMicTestError(error.message || "Unable to access microphone.");
      setMicTestActive(false);
    }
  }, [settingsDraft, startLocalAudioMonitor]);

  useEffect(() => {
    if (!settingsOpen && micTestStreamRef.current) {
      stopMicTest();
    }
  }, [settingsOpen, stopMicTest]);

  const removeRemoteTrack = useCallback(
    (peerId, track, kind) => {
      if (kind === "screen") {
        const stream = screenStreamsRef.current.get(peerId);
        if (!stream) return;
        stream.removeTrack(track);
        if (stream.getTracks().length === 0) {
          screenStreamsRef.current.delete(peerId);
        }
        syncScreenStreams();
        return;
      }

      const stream = remoteStreamsRef.current.get(peerId);
      if (!stream) return;
      stream.removeTrack(track);
      if (stream.getTracks().length === 0) {
        remoteStreamsRef.current.delete(peerId);
      }
      syncRemoteStreams();
    },
    [syncRemoteStreams, syncScreenStreams]
  );

  const closeConsumerById = useCallback(
    (consumerId) => {
      const consumer = consumersRef.current.get(consumerId);
      if (!consumer) return;

      const info = consumerInfoRef.current.get(consumerId);
      if (info?.peerId) {
        removeRemoteTrack(info.peerId, consumer.track, info?.kind);
      }

      consumersRef.current.delete(consumerId);
      consumerInfoRef.current.delete(consumerId);

      if (info?.producerId) {
        const set = producerConsumersRef.current.get(info.producerId);
        if (set) {
          set.delete(consumerId);
          if (set.size === 0) {
            producerConsumersRef.current.delete(info.producerId);
          }
        }
      }

      try {
        consumer.close();
      } catch {}
    },
    [removeRemoteTrack]
  );

  const closeConsumersForProducer = useCallback(
    (producerId) => {
      const set = producerConsumersRef.current.get(producerId);
      if (!set) return;
      for (const consumerId of [...set]) {
        closeConsumerById(consumerId);
      }
    },
    [closeConsumerById]
  );

  const closeMediasoupSession = useCallback(() => {
    for (const consumerId of consumersRef.current.keys()) {
      closeConsumerById(consumerId);
    }
    consumersRef.current.clear();
    consumerInfoRef.current.clear();
    producerConsumersRef.current.clear();
    pendingProducersRef.current = [];

    for (const producer of producersRef.current.values()) {
      try {
        producer.close();
      } catch {}
    }
    producersRef.current.clear();

    if (sendTransportRef.current) {
      try {
        sendTransportRef.current.close();
      } catch {}
      sendTransportRef.current = null;
    }

    if (recvTransportRef.current) {
      try {
        recvTransportRef.current.close();
      } catch {}
      recvTransportRef.current = null;
    }

    deviceRef.current = null;
    remoteStreamsRef.current.clear();
    setRemoteStreams([]);
    screenStreamsRef.current.clear();
    setScreenStreams([]);
    setActiveScreenShareUserId(null);
  }, [closeConsumerById]);

  const ensureMediasoup = useCallback(
    async (channelId) => {
      const socket = socketRef.current;
      if (!socket) {
        throw new Error("Socket is not connected.");
      }

      console.log(`[ensureMediasoup] Starting mediasoup setup for channel ${channelId}`);
      let device = deviceRef.current;
      if (!device) {
        console.log(`[ensureMediasoup] Requesting RTP capabilities...`);
        const { rtpCapabilities } = await socketRequest("voice:getRouterRtpCapabilities", { channelId });
        console.log(`[ensureMediasoup] Creating and loading mediasoup Device...`);
        device = new Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        deviceRef.current = device;
        console.log(`[ensureMediasoup] Device loaded successfully`);
      }

      if (!sendTransportRef.current) {
        console.log(`[ensureMediasoup] Creating send transport...`);
        const params = await socketRequest("voice:createSendTransport", { channelId });
        console.log(`[ensureMediasoup] Send transport params received:`, params);
        const transport = device.createSendTransport(params);
        console.log(`[ensureMediasoup] Send transport created`);

        transport.on("connect", ({ dtlsParameters }, callback, errback) => {
          socketRequest("voice:connectTransport", { channelId, transportId: transport.id, dtlsParameters })
            .then(() => callback())
            .catch((error) => {
              setStatusError(error?.message || "Voice transport connection failed.");
              errback(error);
            });
        });

        transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
          socketRequest("voice:produce", {
            channelId,
            transportId: transport.id,
            kind,
            rtpParameters,
            appData
          })
            .then(({ id }) => callback({ id }))
            .catch((error) => errback(error));
        });

        transport.on("connectionstatechange", (state) => {
          if (state === "failed") {
            setStatusError("Voice transport connection failed.");
          }
        });

        sendTransportRef.current = transport;
      }

      if (!recvTransportRef.current) {
        console.log(`[ensureMediasoup] Creating receive transport...`);
        const params = await socketRequest("voice:createRecvTransport", { channelId });
        console.log(`[ensureMediasoup] Receive transport params received:`, params);
        const transport = device.createRecvTransport(params);
        console.log(`[ensureMediasoup] Receive transport created`);

        transport.on("connect", ({ dtlsParameters }, callback, errback) => {
          socketRequest("voice:connectTransport", { channelId, transportId: transport.id, dtlsParameters })
            .then(() => callback())
            .catch((error) => {
              setStatusError(error?.message || "Voice receive transport connection failed.");
              errback(error);
            });
        });

        transport.on("connectionstatechange", (state) => {
          if (state === "failed") {
            setStatusError("Voice receive transport connection failed.");
          }
        });

        recvTransportRef.current = transport;
      }
    },
    [socketRequest]
  );

  const startAudioProducer = useCallback(
    async (stream) => {
      const transport = sendTransportRef.current;
      if (!transport) return;
      if (producersRef.current.get("audio")) return;

      const [track] = stream.getAudioTracks();
      if (!track) return;

      const producer = await transport.produce({
        track,
        appData: { type: "audio" }
      });

      producersRef.current.set("audio", producer);

      producer.on("trackended", () => {
        if (socketRef.current) {
          socketRef.current.emit("voice:closeProducer", { producerId: producer.id, channelId: joinedVoiceChannelRef.current });
        }
        producersRef.current.delete("audio");
      });

      producer.on("transportclose", () => {
        producersRef.current.delete("audio");
      });
    },
    []
  );

  const consumeProducer = useCallback(
    async ({ producerId, peerId, kind, appData }) => {
      if (!producerId || !peerId) return;
      if (peerId === socketIdRef.current) return;

      const device = deviceRef.current;
      const transport = recvTransportRef.current;
      if (!device || !transport) {
        pendingProducersRef.current.push({ producerId, peerId, kind, appData });
        return;
      }

      try {
        const response = await socketRequest("voice:consume", {
          channelId: joinedVoiceChannelRef.current,
          producerId,
          transportId: transport.id,
          rtpCapabilities: device.rtpCapabilities
        });

        const finalKind = response.kind || kind;
        const finalAppData = response.appData || appData;
        const finalPeerId = response.peerId || peerId;
        const finalUserId = finalAppData?.userId;

        const consumer = await transport.consume({
          id: response.id,
          producerId,
          kind: finalKind,
          rtpParameters: response.rtpParameters,
          appData: finalAppData
        });

        consumersRef.current.set(consumer.id, consumer);
        const appType = finalAppData?.type || consumer.appData?.type || "";
        const kindTag = finalKind === "video" && appType === "screen" ? "screen" : finalKind;
        consumerInfoRef.current.set(consumer.id, {
          producerId,
          peerId: finalPeerId,
          userId: finalUserId,
          kind: kindTag
        });

        const set = producerConsumersRef.current.get(producerId) || new Set();
        set.add(consumer.id);
        producerConsumersRef.current.set(producerId, set);

        if (kindTag === "screen") {
          const stream = screenStreamsRef.current.get(finalPeerId) || new MediaStream();
          stream.addTrack(consumer.track);
          screenStreamsRef.current.set(finalPeerId, stream);
          syncScreenStreams();
        } else {
          const stream = remoteStreamsRef.current.get(finalPeerId) || new MediaStream();
          stream.addTrack(consumer.track);
          remoteStreamsRef.current.set(finalPeerId, stream);
          syncRemoteStreams();
        }

        consumer.on("transportclose", () => {
          closeConsumerById(consumer.id);
        });

        consumer.on("producerclose", () => {
          closeConsumerById(consumer.id);
        });

        await socketRequest("voice:resumeConsumer", {
          channelId: joinedVoiceChannelRef.current,
          consumerId: consumer.id
        });
      } catch (error) {
        setStatusError(error.message || "Failed to consume media.");
      }
    },
    [closeConsumerById, socketRequest, syncRemoteStreams, syncScreenStreams]
  );

  useEffect(() => {
    const isPushToTalk = clientSettings.voiceMode === "push_to_talk";
    if (!isPushToTalk) {
      pushToTalkPressedRef.current = false;
      recomputeTransmissionState(lastInputLevelRef.current);
      return undefined;
    }

    const isEditable = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
    };

    const onKeyDown = (event) => {
      if (event.code !== clientSettings.pushToTalkKey) return;
      if (isEditable(event.target)) return;
      if (!pushToTalkPressedRef.current) {
        pushToTalkPressedRef.current = true;
        recomputeTransmissionState(lastInputLevelRef.current);
      }
      event.preventDefault();
    };

    const onKeyUp = (event) => {
      if (event.code !== clientSettings.pushToTalkKey) return;
      if (pushToTalkPressedRef.current) {
        pushToTalkPressedRef.current = false;
        recomputeTransmissionState(lastInputLevelRef.current);
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      pushToTalkPressedRef.current = false;
      recomputeTransmissionState(lastInputLevelRef.current);
    };
  }, [clientSettings.pushToTalkKey, clientSettings.voiceMode, recomputeTransmissionState]);

  useEffect(() => {
    if (!joinedVoiceChannelRef.current || !localAudioStreamRef.current) return;
    recomputeTransmissionState(lastInputLevelRef.current);
  }, [clientSettings.voiceActivationThreshold, clientSettings.voiceMode, recomputeTransmissionState]);

  const leaveVoiceChannel = useCallback((options = {}) => {
    const { suppressSound = false } = options;
    const socket = socketRef.current;
    const leavingChannelId = joinedVoiceChannelRef.current;
    const leavingUserId = socketIdRef.current;
    if (socket && leavingChannelId) {
      socket.emit("voice:leave");
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    closeMediasoupSession();

    stopLocalAudioMonitor();

    if (localAudioStreamRef.current) {
      for (const track of localAudioStreamRef.current.getTracks()) {
        track.stop();
      }
      localAudioStreamRef.current = null;
    }

    if (screenStreamRef.current) {
      for (const track of screenStreamRef.current.getTracks()) {
        track.stop();
      }
      screenStreamRef.current = null;
    }

    setScreenPreviewStream(null);
    setIsScreenSharing(false);
    setVoiceParticipants([]);
    setSpeakingUsers({});
    setJoinedVoiceChannelId(null);
    joinedVoiceChannelRef.current = null;
    voicePresenceRef.current = { channelId: null, userIds: new Set(), initialized: false };
    if (leavingChannelId && !suppressSound) {
      playVoiceSound("leave");
    }
    if (leavingChannelId && leavingUserId) {
      setVoiceChannelState((prev) => {
        const entry = prev[leavingChannelId];
        if (!entry) return prev;
        const userIds = (entry.userIds || []).filter((id) => id !== leavingUserId);
        const users = (entry.users || []).filter((item) => item?.id !== leavingUserId);
        const speakingUserIds = (entry.speakingUserIds || []).filter((id) => id !== leavingUserId);
        const next = { ...prev };
        if (!userIds.length && !users.length) {
          delete next[leavingChannelId];
          return next;
        }
        next[leavingChannelId] = {
          userIds,
          users,
          speakingUserIds
        };
        return next;
      });
    }
  }, [playVoiceSound, stopLocalAudioMonitor]);

  const stopScreenShare = useCallback(async () => {
    const screenStream = screenStreamRef.current;
    if (!screenStream) return;

    screenStreamRef.current = null;
    setIsScreenSharing(false);
    setScreenPreviewStream(null);

    for (const track of screenStream.getTracks()) {
      track.stop();
    }

    const screenProducer = producersRef.current.get("screen");
    if (screenProducer) {
      try {
        screenProducer.close();
      } catch {}
      producersRef.current.delete("screen");
      if (socketRef.current && joinedVoiceChannelRef.current) {
        socketRef.current.emit("voice:closeProducer", {
          producerId: screenProducer.id,
          channelId: joinedVoiceChannelRef.current
        });
      }
    }

    const screenAudioProducer = producersRef.current.get("screenAudio");
    if (screenAudioProducer) {
      try {
        screenAudioProducer.close();
      } catch {}
      producersRef.current.delete("screenAudio");
      if (socketRef.current && joinedVoiceChannelRef.current) {
        socketRef.current.emit("voice:closeProducer", {
          producerId: screenAudioProducer.id,
          channelId: joinedVoiceChannelRef.current
        });
      }
    }
    const sessionId = socketIdRef.current;
    if (sessionId && activeScreenShareUserId === sessionId) {
      setActiveScreenShareUserId(null);
    }
  }, [activeScreenShareUserId]);

  const startScreenShareWithStream = useCallback(
    async (stream) => {
      if (!stream) {
        setStatusError("Screensharing is not supported in this build.");
        return;
      }

      screenStreamRef.current = stream;
      setScreenPreviewStream(stream);
      setIsScreenSharing(true);

      const [videoTrack] = stream.getVideoTracks();
      const [audioTrack] = stream.getAudioTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          void stopScreenShare();
        };
      }
      if (audioTrack) {
        audioTrack.onended = () => {
          void stopScreenShare();
        };
      }
      const transport = sendTransportRef.current;
      if (!transport) {
        setStatusError("Voice transport not ready yet.");
        return;
      }
      if (videoTrack) {
        const producer = await transport.produce({
          track: videoTrack,
          appData: { type: "screen" }
        });
        producersRef.current.set("screen", producer);
        const sessionId = socketIdRef.current;
        if (sessionId) {
          setActiveScreenShareUserId(sessionId);
        }
        producer.on("trackended", () => {
          void stopScreenShare();
        });
        producer.on("transportclose", () => {
          producersRef.current.delete("screen");
        });
      }

      if (audioTrack) {
        const audioProducer = await transport.produce({
          track: audioTrack,
          appData: { type: "screen-audio" }
        });
        producersRef.current.set("screenAudio", audioProducer);
        audioProducer.on("trackended", () => {
          void stopScreenShare();
        });
        audioProducer.on("transportclose", () => {
          producersRef.current.delete("screenAudio");
        });
      }
    },
    [stopScreenShare]
  );

  const startScreenShareFromSource = useCallback(
    async (sourceId) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
              maxFrameRate: 30
            }
          }
        });
        await startScreenShareWithStream(stream);
      } catch (error) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
                maxFrameRate: 30
              }
            }
          });
          await startScreenShareWithStream(stream);
        } catch (fallbackError) {
          setStatusError(fallbackError.message || "Could not start screenshare");
        }
      }
    },
    [startScreenShareWithStream]
  );

  const openScreenPicker = useCallback(async () => {
    if (!window.remusDesktop?.getScreenSources) {
      return false;
    }
    try {
      const sources = await window.remusDesktop.getScreenSources();
      if (!sources.length) {
        throw new Error("No screen sources available.");
      }
      setScreenSources(sources);
      setScreenPickerError("");
      setScreenPickerOpen(true);
      return true;
    } catch (error) {
      setScreenPickerError(error.message || "Unable to list screen sources.");
      return false;
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    if (!joinedVoiceChannelRef.current) {
      setStatusError("Join a voice channel before screensharing.");
      return;
    }

    if (screenStreamRef.current) {
      return;
    }

    const opened = await openScreenPicker();
    if (opened) {
      return;
    }

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screensharing is not supported in this build.");
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      await startScreenShareWithStream(stream);
    } catch (error) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });
        await startScreenShareWithStream(stream);
      } catch (fallbackError) {
        setStatusError(fallbackError.message || "Could not start screenshare");
      }
    }
  }, [openScreenPicker, startScreenShareWithStream]);

  const joinVoiceChannel = useCallback(
      async (channelId) => {
        console.log(`[joinVoiceChannel] Attempting to join voice channel ${channelId}`);
        if (!navigator.mediaDevices?.getUserMedia) {
          setStatusError("This browser does not support voice capture.");
          return;
        }

      if (!socketRef.current) {
        setStatusError("Socket is not connected.");
        return;
      }

      if (joinedVoiceChannelRef.current === channelId) {
        console.log(`[joinVoiceChannel] Already in channel ${channelId}`);
        return;
      }

      if (joinedVoiceChannelRef.current) {
        console.log(`[joinVoiceChannel] Leaving previous channel ${joinedVoiceChannelRef.current}`);
        leaveVoiceChannel({ suppressSound: true });
      }

        let stream;
        let joinedOk = false;
        try {
          if (micTestStreamRef.current) {
            stopMicTest();
          }

        const audioConstraints = {
          echoCancellation: !!clientSettings.echoCancellation,
          noiseSuppression: !!clientSettings.noiseSuppression,
          autoGainControl: !!clientSettings.autoGainControl
        };

        if (clientSettings.audioInputId) {
          audioConstraints.deviceId = { exact: clientSettings.audioInputId };
        }

        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false
        });

          localAudioStreamRef.current = stream;
          void refreshAudioDevices();

          console.log(`[joinVoiceChannel] Sending voice:join request to server...`);
          await socketRequest("voice:join", { channelId });
          joinedOk = true;
          console.log(`[joinVoiceChannel] Successfully joined on server side`);

          joinedVoiceChannelRef.current = channelId;
          setJoinedVoiceChannelId(channelId);
          setVoiceParticipants([]);
          setSpeakingUsers({});
          voicePresenceRef.current = { channelId, userIds: new Set(), initialized: false };

          startLocalAudioMonitor(stream);
          playVoiceSound("join");
          console.log(`[joinVoiceChannel] Starting WebRTC setup...`);
          await ensureMediasoup(channelId);
          console.log(`[joinVoiceChannel] WebRTC setup complete`);
          try {
            await startAudioProducer(stream);
          } catch (error) {
            console.error("Failed to start audio producer:", error);
            setStatusError(error?.message || "Unable to start voice transmission.");
          }

          try {
            const snapshot = await socketRequest("voice:snapshot", { guildId: selectedGuildId });
          if (Array.isArray(snapshot?.channels)) {
            const nextState = {};
            for (const entry of snapshot.channels) {
              if (entry?.channelId) {
                nextState[entry.channelId] = {
                  userIds: Array.isArray(entry.userIds) ? entry.userIds : [],
                  users: Array.isArray(entry.users) ? entry.users : [],
                  speakingUserIds: Array.isArray(entry.speakingUserIds) ? entry.speakingUserIds : []
                };
              }
            }
            setVoiceChannelState(nextState);
          }
        } catch {}

        if (pendingProducersRef.current.length) {
          const pending = [...pendingProducersRef.current];
          pendingProducersRef.current = [];
          for (const producer of pending) {
            await consumeProducer(producer);
          }
        }
        } catch (error) {
          console.error(`[joinVoiceChannel] Error during join:`, error);
          console.error(`[joinVoiceChannel] Error stack:`, error?.stack);
          if (joinedOk && socketRef.current) {
            console.log(`[joinVoiceChannel] Emitting voice:leave due to error after successful join`);
            socketRef.current.emit("voice:leave");
          }
          closeMediasoupSession();
          if (stream) {
            for (const track of stream.getTracks()) {
              track.stop();
            }
          }
        localAudioStreamRef.current = null;
        setVoiceParticipants([]);
        setSpeakingUsers({});
        setVoiceChannelState((prev) => {
          if (!channelId) return prev;
          const next = { ...prev };
          delete next[channelId];
          return next;
        });
        setJoinedVoiceChannelId(null);
        joinedVoiceChannelRef.current = null;
        setStatusError(error.message || "Unable to access microphone.");
      }
    },
    [
      clientSettings,
      consumeProducer,
      ensureMediasoup,
      leaveVoiceChannel,
      playVoiceSound,
      refreshAudioDevices,
      selectedGuildId,
      socketRequest,
      startAudioProducer,
      startLocalAudioMonitor,
      stopMicTest
    ]
  );

  const handleVoiceParticipants = useCallback(
    async ({ channelId, userIds = [], users = [], speakingUserIds = [] }) => {
      if (!channelId || channelId !== joinedVoiceChannelRef.current) return;

      if (users.length) {
        setVoiceUsernames((prev) => {
          const next = { ...prev };
          for (const user of users) {
            if (user?.id) {
              const label = user.nickname || user.username || next[user.id];
              if (label) {
                next[user.id] = label;
                if (user.userId) {
                  next[user.userId] = label;
                }
              }
            }
          }
          return next;
        });
      }

      const unique = [...new Set(userIds)];
      updateVoicePresenceSounds(channelId, unique);
      setVoiceParticipants(unique);
      setSpeakingUsers(() => {
        const next = {};
        for (const id of speakingUserIds || []) {
          if (id) next[id] = true;
        }
        const sessionId = socketIdRef.current;
        if (sessionId && localSpeakingRef.current) {
          next[sessionId] = true;
        }
        return next;
      });

      setVoiceChannelState((prev) => ({
        ...prev,
        [channelId]: {
          userIds: unique,
          users,
          speakingUserIds
        }
      }));

      // SFU handles media routing; no direct peer offers needed.
    },
    [updateVoicePresenceSounds]
  );

  const applyVoicePresence = useCallback((payload) => {
    const channelId = payload?.channelId;
    if (!channelId) return;
    const userIds = Array.isArray(payload.userIds) ? payload.userIds : [];
    const users = Array.isArray(payload.users) ? payload.users : [];
    const speakingUserIds = Array.isArray(payload.speakingUserIds) ? payload.speakingUserIds : [];

    if (users.length) {
      setVoiceUsernames((prev) => {
        const next = { ...prev };
        for (const user of users) {
          if (user?.id) {
            const label = user.nickname || user.username;
            if (label) {
              next[user.id] = label;
              if (user.userId) {
                next[user.userId] = label;
              }
            }
          }
        }
        return next;
      });
    }

    updateVoicePresenceSounds(channelId, userIds);
    setVoiceChannelState((prev) => ({
      ...prev,
      [channelId]: {
        userIds,
        users,
        speakingUserIds
      }
    }));
  }, [updateVoicePresenceSounds]);

  const openPasswordReset = useCallback(() => {
    setPasswordResetForm({ password: "", confirm: "" });
    setPasswordResetError("");
    setPasswordResetOpen(true);
  }, []);

  const closePasswordReset = useCallback(() => {
    setPasswordResetOpen(false);
    setPasswordResetForm({ password: "", confirm: "" });
    setPasswordResetError("");
  }, []);

  const handleLogout = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    leaveVoiceChannel();

    safeStorageRemove("remus_token");
    setToken("");
    setUser(null);
    setGuilds([]);
    setChannels([]);
    setMessages([]);
    setSelectedGuildId(null);
    setSelectedChannelId(null);
    setPendingAttachments([]);
    setTypingUsers({});
    setStatusError("");
    closePasswordReset();
  }, [closePasswordReset, leaveVoiceChannel]);

  const handleSelectServer = useCallback(
    (serverId) => {
      if (!serverId) return;
      setStatusError("");
      if (selectedServerId === serverId) {
        setCommunityConnectVersion((prev) => prev + 1);
      }
      setSelectedServerId(serverId);
    },
    [selectedServerId]
  );

  const openAddServerModal = useCallback(() => {
    setAddServerUrl("");
    setAddServerError("");
    setAddServerBusy(false);
    setAddServerOpen(true);
  }, []);

  const openCreateChannelModal = useCallback((type = "text") => {
    setNewChannelType(type);
    setNewChannelName("");
    setCreateChannelOpen(true);
  }, []);

  const closeCreateChannelModal = useCallback(() => {
    setCreateChannelOpen(false);
    setNewChannelName("");
  }, []);

  const closeScreenPicker = useCallback(() => {
    setScreenPickerOpen(false);
    setScreenSources([]);
    setScreenPickerError("");
  }, []);

  const openChannelMenu = useCallback(
    (event) => {
      event.preventDefault();
      if (!communityBase) {
        setStatusError("Connect to a community server before creating channels.");
        return;
      }
      if (!selectedGuildId) {
        setStatusError("Select a community before creating channels.");
        return;
      }
      if (!canManageChannels) {
        setStatusError("You do not have permission to manage channels.");
        return;
      }
      const menuWidth = 220;
      const menuHeight = 96;
      const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
      const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
      const x = Math.min(event.clientX, maxX);
      const y = Math.min(event.clientY, maxY);
      setChannelMenu({ open: true, x, y });
    },
    [canManageChannels, communityBase, selectedGuildId]
  );

  const openChannelContextMenu = useCallback(
    (event, channel) => {
      if (!canManageChannels || !channel) return;
      event.preventDefault();
      event.stopPropagation();
      const menuWidth = 220;
      const menuHeight = 110;
      const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
      const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
      const x = Math.min(event.clientX, maxX);
      const y = Math.min(event.clientY, maxY);
      setChannelContextMenu({ open: true, x, y, channel });
    },
    [canManageChannels]
  );

  const openVoiceVolumeMenu = useCallback((event, member) => {
    if (!member?.id) return;
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 260;
    const menuHeight = 140;
    const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
    const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
    const x = Math.min(event.clientX, maxX);
    const y = Math.min(event.clientY, maxY);
    setVoiceVolumeMenu({
      open: true,
      x,
      y,
      userId: member.id,
      name: member.name || `User ${String(member.id).slice(0, 6)}`
    });
  }, []);

  const closeChannelMenu = useCallback(() => {
    setChannelMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  const closeChannelContextMenu = useCallback(() => {
    setChannelContextMenu((prev) => (prev.open ? { ...prev, open: false, channel: null } : prev));
  }, []);

  const openChannelSettings = useCallback(
    (channel) => {
      if (!channel || !canManageChannels) return;
      setChannelSettingsChannel(channel);
      setChannelNameDraft(channel.name || "");
      setChannelCategoryDraft(channel.categoryId || "");
      setChannelOverridesDraft(channel.permissionOverrides || { roles: {}, members: {} });
      setChannelRoleTarget(selectedGuildId || "");
      setChannelMemberTarget("");
      setChannelSettingsError("");
      setChannelSettingsOpen(true);
    },
    [canManageChannels, selectedGuildId]
  );

  const deleteChannel = useCallback(
    (channel) => {
      if (!channel || !communityBase || !token) return;
      const label = channel.type === "category" ? "category" : "channel";
      openConfirmDialog({
        title: `Delete ${label}`,
        message: `Delete ${label} "${channel.name}"? This cannot be undone.`,
        confirmText: "Delete",
        danger: true,
        onConfirm: async () => {
          try {
            await apiCommunity(communityBase, `/api/channels/${channel.id}`, {
              token,
              method: "DELETE"
            });
            setStatusError("");
          } catch (error) {
            setStatusError(error.message || "Unable to delete channel.");
          }
        }
      });
    },
    [communityBase, token, openConfirmDialog]
  );

  const applyChannelUpdates = useCallback((updates) => {
    if (!updates.length) return;
    const updateMap = new Map(updates.map((item) => [item.id, item]));
    setChannels((prev) =>
      prev.map((channel) => {
        const update = updateMap.get(channel.id);
        if (!update) return channel;
        return {
          ...channel,
          categoryId: update.categoryId ?? channel.categoryId ?? null,
          position: Number.isInteger(update.position) ? update.position : channel.position
        };
      })
    );
  }, []);

  const submitChannelOrder = useCallback(
    async (updates) => {
      if (!updates.length || !selectedGuildId || !communityBase || !token) return;
      applyChannelUpdates(updates);
      try {
        await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/channels/order`, {
          token,
          method: "PATCH",
          body: { updates }
        });
        setStatusError("");
      } catch (error) {
        setStatusError(error.message || "Unable to reorder channels.");
      }
    },
    [applyChannelUpdates, communityBase, selectedGuildId, token]
  );

  const sortByPosition = useCallback((items) => {
    return [...items].sort((a, b) => {
      const posA = Number.isInteger(a.position) ? a.position : 0;
      const posB = Number.isInteger(b.position) ? b.position : 0;
      if (posA !== posB) return posA - posB;
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
  }, []);

  const buildChannelUpdatesForCategory = useCallback((categoryId, ids) => {
    const updates = [];
    ids.forEach((id, index) => {
      updates.push({ id, position: index + 1, categoryId });
    });
    return updates;
  }, []);

  const handleDragStart = useCallback(
    (event, channel) => {
      if (!canManageChannels || !channel) return;
      dragChannelRef.current = {
        id: channel.id,
        type: channel.type,
        categoryId: channel.categoryId || null
      };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", channel.id);
    },
    [canManageChannels]
  );

  const handleDragOver = useCallback(
    (event) => {
      if (!canManageChannels) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    [canManageChannels]
  );

  const handleDropOnCategory = useCallback(
    async (event, category) => {
      if (!canManageChannels) return;
      event.preventDefault();
      const drag = dragChannelRef.current;
      dragChannelRef.current = null;
      if (!drag || !drag.id) return;

      if (drag.type === "category") {
        if (!category || category.type !== "category" || drag.id === category.id) return;
        const categories = sortByPosition(channels.filter((channel) => channel.type === "category"));
        const ids = categories.map((item) => item.id);
        const fromIndex = ids.indexOf(drag.id);
        const targetIndex = ids.indexOf(category.id);
        if (fromIndex === -1 || targetIndex === -1) return;
        ids.splice(fromIndex, 1);
        ids.splice(targetIndex, 0, drag.id);
        await submitChannelOrder(buildChannelUpdatesForCategory(null, ids).map((item) => ({ ...item, categoryId: null })));
        return;
      }

      const targetCategoryId = category?.type === "category" ? category.id : null;
      if (category && category.type === "category" || category === null) {
        const currentCategoryId = drag.categoryId || null;
        const targetChannels = sortByPosition(
          channels.filter((channel) => channel.type !== "category" && (channel.categoryId || null) === targetCategoryId)
        );
        const targetIds = targetChannels.map((item) => item.id).filter((id) => id !== drag.id);
        targetIds.push(drag.id);

        const updates = buildChannelUpdatesForCategory(targetCategoryId, targetIds);
        if (currentCategoryId !== targetCategoryId) {
          const sourceChannels = sortByPosition(
            channels.filter((channel) => channel.type !== "category" && (channel.categoryId || null) === currentCategoryId)
          ).filter((item) => item.id !== drag.id);
          updates.push(...buildChannelUpdatesForCategory(currentCategoryId, sourceChannels.map((item) => item.id)));
        }
        await submitChannelOrder(updates);
      }
    },
    [buildChannelUpdatesForCategory, canManageChannels, channels, sortByPosition, submitChannelOrder]
  );

  const handleDropOnChannel = useCallback(
    async (event, targetChannel) => {
      if (!canManageChannels) return;
      event.preventDefault();
      const drag = dragChannelRef.current;
      dragChannelRef.current = null;
      if (!drag || !drag.id || !targetChannel) return;
      if (drag.type === "category") return;

      const targetCategoryId = targetChannel.categoryId || null;
      const currentCategoryId = drag.categoryId || null;

      const targetChannels = sortByPosition(
        channels.filter((channel) => channel.type !== "category" && (channel.categoryId || null) === targetCategoryId)
      );
      const ids = targetChannels.map((item) => item.id);
      const fromIndex = ids.indexOf(drag.id);
      if (fromIndex >= 0) ids.splice(fromIndex, 1);
      const targetIndex = ids.indexOf(targetChannel.id);
      if (targetIndex >= 0) {
        ids.splice(targetIndex, 0, drag.id);
      } else {
        ids.push(drag.id);
      }

      const updates = buildChannelUpdatesForCategory(targetCategoryId, ids);
      if (currentCategoryId !== targetCategoryId) {
        const sourceChannels = sortByPosition(
          channels.filter((channel) => channel.type !== "category" && (channel.categoryId || null) === currentCategoryId)
        ).filter((item) => item.id !== drag.id);
        updates.push(...buildChannelUpdatesForCategory(currentCategoryId, sourceChannels.map((item) => item.id)));
      }
      await submitChannelOrder(updates);
    },
    [buildChannelUpdatesForCategory, canManageChannels, channels, sortByPosition, submitChannelOrder]
  );

  const closeChannelSettings = useCallback(() => {
    setChannelSettingsOpen(false);
    setChannelSettingsChannel(null);
    setChannelSettingsError("");
  }, []);

  const updateOverride = useCallback((scope, targetId, bit, mode) => {
    setChannelOverridesDraft((prev) => {
      const next = { roles: { ...prev.roles }, members: { ...prev.members } };
      const bucket = scope === "members" ? next.members : next.roles;
      const entry = bucket[targetId] ? { ...bucket[targetId] } : { allow: 0, deny: 0 };
      if (mode === "allow") {
        entry.allow = entry.allow ^ bit;
        entry.deny = entry.deny & ~bit;
      } else if (mode === "deny") {
        entry.deny = entry.deny ^ bit;
        entry.allow = entry.allow & ~bit;
      }
      bucket[targetId] = entry;
      return next;
    });
  }, []);

  const clearOverride = useCallback((scope, targetId) => {
    setChannelOverridesDraft((prev) => {
      const next = { roles: { ...prev.roles }, members: { ...prev.members } };
      if (scope === "members") {
        delete next.members[targetId];
      } else {
        delete next.roles[targetId];
      }
      return next;
    });
  }, []);

  const saveChannelSettings = useCallback(async () => {
    if (!channelSettingsChannel || !token || !communityBase) return;
    setChannelSettingsError("");
    try {
      const data = await apiCommunity(communityBase, `/api/channels/${channelSettingsChannel.id}`, {
        token,
        method: "PATCH",
        body: {
          name: channelNameDraft.trim(),
          categoryId: channelCategoryDraft || null,
          permissionOverrides: channelOverridesDraft
        }
      });
      const updated = data.channel;
      setChannels((prev) => prev.map((channel) => (channel.id === updated.id ? updated : channel)));
      setChannelSettingsOpen(false);
    } catch (error) {
      setChannelSettingsError(error.message || "Failed to update channel.");
    }
  }, [channelCategoryDraft, channelNameDraft, channelOverridesDraft, channelSettingsChannel, communityBase, token]);

  const closeVoiceVolumeMenu = useCallback(() => {
    setVoiceVolumeMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  const handleRemoveServer = useCallback(() => {
    if (!selectedServerId) return;

    const current = joinedServers.find((item) => item.id === selectedServerId);
    const label = current?.name || (current?.code ? `remus(${current.code})` : "this server");
    const confirmed = window.confirm(`Remove ${label} from your joined servers?`);
    if (!confirmed) return;

    if (token && communityBase && selectedGuildId) {
      apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/leave`, { token, method: "POST" }).catch(() => {});
    }

    const remaining = joinedServers.filter((item) => item.id !== selectedServerId);
    setJoinedServers(remaining);
    setStatusError("");

    if (selectedServerId) {
      setSelectedServerId(remaining[0]?.id || null);
      setCommunityConnectVersion((prev) => prev + 1);
    }
  }, [communityBase, joinedServers, selectedGuildId, selectedServerId, token]);

  const closeAddServerModal = useCallback(() => {
    setAddServerOpen(false);
    setAddServerBusy(false);
    setAddServerError("");
    setAddServerUrl("");
  }, []);

  const handleAddServerSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const aliasCode = parseRemusAlias(addServerUrl);
      let nextBase = sanitizeCommunityBase(addServerUrl);
      let resolvedCode = aliasCode;

      if (aliasCode) {
        try {
          const resolved = await apiAuth(`/api/hosts/resolve/${encodeURIComponent(aliasCode)}`);
          const resolvedUrl = sanitizeCommunityBase(resolved?.host?.publicUrl || "");
          if (!resolvedUrl) {
            throw new Error("Server ID could not be resolved.");
          }
          nextBase = resolvedUrl;
          resolvedCode = String(resolved?.host?.code || aliasCode).trim().toLowerCase();
        } catch (error) {
          setAddServerError(error.message || "Could not resolve server ID.");
          return;
        }
      }

      if (!nextBase) {
        setAddServerError("Server ID or URL is required.");
        return;
      }

      setAddServerBusy(true);
      setAddServerError("");
      setStatusError("");

      try {
        const info = await apiCommunity(nextBase, "/api/server/info");
        const name = (info?.name || "").trim();
        const iconUrl = info?.iconUrl || "";
        const iceServers = sanitizeIceServers(info?.iceServers);
        const serverCode = String(info?.serverId || resolvedCode || "").trim().toLowerCase();

        setJoinedServers((prev) => {
          const exists = prev.some((item) => item.id === nextBase);
          if (exists) {
            return prev.map((item) =>
              item.id === nextBase
                ? {
                    ...item,
                    name: name || item.name,
                    iconUrl: iconUrl || item.iconUrl,
                    iceServers: iceServers.length ? iceServers : item.iceServers,
                    code: serverCode || item.code || "",
                    displayUrl: serverCode ? `remus(${serverCode})` : item.displayUrl
                  }
                : item
            );
          }
          return [
            ...prev,
            {
              id: nextBase,
              url: nextBase,
              name,
              iconUrl,
              iceServers,
              code: serverCode,
              displayUrl: serverCode ? `remus(${serverCode})` : ""
            }
          ];
        });

        setSelectedServerId(nextBase);
        setCommunityConnectVersion((prev) => prev + 1);
        closeAddServerModal();
      } catch (error) {
        setAddServerError(error.message || "Could not reach community server.");
      } finally {
        setAddServerBusy(false);
      }
    },
    [addServerUrl, closeAddServerModal]
  );

  const settingsDirty = useMemo(() => !settingsEqual(clientSettings, settingsDraft), [clientSettings, settingsDraft]);

  const setClientSetting = useCallback((key, value) => {
    setSettingsNotice("");
    setSettingsDraft((prev) => ({
      ...prev,
      [key]: value
    }));
  }, []);

  const syncGuildData = useCallback((guildId, updates) => {
    setGuilds((prev) =>
      prev.map((guild) => {
        if (guild.id !== guildId) return guild;
        return { ...guild, ...updates };
      })
    );
  }, []);

  const loadRoles = useCallback(async () => {
    if (!token || !communityBase || !selectedGuildId) return;
    const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/roles`, { token });
    const roles = data.roles || [];
    setRolesState(roles);
    syncGuildData(selectedGuildId, { roles });
  }, [communityBase, selectedGuildId, syncGuildData, token]);

  const loadMembers = useCallback(async () => {
    if (!token || !communityBase || !selectedGuildId) return;
    const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/members`, { token });
    const members = data.members || [];
    setMembersState(members);
    syncGuildData(selectedGuildId, { members, memberIds: members.map((m) => m.id) });
  }, [communityBase, selectedGuildId, syncGuildData, token]);

  const loadAudit = useCallback(async () => {
    if (!token || !communityBase || !selectedGuildId) return;
    const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/audit?limit=200`, { token });
    setAuditState(data.entries || []);
  }, [communityBase, selectedGuildId, token]);

  const loadServerSettings = useCallback(async () => {
    if (!token || !communityBase || !selectedGuildId) return;
    const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/settings`, { token });
    setServerSettingsState(data.settings || { auditMaxEntries: 2000, timeoutMaxMinutes: 10080 });
  }, [communityBase, selectedGuildId, token]);

  const openServerSettings = useCallback(async () => {
    if (!selectedGuildId || !communityBase || !token) return;
    setServerSettingsOpen(true);
    setServerSettingsError("");
    try {
      await Promise.all([loadRoles(), loadMembers(), loadServerSettings()]);
      if (canViewAudit) {
        await loadAudit();
      }
    } catch (error) {
      setServerSettingsError(error.message || "Failed to load server settings.");
    }
  }, [canViewAudit, communityBase, loadAudit, loadMembers, loadRoles, loadServerSettings, selectedGuildId, token]);

  const closeServerSettings = useCallback(() => {
    setServerSettingsOpen(false);
    setServerSettingsError("");
    setRoleDraft(null);
    setRoleDraftError("");
  }, []);

  const selectRoleDraft = useCallback((role) => {
    if (!role) {
      setRoleDraft(null);
      return;
    }
    setRoleDraft({
      id: role.id,
      name: role.name || "Role",
      color: role.color || "",
      permissions: role.permissions || 0,
      hoist: !!role.hoist,
      iconUrl: role.iconUrl || ""
    });
    setRoleDraftError("");
  }, []);

  const saveRoleDraft = useCallback(async () => {
    if (!roleDraft || !token || !communityBase) return;
    setRoleSaving(true);
    setRoleDraftError("");
    try {
      const data = await apiCommunity(communityBase, `/api/roles/${roleDraft.id}`, {
        token,
        method: "PATCH",
        body: {
          name: roleDraft.name,
          color: roleDraft.color,
          permissions: roleDraft.permissions,
          hoist: roleDraft.hoist
        }
      });
      const updated = data.role;
      setRolesState((prev) => prev.map((role) => (role.id === updated.id ? updated : role)));
      syncGuildData(selectedGuildId, {
        roles: rolesState.map((role) => (role.id === updated.id ? updated : role))
      });
      selectRoleDraft(updated);
    } catch (error) {
      setRoleDraftError(error.message || "Failed to update role.");
    } finally {
      setRoleSaving(false);
    }
  }, [communityBase, roleDraft, rolesState, selectRoleDraft, selectedGuildId, syncGuildData, token]);

  const createRole = useCallback(async () => {
    if (!token || !communityBase || !selectedGuildId) return;
    setRoleSaving(true);
    setRoleDraftError("");
    try {
      const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/roles`, {
        token,
        method: "POST",
        body: { name: "New Role", color: "", permissions: 0, hoist: false }
      });
      const role = data.role;
      setRolesState((prev) => [...prev, role]);
      syncGuildData(selectedGuildId, { roles: [...rolesState, role] });
      selectRoleDraft(role);
    } catch (error) {
      setRoleDraftError(error.message || "Failed to create role.");
    } finally {
      setRoleSaving(false);
    }
  }, [communityBase, rolesState, selectRoleDraft, selectedGuildId, syncGuildData, token]);

  const deleteRole = useCallback(
    (roleId, roleName = "this role") => {
      if (!roleId || !token || !communityBase) return;
      openConfirmDialog({
        title: "Delete Role",
        message: `Delete role "${roleName}"? This cannot be undone and will affect all members with this role.`,
        confirmText: "Delete",
        danger: true,
        onConfirm: async () => {
          setRoleSaving(true);
          setRoleDraftError("");
          try {
            await apiCommunity(communityBase, `/api/roles/${roleId}`, { token, method: "DELETE" });
            setRolesState((prev) => prev.filter((role) => role.id !== roleId));
            syncGuildData(selectedGuildId, { roles: rolesState.filter((role) => role.id !== roleId) });
            if (roleDraft?.id === roleId) {
              setRoleDraft(null);
            }
          } catch (error) {
            setRoleDraftError(error.message || "Failed to delete role.");
          } finally {
            setRoleSaving(false);
          }
        }
      });
    },
    [communityBase, roleDraft?.id, rolesState, selectedGuildId, syncGuildData, token, openConfirmDialog]
  );

  const uploadRoleIcon = useCallback(
    async (roleId, file) => {
      if (!roleId || !file || !token || !communityBase) return;
      const formData = new FormData();
      formData.append("icon", file);
      setRoleSaving(true);
      try {
        const data = await apiCommunity(communityBase, `/api/roles/${roleId}/icon`, { token, method: "POST", formData });
        const updated = data.role;
        setRolesState((prev) => prev.map((role) => (role.id === updated.id ? updated : role)));
        syncGuildData(selectedGuildId, {
          roles: rolesState.map((role) => (role.id === updated.id ? updated : role))
        });
        if (roleDraft?.id === roleId) {
          selectRoleDraft(updated);
        }
      } catch (error) {
        setRoleDraftError(error.message || "Failed to upload role icon.");
      } finally {
        setRoleSaving(false);
      }
    },
    [communityBase, roleDraft?.id, rolesState, selectRoleDraft, selectedGuildId, syncGuildData, token]
  );

  const updateMemberRoles = useCallback(
    async (memberId, roleIds) => {
      if (!token || !communityBase || !selectedGuildId) return;
      setMemberActionBusy((prev) => ({ ...prev, [memberId]: true }));
      try {
        const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/members/${memberId}/roles`, {
          token,
          method: "PATCH",
          body: { roleIds }
        });
        const updated = data.member;
        setMembersState((prev) => prev.map((member) => (member.id === memberId ? updated : member)));
        syncGuildData(selectedGuildId, {
          members: membersState.map((member) => (member.id === memberId ? updated : member))
        });
      } catch (error) {
        setStatusError(error.message || "Failed to update roles.");
      } finally {
        setMemberActionBusy((prev) => ({ ...prev, [memberId]: false }));
      }
    },
    [communityBase, membersState, selectedGuildId, syncGuildData, token]
  );

  const updateMemberTimeout = useCallback(
    async (memberId, minutes) => {
      if (!token || !communityBase || !selectedGuildId) return;
      setMemberActionBusy((prev) => ({ ...prev, [memberId]: true }));
      try {
        const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/members/${memberId}/timeout`, {
          token,
          method: "PATCH",
          body: { minutes }
        });
        const updated = data.member;
        setMembersState((prev) => prev.map((member) => (member.id === memberId ? updated : member)));
        syncGuildData(selectedGuildId, {
          members: membersState.map((member) => (member.id === memberId ? updated : member))
        });
      } catch (error) {
        setStatusError(error.message || "Failed to update timeout.");
      } finally {
        setMemberActionBusy((prev) => ({ ...prev, [memberId]: false }));
      }
    },
    [communityBase, membersState, selectedGuildId, syncGuildData, token]
  );

  const updateMemberVoice = useCallback(
    async (memberId, updates) => {
      if (!token || !communityBase || !selectedGuildId) return;
      setMemberActionBusy((prev) => ({ ...prev, [memberId]: true }));
      try {
        const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/members/${memberId}/voice`, {
          token,
          method: "PATCH",
          body: updates
        });
        const updated = data.member;
        setMembersState((prev) => prev.map((member) => (member.id === memberId ? updated : member)));
        syncGuildData(selectedGuildId, {
          members: membersState.map((member) => (member.id === memberId ? updated : member))
        });
      } catch (error) {
        setStatusError(error.message || "Failed to update voice state.");
      } finally {
        setMemberActionBusy((prev) => ({ ...prev, [memberId]: false }));
      }
    },
    [communityBase, membersState, selectedGuildId, syncGuildData, token]
  );

  const kickMember = useCallback(
    (memberId, memberName = "this member") => {
      if (!token || !communityBase || !selectedGuildId) return;
      openConfirmDialog({
        title: "Kick Member",
        message: `Kick ${memberName} from the server? They can rejoin with an invite.`,
        confirmText: "Kick",
        danger: true,
        onConfirm: async () => {
          setMemberActionBusy((prev) => ({ ...prev, [memberId]: true }));
          try {
            await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/members/${memberId}/kick`, {
              token,
              method: "POST"
            });
            await loadMembers();
          } catch (error) {
            setStatusError(error.message || "Failed to kick member.");
          } finally {
            setMemberActionBusy((prev) => ({ ...prev, [memberId]: false }));
          }
        }
      });
    },
    [communityBase, loadMembers, selectedGuildId, token, openConfirmDialog]
  );

  const banMember = useCallback(
    (memberId, memberName = "this member") => {
      if (!token || !communityBase || !selectedGuildId) return;
      openConfirmDialog({
        title: "Ban Member",
        message: `Ban ${memberName} from the server? This will prevent them from rejoining.`,
        confirmText: "Ban",
        danger: true,
        onConfirm: async () => {
          setMemberActionBusy((prev) => ({ ...prev, [memberId]: true }));
          try {
            await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/members/${memberId}/ban`, {
              token,
              method: "POST"
            });
            await loadMembers();
          } catch (error) {
            setStatusError(error.message || "Failed to ban member.");
          } finally {
            setMemberActionBusy((prev) => ({ ...prev, [memberId]: false }));
          }
        }
      });
    },
    [communityBase, loadMembers, selectedGuildId, token, openConfirmDialog]
  );

  const saveServerSettings = useCallback(async () => {
    if (!token || !communityBase || !selectedGuildId) return;
    try {
      const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/settings`, {
        token,
        method: "PATCH",
        body: serverSettingsState
      });
      setServerSettingsState(data.settings || serverSettingsState);
      setServerSettingsError("Settings saved.");
    } catch (error) {
      setServerSettingsError(error.message || "Failed to save settings.");
    }
  }, [communityBase, selectedGuildId, serverSettingsState, token]);

  const toggleRolePermission = useCallback((bit) => {
    setRoleDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      next.permissions = prev.permissions ^ bit;
      return next;
    });
  }, []);

  const openSettings = useCallback(() => {
    setSettingsDraft(clientSettings);
    setAudioDevicesError("");
    setSettingsNotice("");
    setRequestingAudioPermission(false);
    setNicknameDraft(currentMember?.nickname || "");
    setNicknameNotice("");
    setSettingsOpen(true);
  }, [clientSettings, currentMember?.nickname]);

  const closeSettings = useCallback(() => {
    setSettingsDraft(clientSettings);
    setAudioDevicesError("");
    setSettingsNotice("");
    setRequestingAudioPermission(false);
    setNicknameNotice("");
    setSettingsOpen(false);
  }, [clientSettings]);

  const saveSettings = useCallback(() => {
    setClientSettings(settingsDraft);
    setSettingsNotice("Settings saved.");
  }, [settingsDraft]);

  const saveNickname = useCallback(async () => {
    if (!token || !communityBase || !selectedGuildId || !user?.id) return;
    setNicknameNotice("");
    try {
      const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/members/${user.id}/nickname`, {
        token,
        method: "PATCH",
        body: { nickname: nicknameDraft.trim() }
      });
      const updated = data.member;
      setNicknameDraft(updated.nickname || "");
      syncGuildData(selectedGuildId, {
        members: (selectedGuild?.members || []).map((member) => (member.id === updated.id ? updated : member))
      });
      setNicknameNotice("Nickname saved.");
    } catch (error) {
      setNicknameNotice(error.message || "Failed to update nickname.");
    }
  }, [communityBase, nicknameDraft, selectedGuild?.members, selectedGuildId, syncGuildData, token, user?.id]);

  useEffect(() => {
    if (!settingsOpen && !addServerOpen && !createChannelOpen && !screenPickerOpen && !serverSettingsOpen && !channelSettingsOpen) {
      return undefined;
    }

    const onKeyDown = (event) => {
      // Check if user is typing in an input field
      const isTyping = ["INPUT", "TEXTAREA"].includes(event.target.tagName) || event.target.isContentEditable;

      // Escape key - close modals
      if (event.key === "Escape") {
        if (settingsOpen) {
          closeSettings();
        }
        if (serverSettingsOpen) {
          closeServerSettings();
        }
        if (channelSettingsOpen) {
          closeChannelSettings();
        }
        if (addServerOpen) {
          closeAddServerModal();
        }
        if (createChannelOpen) {
          closeCreateChannelModal();
        }
        if (screenPickerOpen) {
          closeScreenPicker();
        }
        return;
      }

      // Don't handle other shortcuts while typing (except Ctrl+Enter for send)
      if (isTyping && !(event.ctrlKey && event.key === "Enter")) {
        return;
      }

      // Ctrl+Shift+M - Toggle mute
      if (event.ctrlKey && event.shiftKey && event.key === "M") {
        event.preventDefault();
        setServerMuted(prev => !prev);
        return;
      }

      // Ctrl+Shift+D - Toggle deafen
      if (event.ctrlKey && event.shiftKey && event.key === "D") {
        event.preventDefault();
        setServerDeafened(prev => !prev);
        return;
      }

      // Alt+ArrowUp - Navigate to previous channel
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        const textChannels = channels.filter(ch => ch.type === "text");
        if (textChannels.length === 0) return;

        const currentIndex = textChannels.findIndex(ch => ch.id === selectedChannelId);
        if (currentIndex > 0) {
          setSelectedChannelId(textChannels[currentIndex - 1].id);
        } else if (textChannels.length > 0) {
          setSelectedChannelId(textChannels[textChannels.length - 1].id);
        }
        return;
      }

      // Alt+ArrowDown - Navigate to next channel
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        const textChannels = channels.filter(ch => ch.type === "text");
        if (textChannels.length === 0) return;

        const currentIndex = textChannels.findIndex(ch => ch.id === selectedChannelId);
        if (currentIndex >= 0 && currentIndex < textChannels.length - 1) {
          setSelectedChannelId(textChannels[currentIndex + 1].id);
        } else if (textChannels.length > 0) {
          setSelectedChannelId(textChannels[0].id);
        }
        return;
      }

      // Ctrl+F - Focus message search
      if (event.ctrlKey && event.key === "f") {
        event.preventDefault();
        messageSearchRef.current?.focus();
        return;
      }

      // Ctrl+/ - Show keyboard shortcuts help (placeholder for future implementation)
      if (event.ctrlKey && event.key === "/") {
        event.preventDefault();
        // TODO: Show keyboard shortcuts modal
        console.log("Keyboard shortcuts:", {
          "Ctrl+Shift+M": "Toggle mute",
          "Ctrl+Shift+D": "Toggle deafen",
          "Alt+↑/↓": "Navigate channels",
          "Escape": "Close modals"
        });
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    addServerOpen,
    closeAddServerModal,
    closeCreateChannelModal,
    closeChannelSettings,
    closeScreenPicker,
    closeServerSettings,
    closeSettings,
    channelSettingsOpen,
    createChannelOpen,
    screenPickerOpen,
    serverSettingsOpen,
    settingsOpen,
    channels,
    selectedChannelId
  ]);

  useEffect(() => {
    if (!token) return;

    safeStorageSet("remus_token", token);

    let cancelled = false;

    const load = async () => {
      try {
        const me = await apiAuth("/api/me", { token });

        if (cancelled) return;

        setUser(me.user);
        if (me.user?.passwordResetRequired) {
          openPasswordReset();
        }
      } catch (error) {
        if (!cancelled) {
          setStatusError(error.message);
          handleLogout();
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [handleLogout, openPasswordReset, token]);

  useEffect(() => {
    if (!token || !communityBase) return;

    setCommunityStatus("connecting");
    const socket = io(communityBase, {
      auth: { token },
      transports: ["websocket"],
      timeout: 60000,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      socketIdRef.current = socket.id;
      setCommunityStatus("connected");
      setStatusError("");
    });

    socket.on("connect_error", (error) => {
      setCommunityStatus("disconnected");
      setStatusError(error.message || "Socket connection failed");
    });

    socket.on("disconnect", () => {
      socketIdRef.current = null;
      setCommunityStatus("disconnected");
    });

    socket.on("auth:banned", ({ reason }) => {
      setStatusError(reason === "banned" ? "You are banned from this community." : "Access denied.");
      setCommunityStatus("disconnected");
    });

    socket.on("guild:kicked", ({ reason }) => {
      setStatusError(reason === "banned" ? "You were banned from this community." : "You were removed from this community.");
      setCommunityStatus("disconnected");
      if (selectedServerIdRef.current) {
        setJoinedServers((prev) => prev.filter((item) => item.id !== selectedServerIdRef.current));
      }
    });

    socket.on("guild:new", (guild) => {
      setGuilds((prev) => {
        if (prev.some((known) => known.id === guild.id)) return prev;
        return [...prev, guild];
      });
    });

    socket.on("guild:memberJoined", ({ guildId, user: member }) => {
      if (!guildId || !member?.id) return;
      setGuilds((prev) =>
        prev.map((guild) => {
          if (guild.id !== guildId) return guild;
          const memberIds = guild.memberIds ? [...guild.memberIds] : [];
          if (!memberIds.includes(member.id)) {
            memberIds.push(member.id);
          }
          const members = Array.isArray(guild.members) ? [...guild.members] : [];
          if (!members.some((item) => item.id === member.id)) {
            members.push(member);
          }
          return { ...guild, memberIds, members };
        })
      );
      setMembersState((prev) => {
        if (!prev.length) return prev;
        if (prev.some((item) => item.id === member.id)) return prev;
        return [...prev, member];
      });
    });

    socket.on("guild:memberLeft", ({ guildId, userId }) => {
      if (!guildId || !userId) return;
      setGuilds((prev) =>
        prev.map((guild) => {
          if (guild.id !== guildId) return guild;
          const memberIds = (guild.memberIds || []).filter((id) => id !== userId);
          const members = Array.isArray(guild.members) ? guild.members.filter((item) => item.id !== userId) : guild.members;
          return { ...guild, memberIds, members };
        })
      );
      setMembersState((prev) => prev.filter((item) => item.id !== userId));

      if (selectedGuildIdRef.current !== guildId) return;

      setMessages((prev) => prev.filter((message) => message.author?.id !== userId));
      setTypingUsers((prev) => {
        if (!prev[userId]) return prev;
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setVoiceParticipants((prev) => prev.filter((id) => id !== userId));
      setSpeakingUsers((prev) => {
        if (!prev[userId]) return prev;
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setVoiceUsernames((prev) => {
        if (!prev[userId]) return prev;
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setRemoteStreams((prev) => prev.filter((entry) => entry.userId !== userId));
      setScreenStreams((prev) => prev.filter((entry) => entry.userId !== userId));
      setActiveScreenShareUserId((prev) => (prev === userId ? null : prev));
    });

    socket.on("member:update", (member) => {
      if (!member?.id) return;
      setGuilds((prev) =>
        prev.map((guild) => {
          if (guild.id !== selectedGuildIdRef.current) return guild;
          const members = Array.isArray(guild.members) ? [...guild.members] : [];
          const idx = members.findIndex((item) => item.id === member.id);
          if (idx >= 0) {
            members[idx] = member;
          } else {
            members.push(member);
          }
          return { ...guild, members };
        })
      );
      setMembersState((prev) => {
        if (!prev.length) return prev;
        return prev.map((item) => (item.id === member.id ? member : item));
      });
    });

    socket.on("channel:new", (channel) => {
      if (channel.guildId !== selectedGuildIdRef.current) return;
      setChannels((prev) => {
        if (prev.some((known) => known.id === channel.id)) return prev;
        return [...prev, channel];
      });
    });

    socket.on("channel:update", (channel) => {
      if (!channel || channel.guildId !== selectedGuildIdRef.current) return;
      setChannels((prev) => prev.map((item) => (item.id === channel.id ? channel : item)));
    });

    socket.on("channel:delete", ({ channelId }) => {
      if (!channelId) return;
      setChannels((prev) => prev.filter((item) => item.id !== channelId));
      if (selectedChannelIdRef.current === channelId) {
        setSelectedChannelId(null);
      }
    });

    socket.on("message:new", (message) => {
      if (message.channelId === selectedChannelIdRef.current) {
        setMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
      } else {
        // Mark channel as unread if message is in a different channel
        setUnreadChannels((prev) => new Set(prev).add(message.channelId));
      }
    });

    socket.on("message:delete", ({ messageId, channelId }) => {
      if (!messageId || channelId !== selectedChannelIdRef.current) return;
      setMessages((prev) => prev.filter((message) => message.id !== messageId));
    });

    socket.on("message:update", ({ message }) => {
      if (!message || message.channelId !== selectedChannelIdRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    });

    socket.on("voice:move", ({ channelId }) => {
      if (!channelId) return;
      void joinVoiceChannel(channelId);
    });

    socket.on("typing:start", ({ channelId, user: typingUser }) => {
      if (!typingUser || typingUser.id === user?.id || channelId !== selectedChannelIdRef.current) {
        return;
      }
      setTypingUsers((prev) => ({ ...prev, [typingUser.id]: typingUser.username }));
    });

    socket.on("typing:stop", ({ channelId, userId }) => {
      if (!userId || channelId !== selectedChannelIdRef.current) return;
      setTypingUsers((prev) => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });
    });

    socket.on("voice:participants", (payload) => {
      void handleVoiceParticipants(payload);
    });

    socket.on("voice:presenceAll", (payload) => {
      applyVoicePresence(payload);
    });

    socket.on("voice:existingProducers", ({ channelId, producers = [] }) => {
      if (!channelId || channelId !== joinedVoiceChannelRef.current) return;
      for (const producer of producers) {
        void consumeProducer(producer);
      }
    });

    socket.on("voice:newProducer", (payload) => {
      if (!payload?.producerId) return;
      if (payload.channelId && payload.channelId !== joinedVoiceChannelRef.current) return;
      void consumeProducer(payload);
    });

    socket.on("voice:producerClosed", ({ producerId }) => {
      if (!producerId) return;
      closeConsumersForProducer(producerId);
    });

    socket.on("voice:presence", ({ channelId, userIds, users = [], speakingUserIds = [] }) => {
      if (!channelId || channelId !== joinedVoiceChannelRef.current) return;
      if (users.length) {
        setVoiceUsernames((prev) => {
          const next = { ...prev };
          for (const user of users) {
            if (user?.id) {
              const label = user.nickname || user.username;
              if (label) {
                next[user.id] = label;
                if (user.userId) {
                  next[user.userId] = label;
                }
              }
            }
          }
          return next;
        });
      }

      const localSessionId = socketIdRef.current || user?.id;
      const filtered = (userIds || []).filter((id) => id !== localSessionId);
      setVoiceParticipants(filtered);
      setSpeakingUsers(() => {
        const next = {};
        for (const id of speakingUserIds || []) {
          if (id) next[id] = true;
        }
        const sessionId = socketIdRef.current;
        if (sessionId && localSpeakingRef.current) {
          next[sessionId] = true;
        }
        return next;
      });
      applyVoicePresence({ channelId, userIds, users, speakingUserIds });
    });

    socket.on("voice:speaking", ({ channelId, userId, speaking }) => {
      const participantId = userId;
      if (!channelId || channelId !== joinedVoiceChannelRef.current || !participantId) return;
      setSpeakingUsers((prev) => {
        const next = { ...prev };
        if (speaking) {
          next[participantId] = true;
        } else {
          delete next[participantId];
        }
        return next;
      });
    });

    socket.on("voice:speakingAll", ({ channelId, userId, speaking }) => {
      const participantId = userId;
      if (!channelId || !participantId) return;
      setVoiceChannelState((prev) => {
        const current = prev[channelId] || { userIds: [], users: [], speakingUserIds: [] };
        const speakingSet = new Set(current.speakingUserIds || []);
        if (speaking) {
          speakingSet.add(participantId);
        } else {
          speakingSet.delete(participantId);
        }
        return {
          ...prev,
          [channelId]: {
            ...current,
            speakingUserIds: [...speakingSet]
          }
        };
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [
    applyVoicePresence,
    closeConsumersForProducer,
    communityBase,
    communityConnectVersion,
    consumeProducer,
    handleVoiceParticipants,
    token,
    user?.id
  ]);

  useEffect(() => {
    if (!communityBase || !selectedServerId) return;

    let cancelled = false;

    const loadServerInfo = async () => {
      try {
        const info = await apiCommunity(communityBase, "/api/server/info");
        if (cancelled) return;
        const nextName = (info?.name || "").trim();
        const nextIcon = info?.iconUrl || "";
        const nextIce = sanitizeIceServers(info?.iceServers);
        const nextCode = String(info?.serverId || "").trim().toLowerCase();
        if (!nextName && !nextIcon && !nextIce.length) return;

        setJoinedServers((prev) =>
          prev.map((item) => {
            if (item.id !== selectedServerId) return item;
            const next = { ...item };
            if (nextName && item.name !== nextName) {
              next.name = nextName;
            }
            if (nextIcon && item.iconUrl !== nextIcon) {
              next.iconUrl = nextIcon;
            }
            if (nextIce.length) {
              next.iceServers = nextIce;
            }
            if (nextCode && item.code !== nextCode) {
              next.code = nextCode;
              next.displayUrl = `remus(${nextCode})`;
            }
            return next;
          })
        );
      } catch {
        // Ignore node info refresh errors; connection status/error handling is managed elsewhere.
      }
    };

    void loadServerInfo();

    return () => {
      cancelled = true;
    };
  }, [communityBase, selectedServerId, communityConnectVersion]);

  const availableScreenShareIds = useMemo(() => {
    const ids = [];
    for (const entry of screenStreams) {
      if (entry?.userId) ids.push(entry.userId);
    }
    const sessionId = socketIdRef.current;
    if (isScreenSharing && sessionId) {
      if (!ids.includes(sessionId)) {
        ids.push(sessionId);
      }
    }
    return ids;
  }, [isScreenSharing, screenStreams]);

  useEffect(() => {
    if (!availableScreenShareIds.length) {
      setActiveScreenShareUserId(null);
      return;
    }
    if (activeScreenShareUserId && availableScreenShareIds.includes(activeScreenShareUserId)) {
      return;
    }
    setActiveScreenShareUserId(availableScreenShareIds[0]);
  }, [activeScreenShareUserId, availableScreenShareIds]);

  useEffect(() => {
    if (!token || !communityBase) {
      setGuilds([]);
      setChannels([]);
      setSelectedGuildId(null);
      return;
    }

    let cancelled = false;

    const loadGuilds = async () => {
      try {
        const data = await apiCommunity(communityBase, "/api/guilds", { token });
        if (cancelled) return;

        const nextGuilds = data.guilds || [];
        setGuilds(nextGuilds);

        if (!nextGuilds.some((guild) => guild.id === selectedGuildIdRef.current)) {
          setSelectedGuildId(nextGuilds[0]?.id || null);
        }
      } catch (error) {
        if (!cancelled) {
          setStatusError(error.message || "Could not load servers");
        }
      }
    };

    void loadGuilds();

    return () => {
      cancelled = true;
    };
  }, [communityBase, communityConnectVersion, token]);

  useEffect(() => {
    if (!token || !communityBase || !selectedGuildId) {
      setChannels([]);
      setVoiceChannelState({});
      return;
    }

    let cancelled = false;

    const loadChannels = async () => {
      try {
        const data = await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/channels`, { token });
        if (cancelled) return;

        const nextChannels = data.channels || [];
        setChannels(nextChannels);

        if (!nextChannels.some((channel) => channel.id === selectedChannelIdRef.current)) {
          const preferred = nextChannels.find((channel) => channel.type === "text") || nextChannels[0] || null;
          setSelectedChannelId(preferred?.id || null);
        }

        if (socketRef.current) {
          socketRef.current.emit("guild:joinRoom", { guildId: selectedGuildId });
          try {
            const snapshot = await socketRequest("voice:snapshot", { guildId: selectedGuildId });
            if (!cancelled && Array.isArray(snapshot?.channels)) {
              const nextState = {};
              for (const entry of snapshot.channels) {
                if (entry?.channelId) {
                  nextState[entry.channelId] = {
                    userIds: Array.isArray(entry.userIds) ? entry.userIds : [],
                    users: Array.isArray(entry.users) ? entry.users : [],
                    speakingUserIds: Array.isArray(entry.speakingUserIds) ? entry.speakingUserIds : []
                  };
                }
              }
              setVoiceChannelState(nextState);
            }
          } catch {}
        }
      } catch (error) {
        if (!cancelled) {
          setStatusError(error.message || "Could not load channels");
        }
      }
    };

    void loadChannels();

    return () => {
      cancelled = true;
    };
  }, [communityBase, communityConnectVersion, selectedGuildId, socketRequest, token]);

  useEffect(() => {
    if (!token || !communityBase || !selectedChannelId) {
      setMessages([]);
      setTypingUsers({});
      return;
    }

    let cancelled = false;

    const loadMessages = async () => {
      setMessagesLoading(true);
      try {
        const data = await apiCommunity(communityBase, `/api/channels/${selectedChannelId}/messages?limit=100`, {
          token
        });
        if (cancelled) return;

        setMessages(data.messages || []);

        if (socketRef.current) {
          socketRef.current.emit("channel:join", { channelId: selectedChannelId });
        }
      } catch (error) {
        if (!cancelled) {
          setStatusError(error.message || "Could not load messages");
        }
      } finally {
        if (!cancelled) {
          setMessagesLoading(false);
        }
      }
    };

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [communityBase, communityConnectVersion, selectedChannelId, token]);

  useEffect(() => {
    if (socketRef.current && selectedChannelId) {
      socketRef.current.emit("channel:join", { channelId: selectedChannelId });
    }
  }, [selectedChannelId]);

  // Load draft when switching channels
  useEffect(() => {
    if (!selectedChannelId || !communityBase) return;

    const drafts = loadMessageDrafts();
    const draftKey = `${communityBase}:${selectedChannelId}`;
    const draft = drafts[draftKey] || "";

    setCompose(draft);
  }, [selectedChannelId, communityBase]);

  // Save draft when compose changes
  useEffect(() => {
    if (!selectedChannelId || !communityBase) return;

    const drafts = loadMessageDrafts();
    const draftKey = `${communityBase}:${selectedChannelId}`;

    if (compose.trim()) {
      drafts[draftKey] = compose;
    } else {
      delete drafts[draftKey];
    }

    saveMessageDrafts(drafts);
  }, [compose, selectedChannelId, communityBase]);

  // Handle paste events for images
  useEffect(() => {
    const handlePaste = async (event) => {
      if (!canAttachFiles || !selectedChannelIdRef.current || !communityBase || !token) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          event.preventDefault();

          const file = item.getAsFile();
          if (!file) continue;

          // Upload the pasted image
          const channelId = selectedChannelIdRef.current;
          const uploadUrl = `${communityBase}/api/files/upload`;
          const uploadId = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

          setUploadQueue((prev) => [
            ...prev,
            { id: uploadId, name: file.name || "pasted-image.png", progress: 0, status: "uploading" }
          ]);

          try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("channelId", channelId);

            const xhr = new XMLHttpRequest();
            xhr.open("POST", uploadUrl);
            if (token) {
              xhr.setRequestHeader("Authorization", `Bearer ${token}`);
            }
            xhr.responseType = "json";

            xhr.upload.onprogress = (progressEvent) => {
              if (!progressEvent.lengthComputable) return;
              const percent = Math.min(Math.max(Math.round((progressEvent.loaded / progressEvent.total) * 100), 0), 100);
              setUploadQueue((prev) =>
                prev.map((item) => (item.id === uploadId ? { ...item, progress: percent } : item))
              );
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                const data = xhr.response;
                if (data?.attachment) {
                  setPendingAttachments((prev) => [...prev, data.attachment]);
                }
                setUploadQueue((prev) => prev.filter((item) => item.id !== uploadId));
              } else {
                const message = xhr.response?.error || xhr.response?.message || `Upload failed (${xhr.status})`;
                setUploadQueue((prev) =>
                  prev.map((item) =>
                    item.id === uploadId
                      ? { ...item, status: "error", error: message }
                      : item
                  )
                );
                setStatusError(message);
              }
            };

            xhr.onerror = () => {
              setUploadQueue((prev) =>
                prev.map((item) =>
                  item.id === uploadId
                    ? { ...item, status: "error", error: "Upload failed" }
                    : item
                )
              );
              setStatusError("Upload failed");
            };

            xhr.send(formData);
          } catch (error) {
            setUploadQueue((prev) =>
              prev.map((item) =>
                item.id === uploadId
                  ? { ...item, status: "error", error: error.message || "Upload failed" }
                  : item
              )
            );
            setStatusError(error.message || "Upload failed");
          }

          break; // Only handle first image
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [canAttachFiles, communityBase, token]);

  useEffect(() => {
    return () => {
      leaveVoiceChannel();
    };
  }, [leaveVoiceChannel]);

  useEffect(() => {
    leaveVoiceChannel();
    setGuilds([]);
    setChannels([]);
    setMessages([]);
    setVoiceUsernames({});
    setVoiceParticipants([]);
    setVoiceChannelState({});
    setSelectedGuildId(null);
    setSelectedChannelId(null);
    setTypingUsers({});
    setPendingAttachments([]);
    if (!communityBase) {
      setCommunityStatus("disconnected");
    }
  }, [communityBase, leaveVoiceChannel]);

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");

    try {
      const loginName = authForm.loginName.trim();
      const loginNameConfirm = authForm.loginNameConfirm.trim();
      const displayName = authForm.displayName.trim();
      const password = authForm.password;
      const passwordConfirm = authForm.passwordConfirm;

      if (authMode === "register") {
        if (!loginName || loginName.length < 3) {
          setAuthError("Secret username must be at least 3 characters.");
          return;
        }
        if (loginName !== loginNameConfirm) {
          setAuthError("Secret usernames do not match.");
          return;
        }
        if (!displayName || displayName.length < 2) {
          setAuthError("Display name must be at least 2 characters.");
          return;
        }
        if (password.length < 6) {
          setAuthError("Password must be at least 6 characters.");
          return;
        }
        if (password !== passwordConfirm) {
          setAuthError("Passwords do not match.");
          return;
        }
      }

      const payload =
        authMode === "register"
          ? {
              loginName,
              displayName,
              password
            }
          : {
              loginName,
              password
            };

      const data = await apiAuth(`/api/auth/${authMode}`, {
        method: "POST",
        body: payload
      });

      setToken(data.token);
      setUser(data.user);
      if (authMode === "register" && data.recoveryKey) {
        setRecoveryKeyValue(data.recoveryKey);
        setRecoveryKeyNotice("");
        setRecoveryKeyOpen(true);
      }
      if (data.user?.passwordResetRequired) {
        openPasswordReset();
      }
      setAuthForm({
        loginName: "",
        loginNameConfirm: "",
        displayName: "",
        password: "",
        passwordConfirm: ""
      });
      setStatusError("");
    } catch (error) {
      setAuthError(error.message || "Authentication failed");
    }
  };

  const openAccountRecovery = () => {
    setAccountRecoveryError("");
    setAccountRecoveryOpen(true);
    setAccountRecoveryForm((prev) => ({
      ...prev,
      loginName: authForm.loginName.trim()
    }));
  };

  const closeAccountRecovery = () => {
    setAccountRecoveryOpen(false);
    setAccountRecoveryError("");
  };

  const handleAccountRecoverySubmit = async (event) => {
    event.preventDefault();
    setAccountRecoveryError("");
    const loginName = accountRecoveryForm.loginName.trim();
    const recoveryKey = accountRecoveryForm.recoveryKey.trim();
    const password = accountRecoveryForm.password.trim();
    const confirm = accountRecoveryForm.confirm.trim();

    if (!loginName || loginName.length < 3) {
      setAccountRecoveryError("Secret username must be at least 3 characters.");
      return;
    }
    if (!recoveryKey) {
      setAccountRecoveryError("Recovery key is required.");
      return;
    }
    if (password.length < 6) {
      setAccountRecoveryError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setAccountRecoveryError("Passwords do not match.");
      return;
    }

    try {
      const data = await apiAuth("/api/auth/recover", {
        method: "POST",
        body: {
          loginName,
          recoveryKey,
          password
        }
      });
      setToken(data.token);
      setUser(data.user);
      setAccountRecoveryOpen(false);
      setAccountRecoveryForm({
        loginName: "",
        recoveryKey: "",
        password: "",
        confirm: ""
      });
      setAuthForm({
        loginName: "",
        loginNameConfirm: "",
        displayName: "",
        password: "",
        passwordConfirm: ""
      });
      setStatusError("");
    } catch (error) {
      setAccountRecoveryError(error.message || "Recovery failed.");
    }
  };

  const copyRecoveryKey = async () => {
    if (!recoveryKeyValue) return;
    try {
      await navigator.clipboard.writeText(recoveryKeyValue);
      setRecoveryKeyNotice("Recovery key copied to clipboard.");
    } catch {
      setRecoveryKeyNotice("Unable to copy. Please copy manually.");
    }
  };

  const handlePasswordResetSubmit = async (event) => {
    event.preventDefault();
    setPasswordResetError("");
    const password = passwordResetForm.password.trim();
    const confirm = passwordResetForm.confirm.trim();
    if (password.length < 6) {
      setPasswordResetError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setPasswordResetError("Passwords do not match.");
      return;
    }

    try {
      const data = await apiAuth("/api/auth/set-password", {
        method: "POST",
        token,
        body: { password }
      });
      setToken(data.token);
      setUser(data.user);
      closePasswordReset();
    } catch (error) {
      setPasswordResetError(error.message || "Failed to update password.");
    }
  };

  const handleCreateChannel = async (event) => {
    event.preventDefault();
    const name = newChannelName.trim();
    if (!name || !selectedGuildId || !token || !communityBase) return;
    if (!canManageChannels) {
      setStatusError("You do not have permission to manage channels.");
      return;
    }

    try {
      await apiCommunity(communityBase, `/api/guilds/${selectedGuildId}/channels`, {
        token,
        method: "POST",
        body: { name, type: newChannelType }
      });
      setNewChannelName("");
      setCreateChannelOpen(false);
      setStatusError("");
    } catch (error) {
      setStatusError(error.message || "Could not create channel");
    }
  };

  const handleComposeChange = (event) => {
    const value = event.target.value;
    setCompose(value);

    // Check for @ mentions
    const cursorPos = event.target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      // Check if there's a space after @, if so, close suggestions
      if (textAfterAt.includes(" ")) {
        setMentionQuery("");
        setMentionStart(null);
      } else {
        setMentionQuery(textAfterAt);
        setMentionStart(lastAtIndex);
      }
    } else {
      setMentionQuery("");
      setMentionStart(null);
    }

    const channelId = selectedChannelIdRef.current;
    if (!socketRef.current || !channelId) {
      return;
    }

    socketRef.current.emit("typing:start", { channelId });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      if (socketRef.current) {
        socketRef.current.emit("typing:stop", { channelId });
      }
    }, 1200);
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    const channelId = selectedChannelIdRef.current;
    if (!channelId) return;
    if (!canSendMessages) {
      showToast("You do not have permission to send messages.", "error");
      return;
    }

    const content = compose.trim();
    if (!content && pendingAttachments.length === 0) return;

    // Message length validation (2000 character limit)
    if (content.length > 2000) {
      showToast(`Message is too long (${content.length}/2000 characters). Please shorten your message.`, "error");
      return;
    }

    setMessageSending(true);
    try {
      const body = { content, attachments: pendingAttachments };
      if (replyingTo) {
        body.replyToId = replyingTo.id;
      }
      const response = await apiCommunity(communityBase, `/api/channels/${channelId}/messages`, {
        token,
        method: "POST",
        body
      });
      if (response?.message) {
        setMessages((prev) => (prev.some((item) => item.id === response.message.id) ? prev : [...prev, response.message]));
        showToast("Message sent!", "success");
      }
      if (socketRef.current) {
        socketRef.current.emit("typing:stop", { channelId });
      }
      setCompose("");
      setPendingAttachments([]);
      setReplyingTo(null);

      // Clear draft from localStorage
      const drafts = loadMessageDrafts();
      const draftKey = `${communityBase}:${channelId}`;
      delete drafts[draftKey];
      saveMessageDrafts(drafts);
    } catch (error) {
      showToast(error.message || "Failed to send message.", "error");
      setStatusError(error.message || "Failed to send message.");
    } finally {
      setMessageSending(false);
    }
  };

  const deleteMessage = useCallback(
    (message) => {
      if (!message || !communityBase || !token) return;
      if (!canManageMessages && message.author?.id !== user?.id) {
        showToast("You don't have permission to delete this message.", "error");
        return;
      }

      const isOwnMessage = message.author?.id === user?.id;
      const confirmMessage = isOwnMessage
        ? "Delete your message? This cannot be undone."
        : `Delete message from ${message.author?.username || "Unknown"}? This cannot be undone.`;

      openConfirmDialog({
        title: "Delete Message",
        message: confirmMessage,
        confirmText: "Delete",
        danger: true,
        onConfirm: async () => {
          try {
            await apiCommunity(communityBase, `/api/channels/${message.channelId}/messages/${message.id}`, {
              token,
              method: "DELETE"
            });
            setMessages((prev) => prev.filter((m) => m.id !== message.id));
            showToast("Message deleted.", "success");
          } catch (error) {
            showToast(error.message || "Failed to delete message.", "error");
          }
        }
      });
    },
    [communityBase, token, canManageMessages, user?.id, openConfirmDialog]
  );

  const startEditingMessage = useCallback((message) => {
    if (!message || message.author?.id !== user?.id) return;
    setEditingMessageId(message.id);
    setEditingContent(message.content || "");
  }, [user?.id]);

  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent("");
  }, []);

  const saveEditedMessage = useCallback(async (messageId) => {
    if (!messageId || !communityBase || !token) return;

    const newContent = editingContent.trim();
    if (!newContent) {
      showToast("Message cannot be empty.", "error");
      return;
    }

    if (newContent.length > 2000) {
      showToast(`Message is too long (${newContent.length}/2000 characters).`, "error");
      return;
    }

    try {
      const response = await apiCommunity(communityBase, `/api/channels/${selectedChannelIdRef.current}/messages/${messageId}`, {
        token,
        method: "PATCH",
        body: { content: newContent }
      });

      if (response?.message) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? response.message : m)));
        showToast("Message updated.", "success");
      }
      cancelEditingMessage();
    } catch (error) {
      showToast(error.message || "Failed to edit message.", "error");
    }
  }, [communityBase, token, editingContent, cancelEditingMessage]);

  const toggleReaction = useCallback(async (messageId, emoji) => {
    if (!messageId || !emoji || !communityBase || !token) return;

    try {
      const response = await apiCommunity(communityBase, `/api/messages/${messageId}/reactions`, {
        token,
        method: "POST",
        body: { emoji }
      });

      if (response?.message) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? response.message : m)));
      }
    } catch (error) {
      showToast(error.message || "Failed to add reaction.", "error");
    }
  }, [communityBase, token]);

  const insertMention = useCallback((member, textareaRef) => {
    if (!member || !textareaRef) return;

    const textarea = textareaRef;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = compose.substring(0, cursorPos);
    const textAfterCursor = compose.substring(cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const newText = textBeforeCursor.substring(0, lastAtIndex) + `@${member.username} ` + textAfterCursor;
      setCompose(newText);
      setMentionQuery("");
      setMentionStart(null);

      // Set cursor position after the mention
      setTimeout(() => {
        const newCursorPos = lastAtIndex + member.username.length + 2;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
      }, 0);
    }
  }, [compose]);

  const handleReplyClick = useCallback((message) => {
    setReplyingTo(message);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length || !token || !communityBase || !selectedChannelIdRef.current) return;
    if (!canAttachFiles) {
      showToast("You do not have permission to upload files.", "error");
      setStatusError("You do not have permission to upload files.");
      return;
    }

    // File size validation (100MB limit - adjust as needed)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes
    const oversizedFiles = files.filter(file => file.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      const fileList = oversizedFiles.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`).join(", ");
      showToast(`File(s) too large: ${fileList}. Maximum size is 100MB per file.`, "error");
      event.target.value = "";
      return;
    }

    const channelId = selectedChannelIdRef.current;
    const uploadUrl = `${communityBase}/api/files/upload`;

    const uploadFile = (file, uploadId) =>
      new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("channelId", channelId);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl);
        if (token) {
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        }
        xhr.responseType = "json";

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.min(Math.max(Math.round((event.loaded / event.total) * 100), 0), 100);
          setUploadQueue((prev) =>
            prev.map((item) => (item.id === uploadId ? { ...item, progress: percent } : item))
          );
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.response);
          } else {
            const message = xhr.response?.error || xhr.response?.message || `Upload failed (${xhr.status})`;
            reject(new Error(message));
          }
        };

        xhr.onerror = () => {
          reject(new Error("Upload failed"));
        };

        xhr.send(formData);
      });

    for (const file of files) {
      const uploadId = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      setUploadQueue((prev) => [
        ...prev,
        { id: uploadId, name: file.name || "file", progress: 0, status: "uploading" }
      ]);

      try {
        const data = await uploadFile(file, uploadId);
        if (data?.attachment) {
          setPendingAttachments((prev) => [...prev, data.attachment]);
          showToast(`${file.name} uploaded successfully!`, "success");
        }
        setUploadQueue((prev) => prev.filter((item) => item.id !== uploadId));
      } catch (error) {
        setUploadQueue((prev) =>
          prev.map((item) =>
            item.id === uploadId
              ? { ...item, status: "error", error: error.message || "Upload failed" }
              : item
          )
        );
        showToast(`Failed to upload ${file.name}: ${error.message || "Upload failed"}`, "error");
        setStatusError(error.message || "Upload failed");
      }
    }

    event.target.value = "";
  };

  const handleChatDragEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();

    // Only show drag overlay if we have files being dragged
    if (event.dataTransfer?.types?.includes("Files")) {
      setIsDraggingFile(true);
    }
  };

  const handleChatDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleChatDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();

    // Only hide if leaving the main container
    if (event.currentTarget === event.target) {
      setIsDraggingFile(false);
    }
  };

  const handleChatFileDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFile(false);

    if (!canAttachFiles || !token || !communityBase || !selectedChannelIdRef.current) {
      if (!canAttachFiles) {
        setStatusError("You do not have permission to upload files.");
      }
      return;
    }

    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;

    const channelId = selectedChannelIdRef.current;
    const uploadUrl = `${communityBase}/api/files/upload`;

    const uploadFile = (file, uploadId) =>
      new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("channelId", channelId);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl);
        if (token) {
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        }
        xhr.responseType = "json";

        xhr.upload.onprogress = (progressEvent) => {
          if (!progressEvent.lengthComputable) return;
          const percent = Math.min(Math.max(Math.round((progressEvent.loaded / progressEvent.total) * 100), 0), 100);
          setUploadQueue((prev) =>
            prev.map((item) => (item.id === uploadId ? { ...item, progress: percent } : item))
          );
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.response);
          } else {
            const message = xhr.response?.error || xhr.response?.message || `Upload failed (${xhr.status})`;
            reject(new Error(message));
          }
        };

        xhr.onerror = () => {
          reject(new Error("Upload failed"));
        };

        xhr.send(formData);
      });

    for (const file of files) {
      const uploadId = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      setUploadQueue((prev) => [
        ...prev,
        { id: uploadId, name: file.name || "file", progress: 0, status: "uploading" }
      ]);

      try {
        const data = await uploadFile(file, uploadId);
        if (data?.attachment) {
          setPendingAttachments((prev) => [...prev, data.attachment]);
        }
        setUploadQueue((prev) => prev.filter((item) => item.id !== uploadId));
      } catch (error) {
        setUploadQueue((prev) =>
          prev.map((item) =>
            item.id === uploadId
              ? { ...item, status: "error", error: error.message || "Upload failed" }
              : item
          )
        );
        setStatusError(error.message || "Upload failed");
      }
    }
  };

  const copyMessageContent = async (message) => {
    if (!message.content) return;

    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      setStatusError("Failed to copy message");
    }
  };

  const showToast = useCallback((message, type = "success") => {
    const id = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const toast = { id, message, type };

    setToastNotifications((prev) => [...prev, toast]);

    setTimeout(() => {
      setToastNotifications((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const handleMessageScroll = useCallback(() => {
    const container = messageListRef.current;
    if (!container) return;

    const threshold = 150;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setIsAtBottom(isNearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = messageListRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setIsAtBottom(true);
  }, []);

  const downloadAttachment = useCallback(
    async (attachment) => {
      if (!attachment?.url) return;
      try {
        const url = toAbsoluteUrl(attachment.url, communityBase);
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const response = await fetch(url, { headers });
        if (!response.ok) {
          throw new Error("Download failed.");
        }
        const blob = await response.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = attachment.name || "download";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      } catch (error) {
        setStatusError(error.message || "Download failed.");
      }
    },
    [communityBase, token]
  );

  const memberById = useMemo(() => {
    const map = new Map();
    if (selectedGuild?.members) {
      for (const member of selectedGuild.members) {
        if (member?.id) {
          map.set(member.id, member);
        }
      }
    }
    return map;
  }, [selectedGuild?.members]);

  const usernameById = useMemo(() => {
    const map = new Map();
    if (user) {
      map.set(user.id, user.username);
    }
    if (selectedGuild?.members) {
      for (const member of selectedGuild.members) {
        if (member?.id) {
          map.set(member.id, member.nickname || member.username || `User ${String(member.id).slice(0, 6)}`);
        }
      }
    }
    for (const [id, name] of Object.entries(voiceUsernames)) {
      map.set(id, name);
    }
    return map;
  }, [selectedGuild?.members, user, voiceUsernames]);

  const formatUser = useCallback(
    (sessionId, userId) => {
      if (sessionId && voiceUsernames[sessionId]) {
        return voiceUsernames[sessionId];
      }
      if (userId && voiceUsernames[userId]) {
        return voiceUsernames[userId];
      }
      if (sessionId && sessionId === socketIdRef.current) {
        return currentMember?.nickname || user?.username || "You";
      }
      if (userId && usernameById.get(userId)) {
        return usernameById.get(userId);
      }
      if (sessionId && usernameById.get(sessionId)) {
        return usernameById.get(sessionId);
      }
      const fallbackId = userId || sessionId;
      return `User ${String(fallbackId || "").slice(0, 6)}`;
    },
    [currentMember?.nickname, user?.username, usernameById, voiceUsernames]
  );

  const channelPermissions = useMemo(() => {
    const map = new Map();
    if (!selectedGuild || !currentMember) return map;
    for (const channel of channels) {
      map.set(channel.id, computeMemberPermissions({ guild: selectedGuild, member: currentMember, channel }));
    }
    return map;
  }, [channels, currentMember, selectedGuild]);

  const canViewSelected =
    selectedChannel && (channelPermissions.get(selectedChannel.id) & PERMISSIONS.VIEW_CHANNELS) === PERMISSIONS.VIEW_CHANNELS;

  const viewableChannels = useMemo(() => {
    if (!channels.length) return [];
    return channels.filter((channel) => {
      const perms = channelPermissions.get(channel.id) || 0;
      return (perms & PERMISSIONS.VIEW_CHANNELS) === PERMISSIONS.VIEW_CHANNELS;
    });
  }, [channelPermissions, channels]);

  const sortedChannels = useMemo(() => {
    const list = [...viewableChannels];
    list.sort((a, b) => {
      const posA = Number.isInteger(a.position) ? a.position : 0;
      const posB = Number.isInteger(b.position) ? b.position : 0;
      if (posA !== posB) return posA - posB;
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
    return list;
  }, [viewableChannels]);

  const categoryChannels = sortedChannels.filter((channel) => channel.type === "category");

  const channelGroups = useMemo(() => {
    const visibleCategoryIds = new Set();
    for (const channel of sortedChannels) {
      if (channel.categoryId) {
        visibleCategoryIds.add(channel.categoryId);
      }
    }

    const groups = [];
    for (const category of categoryChannels) {
      const perms = channelPermissions.get(category.id) || 0;
      if (!visibleCategoryIds.has(category.id) && (perms & PERMISSIONS.VIEW_CHANNELS) !== PERMISSIONS.VIEW_CHANNELS) {
        continue;
      }
      groups.push({
        id: category.id,
        name: category.name,
        category,
        channels: sortedChannels.filter((channel) => channel.type !== "category" && channel.categoryId === category.id)
      });
    }

    const ungrouped = sortedChannels.filter((channel) => channel.type !== "category" && !channel.categoryId);
    if (ungrouped.length || canManageChannels) {
      groups.push({ id: "none", name: "Channels", category: null, channels: ungrouped });
    }

    return groups;
  }, [canManageChannels, categoryChannels, channelPermissions, sortedChannels]);

  useEffect(() => {
    if (!selectedChannelId || !selectedChannel) return;
    if (!currentMember || !selectedGuild) return;
    if (!canViewSelected) {
      setSelectedChannelId(null);
    }
  }, [canViewSelected, currentMember, selectedChannel, selectedChannelId, selectedGuild]);

  const getVoiceVolumePercent = useCallback(
    (userId) => {
      const value = voiceVolumes[userId];
      if (!Number.isFinite(value)) return 100;
      return Math.min(Math.max(Math.round(value), 0), 100);
    },
    [voiceVolumes]
  );

  const getVoiceVolume = useCallback(
    (userId) => getVoiceVolumePercent(userId) / 100,
    [getVoiceVolumePercent]
  );

  const setVoiceVolumePercent = useCallback((userId, value) => {
    if (!userId) return;
    const numeric = Number(value);
    const percent = Number.isFinite(numeric) ? Math.min(Math.max(Math.round(numeric), 0), 100) : 100;
    setVoiceVolumes((prev) => ({ ...prev, [userId]: percent }));
  }, []);

  const memberList = useMemo(() => {
    const ids = new Set(selectedGuild?.memberIds || []);
    if (selectedGuild?.members?.length) {
      for (const member of selectedGuild.members) {
        if (member?.id) ids.add(member.id);
      }
    }

    const roleMap = new Map();
    if (selectedGuild?.roles) {
      for (const role of selectedGuild.roles) {
        roleMap.set(role.id, role);
      }
    }

    return [...ids]
      .map((id) => {
        const member = memberById.get(id);
        const roleIds = member?.roleIds || [];
        const roles = roleIds.map((roleId) => roleMap.get(roleId)).filter(Boolean);
        const topRole = roles.sort((a, b) => (b.position || 0) - (a.position || 0))[0] || null;
        return {
          id,
          name: formatUser(id, id),
          color: topRole?.color || "",
          roles
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [formatUser, memberById, selectedGuild]);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      }),
    []
  );

  const formatTimestamp = useCallback(
    (value) => {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";

      const now = Date.now();
      const diff = now - date.getTime();
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (seconds < 30) return "just now";
      if (seconds < 60) return `${seconds} seconds ago`;
      if (minutes === 1) return "1 minute ago";
      if (minutes < 60) return `${minutes} minutes ago`;
      if (hours === 1) return "1 hour ago";
      if (hours < 24) return `${hours} hours ago`;
      if (days === 1) return "yesterday";
      if (days < 7) return `${days} days ago`;

      // For older messages, show full date and time
      return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
        hour: "numeric",
        minute: "2-digit"
      });
    },
    [timeFormatter]
  );
  const outputSelectionDisabled = !supportsOutputSelection || audioOutputs.length === 0;
  const micDetectionThreshold = Math.min(Math.max(Number(settingsDraft.voiceActivationThreshold || 8), 1), 100);
  const micDetected = inputLevelPercent >= micDetectionThreshold;
  const micThresholdStyle = { left: `${micDetectionThreshold}%` };
  const micMonitorLabel = micMonitorActive
    ? joinedVoiceChannelId
      ? "Monitoring active voice input."
      : micTestActive
        ? "Mic test is running."
        : "Monitoring input."
    : "Mic monitor is off.";
  const activeVoiceVolumePercent = voiceVolumeMenu.open ? getVoiceVolumePercent(voiceVolumeMenu.userId) : 100;

  if (backendStatus !== "online") {
    const displayBase = resolvedAuthBase || configuredAuthBase || authBase;
    const message =
      backendStatus === "checking"
        ? "Connecting to Remus backend..."
        : `Cannot reach backend at ${displayBase || "unknown"}`;
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">
            <BrandLogo className="auth-logo" />
            <span>Remus</span>
          </h1>
          <p>{message}</p>
          {backendStatus === "offline" ? (
            <div className="settings-inline">
              <button type="button" onClick={() => void checkBackend()}>
                Retry
              </button>
              <button type="button" className="secondary-btn" onClick={openBackendSettings}>
                Change Backend URL
              </button>
            </div>
          ) : null}
          {backendError ? <div className="error-box">{backendError}</div> : null}
        </div>

        {backendSettingsOpen ? (
          <div
            className="settings-overlay"
            onClick={(event) => (event.target === event.currentTarget ? closeBackendSettings() : null)}
          >
            <div className="add-server-modal">
              <h2>Backend URL</h2>
              <p>Enter the URL for your Remus backend.</p>
              <input
                value={backendSettingsValue}
                onChange={(event) => setBackendSettingsValue(event.target.value)}
                placeholder="http://api-remus.com:3001"
              />
              {backendSettingsError ? <div className="error-box">{backendSettingsError}</div> : null}
              <div className="settings-inline">
                <button type="button" className="secondary-btn" onClick={closeBackendSettings}>
                  Cancel
                </button>
                <button type="button" onClick={saveBackendSettings}>
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (token && !user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">
            <BrandLogo className="auth-logo" />
            <span>Remus</span>
          </h1>
          <p>Loading session...</p>
        </div>
      </div>
    );
  }

  const accountRecoveryModal = accountRecoveryOpen ? (
    <div className="settings-overlay" onClick={(event) => (event.target === event.currentTarget ? closeAccountRecovery() : null)}>
      <div className="add-server-modal">
        <h2>Recover Account</h2>
        <p>Enter your secret username and recovery key to set a new password.</p>
        <form onSubmit={handleAccountRecoverySubmit} className="add-server-form">
          <input
            value={accountRecoveryForm.loginName}
            onChange={(event) => setAccountRecoveryForm((prev) => ({ ...prev, loginName: event.target.value }))}
            placeholder="Secret username"
            autoFocus
          />
          <input
            value={accountRecoveryForm.recoveryKey}
            onChange={(event) => setAccountRecoveryForm((prev) => ({ ...prev, recoveryKey: event.target.value }))}
            placeholder="Recovery key"
          />
          <input
            type="password"
            value={accountRecoveryForm.password}
            onChange={(event) => setAccountRecoveryForm((prev) => ({ ...prev, password: event.target.value }))}
            placeholder="New password"
          />
          <input
            type="password"
            value={accountRecoveryForm.confirm}
            onChange={(event) => setAccountRecoveryForm((prev) => ({ ...prev, confirm: event.target.value }))}
            placeholder="Confirm new password"
          />
          <div className="add-server-actions">
            <button type="button" className="secondary-btn" onClick={closeAccountRecovery}>
              Cancel
            </button>
            <button type="submit">Reset Password</button>
          </div>
        </form>
        {accountRecoveryError ? <div className="settings-error">{accountRecoveryError}</div> : null}
      </div>
    </div>
  ) : null;

  const recoveryKeyModal = recoveryKeyOpen ? (
    <div className="settings-overlay">
      <div className="add-server-modal">
        <h2>Save Your Recovery Key</h2>
        <p>This key is shown once. Store it somewhere safe to recover your account later.</p>
        <div className="recovery-key-box">{recoveryKeyValue}</div>
        <div className="add-server-actions">
          <button type="button" className="secondary-btn" onClick={copyRecoveryKey}>
            Copy Key
          </button>
          <button
            type="button"
            onClick={() => {
              setRecoveryKeyOpen(false);
              setRecoveryKeyValue("");
              setRecoveryKeyNotice("");
            }}
          >
            I Saved It
          </button>
        </div>
        {recoveryKeyNotice ? <div className="settings-notice">{recoveryKeyNotice}</div> : null}
      </div>
    </div>
  ) : null;

  const confirmationDialog = confirmDialog.open ? (
    <div className="settings-overlay" onClick={closeConfirmDialog}>
      <div className="add-server-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{confirmDialog.title}</h2>
        <p>{confirmDialog.message}</p>
        <div className="add-server-actions">
          <button type="button" className="secondary-btn" onClick={closeConfirmDialog}>
            {confirmDialog.cancelText}
          </button>
          <button type="button" className={confirmDialog.danger ? "danger" : ""} onClick={handleConfirmAction}>
            {confirmDialog.confirmText}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (!token) {
    return (
      <>
        <AuthView
          mode={authMode}
          setMode={setAuthMode}
          form={authForm}
          setForm={setAuthForm}
          onSubmit={handleAuthSubmit}
          onRecover={openAccountRecovery}
          error={authError}
        />
        {accountRecoveryModal}
        {recoveryKeyModal}
      </>
    );
  }

  return (
    <div className="app-shell">
      <aside className="guild-sidebar" aria-label="Server list">
        <button type="button" className="brand" title="Remus Home">
          <BrandLogo className="brand-logo" />
        </button>
        <div className="guild-list">
          {joinedServers.map((server) => (
            <button
              type="button"
              key={server.id}
              className={server.id === selectedServerId ? "guild-btn active" : "guild-btn"}
              onClick={() => handleSelectServer(server.id)}
              title={server.name || (server.code ? `remus(${server.code})` : "Remus server")}
            >
              <GuildIcon
                iconUrl={server.iconUrl ? toAbsoluteUrl(server.iconUrl, server.url) : ""}
                fallback={initials(server.name || (server.code ? `remus(${server.code})` : "Remus"))}
              />
            </button>
          ))}
          <button type="button" className="guild-btn add-server-btn" onClick={openAddServerModal} title="Add Server">
            +
          </button>
        </div>
      </aside>

      <aside className="channel-sidebar" aria-label="Channels and user controls">
        <header className="server-header">
          <h2>{selectedGuild?.name || selectedServer?.name || "No server selected"}</h2>
          <span className="guild-id">
            {communityBase ? `Node: ${serverDisplayUrl || "Remus node"}` : "Use + to add a server ID or URL"}
          </span>
          <span className={`community-state ${communityStatus}`}>
            {communityStatus === "connecting"
              ? "Connecting..."
              : communityStatus === "connected"
                ? "Connected"
                : "Disconnected"}
          </span>
          {selectedGuild ? <span className="guild-id">ID: {selectedGuild.id.slice(0, 8)}</span> : null}
          {selectedServerId ? (
            <button type="button" className="secondary-btn remove-server-btn" onClick={handleRemoveServer}>
              Remove Server
            </button>
          ) : null}
          {selectedServerId && (canManageRoles || canManageServer || canViewAudit) ? (
            <button type="button" className="secondary-btn remove-server-btn" onClick={openServerSettings}>
              Server Settings
            </button>
          ) : null}
        </header>

        <div className="channel-scroll" onContextMenu={openChannelMenu}>
          {!communityBase ? (
            <div className="empty-hint">No server selected. Click + in the left rail to add a server ID or URL.</div>
          ) : null}

          {communityBase && communityStatus === "connected" && guilds.length === 0 ? (
            <div className="empty-hint">Connected to node, but no communities are available for this account yet.</div>
          ) : null}

          <section className="channel-group">
            {channelGroups.map((group) => (
              <div key={group.id} className="channel-category">
                {group.id !== "none" ? (
                  <div
                    className="category-header"
                    draggable={canManageChannels}
                    onDragStart={(event) => handleDragStart(event, group.category)}
                    onDragOver={handleDragOver}
                    onDrop={(event) => handleDropOnCategory(event, group.category)}
                    onContextMenu={(event) => openChannelContextMenu(event, group.category)}
                  >
                    {group.name}
                  </div>
                ) : group.channels.length || canManageChannels ? (
                  <div
                    className="category-header uncategorized"
                    onDragOver={handleDragOver}
                    onDrop={(event) => handleDropOnCategory(event, null)}
                  >
                    Channels
                  </div>
                ) : null}

                {group.channels.map((channel) => {
                  if (channel.type === "voice") {
                    const presence = voiceChannelState[channel.id] || {};
                    const presenceUsers = Array.isArray(presence.users) ? presence.users : [];
                    const baseIds =
                      presence.userIds && presence.userIds.length
                        ? presence.userIds
                        : presenceUsers.map((entry) => entry?.id).filter(Boolean);
                    const memberIdSet = new Set(baseIds);
                    const localSessionId = socketIdRef.current;
                    if (channel.id === joinedVoiceChannelId && localSessionId) {
                      memberIdSet.add(localSessionId);
                    }
                    const memberIds = [...memberIdSet];
                    const speakingSet = new Set(presence.speakingUserIds || []);
                    if (channel.id === joinedVoiceChannelId && localSessionId && localSpeakingRef.current) {
                      speakingSet.add(localSessionId);
                    }
                    const screenSet = new Set(availableScreenShareIds);
                    const sessionToUserId = new Map(
                      presenceUsers.map((entry) => [entry?.id, entry?.userId || entry?.id]).filter((entry) => entry[0])
                    );
                    if (localSessionId && user?.id) {
                      sessionToUserId.set(localSessionId, user.id);
                    }
                    const members = memberIds.map((id) => {
                      const actualUserId = sessionToUserId.get(id) || id;
                      return {
                        id,
                        userId: actualUserId,
                        name: formatUser(id, actualUserId),
                        speaking: speakingSet.has(id),
                        sharing: screenSet.has(id),
                        color: memberById.get(actualUserId)?.roleIds?.length
                          ? (selectedGuild?.roles || [])
                              .filter((role) => memberById.get(actualUserId)?.roleIds?.includes(role.id))
                              .sort((a, b) => (b.position || 0) - (a.position || 0))[0]?.color || ""
                          : ""
                      };
                    });

                    return (
                      <div
                        key={channel.id}
                        className="voice-channel-wrap"
                        draggable={canManageChannels}
                        onDragStart={(event) => handleDragStart(event, channel)}
                        onDragOver={handleDragOver}
                        onDrop={(event) => handleDropOnChannel(event, channel)}
                        onContextMenu={(event) => openChannelContextMenu(event, channel)}
                      >
                        <button
                          type="button"
                          className={channel.id === joinedVoiceChannelId ? "channel-btn voice active" : "channel-btn voice"}
                          onClick={() => void joinVoiceChannel(channel.id)}
                          draggable={canManageChannels}
                          onDragStart={(event) => handleDragStart(event, channel)}
                        >
                          <span className="channel-icon">V</span>
                          <span>{channel.name}</span>
                          <span className="channel-state">{channel.id === joinedVoiceChannelId ? "LIVE" : "JOIN"}</span>
                        </button>
                        {members.length ? (
                          <div className="voice-members-inline">
                            {members.map((member) => (
                              <div
                                key={member.id}
                                className="voice-member-row"
                                title="Right click to adjust volume"
                                onContextMenu={(event) => openVoiceVolumeMenu(event, member)}
                              >
                                <span className={member.speaking ? "status-dot live speaking" : "status-dot live"} />
                                <span style={member.color ? { color: member.color } : undefined}>{member.name}</span>
                                {member.sharing ? (
                                  <button
                                    type="button"
                                    className={member.id === activeScreenShareUserId ? "screen-share-tag active" : "screen-share-tag"}
                                    onClick={() => setActiveScreenShareUserId(member.id)}
                                  >
                                    Screen
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {channel.id === joinedVoiceChannelId ? (
                          <div className="voice-actions-inline">
                            <button type="button" onClick={() => void startScreenShare()} disabled={isScreenSharing}>
                              Start Screenshare
                            </button>
                            <button type="button" onClick={() => void stopScreenShare()} disabled={!isScreenSharing}>
                              Stop Screenshare
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  const hasUnread = unreadChannels.has(channel.id);
                  return (
                    <button
                      type="button"
                      key={channel.id}
                      className={`${channel.id === selectedChannelId ? "channel-btn active" : "channel-btn"}${hasUnread ? " unread" : ""}`}
                      onClick={() => setSelectedChannelId(channel.id)}
                      draggable={canManageChannels}
                      onDragStart={(event) => handleDragStart(event, channel)}
                      onDragOver={handleDragOver}
                      onDrop={(event) => handleDropOnChannel(event, channel)}
                      onContextMenu={(event) => openChannelContextMenu(event, channel)}
                    >
                      <span className="channel-icon">#</span>
                      <span>{channel.name}</span>
                      {hasUnread && <span className="unread-indicator" />}
                    </button>
                  );
                })}
                {group.channels.length === 0 && !canManageChannels ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">#</div>
                    <div className="empty-state-title">No channels</div>
                    <div className="empty-state-description">There are no channels in this category yet.</div>
                  </div>
                ) : null}
              </div>
            ))}
            {channelGroups.every((g) => g.channels.length === 0) && !canManageChannels ? (
              <div className="empty-state">
                <div className="empty-state-icon">#</div>
                <div className="empty-state-title">No channels available</div>
                <div className="empty-state-description">This server doesn't have any channels yet.</div>
              </div>
            ) : null}
            {joinedVoiceChannelId ? (
              <button type="button" className="channel-btn leave" onClick={leaveVoiceChannel}>
                Leave Voice
              </button>
            ) : null}
          </section>
        </div>

        <div className="user-bar">
          <div className="avatar">{initials(user.username)}</div>
          <div className="user-meta">
            <strong>{user.username}</strong>
            <span>{joinedVoiceChannelId ? "In voice" : "Online"}</span>
          </div>
          <button type="button" className="secondary user-settings" onClick={openSettings}>
            Settings
          </button>
          <button type="button" className="danger user-logout" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </aside>

      <main
        className="chat-pane"
        role="main"
        onDragEnter={handleChatDragEnter}
        onDragOver={handleChatDragOver}
        onDragLeave={handleChatDragLeave}
        onDrop={handleChatFileDrop}
      >
        {isDraggingFile && canAttachFiles && (
          <div className="drag-overlay">
            <div className="drag-overlay-content">
              <div className="drag-icon">📎</div>
              <div>Drop files to upload</div>
            </div>
          </div>
        )}
        <header className="chat-header">
          <div>
            <h2>{selectedChannel ? `# ${selectedChannel.name}` : "Select a channel"}</h2>
            <span className="chat-topic">Remus community chat</span>
          </div>
          <div className="search-box">
            <input
              ref={messageSearchRef}
              type="text"
              placeholder="Search messages (Ctrl+F)"
              value={messageSearchQuery}
              onChange={(e) => setMessageSearchQuery(e.target.value)}
              className="message-search-input"
            />
            {messageSearchQuery && (
              <button
                type="button"
                className="search-clear"
                onClick={() => {
                  setMessageSearchQuery("");
                  messageSearchRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <span className="header-user">{user.username}</span>
        </header>

        {screenPreviewStream || screenStreams.length ? (
          <div className="media-strip">
            {activeScreenShareUserId ? (
              activeScreenShareUserId === socketIdRef.current ? (
                screenPreviewStream ? (
                  <div className="screen-preview">
                    <strong>Your shared screen</strong>
                    <button type="button" className="fullscreen-btn" onClick={() => requestFullscreen(screenPreviewRef.current)}>
                      Fullscreen
                    </button>
                    <video ref={screenPreviewRef} autoPlay playsInline muted className="remote-video" />
                  </div>
                ) : null
              ) : (
                (() => {
                  const entry = screenStreams.find((item) => item.userId === activeScreenShareUserId);
                  if (!entry) return null;
                  return (
                    <StreamCard
                      key={entry.userId}
                      userLabel={`${formatUser(entry.userId)} (Screen)`}
                      stream={entry.stream}
                      outputDeviceId={clientSettings.audioOutputId}
                      muted={serverDeafened}
                      volume={getVoiceVolume(entry.userId)}
                    />
                  );
                })()
              )
            ) : null}
          </div>
        ) : null}

        <div className="audio-hidden">
          <audio ref={voiceJoinAudioRef} preload="auto" />
          <audio ref={voiceLeaveAudioRef} preload="auto" />
          {remoteStreams.map(({ userId, stream }) => (
            <audio
              key={userId}
              ref={(node) => {
                if (!node) return;
                node.srcObject = stream;
                node.volume = getVoiceVolume(userId);
                if (clientSettings.audioOutputId && typeof node.setSinkId === "function") {
                  node.setSinkId(clientSettings.audioOutputId).catch(() => {});
                }
              }}
              autoPlay
              muted={clientSettings.deafenOnJoin || serverDeafened}
            />
          ))}
        </div>

        <div className="message-list" ref={messageListRef} onScroll={handleMessageScroll}>
          {messagesLoading ? (
            <div className="loading-messages">
              <div className="loading-spinner"></div>
              <p>Loading messages...</p>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="no-messages">
              <p>No messages yet. Start the conversation!</p>
            </div>
          ) : null}
          {!messagesLoading && filteredMessages.map((message) => {
            return (
              <article key={message.id} className="message-row">
                <div className="avatar message-avatar">{initials(message.author?.username || "Unknown")}</div>
                <div className="message-content">
                  <div className="message-head">
                      <strong>{message.author?.nickname || message.author?.username || "Unknown"}</strong>
                      <time>{formatTimestamp(message.createdAt)}</time>
                      {message.content && (
                        <button
                          type="button"
                          className="copy-message-btn"
                          onClick={() => copyMessageContent(message)}
                          aria-label="Copy message"
                          title={copiedMessageId === message.id ? "Copied!" : "Copy message"}
                        >
                          {copiedMessageId === message.id ? "✓" : "📋"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="reply-message-btn"
                        onClick={() => handleReplyClick(message)}
                        aria-label="Reply to message"
                        title="Reply to message"
                      >
                        ↩️
                      </button>
                      {message.author?.id === user?.id && (
                        <button
                          type="button"
                          className="edit-message-btn"
                          onClick={() => startEditingMessage(message)}
                          aria-label="Edit message"
                          title="Edit message"
                        >
                          ✏️
                        </button>
                      )}
                      {(canManageMessages || message.author?.id === user?.id) && (
                        <button
                          type="button"
                          className="delete-message-btn"
                          onClick={() => deleteMessage(message)}
                          aria-label="Delete message"
                          title="Delete message"
                        >
                          🗑️
                        </button>
                      )}
                  </div>

                  {/* Reply indicator */}
                  {message.replyTo && (
                    <div className="message-reply-to">
                      <span className="reply-icon">↩️</span>
                      <span className="reply-author">{message.replyTo.author?.username || "Unknown"}</span>
                      <span className="reply-content">{message.replyTo.content?.substring(0, 50)}{message.replyTo.content?.length > 50 ? "..." : ""}</span>
                    </div>
                  )}

                  {editingMessageId === message.id ? (
                    <div className="message-edit-form">
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            cancelEditingMessage();
                          } else if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void saveEditedMessage(message.id);
                          }
                        }}
                        autoFocus
                        rows="3"
                      />
                      <div className="message-edit-actions">
                        <button type="button" className="secondary-btn" onClick={cancelEditingMessage}>
                          Cancel
                        </button>
                        <button type="button" className="primary-btn" onClick={() => void saveEditedMessage(message.id)}>
                          Save
                        </button>
                      </div>
                    </div>
                  ) : message.content ? (
                    <p>{message.content}{message.edited ? <span className="edited-label"> (edited)</span> : null}</p>
                  ) : null}
                  {Array.isArray(message.attachments) && message.attachments.length ? (
                    <ul className="attachments">
                      {message.attachments.map((file) => {
                        const fileName = file.name || "";
                        const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);
                        const absoluteAttachmentUrl = toAbsoluteUrl(file.url, communityBase);
                        const secureAttachmentUrl = withTokenQuery(absoluteAttachmentUrl, token);

                        if (isImage) {
                          return (
                            <li key={file.id || file.url}>
                              <img
                                src={secureAttachmentUrl}
                                alt={fileName}
                                className="message-image"
                                draggable={false}
                              />
                              <button type="button" className="file-download image-download" onClick={() => void downloadAttachment(file)}>
                                Download {fileName || "image"}
                              </button>
                            </li>
                          );
                        }

                        return (
                          <li key={file.id || file.url}>
                            <button type="button" className="file-download" onClick={() => void downloadAttachment(file)}>
                              {fileName || "Attachment"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  {/* Reactions */}
                  {message.reactions && Object.keys(message.reactions).length > 0 && (
                    <div className="message-reactions">
                      {Object.entries(message.reactions).map(([emoji, users]) => {
                        const hasReacted = users.includes(user?.id);
                        const count = users.length;
                        return (
                          <button
                            key={emoji}
                            type="button"
                            className={hasReacted ? "reaction-btn reacted" : "reaction-btn"}
                            onClick={() => toggleReaction(message.id, emoji)}
                            title={`${count} reaction${count > 1 ? "s" : ""}`}
                          >
                            {emoji} {count}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Emoji Picker */}
                  <div className="message-actions">
                    <button
                      type="button"
                      className="add-reaction-btn"
                      onClick={() => setShowEmojiPicker(showEmojiPicker === message.id ? null : message.id)}
                      aria-label="Add reaction"
                      title="Add reaction"
                    >
                      😊
                    </button>
                    {showEmojiPicker === message.id && (
                      <div className="emoji-picker">
                        {REACTION_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className="emoji-option"
                            onClick={() => {
                              toggleReaction(message.id, emoji);
                              setShowEmojiPicker(null);
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {!isAtBottom && (
          <button type="button" className="jump-to-bottom" onClick={scrollToBottom} aria-label="Jump to latest message">
            ↓ New Messages
          </button>
        )}

        {Object.keys(typingUsers).length ? (
          <div className="typing" aria-live="polite" aria-atomic="true">{Object.values(typingUsers).join(", ")} typing...</div>
        ) : (
          <div className="typing" aria-live="polite" aria-atomic="true">&nbsp;</div>
        )}

        {/* {replyingTo && (
          <div className="reply-preview">
            <div className="reply-preview-content">
              <span className="reply-preview-label">Replying to {replyingTo.author?.name || "Unknown"}</span>
              <p className="reply-preview-text">{(replyingTo.content || "").substring(0, 100)}{(replyingTo.content || "").length > 100 ? "..." : ""}</p>
            </div>
            <button
              type="button"
              className="reply-preview-close"
              onClick={() => setReplyingTo(null)}
              aria-label="Cancel reply"
              title="Cancel reply"
            >
              ✕
            </button>
          </div>
        )} */}

        <form className="composer" onSubmit={handleSendMessage}>
          <label className={`file-btn ${canAttachFiles ? "" : "disabled"}`} htmlFor="file-upload" aria-label="Attach files">
            +
          </label>
          <input
            id="file-upload"
            type="file"
            multiple
            onChange={handleFileUpload}
            disabled={!selectedChannelId || !communityBase || !canAttachFiles}
            hidden
            aria-label="File upload"
          />
          <textarea
            value={compose}
            onChange={handleComposeChange}
            onKeyDown={(e) => {
              // // Handle mention navigation
              // if (mentionSuggestions.length > 0) {
              //   if (e.key === "ArrowDown") {
              //     e.preventDefault();
              //     setSelectedMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
              //     return;
              //   } else if (e.key === "ArrowUp") {
              //     e.preventDefault();
              //     setSelectedMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
              //     return;
              //   } else if (e.key === "Enter" || e.key === "Tab") {
              //     e.preventDefault();
              //     const selected = mentionSuggestions[selectedMentionIndex];
              //     if (selected) {
              //       insertMention(selected, e.target);
              //     }
              //     return;
              //   } else if (e.key === "Escape") {
              //     setMentionSuggestions([]);
              //     return;
              //   }
              // }

              // Normal Enter handling
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(e);
              }
            }}
            placeholder={
              !communityBase
                ? "Connect to a community server"
                : selectedChannelId
                  ? `Message #${selectedChannel?.name || "channel"} (Shift+Enter for new line, @ to mention)`
                  : "Select channel"
            }
            disabled={!selectedChannelId || !communityBase || !canSendMessages}
            aria-label={selectedChannel ? `Message ${selectedChannel.name}` : "Message input"}
            rows="1"
          />

          {/* Mention Suggestions */}
          {mentionSuggestions.length > 0 && (
            <div className="mention-suggestions">
              {mentionSuggestions.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className="mention-option"
                  onClick={() => {
                    const textarea = document.querySelector('textarea[aria-label*="Message"]');
                    insertMention(member, textarea);
                  }}
                >
                  <span className="mention-avatar">{(member.username || "?").substring(0, 2).toUpperCase()}</span>
                  <span className="mention-name">{member.username}</span>
                </button>
              ))}
            </div>
          )}

          {/* Reply Preview */}
          {replyingTo && (
            <div className="reply-preview">
              <div className="reply-preview-content">
                <span className="reply-preview-label">Replying to {replyingTo.author?.username || "Unknown"}</span>
                <span className="reply-preview-text">{replyingTo.content?.substring(0, 50)}{replyingTo.content?.length > 50 ? "..." : ""}</span>
              </div>
              <button
                type="button"
                className="reply-preview-close"
                onClick={cancelReply}
                aria-label="Cancel reply"
              >
                ×
              </button>
            </div>
          )}

          <button type="submit" disabled={!selectedChannelId || !communityBase || !canSendMessages || messageSending}>
            {messageSending ? "Sending..." : "Send"}
          </button>
        </form>

        {uploadQueue.length ? (
          <div className="upload-queue">
            {uploadQueue.map((item) => (
              <div key={item.id} className={`upload-row ${item.status === "error" ? "error" : ""}`}>
                <span className="upload-name">{item.name}</span>
                <div className="upload-bar">
                  <div className="upload-bar-fill" style={{ width: `${item.progress || 0}%` }} />
                </div>
                <span className="upload-percent">{item.progress || 0}%</span>
                {item.status === "error" ? <span className="upload-error">{item.error || "Upload failed"}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {pendingAttachments.length ? (
          <div className="pending-files">
            {pendingAttachments.map((file) => (
              <span key={file.id}>{file.name}</span>
            ))}
          </div>
        ) : null}
      </main>

      <aside className="member-pane" aria-label="Member list">
        <div className="member-pane-header">
          <h3>Members</h3>
          <span>{memberList.length}</span>
        </div>
        <ul className="member-list">
          {memberList.length > 0 ? (
            memberList.map((member) => {
              const isInVoice = Object.values(voiceChannelState).some((state) =>
                state.users?.some((u) => u?.userId === member.id || u?.id === member.id)
              );
              const statusClass = isInVoice ? "status-dot online" : "status-dot idle";

              return (
                <li key={member.id} className="member-row">
                  <span className={statusClass} title={isInVoice ? "Online - In voice" : "Idle"} />
                  <span style={member.color ? { color: member.color } : undefined}>{member.name}</span>
                  {member.roles?.length ? <span className="role-pill">{member.roles[0].name}</span> : null}
                </li>
              );
            })
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">👥</div>
              <div className="empty-state-title">No members</div>
              <div className="empty-state-description">No members are currently in this server.</div>
            </div>
          )}
        </ul>
      </aside>

      {channelMenu.open ? (
        <div className="context-overlay" onClick={closeChannelMenu} onContextMenu={(event) => event.preventDefault()}>
          <div className="context-menu" style={{ left: channelMenu.x, top: channelMenu.y }}>
            <button
              type="button"
              onClick={() => {
                closeChannelMenu();
                openCreateChannelModal("text");
              }}
            >
              Create Text Channel
            </button>
            <button
              type="button"
              onClick={() => {
                closeChannelMenu();
                openCreateChannelModal("category");
              }}
            >
              Create Category
            </button>
            <button
              type="button"
              onClick={() => {
                closeChannelMenu();
                openCreateChannelModal("voice");
              }}
            >
              Create Voice Channel
            </button>
          </div>
        </div>
      ) : null}

      {channelContextMenu.open ? (
        <div className="context-overlay" onClick={closeChannelContextMenu} onContextMenu={(event) => event.preventDefault()}>
          <div
            className="context-menu"
            style={{ left: channelContextMenu.x, top: channelContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const target = channelContextMenu.channel;
                closeChannelContextMenu();
                if (target) {
                  openChannelSettings(target);
                }
              }}
            >
              {channelContextMenu.channel?.type === "category" ? "Edit Category" : "Edit Channel"}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                const target = channelContextMenu.channel;
                closeChannelContextMenu();
                if (target) {
                  void deleteChannel(target);
                }
              }}
            >
              {channelContextMenu.channel?.type === "category" ? "Delete Category" : "Delete Channel"}
            </button>
          </div>
        </div>
      ) : null}

      {voiceVolumeMenu.open ? (
        <div className="context-overlay" onClick={closeVoiceVolumeMenu} onContextMenu={(event) => event.preventDefault()}>
          <div
            className="context-menu volume-menu"
            style={{ left: voiceVolumeMenu.x, top: voiceVolumeMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="volume-menu-title">Volume: {voiceVolumeMenu.name}</div>
            <div className="volume-slider-row">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={activeVoiceVolumePercent}
                onChange={(event) => setVoiceVolumePercent(voiceVolumeMenu.userId, event.target.value)}
              />
              <span>{activeVoiceVolumePercent}%</span>
            </div>
            <div className="volume-menu-actions">
              <button type="button" onClick={() => setVoiceVolumePercent(voiceVolumeMenu.userId, 100)}>
                Reset
              </button>
              <button type="button" onClick={() => setVoiceVolumePercent(voiceVolumeMenu.userId, 0)}>
                Mute
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createChannelOpen ? (
        <div className="settings-overlay" onClick={(event) => (event.target === event.currentTarget ? closeCreateChannelModal() : null)}>
          <div className="add-server-modal">
            <h2>Create Channel</h2>
            <p>Right-click the channel list anytime to open this menu again.</p>
            <form onSubmit={handleCreateChannel} className="add-server-form">
              <input
                value={newChannelName}
                onChange={(event) => setNewChannelName(event.target.value)}
                placeholder="Channel name"
                autoFocus
                aria-label="Channel name"
              />
              <select value={newChannelType} onChange={(event) => setNewChannelType(event.target.value)} aria-label="Channel type">
                <option value="text">Text</option>
                <option value="voice">Voice</option>
                <option value="category">Category</option>
              </select>
              <div className="add-server-actions">
                <button type="button" className="secondary-btn" onClick={closeCreateChannelModal}>
                  Cancel
                </button>
                <button type="submit" disabled={!communityBase || !selectedGuildId}>
                  Create Channel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {screenPickerOpen ? (
        <div className="settings-overlay" onClick={(event) => (event.target === event.currentTarget ? closeScreenPicker() : null)}>
          <div className="add-server-modal">
            <h2>Select Screen or App</h2>
            <p>Choose what you want to share.</p>
            <div className="screen-picker-list">
              {screenSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="screen-source-btn"
                  onClick={() => {
                    closeScreenPicker();
                    void startScreenShareFromSource(source.id);
                  }}
                >
                  {source.name}
                </button>
              ))}
            </div>
            {screenPickerError ? <div className="settings-error">{screenPickerError}</div> : null}
            <div className="add-server-actions">
              <button type="button" className="secondary-btn" onClick={closeScreenPicker}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordResetOpen ? (
        <div className="settings-overlay">
          <div className="add-server-modal">
            <h2>Password Reset Required</h2>
            <p>Set a new password to continue using Remus.</p>
            <form onSubmit={handlePasswordResetSubmit} className="add-server-form">
              <input
                type="password"
                value={passwordResetForm.password}
                onChange={(event) => setPasswordResetForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="New password"
                autoFocus
              />
              <input
                type="password"
                value={passwordResetForm.confirm}
                onChange={(event) => setPasswordResetForm((prev) => ({ ...prev, confirm: event.target.value }))}
                placeholder="Confirm new password"
              />
              <div className="add-server-actions">
                <button type="button" className="secondary-btn" onClick={handleLogout}>
                  Logout
                </button>
                <button type="submit">Update Password</button>
              </div>
            </form>
            {passwordResetError ? <div className="settings-error">{passwordResetError}</div> : null}
          </div>
        </div>
      ) : null}

      {accountRecoveryModal}
      {recoveryKeyModal}
      {confirmationDialog}

      {addServerOpen ? (
        <div className="settings-overlay" onClick={(event) => (event.target === event.currentTarget ? closeAddServerModal() : null)}>
          <div className="add-server-modal">
            <h2>Add Server</h2>
            <p>Enter a Remus server ID like <strong>remus(522d961b)</strong> or a direct URL. You only need to join once.</p>
            <form onSubmit={handleAddServerSubmit} className="add-server-form">
              <input
                value={addServerUrl}
                onChange={(event) => setAddServerUrl(event.target.value)}
                placeholder="remus(522d961b)"
                autoFocus
                aria-label="Server URL or ID"
              />
              <div className="add-server-actions">
                <button type="button" className="secondary-btn" onClick={closeAddServerModal} disabled={addServerBusy}>
                  Cancel
                </button>
                <button type="submit" disabled={addServerBusy}>
                  {addServerBusy ? "Adding..." : "Add Server"}
                </button>
              </div>
            </form>
            {addServerError ? <div className="settings-error">{addServerError}</div> : null}
          </div>
        </div>
      ) : null}

      {serverSettingsOpen ? (
        <div className="settings-overlay" onClick={(event) => (event.target === event.currentTarget ? closeServerSettings() : null)}>
          <div className="server-settings-modal">
            <header className="settings-header">
              <div>
                <h2>Community Settings</h2>
                <p>Manage roles, members, and moderation tools for this server.</p>
              </div>
              <button type="button" className="secondary-btn" onClick={closeServerSettings}>
                Close
              </button>
            </header>

            <div className="server-settings-tabs">
              {canManageRoles ? (
                <button type="button" className={serverSettingsTab === "roles" ? "active" : ""} onClick={() => setServerSettingsTab("roles")}>
                  Roles
                </button>
              ) : null}
              <button type="button" className={serverSettingsTab === "members" ? "active" : ""} onClick={() => setServerSettingsTab("members")}>
                Members
              </button>
              {canViewAudit ? (
                <button type="button" className={serverSettingsTab === "audit" ? "active" : ""} onClick={() => setServerSettingsTab("audit")}>
                  Audit Log
                </button>
              ) : null}
              {canManageServer ? (
                <button type="button" className={serverSettingsTab === "settings" ? "active" : ""} onClick={() => setServerSettingsTab("settings")}>
                  Server
                </button>
              ) : null}
            </div>

            {serverSettingsError ? <div className="settings-error">{serverSettingsError}</div> : null}

            {serverSettingsTab === "roles" && canManageRoles ? (
              <div className="roles-pane">
                <div className="roles-list">
                  {sortedRoles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      className={roleDraft?.id === role.id ? "role-btn active" : "role-btn"}
                      onClick={() => selectRoleDraft(role)}
                    >
                      <span className="role-swatch" style={role.color ? { background: role.color } : undefined} />
                      <span>{role.name}</span>
                    </button>
                  ))}
                  <button type="button" className="role-btn create" onClick={createRole} disabled={roleSaving}>
                    + New Role
                  </button>
                </div>
                <div className="role-editor">
                  {roleDraft ? (
                    <>
                      <div className="role-editor-row">
                        <label>Name</label>
                        <input
                          value={roleDraft.name}
                          onChange={(event) => setRoleDraft((prev) => ({ ...prev, name: event.target.value }))}
                        />
                      </div>
                      <div className="role-editor-row">
                        <label>Color</label>
                        <input
                          type="color"
                          value={roleDraft.color || "#5f6fff"}
                          onChange={(event) => setRoleDraft((prev) => ({ ...prev, color: event.target.value }))}
                        />
                      </div>
                      <div className="role-editor-row">
                        <label>Hoist (show separately)</label>
                        <input
                          type="checkbox"
                          checked={roleDraft.hoist}
                          onChange={(event) => setRoleDraft((prev) => ({ ...prev, hoist: event.target.checked }))}
                        />
                      </div>
                      <div className="role-editor-row">
                        <label>Icon</label>
                        <div className="role-icon-row">
                          {roleDraft.iconUrl ? (
                            <img
                              src={toAbsoluteUrl(roleDraft.iconUrl, communityBase)}
                              alt="Role icon"
                              className="role-icon"
                            />
                          ) : (
                            <span className="role-icon placeholder">R</span>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) {
                                void uploadRoleIcon(roleDraft.id, file);
                              }
                            }}
                          />
                        </div>
                      </div>
                      <div className="perm-grid">
                        {PERMISSION_OPTIONS.map((perm) => (
                          <label key={perm.key} className="perm-row">
                            <input
                              type="checkbox"
                              checked={(roleDraft.permissions & perm.bit) === perm.bit}
                              onChange={() => toggleRolePermission(perm.bit)}
                            />
                            <span>{perm.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="role-actions">
                        <button type="button" className="primary-btn" onClick={saveRoleDraft} disabled={roleSaving}>
                          Save Role
                        </button>
                        {roleDraft.id !== selectedGuildId ? (
                          <button type="button" className="danger" onClick={() => deleteRole(roleDraft.id, roleDraft.name)} disabled={roleSaving}>
                            Delete Role
                          </button>
                        ) : null}
                      </div>
                      {roleDraftError ? <div className="settings-error">{roleDraftError}</div> : null}
                    </>
                  ) : (
                    <div className="empty-hint">Select a role to edit its permissions.</div>
                  )}
                </div>
              </div>
            ) : null}

            {serverSettingsTab === "members" ? (
              <div className="members-pane">
                {membersState.map((member) => {
                  const isBusy = !!memberActionBusy[member.id];
                  const timeoutValue = memberTimeoutDraft[member.id] ?? "";
                  return (
                    <div key={member.id} className="member-row-card">
                      <div className="member-row-head">
                        <strong>{member.nickname || member.username}</strong>
                        <span className="member-sub">{member.id === user?.id ? "You" : "Member"}</span>
                      </div>
                      {canManageRoles ? (
                        <div className="member-roles">
                          {sortedRoles
                            .filter((role) => role.id !== selectedGuildId)
                            .map((role) => {
                              const checked = (member.roleIds || []).includes(role.id);
                              return (
                                <label key={role.id} className="perm-row">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={isBusy}
                                    onChange={(event) => {
                                      const next = event.target.checked
                                        ? [...(member.roleIds || []), role.id]
                                        : (member.roleIds || []).filter((id) => id !== role.id);
                                      void updateMemberRoles(member.id, next);
                                    }}
                                  />
                                  <span>{role.name}</span>
                                </label>
                              );
                            })}
                        </div>
                      ) : null}
                      <div className="member-controls">
                        {canTimeout ? (
                          <div className="member-control">
                            <label>Timeout (minutes)</label>
                            <input
                              type="number"
                              min="0"
                              value={timeoutValue}
                              onChange={(event) =>
                                setMemberTimeoutDraft((prev) => ({ ...prev, [member.id]: event.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="secondary-btn"
                              disabled={isBusy}
                              onClick={() => void updateMemberTimeout(member.id, Number(timeoutValue))}
                            >
                              Apply
                            </button>
                          </div>
                        ) : null}
                        {canMuteMembers ? (
                          <label className="perm-row">
                            <input
                              type="checkbox"
                              checked={!!member.voiceMuted}
                              disabled={isBusy}
                              onChange={(event) => void updateMemberVoice(member.id, { voiceMuted: event.target.checked })}
                            />
                            <span>Muted</span>
                          </label>
                        ) : null}
                        {canDeafenMembers ? (
                          <label className="perm-row">
                            <input
                              type="checkbox"
                              checked={!!member.voiceDeafened}
                              disabled={isBusy}
                              onChange={(event) => void updateMemberVoice(member.id, { voiceDeafened: event.target.checked })}
                            />
                            <span>Deafened</span>
                          </label>
                        ) : null}
                        {canKick ? (
                          <button type="button" className="danger" disabled={isBusy} onClick={() => void kickMember(member.id, member.nickname || member.username)}>
                            Kick
                          </button>
                        ) : null}
                        {canBan ? (
                          <button type="button" className="danger" disabled={isBusy} onClick={() => void banMember(member.id, member.nickname || member.username)}>
                            Ban
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {serverSettingsTab === "audit" && canViewAudit ? (
              <div className="audit-pane">
                {auditState.length ? (
                  auditState.map((entry) => (
                    <div key={entry.id} className="audit-row">
                      <strong>{entry.action}</strong>
                      <span>{entry.actorId}</span>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-hint">No audit entries yet.</div>
                )}
              </div>
            ) : null}

            {serverSettingsTab === "settings" && canManageServer ? (
              <div className="settings-pane">
                <label>Audit log max entries</label>
                <input
                  type="number"
                  min="100"
                  value={serverSettingsState.auditMaxEntries}
                  onChange={(event) =>
                    setServerSettingsState((prev) => ({ ...prev, auditMaxEntries: Number(event.target.value) }))
                  }
                />
                <label>Max timeout minutes</label>
                <input
                  type="number"
                  min="1"
                  value={serverSettingsState.timeoutMaxMinutes}
                  onChange={(event) =>
                    setServerSettingsState((prev) => ({ ...prev, timeoutMaxMinutes: Number(event.target.value) }))
                  }
                />
                <button type="button" className="primary-btn" onClick={saveServerSettings}>
                  Save Settings
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {channelSettingsOpen && channelSettingsChannel ? (
        <div className="settings-overlay" onClick={(event) => (event.target === event.currentTarget ? closeChannelSettings() : null)}>
          <div className="channel-settings-modal">
            <header className="settings-header">
              <div>
                <h2>Channel Settings</h2>
                <p>Customize permissions and organization for this channel.</p>
              </div>
              <button type="button" className="secondary-btn" onClick={closeChannelSettings}>
                Close
              </button>
            </header>

            <div className="settings-group">
              <label>Channel name</label>
              <input value={channelNameDraft} onChange={(event) => setChannelNameDraft(event.target.value)} />
              <label>Category</label>
              <select value={channelCategoryDraft} onChange={(event) => setChannelCategoryDraft(event.target.value)}>
                <option value="">No category</option>
                {categoryChannels.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-group">
              <h3>Role Overrides</h3>
              <select value={channelRoleTarget} onChange={(event) => setChannelRoleTarget(event.target.value)}>
                <option value={selectedGuildId}>@everyone</option>
                {sortedRoles
                  .filter((role) => role.id !== selectedGuildId)
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
              </select>
              <div className="perm-grid">
                {CHANNEL_PERMISSION_OPTIONS.map((perm) => {
                  const entry = channelOverridesDraft.roles?.[channelRoleTarget] || { allow: 0, deny: 0 };
                  const allowChecked = (entry.allow & perm.bit) === perm.bit;
                  const denyChecked = (entry.deny & perm.bit) === perm.bit;
                  return (
                    <div key={perm.key} className="perm-row">
                      <span>{perm.label}</span>
                      <label>
                        <input
                          type="checkbox"
                          checked={allowChecked}
                          onChange={() => updateOverride("roles", channelRoleTarget, perm.bit, "allow")}
                        />
                        Allow
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={denyChecked}
                          onChange={() => updateOverride("roles", channelRoleTarget, perm.bit, "deny")}
                        />
                        Deny
                      </label>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="secondary-btn" onClick={() => clearOverride("roles", channelRoleTarget)}>
                Clear Role Override
              </button>
            </div>

            <div className="settings-group">
              <h3>Member Overrides</h3>
              <select value={channelMemberTarget} onChange={(event) => setChannelMemberTarget(event.target.value)}>
                <option value="">Select member</option>
                {membersState.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.nickname || member.username}
                  </option>
                ))}
              </select>
              {channelMemberTarget ? (
                <>
                  <div className="perm-grid">
                    {CHANNEL_PERMISSION_OPTIONS.map((perm) => {
                      const entry = channelOverridesDraft.members?.[channelMemberTarget] || { allow: 0, deny: 0 };
                      const allowChecked = (entry.allow & perm.bit) === perm.bit;
                      const denyChecked = (entry.deny & perm.bit) === perm.bit;
                      return (
                        <div key={perm.key} className="perm-row">
                          <span>{perm.label}</span>
                          <label>
                            <input
                              type="checkbox"
                              checked={allowChecked}
                              onChange={() => updateOverride("members", channelMemberTarget, perm.bit, "allow")}
                            />
                            Allow
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={denyChecked}
                              onChange={() => updateOverride("members", channelMemberTarget, perm.bit, "deny")}
                            />
                            Deny
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" className="secondary-btn" onClick={() => clearOverride("members", channelMemberTarget)}>
                    Clear Member Override
                  </button>
                </>
              ) : null}
            </div>

            <div className="settings-inline">
              <button type="button" className="primary-btn" onClick={saveChannelSettings}>
                Save Channel
              </button>
              {channelSettingsError ? <span className="settings-error">{channelSettingsError}</span> : null}
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="settings-overlay" onClick={(event) => (event.target === event.currentTarget ? closeSettings() : null)}>
          <div className="settings-modal">
            <header className="settings-header">
              <div>
                <h2>Settings</h2>
                <p>Configure voice devices and important client behavior.</p>
              </div>
              <button type="button" className="secondary-btn" onClick={closeSettings}>
                Close
              </button>
            </header>

            {selectedGuild ? (
              <section className="settings-group">
                <h3>Profile</h3>
                <label htmlFor="nickname">Server Nickname</label>
                <input
                  id="nickname"
                  value={nicknameDraft}
                  onChange={(event) => setNicknameDraft(event.target.value)}
                  placeholder="Optional nickname"
                />
                <div className="settings-inline">
                  <button type="button" className="secondary-btn" onClick={saveNickname}>
                    Save Nickname
                  </button>
                  {nicknameNotice ? <span className="settings-note">{nicknameNotice}</span> : null}
                </div>
              </section>
            ) : null}

            <section className="settings-group">
              <h3>Audio Input</h3>
              <label htmlFor="audio-input">Microphone</label>
              <select
                id="audio-input"
                value={settingsDraft.audioInputId}
                onChange={(event) => setClientSetting("audioInputId", event.target.value)}
              >
                <option value="">System default microphone</option>
                {audioInputs.map((device, index) => (
                  <option key={device.deviceId || `input-${index}`} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </select>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.echoCancellation}
                  onChange={(event) => setClientSetting("echoCancellation", event.target.checked)}
                />
                Echo cancellation
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.noiseSuppression}
                  onChange={(event) => setClientSetting("noiseSuppression", event.target.checked)}
                />
                Noise suppression
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.autoGainControl}
                  onChange={(event) => setClientSetting("autoGainControl", event.target.checked)}
                />
                Automatic gain control
              </label>
            </section>

            <section className="settings-group">
              <h3>Audio Output</h3>
              <label htmlFor="audio-output">Playback device</label>
              <select
                id="audio-output"
                value={settingsDraft.audioOutputId}
                disabled={outputSelectionDisabled}
                onChange={(event) => setClientSetting("audioOutputId", event.target.value)}
              >
                <option value="">System default output</option>
                {audioOutputs.map((device, index) => (
                  <option key={device.deviceId || `output-${index}`} value={device.deviceId}>
                    {device.label || `Speaker ${index + 1}`}
                  </option>
                ))}
              </select>
              {!supportsOutputSelection ? (
                <p className="settings-note">This runtime does not support per-device output routing.</p>
              ) : null}
            </section>

            <section className="settings-group">
              <h3>Microphone Test</h3>
              <p className="settings-note">Speak to verify Remus is receiving your audio.</p>
              <div className="mic-meter settings-meter">
                <span>Input</span>
                <div className="mic-meter-track">
                  <div className={micDetected ? "mic-meter-fill active" : "mic-meter-fill"} style={{ width: `${inputLevelPercent}%` }} />
                  <div className="mic-threshold" style={micThresholdStyle} />
                </div>
                <span className="mic-meter-value">{inputLevelPercent}%</span>
              </div>
              <div className="settings-row">
                <span className={micDetected ? "status-dot live speaking" : "status-dot"} />
                <span>{micDetected ? "Voice detected" : "No voice detected"}</span>
              </div>
              <p className="settings-note">{micMonitorLabel}</p>
              <div className="settings-inline">
                <button type="button" className="secondary-btn" onClick={() => void startMicTest()} disabled={micTestActive}>
                  {micTestActive ? "Mic Test Running" : "Start Mic Test"}
                </button>
                <button type="button" className="secondary-btn" onClick={stopMicTest} disabled={!micTestActive}>
                  Stop Mic Test
                </button>
              </div>
              {micTestError ? <div className="settings-error">{micTestError}</div> : null}
            </section>

            <section className="settings-group">
              <h3>Voice Behavior</h3>
              <label htmlFor="voice-mode">Transmission mode</label>
              <select id="voice-mode" value={settingsDraft.voiceMode} onChange={(event) => setClientSetting("voiceMode", event.target.value)}>
                {VOICE_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              {settingsDraft.voiceMode === "push_to_talk" ? (
                <>
                  <label htmlFor="ptt-key">Push-to-talk key</label>
                  <select id="ptt-key" value={settingsDraft.pushToTalkKey} onChange={(event) => setClientSetting("pushToTalkKey", event.target.value)}>
                    {PUSH_TO_TALK_KEYS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}

              {settingsDraft.voiceMode === "voice_activity" ? (
                <>
                  <label htmlFor="voice-threshold">Activation threshold: {settingsDraft.voiceActivationThreshold}%</label>
                  <input
                    id="voice-threshold"
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={settingsDraft.voiceActivationThreshold}
                    onChange={(event) => setClientSetting("voiceActivationThreshold", Number(event.target.value))}
                  />
                </>
              ) : null}

              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.muteMicOnJoin}
                  onChange={(event) => setClientSetting("muteMicOnJoin", event.target.checked)}
                />
                Join voice with mic muted
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.deafenOnJoin}
                  onChange={(event) => setClientSetting("deafenOnJoin", event.target.checked)}
                />
                Deafen incoming audio
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.autoReconnectCommunity}
                  onChange={(event) => setClientSetting("autoReconnectCommunity", event.target.checked)}
                />
                Reconnect to last server on launch
              </label>
            </section>

            <section className="settings-group settings-actions">
              <button type="button" className="secondary-btn" onClick={() => void refreshAudioDevices()}>
                Refresh Devices
              </button>
              <button type="button" onClick={() => void requestAudioPermissions()} disabled={requestingAudioPermission}>
                {requestingAudioPermission ? "Requesting..." : "Allow Microphone"}
              </button>
              <button type="button" className="secondary-btn" onClick={() => void playTestSound()}>
                Test Output Sound
              </button>
            </section>

            <section className="settings-footer">
              <button type="button" className="secondary-btn" onClick={closeSettings}>
                Cancel
              </button>
              <button type="button" onClick={saveSettings} disabled={!settingsDirty}>
                Save Settings
              </button>
            </section>

            {settingsNotice ? <div className="settings-notice">{settingsNotice}</div> : null}
            {audioDevicesError ? <div className="settings-error">{audioDevicesError}</div> : null}
          </div>
        </div>
      ) : null}

      {statusError ? <div className="status-error">{statusError}</div> : null}

      {toastNotifications.length > 0 && (
        <div className="toast-container">
          {toastNotifications.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              <span className="toast-icon">
                {toast.type === "success" ? "✓" : toast.type === "error" ? "✗" : "ℹ"}
              </span>
              <span className="toast-message">{toast.message}</span>
              <button
                type="button"
                className="toast-close"
                onClick={() => setToastNotifications((prev) => prev.filter((t) => t.id !== toast.id))}
                aria-label="Close notification"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
