// ============================================================================
// server.js — Snake Arcade v8.0 Backend (Lobby System + Public Cloud Ready)
// ✦ Lobby System v1.0  — FSM: WAITING → READY_CHECK → PLAYING → FINISHED
// ✦ Room Persistence   — Auto host-migration saat host disconnect
// ✦ Reconnect Window   — 20 detik grace period sebelum slot dilepas
// ✦ Cloud-Ready CORS   — Berjalan di Railway / Render / Fly.io
// Grafika Komputer · PjBL · D3 Teknik Informatika POLNEP
// ============================================================================

const express = require("express");
const http    = require("http");
const path    = require("path");
const os      = require("os");
const { Server } = require("socket.io");

let qrcode;
try { qrcode = require("qrcode-terminal"); } catch(e) { qrcode = null; }

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: 2000,
  pingTimeout:  8000,
  transports:   ["websocket", "polling"],
});

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/health", (req, res) => res.json({ status: "ok", rooms: rooms.size, players: players.size }));

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_PLAYERS_PER_ROOM = 8;
const RECONNECT_GRACE_MS   = 20000;
const CHAT_COOLDOWN_MS     = 2500;

const LOBBY_STATE = {
  WAITING:        "WAITING",
  READY_CHECK:    "READY_CHECK",
  MATCH_STARTING: "MATCH_STARTING",
  PLAYING:        "PLAYING",
  FINISHED:       "FINISHED",
};

const QUICK_CHAT_MESSAGES = [
  "GG!", "Nice!", "Nooo!", "Help!", "Watch Out!",
  "Good Luck!", "I'm Coming!", "😂", "😎", "🔥", "😱", "👑"
];

// ── In-Memory State ────────────────────────────────────────────────────────
// rooms: Map<roomId, RoomObject>
// players: Map<socketId, PlayerObject>
const rooms   = new Map();
const players = new Map();
const chatCooldowns    = new Map();
const disconnectTimers = new Map();

// ── Helpers ────────────────────────────────────────────────────────────────
function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function createRoom(hostSocketId, hostUsername, settings = {}) {
  let roomId;
  do { roomId = generateRoomId(); } while (rooms.has(roomId));

  const room = {
    id:         roomId,
    hostId:     hostSocketId,
    state:      LOBBY_STATE.WAITING,
    settings: {
      maxPlayers: settings.maxPlayers || MAX_PLAYERS_PER_ROOM,
      mode:       settings.mode || "easy",
      name:       settings.name || `${hostUsername}'s Room`,
    },
    players:    [],      // list of socketIds
    createdAt:  Date.now(),
    startTimer: null,
  };
  rooms.set(roomId, room);
  return room;
}

function getRoomOf(socketId) {
  const p = players.get(socketId);
  if (!p || !p.roomId) return null;
  return rooms.get(p.roomId) || null;
}

function broadcastLobby(room) {
  if (!room) return;
  const members = room.players.map(sid => {
    const p = players.get(sid);
    if (!p) return null;
    return {
      id:       sid,
      username: p.username,
      color:    p.color,
      mode:     p.mode,
      isHost:   sid === room.hostId,
      isReady:  p.isReady,
      status:   p.status,
    };
  }).filter(Boolean);

  io.to(room.id).emit("lobbyUpdate", {
    roomId:    room.id,
    roomName:  room.settings.name,
    state:     room.state,
    hostId:    room.hostId,
    members,
    maxPlayers: room.settings.maxPlayers,
    settings:  room.settings,
  });
}

function broadcastLeaderboard(room) {
  if (!room) return;
  const sorted = room.players.map(sid => players.get(sid)).filter(Boolean)
    .sort((a, b) => b.score - a.score);

  let crownId = null;
  if (sorted.length >= 2) {
    const topAlive = sorted.find(p => p.status === "alive");
    if (topAlive) crownId = topAlive.id;
  }

  const board = sorted.map(p => ({
    id:       p.id,
    username: p.username,
    score:    p.score,
    lives:    p.lives,
    status:   p.status,
    isCrown:  p.id === crownId,
    color:    p.color,
  }));

  io.to(room.id).emit("leaderboardLiveUpdate", { board, crownId });
}

