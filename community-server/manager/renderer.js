const KEY_ORDER = [
  "PORT",
  "REMUS_SERVER_NAME",
  "REMUS_PUBLIC_URL",
  "REMUS_REGION",
  "REMUS_MAIN_BACKEND_URL",
  "REMUS_CLIENT_ORIGIN",
  "REMUS_FILE_LIMIT_MB",
  "REMUS_SERVER_ICON",
  "REMUS_ICE_SERVERS",
  "REMUS_MEDIA_LISTEN_IP",
  "REMUS_MEDIA_ANNOUNCED_IP",
  "REMUS_MEDIA_MIN_PORT",
  "REMUS_MEDIA_MAX_PORT"
];

const dot = document.getElementById("dot");
const statusText = document.getElementById("status-text");
const pidText = document.getElementById("pid-text");
const logsEl = document.getElementById("logs");
const form = document.getElementById("config-form");
const iconPreview = document.getElementById("server-icon-preview");
const iconPathEl = document.getElementById("icon-path");
const iconSelectBtn = document.getElementById("icon-select");
const iconClearBtn = document.getElementById("icon-clear");
const firewallBtn = document.getElementById("firewall-btn");
const firewallStatus = document.getElementById("firewall-status");
const portsBtn = document.getElementById("ports-btn");
const portsStatus = document.getElementById("ports-status");
const refreshBtn = document.getElementById("refresh-btn");
const inviteInput = document.getElementById("server-invite");
const inviteCopyBtn = document.getElementById("invite-copy");
const tabButtons = Array.from(document.querySelectorAll(".tab-btn[data-tab]"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
const usersBody = document.getElementById("users-body");
const bansBody = document.getElementById("bans-body");
const messagesBody = document.getElementById("messages-body");
const uploadsBody = document.getElementById("uploads-body");
const usersCount = document.getElementById("users-count");
const bansCount = document.getElementById("bans-count");
const messagesCount = document.getElementById("messages-count");
const uploadsCount = document.getElementById("uploads-count");
const rolesList = document.getElementById("roles-list");
const roleNameInput = document.getElementById("role-name");
const roleColorInput = document.getElementById("role-color");
const roleHoistInput = document.getElementById("role-hoist");
const rolePermsEl = document.getElementById("role-perms");
const roleSaveBtn = document.getElementById("role-save");
const roleDeleteBtn = document.getElementById("role-delete");
const roleError = document.getElementById("role-error");
const auditBody = document.getElementById("audit-body");
const auditMaxInput = document.getElementById("audit-max");
const timeoutMaxInput = document.getElementById("timeout-max");
const settingsSaveBtn = document.getElementById("settings-save");
const settingsStatus = document.getElementById("settings-status");

const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const restartBtn = document.getElementById("restart-btn");
const openBtn = document.getElementById("open-btn");
const reloadBtn = document.getElementById("reload-btn");
const publicUrlCopyBtn = document.getElementById("public-url-copy");
const iconDropZone = document.getElementById("icon-drop-zone");
const portCheckDetails = document.getElementById("port-check-details");

// Dashboard elements
const dashStatus = document.getElementById("dash-status");
const dashUsers = document.getElementById("dash-users");
const dashMembers = document.getElementById("dash-members");
const dashBans = document.getElementById("dash-bans");
const dashMessages = document.getElementById("dash-messages");
const dashUploads = document.getElementById("dash-uploads");
const dashRoles = document.getElementById("dash-roles");
const dashAudit = document.getElementById("dash-audit");
const recentLogs = document.getElementById("recent-logs");

// Search boxes
const usersSearch = document.getElementById("users-search");
const bansSearch = document.getElementById("bans-search");
const messagesSearch = document.getElementById("messages-search");
const uploadsSearch = document.getElementById("uploads-search");
const auditSearch = document.getElementById("audit-search");

const PERMISSION_OPTIONS = [
  { key: "VIEW_CHANNELS", label: "View Channels", bit: 1 << 1 },
  { key: "MANAGE_CHANNELS", label: "Manage Channels", bit: 1 << 2 },
  { key: "MANAGE_ROLES", label: "Manage Roles", bit: 1 << 3 },
  { key: "MANAGE_SERVER", label: "Manage Server", bit: 1 << 4 },
  { key: "VIEW_AUDIT_LOG", label: "View Audit Log", bit: 1 << 5 },
  { key: "SEND_MESSAGES", label: "Send Messages", bit: 1 << 6 },
  { key: "READ_HISTORY", label: "Read History", bit: 1 << 7 },
  { key: "MANAGE_MESSAGES", label: "Manage Messages", bit: 1 << 8 },
  { key: "ATTACH_FILES", label: "Attach Files", bit: 1 << 9 },
  { key: "VOICE_CONNECT", label: "Voice Connect", bit: 1 << 10 },
  { key: "VOICE_SPEAK", label: "Voice Speak", bit: 1 << 11 },
  { key: "VOICE_MUTE_MEMBERS", label: "Mute Members", bit: 1 << 12 },
  { key: "VOICE_DEAFEN_MEMBERS", label: "Deafen Members", bit: 1 << 13 },
  { key: "VOICE_MOVE_MEMBERS", label: "Move Members", bit: 1 << 14 },
  { key: "SCREENSHARE", label: "Screenshare", bit: 1 << 15 },
  { key: "KICK_MEMBERS", label: "Kick Members", bit: 1 << 16 },
  { key: "BAN_MEMBERS", label: "Ban Members", bit: 1 << 17 },
  { key: "TIMEOUT_MEMBERS", label: "Timeout Members", bit: 1 << 18 },
  { key: "ADMINISTRATOR", label: "Administrator", bit: 1 << 0 }
];

let rolesState = [];
let usersState = [];
let membersState = [];
let activeRoleId = null;
let hasUnsavedChanges = false;

// Track form changes for unsaved warning
function markFormDirty() {
  hasUnsavedChanges = true;
}

function markFormClean() {
  hasUnsavedChanges = false;
}

// Loading state helpers
function setButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.classList.add("loading");
    button.disabled = true;
  } else {
    button.classList.remove("loading");
    button.disabled = false;
  }
}

