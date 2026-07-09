import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { Server } from 'socket.io';
import { TikTokLive } from 'tiktok-live-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config', 'horses.json');

// Read as plain JSON (avoids Node-version-specific import-assertion syntax)
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    // On some hosts the filesystem is read-only/ephemeral outside of deploys.
    // That's fine -- the in-memory config still works for the current server run.
    console.warn('Could not persist config to disk (this is OK, race still works):', err.message);
  }
}

// TikTool (tik.tools) handles the WebSocket signing for us, and its free
// Community tier requires no credit card -- unlike Euler Stream (the
// tiktok-live-connector default), whose signing route now needs a paid
// Business plan. Get a free key at https://tik.tools and set TIKTOOL_API_KEY
// in your .env. The tiktok-live-api package also reads this env var
// automatically if you don't pass apiKey explicitly, but we pass it here
// so the "no key set" case fails with a clear error instead of a silent one.
const TIKTOOL_API_KEY = process.env.TIKTOOL_API_KEY;

const app = express();
const server = http.createServer(app);
// Raise the default 1MB socket payload limit since custom horse icons (base64
// images) can push a single "updateConfig" message over that.
const io = new Server(server, { maxHttpBufferSize: 10 * 1024 * 1024 });

app.use(express.static(path.join(__dirname, 'public')));

// ---- Mutable race config (can be changed live via the Setup panel) ----
let trackLength;
let horseDefs; // [{ id, name, giftName, image, flip }]
let horses;    // horseDefs + live position, used during a race
let raceActive = true;
let winner = null;

function applyLoadedConfig(config) {
  trackLength = config.trackLength;
  horseDefs = config.horses;
}

applyLoadedConfig(loadConfig());

// Tracks in-progress combo counts so we only add the *new* portion of a combo,
// keyed by `${uniqueUserId}-${giftId}`
const comboTracker = new Map();

function resetRace() {
  horses = horseDefs.map(h => ({ ...h, position: 0 }));
  raceActive = true;
  winner = null;
  comboTracker.clear();
  io.emit('raceReset', { horses, trackLength });
}

function applyGiftToHorse(giftName, stepCount, sender) {
  if (!raceActive || stepCount <= 0) return;

  const horse = horses.find(h => h.giftName === giftName);
  if (!horse) return; // gift not assigned to any horse, ignore

  horse.position = Math.min(horse.position + stepCount, trackLength);

  io.emit('horseMove', {
    horseId: horse.id,
    position: horse.position,
    trackLength,
    steps: stepCount,
    sender: sender || 'Debug'
  });

  if (horse.position >= trackLength && raceActive) {
    raceActive = false;
    winner = horse;
    io.emit('raceFinished', { winner: horse });
  }
}

function handleGiftEvent(data) {
  // tiktok-live-api's gift event gives giftName, giftId, repeatCount, and
  // repeatEnd directly on the event (see tik.tools docs), so this stays
  // compatible with the same combo-tracking logic used before.
  const giftName = data.giftName;
  const uniqueUserId = data.user?.uniqueId || data.user?.userId || 'unknown';
  const giftId = data.giftId || giftName;
  const key = `${uniqueUserId}-${giftId}`;

  const currentCount = data.repeatCount || 1;
  const lastCount = comboTracker.get(key) || 0;
  const delta = currentCount - lastCount;

  if (delta > 0) {
    applyGiftToHorse(giftName, delta, data.user?.nickname || data.user?.uniqueId);
    comboTracker.set(key, currentCount);
  }

  if (data.repeatEnd) {
    comboTracker.delete(key);
  }
}

// ---- TikTok LIVE connection (via TikTool's managed, free-tier-friendly API) ----
let tiktokConnection = null;

function connectToTikTok(username) {
  if (tiktokConnection) {
    tiktokConnection.disconnect();
  }

  if (!TIKTOOL_API_KEY) {
    console.error('No TIKTOOL_API_KEY set. Get a free key at https://tik.tools and add it to your .env');
    io.emit('tiktokStatus', { connected: false, username, error: 'Missing TIKTOOL_API_KEY -- get a free key at tik.tools' });
    return;
  }

  tiktokConnection = new TikTokLive(username, {
    apiKey: TIKTOOL_API_KEY
  });

  tiktokConnection.on('roomInfo', info => {
    console.log(`Connected to TikTok LIVE: @${username} (room ${info.roomId})`);
    io.emit('tiktokStatus', { connected: true, username });
  });

  tiktokConnection.on('gift', handleGiftEvent);

  tiktokConnection.on('disconnected', () => {
    io.emit('tiktokStatus', { connected: false, username });
  });

  tiktokConnection.connect().catch(err => {
    console.error('Failed to connect to TikTok LIVE:', err.message);
    io.emit('tiktokStatus', { connected: false, username, error: err.message });
  });
}

// ---- Socket.IO (browser <-> server) ----
io.on('connection', socket => {
  socket.emit('raceReset', { horses, trackLength });
  if (winner) socket.emit('raceFinished', { winner });

  socket.on('resetRace', () => resetRace());

  socket.on('connectTikTok', username => {
    if (username && username.trim()) connectToTikTok(username.trim());
  });

  // Debug/testing: simulate a gift being sent without a live TikTok stream
  socket.on('debugGift', ({ giftName, count }) => {
    applyGiftToHorse(giftName, count || 1, 'Debug');
  });

  // Setup panel: update horse count / names / gift assignment / custom icons
  socket.on('updateConfig', payload => {
    if (!payload || !Array.isArray(payload.horses) || payload.horses.length === 0) return;

    const cleanHorses = payload.horses.map((h, i) => ({
      id: i + 1,
      name: (h.name || `Horse ${i + 1}`).slice(0, 40),
      giftName: (h.giftName || '').slice(0, 60),
      emoji: h.emoji || '🎁',
      image: h.image || null, // base64 data URL or null to fall back to emoji
      flip: h.flip !== false,
      color: h.color || '#999999'
    }));

    const newConfig = {
      trackLength: Number(payload.trackLength) > 0 ? Number(payload.trackLength) : trackLength,
      horses: cleanHorses
    };

    applyLoadedConfig(newConfig);
    saveConfig(newConfig);
    resetRace();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.TIKTOK_USERNAME) {
    connectToTikTok(process.env.TIKTOK_USERNAME);
  } else {
    console.log('No TIKTOK_USERNAME set. Use the "Connect" box on the page, or set the env var.');
  }
});