function migrateHost(room) {
  if (!room || room.players.length === 0) return;
  const newHostId = room.players.find(sid => sid !== room.hostId) || room.players[0];
  if (!newHostId) return;
  room.hostId = newHostId;
  const newHost = players.get(newHostId);
  if (newHost) {
    io.to(room.id).emit("hostMigrated", { newHostId, newHostUsername: newHost.username });
    broadcastLobby(room);
    console.log(`  [Room ${room.id}] Host migrated to ${newHost.username}`);
  }
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.startTimer) clearTimeout(room.startTimer);
  // Kick all remaining players
  room.players.forEach(sid => {
    const p = players.get(sid);
    if (p) {
      p.roomId = null;
      p.isReady = false;
    }
    io.to(sid).emit("roomClosed", { reason: "Host menutup room atau semua pemain keluar." });
  });
  rooms.delete(roomId);
  console.log(`[Room ${roomId}] Dihapus.`);
}

function checkAllReady(room) {
  if (!room || room.state !== LOBBY_STATE.WAITING) return false;
  if (room.players.length < 1) return false;
  return room.players.every(sid => {
    const p = players.get(sid);
    return p && (p.isReady || sid === room.hostId);
  });
}

// ── LAN IP Detection ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
let localIP = "localhost";
const ifaces = os.networkInterfaces();
for (const dev in ifaces) {
  const skip = ["vbox","wsl","virtual","docker","vmware","hyper-v"].some(v => dev.toLowerCase().includes(v));
  if (skip) continue;
  ifaces[dev].forEach(iface => {
    if ((iface.family === "IPv4" || iface.family === 4) && !iface.internal) localIP = iface.address;
  });
}
const SERVER_LAN_URL = process.env.PUBLIC_URL || `http://${localIP}:${PORT}`;