// Notification system
function showNotification(message, type = "success") {
  const existing = document.querySelector(".notification");
  if (existing) {
    existing.remove();
  }

  const notification = document.createElement("div");
  notification.className = `notification ${type}`;

  const icon = document.createElement("span");
  icon.className = "notification-icon";
  icon.textContent = type === "success" ? "✓" : type === "error" ? "✗" : "⚠";

  const text = document.createElement("span");
  text.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.className = "notification-close";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => notification.remove());

  notification.appendChild(icon);
  notification.appendChild(text);
  notification.appendChild(closeBtn);
  document.body.appendChild(notification);

  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 5000);
}

// Validation functions
function validatePort(value) {
  const port = parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "Port must be a number between 1 and 65535";
  }
  return null;
}

function validateUrl(value, allowEmpty = false) {
  if (allowEmpty && !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!url.protocol.startsWith("http")) {
      return "URL must use http:// or https://";
    }
    return null;
  } catch {
    return "Invalid URL format";
  }
}

function validateJson(value) {
  if (!value.trim()) return "JSON cannot be empty";
  try {
    JSON.parse(value);
    return null;
  } catch (err) {
    return `Invalid JSON: ${err.message}`;
  }
}

function validatePositiveNumber(value, fieldName) {
  const num = parseInt(value, 10);
  if (!Number.isInteger(num) || num < 1) {
    return `${fieldName} must be a positive number`;
  }
  return null;
}

function validatePortRange(minValue, maxValue) {
  const minError = validatePort(minValue);
  const maxError = validatePort(maxValue);

  if (minError) return { min: minError, max: null };
  if (maxError) return { min: null, max: maxError };

  const min = parseInt(minValue, 10);
  const max = parseInt(maxValue, 10);

  if (min >= max) {
    return { min: null, max: "Max port must be greater than min port" };
  }

  return { min: null, max: null };
}

function validateOrigins(value) {
  const origins = value.split(",").map(s => s.trim()).filter(Boolean);
  const dangerous = ["null", "file://"];

  for (const origin of origins) {
    if (dangerous.includes(origin.toLowerCase())) {
      return `Dangerous origin detected: "${origin}". Remove for security.`;
    }
    const urlError = validateUrl(origin);
    if (urlError) {
      return `Invalid origin "${origin}": ${urlError}`;
    }
  }
  return null;
}

function setFieldError(fieldId, errorMessage) {
  const field = document.getElementById(fieldId);
  if (!field) return;

  const fieldContainer = field.closest(".field");
  if (!fieldContainer) return;

  // Remove existing error
  const existingError = fieldContainer.querySelector(".validation-error");
  if (existingError) {
    existingError.remove();
  }

  if (errorMessage) {
    fieldContainer.classList.add("has-error");
    const errorEl = document.createElement("span");
    errorEl.className = "validation-error";
    errorEl.textContent = errorMessage;
    field.parentNode.insertBefore(errorEl, field.nextSibling);
  } else {
    fieldContainer.classList.remove("has-error");
  }
}

function clearAllFieldErrors() {
  document.querySelectorAll(".field.has-error").forEach(field => {
    field.classList.remove("has-error");
  });
  document.querySelectorAll(".validation-error").forEach(error => {
    error.remove();
  });
}

function validateConfigForm() {
  clearAllFieldErrors();
  let hasErrors = false;

  const values = getFormValues();

  // Validate PORT
  const portError = validatePort(values.PORT);
  if (portError) {
    setFieldError("PORT", portError);
    hasErrors = true;
  }

  // Validate PUBLIC_URL
  const publicUrlError = validateUrl(values.REMUS_PUBLIC_URL, true);
  if (publicUrlError) {
    setFieldError("REMUS_PUBLIC_URL", publicUrlError);
    hasErrors = true;
  }

  // Validate MAIN_BACKEND_URL
  const backendUrlError = validateUrl(values.REMUS_MAIN_BACKEND_URL);
  if (backendUrlError) {
    setFieldError("REMUS_MAIN_BACKEND_URL", backendUrlError);
    hasErrors = true;
  }

  // Validate CLIENT_ORIGIN
  const originsError = validateOrigins(values.REMUS_CLIENT_ORIGIN);
  if (originsError) {
    setFieldError("REMUS_CLIENT_ORIGIN", originsError);
    hasErrors = true;
  }

  // Validate FILE_LIMIT_MB
  const fileLimitError = validatePositiveNumber(values.REMUS_FILE_LIMIT_MB, "File limit");
  if (fileLimitError) {
    setFieldError("REMUS_FILE_LIMIT_MB", fileLimitError);
    hasErrors = true;
  }

  // Validate ICE_SERVERS
  const iceError = validateJson(values.REMUS_ICE_SERVERS);
  if (iceError) {
    setFieldError("REMUS_ICE_SERVERS", iceError);
    hasErrors = true;
  }

  // Validate media ports
  const portRangeErrors = validatePortRange(values.REMUS_MEDIA_MIN_PORT, values.REMUS_MEDIA_MAX_PORT);
  if (portRangeErrors.min) {
    setFieldError("REMUS_MEDIA_MIN_PORT", portRangeErrors.min);
    hasErrors = true;
  }
  if (portRangeErrors.max) {
    setFieldError("REMUS_MEDIA_MAX_PORT", portRangeErrors.max);
    hasErrors = true;
  }

  return !hasErrors;
}

// ========== DASHBOARD UPDATES ==========
function updateDashboard() {
  if (!dashStatus) return;

  // Update status
  const running = dot?.classList.contains("online");
  dashStatus.textContent = running ? "Running" : "Stopped";

  // Update counts
  if (dashUsers) dashUsers.textContent = usersState.filter(u => u.status === "online").length;
  if (dashMembers) dashMembers.textContent = membersState.length;
  if (dashBans) dashBans.textContent = bansCount?.textContent || "0";
  if (dashMessages) dashMessages.textContent = messagesCount?.textContent || "0";
  if (dashUploads) dashUploads.textContent = uploadsCount?.textContent || "0";
  if (dashRoles) dashRoles.textContent = rolesState.length;
  if (dashAudit) dashAudit.textContent = Array.from(document.querySelectorAll("#audit-body tr")).filter(row => !row.classList.contains("empty")).length;

  // Update recent logs
  if (recentLogs) {
    const logLines = Array.from(document.querySelectorAll("#logs .log-line")).slice(-10);
    recentLogs.innerHTML = logLines.length > 0
      ? logLines.map(line => line.outerHTML).join("")
      : '<div class="log-line">No recent activity.</div>';
  }
}

