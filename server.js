// ============================================================================
// server.js — Snake Arcade v9.0 Backend · BUG FIX EDITION
//
// ── SEMUA BUG DIPERBAIKI ──
//  ✦ FIX: quickJoin sekarang langsung lakukan joinRoom/createRoom di server
//         (tidak emit "quickJoinRedirect"/"quickJoinCreateRoom" lagi, 
//          karena client tidak ada handler untuk itu)
//  ✦ FIX: "joinedRoom" event seragam untuk semua join success (hapus roomApproved duplikat)
//  ✦ FIX: Ping loop — server hanya terima "pongCheck" dari client, tidak kirim pingCheck 
//         setiap update (sudah ada interval PING_INTERVAL_MS)
//  ✦ FIX: updateRoomSettings — gameMode & teamMode sekarang diproses dengan benar
//  ✦ FIX: broadcastLobby emit ke room berjalan dengan benar
//  ✦ FIX: startMatch — validasi semua pemain siap lebih akurat
//  ✦ FIX: leaveRoom cleanup tidak crash jika player undefined
//  ✦ FIX: Ghost timer tidak set ulang jika sudah aktif
//  ✦ FIX: Room browser — filter room dengan benar
//  ✦ FIX: Reconnect — room players array update benar
//  ✦ FIX: CORS & Socket.io transport config lebih robust
// ============================================================================

"use strict";

const express  = require("express");
const http     = require("http");
const path     = require("path");
const os       = require("os");
const crypto   = require("crypto");
const { Server } = require("socket.io");

// ── Optional: SQLite (graceful fallback ke RAM) ───────────────────────────
let db = null;
try {
  const Database = require("better-sqlite3");
  db = new Database("arcade.db");
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id       TEXT PRIMARY KEY,
      username TEXT,
      rp       INTEGER DEFAULT 1000,
      tier     TEXT DEFAULT 'Bronze',
      total_xp INTEGER DEFAULT 0,
      wins     INTEGER DEFAULT 0,
      games    INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS match_history (
      id         TEXT PRIMARY KEY,
      room_id    TEXT,
      player_ids TEXT,
      scores     TEXT,
      winner_id  TEXT,
      mode       TEXT,
      duration_s INTEGER,
      played_at  INTEGER
    );
    CREATE TABLE IF NOT EXISTS global_scores (
      player_id   TEXT PRIMARY KEY,
      username    TEXT,
      best_score  INTEGER DEFAULT 0,
      updated_at  INTEGER
    );
  `);
  console.log("[DB] SQLite aktif: arcade.db");
} catch {
  console.warn("[DB] better-sqlite3 tidak ditemukan → Mode RAM (History disabled)");
}

// ── Optional: QR Code ─────────────────────────────────────────────────────
let qrcode = null;
try { qrcode = require("qrcode-terminal"); } catch {}

// ════════════════════════════════════════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════════════════════════════════════════
const PORT               = process.env.PORT || 3000;
const IS_CLOUD           = !!process.env.VERCEL || !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT;
const RECONNECT_GRACE_MS = 30_000;
const ROOM_GHOST_TTL_MS  = 300_000;
const CHAT_COOLDOWN_MS   = 2_000;
const PING_INTERVAL_MS   = 5_000;
const MAX_SPECTATORS     = 10;

// ── Game Mode Whitelist ────────────────────────────────────────────────────
const GAME_MODES = [
  "normal"
];

// ── Seasonal Event ────────────────────────────────────────────────────────
function getCurrentSeasonalEvent() {
  const now = new Date();
  const m   = now.getMonth() + 1;
  const d   = now.getDate();
  if (m === 3 || m === 4) return { id: "ramadan",     name: "🌙 Bulan Ramadan", multiplier: 1.5, color: "#ffd700" };
  if (m === 12)            return { id: "christmas",   name: "🎄 Natal & Tahun Baru", multiplier: 1.3, color: "#00f5c4" };
  if (m === 8 && d >= 17 && d <= 25) return { id: "independence", name: "🇮🇩 HUT RI", multiplier: 1.7, color: "#ff3b5c" };
  const week   = Math.floor((now.getTime() / (7 * 24 * 3600000))) % 3;
  const weekly = [
    { id: "speed_week",  name: "⚡ Speed Week",  multiplier: 1.2, color: "#ff8c00" },
    { id: "combo_week",  name: "🔥 Combo Week",  multiplier: 1.2, color: "#b066ff" },
    { id: "golden_week", name: "✨ Golden Week", multiplier: 1.3, color: "#ffd700" },
  ];
  return weekly[week];
}

const QUICK_CHAT_MESSAGES = [
  "GG!", "Nice move!", "Siap!", "Follow me!", "Waspada!", "Aku di kanan!",
  "Kumpul sini!", "Mantap!", "Ayo semangat!",
  "Hati-hati poop!",
];

// LAN IPs — Filter interface virtual, hanya tampilkan jaringan fisik yang berguna
// Subnet yang difilter:
//   192.168.56.x  → VirtualBox Host-Only Adapter
//   192.168.99.x  → Docker / VirtualBox (alternatif)
//   172.17.x.x    → Docker bridge default
//   169.254.x.x   → APIPA / link-local (tidak ada DHCP)
const VIRTUAL_SUBNET_PREFIXES = [
  "192.168.56.",   // VirtualBox Host-Only
  "192.168.99.",   // Docker / VirtualBox alt
  "172.17.",       // Docker bridge
  "172.18.",       // Docker bridge alt
  "172.19.",       // Docker bridge alt
  "169.254.",      // APIPA link-local
];

// Nama interface virtual yang umum (case-insensitive)
const VIRTUAL_INTERFACE_KEYWORDS = [
  "virtualbox", "vmware", "vmnet", "vethernet",
  "docker", "loopback", "pseudo", "tunnel", "tap",
  "vbox", "hamachi", "vpn",
];

function isVirtualInterface(name, address) {
  // Cek berdasarkan prefix subnet
  for (const prefix of VIRTUAL_SUBNET_PREFIXES) {
    if (address.startsWith(prefix)) return true;
  }
  // Cek berdasarkan nama interface
  const nameLower = name.toLowerCase();
  for (const keyword of VIRTUAL_INTERFACE_KEYWORDS) {
    if (nameLower.includes(keyword)) return true;
  }
  return false;
}

function getAllLANIPs() {
  const nets = os.networkInterfaces();
  const ips  = [];

  // Prioritas: Wi-Fi / WLAN dulu, lalu Ethernet, lalu lainnya
  const priority = (name) => {
    const n = name.toLowerCase();
    if (n.includes("wi-fi") || n.includes("wifi") || n.includes("wlan") || n.includes("wireless")) return 0;
    if (n.includes("ethernet") || n.includes("eth") || n.includes("en0") || n.includes("en1"))      return 1;
    return 2;
  };

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal && !isVirtualInterface(name, net.address)) {
        ips.push({ ip: net.address, interface: name, priority: priority(name) });
      }
    }
  }

  // Urutkan: Wi-Fi > Ethernet > lainnya
  ips.sort((a, b) => a.priority - b.priority);
  return ips;
}

function getLANIP() {
  const ips = getAllLANIPs();
  return ips.length > 0 ? ips[0].ip : "localhost";
}

const LAN_IP         = getLANIP();
const ALL_LAN_IPS    = getAllLANIPs();
const SERVER_LAN_URL = IS_CLOUD
  ? (process.env.PUBLIC_URL || "https://snake-arcade.up.railway.app")
  : `http://${LAN_IP}:${PORT}`;

// ════════════════════════════════════════════════════════════════════════════
//  SETUP EXPRESS + SOCKET.IO
// ════════════════════════════════════════════════════════════════════════════
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin:      "*",
    methods:     ["GET", "POST"],
    credentials: false,
  },
  pingInterval:  10_000,
  pingTimeout:   25_000,
  transports:    ["polling", "websocket"],
  allowUpgrades: true,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ── Health ────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({
  status: "ok", version: "9.0.0",
  rooms: rooms.size, players: players.size,
  uptime: Math.floor(process.uptime()), dbActive: !!db,
  seasonalEvent: getCurrentSeasonalEvent(),
}));