// ── Socket.io Event Engine ─────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[+] Connected: ${socket.id}`);
  socket.emit("serverInfo", {
    localURL:  SERVER_LAN_URL,
    localIP,
    isCloud:   !!process.env.PUBLIC_URL,
    serverVersion: "8.0",
  });

  // ── CREATE ROOM (Host) ────────────────────────────────────────────────
  socket.on("createRoom", ({ username, color, mode, roomName }) => {
    const sanitizedName = (username || "").trim().substring(0, 12) || `Host-${socket.id.slice(0,4)}`;

    // Jika pemain sudah ada di room lain, keluar dulu
    const existingRoom = getRoomOf(socket.id);
    if (existingRoom) leaveRoom(socket, existingRoom);

    const room = createRoom(socket.id, sanitizedName, {
      mode:       mode || "easy",
      name:       roomName || `${sanitizedName}'s Room`,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
    });

    const player = {
      id:       socket.id,
      username: sanitizedName,
      color:    color || "#00f5c4",
      mode:     mode || "easy",
      roomId:   room.id,
      isHost:   true,
      isReady:  true,   // Host selalu ready
      status:   "lobby",
      score:    0,
      lives:    3,
      sessionStats: emptyStats(),
    };
    players.set(socket.id, player);
    room.players.push(socket.id);
    socket.join(room.id);

    socket.emit("roomCreated", {
      roomId:   room.id,
      roomName: room.settings.name,
      playerId: socket.id,
    });

    broadcastLobby(room);
    console.log(`[Room ${room.id}] Created by ${sanitizedName}`);
  });

  // ── JOIN ROOM ─────────────────────────────────────────────────────────
  socket.on("joinRoom", ({ username, color, mode, roomId }) => {
    const sanitizedName = (username || "").trim().substring(0, 12) || `Pemain-${socket.id.slice(0,4)}`;

    // Legacy support: jika roomId tidak ada, cari room tersedia atau buat baru
    const targetRoomId = roomId || findAvailableRoom();

    const room = rooms.get(targetRoomId);
    if (!room) {
      socket.emit("joinError", { code: "ROOM_NOT_FOUND", message: `Room ${targetRoomId} tidak ditemukan.` });
      return;
    }
    if (room.state !== LOBBY_STATE.WAITING) {
      socket.emit("joinError", { code: "GAME_IN_PROGRESS", message: "Pertandingan sudah dimulai." });
      return;
    }
    if (room.players.length >= room.settings.maxPlayers) {
      socket.emit("joinError", { code: "ROOM_FULL", message: `Room penuh (maks ${room.settings.maxPlayers} pemain).` });
      return;
    }

    // Cek reconnect: apakah socketId lama ada di room ini?
    const existingRoom = getRoomOf(socket.id);
    if (existingRoom) leaveRoom(socket, existingRoom);

    const livesMap = { easy: 3, medium: 2, hard: 1 };
    const player = {
      id:       socket.id,
      username: sanitizedName,
      color:    color || "#00cfff",
      mode:     mode || room.settings.mode,
      roomId:   room.id,
      isHost:   false,
      isReady:  false,
      status:   "lobby",
      score:    0,
      lives:    livesMap[mode] || 3,
      sessionStats: emptyStats(),
    };
    players.set(socket.id, player);
    room.players.push(socket.id);
    socket.join(room.id);

    socket.emit("roomApproved", {
      roomId:   room.id,
      roomName: room.settings.name,
      playerId: socket.id,
      mode:     player.mode,
      lives:    player.lives,
      playerCount: room.players.length,
      isLobbyMode: true,
    });

    io.to(room.id).emit("playerJoined", { username: sanitizedName, count: room.players.length });
    broadcastLobby(room);
    console.log(`[Room ${room.id}] ${sanitizedName} bergabung. (${room.players.length}/${room.settings.maxPlayers})`);
  });

  // ── PLAYER SET READY ──────────────────────────────────────────────────
  socket.on("playerReady", ({ isReady }) => {
    const p = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room) return;
    if (room.state !== LOBBY_STATE.WAITING) return;

    p.isReady = !!isReady;
    broadcastLobby(room);

    // Notif ke semua
    io.to(room.id).emit("playerReadyChange", {
      playerId: socket.id,
      username: p.username,
      isReady:  p.isReady,
    });
  });

  // ── UPDATE PLAYER SETTINGS (warna, mode, dll) DI LOBBY ───────────────
  socket.on("updateLobbySettings", ({ color, mode }) => {
    const p = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room || room.state !== LOBBY_STATE.WAITING) return;
    if (color) p.color = color;
    if (mode)  p.mode  = mode;
    broadcastLobby(room);
  });

  // ── START MATCH (Host Only) ───────────────────────────────────────────
  socket.on("startMatch", () => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room) return;
    if (room.hostId !== socket.id) {
      socket.emit("startError", { message: "Hanya host yang bisa memulai pertandingan." });
      return;
    }
    if (room.state !== LOBBY_STATE.WAITING) return;
    if (room.players.length < 1) {
      socket.emit("startError", { message: "Minimal 1 pemain diperlukan." });
      return;
    }

    room.state = LOBBY_STATE.MATCH_STARTING;
    broadcastLobby(room);

    // Hitung mundur 3 detik
    let count = 3;
    io.to(room.id).emit("matchCountdown", { count });
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(room.id).emit("matchCountdown", { count });
      } else {
        clearInterval(interval);
        room.state = LOBBY_STATE.PLAYING;
        // Reset stats semua pemain
        room.players.forEach(sid => {
          const pl = players.get(sid);
          if (pl) {
            pl.status = "alive";
            pl.score  = 0;
            pl.lives  = { easy: 3, medium: 2, hard: 1 }[pl.mode] || 3;
            pl.sessionStats = emptyStats();
          }
        });
        io.to(room.id).emit("matchStart", {
          roomId: room.id,
          players: room.players.map(sid => {
            const pl = players.get(sid);
            return pl ? { id: pl.id, username: pl.username, color: pl.color, mode: pl.mode } : null;
          }).filter(Boolean),
        });
        broadcastLeaderboard(room);
        console.log(`[Room ${room.id}] Match STARTED! (${room.players.length} pemain)`);
      }
    }, 1000);
  });

  // ── PLAYER UPDATE (saat bermain) ──────────────────────────────────────
  socket.on("playerUpdate", ({ score, lives, status, sessionStats }) => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room) return;

    if (status === "dead" && score === 0 && lives === 0) {
      // Keluar dari room
      leaveRoom(socket, room);
      return;
    }

    p.score  = typeof score  === "number" && score  >= 0 ? score  : p.score;
    p.lives  = typeof lives  === "number"             ? lives  : p.lives;
    p.status = status ?? p.status;
    if (sessionStats && typeof sessionStats === "object") Object.assign(p.sessionStats, sessionStats);

    broadcastLeaderboard(room);

    // Cek apakah semua dead → kembali ke lobby
    if (room.state === LOBBY_STATE.PLAYING) {
      const aliveCount = room.players.filter(sid => {
        const pl = players.get(sid);
        return pl && pl.status === "alive";
      }).length;
      if (aliveCount === 0) {
        room.state = LOBBY_STATE.FINISHED;
        io.to(room.id).emit("matchFinished", { reason: "Semua pemain selesai." });
        // Auto kembali ke lobby setelah 8 detik
        setTimeout(() => returnToLobby(room), 8000);
      }
    }
  });

  // ── RETURN TO LOBBY (Manual) ──────────────────────────────────────────
  socket.on("returnToLobby", () => {
    const room = getRoomOf(socket.id);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    returnToLobby(room);
  });

  // ── GHOST SABOTEUR ────────────────────────────────────────────────────
  socket.on("ghostDrop", ({ targetId }) => {
    const sender = players.get(socket.id);
    const target = players.get(targetId);
    if (!sender || !target) return;
    const sRoom = getRoomOf(socket.id);
    const tRoom = getRoomOf(targetId);
    if (!sRoom || !tRoom || sRoom.id !== tRoom.id) return;
    sender.sessionStats.saboteurSent++;
    target.sessionStats.saboteurReceived++;
    io.to(targetId).emit("incomingPoop");
  });

  // ── QUICK CHAT ────────────────────────────────────────────────────────
  socket.on("quickChat", ({ message }) => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room) return;
    if (!QUICK_CHAT_MESSAGES.includes(message)) return;
    const last = chatCooldowns.get(socket.id) || 0;
    const now  = Date.now();
    if (now - last < CHAT_COOLDOWN_MS) return;
    chatCooldowns.set(socket.id, now);
    io.to(room.id).emit("quickChatMessage", {
      id:       socket.id,
      username: p.username,
      message,
      ts:       now,
    });
  });

  // ── MATCH SUMMARY ─────────────────────────────────────────────────────
  socket.on("requestMatchSummary", () => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room) return;
    const allPlayers  = room.players.map(sid => players.get(sid)).filter(Boolean);
    const sorted      = [...allPlayers].sort((a, b) => b.score - a.score);
    const awards      = buildAwards(socket.id, p, allPlayers, sorted);
    const finalRank   = sorted.findIndex(pl => pl.id === socket.id) + 1;
    socket.emit("matchSummaryData", {
      username: p.username, finalScore: p.score,
      finalRank, totalPlayers: allPlayers.length,
      stats: p.sessionStats, awards,
    });
  });

  // ── LOBBY CHAT (text biasa di lobby) ─────────────────────────────────
  socket.on("lobbyChat", ({ message }) => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room) return;
    if (room.state !== LOBBY_STATE.WAITING && room.state !== LOBBY_STATE.READY_CHECK) return;
    const clean = (message || "").trim().substring(0, 80);
    if (!clean) return;
    const last = chatCooldowns.get(socket.id + "_lobby") || 0;
    const now  = Date.now();
    if (now - last < 1000) return;
    chatCooldowns.set(socket.id + "_lobby", now);
    io.to(room.id).emit("lobbyChatMessage", {
      id:       socket.id,
      username: p.username,
      message:  clean,
      ts:       now,
    });
  });

  // ── DISCONNECT ────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    console.log(`[-] Disconnected: ${socket.id} ${p ? `(${p.username})` : ""}`);

    if (!p || !room) {
      players.delete(socket.id);
      chatCooldowns.delete(socket.id);
      return;
    }

    if (room.state === LOBBY_STATE.PLAYING) {
      // Grace period: tunggu reconnect
      p.status = "disconnected";
      broadcastLeaderboard(room);
      io.to(room.id).emit("playerDisconnected", { id: socket.id, username: p.username });

      const timer = setTimeout(() => {
        leaveRoomById(socket.id, room);
        disconnectTimers.delete(socket.id);
      }, RECONNECT_GRACE_MS);
      disconnectTimers.set(socket.id, timer);
    } else {
      leaveRoom(socket, room);
    }
  });
});

