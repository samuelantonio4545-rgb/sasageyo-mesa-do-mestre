import fs from "fs";
import path from "path";
import { app, safeStorage, BrowserWindow, ipcMain } from "electron";
import { ChannelType, Client, Events, GatewayIntentBits } from "discord.js";
import { createDiceHandler } from "../dice/roll";
import {
  createAudioPlayer,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior,
} from "@discordjs/voice";

type VoiceChannel = {
  id: string;
  name: string;
  position: number;
};

type Guild = {
  id: string;
  name: string;
  icon: string;
  voiceChannels: VoiceChannel[];
};

export class DiscordBroadcast {
  window: BrowserWindow;
  client?: Client;
  audioPlayer = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
      // Set max missed frames to 60 seconds (20ms per frame)
      maxMissedFrames: 3000,
    },
  });
  credentialPath = () => path.join(app.getPath("userData"), "discord-protected.bin");
  _restore = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== this.window.webContents) throw new Error("Acesso negado");
    try {
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(this.credentialPath())) return null;
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(this.credentialPath())));
    } catch { throw new Error("Não foi possível recuperar a conexão. Informe o token novamente."); }
  };
  constructor(window: BrowserWindow) {
    this.window = window;
    ipcMain.handle("DISCORD_RESTORE", this._restore);
    ipcMain.on("DISCORD_CONNECT", this._handleConnect);
    ipcMain.on("DISCORD_DISCONNECT", this._handleDisconnect);
    ipcMain.on("DISCORD_JOIN_CHANNEL", this._handleJoinChannel);
    ipcMain.on("DISCORD_LEAVE_CHANNEL", this._handleLeaveChannel);
    this.audioPlayer.on("error", this._handleBroadcastError);
  }

  destroy() {
    ipcMain.removeHandler("DISCORD_RESTORE");
    ipcMain.off("DISCORD_CONNECT", this._handleConnect);
    ipcMain.off("DISCORD_DISCONNECT", this._handleDisconnect);
    ipcMain.off("DISCORD_JOIN_CHANNEL", this._handleJoinChannel);
    ipcMain.off("DISCORD_LEAVE_CHANNEL", this._handleLeaveChannel);
    this.client?.destroy();
    this.client = undefined;
  }

  _handleConnect = async (event: Electron.IpcMainEvent, token: string, diceEnabled = false) => {
    if (event.sender !== this.window.webContents) return;
    if (!token) {
      event.reply("DISCORD_DISCONNECTED");
      event.reply("ERROR", "Error connecting to bot: Invalid token");
      return;
    }
    if (this.client) {
      this.client.destroy();
      this.client = undefined;
    }

    try {
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates,
          ...(diceEnabled ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : [])],
      });
      if (diceEnabled) this.client.on(Events.MessageCreate, createDiceHandler((message: string) => {
        if (!this.window.isDestroyed()) this.window.webContents.send("ERROR", message);
      }));
      this.client.once(Events.ClientReady, async () => {
        event.reply("DISCORD_READY");
        event.reply("MESSAGE", "Connected");
        const rawGuilds = await this.client.guilds.fetch();
        const guilds: Guild[] = await Promise.all(
          rawGuilds.map(async (baseGuild) => {
            const guild = await baseGuild.fetch();
            const voiceChannels: VoiceChannel[] = [];
            const channels = await guild.channels.fetch();
            channels.forEach((channel) => {
              if (channel && channel.isVoiceBased()) {
                voiceChannels.push({
                  id: channel.id,
                  name: channel.name,
                  position: channel.rawPosition,
                });
              }
            });
            return {
              id: guild.id,
              name: guild.name,
              icon: guild.iconURL(),
              voiceChannels: voiceChannels.sort(
                (a, b) => a.position - b.position,
              ),
            };
          }),
        );
        event.reply("DISCORD_GUILDS", guilds);
      });
      this.client.on("error", (err) => {
        event.reply("DISCORD_DISCONNECTED");
        event.reply("ERROR", `Error connecting to bot: ${err.message}`);
      });
      await this.client.login(token);
      try {
        if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) throw new Error();
        const encrypted = safeStorage.encryptString(JSON.stringify({ token, diceEnabled }));
        fs.writeFileSync(this.credentialPath() + ".tmp", encrypted);
        fs.renameSync(this.credentialPath() + ".tmp", this.credentialPath());
      } catch { event.reply("ERROR", "Bot conectado, mas não foi possível salvar a conexão protegida neste computador."); }
    } catch (err) {
      event.reply("DISCORD_DISCONNECTED");
      event.reply("ERROR", diceEnabled ? `Não foi possível conectar. Ative Message Content Intent no portal do Discord ou desligue Dados no chat. ${err.message}` : `Error connecting to bot: ${err.message}`);
    }
  };

  _handleDisconnect = async (event: Electron.IpcMainEvent) => {
    if (event.sender !== this.window.webContents) return;
    try { fs.rmSync(this.credentialPath(), { force: true }); }
    catch { event.reply("ERROR", "Não foi possível apagar a conexão salva."); }
    event.reply("DISCORD_DISCONNECTED");
    event.reply("DISCORD_GUILDS", []);
    event.reply("DISCORD_CHANNEL_JOINED", "local");
    this.client?.destroy();
    this.client = undefined;
  };

  _handleJoinChannel = async (
    event: Electron.IpcMainEvent,
    channelId: string,
  ) => {
    if (this.client) {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isVoiceBased() && channel.joinable) {
        try {
          const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
          });
          connection.subscribe(this.audioPlayer);
          event.reply("DISCORD_CHANNEL_JOINED", channelId);
          connection.on("error", (e) => {
            console.error(e);
            connection.destroy();
            event.reply("DISCORD_CHANNEL_LEFT", channelId);
            event.reply(
              "ERROR",
              `Error connecting to voice channel: ${e.message}`,
            );
          });
        } catch (e) {
          console.error(e);
          event.reply("DISCORD_CHANNEL_LEFT", channelId);
          event.reply(
            "ERROR",
            `Error connecting to voice channel: ${e.message}`,
          );
        }
      }
    } else {
      event.reply("DISCORD_CHANNEL_LEFT", channelId);
      event.reply(
        "ERROR",
        `Unable to join voice channel. This channel might be full or this bot might not have permission to join.`,
      );
    }
  };

  _handleLeaveChannel = async (
    event: Electron.IpcMainEvent,
    channelId: string,
  ) => {
    const channel = await this.client.channels.fetch(channelId);
    if (channel.type === ChannelType.GuildVoice) {
      const connection = getVoiceConnection(channel.guild.id);
      connection.destroy();
    }
    event.reply("DISCORD_CHANNEL_LEFT", channelId);
  };

  _handleBroadcastError = (error: Error) => {
    this.window.webContents.send("ERROR", error.message);
    console.error(error);
  };
}
