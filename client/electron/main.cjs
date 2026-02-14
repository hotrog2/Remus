const { app, BrowserWindow, shell, ipcMain, desktopCapturer, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const DEV_URL = process.env.REMUS_CLIENT_DEV_URL || "http://localhost:5173";
const LOCAL_SERVER_PORT = Number(process.env.REMUS_CLIENT_PORT || 1215);
let staticServer = null;
let staticServerPort = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8"
};

function resolveWindowIcon() {
  const candidate = app.isPackaged
    ? path.join(__dirname, "..", "dist", "remus-logo.png")
    : path.join(__dirname, "..", "public", "remus-logo.png");
  return fs.existsSync(candidate) ? candidate : undefined;
}

function startStaticServer() {
  if (staticServer) {
    return Promise.resolve(staticServerPort);
  }

  const distDir = path.join(__dirname, "..", "dist");
  if (!fs.existsSync(distDir)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    staticServer = http.createServer((req, res) => {
      try {
        if (!req.url || req.method !== "GET") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Method Not Allowed");
          return;
        }

        const urlPath = decodeURIComponent(req.url.split("?")[0] || "/");
        const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
        let filePath = path.join(distDir, safePath);

        if (safePath === "/" || safePath === "\\") {
          filePath = path.join(distDir, "index.html");
        }

        if (!filePath.startsWith(distDir)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }

        if (!fs.existsSync(filePath)) {
          // SPA fallback
          filePath = path.join(distDir, "index.html");
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-store"
        });
        fs.createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal Server Error");
      }
    });

    staticServer.on("error", (error) => {
      staticServer = null;
      staticServerPort = null;
      reject(error);
    });

    staticServer.listen(LOCAL_SERVER_PORT, "127.0.0.1", () => {
      const addr = staticServer.address();
      staticServerPort = typeof addr === "object" && addr ? addr.port : null;
      resolve(staticServerPort);
    });
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    icon: resolveWindowIcon(),
    backgroundColor: "#1e1f22",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (!app.isPackaged && process.env.REMUS_DEVTOOLS !== "0") {
    mainWindow.webContents.openDevTools();
  }

  if (app.isPackaged) {
    startStaticServer()
      .then((port) => {
        if (!port) {
          mainWindow.loadURL(
            "data:text/plain;charset=UTF-8,Remus desktop build is missing dist/index.html. Run npm run build:exe."
          );
          return;
        }
        mainWindow.loadURL(`http://127.0.0.1:${port}/`);
      })
      .catch((error) => {
        if (error?.code === "EADDRINUSE") {
          dialog.showErrorBox(
            "Remus Client",
            `Local port ${LOCAL_SERVER_PORT} is already in use. Close other Remus clients or set REMUS_CLIENT_PORT to a free port.`
          );
        }
        mainWindow.loadURL("data:text/plain;charset=UTF-8,Remus desktop build failed to start local server.");
      });
    return;
  }

  mainWindow.loadURL(DEV_URL);
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("remus:get-screen-sources", async () => {
    if (!desktopCapturer?.getSources) {
      throw new Error("desktopCapturer is unavailable.");
    }
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      fetchWindowIcons: true
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name
    }));
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
    staticServerPort = null;
  }
});
