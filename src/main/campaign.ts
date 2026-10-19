import { app, ipcMain, BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

let child: ChildProcess | undefined;
let ready: Promise<string>;
let campaignURL = "";

export function startCampaign(): Promise<string> {
  if (ready) return ready;
  ready = (async () => {
    const resources = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const data = path.join(app.getPath("userData"), "campaign-data");
    fs.mkdirSync(data, { recursive: true });
    const urlFile = path.join(data, "desktop-url.txt");
    if (fs.existsSync(urlFile)) fs.unlinkSync(urlFile);
    const python = path.join(resources, "python", "python.exe");
    const script = path.join(resources, "campaign", "app.py");
    child = spawn(python, [script], { windowsHide: true, env: {
      ...process.env, MESA_DATA_DIR: data, MESA_NO_BROWSER: "1", MESA_PORT: "0", MESA_TEST_URL_FILE: urlFile,
    }, stdio: ["ignore", "ignore", "ignore"] });
    let failure = "";
    child.on("error", () => { failure = "Não foi possível iniciar o serviço da campanha."; });
    child.on("exit", () => { if (!campaignURL) failure = "O serviço da campanha encerrou antes de abrir."; });
    for (let attempt = 0; attempt < 150; attempt++) {
      if (failure) throw new Error(failure);
      if (fs.existsSync(urlFile)) {
        const url = fs.readFileSync(urlFile, "utf8");
        const parsed = new URL(url);
        if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "http:") throw new Error("Endereço local inválido.");
        campaignURL = url;
        return url;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("A campanha demorou para iniciar. Reinicie o aplicativo.");
  })();
  return ready;
}

export function bindCampaign(window: BrowserWindow) {
  const urlHandler = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents) throw new Error("Acesso negado");
    return startCampaign();
  };
  ipcMain.removeHandler("MESA_CAMPAIGN_URL");
  ipcMain.handle("MESA_CAMPAIGN_URL", urlHandler);
  // Reuse the token explicitly entered in the desktop's Discord settings.
  let syncQueue = Promise.resolve();
  const syncToken = (event: Electron.IpcMainEvent, token: string = "") => {
    if (event.sender !== window.webContents) return;
    syncQueue = syncQueue.then(async () => {
    try {
      const url = new URL(await startCampaign());
      const key = url.searchParams.get("key");
      const response = await fetch(url.origin + (token ? "/api/connect" : "/api/disconnect"), {
        method: "POST", headers: { "Content-Type": "application/json", "X-Mesa": "local", Cookie: `mesa=${key}`, Origin: url.origin },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) window.webContents.send("ERROR", "O áudio conectou, mas a campanha não validou o token. Confira Conexões na campanha.");
    } catch { if (!window.isDestroyed()) window.webContents.send("ERROR", "Não foi possível conectar a campanha ao bot."); }
    });
  };
  ipcMain.on("DISCORD_CONNECT", syncToken);
  ipcMain.on("DISCORD_DISCONNECT", syncToken);
  window.on("closed", () => {
    ipcMain.off("DISCORD_CONNECT", syncToken);
    ipcMain.off("DISCORD_DISCONNECT", syncToken);
  });
}

app.on("before-quit", () => { child?.kill(); });