function activateTab(name) {
  for (const btn of tabButtons) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  }
  for (const panel of tabPanels) {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  }
}

function setStatus(status) {
  const running = !!status?.running;
  dot.classList.toggle("online", running);
  statusText.textContent = running ? "Running" : "Stopped";
  pidText.textContent = running && status?.pid ? `(PID ${status.pid})` : "";
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  restartBtn.disabled = !running;
  updateDashboard();
}

function getFormValues() {
  const values = {};
  for (const key of KEY_ORDER) {
    const el = document.getElementById(key);
    values[key] = el ? el.value.trim() : "";
  }
  return values;
}

function setFormValues(values) {
  for (const key of KEY_ORDER) {
    const el = document.getElementById(key);
    if (!el) continue;
    el.value = values?.[key] ?? "";
  }
}

function setIconPreview(iconFile, iconPath) {
  if (iconFile) {
    const normalized = iconFile.replace(/\\/g, "/");
    iconPreview.src = `file:///${normalized}`;
  } else {
    iconPreview.src = "./remus-logo.png";
  }
  iconPathEl.textContent = iconPath ? iconPath : "No custom icon set";
  iconClearBtn.disabled = !iconPath;
}

function setInviteValue(value, placeholder) {
  if (!inviteInput) return;
  inviteInput.value = value || "";
  inviteInput.placeholder = placeholder || "";
  if (inviteCopyBtn) {
    inviteCopyBtn.disabled = !value;
  }
}

