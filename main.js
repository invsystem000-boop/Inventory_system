const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const { getPortCandidates } = require('./port-config');

const PORT_CANDIDATES = getPortCandidates(process.env.PORT);
let mainWindow = null;

function isServerResponding(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/collections`, { timeout: 500 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.on('error', () => {
      resolve(false);
    });
  });
}

async function findBackendPort() {
  for (const port of PORT_CANDIDATES) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await isServerResponding(port)) {
        return port;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return PORT_CANDIDATES[0];
}

function startServer() {
  try {
    require(path.join(__dirname, 'server.js'));
  } catch (err) {
    console.error('Failed to start inventory backend:', err);
    throw err;
  }
}

async function createWindow() {
  const port = await findBackendPort();

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#1f2028',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${port}`);
}

app.whenReady().then(async () => {
  try {
    startServer();
    await createWindow();
  } catch (err) {
    console.error('Failed to start inventory app:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