// ── Room Helpers ───────────────────────────────────────────────────────────
function leaveRoom(socket, room) {
  leaveRoomById(socket.id, room);
}

function leaveRoomById(socketId, room) {
  if (!room) return;
  const p = players.get(socketId);

  room.players = room.players.filter(sid => sid !== socketId);
  if (p) {
    io.to(room.id).emit("playerLeft", { username: p.username, count: room.players.length });
    p.roomId  = null;
    p.isReady = false;
  }
  players.delete(socketId);
  chatCooldowns.delete(socketId);

  if (room.players.length === 0) {
    cleanupRoom(room.id);
    return;
  }

  // Jika host yang keluar, migrasi host
  if (room.hostId === socketId) migrateHost(room);

  broadcastLobby(room);
  broadcastLeaderboard(room);
}

function returnToLobby(room) {
  if (!room) return;
  room.state = LOBBY_STATE.WAITING;
  room.players.forEach(sid => {
    const pl = players.get(sid);
    if (pl) { pl.isReady = false; pl.status = "lobby"; pl.score = 0; }
  });
  // Host auto-ready
  const host = players.get(room.hostId);
  if (host) host.isReady = true;
  io.to(room.id).emit("returnedToLobby", { roomId: room.id });
  broadcastLobby(room);
  console.log(`[Room ${room.id}] Kembali ke lobby.`);
}