function appendLog(entry) {
  const line = document.createElement("div");
  line.className = `log-line ${entry.stream === "stderr" ? "err" : entry.stream === "info" ? "info" : ""}`;
  const prefix = `[${new Date(entry.at).toLocaleTimeString()}]`;
  line.textContent = `${prefix} ${entry.line}`;
  logsEl.appendChild(line);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function setTableMessage(body, colSpan, message) {
  if (!body) return;
  body.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.className = "empty";
  cell.colSpan = colSpan;
  cell.textContent = message;
  row.appendChild(cell);
  body.appendChild(row);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatBytes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let size = num;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function getMemberById(userId) {
  return membersState.find((member) => member.id === userId) || null;
}

function resolveDisplayName(user) {
  if (!user) return "Unknown";
  const member = getMemberById(user.id);
  const nickname = (member?.nickname || "").trim();
  if (nickname) return nickname;
  const direct = (user.displayName || user.username || "").trim();
  if (direct) return direct;
  if (user.id) return `User ${String(user.id).slice(0, 6)}`;
  return "Unknown";
}

function getAssignableRoles() {
  return rolesState.filter((role) => role && role.name !== "@everyone" && role.id !== role.guildId);
}

function buildRoleBadges(roleIds = []) {
  const container = document.createElement("div");
  container.className = "role-badges";
  const roleMap = new Map(rolesState.map((role) => [role.id, role]));
  const roles = roleIds.map((id) => roleMap.get(id)).filter(Boolean);
  if (!roles.length) {
    const empty = document.createElement("span");
    empty.className = "cell-muted";
    empty.textContent = "None";
    container.appendChild(empty);
    return container;
  }
  for (const role of roles) {
    const badge = document.createElement("span");
    badge.className = "role-badge";
    badge.textContent = role.name || "Role";
    if (role.color) {
      badge.style.borderColor = role.color;
      badge.style.color = role.color;
    }
    container.appendChild(badge);
  }
  return container;
}

function renderUsers(users) {
  usersBody.innerHTML = "";
  const list = Array.isArray(users) ? users : [];
  usersCount.textContent = String(list.length);

  if (!list.length) {
    setTableMessage(usersBody, 7, "No users found for this community server.");
    return;
  }

  for (const user of list) {
    const row = document.createElement("tr");
    const displayName = resolveDisplayName(user);
    const username = document.createElement("td");
    username.textContent = displayName;

    const userId = document.createElement("td");
    userId.textContent = user.id || "-";
    userId.className = "cell-muted";

    const created = document.createElement("td");
    created.textContent = formatDate(user.createdAt);
    created.className = "cell-muted";

    const lastSeen = document.createElement("td");
    lastSeen.textContent = formatDate(user.lastSeenAt);
    lastSeen.className = "cell-muted";

    const status = document.createElement("td");
    const badge = document.createElement("span");
    if (user.isBanned) {
      badge.className = "badge warn";
      badge.textContent = "Banned";
    } else {
      badge.className = `badge ${user.isMember ? "ok" : "warn"}`;
      badge.textContent = user.isMember ? "Member" : "Not in community";
    }
    status.appendChild(badge);

    const rolesCell = document.createElement("td");
    const member = getMemberById(user.id);
    const roleIds = Array.isArray(member?.roleIds) ? member.roleIds : [];
    rolesCell.appendChild(buildRoleBadges(roleIds));

    const actions = document.createElement("td");
    const actionRow = document.createElement("div");
    actionRow.className = "action-row";

    const manageRolesBtn = document.createElement("button");
    manageRolesBtn.className = "neutral";
    manageRolesBtn.textContent = "Manage Roles";
    manageRolesBtn.disabled = !user.isMember;

    const kickBtn = document.createElement("button");
    kickBtn.className = "neutral";
    kickBtn.textContent = "Kick";
    kickBtn.disabled = !user.isMember;
    kickBtn.addEventListener("click", async () => {
      const ok = confirm(`Kick ${displayName}? This removes all of their community data.`);
      if (!ok) return;
      kickBtn.disabled = true;
      try {
        await window.remusManager.kickUser(user.id);
        await refreshAdminData();
      } catch (error) {
        alert(error?.message || "Failed to kick user.");
      } finally {
        kickBtn.disabled = false;
      }
    });

    const banBtn = document.createElement("button");
    banBtn.className = "warn";
    banBtn.textContent = "Ban";
    banBtn.disabled = !!user.isBanned;
    banBtn.addEventListener("click", async () => {
      const ok = confirm(`Ban ${displayName}? This removes all data and blocks rejoin.`);
      if (!ok) return;
      banBtn.disabled = true;
      try {
        await window.remusManager.banUser(user.id);
        await refreshAdminData();
      } catch (error) {
        alert(error?.message || "Failed to ban user.");
      } finally {
        banBtn.disabled = false;
      }
    });

    actionRow.appendChild(kickBtn);
    actionRow.appendChild(banBtn);
    actionRow.appendChild(manageRolesBtn);
    actions.appendChild(actionRow);

    row.appendChild(username);
    row.appendChild(userId);
    row.appendChild(created);
    row.appendChild(lastSeen);
    row.appendChild(status);
    row.appendChild(rolesCell);
    row.appendChild(actions);
    usersBody.appendChild(row);

    const roleRow = document.createElement("tr");
    roleRow.className = "role-assign-row";
    roleRow.style.display = "none";
    const roleCell = document.createElement("td");
    roleCell.colSpan = 7;

    const roleWrap = document.createElement("div");
    roleWrap.className = "role-assign";
    const assignList = document.createElement("div");
    assignList.className = "assign-list";

    const assignHint = document.createElement("div");
    assignHint.className = "assign-hint";

    if (!user.isMember) {
      assignHint.textContent = "User is not in this community.";
      roleWrap.appendChild(assignHint);
    } else {
      const roles = getAssignableRoles();
      if (!roles.length) {
        assignHint.textContent = "No roles configured yet.";
        roleWrap.appendChild(assignHint);
      } else {
        const current = new Set(roleIds);
        for (const role of roles) {
          const label = document.createElement("label");
          label.className = "assign-item";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = current.has(role.id);
          checkbox.dataset.role = role.id;
          const span = document.createElement("span");
          span.textContent = role.name || "Role";
          if (role.color) {
            span.style.color = role.color;
          }
          label.appendChild(checkbox);
          label.appendChild(span);
          assignList.appendChild(label);
        }
        roleWrap.appendChild(assignList);
      }
    }

    roleCell.appendChild(roleWrap);
    roleRow.appendChild(roleCell);
    usersBody.appendChild(roleRow);

    manageRolesBtn.addEventListener("click", async () => {
      roleRow.style.display = roleRow.style.display === "none" ? "table-row" : "none";
    });

    if (user.isMember) {
      assignList.addEventListener("change", async () => {
        const checkboxes = Array.from(assignList.querySelectorAll("input[type='checkbox']"));
        const selected = checkboxes.filter((box) => box.checked).map((box) => box.dataset.role);
        checkboxes.forEach((box) => {
          box.disabled = true;
        });
        manageRolesBtn.disabled = true;
        try {
          const data = await window.remusManager.setMemberRoles(user.id, { roleIds: selected });
          const updated = data?.member;
          if (updated) {
            const idx = membersState.findIndex((entry) => entry.id === updated.id);
            if (idx >= 0) {
              membersState[idx] = updated;
            } else {
              membersState.push(updated);
            }
            renderUsers(usersState);
          }
        } catch (error) {
          alert(error?.message || "Failed to update roles.");
          renderUsers(usersState);
        }
      });
    }
  }
}

function renderRoleEditor(role) {
  if (!role) {
    roleNameInput.value = "";
    roleColorInput.value = "#5f6fff";
    roleHoistInput.checked = false;
    rolePermsEl.innerHTML = "";
    roleSaveBtn.disabled = true;
    roleDeleteBtn.disabled = true;
    return;
  }

  roleNameInput.value = role.name || "";
  roleColorInput.value = role.color || "#5f6fff";
  roleHoistInput.checked = !!role.hoist;
  rolePermsEl.innerHTML = "";
  for (const perm of PERMISSION_OPTIONS) {
    const label = document.createElement("label");
    label.className = "checkbox-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = ((role.permissions || 0) & perm.bit) === perm.bit;
    checkbox.addEventListener("change", () => {
      if (!activeRoleId) return;
      const updated = rolesState.find((item) => item.id === activeRoleId);
      if (!updated) return;
      updated.permissions = checkbox.checked ? (updated.permissions | perm.bit) : (updated.permissions & ~perm.bit);
    });
    const span = document.createElement("span");
    span.textContent = perm.label;
    label.appendChild(checkbox);
    label.appendChild(span);
    rolePermsEl.appendChild(label);
  }
  roleSaveBtn.disabled = false;
  roleDeleteBtn.disabled = role.id === role.guildId;
}

function renderRoles(roles) {
  rolesState = Array.isArray(roles) ? roles : [];
  rolesList.innerHTML = "";
  const sorted = [...rolesState].sort((a, b) => (b.position || 0) - (a.position || 0));
  for (const role of sorted) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = role.name || "Role";
    btn.addEventListener("click", () => {
      activeRoleId = role.id;
      renderRoleEditor(role);
    });
    rolesList.appendChild(btn);
  }
  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.textContent = "+ New Role";
  createBtn.addEventListener("click", async () => {
    try {
      roleError.textContent = "";
      const data = await window.remusManager.createRole({ name: "New Role", color: "", permissions: 0, hoist: false });
      await loadRoles();
      activeRoleId = data?.role?.id || null;
      const created = rolesState.find((item) => item.id === activeRoleId) || rolesState[0];
      renderRoleEditor(created);
    } catch (error) {
      roleError.textContent = error?.message || "Failed to create role.";
    }
  });
  rolesList.appendChild(createBtn);
}

function renderAudit(entries) {
  auditBody.innerHTML = "";
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) {
    setTableMessage(auditBody, 4, "No audit entries yet.");
    return;
  }
  for (const entry of list) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ""}</td>
      <td>${entry.action || ""}</td>
      <td>${entry.actorId || ""}</td>
      <td>${entry.targetId || ""}</td>
    `;
    auditBody.appendChild(row);
  }
}

function renderBans(bans) {
  bansBody.innerHTML = "";
  const list = Array.isArray(bans) ? bans : [];
  bansCount.textContent = String(list.length);

  if (!list.length) {
    setTableMessage(bansBody, 4, "No banned users.");
    return;
  }

  for (const entry of list) {
    const row = document.createElement("tr");
    const displayName = resolveDisplayName(entry.profile || { id: entry.userId });
    const username = document.createElement("td");
    username.textContent = displayName;

    const userId = document.createElement("td");
    userId.textContent = entry.userId || "-";
    userId.className = "cell-muted";

    const bannedAt = document.createElement("td");
    bannedAt.textContent = formatDate(entry.bannedAt);
    bannedAt.className = "cell-muted";

    const actions = document.createElement("td");
    const actionRow = document.createElement("div");
    actionRow.className = "action-row";

    const unbanBtn = document.createElement("button");
    unbanBtn.className = "neutral";
    unbanBtn.textContent = "Unban";
    unbanBtn.addEventListener("click", async () => {
      const ok = confirm(`Unban ${displayName}?`);
      if (!ok) return;
      unbanBtn.disabled = true;
      try {
        await window.remusManager.unbanUser(entry.userId);
        await refreshAdminData();
      } catch (error) {
        alert(error?.message || "Failed to unban user.");
      } finally {
        unbanBtn.disabled = false;
      }
    });

    actionRow.appendChild(unbanBtn);
    actions.appendChild(actionRow);

    row.appendChild(username);
    row.appendChild(userId);
    row.appendChild(bannedAt);
    row.appendChild(actions);
    bansBody.appendChild(row);
  }
}

function renderMessages(messages) {
  messagesBody.innerHTML = "";
  const list = Array.isArray(messages) ? messages : [];
  messagesCount.textContent = String(list.length);

  if (!list.length) {
    setTableMessage(messagesBody, 5, "No chat messages yet.");
    return;
  }

  for (const message of list) {
    const row = document.createElement("tr");

    const time = document.createElement("td");
    time.textContent = formatDate(message.createdAt);
    time.className = "cell-muted";

    const channel = document.createElement("td");
    channel.textContent = message.channel?.name ? `#${message.channel.name}` : message.channelId || "-";

    const author = document.createElement("td");
    author.textContent = message.author?.username || message.authorId || "Unknown";

    const content = document.createElement("td");
    content.textContent = message.content || "-";

    const attachments = document.createElement("td");
    const files = Array.isArray(message.attachments) ? message.attachments : [];
    if (!files.length) {
      attachments.textContent = "-";
      attachments.className = "cell-muted";
    } else {
      attachments.textContent = files.map((file) => file.name || file.url || "Attachment").join(", ");
    }

    row.appendChild(time);
    row.appendChild(channel);
    row.appendChild(author);
    row.appendChild(content);
    row.appendChild(attachments);
    messagesBody.appendChild(row);
  }
}