// ── Room Browser API ──────────────────────────────────────────────────────
app.get("/api/rooms", (_, res) => {
  const list = [];
  rooms.forEach(room => {
    if (!room.settings.isPrivate && room.state === LOBBY_STATE.WAITING) {
      const host = players.get(room.hostId);
      list.push({
        id:          room.id,
        name:        room.settings.name,
        playerCount: room.players.length,
        maxPlayers:  room.settings.maxPlayers,
        mode:        room.settings.mode,
        gameMode:    room.settings.gameMode || "normal",
        teamMode:    room.settings.teamMode || false,
        createdAt:   room.createdAt,
        hostName:    host?.username ?? "—",
        isFull:      room.players.length >= room.settings.maxPlayers,
        avgPing:     0,
      });
    }
  });
  list.sort((a, b) => b.playerCount - a.playerCount);
  res.json(list);
});

// ── Server Info API ───────────────────────────────────────────────────────
app.get("/api/server-info", (_, res) => {
  res.json({
    version: "9.0.0",
    phase:   "Bug Fix Edition",
    isCloud: IS_CLOUD,
    url:     SERVER_LAN_URL,
    rooms:   rooms.size,
    players: players.size,
    uptime:  Math.floor(process.uptime()),
    dbActive: !!db,
    seasonalEvent: getCurrentSeasonalEvent(),
    features: [
      "lobby-v2", "token-reconnect", "room-browser", "quick-join",
      "ping-rtt", "kick-player", "host-migration", "ghost-timer",
      "quick-chat", "lobby-chat",
      "match-summary", "host-lock-room", "spectator-mode",
      "match-history", "seasonal-events", "team-mode", "vote-kick",
    ],
  });
});