function findAvailableRoom() {
  for (const [id, room] of rooms) {
    if (room.state === LOBBY_STATE.WAITING && room.players.length < room.settings.maxPlayers) {
      return id;
    }
  }
  return null;
}

function emptyStats() {
  return {
    applesEaten: 0, goldCollected: 0, bananasCollected: 0,
    poopHits: 0, powerUpsUsed: 0, saboteurSent: 0, saboteurReceived: 0,
    highestCombo: 0, maxLevel: 1,
  };
}

function buildAwards(socketId, p, allPlayers, sorted) {
  const awards = [];
  const sortedByCombo = [...allPlayers].sort((a,b) => b.sessionStats.highestCombo - a.sessionStats.highestCombo);
  const sortedBySabot = [...allPlayers].sort((a,b) => b.sessionStats.saboteurSent - a.sessionStats.saboteurSent);
  const sortedByGold  = [...allPlayers].sort((a,b) => b.sessionStats.goldCollected - a.sessionStats.goldCollected);
  if (sorted[0]?.id         === socketId) awards.push({ icon: "👑", label: "Highest Score" });
  if (sortedByCombo[0]?.id  === socketId) awards.push({ icon: "🔥", label: "Highest Combo" });
  if (sortedBySabot[0]?.id  === socketId && p.sessionStats.saboteurSent > 0) awards.push({ icon: "👻", label: "Saboteur King" });
  if (sortedByGold[0]?.id   === socketId) awards.push({ icon: "✨", label: "Most Gold" });
  if (sorted[0]?.id         === socketId) awards.push({ icon: "🛡", label: "Longest Survivor" });
  return awards;
}

// ── Server Listen ──────────────────────────────────────────────────────────
if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🐍 Snake Arcade v8.0 — Lobby System Active`);
    console.log(`   ➜ Local       : http://localhost:${PORT}`);
    console.log(`   ➜ LAN/Cloud   : ${SERVER_LAN_URL}`);
    if (process.env.PUBLIC_URL) {
      console.log(`   ➜ Cloud Mode  : ✅ PUBLIC_URL detected`);
    }
    console.log();
    if (qrcode) {
      console.log(`📲 QR Code:`);
      qrcode.generate(SERVER_LAN_URL, { small: true });
    }
  });
}

module.exports = { app, server };