function renderUploads(uploads) {
  uploadsBody.innerHTML = "";
  const list = Array.isArray(uploads) ? uploads : [];
  uploadsCount.textContent = String(list.length);

  if (!list.length) {
    setTableMessage(uploadsBody, 7, "No uploads recorded yet.");
    return;
  }

  for (const upload of list) {
    const row = document.createElement("tr");

    const time = document.createElement("td");
    time.textContent = formatDate(upload.createdAt);
    time.className = "cell-muted";

    const channel = document.createElement("td");
    channel.textContent = upload.channel?.name ? `#${upload.channel.name}` : upload.channelId || "-";

    const author = document.createElement("td");
    author.textContent = upload.author?.username || upload.authorId || "Unknown";

    const file = document.createElement("td");
    file.textContent = upload.name || "-";

    const size = document.createElement("td");
    size.textContent = formatBytes(upload.size);
    size.className = "cell-muted";

    const type = document.createElement("td");
    type.textContent = upload.mimeType || "-";
    type.className = "cell-muted";

    const url = document.createElement("td");
    url.textContent = upload.url || "-";
    url.className = "cell-muted";

    row.appendChild(time);
    row.appendChild(channel);
    row.appendChild(author);
    row.appendChild(file);
    row.appendChild(size);
    row.appendChild(type);
    row.appendChild(url);
    uploadsBody.appendChild(row);
  }
}

async function loadUsers() {
  setTableMessage(usersBody, 7, "Loading users...");
  try {
    const data = await window.remusManager.getUsers();
    usersState = Array.isArray(data?.users) ? data.users : [];
    renderUsers(usersState);
  } catch (error) {
    usersState = [];
    renderUsers(usersState);
    setTableMessage(usersBody, 7, error?.message || "Failed to load users.");
  }
}

async function loadBans() {
  setTableMessage(bansBody, 4, "Loading banned users...");
  try {
    const data = await window.remusManager.getBans();
    renderBans(data?.bans || []);
  } catch (error) {
    renderBans([]);
    setTableMessage(bansBody, 4, error?.message || "Failed to load banned users.");
  }
}

async function loadMessages() {
  setTableMessage(messagesBody, 5, "Loading messages...");
  try {
    const data = await window.remusManager.getMessages(200);
    renderMessages(data?.messages || []);
  } catch (error) {
    renderMessages([]);
    setTableMessage(messagesBody, 5, error?.message || "Failed to load chat history.");
  }
}

async function loadUploads() {
  setTableMessage(uploadsBody, 7, "Loading uploads...");
  try {
    const data = await window.remusManager.getUploads(200);
    renderUploads(data?.uploads || []);
  } catch (error) {
    renderUploads([]);
    setTableMessage(uploadsBody, 7, error?.message || "Failed to load upload history.");
  }
}

async function loadRoles() {
  if (!rolesList) return;
  rolesList.innerHTML = "";
  try {
    const data = await window.remusManager.getRoles();
    renderRoles(data?.roles || []);
    if (!activeRoleId && rolesState.length) {
      activeRoleId = rolesState[0].id;
      renderRoleEditor(rolesState[0]);
    }
    if (usersState.length) {
      renderUsers(usersState);
    }
  } catch (error) {
    rolesList.innerHTML = `<div class="firewall-status">${error?.message || "Failed to load roles."}</div>`;
  }
}

async function loadMembers() {
  try {
    const data = await window.remusManager.getMembers();
    membersState = Array.isArray(data?.members) ? data.members : [];
    if (usersState.length) {
      renderUsers(usersState);
    }
  } catch {
    membersState = [];
  }
}