// ── Global Leaderboard ────────────────────────────────────────────────────
app.get("/api/leaderboard", (_, res) => {
  if (!db) { res.json({ entries: [], message: "Database tidak aktif." }); return; }
  try {
    const rows = db.prepare(`
      SELECT gs.player_id, gs.username, gs.best_score,
             p.rp, p.tier, p.wins, p.games
      FROM global_scores gs
      LEFT JOIN players p ON p.id = gs.player_id
      ORDER BY gs.best_score DESC LIMIT 100
    `).all();
    res.json({ entries: rows, event: getCurrentSeasonalEvent() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Player Profile API ────────────────────────────────────────────────────
app.get("/api/player/:id", (req, res) => {
  if (!db) { res.json({ message: "DB tidak aktif" }); return; }
  try {
    const p  = db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id);
    const gs = db.prepare("SELECT best_score FROM global_scores WHERE player_id = ?").get(req.params.id);
    const mh = db.prepare("SELECT * FROM match_history WHERE player_ids LIKE ? ORDER BY played_at DESC LIMIT 20").all(`%${req.params.id}%`);
    res.json({ profile: p || null, bestScore: gs?.best_score || 0, matchHistory: mh });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


function saveMatchHistory(room, winner) {
  if (!db) return;
  try {
    const playerIds = room.players.join(",");
    const scores    = JSON.stringify(
      Object.fromEntries(room.players.map(sid => [sid, players.get(sid)?.score || 0]))
    );
    db.prepare(`
      INSERT INTO match_history (id, room_id, player_ids, scores, winner_id, mode, duration_s, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomBytes(8).toString("hex"),
      room.id, playerIds, scores,
      winner?.id || null,
      room.settings.mode,
      Math.floor((Date.now() - (room.startedAt || Date.now())) / 1000),
      Date.now()
    );
  } catch (err) { console.warn("[DB] saveMatchHistory error:", err.message); }
}

function updateGlobalScore(player) {
  if (!db || !player) return;
  try {
    const existing = db.prepare("SELECT best_score FROM global_scores WHERE player_id = ?").get(player.id);
    if (!existing || player.score > existing.best_score) {
      db.prepare(`
        INSERT INTO global_scores (player_id, username, best_score, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET best_score=excluded.best_score, username=excluded.username, updated_at=excluded.updated_at
      `).run(player.id, player.username, player.score, Date.now());
    }
  } catch {}
}

// ════════════════════════════════════════════════════════════════════════════
//  STATE MAPS
// ════════════════════════════════════════════════════════════════════════════
const LOBBY_STATE = {
  WAITING:        "WAITING",
  MATCH_STARTING: "MATCH_STARTING",
  PLAYING:        "PLAYING",
  FINISHED:       "FINISHED",
};

const rooms            = new Map();
const players          = new Map();
const sessionTokens    = new Map();
const disconnectTimers = new Map();
const roomGhostTimers  = new Map();
const chatCooldowns    = new Map();
const voteKickMap      = new Map();

function emptyStats() {
  return {
    applesEaten: 0, goldCollected: 0, bananasCollected: 0,
    poopHits: 0, highestCombo: 0, powerUpsUsed: 0,
    maxLevel: 1, saboteurSent: 0, saboteurReceived: 0,
  };
}

function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(id) ? generateRoomId() : id;
}

function generateToken() { return crypto.randomBytes(20).toString("hex"); }

function getRoomOf(socketId) {
  const p = players.get(socketId);
  return p?.roomId ? rooms.get(p.roomId) : null;
}

// ── Broadcast Lobby ────────────────────────────────────────────────────────
function broadcastLobby(room) {
  if (!room) return;
  const host       = players.get(room.hostId);
  const memberList = room.players.map(sid => {
    const p = players.get(sid);
    if (!p) return null;
    const ping        = p.ping || 0;
    const pingQuality = ping === 0 ? "unknown" : ping < 50 ? "excellent" : ping < 100 ? "good" : ping < 200 ? "fair" : "poor";
    let tier = null;
    if (db) {
      try { const row = db.prepare("SELECT tier FROM players WHERE id = ?").get(p.id); tier = row?.tier || null; } catch {}
    }
    return {
      id:          sid,
      username:    p.username,
      color:       p.color,
      isReady:     p.isReady,
      isHost:      sid === room.hostId,
      ping,
      pingQuality,
      mode:        p.mode || "easy",
      status:      p.status || "lobby",
      tier,
      team:        p.team || null,
    };
  }).filter(Boolean);

  io.to(room.id).emit("lobbyUpdate", {
    roomId:     room.id,
    roomName:   room.settings.name,
    hostId:     room.hostId,
    hostName:   host?.username ?? "—",
    state:      room.state,
    members:    memberList,
    maxPlayers: room.settings.maxPlayers,
    settings:   room.settings,
    isCloud:    IS_CLOUD,
    serverUrl:  SERVER_LAN_URL,
    gameMode:   room.settings.gameMode || "normal",
    teamMode:   room.settings.teamMode || false,
    seasonalEvent: getCurrentSeasonalEvent(),
    features: [
      "lobby-v2", "token-reconnect", "room-browser", "quick-join",
      "ping-rtt", "kick-player", "quick-chat",
      "match-summary", "spectator-mode", "team-mode", "vote-kick",
      "seasonal-events", "global-leaderboard",
    ],
  });
}

function broadcastLeaderboard(room) {
  if (!room) return;
  const lb = room.players
    .map(sid => {
      const p = players.get(sid);
      return p ? { id: sid, username: p.username, score: p.score || 0, lives: p.lives, status: p.status, color: p.color, team: p.team } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const aliveBoard = lb.filter(p => p.status === "alive");
  const crownId    = aliveBoard.length > 0 ? aliveBoard[0].id : null;
  const boardWithCrown = lb.map(p => ({ ...p, isCrown: p.id === crownId }));
  io.to(room.id).emit("leaderboardLiveUpdate", { board: boardWithCrown, crownId });
}

// ── Session Token Helpers ─────────────────────────────────────────────────
function saveSessionToken(socketId, roomId) {
  const token = generateToken();
  sessionTokens.set(token, { socketId, roomId, ts: Date.now() });
  const p = players.get(socketId);
  if (p) io.to(socketId).emit("sessionToken", { token, roomId });
  return token;
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  rooms.delete(roomId);
  voteKickMap.delete(roomId);
  console.log(`[Room] ${roomId} dihapus (kosong/timeout)`);
}

function migrateHost(room) {
  if (room.players.length === 0) return;
  const newHostId = room.players[0];
  room.hostId     = newHostId;
  const newHost   = players.get(newHostId);
  if (newHost) newHost.isReady = true;
  io.to(room.id).emit("hostMigrated", { newHostId, username: newHost?.username ?? "—" });
  broadcastLobby(room);
  console.log(`[Room] ${room.id} — Host migrated to ${newHost?.username}`);
}

// ── Ping RTT interval ─────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  players.forEach((p, sid) => {
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.emit("pingCheck", { ts: now });
  });
}, PING_INTERVAL_MS);

// ── Watchdog Heartbeat: force-resolve stuck matches every 5 seconds ────────
setInterval(() => {
  rooms.forEach(room => {
    if (room.state !== LOBBY_STATE.PLAYING) return;
    const hasActivePlayer = room.players.some(sid => {
      const pl = players.get(sid);
      return pl && (pl.status === "alive" || pl.status === "disconnected");
    });
    if (!hasActivePlayer) {
      console.warn(`[Watchdog] Room ${room.id} is PLAYING but has no active players — forcing checkMatchEnd`);
      checkMatchEnd(room);
    }
  });
}, 5000);

// ════════════════════════════════════════════════════════════════════════════
//  SOCKET.IO EVENT HANDLERS
// ════════════════════════════════════════════════════════════════════════════
io.on("connection", socket => {
  console.log(`[Socket] Connect: ${socket.id}`);

  // ── RTT Ping ─────────────────────────────────────────────────────────
  // Client kirim pingCheck ke server → server balas pongCheck
  socket.on("pingCheck", ({ ts }) => {
    socket.emit("pongCheck", { ts, serverTs: Date.now() });
  });

  socket.on("pongCheck", ({ ts }) => {
    // Client balas pongCheck dari server (ping yang server kirim via interval)
    // Tidak perlu tindakan di server
  });

  socket.on("latencyReport", ({ rtt }) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.ping = Math.max(0, Math.round(rtt));
    const room = getRoomOf(socket.id);
    if (room) io.to(room.id).emit("pingUpdate", { id: socket.id, ping: p.ping });
  });

  // ── Reconnect ─────────────────────────────────────────────────────────
  socket.on("reconnectWithToken", ({ token, username }) => {
    const stored = sessionTokens.get(token);
    if (!stored) {
      socket.emit("reconnectFailed", { reason: "Token tidak valid atau sudah kedaluwarsa." });
      return;
    }
    if (Date.now() - stored.ts > RECONNECT_GRACE_MS + 5000) {
      sessionTokens.delete(token);
      socket.emit("reconnectFailed", { reason: "Token kedaluwarsa." });
      return;
    }
    const room = rooms.get(stored.roomId);
    if (!room || room.state !== LOBBY_STATE.PLAYING) {
      sessionTokens.delete(token);
      socket.emit("reconnectFailed", { reason: "Room tidak ditemukan atau match sudah selesai." });
      return;
    }

    const oldTimer = disconnectTimers.get(stored.socketId);
    if (oldTimer) { clearTimeout(oldTimer); disconnectTimers.delete(stored.socketId); }

    const oldP = players.get(stored.socketId);
    if (oldP) {
      players.delete(stored.socketId);
      oldP.roomId = stored.roomId;
      oldP.status = "alive";
      players.set(socket.id, oldP);
      room.players = room.players.map(sid => sid === stored.socketId ? socket.id : sid);
    } else {
      players.set(socket.id, {
        id: socket.id, username: username || "Reconnected", color: "#00f5c4",
        roomId: stored.roomId, isReady: true, status: "alive", score: 0,
        lives: 3, ping: 0, mode: "easy",
        sessionStats: emptyStats(), lastX: null, lastY: null, dx: 0, dy: 0,
      });
      room.players.push(socket.id);
    }

    sessionTokens.delete(token);
    socket.join(stored.roomId);
    socket.emit("reconnectSuccess", {
      roomId:  stored.roomId,
      mode:    room.settings.mode,
      isHost:  room.hostId === socket.id,
      state:   room.state,
      players: room.players.map(sid => {
        const pl = players.get(sid);
        return pl ? { id: sid, username: pl.username, color: pl.color, mode: pl.mode } : null;
      }).filter(Boolean),
    });
    io.to(stored.roomId).emit("playerReconnected", { id: socket.id, username: players.get(socket.id)?.username });
    broadcastLeaderboard(room);
    console.log(`[Reconnect] ${username} reconnected to room ${stored.roomId}`);
  });

  // ── Create Room ───────────────────────────────────────────────────────
  socket.on("createRoom", ({ username, color, mode, roomName, isPrivate, gameMode, teamMode }) => {
    const name = (username || "").trim().substring(0, 12);
    if (!name) { socket.emit("createRoomError", { message: "Nama tidak boleh kosong." }); return; }

    // Keluar dari room lama jika ada
    const existingRoom = getRoomOf(socket.id);
    if (existingRoom) leaveRoom(socket, existingRoom);

    const roomId = generateRoomId();
    const room   = {
      id:         roomId,
      hostId:     socket.id,
      players:    [socket.id],
      spectators: [],
      state:      LOBBY_STATE.WAITING,
      settings: {
        name:       (roomName || "").substring(0, 20) || `${name}'s Room`,
        maxPlayers: 8,
        mode:       ["easy", "medium", "hard"].includes(mode) ? mode : "easy",
        gameMode:   GAME_MODES.includes(gameMode) ? gameMode : "normal",
        teamMode:   teamMode || false,
        isPrivate:  isPrivate || false,
      },
      createdAt:           Date.now(),
      startedAt:           null,
      isLocked:            false,
      initialPlayerCount:  0,
      matchSummaryTimer:   null,
      returnToLobbyTimer:  null,
      matchResultSnapshot: null,
    };
    rooms.set(roomId, room);

    // Bersihkan ghost timer jika ada
    if (roomGhostTimers.has(roomId)) {
      clearTimeout(roomGhostTimers.get(roomId));
      roomGhostTimers.delete(roomId);
    }

    players.set(socket.id, {
      id:           socket.id,
      username:     name,
      color:        color || "#00f5c4",
      roomId,
      isReady:      true, // host selalu ready
      status:       "lobby",
      score:        0,
      lives:        3,
      ping:         0,
      mode:         ["easy", "medium", "hard"].includes(mode) ? mode : "easy",
      sessionStats: emptyStats(),
      lastX: null, lastY: null, dx: 0, dy: 0,
      team: teamMode ? "red" : null,
    });

    socket.join(roomId);
    // FIX: Kirim "joinedRoom" yang konsisten (client listen event ini)
    socket.emit("joinedRoom", {
      roomId,
      roomName:  room.settings.name,
      isHost:    true,
      serverUrl: SERVER_LAN_URL,
      isCloud:   IS_CLOUD,
      team:      null,
    });
    // Juga emit roomCreated untuk backward compat
    socket.emit("roomCreated", {
      roomId,
      roomName:  room.settings.name,
      isHost:    true,
      serverUrl: SERVER_LAN_URL,
      isCloud:   IS_CLOUD,
    });
    broadcastLobby(room);
    console.log(`[Room] Created: ${roomId} by ${name}`);
  });

  // ── Join Room ─────────────────────────────────────────────────────────
  socket.on("joinRoom", ({ username, color, mode, roomId }) => {
    const name = (username || "").trim().substring(0, 12);
    if (!name) { socket.emit("joinRoomError", { message: "Nama tidak boleh kosong." }); return; }

    const normalizedId = (roomId || "").toString().trim().toUpperCase();
    const room = rooms.get(normalizedId);

    if (!room) {
      socket.emit("joinRoomError", { message: `Room "${normalizedId}" tidak ditemukan. Cek kode room.` });
      return;
    }
    if (room.state !== LOBBY_STATE.WAITING) {
      socket.emit("joinRoomError", { message: "Match sudah berjalan. Tidak bisa bergabung." });
      return;
    }
    if (room.isLocked) {
      socket.emit("joinRoomError", { message: "Room sedang dikunci oleh host." });
      return;
    }
    if (room.players.length >= room.settings.maxPlayers) {
      socket.emit("joinRoomError", { message: `Room sudah penuh (${room.players.length}/${room.settings.maxPlayers}).` });
      return;
    }
    // Cek apakah sudah ada di room ini
    if (room.players.includes(socket.id)) {
      socket.emit("joinRoomError", { message: "Kamu sudah berada di room ini." });
      return;
    }

    // Keluar dari room lama
    const existingRoom = getRoomOf(socket.id);
    if (existingRoom && existingRoom.id !== normalizedId) leaveRoom(socket, existingRoom);

    // Team assignment jika team mode
    let team = null;
    if (room.settings.teamMode) {
      const redCount  = room.players.filter(sid => players.get(sid)?.team === "red").length;
      const blueCount = room.players.filter(sid => players.get(sid)?.team === "blue").length;
      team = redCount <= blueCount ? "red" : "blue";
    }

    players.set(socket.id, {
      id:           socket.id,
      username:     name,
      color:        color || "#00cfff",
      roomId:       room.id,
      isReady:      false,
      status:       "lobby",
      score:        0,
      lives:        3,
      ping:         0,
      mode:         ["easy", "medium", "hard"].includes(mode) ? mode : "easy",
      sessionStats: emptyStats(),
      lastX: null, lastY: null, dx: 0, dy: 0,
      team,
    });

    room.players.push(socket.id);
    socket.join(room.id);

    // FIX: Emit "joinedRoom" event (event yang di-handle client)
    socket.emit("joinedRoom", {
      roomId:    room.id,
      roomName:  room.settings.name,
      isHost:    false,
      serverUrl: SERVER_LAN_URL,
      isCloud:   IS_CLOUD,
      team,
    });

    io.to(room.id).emit("playerJoined", { id: socket.id, username: name, count: room.players.length });
    broadcastLobby(room);
    console.log(`[Room] ${name} joined ${room.id} (${room.players.length}/${room.settings.maxPlayers})`);
  });

  // ── Spectator Join ────────────────────────────────────────────────────
  socket.on("joinSpectator", ({ username, roomId }) => {
    const name = (username || "Spectator").trim().substring(0, 12);
    const room = rooms.get((roomId || "").toUpperCase());
    if (!room) { socket.emit("joinRoomError", { message: "Room tidak ditemukan." }); return; }
    if ((room.spectators?.length || 0) >= MAX_SPECTATORS) {
      socket.emit("joinRoomError", { message: "Kapasitas penonton penuh." }); return;
    }
    if (!room.spectators) room.spectators = [];
    room.spectators.push({ id: socket.id, username: name });
    socket.join(`spec:${room.id}`);
    socket.emit("spectatorJoined", {
      roomId: room.id, roomName: room.settings.name,
      state: room.state, playerCount: room.players.length,
    });
    io.to(room.id).emit("spectatorCountUpdate", { count: room.spectators.length });
    broadcastLeaderboard(room);
  });

  // ── Player Ready ──────────────────────────────────────────────────────
  socket.on("playerReady", ({ isReady }) => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room || room.state !== LOBBY_STATE.WAITING) return;
    if (room.hostId === socket.id) return; // host selalu ready
    p.isReady = !!isReady;
    broadcastLobby(room);
    io.to(room.id).emit("playerReadyChange", { id: socket.id, username: p.username, isReady: p.isReady });
  });

  socket.on("toggleReady", () => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room || room.state !== LOBBY_STATE.WAITING) return;
    if (room.hostId === socket.id) return;
    p.isReady = !p.isReady;
    broadcastLobby(room);
    io.to(room.id).emit("playerReadyChange", { id: socket.id, username: p.username, isReady: p.isReady });
  });

  // ── Quick Join ────────────────────────────────────────────────────────
  // FIX: Server langsung proses join/create room (tidak emit redirect ke client)
  socket.on("quickJoin", ({ username, color, mode }) => {
    const name = (username || "").trim().substring(0, 12);
    if (!name) { socket.emit("quickJoinError", { message: "Nama tidak boleh kosong." }); return; }

    // Cari room publik yang available
    let targetRoom = null;
    rooms.forEach(r => {
      if (!targetRoom && !r.settings.isPrivate && r.state === LOBBY_STATE.WAITING
          && r.players.length < r.settings.maxPlayers && !r.isLocked) {
        targetRoom = r;
      }
    });

    if (targetRoom) {
      // Langsung join room yang ditemukan
      const existingRoom = getRoomOf(socket.id);
      if (existingRoom) leaveRoom(socket, existingRoom);

      let team = null;
      if (targetRoom.settings.teamMode) {
        const redCount  = targetRoom.players.filter(sid => players.get(sid)?.team === "red").length;
        const blueCount = targetRoom.players.filter(sid => players.get(sid)?.team === "blue").length;
        team = redCount <= blueCount ? "red" : "blue";
      }

      players.set(socket.id, {
        id: socket.id, username: name, color: color || "#00cfff",
        roomId: targetRoom.id, isReady: false, status: "lobby",
        score: 0, lives: 3, ping: 0, mode: ["easy", "medium", "hard"].includes(mode) ? mode : "easy",
        sessionStats: emptyStats(), lastX: null, lastY: null, dx: 0, dy: 0, team,
      });

      targetRoom.players.push(socket.id);
      socket.join(targetRoom.id);

      socket.emit("joinedRoom", {
        roomId:    targetRoom.id,
        roomName:  targetRoom.settings.name,
        isHost:    false,
        serverUrl: SERVER_LAN_URL,
        isCloud:   IS_CLOUD,
        team,
      });

      io.to(targetRoom.id).emit("playerJoined", { id: socket.id, username: name, count: targetRoom.players.length });
      broadcastLobby(targetRoom);
      console.log(`[QuickJoin] ${name} joined existing room ${targetRoom.id}`);
    } else {
      // Buat room baru
      const existingRoom = getRoomOf(socket.id);
      if (existingRoom) leaveRoom(socket, existingRoom);

      const roomId = generateRoomId();
      const room   = {
        id:         roomId,
        hostId:     socket.id,
        players:    [socket.id],
        spectators: [],
        state:      LOBBY_STATE.WAITING,
        settings: {
          name:       `${name}'s Room`,
          maxPlayers: 8,
          mode:       ["easy", "medium", "hard"].includes(mode) ? mode : "easy",
          gameMode:   "normal",
          teamMode:   false,
          isPrivate:  false,
        },
        createdAt:           Date.now(),
        startedAt:           null,
        isLocked:            false,
        initialPlayerCount:  0,
        matchSummaryTimer:   null,
        returnToLobbyTimer:  null,
        matchResultSnapshot: null,
      };
      rooms.set(roomId, room);

      players.set(socket.id, {
        id: socket.id, username: name, color: color || "#00cfff",
        roomId, isReady: true, status: "lobby",
        score: 0, lives: 3, ping: 0, mode: ["easy", "medium", "hard"].includes(mode) ? mode : "easy",
        sessionStats: emptyStats(), lastX: null, lastY: null, dx: 0, dy: 0, team: null,
      });

      socket.join(roomId);
      socket.emit("joinedRoom", {
        roomId, roomName: room.settings.name, isHost: true,
        serverUrl: SERVER_LAN_URL, isCloud: IS_CLOUD, team: null,
      });
      socket.emit("roomCreated", {
        roomId, roomName: room.settings.name, isHost: true,
        serverUrl: SERVER_LAN_URL, isCloud: IS_CLOUD,
      });
      broadcastLobby(room);
      console.log(`[QuickJoin] ${name} created new room ${roomId}`);
    }
  });

  // ── Start Match ───────────────────────────────────────────────────────
  socket.on("startMatch", () => {
    const room = getRoomOf(socket.id);
    if (!room || room.hostId !== socket.id || room.state !== LOBBY_STATE.WAITING) return;
    if (room.players.length < 1) {
      socket.emit("startMatchError", { message: "Tidak ada pemain di room!" });
      return;
    }

    // Cek semua pemain siap (kecuali host)
    const notReady = room.players.filter(sid => {
      if (sid === room.hostId) return false; // host tidak perlu ready
      const p = players.get(sid);
      return p && !p.isReady;
    });

    if (notReady.length > 0) {
      const names = notReady.map(sid => players.get(sid)?.username || "?").join(", ");
      socket.emit("startMatchError", { message: `Masih ada pemain yang belum siap: ${names}` });
      return;
    }

    room.state     = LOBBY_STATE.MATCH_STARTING;
    room.startedAt = Date.now();
    io.to(room.id).emit("matchStarting", { countdown: 3 });

    let count = 3;
    const cd  = setInterval(() => {
      io.to(room.id).emit("countdown", { count });
      count--;
      if (count < 0) {
        clearInterval(cd);
        room.state = LOBBY_STATE.PLAYING;
        room.initialPlayerCount = room.players.length; // Locked snapshot for lifecycle logic
        room.players.forEach(sid => {
          const p = players.get(sid);
          if (p) p.status = "alive";
        });

        const seasonalEvent = getCurrentSeasonalEvent();
        io.to(room.id).emit("matchStarted", {
          roomId:   room.id,
          mode:     room.settings.mode,
          gameMode: room.settings.gameMode,
          teamMode: room.settings.teamMode,
          seasonalEvent,
          players: room.players.map(sid => {
            const pl = players.get(sid);
            return pl ? { id: sid, username: pl.username, color: pl.color, mode: pl.mode } : null;
          }).filter(Boolean),
        });
        broadcastLeaderboard(room);
      }
    }, 1000);
  });

  // ── Player Update ─────────────────────────────────────────────────────
  socket.on("playerUpdate", (data) => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room) return;

    const MAX_SCORE_DELTA = 30;
    if (data.score !== undefined) {
      const delta = (data.score || 0) - (p.score || 0);
      if (delta > MAX_SCORE_DELTA) {
        p._cheatFlag = (p._cheatFlag || 0) + 1;
        if (p._cheatFlag > 5) { console.warn(`[AntiCheat] ${p.username} score anomaly detected`); return; }
      }
      p.score = Math.max(0, data.score);
    }

    if (data.lives  !== undefined) p.lives  = data.lives;
    if (data.status !== undefined) {
      // Catat timestamp kematian untuk ranking survival time
      if (data.status === "dead" && p.status !== "dead") p.diedAt = Date.now();
      p.status = data.status;
    }
    if (data.x      !== undefined) p.lastX  = data.x;
    if (data.y      !== undefined) p.lastY  = data.y;
    if (data.dx     !== undefined) p.dx     = data.dx;
    if (data.dy     !== undefined) p.dy     = data.dy;
    if (data.sessionStats) p.sessionStats = { ...p.sessionStats, ...data.sessionStats };

    updateGlobalScore(p);
    broadcastLeaderboard(room);

    // Delegate all match-end evaluation to centralized engine
    if (data.status === "dead") {
      checkMatchEnd(room);
    }
  });

  // ── Host Controls ─────────────────────────────────────────────────────
  socket.on("kickPlayer", ({ targetId }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (!targetId || targetId === socket.id) return;
    io.to(targetId).emit("kicked", { reason: "Dikeluarkan oleh host." });
    leaveRoomById(targetId, room);
  });

  socket.on("lockRoom", ({ locked }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.hostId !== socket.id) return;
    room.isLocked = !!locked;
    io.to(room.id).emit("roomLockChanged", { locked: room.isLocked });
  });

  // FIX: updateRoomSettings — semua field diproses dengan benar termasuk gameMode
  socket.on("updateRoomSettings", ({ roomName, mode, maxPlayers, isPrivate, teamMode, gameMode }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.hostId !== socket.id || room.state !== LOBBY_STATE.WAITING) return;

    if (roomName !== undefined && roomName !== null)
      room.settings.name = roomName.toString().substring(0, 20).trim() || room.settings.name;
    if (mode !== undefined && mode !== null)
      room.settings.mode = ["easy", "medium", "hard"].includes(mode) ? mode : room.settings.mode;
    if (maxPlayers !== undefined && maxPlayers !== null) {
      const mp = parseInt(maxPlayers);
      if (!isNaN(mp)) room.settings.maxPlayers = Math.min(8, Math.max(1, mp));
    }
    if (typeof isPrivate === "boolean") room.settings.isPrivate = isPrivate;
    if (typeof teamMode  === "boolean") room.settings.teamMode  = teamMode;
    if (gameMode !== undefined && gameMode !== null)
      room.settings.gameMode = GAME_MODES.includes(gameMode) ? gameMode : room.settings.gameMode;

    broadcastLobby(room);
    io.to(room.id).emit("roomSettingsUpdated", { settings: room.settings });
    console.log(`[Room] ${room.id} settings updated: mode=${room.settings.mode}, gameMode=${room.settings.gameMode}`);
  });

  // ── Vote Kick ─────────────────────────────────────────────────────────
  socket.on("voteKick", ({ targetId }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== LOBBY_STATE.PLAYING) return;
    const key = room.id;
    if (!voteKickMap.has(key)) {
      voteKickMap.set(key, { targetId, votes: new Set() });
    }
    const vk = voteKickMap.get(key);
    if (vk.targetId !== targetId) return;
    vk.votes.add(socket.id);
    const needed = Math.ceil(room.players.length * 0.6);
    io.to(room.id).emit("voteKickProgress", {
      targetId, targetName: players.get(targetId)?.username || "—",
      votes: vk.votes.size, majority: needed,
    });
    if (vk.votes.size >= needed) {
      io.to(targetId).emit("kicked", { reason: "Vote kick: mayoritas pemain memutuskan." });
      leaveRoomById(targetId, room);
      voteKickMap.delete(key);
    }
  });

  // ── Lobby Announcement ────────────────────────────────────────────────
  socket.on("lobbyAnnouncement", ({ message }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.hostId !== socket.id) return;
    const clean = (message || "").trim().substring(0, 100);
    if (!clean) return;
    io.to(room.id).emit("announcement", { message: clean, type: "success", ts: Date.now() });
  });

  // ── XP Sync ───────────────────────────────────────────────────────────
  socket.on("xpSync", ({ xp, level, username }) => {
    const p = players.get(socket.id);
    if (!p || !db) return;
    const safeXp    = Math.max(0, Math.min(10000, xp || 0));
    const safeLevel = Math.max(1, Math.min(10, level || 1));
    try {
      db.prepare(`
        INSERT INTO players (id, username, total_xp) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET total_xp = MAX(total_xp, excluded.total_xp), username = excluded.username
      `).run(socket.id, username || p.username, safeXp);
    } catch {}
  });

  // ── Match Summary ─────────────────────────────────────────────────────
  socket.on("requestMatchSummary", () => {
    const room = getRoomOf(socket.id);
    const p    = players.get(socket.id);
    if (!p) return;
    if (room && room.matchResultSnapshot) {
      broadcastMatchSummary(room);
    } else {
      socket.emit("matchSummaryData", {
        username:     p.username,
        finalScore:   p.score || 0,
        finalRank:    null,
        totalPlayers: 1,
        stats:        p.sessionStats || emptyStats(),
        awards:       [],
        seasonalEvent: getCurrentSeasonalEvent(),
      });
    }
  });

  // ── Ghost / Saboteur ──────────────────────────────────────────────────
  socket.on("ghostDrop", ({ targetId }) => {
    const sender = players.get(socket.id);
    const target = players.get(targetId);
    if (!sender || !target) return;
    sender.sessionStats.saboteurSent++;
    target.sessionStats.saboteurReceived++;
    io.to(targetId).emit("incomingPoop");
  });

  // ── Quick Chat ────────────────────────────────────────────────────────
  socket.on("quickChat", ({ message }) => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room) return;
    // FIX: Lebih permissive — terima pesan dari daftar server ATAU preset client
    const allowed = [
      ...QUICK_CHAT_MESSAGES,
      "GG!", "Nice!", "Nooo!", "Help!", "Watch Out!",
      "Good Luck!", "I'm Coming!", "😂", "😎", "🔥", "😱", "👑",
    ];
    if (!allowed.includes(message)) return;
    const last = chatCooldowns.get(socket.id + "_qc") || 0;
    const now  = Date.now();
    if (now - last < CHAT_COOLDOWN_MS) return;
    chatCooldowns.set(socket.id + "_qc", now);
    io.to(room.id).emit("quickChatMessage", { id: socket.id, username: p.username, message, ts: now });
  });

  // ── Lobby Chat ────────────────────────────────────────────────────────
  socket.on("lobbyChat", ({ message }) => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    if (!p || !room) return;
    const last = chatCooldowns.get(socket.id + "_chat") || 0;
    const now  = Date.now();
    if (now - last < CHAT_COOLDOWN_MS) return;
    chatCooldowns.set(socket.id + "_chat", now);
    const clean = (message || "").trim().substring(0, 80);
    if (!clean) return;
    io.to(room.id).emit("lobbyChatMessage", { id: socket.id, username: p.username, message: clean, ts: now });
  });

  // ── Return to Lobby ───────────────────────────────────────────────────
  socket.on("returnToLobby", () => {
    const room = getRoomOf(socket.id);
    if (room && room.hostId === socket.id) returnToLobby(room);
  });

  // ── Exit Game ─────────────────────────────────────────────────────────
  socket.on("exitGame", () => {
    const room = getRoomOf(socket.id);
    if (room) leaveRoom(socket, room);
  });

  // ── Disconnect ────────────────────────────────────────────────────────
  socket.on("disconnect", reason => {
    const p    = players.get(socket.id);
    const room = getRoomOf(socket.id);
    console.log(`[Socket] Disconnect: ${socket.id} (${p?.username || "?"}) — reason: ${reason}`);

    // Hapus dari spectators jika menonton
    rooms.forEach(r => {
      if (r.spectators) {
        const idx = r.spectators.findIndex(s => s.id === socket.id);
        if (idx !== -1) {
          r.spectators.splice(idx, 1);
          io.to(r.id).emit("spectatorCountUpdate", { count: r.spectators.length });
        }
      }
    });

    if (!p || !room) { players.delete(socket.id); return; }

    if (room.state === LOBBY_STATE.PLAYING) {
      saveSessionToken(socket.id, room.id);
      p.status = "disconnected";
      broadcastLeaderboard(room);
      io.to(room.id).emit("playerDisconnected", { id: socket.id, username: p.username });

      const timer = setTimeout(() => {
        leaveRoomById(socket.id, room);
        disconnectTimers.delete(socket.id);
        // Trigger centralized match-end check: player timeout counts as elimination
        checkMatchEnd(room);
      }, RECONNECT_GRACE_MS);
      disconnectTimers.set(socket.id, timer);
    } else {
      leaveRoom(socket, room);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  CENTRALIZED MATCH LIFECYCLE ENGINE
// ════════════════════════════════════════════════════════════════════════════

/**
 * determineWinner(room) — Pure function: evaluates room state and returns winner object or null.
 * Case 1: 1 Alive, 0+ Disconnected → the alive player wins.
 * Case 2: 0 Alive, 1 Disconnected  → the disconnected player wins (last remaining).
 * Case 3: All Dead, 0 Disconnected → highest score wins.
 * Case 4: Dead + Disconnected mix, 0 Alive → highest score among all wins.
 */
function determineWinner(room) {
  const alivePlayers        = room.players.filter(sid => players.get(sid)?.status === "alive");
  const disconnectedPlayers = room.players.filter(sid => players.get(sid)?.status === "disconnected");
  const allPlayerObjects    = room.players.map(sid => players.get(sid)).filter(Boolean);

  // Case 1
  if (alivePlayers.length === 1) {
    return players.get(alivePlayers[0]) || null;
  }

  // Case 2
  if (alivePlayers.length === 0 && disconnectedPlayers.length === 1) {
    return players.get(disconnectedPlayers[0]) || null;
  }

  // Case 3 & 4: highest score among all remaining players
  if (allPlayerObjects.length === 0) return null;
  return allPlayerObjects.reduce((best, p) => {
    return (p.score || 0) > (best.score || 0) ? p : best;
  }, allPlayerObjects[0]);
}

/**
 * checkMatchEnd(room) — Single source of truth for match termination.
 * Guard clause prevents double-triggering.
 */
function checkMatchEnd(room) {
  if (room.state !== LOBBY_STATE.PLAYING) return;

  const alivePlayers        = room.players.filter(sid => players.get(sid)?.status === "alive");
  const disconnectedPlayers = room.players.filter(sid => players.get(sid)?.status === "disconnected");
  const isMultiplayer       = room.initialPlayerCount > 1;

  let matchEnded;
  if (isMultiplayer) {
    matchEnded = (alivePlayers.length === 0) ||
                 (alivePlayers.length === 1 && disconnectedPlayers.length === 0);
  } else {
    matchEnded = (alivePlayers.length === 0);
  }

  if (!matchEnded) return;

  // ── Lock state immediately to prevent re-entry ──
  room.state = LOBBY_STATE.FINISHED;

  const winner       = determineWinner(room);
  const matchEndTime = Date.now();

  // ── Build immutable rankings snapshot ──
  const rankings = room.players
    .map(sid => {
      const pl = players.get(sid);
      if (!pl) return null;
      const survivalMs = (pl.diedAt && room.startedAt)
        ? pl.diedAt - room.startedAt
        : (room.startedAt ? matchEndTime - room.startedAt : 0);
      return {
        id:         sid,
        username:   pl.username,
        score:      pl.score || 0,
        survivalMs,
        status:     pl.status,
        color:      pl.color,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.survivalMs - a.survivalMs;
    })
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  const reason = winner
    ? `🏆 ${winner.username} menang!`
    : "Semua pemain selesai. 🏁";

  // ── Cache result snapshot (immutable reference for broadcastMatchSummary) ──
  room.matchResultSnapshot = {
    winner:   winner ? { id: winner.id, username: winner.username, score: winner.score || 0 } : null,
    rankings,
    reason,
    playerSummaries: room.players.map(sid => {
      const pl = players.get(sid);
      if (!pl) return null;
      const rank = rankings.find(r => r.id === sid)?.rank ?? null;
      const awards = [];
      if (rank === 1)                                        awards.push({ icon: "🏆", label: "Juara Pertama!" });
      if ((pl.sessionStats?.highestCombo || 0) >= 10)       awards.push({ icon: "🔥", label: "Combo Master!" });
      if ((pl.sessionStats?.applesEaten || 0) >= 30)        awards.push({ icon: "🍎", label: "Apple Maniac!" });
      if ((pl.sessionStats?.goldCollected || 0) >= 10)      awards.push({ icon: "✨", label: "Golden Touch!" });
      if ((pl.sessionStats?.saboteurSent || 0) >= 3)        awards.push({ icon: "👻", label: "Saboteur!" });
      if (rank === rankings.length && rankings.length > 1)  awards.push({ icon: "🐌", label: "Last Survivor" });
      return {
        id:           sid,
        username:     pl.username,
        finalScore:   pl.score || 0,
        finalRank:    rank,
        totalPlayers: rankings.length,
        stats:        { ...(pl.sessionStats || emptyStats()) },
        awards,
        mode:         room.settings.mode,
        teamMode:     room.settings.teamMode,
        team:         pl.team,
      };
    }).filter(Boolean),
    seasonalEvent: getCurrentSeasonalEvent(),
  };

  // ── Emit matchFinished ──
  io.to(room.id).emit("matchFinished", {
    winner:   room.matchResultSnapshot.winner,
    rankings: room.matchResultSnapshot.rankings,
    reason:   room.matchResultSnapshot.reason,
  });

  saveMatchHistory(room, winner);

  // ── Schedule timers (store refs for cancellation) ──
  room.matchSummaryTimer  = setTimeout(() => broadcastMatchSummary(room), 1000);
  room.returnToLobbyTimer = setTimeout(() => returnToLobby(room), 10000);

  console.log(`[Match] Room ${room.id} finished. Winner: ${winner?.username || "none"}`);
}

// ════════════════════════════════════════════════════════════════════════════
//  MATCH SUMMARY BROADCAST
// ════════════════════════════════════════════════════════════════════════════
function broadcastMatchSummary(room) {
  if (!room) return;

  // Read from immutable snapshot to avoid stale data after returnToLobby resets scores
  const snapshot = room.matchResultSnapshot;
  if (!snapshot) {
    // Fallback for requestMatchSummary on solo players with no snapshot
    return;
  }

  snapshot.playerSummaries.forEach(summary => {
    io.to(summary.id).emit("matchSummaryData", {
      username:     summary.username,
      finalScore:   summary.finalScore,
      finalRank:    summary.finalRank,
      totalPlayers: summary.totalPlayers,
      stats:        summary.stats,
      awards:       summary.awards,
      mode:         summary.mode,
      seasonalEvent: snapshot.seasonalEvent,
      teamMode:     summary.teamMode,
      team:         summary.team,
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  ROOM LIFECYCLE HELPERS
// ════════════════════════════════════════════════════════════════════════════
function leaveRoom(socket, room) { leaveRoomById(socket.id, room); }

function leaveRoomById(socketId, room) {
  if (!room) return;
  const p = players.get(socketId);

  // Cleanup orphan session tokens for this socket before removing player data
  sessionTokens.forEach((stored, token) => {
    if (stored.socketId === socketId) sessionTokens.delete(token);
  });

  room.players = room.players.filter(sid => sid !== socketId);

  if (p) {
    io.to(room.id).emit("playerLeft", { id: socketId, username: p.username, count: room.players.length });
    p.roomId  = null;
    p.isReady = false;
  }
  players.delete(socketId);

  if (room.players.length === 0) {
    // Cancel any active match timers before ghosting the room
    clearTimeout(room.matchSummaryTimer);
    clearTimeout(room.returnToLobbyTimer);
    room.matchSummaryTimer  = null;
    room.returnToLobbyTimer = null;

    // FIX: Hanya set ghost timer sekali
    if (!roomGhostTimers.has(room.id)) {
      const gt = setTimeout(() => {
        cleanupRoom(room.id);
        roomGhostTimers.delete(room.id);
      }, ROOM_GHOST_TTL_MS);
      roomGhostTimers.set(room.id, gt);
    }
    return;
  }

  if (room.hostId === socketId) migrateHost(room);
  broadcastLobby(room);
  broadcastLeaderboard(room);
}

function returnToLobby(room) {
  if (!room) return;
  // Prevent double-execution if host clicks "Return to Lobby" before auto-timer fires
  clearTimeout(room.returnToLobbyTimer);
  room.returnToLobbyTimer = null;
  room.state = LOBBY_STATE.WAITING;
  room.startedAt = null;
  room.players.forEach(sid => {
    const pl = players.get(sid);
    if (pl) { pl.isReady = false; pl.status = "lobby"; pl.score = 0; pl.sessionStats = emptyStats(); pl.diedAt = null; }
  });
  const host = players.get(room.hostId);
  if (host) host.isReady = true;
  io.to(room.id).emit("returnedToLobby", { roomId: room.id });
  broadcastLobby(room);
  console.log(`[Room] ${room.id} kembali ke lobby`);
}

// ════════════════════════════════════════════════════════════════════════════
//  START SERVER
// ════════════════════════════════════════════════════════════════════════════
if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    const event = getCurrentSeasonalEvent();
    console.log(`\n🐍 Snake Arcade v9.0 — Bug Fix Edition`);
    console.log(`   ➜ Local  : http://localhost:${PORT}`);
    console.log(`   ➜ LAN    : ${SERVER_LAN_URL}`);
    
    // Tampilkan interface fisik yang tersedia (virtual sudah difilter)
    if (ALL_LAN_IPS.length > 1) {
      console.log(`\n   📡 NETWORK TERSEDIA (virtual/VirtualBox difilter):`);
      ALL_LAN_IPS.forEach((item, idx) => {
        const tag = idx === 0 ? " ← PRIMARY (gunakan ini)" : "";
        console.log(`      [${idx + 1}] http://${item.ip}:${PORT} (${item.interface})${tag}`);
      });
    } else if (ALL_LAN_IPS.length === 1) {
      console.log(`   📡 Network: ${ALL_LAN_IPS[0].interface} (${ALL_LAN_IPS[0].ip})`);
    } else {
      console.log(`   ⚠️  Tidak ada network LAN fisik terdeteksi. Gunakan localhost.`);
    }
    
    console.log(`\n   ➜ DB     : ${db ? "SQLite Active (Match History enabled)" : "RAM Mode"}`);
    console.log(`   ➜ Event  : ${event.name} (x${event.multiplier})`);
    console.log(`   ➜ API    : /api/rooms | /api/leaderboard | /api/player/:id | /health`);
    console.log();
    
    if (qrcode && !IS_CLOUD) {
      if (ALL_LAN_IPS.length > 0) {
        console.log("📲 QR Code LAN (Primary — scan dari HP):");
        qrcode.generate(SERVER_LAN_URL, { small: true });

        // Tampilkan QR code tambahan hanya jika ada interface fisik lain
        if (ALL_LAN_IPS.length > 1) {
          console.log("\n📲 QR Code Tambahan (interface fisik lain):");
          for (let i = 1; i < ALL_LAN_IPS.length; i++) {
            const altUrl = `http://${ALL_LAN_IPS[i].ip}:${PORT}`;
            console.log(`\n   [${i + 1}] ${ALL_LAN_IPS[i].interface}:`);
            qrcode.generate(altUrl, { small: true });
          }
        }
      } else {
        console.log("ℹ️  QR Code tidak ditampilkan (tidak ada network LAN fisik).");
      }
    }
  });
}

module.exports = { app, server, io };