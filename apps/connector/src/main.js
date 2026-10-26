const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require("electron");
const path = require("path");
const log = require("electron-log");
const { autoUpdater } = require("electron-updater");

const store = require("./lib/store");
const api = require("./lib/api");
const heartbeat = require("./lib/heartbeat");
const cameraSync = require("./lib/cameraSync");
const { UPDATE_CHECK_INTERVAL_MS, BACKEND_URL } = require("./lib/config");

log.initialize?.();
autoUpdater.logger = log;

// EventEmitter throws if 'error' is emitted with no listener attached - these just log.
heartbeat.on("error", (err) => log.error("Heartbeat failed:", err.message));
cameraSync.on("error", (err) => log.error("Camera sync failed:", err.message));
cameraSync.on("synced", ({ count }) => updateTrayMenu());

let identity = null; // { connectorId, connectorToken, shopId, shopName }
let pairingWindow = null;
let tray = null;

function getToken() {
  return identity?.connectorToken || null;
}

function showPairingWindow() {
  if (pairingWindow) {
    pairingWindow.show();
    pairingWindow.focus();
    return;
  }
  pairingWindow = new BrowserWindow({
    width: 420,
    height: 300,
    resizable: false,
    title: "StaffPie Connector",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  pairingWindow.setMenuBarVisibility(false);
  pairingWindow.loadFile(path.join(__dirname, "renderer", "pairing.html"));
  pairingWindow.on("closed", () => {
    pairingWindow = null;
  });
}

function startServices() {
  cameraSync.start(getToken);
  heartbeat.start(getToken, () => {
    // Backend revoked/forgot this connector - clear local identity and ask to re-pair.
    identity = null;
    store.clear();
    updateTrayMenu();
    showPairingWindow();
  });
  updateTrayMenu();
}

function stopServices() {
  heartbeat.stop();
  cameraSync.stop();
}

function updateTrayMenu() {
  if (!tray) return;
  const paired = Boolean(identity);
  tray.setToolTip(
    paired ? `StaffPie Connector - ${identity.shopName || "paired"}` : "StaffPie Connector - not paired"
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: paired ? `Site: ${identity.shopName || identity.shopId}` : "Not paired", enabled: false },
      { label: paired ? `Cameras: ${cameraSync.count}` : "", enabled: false, visible: paired },
      { type: "separator" },
      { label: "Pair / Re-pair this PC", click: showPairingWindow },
      { label: "Check for updates", click: () => autoUpdater.checkForUpdatesAndNotify() },
      { type: "separator" },
      { label: "Quit", click: () => app.exit(0) },
    ])
  );
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.on("double-click", showPairingWindow);
  updateTrayMenu();
}

ipcMain.handle("pair", async (_event, pairingCode) => {
  try {
    const { data } = await api.pair(pairingCode);
    identity = {
      connectorId: data.connectorId,
      connectorToken: data.connectorToken,
      shopId: data.shopId,
      shopName: data.shopName,
    };
    store.save(identity);
    startServices();
    setTimeout(() => pairingWindow?.close(), 800);
    return { ok: true, shopName: identity.shopName };
  } catch (err) {
    log.error("Pairing failed:", err);
    return { ok: false, error: err.message };
  }
});

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", () => {
    tray?.displayBalloon?.({
      title: "StaffPie Connector update ready",
      content: "Restarting to apply the update...",
    });
    setTimeout(() => autoUpdater.quitAndInstall(), 5000);
  });
  autoUpdater.on("error", (err) => log.error("AutoUpdater error:", err));

  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), UPDATE_CHECK_INTERVAL_MS);
}

app.whenReady().then(() => {
  log.info(`StaffPie Connector ${app.getVersion()} starting, backend=${BACKEND_URL}`);
  createTray();

  identity = store.load();
  if (identity) {
    startServices();
  } else {
    showPairingWindow();
  }

  if (app.isPackaged) setupAutoUpdater();
});

app.on("window-all-closed", (e) => {
  // Tray app: never quit just because the pairing window closed.
  e.preventDefault?.();
});

app.on("before-quit", () => {
  stopServices();
});