async function loadAudit() {
  if (!auditBody) return;
  setTableMessage(auditBody, 4, "Loading audit log...");
  try {
    const data = await window.remusManager.getAudit(200);
    renderAudit(data?.entries || []);
  } catch (error) {
    setTableMessage(auditBody, 4, error?.message || "Failed to load audit log.");
  }
}

async function loadAdminSettings() {
  if (!auditMaxInput || !timeoutMaxInput) return;
  try {
    const data = await window.remusManager.getAdminSettings();
    const settings = data?.settings || {};
    auditMaxInput.value = settings.auditMaxEntries ?? "";
    timeoutMaxInput.value = settings.timeoutMaxMinutes ?? "";
  } catch (error) {
    settingsStatus.textContent = error?.message || "Failed to load settings.";
  }
}

async function refreshAdminData() {
  await Promise.allSettled([loadUsers(), loadBans(), loadMessages(), loadUploads(), loadRoles(), loadMembers(), loadAudit(), loadAdminSettings()]);
  updateDashboard();
}

async function refreshInviteInfo() {
  if (!inviteInput) return;
  try {
    const info = await window.remusManager.getServerInfo();
    const serverId = String(info?.serverId || "").trim();
    if (serverId) {
      setInviteValue(`remus(${serverId})`, "");
    } else {
      setInviteValue("", "Start server and log in once to generate an invite.");
    }
  } catch (error) {
    setInviteValue("", error?.message || "Unable to fetch invite.");
  }
}

async function reloadConfig() {
  const info = await window.remusManager.getIconInfo();
  const config = info?.config || {};
  setFormValues(config);
  setIconPreview(info?.iconFile, info?.iconPath);
}

