import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, "../server.js");
const port = Number(process.env.PORT ?? "3180");
const appUrl = `http://127.0.0.1:${port}`;

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let quitting = false;

function startServer(): void {
  if (serverProcess) {
    return;
  }

  const nodeBinary = process.env.SYSTEM_LENS_NODE ?? process.env.NODE_BINARY ?? "node";
  serverProcess = spawn(nodeBinary, [serverEntry], {
    cwd: path.resolve(__dirname, "../../../.."),
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: "inherit",
  });

  serverProcess.once("exit", (code, signal) => {
    serverProcess = null;
    if (!quitting) {
      console.error(`System Lens server exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "null"}`);
    }
  });
}

function stopServer(): void {
  if (!serverProcess || serverProcess.killed) {
    return;
  }
  serverProcess.kill("SIGTERM");
}

function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const poll = (): void => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });

      req.once("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(poll, 300);
      });

      req.setTimeout(1000, () => {
        req.destroy();
      });
    };

    poll();
  });
}

async function createWindow(): Promise<void> {
  startServer();
  await waitForServer(appUrl);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "System Lens",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadURL(appUrl);
  mainWindow.once("closed", () => {
    mainWindow = null;
  });
}

app.on("before-quit", () => {
  quitting = true;
  stopServer();
});

app.whenReady().then(() => {
  createWindow().catch((error: unknown) => {
    console.error(error);
    app.quit();
  });
});

app.on("activate", () => {
  if (!mainWindow) {
    createWindow().catch((error: unknown) => {
      console.error(error);
      app.quit();
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
