const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { dialog } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const CONFIG_KEYS = [
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

function resolveFirstExisting(paths) {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return paths[0];
}

const APP_DIR = path.resolve(__dirname, "..");
const ASAR_DIR = app.isPackaged ? path.join(process.resourcesPath, "app.asar") : APP_DIR;
const UNPACKED_DIR = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : APP_DIR;
const WINDOW_ICON_PATH = path.join(__dirname, "remus-logo.png");
const SERVER_ENTRY = resolveFirstExisting([
  path.join(ASAR_DIR, "src", "index.js"),
  path.join(UNPACKED_DIR, "src", "index.js"),
  path.join(APP_DIR, "src", "index.js")
]);
const ENV_EXAMPLE_PATH = resolveFirstExisting([
  path.join(ASAR_DIR, ".env.example"),
  path.join(UNPACKED_DIR, ".env.example"),
  path.join(APP_DIR, ".env.example")
]);
const RUNTIME_DIR = app.isPackaged ? path.join(app.getPath("userData"), "runtime") : APP_DIR;
const DATA_DIR = path.join(RUNTIME_DIR, "data");
const UPLOADS_DIR = path.join(RUNTIME_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");
const ENV_PATH = path.join(RUNTIME_DIR, ".env");
const ICON_NAME_PREFIX = "server-icon";
const MEDIASOUP_WORKER_RELATIVE = path.join("node_modules", "mediasoup", "worker", "out", "Release");

const windows = new Set();
let serverProcess = null;
let logs = [];
let stopping = false;
let adminKey = "";
let lastServerPid = null;

function nowIso() {
  return new Date().toISOString();
}

function ensureRuntimeDirs() {
  for (const dir of [RUNTIME_DIR, DATA_DIR, UPLOADS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function resolveMediasoupWorkerBin() {
  const baseDir = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : APP_DIR;
  const workerDir = path.join(baseDir, MEDIASOUP_WORKER_RELATIVE);
  const exePath = path.join(workerDir, "mediasoup-worker.exe");
  const binPath = path.join(workerDir, "mediasoup-worker");

  if (fs.existsSync(exePath)) {
    return exePath;
  }
  if (fs.existsSync(binPath)) {
    return binPath;
  }
  return "";
}

function parseEnv(raw) {
  const parsed = {};
  const lines = String(raw || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1);
    parsed[key] = value;
  }
  return parsed;
}

function toEnvText(config) {
  const lines = [];
  for (const key of CONFIG_KEYS) {
    const value = config[key] ?? "";
    lines.push(`${key}=${String(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

function loadDefaults() {
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    return parseEnv(fs.readFileSync(ENV_EXAMPLE_PATH, "utf8"));
  }

  return {
    PORT: "4000",
    REMUS_SERVER_NAME: "My Remus Community",
    REMUS_PUBLIC_URL: "http://localhost:4000",
    REMUS_REGION: "local",
    REMUS_MAIN_BACKEND_URL: "http://localhost:3001",
    REMUS_CLIENT_ORIGIN: "http://localhost:5173",
    REMUS_FILE_LIMIT_MB: "100",
    REMUS_SERVER_ICON: "",
    REMUS_ICE_SERVERS: "[{\"urls\":[\"stun:stun.l.google.com:19302\",\"stun:stun1.l.google.com:19302\"]}]",
    REMUS_MEDIA_LISTEN_IP: "0.0.0.0",
    REMUS_MEDIA_ANNOUNCED_IP: "",
    REMUS_MEDIA_MIN_PORT: "40000",
    REMUS_MEDIA_MAX_PORT: "49999"
  };
}

function resolveIconFromConfig(config) {
  const value = String(config?.REMUS_SERVER_ICON || "").trim();
  if (!value || value.startsWith("http://") || value.startsWith("https://")) {
    return { value, filePath: "", isRuntime: false };
  }

  const absolute = path.isAbsolute(value) ? value : path.join(RUNTIME_DIR, value);
  return {
    value,
    filePath: fs.existsSync(absolute) ? absolute : "",
    isRuntime: absolute.startsWith(RUNTIME_DIR)
  };
}

function setIconFromSource(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error("Icon file does not exist.");
  }

  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  if (!allowed.has(ext)) {
    throw new Error("Unsupported icon format. Use PNG, JPG, WEBP, or GIF.");
  }

  const destName = `${ICON_NAME_PREFIX}${ext}`;
  const destPath = path.join(RUNTIME_DIR, destName);
  ensureRuntimeDirs();
  fs.copyFileSync(sourcePath, destPath);

  const config = loadConfig();
  config.REMUS_SERVER_ICON = destName;
  saveConfig(config);

  return {
    canceled: false,
    config,
    iconPath: destName,
    iconFile: destPath
  };
}

function ensureEnvExists() {
  ensureRuntimeDirs();
  if (!fs.existsSync(ENV_PATH)) {
    const defaults = loadDefaults();
    fs.writeFileSync(ENV_PATH, toEnvText(defaults), "utf8");
  }
}

function loadConfig() {
  const defaults = loadDefaults();
  ensureEnvExists();
  const local = parseEnv(fs.readFileSync(ENV_PATH, "utf8"));
  const merged = { ...defaults, ...local };
  const result = {};
  for (const key of CONFIG_KEYS) {
    result[key] = merged[key] ?? "";
  }
  return result;
}

function saveConfig(input) {
  const next = {};
  for (const key of CONFIG_KEYS) {
    next[key] = input?.[key] ?? "";
  }
  fs.writeFileSync(ENV_PATH, toEnvText(next), "utf8");
  return next;
}

function statusPayload() {
  return {
    running: !!serverProcess,
    pid: serverProcess?.pid || null,
    updatedAt: nowIso()
  };
}

function broadcast(channel, payload) {
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function pushLog(line, stream = "info") {
  const entry = {
    at: nowIso(),
    stream,
    line: String(line || "")
      .replace(/\r/g, "")
      .trimEnd()
  };

  if (!entry.line) return;

  logs.push(entry);
  if (logs.length > 2000) {
    logs = logs.slice(-2000);
  }
  broadcast("manager:log", entry);
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

function parsePortRange(minValue, maxValue) {
  const min = parsePort(minValue);
  const max = parsePort(maxValue);
  if (!min || !max || min > max) {
    return { min: 40000, max: 49999 };
  }
  return { min, max };
}

function runNetsh(args) {
  return new Promise((resolve) => {
    const child = spawn("netsh", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 4000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = data?.error || data?.message || text || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

function ensureAdminKey() {
  if (!adminKey) {
    adminKey = crypto.randomBytes(16).toString("hex");
  }
  return adminKey;
}

async function fetchAdmin(pathname, options = {}) {
  if (!serverProcess) {
    throw new Error("Community server is not running.");
  }
  const config = loadConfig();
  const port = parsePort(config?.PORT || "4000") || 4000;
  const url = `http://127.0.0.1:${port}${pathname}`;
  return fetchJson(url, {
    ...options,
    headers: {
      "X-Remus-Admin-Key": ensureAdminKey()
    }
  });
}

function isFirewallRuleAllowed(output) {
  const text = String(output || "");
  if (text.toLowerCase().includes("no rules match")) {
    return false;
  }
  const enabled = /Enabled:\s*Yes/i.test(text);
  const actionAllow = /Action:\s*Allow/i.test(text);
  const dirIn = /Direction:\s*In/i.test(text);
  return enabled && actionAllow && dirIn;
}

async function checkFirewallRule(name) {
  const result = await runNetsh(["advfirewall", "firewall", "show", "rule", `name=${name}`]);
  const output = `${result.stdout}\n${result.stderr}`;
  return {
    ok: result.code === 0 && isFirewallRuleAllowed(output),
    raw: output.trim()
  };
}

function checkTcpPortListening(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(600);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

async function applyFirewallRules(config, reason = "manual") {
  const port = parsePort(config?.PORT || "4000") || 4000;
  const range = parsePortRange(config?.REMUS_MEDIA_MIN_PORT || 40000, config?.REMUS_MEDIA_MAX_PORT || 49999);
  const rules = [
    {
      name: `Remus Community Server TCP ${port}`,
      args: ["advfirewall", "firewall", "add", "rule", `name=Remus Community Server TCP ${port}`, "dir=in", "action=allow", "protocol=TCP", `localport=${port}`]
    },
    {
      name: `Remus Community Media UDP ${range.min}-${range.max}`,
      args: [
        "advfirewall",
        "firewall",
        "add",
        "rule",
        `name=Remus Community Media UDP ${range.min}-${range.max}`,
        "dir=in",
        "action=allow",
        "protocol=UDP",
        `localport=${range.min}-${range.max}`
      ]
    },
    {
      name: `Remus Community Media TCP ${range.min}-${range.max}`,
      args: [
        "advfirewall",
        "firewall",
        "add",
        "rule",
        `name=Remus Community Media TCP ${range.min}-${range.max}`,
        "dir=in",
        "action=allow",
        "protocol=TCP",
        `localport=${range.min}-${range.max}`
      ]
    }
  ];

  for (const rule of rules) {
    await runNetsh(["advfirewall", "firewall", "delete", "rule", `name=${rule.name}`]);
    const result = await runNetsh(rule.args);
    if (result.code !== 0) {
      const combined = `${result.stdout}\n${result.stderr}`.trim();
      const message = combined || "Firewall rule failed (requires admin).";
      pushLog(`Firewall rule failed: ${rule.name} (${message})`, "stderr");
      return { ok: false, message: "Firewall update failed (run as Administrator)." };
    }
  }

  const note = reason === "startup" ? "Firewall rules applied (startup)." : "Firewall rules applied.";
  pushLog(note, "info");
  return { ok: true, message: note };
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      resolve(false);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port, "0.0.0.0");
  });
}

function findTcpPid(port) {
  return new Promise((resolve) => {
    const child = spawn("netstat", ["-ano", "-p", "tcp"], { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", () => {
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        if (!line.includes(`:${port}`)) continue;
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isInteger(pid) && pid > 0) {
          resolve(pid);
          return;
        }
      }
      resolve(null);
    });
    child.on("error", () => resolve(null));
  });
}

function forceKillPid(pid) {
  return new Promise((resolve) => {
    if (!pid || process.platform !== "win32") {
      resolve(false);
      return;
    }
    const child = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function stopServerInternal(force = false) {
  if (!serverProcess) return;

  stopping = true;
  const child = serverProcess;

  if (process.platform === "win32" && force) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    return;
  }

  child.kill("SIGTERM");

  setTimeout(() => {
    if (serverProcess && serverProcess.pid === child.pid) {
      stopServerInternal(true);
    }
  }, 3000);
}

async function startServerInternal() {
  if (serverProcess) {
    return statusPayload();
  }

  if (!fs.existsSync(SERVER_ENTRY)) {
    pushLog(`Server entry file not found: ${SERVER_ENTRY}`, "stderr");
    return statusPayload();
  }

  ensureEnvExists();
  const envConfig = loadConfig();
  const port = parsePort(envConfig.PORT || "4000");

  if (!port) {
    pushLog(`Invalid PORT value: ${String(envConfig.PORT || "").trim() || "(empty)"}`, "stderr");
    return statusPayload();
  }

  let available = await checkPortAvailable(port);
  if (!available) {
    const pid = await findTcpPid(port);
    if (pid && lastServerPid && pid === lastServerPid) {
      pushLog(`Port ${port} is still held by the previous Remus server (PID ${pid}). Forcing shutdown.`, "stderr");
      await forceKillPid(pid);
      await sleep(400);
      available = await checkPortAvailable(port);
    }
    if (!available) {
      const pidLabel = pid ? ` (PID ${pid})` : "";
      pushLog(`Cannot start server: port ${port} is already in use${pidLabel}. Change PORT or stop the other process.`, "stderr");
      return statusPayload();
    }
  }

  await applyFirewallRules(envConfig, "startup");

  const env = {
    ...process.env,
    ...envConfig,
    REMUS_RUNTIME_DIR: RUNTIME_DIR,
    REMUS_DB_PATH: DB_PATH,
    REMUS_UPLOADS_DIR: UPLOADS_DIR,
    REMUS_ADMIN_KEY: ensureAdminKey(),
    ELECTRON_RUN_AS_NODE: "1"
  };

  const workerBin = resolveMediasoupWorkerBin();
  if (workerBin) {
    env.MEDIASOUP_WORKER_BIN = workerBin;
  }

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: RUNTIME_DIR,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess = child;
  lastServerPid = child.pid;
  stopping = false;

  child.stdout.on("data", (chunk) => {
    pushLog(chunk.toString(), "stdout");
  });

  child.stderr.on("data", (chunk) => {
    pushLog(chunk.toString(), "stderr");
  });

  child.on("error", (error) => {
    pushLog(`Process error: ${error.message || String(error)}`, "stderr");
  });

  child.on("exit", (code, signal) => {
    const reason = stopping
      ? `Server stopped (code=${code ?? "null"}, signal=${signal ?? "null"})`
      : `Server exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`;
    pushLog(reason, stopping ? "info" : "stderr");
    serverProcess = null;
    stopping = false;
    broadcast("manager:status", statusPayload());
  });

  pushLog("Server process started.", "info");
  broadcast("manager:status", statusPayload());
  return statusPayload();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    icon: fs.existsSync(WINDOW_ICON_PATH) ? WINDOW_ICON_PATH : undefined,
    backgroundColor: "#1e1f22",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadFile(path.join(__dirname, "index.html"));

  windows.add(win);
  win.on("closed", () => {
    windows.delete(win);
  });

  return win;
}

ipcMain.handle("manager:config-load", () => {
  return loadConfig();
});

ipcMain.handle("manager:config-save", (_, config) => {
  const saved = saveConfig(config || {});
  pushLog("Saved .env configuration.", "info");
  return saved;
});

ipcMain.handle("manager:status", () => {
  return statusPayload();
});

ipcMain.handle("manager:logs", () => {
  return logs;
});

ipcMain.handle("manager:server-start", () => {
  return startServerInternal();
});

ipcMain.handle("manager:server-stop", () => {
  stopServerInternal(false);
  return statusPayload();
});

ipcMain.handle("manager:open-folder", () => {
  shell.openPath(RUNTIME_DIR);
  return true;
});

ipcMain.handle("manager:firewall-allow", (_, config) => {
  return applyFirewallRules(config || loadConfig(), "manual");
});

ipcMain.handle("manager:ports-check", async (_, config) => {
  const envConfig = config || loadConfig();
  const port = parsePort(envConfig?.PORT || "4000") || 4000;
  const range = parsePortRange(envConfig?.REMUS_MEDIA_MIN_PORT || 40000, envConfig?.REMUS_MEDIA_MAX_PORT || 49999);
  const rules = {
    tcpServer: `Remus Community Server TCP ${port}`,
    udpMedia: `Remus Community Media UDP ${range.min}-${range.max}`,
    tcpMedia: `Remus Community Media TCP ${range.min}-${range.max}`
  };

  const [tcpRule, udpRule, tcpMediaRule, listening] = await Promise.all([
    checkFirewallRule(rules.tcpServer),
    checkFirewallRule(rules.udpMedia),
    checkFirewallRule(rules.tcpMedia),
    checkTcpPortListening(port)
  ]);

  let external = {
    ok: false,
    error: "Backend URL is not configured."
  };

  const backendBase = String(envConfig?.REMUS_MAIN_BACKEND_URL || "").trim().replace(/\/$/, "");
  if (backendBase) {
    try {
      const ipInfo = await fetchJson(`${backendBase}/api/net/public-ip`, { timeoutMs: 5000 });
      const publicIp = String(ipInfo?.ip || "").trim();
      const isPrivate = !!ipInfo?.isPrivate;
      if (!publicIp) {
        external = { ok: false, error: "Could not determine public IP." };
      } else if (isPrivate) {
        external = { ok: false, publicIp, isPrivate, error: "Detected private IP; backend cannot verify port forwarding." };
      } else {
        const ports = [port, range.min, range.max].filter((value, index, arr) => arr.indexOf(value) === index);
        const check = await fetchJson(`${backendBase}/api/net/port-check`, {
          method: "POST",
          body: { host: publicIp, ports, timeoutMs: 2000 },
          timeoutMs: 8000
        });
        external = {
          ok: true,
          publicIp,
          isPrivate,
          results: Array.isArray(check?.results) ? check.results : []
        };
      }
    } catch (error) {
      external = { ok: false, error: error?.message || "External check failed." };
    }
  }

  return {
    port,
    range,
    listening,
    rules: {
      tcpServer: tcpRule.ok,
      udpMedia: udpRule.ok,
      tcpMedia: tcpMediaRule.ok
    },
    details: {
      tcpServer: tcpRule.raw,
      udpMedia: udpRule.raw,
      tcpMedia: tcpMediaRule.raw
    },
    external,
    note: "TCP ports can be verified externally. UDP forwarding cannot be fully verified without a remote client handshake."
  };
});

ipcMain.handle("manager:admin-users", async () => {
  return fetchAdmin("/api/admin/users");
});

ipcMain.handle("manager:admin-user-kick", async (_, userId) => {
  if (!userId) {
    throw new Error("User ID is required.");
  }
  return fetchAdmin(`/api/admin/users/${encodeURIComponent(userId)}/kick`, { method: "POST" });
});

ipcMain.handle("manager:admin-user-ban", async (_, userId) => {
  if (!userId) {
    throw new Error("User ID is required.");
  }
  return fetchAdmin(`/api/admin/users/${encodeURIComponent(userId)}/ban`, { method: "POST" });
});

ipcMain.handle("manager:admin-messages", async (_, limit) => {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 1000) : 200;
  return fetchAdmin(`/api/admin/messages?limit=${safeLimit}`);
});

ipcMain.handle("manager:admin-uploads", async (_, limit) => {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 1000) : 200;
  return fetchAdmin(`/api/admin/uploads?limit=${safeLimit}`);
});

ipcMain.handle("manager:admin-roles", async () => {
  return fetchAdmin("/api/admin/roles");
});

ipcMain.handle("manager:admin-members", async () => {
  return fetchAdmin("/api/admin/members");
});

ipcMain.handle("manager:admin-role-create", async (_, payload) => {
  return fetchAdmin("/api/admin/roles", { method: "POST", body: payload || {} });
});

ipcMain.handle("manager:admin-role-update", async (_, roleId, payload) => {
  if (!roleId) {
    throw new Error("Role ID is required.");
  }
  return fetchAdmin(`/api/admin/roles/${encodeURIComponent(roleId)}`, { method: "PATCH", body: payload || {} });
});

ipcMain.handle("manager:admin-role-delete", async (_, roleId) => {
  if (!roleId) {
    throw new Error("Role ID is required.");
  }
  return fetchAdmin(`/api/admin/roles/${encodeURIComponent(roleId)}`, { method: "DELETE" });
});

ipcMain.handle("manager:admin-member-roles", async (_, userId, payload) => {
  if (!userId) {
    throw new Error("User ID is required.");
  }
  return fetchAdmin(`/api/admin/members/${encodeURIComponent(userId)}/roles`, { method: "PATCH", body: payload || {} });
});

ipcMain.handle("manager:admin-audit", async (_, limit) => {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 1000) : 200;
  return fetchAdmin(`/api/admin/audit?limit=${safeLimit}`);
});

ipcMain.handle("manager:admin-settings", async () => {
  return fetchAdmin("/api/admin/settings");
});

ipcMain.handle("manager:admin-settings-save", async (_, payload) => {
  return fetchAdmin("/api/admin/settings", { method: "PATCH", body: payload || {} });
});

ipcMain.handle("manager:server-info", async () => {
  const config = loadConfig();
  const port = parsePort(config?.PORT || "4000") || 4000;
  const url = `http://127.0.0.1:${port}/api/server/info`;
  return fetchJson(url, { timeoutMs: 3000 });
});

ipcMain.handle("manager:admin-bans", async () => {
  return fetchAdmin("/api/admin/bans");
});

ipcMain.handle("manager:admin-unban", async (_, userId) => {
  if (!userId) {
    throw new Error("User ID is required.");
  }
  return fetchAdmin(`/api/admin/bans/${encodeURIComponent(userId)}/unban`, { method: "POST" });
});

ipcMain.handle("manager:icon-info", () => {
  const config = loadConfig();
  const icon = resolveIconFromConfig(config);
  return {
    config,
    iconPath: icon.value || "",
    iconFile: icon.filePath || ""
  };
});

ipcMain.handle("manager:icon-select", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }
    ]
  });

  if (result.canceled || !result.filePaths?.length) {
    const config = loadConfig();
    const icon = resolveIconFromConfig(config);
    return {
      canceled: true,
      config,
      iconPath: icon.value || "",
      iconFile: icon.filePath || ""
    };
  }

  return setIconFromSource(result.filePaths[0]);
});

ipcMain.handle("manager:icon-set-path", (_, sourcePath) => {
  return setIconFromSource(String(sourcePath || "").trim());
});

ipcMain.handle("manager:icon-clear", () => {
  const config = loadConfig();
  const icon = resolveIconFromConfig(config);
  if (icon.filePath && icon.isRuntime) {
    try {
      fs.unlinkSync(icon.filePath);
    } catch {}
  }
  config.REMUS_SERVER_ICON = "";
  saveConfig(config);
  return {
    config,
    iconPath: "",
    iconFile: ""
  };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  stopServerInternal(true);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