async function init() {
  await reloadConfig();

  const status = await window.remusManager.getStatus();
  setStatus(status);

  const logs = await window.remusManager.getLogs();
  logsEl.innerHTML = "";
  for (const entry of logs) {
    appendLog(entry);
  }

  await refreshAdminData();
  await refreshInviteInfo();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  // Validate form before saving
  if (!validateConfigForm()) {
    showNotification("Please fix validation errors before saving.", "error");
    return;
  }

  const submitBtn = event.submitter || form.querySelector('button[type="submit"]');
  setButtonLoading(submitBtn, true);

  try {
    const values = getFormValues();
    const saved = await window.remusManager.saveConfig(values);
    setFormValues(saved);
    const info = await window.remusManager.getIconInfo();
    setIconPreview(info?.iconFile, info?.iconPath);
    markFormClean();
    showNotification("Configuration saved successfully!", "success");
  } catch (error) {
    showNotification(error?.message || "Failed to save configuration.", "error");
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

// Track form changes
form.addEventListener("input", markFormDirty);

startBtn.addEventListener("click", async () => {
  // Validate configuration before starting server
  if (!validateConfigForm()) {
    showNotification("Cannot start server: Configuration has errors. Please fix them first.", "error");
    return;
  }

  setButtonLoading(startBtn, true);

  try {
    const values = getFormValues();
    await window.remusManager.saveConfig(values);
    markFormClean();
    const status = await window.remusManager.startServer();
    setStatus(status);

    if (status?.running) {
      showNotification("Server started successfully!", "success");
      await refreshAdminData();
      await refreshInviteInfo();
    } else {
      showNotification("Server failed to start. Check logs for details.", "error");
    }
  } catch (error) {
    showNotification(error?.message || "Failed to start server.", "error");
  } finally {
    setButtonLoading(startBtn, false);
  }
});

stopBtn.addEventListener("click", async () => {
  setButtonLoading(stopBtn, true);

  try {
    const status = await window.remusManager.stopServer();
    setStatus(status);
    setInviteValue("", "Server stopped.");
    showNotification("Server stopped successfully.", "success");
  } catch (error) {
    showNotification(error?.message || "Failed to stop server.", "error");
  } finally {
    setButtonLoading(stopBtn, false);
  }
});

restartBtn.addEventListener("click", async () => {
  // Validate configuration before restarting
  if (!validateConfigForm()) {
    showNotification("Cannot restart server: Configuration has errors. Please fix them first.", "error");
    return;
  }

  setButtonLoading(restartBtn, true);

  try {
    // Save config first
    const values = getFormValues();
    await window.remusManager.saveConfig(values);
    markFormClean();

    // Stop server
    await window.remusManager.stopServer();

    // Wait a moment for clean shutdown
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start server
    const status = await window.remusManager.startServer();
    setStatus(status);

    if (status?.running) {
      showNotification("Server restarted successfully!", "success");
      await refreshAdminData();
      await refreshInviteInfo();
    } else {
      showNotification("Server failed to restart. Check logs for details.", "error");
    }
  } catch (error) {
    showNotification(error?.message || "Failed to restart server.", "error");
  } finally {
    setButtonLoading(restartBtn, false);
  }
});

openBtn.addEventListener("click", async () => {
  await window.remusManager.openFolder();
});

reloadBtn.addEventListener("click", () => {
  void reloadConfig();
  void refreshInviteInfo();
});

refreshBtn?.addEventListener("click", () => {
  void refreshAdminData();
  void refreshInviteInfo();
});

firewallBtn.addEventListener("click", async () => {
  firewallBtn.disabled = true;
  firewallStatus.textContent = "Applying firewall rules...";
  try {
    const result = await window.remusManager.allowFirewall(getFormValues());
    firewallStatus.textContent = result?.message || "Firewall rules applied.";
    if (result?.ok) {
      showNotification("Firewall rules applied successfully!", "success");
    } else {
      showNotification(result?.message || "Firewall update failed. Run as Administrator.", "error");
    }
  } catch (error) {
    firewallStatus.textContent = error?.message || "Failed to update firewall rules.";
    showNotification(error?.message || "Failed to update firewall rules.", "error");
  } finally {
    firewallBtn.disabled = false;
  }
});

function formatPortsStatus(result) {
  if (!result) return "Unable to verify ports.";
  const listeningLabel = result.listening ? "listening" : "not listening";
  const tcpRule = result.rules?.tcpServer ? "allowed" : "blocked";
  const udpRule = result.rules?.udpMedia ? "allowed" : "blocked";
  const tcpMediaRule = result.rules?.tcpMedia ? "allowed" : "blocked";
  const localLine = `Local: server port ${result.port} is ${listeningLabel}. Firewall: TCP ${tcpRule}, UDP media ${udpRule}, TCP media ${tcpMediaRule}.`;

  let externalLine = "External: not checked.";
  const external = result.external || null;
  if (external?.ok) {
    const map = new Map();
    for (const entry of external.results || []) {
      if (entry && typeof entry.port === "number") {
        map.set(entry.port, entry.ok ? "open" : "closed");
      }
    }
    const ports = [result.port, result.range?.min, result.range?.max].filter(
      (value, index, arr) => typeof value === "number" && arr.indexOf(value) === index
    );
    const portSummary = ports
      .map((port) => `${port} ${map.get(port) || "unknown"}`)
      .join(", ");
    externalLine = `External: public IP ${external.publicIp}. TCP reachability: ${portSummary}.`;
  } else if (external?.publicIp) {
    externalLine = `External: public IP ${external.publicIp}. ${external.error || "Unable to verify TCP reachability."}`;
  } else if (external?.error) {
    externalLine = `External: ${external.error}`;
  }

  const note = result.note ? ` ${result.note}` : "";
  return `${localLine} ${externalLine}${note}`;
}

portsBtn.addEventListener("click", async () => {
  setButtonLoading(portsBtn, true);
  portsStatus.textContent = "Checking ports and firewall rules...";
  portCheckDetails.style.display = "none";
  portCheckDetails.innerHTML = "";

  try {
    const result = await window.remusManager.checkPorts(getFormValues());
    portsStatus.textContent = formatPortsStatus(result);
    renderPortCheckDetails(result);
  } catch (error) {
    portsStatus.textContent = error?.message || "Failed to verify ports.";
    showNotification(error?.message || "Failed to verify ports.", "error");
  } finally {
    setButtonLoading(portsBtn, false);
  }
});

function renderPortCheckDetails(result) {
  if (!result || !portCheckDetails) return;

  portCheckDetails.innerHTML = "";
  portCheckDetails.style.display = "grid";

  // Firewall status
  const firewallDiv = document.createElement("div");
  firewallDiv.className = `port-check-item ${result.firewall ? "success" : "error"}`;
  firewallDiv.innerHTML = `
    <div class="check-label">Windows Firewall</div>
    <div class="check-value">${result.firewall ? "✓ Rules configured" : "✗ Not configured"}</div>
  `;
  portCheckDetails.appendChild(firewallDiv);

  // Listening status
  const listeningDiv = document.createElement("div");
  listeningDiv.className = `port-check-item ${result.listening ? "success" : "error"}`;
  listeningDiv.innerHTML = `
    <div class="check-label">Server Port ${result.port}</div>
    <div class="check-value">${result.listening ? "✓ Listening" : "✗ Not listening"}</div>
  `;
  portCheckDetails.appendChild(listeningDiv);

  // External reachability
  if (result.external?.ok && result.external.results) {
    for (const entry of result.external.results) {
      const portDiv = document.createElement("div");
      portDiv.className = `port-check-item ${entry.ok ? "success" : "error"}`;
      portDiv.innerHTML = `
        <div class="check-label">External TCP Port ${entry.port}</div>
        <div class="check-value">${entry.ok ? "✓ Open" : "✗ Closed"}</div>
      `;
      portCheckDetails.appendChild(portDiv);
    }

    // Public IP
    if (result.external.publicIp) {
      const ipDiv = document.createElement("div");
      ipDiv.className = "port-check-item success";
      ipDiv.innerHTML = `
        <div class="check-label">Public IP</div>
        <div class="check-value">${result.external.publicIp}</div>
      `;
      portCheckDetails.appendChild(ipDiv);
    }
  } else if (result.external?.error) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "port-check-item error";
    errorDiv.innerHTML = `
      <div class="check-label">External Check</div>
      <div class="check-value">✗ ${result.external.error}</div>
    `;
    portCheckDetails.appendChild(errorDiv);
  }

  // Media port range
  if (result.range) {
    const rangeDiv = document.createElement("div");
    rangeDiv.className = "port-check-item";
    rangeDiv.innerHTML = `
      <div class="check-label">Media UDP Range</div>
      <div class="check-value">${result.range.min}-${result.range.max}</div>
    `;
    portCheckDetails.appendChild(rangeDiv);
  }
}

roleSaveBtn?.addEventListener("click", async () => {
  if (!activeRoleId) return;
  roleError.textContent = "";
  const role = rolesState.find((item) => item.id === activeRoleId);
  if (!role) return;
  try {
    await window.remusManager.updateRole(activeRoleId, {
      name: roleNameInput.value.trim(),
      color: roleColorInput.value,
      hoist: roleHoistInput.checked,
      permissions: role.permissions || 0
    });
    await loadRoles();
    showNotification("Role updated successfully!", "success");
  } catch (error) {
    roleError.textContent = error?.message || "Failed to update role.";
    showNotification(error?.message || "Failed to update role.", "error");
  }
});

roleDeleteBtn?.addEventListener("click", async () => {
  if (!activeRoleId) return;
  const ok = confirm("Delete this role?");
  if (!ok) return;
  roleError.textContent = "";
  try {
    await window.remusManager.deleteRole(activeRoleId);
    activeRoleId = null;
    await loadRoles();
    renderRoleEditor(null);
    showNotification("Role deleted successfully!", "success");
  } catch (error) {
    roleError.textContent = error?.message || "Failed to delete role.";
    showNotification(error?.message || "Failed to delete role.", "error");
  }
});

settingsSaveBtn?.addEventListener("click", async () => {
  settingsStatus.textContent = "";
  try {
    await window.remusManager.saveAdminSettings({
      auditMaxEntries: Number(auditMaxInput.value || 0),
      timeoutMaxMinutes: Number(timeoutMaxInput.value || 0)
    });
    settingsStatus.textContent = "Settings saved.";
    showNotification("Admin settings saved successfully!", "success");
  } catch (error) {
    settingsStatus.textContent = error?.message || "Failed to save settings.";
    showNotification(error?.message || "Failed to save admin settings.", "error");
  }
});

inviteCopyBtn?.addEventListener("click", async () => {
  const value = inviteInput?.value?.trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    inviteCopyBtn.textContent = "Copied";
    setTimeout(() => {
      inviteCopyBtn.textContent = "Copy";
    }, 1500);
  } catch {
    // ignore clipboard errors
  }
});

