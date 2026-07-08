require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const horseConfig = require('./config/horses.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const TRACK_LENGTH = horseConfig.trackLength;
let horses = horseConfig.horses.map(h => ({ ...h, position: 0 }));
let raceActive = true;
let winner = null;

// Tracks in-progress combo counts so we only add the *new* portion of a combo,
// keyed by `${uniqueUserId}-${giftId}`
const comboTracker = new Map();

function resetRace() {
  horses = horseConfig.horses.map(h => ({ ...h, position: 0 }));
  raceActive = true;
  winner = null;
  comboTracker.clear();
  io.emit('raceReset', { horses, trackLength: TRACK_LENGTH });
}

function applyGiftToHorse(giftName, stepCount, sender) {
  if (!raceActive || stepCount <= 0) return;

  const horse = horses.find(h => h.giftName === giftName);
  if (!horse) return; // gift not assigned to any horse, ignore

  horse.position = Math.min(horse.position + stepCount, TRACK_LENGTH);

  io.emit('horseMove', {
    horseId: horse.id,
    position: horse.position,
    trackLength: TRACK_LENGTH,
    steps: stepCount,
    sender: sender || 'Debug'
  });

  if (horse.position >= TRACK_LENGTH && raceActive) {
    raceActive = false;
    winner = horse;
    io.emit('raceFinished', { winner: horse });
  }
}

function handleGiftEvent(data) {
  const giftName = data.giftName;
  const uniqueUserId = data.userId || data.uniqueId || 'unknown';
  const giftId = data.giftId || giftName;
  const key = `${uniqueUserId}-${giftId}`;

  const currentCount = data.repeatCount || 1;
  const lastCount = comboTracker.get(key) || 0;
  const delta = currentCount - lastCount;

  if (delta > 0) {
    applyGiftToHorse(giftName, delta, data.nickname || data.uniqueId);
    comboTracker.set(key, currentCount);
  }

  if (data.repeatEnd) {
    comboTracker.delete(key);
  }
}

// ---- TikTok LIVE connection ----
let tiktokConnection = null;

function connectToTikTok(username) {
  if (tiktokConnection) {
    tiktokConnection.disconnect();
  }

  tiktokConnection = new WebcastPushConnection(username);

  tiktokConnection.connect().then(state => {
    console.log(`Connected to TikTok LIVE: @${username} (room ${state.roomId})`);
    io.emit('tiktokStatus', { connected: true, username });
  }).catch(err => {
    console.error('Failed to connect to TikTok LIVE:', err.message);
    io.emit('tiktokStatus', { connected: false, username, error: err.message });
  });

  tiktokConnection.on('gift', handleGiftEvent);

  tiktokConnection.on('disconnected', () => {
    io.emit('tiktokStatus', { connected: false, username });
  });
}

// ---- Socket.IO (browser <-> server) ----
io.on('connection', socket => {
  socket.emit('raceReset', { horses, trackLength: TRACK_LENGTH });
  if (winner) socket.emit('raceFinished', { winner });

  socket.on('resetRace', () => resetRace());

  socket.on('connectTikTok', username => {
    if (username && username.trim()) connectToTikTok(username.trim());
  });

  // Debug/testing: simulate a gift being sent without a live TikTok stream
  socket.on('debugGift', ({ giftName, count }) => {
    applyGiftToHorse(giftName, count || 1, 'Debug');
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