publicUrlCopyBtn?.addEventListener("click", async () => {
  const publicUrlInput = document.getElementById("REMUS_PUBLIC_URL");
  const value = publicUrlInput?.value?.trim();
  if (!value) {
    showNotification("Public URL is empty.", "warning");
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    publicUrlCopyBtn.textContent = "Copied";
    setTimeout(() => {
      publicUrlCopyBtn.textContent = "Copy";
    }, 1500);
    showNotification("Public URL copied to clipboard!", "success");
  } catch {
    showNotification("Failed to copy to clipboard.", "error");
  }
});

iconSelectBtn.addEventListener("click", async () => {
  const info = await window.remusManager.selectIcon();
  const config = info?.config || {};
  setFormValues(config);
  setIconPreview(info?.iconFile, info?.iconPath);
});

iconClearBtn.addEventListener("click", async () => {
  const info = await window.remusManager.clearIcon();
  const config = info?.config || {};
  setFormValues(config);
  setIconPreview(info?.iconFile, info?.iconPath);
});

for (const btn of tabButtons) {
  btn.addEventListener("click", () => {
    activateTab(btn.dataset.tab);
  });
}

window.remusManager.onStatus((status) => {
  setStatus(status);
  if (status?.running) {
    void refreshAdminData();
    void refreshInviteInfo();
  } else {
    setInviteValue("", "Server stopped.");
  }
});

window.remusManager.onLog((entry) => {
  appendLog(entry);
  updateDashboard();
});

// ========== DRAG AND DROP FOR ICON ==========
if (iconDropZone) {
  iconDropZone.addEventListener("click", () => {
    iconSelectBtn.click();
  });

  iconDropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    iconDropZone.classList.add("drag-over");
  });

  iconDropZone.addEventListener("dragleave", () => {
    iconDropZone.classList.remove("drag-over");
  });

  iconDropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    iconDropZone.classList.remove("drag-over");

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith("image/")) {
      showNotification("Please drop an image file (PNG, JPG, etc.)", "error");
      return;
    }

    // For now, show info that drag-drop needs backend support
    showNotification("Drag & drop requires file upload support. Please use 'Choose Icon' button for now.", "warning");
  });
}

// ========== SEARCH FUNCTIONALITY ==========
// Simple implementation that filters table rows
if (usersSearch) {
  usersSearch.addEventListener("input", () => {
    const query = usersSearch.value.toLowerCase().trim();
    const rows = usersBody.querySelectorAll("tr");
    let visibleCount = 0;
    rows.forEach(row => {
      if (row.classList.contains("empty")) return;
      const text = row.textContent.toLowerCase();
      const matches = !query || text.includes(query);
      row.style.display = matches ? "" : "none";
      if (matches) visibleCount++;
    });
    if (visibleCount === 0 && rows.length > 0) {
      usersBody.innerHTML = '<tr><td class="empty" colspan="7">No matching users found.</td></tr>';
    }
  });
}

if (bansSearch) {
  bansSearch.addEventListener("input", () => {
    const query = bansSearch.value.toLowerCase().trim();
    const rows = bansBody.querySelectorAll("tr");
    rows.forEach(row => {
      if (row.classList.contains("empty")) return;
      const text = row.textContent.toLowerCase();
      row.style.display = !query || text.includes(query) ? "" : "none";
    });
  });
}

if (messagesSearch) {
  messagesSearch.addEventListener("input", () => {
    const query = messagesSearch.value.toLowerCase().trim();
    const rows = messagesBody.querySelectorAll("tr");
    rows.forEach(row => {
      if (row.classList.contains("empty")) return;
      const text = row.textContent.toLowerCase();
      row.style.display = !query || text.includes(query) ? "" : "none";
    });
  });
}

if (uploadsSearch) {
  uploadsSearch.addEventListener("input", () => {
    const query = uploadsSearch.value.toLowerCase().trim();
    const rows = uploadsBody.querySelectorAll("tr");
    rows.forEach(row => {
      if (row.classList.contains("empty")) return;
      const text = row.textContent.toLowerCase();
      row.style.display = !query || text.includes(query) ? "" : "none";
    });
  });
}

if (auditSearch) {
  auditSearch.addEventListener("input", () => {
    const query = auditSearch.value.toLowerCase().trim();
    const rows = auditBody.querySelectorAll("tr");
    rows.forEach(row => {
      if (row.classList.contains("empty")) return;
      const text = row.textContent.toLowerCase();
      row.style.display = !query || text.includes(query) ? "" : "none";
    });
  });
}

// Keyboard shortcuts
document.addEventListener("keydown", (event) => {
  // Ctrl+S to save configuration
  if (event.ctrlKey && event.key === "s") {
    event.preventDefault();
    const activeTab = document.querySelector(".tab-panel.active");
    if (activeTab?.id === "tab-config") {
      form.requestSubmit();
    }
  }

  // Ctrl+R to refresh admin data
  if (event.ctrlKey && event.key === "r") {
    event.preventDefault();
    void refreshAdminData();
    void refreshInviteInfo();
    showNotification("Data refreshed.", "success");
  }
});

// Warn before closing with unsaved changes
window.addEventListener("beforeunload", (event) => {
  if (hasUnsavedChanges) {
    event.preventDefault();
    event.returnValue = "";
    return "";
  }
});

// Warn before switching tabs with unsaved changes
for (const btn of tabButtons) {
  btn.addEventListener("click", (event) => {
    if (hasUnsavedChanges && btn.dataset.tab !== "config") {
      const ok = confirm("You have unsaved changes in the Configuration tab. Switch tabs anyway?");
      if (!ok) {
        event.stopImmediatePropagation();
        return;
      }
    }
  });
}

void init();
