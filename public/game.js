// ============================================================================
// game.js — Snake Arcade v8.0 Client · FULL UPGRADE — Bug Fix & Feature Upgrade
// Grafika Komputer · PjBL · D3 Teknik Informatika POLNEP
//
// ★ BUG FIXES v7.0 (dipertahankan):
//  ✦ FIX: overlayBestDisplay null-check (crash saat elemen tidak ada)
//  ✦ FIX: hexAlpha error pada warna non-hex (misal custom color)
//  ✦ FIX: inputQueue direction reversal (ular bisa balik arah 180°)
//  ✦ FIX: Pause saat level transition tidak berfungsi
//  ✦ FIX: startBtn addEventListener ganda (startGame dipanggil 2x)
//  ✦ FIX: BGM tidak berhenti saat exitToMainMenu
//  ✦ FIX: Lives display salah saat mode=hard (show 1 heart not 3)
//  ✦ FIX: Poop expire tidak cleanup dengan benar
//  ✦ FIX: Socket.off tidak dipanggil sebelum rebind (listener duplikat)
//  ✦ FIX: quickJoin fallback crash jika socket undefined
//  ✦ FIX: Lobby button wired ganda (ready btn click 2x setelah lobby re-show)
//  ✦ FIX: ESC key pause+konfirmasi race condition
//  ✦ FIX: Multi-tab join tidak reset activeMultiTab
//  ✦ FIX: Color picker custom color tidak update swatch preview
//  ✦ FIX: updateBestUI crash jika overlayBestDisplay tidak ada
//  ✦ FIX: Score display tidak reset saat restartGame
//  ✦ FIX: handleDeath tidak memanggil emitToServer saat mati
//  ✦ FIX: ghostBtn tidak disembunyikan saat game over
//  ✦ FIX: lobbyCountdown tidak reset numEl saat show ulang
//
// ★ UPGRADES v7.0 (dipertahankan):
//  ✦ NEW: Reconnect Token flow otomatis dengan overlay UI
//  ✦ NEW: Power-up bar injected otomatis & stabil
//  ✦ NEW: Quick Chat extended & whitelist sinkron dengan server
//  ✦ NEW: Match Summary single player dengan stats penuh
//  ✦ NEW: Latency indicator di header game (in-game ping)
//  ✦ NEW: Profile panel XP bar animasi smooth
//  ✦ NEW: Announcement system dari server ditampilkan via notify
//  ✦ NEW: Vote kick UI feedback di lobby chat
//  ✦ NEW: Game Over screen: tombol MAIN LAGI & MENU UTAMA jelas
//
// ★ BUG FIXES v8.0 (baru):
//  ✦ FIX: quickJoinBtn (#quickJoinBtn) tidak di-wire ke triggerQuickJoin()
//  ✦ FIX: Room browser auto-refresh belum diimplementasikan (hanya di changelog)
//  ✦ FIX: toggleMuteInGame() & triggerManualExitConfirmation() tidak ada (dipanggil dari HTML)
//  ✦ FIX: matchStarting dari server tidak ditangani (hanya matchCountdown/countdown)
//  ✦ FIX: lobbyReadyHintText vs lobbyReadyHint — ID tidak konsisten
//  ✦ FIX: sendPoop (saboteur) tidak ada event handler di socket
//  ✦ FIX: exitToMainMenu tidak stop render loop sebelum transisi state
//  ✦ FIX: initLobbyButtons() tidak wire quickJoinBtn dari HTML
//
// ★ UPGRADES v8.0 (baru):
//  ✦ NEW: Room browser auto-refresh setiap 10 detik saat panel terbuka
//  ✦ NEW: toggleMuteInGame() & triggerManualExitConfirmation() global helpers
//  ✦ NEW: matchStarting handler dengan countdown animasi dari server
//  ✦ NEW: Saboteur (sendPoop) emit button wiring dari in-game UI
//  ✦ NEW: Ghost button visibilitas saat mode spectator multi
//  ✦ NEW: Konsistensi ID lobbyReadyHint & lobbyReadyHintText
// ============================================================================

"use strict";

// ════════════════════════════════════════════════════════════════════════════
//  0. FSM STATE DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════
const STATE = {
  INIT:             "STATE_INIT",
  START_SCREEN:     "STATE_START_SCREEN",
  PLAYING:          "STATE_PLAYING",
  PAUSED:           "STATE_PAUSED",
  LEVEL_TRANSITION: "STATE_LEVEL_TRANSITION",
  GAME_OVER:        "STATE_GAME_OVER",
};

let currentState = STATE.INIT;

function transitionTo(newState) {
  console.log(`[FSM] ${currentState} → ${newState}`);
  currentState = newState;
}

// ════════════════════════════════════════════════════════════════════════════
//  1. CANVAS & GRID
// ════════════════════════════════════════════════════════════════════════════
const canvas = document.getElementById("game");
const ctx    = canvas.getContext("2d");

const CELL = 20;
const COLS = 25;
const ROWS = 25;

// ════════════════════════════════════════════════════════════════════════════
//  2. LEVEL CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════
const LEVELS = [
  { name: "LEVEL 1", num: 1, scoreLimit:  25, speed: 220, wrap: true,  poop: false, cssClass: "lvl-1" },
  { name: "LEVEL 2", num: 2, scoreLimit:  50, speed: 175, wrap: true,  poop: true,  cssClass: "lvl-2" },
  { name: "LEVEL 3", num: 3, scoreLimit:  75, speed: 130, wrap: true,  poop: true,  cssClass: "lvl-3" },
  { name: "LEVEL 4", num: 4, scoreLimit: 100, speed:  90, wrap: false, poop: true,  cssClass: "lvl-4" },
  { name: "LEVEL 5", num: 5, scoreLimit: Infinity, speed: 50, wrap: false, poop: true, cssClass: "lvl-5" },
];

const POOP_LIFETIME_MS = 60000;

// ════════════════════════════════════════════════════════════════════════════
//  3. DOM REFERENCES
// ════════════════════════════════════════════════════════════════════════════
const startOverlay     = document.getElementById("startOverlay");
const usernameInput    = document.getElementById("usernameInput");
const usernameError    = document.getElementById("usernameError");
const startBtn         = document.getElementById("startBtn");
const modeBtns         = document.querySelectorAll(".mode-btn");
const modeInfo         = document.getElementById("modeInfo");
const overlayBestDisp  = document.getElementById("overlayBestDisplay");

const stepMode         = document.getElementById("step-mode");
const stepSetup        = document.getElementById("step-setup");
const stepMulti        = document.getElementById("step-multi");
const btnNext1         = document.getElementById("btnNext1");
const btnBack1         = document.getElementById("btnBack1");
const mainModeBtns     = document.querySelectorAll(".main-mode-btn");

const playerNameTag    = document.getElementById("playerNameTag");
const livesDisplay     = document.getElementById("livesDisplay");
const scoreDisplay     = document.getElementById("scoreDisplay");
const levelDisplay     = document.getElementById("levelDisplay");
const speedDisplay     = document.getElementById("speedDisplay");
const bestDisplay      = document.getElementById("bestDisplay");
const modeTag          = document.getElementById("modeTag");

const levelPanel       = document.getElementById("levelPanel");
const levelText        = document.getElementById("levelText");
const scoreText        = document.getElementById("scoreText");
const levelStars       = document.getElementById("levelStars");
const nextLevelBtn     = document.getElementById("nextLevelBtn");
const lpBadge          = document.getElementById("lpBadge");

const notifBar         = document.getElementById("notifBar");
const notifText        = document.getElementById("notifText");
const pauseIndicator   = document.getElementById("pauseIndicator");
const leaderboardPanel = document.getElementById("leaderboardPanel");
const lbList           = document.getElementById("lbList");
const lbStatus         = document.getElementById("lbStatus");

const comboDisplay     = document.getElementById("comboDisplay");

// ════════════════════════════════════════════════════════════════════════════
//  4. AUDIO PIPELINE v5.0 — BGM + SFX + Volume Control
// ════════════════════════════════════════════════════════════════════════════
let audioCtx        = null;
let bgmPlaying      = false;
let bgmNodes        = null;
let globalMuted     = false;
let bgmVolume       = 0.60;
let sfxVolume       = 0.80;
let bgmGainNode     = null;

function initAudioContext() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { console.warn("[Audio] Web Audio API tidak tersedia."); }
}

const BGM_NOTES = [
  523, 523, 659, 784, 880, 784, 659, 523,
  392, 440, 523, 587, 659, 587, 523, 440,
  349, 392, 440, 523, 587, 523, 440, 392,
  330, 349, 392, 440, 523, 440, 392, 349,
];

const BGM_NOTE_DURATION = 0.13;
let bgmScheduleTimer    = null;
let bgmNoteIndex        = 0;
let bgmStartTime        = 0;

function startBGM() {
  if (!audioCtx || bgmPlaying || globalMuted) return;
  bgmPlaying   = true;
  bgmNoteIndex = 0;
  bgmGainNode = audioCtx.createGain();
  bgmGainNode.gain.value = bgmVolume * 0.18;
  bgmGainNode.connect(audioCtx.destination);
  bgmStartTime = audioCtx.currentTime;
  scheduleBGMNotes();
}

function scheduleBGMNotes() {
  if (!bgmPlaying || !audioCtx || !bgmGainNode) return;
  const LOOK_AHEAD = 0.3;
  const SCHEDULE_INTERVAL = 80;
  const scheduleUpTo = audioCtx.currentTime + LOOK_AHEAD;
  while (bgmStartTime < scheduleUpTo) {
    const freq = BGM_NOTES[bgmNoteIndex % BGM_NOTES.length];
    bgmNoteIndex++;
    if (freq > 0) {
      const osc  = audioCtx.createOscillator();
      const envG = audioCtx.createGain();
      osc.type = bgmNoteIndex % 4 === 0 ? "triangle" : "square";
      osc.frequency.value = freq;
      envG.gain.setValueAtTime(0, bgmStartTime);
      envG.gain.linearRampToValueAtTime(1, bgmStartTime + 0.01);
      envG.gain.setValueAtTime(0.7, bgmStartTime + 0.04);
      envG.gain.exponentialRampToValueAtTime(0.001, bgmStartTime + BGM_NOTE_DURATION * 0.85);
      osc.connect(envG);
      envG.connect(bgmGainNode);
      osc.start(bgmStartTime);
      osc.stop(bgmStartTime + BGM_NOTE_DURATION);
    }
    bgmStartTime += BGM_NOTE_DURATION;
  }
  bgmScheduleTimer = setTimeout(scheduleBGMNotes, SCHEDULE_INTERVAL);
}

function stopBGM() {
  bgmPlaying = false;
  clearTimeout(bgmScheduleTimer);
  if (bgmGainNode) {
    try { bgmGainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1); } catch(e) {}
    bgmGainNode = null;
  }
}

function pauseBGM() {
  if (!bgmPlaying) return;
  clearTimeout(bgmScheduleTimer);
  if (bgmGainNode) {
    try { bgmGainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.05); } catch(e) {}
  }
}

function resumeBGM() {
  if (!bgmPlaying || !bgmGainNode || globalMuted) return;
  try { bgmGainNode.gain.linearRampToValueAtTime(bgmVolume * 0.18, audioCtx.currentTime + 0.05); } catch(e) {}
  scheduleBGMNotes();
}

function playSynth(type) {
  if (!audioCtx || globalMuted) return;
  const vol = sfxVolume;
  try {
    switch (type) {
      case "eat": {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "square";
        o.frequency.setValueAtTime(440, audioCtx.currentTime);
        o.frequency.linearRampToValueAtTime(660, audioCtx.currentTime + 0.06);
        g.gain.setValueAtTime(vol * 0.25, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + 0.12);
        break;
      }
      case "bonus": {
        [523, 659, 784, 1046].forEach((freq, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = "triangle";
          o.frequency.value = freq;
          const t = audioCtx.currentTime + i * 0.06;
          g.gain.setValueAtTime(vol * 0.3, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(t); o.stop(t + 0.1);
        });
        break;
      }
      case "penalty": {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(220, audioCtx.currentTime);
        o.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + 0.25);
        g.gain.setValueAtTime(vol * 0.35, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + 0.3);
        break;
      }
      case "levelup": {
        [523, 659, 784, 1047].forEach((freq, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = "square";
          o.frequency.value = freq;
          const t = audioCtx.currentTime + i * 0.1;
          g.gain.setValueAtTime(vol * 0.22, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(t); o.stop(t + 0.15);
        });
        break;
      }
      case "combo": {
        [880, 1320, 1760].forEach((freq, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = "sine";
          o.frequency.value = freq;
          const t = audioCtx.currentTime + i * 0.05;
          g.gain.setValueAtTime(vol * 0.2, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(t); o.stop(t + 0.18);
        });
        break;
      }
      case "gameover": {
        [392, 330, 262, 196].forEach((freq, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = "triangle";
          o.frequency.value = freq;
          const t = audioCtx.currentTime + i * 0.18;
          g.gain.setValueAtTime(vol * 0.3, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(t); o.stop(t + 0.25);
        });
        break;
      }
      case "powerup": {
        [392, 523, 659, 784, 1047].forEach((freq, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = "triangle";
          o.frequency.value = freq;
          const t = audioCtx.currentTime + i * 0.07;
          g.gain.setValueAtTime(vol * 0.28, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(t); o.stop(t + 0.12);
        });
        break;
      }
      case "achievement": {
        [523, 659, 784, 1047, 1319].forEach((freq, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = "sine";
          o.frequency.value = freq;
          const t = audioCtx.currentTime + i * 0.09;
          g.gain.setValueAtTime(vol * 0.3, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(t); o.stop(t + 0.18);
        });
        break;
      }
      case "levelaccount": {
        [261, 329, 392, 523, 659, 784, 1047].forEach((freq, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = i % 2 === 0 ? "square" : "triangle";
          o.frequency.value = freq;
          const t = audioCtx.currentTime + i * 0.08;
          g.gain.setValueAtTime(vol * 0.25, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(t); o.stop(t + 0.2);
        });
        break;
      }
      case "shield": {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(880, audioCtx.currentTime);
        o.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.2);
        g.gain.setValueAtTime(vol * 0.4, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + 0.25);
        break;
      }
    }
  } catch (e) {}
}

function triggerAudio(sfxName) {
  if (globalMuted) return;
  const valid = ["eat","bonus","penalty","levelup","combo","gameover","powerup","achievement","levelaccount","shield"];
  if (valid.includes(sfxName)) playSynth(sfxName);
}

function toggleGlobalMute() {
  globalMuted = !globalMuted;
  const btn = document.getElementById("btnMute");
  if (btn) btn.textContent = globalMuted ? "🔇" : "🔊";
  if (globalMuted) { pauseBGM(); } else { if (currentState === STATE.PLAYING) resumeBGM(); }
  saveUserPrefs();
}

// ★ v8.0 FIX: Global helpers dipanggil dari HTML onclick attribute
// Diperlukan karena index.html memanggil: onclick="toggleMuteInGame()"
function toggleMuteInGame() {
  toggleGlobalMute();
}

// Diperlukan karena index.html memanggil: onclick="triggerManualExitConfirmation()"
function triggerManualExitConfirmation() {
  if (currentState !== STATE.PLAYING && currentState !== STATE.PAUSED) return;
  // Pause dulu untuk membekukan game sebelum dialog muncul
  if (currentState === STATE.PLAYING) togglePause();
  setTimeout(() => {
    if (confirm("Keluar dari sesi permainan aktif dan kembali ke menu utama?")) {
      exitToMainMenu();
    } else if (currentState === STATE.PAUSED) {
      togglePause(); // lanjut lagi jika batal
    }
  }, 50);
}

function applyBGMVolume(v) {
  bgmVolume = v;
  if (bgmGainNode && audioCtx) {
    try { bgmGainNode.gain.value = bgmVolume * 0.18; } catch(e) {}
  }
}

function applySFXVolume(v) { sfxVolume = v; }

// ════════════════════════════════════════════════════════════════════════════
//  5. SNAKE COLOR SYSTEM
// ════════════════════════════════════════════════════════════════════════════
let snakeColor     = "#00f5c4";
let snakeColorName = "Cyan Neon";

function applySnakeColor(hex, name) {
  snakeColor     = hex;
  snakeColorName = name || hex;
  document.documentElement.style.setProperty("--snake-color", hex);
  // Safe hex parse — guard terhadap warna non-hex
  let r = 0, g = 245, b = 196;
  if (hex && hex.startsWith("#") && hex.length >= 7) {
    r = parseInt(hex.slice(1,3),16) || 0;
    g = parseInt(hex.slice(3,5),16) || 0;
    b = parseInt(hex.slice(5,7),16) || 0;
  }
  canvas.style.borderColor  = hex;
  canvas.style.boxShadow    = `0 0 30px rgba(${r},${g},${b},0.35), inset 0 0 20px rgba(0,0,0,0.3)`;
  if (playerNameTag) {
    playerNameTag.style.color      = hex;
    playerNameTag.style.textShadow = `0 0 8px ${hex}`;
  }
  saveUserPrefs();
}

function initColorPickers() {
  function wireGrid(gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.querySelectorAll(".color-swatch").forEach(swatch => {
      swatch.addEventListener("click", () => {
        const color = swatch.dataset.color;
        const name  = swatch.dataset.name || color;
        if (color === "custom") {
          const picker = document.getElementById("customColorInput");
          if (picker) {
            picker.click();
            picker.oninput = () => {
              applySnakeColor(picker.value, "Custom");
              swatch.style.setProperty("--sw", picker.value);
              updateGridActive(grid, swatch);
              const disp = document.getElementById("colorNameDisplay");
              if (disp) disp.textContent = "Custom: " + picker.value.toUpperCase();
            };
          }
          return;
        }
        applySnakeColor(color, name);
        updateGridActive(grid, swatch);
        const disp = document.getElementById("colorNameDisplay");
        if (disp) disp.textContent = name;
        syncAllGrids(color);
      });
    });
  }

  function updateGridActive(grid, activeSwatch) {
    grid.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
    activeSwatch.classList.add("active");
  }

  function syncAllGrids(color) {
    ["colorGrid", "colorGridMulti", "colorGridJoin"].forEach(gId => {
      const g = document.getElementById(gId);
      if (!g) return;
      g.querySelectorAll(".color-swatch").forEach(s => s.classList.toggle("active", s.dataset.color === color));
    });
  }

  wireGrid("colorGrid");
  wireGrid("colorGridMulti");
  wireGrid("colorGridJoin");
}

// ════════════════════════════════════════════════════════════════════════════
//  6. PERSISTENT IDENTITY & PREFERENCES
// ════════════════════════════════════════════════════════════════════════════
let currentUsername  = "";
let bestScore        = 0;
let selectedMode     = "easy";
let selectedMainMode = "single";
let activeMultiTab   = "host";

// ── Session Token Storage (Fase 1: Reconnect System) ──────────────────────
let _sessionToken    = null;   // Token aktif dari server
let _sessionRoomId   = null;   // Room ID yang terkait dengan token
let _reconnectAttempted = false;

function saveSessionTokenLocal(token, roomId) {
  _sessionToken  = token;
  _sessionRoomId = roomId;
  try {
    localStorage.setItem("snake_arcade_session", JSON.stringify({ token, roomId, ts: Date.now() }));
  } catch(e) {}
}

function loadSessionTokenLocal() {
  try {
    const raw = localStorage.getItem("snake_arcade_session");
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Buang token yang sudah > 35 detik (server TTL 30 dtk + 5 dtk buffer)
    if (Date.now() - data.ts > 35000) {
      localStorage.removeItem("snake_arcade_session");
      return null;
    }
    return data;
  } catch(e) { return null; }
}

function clearSessionToken() {
  _sessionToken  = null;
  _sessionRoomId = null;
  _reconnectAttempted = false;
  try { localStorage.removeItem("snake_arcade_session"); } catch(e) {}
}

function loadUserData() {
  try {
    const raw = localStorage.getItem("snake_arcade_user");
    if (raw) {
      const data       = JSON.parse(raw);
      currentUsername  = data.username       || "";
      bestScore        = data.savedBestScore || 0;
      snakeColor       = data.snakeColor     || "#00f5c4";
      snakeColorName   = data.snakeColorName || "Cyan Neon";
      bgmVolume        = data.bgmVolume      ?? 0.60;
      sfxVolume        = data.sfxVolume      ?? 0.80;
      globalMuted      = data.globalMuted    ?? false;
    }
  } catch (e) { bestScore = 0; }
}

function saveUserData() {
  try {
    localStorage.setItem("snake_arcade_user", JSON.stringify({
      username:       currentUsername.substring(0, 12),
      savedBestScore: bestScore,
      snakeColor,
      snakeColorName,
      bgmVolume,
      sfxVolume,
      globalMuted,
    }));
  } catch (e) {}
}

function saveUserPrefs() { saveUserData(); }

// ════════════════════════════════════════════════════════════════════════════
//  6B. ★ PERMANENT STATISTICS SYSTEM
// ════════════════════════════════════════════════════════════════════════════
const DEFAULT_STATS = {
  totalGames:        0,
  totalScore:        0,
  totalDeaths:       0,
  highestCombo:      0,
  applesEaten:       0,
  bananasCollected:  0,
  goldCollected:     0,
  poopHits:          0,
  multiWins:         0,
  totalPlayTimeSec:  0,
  maxLevel:          1,
  powerUpsUsed:      0,
};

let playerStats = { ...DEFAULT_STATS };

function loadStats() {
  try {
    const raw = localStorage.getItem("snake_arcade_stats");
    if (raw) playerStats = { ...DEFAULT_STATS, ...JSON.parse(raw) };
  } catch (e) { playerStats = { ...DEFAULT_STATS }; }
}

function saveStats() {
  try {
    localStorage.setItem("snake_arcade_stats", JSON.stringify(playerStats));
  } catch (e) {}
}

// ════════════════════════════════════════════════════════════════════════════
//  6C. ★ XP & ACCOUNT LEVEL SYSTEM
// ════════════════════════════════════════════════════════════════════════════
let accountXP        = 0;
let accountLevel     = 1;
const XP_PER_LEVEL   = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000];
// Reward title per level akun
const LEVEL_TITLES   = [
  "", "Newbie", "Explorer", "Serpent", "Hunter",
  "Striker", "Predator", "Viper", "Cobra", "Anaconda", "Legendary"
];

function loadXP() {
  try {
    const raw = localStorage.getItem("snake_arcade_xp");
    if (raw) {
      const d = JSON.parse(raw);
      accountXP    = d.xp    || 0;
      accountLevel = d.level || 1;
    }
  } catch (e) {}
}

function saveXP() {
  try {
    localStorage.setItem("snake_arcade_xp", JSON.stringify({ xp: accountXP, level: accountLevel }));
  } catch (e) {}
}

function getXPForNextLevel() {
  const idx = Math.min(accountLevel, XP_PER_LEVEL.length - 1);
  return XP_PER_LEVEL[idx];
}

function getXPProgress() {
  const needed = getXPForNextLevel();
  return needed > 0 ? Math.min(accountXP / needed, 1) : 1;
}

function awardXP(amount) {
  accountXP += amount;
  const needed = getXPForNextLevel();
  if (accountLevel < XP_PER_LEVEL.length && accountXP >= needed) {
    accountXP -= needed;
    accountLevel++;
    const title = LEVEL_TITLES[Math.min(accountLevel, LEVEL_TITLES.length - 1)];
    triggerAudio("levelaccount");
    notify(`🎖 LEVEL NAIK! Kamu kini Level ${accountLevel} — ${title}!`, "gold", 4000);
    showFloatingText(canvas.width / 2, canvas.height / 2, `LEVEL ${accountLevel}!`, "#ffd700", 2.0);
    checkAllAchievements();
    updateProfilePanel();
  }
  saveXP();
  updateXPBar();
}

function calcSessionXP() {
  let xp = 0;
  xp += score * 2;                                          // 2 XP per skor
  xp += levelIndex * 20;                                    // 20 XP per level dicapai
  xp += playerStats.highestCombo * 5;                      // 5 XP per combo tertinggi session ini
  if (selectedMode === "medium") xp = Math.floor(xp * 1.3);
  if (selectedMode === "hard")   xp = Math.floor(xp * 1.7);
  return xp;
}

function updateXPBar() {
  const bar   = document.getElementById("xpBar");
  const label = document.getElementById("xpLabel");
  const lvlEl = document.getElementById("xpLevelText");
  if (!bar) return;
  const pct = getXPProgress() * 100;
  bar.style.width = pct + "%";
  if (label) label.textContent = `${accountXP} / ${getXPForNextLevel()} XP`;
  if (lvlEl) {
    const title = LEVEL_TITLES[Math.min(accountLevel, LEVEL_TITLES.length - 1)];
    lvlEl.textContent = `Lv.${accountLevel} ${title}`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  6D. ★ ACHIEVEMENT SYSTEM
// ════════════════════════════════════════════════════════════════════════════
const ACHIEVEMENTS_DEF = [
  // id, name, desc, icon, condition(stats, session)
  { id: "first_bite",     name: "First Bite",      desc: "Makan apel pertama",           icon: "🍎", check: (s) => s.applesEaten >= 1 },
  { id: "combo_starter",  name: "Combo Starter",   desc: "Capai Combo x3",               icon: "🔥", check: (s) => s.highestCombo >= 3 },
  { id: "combo_master",   name: "Combo Master",    desc: "Capai Combo x10",              icon: "💥", check: (s) => s.highestCombo >= 10 },
  { id: "banana_fan",     name: "Banana Fan",      desc: "Kumpulkan 5 pisang",           icon: "🍌", check: (s) => s.bananasCollected >= 5 },
  { id: "golden_touch",   name: "Golden Touch",    desc: "Kumpulkan 20 buah emas",       icon: "✨", check: (s) => s.goldCollected >= 20 },
  { id: "poop_survivor",  name: "Poop Survivor",   desc: "Terkena kotoran 5x",           icon: "💩", check: (s) => s.poopHits >= 5 },
  { id: "veteran",        name: "Veteran",         desc: "Mainkan 10 game",              icon: "🎖", check: (s) => s.totalGames >= 10 },
  { id: "centurion",      name: "Centurion",       desc: "Mainkan 100 game",             icon: "🏛", check: (s) => s.totalGames >= 100 },
  { id: "scorer_100",     name: "Skor 100",        desc: "Raih total skor 100",          icon: "💯", check: (s) => s.totalScore >= 100 },
  { id: "scorer_1000",    name: "High Roller",     desc: "Raih total skor 1000",         icon: "💎", check: (s) => s.totalScore >= 1000 },
  { id: "death_wish",     name: "Death Wish",      desc: "Mati 20 kali",                 icon: "💀", check: (s) => s.totalDeaths >= 20 },
  { id: "survivor",       name: "Survivor",        desc: "Main selama 5 menit total",    icon: "⏱",  check: (s) => s.totalPlayTimeSec >= 300 },
  { id: "marathon",       name: "Marathon",        desc: "Main selama 30 menit total",   icon: "🏃", check: (s) => s.totalPlayTimeSec >= 1800 },
  { id: "level5_reach",   name: "Max Level",       desc: "Capai Level 5 game",           icon: "⭐", check: (s) => s.maxLevel >= 5 },
  { id: "powerup_fan",    name: "Power Addict",    desc: "Gunakan 10 power-up",          icon: "⚡", check: (s) => s.powerUpsUsed >= 10 },
  { id: "apple_100",      name: "Apple Orchard",   desc: "Makan 100 apel",               icon: "🍎", check: (s) => s.applesEaten >= 100 },
  { id: "multi_winner",   name: "Champion",        desc: "Menang multiplayer 1x",        icon: "🏆", check: (s) => s.multiWins >= 1 },
  { id: "lv_account_5",   name: "Leveled Up",      desc: "Raih Account Level 5",         icon: "🎗",  check: (s, xpLvl) => xpLvl >= 5 },
  { id: "lv_account_10",  name: "Legendary",       desc: "Raih Account Level 10",        icon: "👑", check: (s, xpLvl) => xpLvl >= 10 },
  { id: "apple_master",   name: "Apple Master",    desc: "Makan 500 apel",               icon: "🍎", check: (s) => s.applesEaten >= 500 },
];

let unlockedAchievements = {};

function loadAchievements() {
  try {
    const raw = localStorage.getItem("snake_arcade_achievements");
    if (raw) unlockedAchievements = JSON.parse(raw);
  } catch (e) { unlockedAchievements = {}; }
}

function saveAchievements() {
  try {
    localStorage.setItem("snake_arcade_achievements", JSON.stringify(unlockedAchievements));
  } catch (e) {}
}

function checkAllAchievements() {
  let newUnlock = false;
  for (const def of ACHIEVEMENTS_DEF) {
    if (unlockedAchievements[def.id]) continue;
    if (def.check(playerStats, accountLevel)) {
      unlockedAchievements[def.id] = Date.now();
      newUnlock = true;
      saveAchievements();
      showAchievementUnlock(def);
    }
  }
  if (newUnlock) updateProfilePanel();
}

function showAchievementUnlock(def) {
  triggerAudio("achievement");
  // Tampilkan notifikasi achievement khusus
  const el = document.createElement("div");
  el.className = "achievement-popup";
  el.innerHTML = `<span class="ach-icon">${def.icon}</span><div><strong>Achievement Unlocked!</strong><br>${def.name}<small>${def.desc}</small></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 500);
  }, 3500);
}

// ════════════════════════════════════════════════════════════════════════════
//  6E. ★ PLAYER PROFILE PANEL (UI injection ke startOverlay)
// ════════════════════════════════════════════════════════════════════════════
function buildProfilePanel() {
  // Jika sudah ada, skip
  if (document.getElementById("profilePanel")) return;
  const card = document.getElementById("startCard");
  if (!card) return;

  const panel = document.createElement("div");
  panel.id = "profilePanel";
  panel.className = "profile-panel";
  panel.innerHTML = `
    <div class="profile-header">
      <span class="profile-icon">👤</span>
      <div class="profile-info">
        <div id="profileName" class="profile-name">—</div>
        <div id="xpLevelText" class="xp-level-text">Lv.1 Newbie</div>
      </div>
      <button id="btnProfile" class="profile-toggle-btn" onclick="toggleProfileView()">📊 PROFIL</button>
    </div>
    <div class="xp-bar-wrap">
      <div class="xp-bar-bg"><div id="xpBar" class="xp-bar-fill" style="width:0%"></div></div>
      <span id="xpLabel" class="xp-label">0 / 100 XP</span>
    </div>
    <div id="profileContent" class="profile-content hidden">
      <div class="profile-tabs">
        <button class="ptab active" data-ptab="stats" onclick="switchProfileTab('stats')">📈 Statistik</button>
        <button class="ptab" data-ptab="achievements" onclick="switchProfileTab('achievements')">🏅 Achievement</button>
      </div>
      <div id="ptab-stats" class="ptab-content">
        <div class="stats-grid" id="statsGrid"></div>
      </div>
      <div id="ptab-achievements" class="ptab-content hidden">
        <div class="ach-grid" id="achGrid"></div>
      </div>
    </div>
  `;

  // Sisipkan sebelum step-mode
  const stepModeEl = document.getElementById("step-mode");
  card.insertBefore(panel, stepModeEl);
  updateProfilePanel();
}

function toggleProfileView() {
  const content = document.getElementById("profileContent");
  const btn     = document.getElementById("btnProfile");
  if (!content) return;
  const isHidden = content.classList.contains("hidden");
  content.classList.toggle("hidden", !isHidden);
  if (btn) btn.textContent = isHidden ? "✕ TUTUP" : "📊 PROFIL";
  if (!isHidden) return;
  updateProfilePanel();
}

function switchProfileTab(tab) {
  document.querySelectorAll(".ptab").forEach(b => b.classList.toggle("active", b.dataset.ptab === tab));
  document.querySelectorAll(".ptab-content").forEach(c => c.classList.add("hidden"));
  const el = document.getElementById("ptab-" + tab);
  if (el) el.classList.remove("hidden");
}

function updateProfilePanel() {
  const nameEl = document.getElementById("profileName");
  if (nameEl) nameEl.textContent = currentUsername || "—";
  updateXPBar();
  renderStatsGrid();
  renderAchGrid();
}

function renderStatsGrid() {
  const grid = document.getElementById("statsGrid");
  if (!grid) return;
  const rows = [
    ["🎮 Total Game",       playerStats.totalGames],
    ["📊 Total Skor",       playerStats.totalScore],
    ["🏆 Best Score",       bestScore],
    ["💀 Total Kematian",   playerStats.totalDeaths],
    ["🔥 Combo Tertinggi",  playerStats.highestCombo],
    ["🍎 Apel Dimakan",     playerStats.applesEaten],
    ["🍌 Pisang Dikumpul",  playerStats.bananasCollected],
    ["✨ Emas Dikumpul",    playerStats.goldCollected],
    ["💩 Kena Kotoran",     playerStats.poopHits],
    ["⚡ Power-Up Dipakai", playerStats.powerUpsUsed],
    ["⭐ Level Maks Game",  playerStats.maxLevel],
    ["⏱ Total Waktu",      formatTime(playerStats.totalPlayTimeSec)],
  ];
  grid.innerHTML = rows.map(([label, val]) =>
    `<div class="stat-row"><span class="stat-row-label">${label}</span><span class="stat-row-val">${val}</span></div>`
  ).join("");
}

function renderAchGrid() {
  const grid = document.getElementById("achGrid");
  if (!grid) return;
  const unlocked = ACHIEVEMENTS_DEF.filter(d => unlockedAchievements[d.id]);
  const locked   = ACHIEVEMENTS_DEF.filter(d => !unlockedAchievements[d.id]);
  const makeCard = (def, isUnlocked) => `
    <div class="ach-card ${isUnlocked ? "unlocked" : "locked"}">
      <span class="ach-card-icon">${def.icon}</span>
      <div class="ach-card-info">
        <div class="ach-card-name">${def.name}</div>
        <div class="ach-card-desc">${def.desc}</div>
      </div>
    </div>`;
  grid.innerHTML = unlocked.map(d => makeCard(d, true)).join("") + locked.map(d => makeCard(d, false)).join("");
}

function formatTime(sec) {
  if (sec < 60) return sec + "d";
  if (sec < 3600) return Math.floor(sec / 60) + "m " + (sec % 60) + "d";
  return Math.floor(sec / 3600) + "j " + Math.floor((sec % 3600) / 60) + "m";
}

// ════════════════════════════════════════════════════════════════════════════
//  7. GAME STATE VARIABLES
// ════════════════════════════════════════════════════════════════════════════
let snake         = [];
let prevSnake     = [];
let dx = CELL, dy = 0;
let items         = [];
let score         = 0;
let levelIndex    = 0;
let lives         = 3;
let pendingGrowth = 0;

// Timing (Lerp)
let lastLogicTime = 0;
let logicInterval = 220;
let lerpT         = 0;
let rafId         = null;

// Input queue (FIFO max 2)
let inputQueue    = [];

// Particles
let particles     = [];

// ★ Trail Effect — menyimpan posisi kepala snake sebelumnya
let snakeTrail    = [];
const TRAIL_MAX   = 12;   // panjang jejak

// ★ Floating Score Texts
let floatingTexts = [];

// Poop spawn timer
let poopSpawnTimer = null;

// Invulnerability
let invulnerableUntil = 0;

// Tongue animation state
let tongueOut         = false;
let tongueFlipCounter = 0;
const TONGUE_FLIP_EVERY = 3;

// Mobile Gesture Coordinates
let touchSX = 0;
let touchSY = 0;

// Combo streak
let comboStreak   = 0;
let comboTimeout  = null;
let sessionHighCombo = 0;

// ★ Session playtime tracking
let sessionStartTime = 0;

// ★ Screen Shake
let shakeIntensity = 0;
let shakeDecay     = 0.85;

// ════════════════════════════════════════════════════════════════════════════
//  7B. ★ POWER-UP SYSTEM
// ════════════════════════════════════════════════════════════════════════════
const POWERUP_TYPES = {
  shield:      { color: "#00cfff", icon: "🛡", label: "SHIELD",       duration: 8000 },
  doublescr:   { color: "#ffd700", icon: "✖2", label: "DOUBLE SCORE", duration: 7000 },
  slowmotion:  { color: "#ff8c00", icon: "🐌", label: "SLOW MOTION",  duration: 5000 },
};
// CATATAN: Magnet dihapus — menyebabkan item bergerak ke koordinat non-grid (desimal)
// sehingga collision detection strict-equality tidak pernah cocok dan item tidak bisa dimakan.

let activePowerUps = {}; // { type: { endTime } }

function isPowerUpActive(type) {
  return activePowerUps[type] && performance.now() < activePowerUps[type].endTime;
}

function activatePowerUp(type) {
  const def = POWERUP_TYPES[type];
  if (!def) return;
  activePowerUps[type] = { endTime: performance.now() + def.duration };
  triggerAudio("powerup");
  notify(`${def.icon} ${def.label} aktif selama ${def.duration/1000}dtk!`, "gold", 2000);
  playerStats.powerUpsUsed++;
  updatePowerUpUI();
  checkAllAchievements();

  // Efek khusus per tipe
  if (type === "slowmotion") {
    logicInterval = Math.min(LEVELS[levelIndex].speed * 2, 350);
  }
  if (type === "shield") {
    triggerAudio("shield");
    showFloatingText(snake[0].x + CELL/2, snake[0].y, "SHIELD!", "#00cfff");
  }
}

function tickPowerUps() {
  const now = performance.now();
  let changed = false;
  for (const type in activePowerUps) {
    if (now >= activePowerUps[type].endTime) {
      delete activePowerUps[type];
      changed = true;
      notify(`${POWERUP_TYPES[type]?.icon || "⚡"} ${POWERUP_TYPES[type]?.label || type} habis!`, "warning", 1500);
      // Kembalikan kecepatan normal jika slowmotion habis
      if (type === "slowmotion") {
        logicInterval = LEVELS[levelIndex].speed;
      }
    }
  }
  if (changed) updatePowerUpUI();
}

function trySpawnPowerUp() {
  if (Math.random() < 0.08) {
    const types = Object.keys(POWERUP_TYPES);
    const type  = types[Math.floor(Math.random() * types.length)];
    spawnItem("powerup_" + type, 8000);
  }
}

function updatePowerUpUI() {
  const container = document.getElementById("powerUpBar");
  if (!container) return;
  const now = performance.now();
  let html = "";
  for (const type in activePowerUps) {
    const def  = POWERUP_TYPES[type];
    const rem  = Math.max(0, activePowerUps[type].endTime - now);
    const pct  = rem / def.duration * 100;
    html += `<div class="pu-chip" style="border-color:${def.color}">
      <span>${def.icon}</span>
      <div class="pu-timer-bar" style="width:${pct}%;background:${def.color}"></div>
    </div>`;
  }
  container.innerHTML = html;
}

// ════════════════════════════════════════════════════════════════════════════
//  8. NOTIFICATION SYSTEM
// ════════════════════════════════════════════════════════════════════════════
let notifTimeout = null;

function notify(message, type = "success", duration = 2000) {
  notifBar.className = type;
  notifText.textContent = message;
  clearTimeout(notifTimeout);
  if (duration > 0) {
    notifTimeout = setTimeout(() => {
      notifBar.className = "";
      notifText.textContent = "";
    }, duration);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  9. ITEM GENERATION
// ════════════════════════════════════════════════════════════════════════════
function randomCell() {
  return {
    x: Math.floor(Math.random() * COLS) * CELL,
    y: Math.floor(Math.random() * ROWS) * CELL,
  };
}

function isCellOccupied(x, y) {
  if (snake.some(s => s.x === x && s.y === y)) return true;
  if (items.some(it => it.x === x && it.y === y)) return true;
  return false;
}

function spawnItem(type, duration = 0) {
  let pos, tries = 0;
  do { pos = randomCell(); tries++; } while (isCellOccupied(pos.x, pos.y) && tries < 100);
  const item = { x: pos.x, y: pos.y, type, spawnTime: performance.now(), duration };
  items.push(item);
  return item;
}

function ensureApple() {
  if (!items.some(it => it.type === "apple")) spawnItem("apple", 0);
}

function trySpawnBonus() {
  if (Math.random() < 0.30) spawnItem("gold", 6000);
  if (Math.random() < 0.10) spawnItem("banana", 4000);
  trySpawnPowerUp();
}

function schedulePoopSpawn() {
  if (!LEVELS[levelIndex].poop) return;
  clearTimeout(poopSpawnTimer);
  const delay = 3000 + Math.random() * 4000;
  poopSpawnTimer = setTimeout(() => {
    if (currentState !== STATE.PLAYING) return;
    spawnItem("poop", POOP_LIFETIME_MS);
    schedulePoopSpawn();
  }, delay);
}

function expireItems() {
  const now = performance.now();
  items = items.filter(it => {
    if (it.duration > 0 && now - it.spawnTime > it.duration) {
      if (it.type === "poop") createBurst(it.x, it.y, "#795548", 4);
      return false;
    }
    return true;
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  10. LERP RENDER PIPELINE
// ════════════════════════════════════════════════════════════════════════════
function lerpCoord(prev, now, t) {
  if (Math.abs(now - prev) > CELL) return now;
  return prev + (now - prev) * t;
}

// ════════════════════════════════════════════════════════════════════════════
//  11. DRAW FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════
function drawGrid() {
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let gx = 0; gx < COLS; gx++)
    for (let gy = 0; gy < ROWS; gy++)
      ctx.fillRect(gx * CELL + 9, gy * CELL + 9, 2, 2);
}

// ★ TRAIL EFFECT
function drawTrail() {
  const len = snakeTrail.length;
  // Safe hex parse — guard terhadap warna non-hex atau panjang tidak valid
  let tr = 0, tg = 200, tb = 196;
  if (snakeColor && snakeColor.startsWith("#") && snakeColor.length >= 7) {
    tr = parseInt(snakeColor.slice(1, 3), 16) || 0;
    tg = parseInt(snakeColor.slice(3, 5), 16) || 0;
    tb = parseInt(snakeColor.slice(5, 7), 16) || 0;
  }
  for (let i = 0; i < len; i++) {
    const t = snakeTrail[i];
    const ageFactor = i / len;           // 0 = oldest, 1 = newest
    const alpha     = ageFactor * 0.35;  // max 35% opacity
    const size      = (CELL - 4) * ageFactor * 0.85;

    ctx.globalAlpha = alpha;
    ctx.fillStyle   = `rgba(${tr},${tg},${tb},1)`;
    ctx.beginPath();
    const cx = t.x + CELL / 2;
    const cy = t.y + CELL / 2;
    if (ctx.roundRect) {
      ctx.roundRect(cx - size / 2, cy - size / 2, size, size, 3);
    } else {
      ctx.rect(cx - size / 2, cy - size / 2, size, size);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSnake(t) {
  const col  = snakeColor;
  const len  = snake.length;
  const pLen = prevSnake.length;

  for (let i = len - 1; i >= 0; i--) {
    const part  = snake[i];
    const pPart = pLen > i ? prevSnake[i] : part;

    let diffX = part.x - pPart.x;
    let diffY = part.y - pPart.y;
    let rx, ry;

    if (diffX < -CELL) {
      rx = pPart.x + ((part.x + canvas.width) - pPart.x) * t;
    } else if (diffX > CELL) {
      rx = pPart.x + ((part.x - canvas.width) - pPart.x) * t;
    } else {
      rx = pPart.x + diffX * t;
    }

    if (diffY < -CELL) {
      ry = pPart.y + ((part.y + canvas.height) - pPart.y) * t;
    } else if (diffY > CELL) {
      ry = pPart.y + ((part.y - canvas.height) - pPart.y) * t;
    } else {
      ry = pPart.y + diffY * t;
    }

    const isHead = i === 0;
    const isTail = i === len - 1;
    const brightness = isHead ? 1 : Math.max(0.35, 1 - (i / len) * 0.65);
    const pad = isHead ? 1 : 2;

    // ★ Shield visual: cincin biru berkilau di kepala
    if (isHead && isPowerUpActive("shield")) {
      const now = performance.now();
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
      ctx.save();
      ctx.strokeStyle = `rgba(0, 207, 255, ${0.6 + pulse * 0.4})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = "#00cfff";
      ctx.shadowBlur  = 12 + pulse * 8;
      ctx.beginPath();
      ctx.arc(rx + CELL / 2, ry + CELL / 2, CELL * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const renderSegmentBlock = (drawX, drawY) => {
      if (isHead) {
        let grad = ctx.createRadialGradient(drawX + CELL/2, drawY + CELL/2, 1, drawX + CELL/2, drawY + CELL/2, CELL * 0.9);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.5, hexAlpha(col, 1));
        grad.addColorStop(1, hexAlpha(col, 0.6));
        ctx.fillStyle = grad;
      } else {
        let shimmer = 0.04 * Math.sin(performance.now() * 0.003 + i * 0.5);
        let alpha = Math.min(1, brightness + shimmer);
        ctx.fillStyle = hexAlpha(col, alpha);
      }

      ctx.beginPath();
      if (ctx.roundRect) {
        if (isHead) {
          let radii = [4, 4, 4, 4];
          if (dx > 0)       radii = [3, 12, 12, 3];
          else if (dx < 0)  radii = [12, 3, 3, 12];
          else if (dy > 0)  radii = [3, 3, 12, 12];
          else if (dy < 0)  radii = [12, 12, 3, 3];
          ctx.roundRect(drawX + pad, drawY + pad, CELL - pad * 2, CELL - pad * 2, radii);
        } else {
          const radius = isTail ? 5 : 4;
          ctx.roundRect(drawX + pad, drawY + pad, CELL - pad * 2, CELL - pad * 2, radius);
        }
      } else {
        ctx.rect(drawX + pad, drawY + pad, CELL - pad * 2, CELL - pad * 2);
      }
      ctx.fill();

      if (!isHead && !isTail && i % 2 === 0 && len > 4) {
        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.beginPath();
        ctx.arc(drawX + CELL / 2, drawY + CELL / 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isHead) drawSnakeHead(drawX, drawY);
    };

    renderSegmentBlock(rx, ry);

    if (LEVELS[levelIndex].wrap) {
      if (rx > canvas.width - CELL)  renderSegmentBlock(rx - canvas.width, ry);
      if (rx < 0)                    renderSegmentBlock(rx + canvas.width, ry);
      if (ry > canvas.height - CELL) renderSegmentBlock(rx, ry - canvas.height);
      if (ry < 0)                    renderSegmentBlock(rx + canvas.height, ry);
    }
  }
}

function drawSnakeHead(rx, ry) {
  const head = snake[0];
  const neck = snake.length > 1 ? snake[1] : null;

  let dirX = neck ? (head.x - neck.x) : dx;
  let dirY = neck ? (head.y - neck.y) : dy;

  if (Math.abs(dirX) > CELL) dirX = 0;
  if (Math.abs(dirY) > CELL) dirY = 0;

  const goRight = dirX > 0, goLeft = dirX < 0, goDown = dirY > 0, goUp = dirY < 0;

  let ex1, ey1, ex2, ey2;
  if (goRight)      { ex1 = rx + 13; ey1 = ry + 6;  ex2 = rx + 13; ey2 = ry + 13; }
  else if (goLeft)  { ex1 = rx + 5;  ey1 = ry + 6;  ex2 = rx + 5;  ey2 = ry + 13; }
  else if (goDown)  { ex1 = rx + 6;  ey1 = ry + 13; ex2 = rx + 13; ey2 = ry + 13; }
  else              { ex1 = rx + 6;  ey1 = ry + 5;  ex2 = rx + 13; ey2 = ry + 5; }

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath(); ctx.arc(ex1, ey1, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(ex2, ey2, 3, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#0a0a1a";
  const px = goRight ? 1 : goLeft ? -1 : 0;
  const py = goDown  ? 1 : goUp   ? -1 : 0;
  ctx.beginPath(); ctx.arc(ex1 + px, ey1 + py, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(ex2 + px, ey2 + py, 1.5, 0, Math.PI * 2); ctx.fill();

  if (tongueOut) {
    ctx.strokeStyle = "#ff2255";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const cxH = rx + CELL / 2, cyH = ry + CELL / 2;
    const ext = 8;
    if (goRight)      { ctx.moveTo(rx + CELL, cyH); ctx.lineTo(rx + CELL + ext, cyH); }
    else if (goLeft)  { ctx.moveTo(rx, cyH); ctx.lineTo(rx - ext, cyH); }
    else if (goDown)  { ctx.moveTo(cxH, ry + CELL); ctx.lineTo(cxH, ry + CELL + ext); }
    else              { ctx.moveTo(cxH, ry); ctx.lineTo(cxH, ry - ext); }
    ctx.stroke();
  }
}

function drawItems() {
  const now = performance.now();
  const r   = CELL / 2;

  items.forEach(it => {
    const cx = it.x + r;
    const cy = it.y + r;

    // ★ Power-up rendering
    if (it.type && it.type.startsWith("powerup_")) {
      const puType = it.type.replace("powerup_", "");
      const def    = POWERUP_TYPES[puType];
      if (!def) return;
      const pulse  = 0.6 + 0.4 * Math.abs(Math.sin(now * 0.006));
      ctx.save();
      ctx.shadowColor = def.color;
      ctx.shadowBlur  = 14 * pulse;
      ctx.globalAlpha = pulse;
      // Outer ring
      ctx.strokeStyle = def.color;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
      ctx.stroke();
      // Fill
      const grad = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, r - 2);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, def.color);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
      ctx.fill();
      // Icon
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = "#0a0a1a";
      ctx.font        = `bold ${CELL * 0.55}px monospace`;
      ctx.textAlign   = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.icon, cx, cy + 1);
      ctx.restore();
      return;
    }

    switch (it.type) {
      case "apple":
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
        ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r + 3);
        ctx.bezierCurveTo(cx + r - 1, cy - r - 1, cx + r + 2, cy - 2, cx + r - 1, cy + 2);
        ctx.bezierCurveTo(cx + r - 3, cy + r - 1, cx + 3, cy + r - 1, cx, cy + r - 2);
        ctx.bezierCurveTo(cx - 3, cy + r - 1, cx - r + 3, cy + r - 1, cx - r + 1, cy + 2);
        ctx.bezierCurveTo(cx - r - 2, cy - 2, cx - r + 1, cy - r - 1, cx, cy - r + 3);
        ctx.closePath();
        let appleGrad = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, r);
        appleGrad.addColorStop(0, "#ff6b8b");
        appleGrad.addColorStop(0.4, "#e51c23");
        appleGrad.addColorStop(1, "#8e0005");
        ctx.fillStyle = appleGrad; ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = "#5d4037"; ctx.lineWidth = 1.8; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cx, cy - r + 3); ctx.quadraticCurveTo(cx + 3, cy - r - 3, cx + 4, cy - r - 5); ctx.stroke();
        ctx.fillStyle = "#4caf50"; ctx.beginPath(); ctx.moveTo(cx + 1, cy - r - 1); ctx.quadraticCurveTo(cx + 7, cy - r - 5, cx + 8, cy - r - 1); ctx.quadraticCurveTo(cx + 4, cy - r + 2, cx + 1, cy - r - 1); ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)"; ctx.beginPath(); ctx.ellipse(cx - 3, cy - 3, 2.5, 1.2, -0.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;

      case "gold":
        ctx.save();
        const alphaG = 0.55 + Math.abs(Math.sin(now * 0.005)) * 0.45;
        ctx.strokeStyle = `rgba(255, 215, 0, ${alphaG * 0.45})`; ctx.lineWidth = 1.5;
        ctx.save(); ctx.translate(cx, cy); ctx.scale(1, 0.35);
        ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        ctx.beginPath();
        ctx.moveTo(cx, cy - r + 3); ctx.bezierCurveTo(cx + r - 1, cy - r - 1, cx + r + 2, cy - 2, cx + r - 1, cy + 2);
        ctx.bezierCurveTo(cx + r - 3, cy + r - 1, cx + 3, cy + r - 1, cx, cy + r - 2);
        ctx.bezierCurveTo(cx - 3, cy + r - 1, cx - r + 3, cy + r - 1, cx - r + 1, cy + 2);
        ctx.bezierCurveTo(cx - r - 2, cy - 2, cx - r + 1, cy - r - 1, cx, cy - r + 3);
        ctx.closePath();
        let goldGrad = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, r);
        goldGrad.addColorStop(0, "#fffde7"); goldGrad.addColorStop(0.3, "#fdd835"); goldGrad.addColorStop(0.7, "#f57f17"); goldGrad.addColorStop(1, "#5d4037");
        ctx.fillStyle = goldGrad; ctx.fill();
        if (Math.floor(now / 150) % 2 === 0) { ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(cx + 4, cy - 4, 1.5, 0, Math.PI * 2); ctx.arc(cx - 5, cy + 3, 1, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        break;

      case "banana":
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.35)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
        ctx.beginPath();
        ctx.moveTo(cx - r + 4, cy - r + 4); ctx.quadraticCurveTo(cx + r + 1, cy - r + 3, cx + r - 3, cy + r - 2);
        ctx.quadraticCurveTo(cx + r - 5, cy + r, cx + r - 7, cy + r - 2);
        ctx.quadraticCurveTo(cx + r - 5, cy - r + 9, cx - r + 4, cy - r + 4); ctx.closePath();
        const alphaB = 0.65 + Math.abs(Math.sin(now * 0.007)) * 0.35;
        let bananaGrad = ctx.createLinearGradient(it.x, it.y, it.x + CELL, it.y + CELL);
        bananaGrad.addColorStop(0, `rgba(255, 241, 118, ${alphaB})`);
        bananaGrad.addColorStop(0.6, `rgba(251, 192, 45, ${alphaB})`);
        bananaGrad.addColorStop(1, `rgba(230, 81, 0, ${alphaB})`);
        ctx.fillStyle = bananaGrad; ctx.fill();
        ctx.fillStyle = "#3e2723"; ctx.beginPath(); ctx.arc(cx - r + 4, cy - r + 4, 2, 0, Math.PI * 2); ctx.arc(cx + r - 4.5, cy + r - 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;

      case "poop": {
        ctx.save();
        const age = now - it.spawnTime;
        const remaining = it.duration - age;
        let poopAlpha = 1;
        if (remaining < 10000) poopAlpha = 0.4 + 0.6 * Math.abs(Math.sin(now * 0.01));
        ctx.globalAlpha = poopAlpha;
        let gP1 = ctx.createRadialGradient(cx, cy + 5, 2, cx, cy + 5, 8);
        gP1.addColorStop(0, "#8d6e63"); gP1.addColorStop(1, "#3e2723");
        ctx.fillStyle = gP1; ctx.beginPath(); ctx.ellipse(cx, cy + 5, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
        let gP2 = ctx.createRadialGradient(cx, cy, 1, cx, cy, 6);
        gP2.addColorStop(0, "#a1887f"); gP2.addColorStop(1, "#4e342e");
        ctx.fillStyle = gP2; ctx.beginPath(); ctx.ellipse(cx, cy, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        let gP3 = ctx.createRadialGradient(cx, cy - 4, 1, cx, cy - 4, 4);
        gP3.addColorStop(0, "#bcaaa4"); gP3.addColorStop(1, "#5d4037");
        ctx.fillStyle = gP3; ctx.beginPath(); ctx.arc(cx, cy - 4, 3.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#5d4037"; ctx.beginPath(); ctx.moveTo(cx - 1.8, cy - 5.5); ctx.quadraticCurveTo(cx, cy - 10, cx + 1, cy - 9); ctx.quadraticCurveTo(cx + 2, cy - 5.5, cx - 1.8, cy - 5.5); ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.18)"; ctx.beginPath(); ctx.arc(cx - 3, cy + 4, 0.8, 0, Math.PI * 2); ctx.arc(cx - 2, cy - 1, 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(139, 195, 74, ${0.35 * poopAlpha})`; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
        for (let s = 0; s < 3; s++) {
          const sx = it.x + 4 + s * 6;
          const wave = Math.sin(now * 0.004 + s * 1.5) * 2.5;
          ctx.beginPath(); ctx.moveTo(sx, it.y + 4); ctx.quadraticCurveTo(sx + wave, it.y - 3, sx - wave, it.y - 7); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const pct = Math.max(0, (it.duration - age) / it.duration);
        if (pct < 0.9) {
          ctx.fillStyle = "rgba(62, 39, 35, 0.3)"; ctx.fillRect(it.x, it.y + CELL + 1, CELL, 2.5);
          ctx.fillStyle = pct < 0.2 ? "#ff3b5c" : "#ff8c00"; ctx.fillRect(it.x, it.y + CELL + 1, CELL * pct, 2.5);
        }
        ctx.restore();
        break;
      }
    }
  });
}

function createBurst(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + Math.random() * 0.4;
    const spd   = 1.5 + Math.random() * 2.5;
    particles.push({
      x: x + CELL / 2, y: y + CELL / 2,
      vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
      alpha: 1, color,
      size: 2 + Math.random() * 3,
    });
  }
}

function updateDrawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.05; p.alpha -= 0.05;
    if (p.alpha <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle   = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.globalAlpha = 1;
  }
}

// ★ FLOATING SCORE TEXT
function showFloatingText(x, y, text, color = "#ffffff", scale = 1.0) {
  floatingTexts.push({
    x, y: y - 5,
    text,
    color,
    alpha: 1.0,
    vy:    -1.2,
    scale,
    life:  60,
  });
}

function updateDrawFloatingTexts() {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y     += ft.vy;
    ft.vy    *= 0.96;
    ft.alpha -= 0.016;
    ft.life--;
    if (ft.alpha <= 0 || ft.life <= 0) { floatingTexts.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha  = ft.alpha;
    ctx.fillStyle    = ft.color;
    ctx.shadowColor  = ft.color;
    ctx.shadowBlur   = 6;
    ctx.font         = `bold ${Math.floor(13 * ft.scale)}px "Share Tech Mono", monospace`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

// ★ SCREEN SHAKE
function triggerScreenShake(intensity = 5) {
  shakeIntensity = Math.max(shakeIntensity, intensity);
}

function applyScreenShake() {
  if (shakeIntensity < 0.5) { shakeIntensity = 0; return; }
  const sx = (Math.random() - 0.5) * shakeIntensity;
  const sy = (Math.random() - 0.5) * shakeIntensity;
  ctx.translate(sx, sy);
  shakeIntensity *= shakeDecay;
}

function drawGameOver() {
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ff3b5c";
  ctx.font      = "bold 38px 'Share Tech Mono', monospace";
  ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - 60);

  ctx.fillStyle = "#c8d4e8";
  ctx.font      = "18px 'Share Tech Mono', monospace";
  ctx.fillText(`Skor Akhir: ${score}`, canvas.width / 2, canvas.height / 2 - 22);

  ctx.fillStyle = "#ffd700";
  ctx.font      = "14px 'Share Tech Mono', monospace";
  ctx.fillText(`🏆 Best Score: ${bestScore}`, canvas.width / 2, canvas.height / 2 + 8);

  ctx.fillStyle = snakeColor;
  ctx.font      = "13px 'Share Tech Mono', monospace";
  ctx.fillText(`Level Tercapai: ${LEVELS[levelIndex].name}`, canvas.width / 2, canvas.height / 2 + 32);

  // ★ Tampilkan XP yang diperoleh
  const xpEarned = calcSessionXP();
  ctx.fillStyle = "#00f5c4";
  ctx.font      = "13px 'Share Tech Mono', monospace";
  ctx.fillText(`+${xpEarned} XP Diperoleh`, canvas.width / 2, canvas.height / 2 + 54);

  ctx.fillStyle = "#4a5568";
  ctx.font      = "12px 'Share Tech Mono', monospace";
  ctx.fillText("Enter - Main Lagi  |  Esc - Menu Utama", canvas.width / 2, canvas.height / 2 + 76);
}

function applyMatriksPikselCRT() {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
  for (let y = 0; y < canvas.height; y += 4) {
    ctx.fillRect(0, y, canvas.width, 1.8);
  }
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
//  12. GAME LOOP
// ════════════════════════════════════════════════════════════════════════════
function renderLoop(timestamp) {
  rafId = requestAnimationFrame(renderLoop);

  if (currentState === STATE.PLAYING) {
    let elapsed = timestamp - lastLogicTime;
    if (elapsed >= logicInterval) {
      lastLogicTime = timestamp - (elapsed % logicInterval);
      logicTick();
    }
    const postElapsed = timestamp - lastLogicTime;
    lerpT = Math.min(postElapsed / logicInterval, 1);
  } else if (currentState === STATE.PAUSED) {
    lerpT = 0;
    lastLogicTime = timestamp;
  }

  ctx.save();
  applyScreenShake();

  ctx.clearRect(-20, -20, canvas.width + 40, canvas.height + 40);
  drawGrid();
  drawTrail();   // ★ trail sebelum snake

  const isInvul = performance.now() < invulnerableUntil;
  if (!(isInvul && Math.floor(performance.now() / 100) % 2 === 0)) {
    drawSnake(lerpT);
  }

  drawItems();
  updateDrawParticles();
  updateDrawFloatingTexts();  // ★ floating texts
  drawCrownOverlay();         // ★ v7.0 crown atas kepala pemimpin

  ctx.restore();

  if (currentState === STATE.GAME_OVER) drawGameOver();

  applyMatriksPikselCRT();
  tickPowerUps();            // ★ cek expiry power-up setiap frame
  updatePowerUpUI();
}

function logicTick() {
  if (inputQueue.length > 0) {
    const next = inputQueue.shift();
    dx = next.dx; dy = next.dy;
  }

  tongueFlipCounter++;
  if (tongueFlipCounter >= TONGUE_FLIP_EVERY) {
    tongueFlipCounter = 0;
    tongueOut = !tongueOut;
  }

  prevSnake = snake.map(s => ({ x: s.x, y: s.y }));

  // ★ simpan posisi kepala ke trail
  snakeTrail.push({ x: snake[0].x, y: snake[0].y });
  if (snakeTrail.length > TRAIL_MAX) snakeTrail.shift();

  moveSnake();
  checkSelfCollision();

  if (currentState === STATE.PLAYING) {
    checkItemCollision();
    expireItems();
    ensureApple();
    updateInfoBar();
  }
}

function moveSnake() {
  const cfg  = LEVELS[levelIndex];
  const head = { x: snake[0].x + dx, y: snake[0].y + dy };

  if (cfg.wrap) {
    if (head.x >= canvas.width)  head.x = 0;
    if (head.x < 0)              head.x = canvas.width - CELL;
    if (head.y >= canvas.height) head.y = 0;
    if (head.y < 0)              head.y = canvas.height - CELL;
  } else {
    if (head.x < 0 || head.x >= canvas.width || head.y < 0 || head.y >= canvas.height) {
      handleDeath(); return;
    }
  }

  snake.unshift(head);
  if (pendingGrowth > 0) { pendingGrowth--; } else { snake.pop(); }
}

function checkSelfCollision() {
  const head = snake[0];
  if (performance.now() < invulnerableUntil) return;

  // ★ Shield menangkis 1x self-collision
  if (isPowerUpActive("shield")) {
    for (let i = 1; i < snake.length; i++) {
      if (head.x === snake[i].x && head.y === snake[i].y) {
        delete activePowerUps.shield;
        triggerAudio("shield");
        notify("🛡 Shield menyerap tabrakan!", "gold", 2000);
        triggerScreenShake(6);
        showFloatingText(head.x + CELL/2, head.y, "BLOCKED!", "#00cfff");
        updatePowerUpUI();
        return;
      }
    }
    return;
  }

  for (let i = 1; i < snake.length; i++) {
    if (head.x === snake[i].x && head.y === snake[i].y) {
      handleDeath(); return;
    }
  }
}

function handleDeath() {
  lives--;
  playerStats.totalDeaths++;
  emitToServer({ lives, score, status: lives <= 0 ? "dead" : "alive" });
  comboStreak = 0;
  triggerScreenShake(8);

  if (lives <= 0) {
    // ★ Update stats
    playerStats.totalGames++;
    playerStats.totalScore += score;
    playerStats.maxLevel    = Math.max(playerStats.maxLevel, levelIndex + 1);
    const sessionSec = Math.floor((performance.now() - sessionStartTime) / 1000);
    playerStats.totalPlayTimeSec += sessionSec;

    if (score > bestScore) { bestScore = score; saveUserData(); }
    saveStats();

    // ★ Award XP
    const xp = calcSessionXP();
    awardXP(xp);

    // ★ Check achievements
    checkAllAchievements();

    updateBestUI();
    triggerAudio("gameover");
    stopBGM();
    transitionTo(STATE.GAME_OVER);
    clearTimeout(poopSpawnTimer);

    // ★ v8.0: Tampilkan ghostBtn saat mati di multiplayer (saboteur)
    if (selectedMainMode === "multi") {
      const ghostBtnEl = document.getElementById("ghostBtn");
      if (ghostBtnEl) ghostBtnEl.style.display = "";
    }

    // Update profile panel di menu (sudah ready)
    updateProfilePanel();

    // ★ v7.0 — tampilkan match summary setelah delay singkat
    setTimeout(() => requestMatchSummary(), 1200);
    return;
  }

  triggerAudio("penalty");
  notify("💔 Nyawa berkurang! Hati-hati...", "danger");
  const startX = Math.floor(COLS / 2) * CELL;
  const startY = Math.floor(ROWS / 2) * CELL;
  snake     = [{ x: startX, y: startY }];
  prevSnake = [{ x: startX, y: startY }];
  snakeTrail = [];
  dx = CELL; dy = 0;
  inputQueue = []; pendingGrowth = 0;
  invulnerableUntil = performance.now() + 2000;
  updateLivesDisplay();
}

function checkItemCollision() {
  const head = snake[0];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (head.x !== it.x || head.y !== it.y) continue;
    items.splice(i, 1);

    const scoreMultiplier = isPowerUpActive("doublescr") ? 2 : 1;

    switch (it.type) {
      case "apple": {
        const gained = 1 * scoreMultiplier;
        pendingGrowth += 1;
        score += gained;
        playerStats.applesEaten++;
        incrementCombo();
        triggerAudio("eat");
        createBurst(it.x, it.y, snakeColor);
        showFloatingText(it.x + CELL/2, it.y, `+${gained}`, snakeColor);
        trySpawnBonus();
        checkLevelUp();
        break;
      }
      case "gold": {
        const gained = 3 * scoreMultiplier;
        pendingGrowth += 1;
        score += gained;
        playerStats.goldCollected++;
        incrementCombo();
        triggerAudio("bonus");
        createBurst(it.x, it.y, "#ffd700", 12);
        showFloatingText(it.x + CELL/2, it.y, `+${gained}`, "#ffd700");
        notify(`✨ Buah Emas! +${gained} poin`, "gold");
        checkLevelUp();
        break;
      }
      case "banana": {
        const gained = 5 * scoreMultiplier;
        pendingGrowth += 1;
        score += gained;
        playerStats.bananasCollected++;
        incrementCombo();
        triggerAudio("bonus");
        createBurst(it.x, it.y, "#fff000", 14);
        showFloatingText(it.x + CELL/2, it.y, `+${gained}`, "#fff176");
        notify(`🍌 Pisang Super! +${gained} poin`, "gold");
        checkLevelUp();
        break;
      }
      case "poop": {
        score = Math.max(0, score - 3);
        playerStats.poopHits++;
        comboStreak = 0;
        triggerAudio("penalty");
        createBurst(it.x, it.y, "#795548", 6);
        showFloatingText(it.x + CELL/2, it.y, "-3", "#ff3b5c");
        triggerScreenShake(5);
        notify("💩 Terkena Kotoran! -3 poin", "danger");
        let cut = 3;
        while (cut > 0 && snake.length > 1) { snake.pop(); cut--; }
        if (prevSnake.length > snake.length) prevSnake.length = snake.length;
        emitToServer({ score, lives, status: "alive" });
        break;
      }
      default: {
        // ★ Power-up collection
        if (it.type && it.type.startsWith("powerup_")) {
          const puType = it.type.replace("powerup_", "");
          activatePowerUp(puType);
          createBurst(it.x, it.y, POWERUP_TYPES[puType]?.color || "#fff", 10);
          showFloatingText(it.x + CELL/2, it.y, POWERUP_TYPES[puType]?.icon || "⚡", POWERUP_TYPES[puType]?.color || "#fff", 1.5);
        }
        break;
      }
    }

    if (score > bestScore) { bestScore = score; saveUserData(); updateBestUI(); }
    emitToServer({ score, lives, status: "alive" });
    checkAllAchievements();
  }
}

// ── Combo Streak System ─────────────────────────────────────────────────
function incrementCombo() {
  comboStreak++;
  sessionHighCombo = Math.max(sessionHighCombo, comboStreak);
  playerStats.highestCombo = Math.max(playerStats.highestCombo, comboStreak);
  clearTimeout(comboTimeout);

  if (comboStreak >= 3) {
    const bonus = Math.floor(comboStreak / 3);
    score += bonus;
    triggerAudio("combo");
    showComboDisplay(`${comboStreak}x COMBO! +${bonus}`);
    showFloatingText(snake[0].x + CELL/2, snake[0].y - CELL, `${comboStreak}x COMBO!`, "#ff8c00", 1.3);
    notify(`🔥 ${comboStreak}x COMBO! Bonus +${bonus} poin`, "combo", 1500);
    triggerScreenShake(3);
  }

  comboTimeout = setTimeout(() => { comboStreak = 0; }, 4000);
}

function showComboDisplay(text) {
  if (!comboDisplay) return;
  comboDisplay.textContent = text;
  comboDisplay.classList.remove("show");
  void comboDisplay.offsetWidth;
  comboDisplay.classList.add("show");
  setTimeout(() => comboDisplay.classList.remove("show"), 600);
}

// ════════════════════════════════════════════════════════════════════════════
//  13. LEVEL & UI MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════
function checkLevelUp() {
  const cfg = LEVELS[levelIndex];
  // FIX: Gunakan >= agar level naik tepat saat skor mencapai batas, bukan melewatinya
  if (score >= cfg.scoreLimit && levelIndex < LEVELS.length - 1) {
    triggerAudio("levelup");
    showLevelTransition(levelIndex + 1);
  }
}

function showLevelTransition(newIdx) {
  transitionTo(STATE.LEVEL_TRANSITION);
  levelIndex    = newIdx;
  logicInterval = isPowerUpActive("slowmotion") ? Math.min(LEVELS[levelIndex].speed * 2, 350) : LEVELS[levelIndex].speed;
  const cfg = LEVELS[levelIndex];
  applyLevelTheme();
  updateInfoBar();
  levelStars.textContent = "⭐".repeat(cfg.num);
  lpBadge.textContent    = "LEVEL UP!";
  levelText.textContent  = cfg.name;
  scoreText.textContent  = `Skor: ${score}  ·  Speed baru: ${cfg.speed}ms`;
  levelPanel.classList.add("visible");
  clearTimeout(poopSpawnTimer);
  stopBGM();
  setTimeout(() => { if (!globalMuted) startBGM(); }, 100);
}

function applyLevelTheme() {
  document.body.className = LEVELS[levelIndex].cssClass;
  applySnakeColor(snakeColor, snakeColorName);
}

function updateInfoBar() {
  scoreDisplay.textContent = score;
  levelDisplay.textContent = LEVELS[levelIndex].num;
  speedDisplay.textContent = LEVELS[levelIndex].speed;
  updateLivesDisplay();
}

function updateLivesDisplay() {
  const maxLives = selectedMode === "hard" ? 1 : selectedMode === "medium" ? 2 : 3;
  let str = "";
  for (let i = 0; i < maxLives; i++) str += i < lives ? "❤️" : "🖤";
  livesDisplay.textContent = str;
}

function updateBestUI() {
  if (bestDisplay)    bestDisplay.textContent    = bestScore;
  if (overlayBestDisp) overlayBestDisp.textContent = bestScore;
  // Juga update overlay best display jika ada
  const obe = document.getElementById("overlayBestDisplay");
  if (obe) obe.textContent = bestScore;
}

function hexAlpha(hex, alpha) {
  // Validasi hex: pastikan format #RRGGBB
  if (!hex || typeof hex !== "string" || !hex.startsWith("#") || hex.length < 7) {
    return `rgba(0,245,196,${alpha})`;
  }
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(0,245,196,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
  } catch { return `rgba(0,245,196,${alpha})`; }
}

// ════════════════════════════════════════════════════════════════════════════
//  14. GAME LIFECYCLE
// ════════════════════════════════════════════════════════════════════════════
function initGame() {
  const startX = Math.floor(COLS / 2) * CELL;
  const startY = Math.floor(ROWS / 2) * CELL;
  snake     = [{ x: startX, y: startY }];
  prevSnake = [{ x: startX, y: startY }];
  snakeTrail = [];
  dx = CELL; dy = 0;

  score         = 0;
  levelIndex    = 0;
  logicInterval = LEVELS[0].speed;
  lastLogicTime = 0;
  lerpT         = 0;
  pendingGrowth = 0;
  inputQueue    = [];
  particles     = [];
  floatingTexts = [];
  items         = [];
  invulnerableUntil = 0;
  tongueOut     = false;
  tongueFlipCounter = 0;
  comboStreak   = 0;
  sessionHighCombo = 0;
  activePowerUps = {};
  shakeIntensity = 0;
  sessionStartTime = performance.now();

  // ★ v7.0 resets
  _sessionSaboteurSent     = 0;
  _sessionSaboteurReceived = 0;
  window._prevCrownId      = undefined;
  window._crownId          = null;
  window._crownBoard       = [];

  const livesMap = { easy: 3, medium: 2, hard: 1 };
  lives = livesMap[selectedMode] || 3;

  clearTimeout(poopSpawnTimer);
  ensureApple();
  applyLevelTheme();
  updateInfoBar();
  updateBestUI();
  updatePowerUpUI();

  playerNameTag.textContent = currentUsername || "PLAYER";
  modeTag.textContent = selectedMainMode === "multi" ? "MULTI" : "SINGLE";
  modeTag.className = "mode-tag" + (selectedMainMode === "multi" ? " multi" : "");
  levelPanel.classList.remove("visible");
}

function exitToMainMenu() {
  // ★ v8.0 FIX: Cancel render loop PERTAMA sebelum state change apapun
  cancelAnimationFrame(rafId);
  rafId = null;

  if (selectedMainMode === "multi") {
    if (socket && socket.connected && myRoomId) socket.emit("exitGame");
    leaderboardPanel.classList.remove("active");
    myRoomId    = null;
    isLobbyHost = false;
  }

  // BUG FIX: Hentikan BGM sepenuhnya
  stopBGM();
  bgmPlaying = false;

  // BUG FIX: Reset score display
  if (scoreDisplay)  scoreDisplay.textContent  = "0";
  if (levelDisplay)  levelDisplay.textContent  = "1";
  if (speedDisplay)  speedDisplay.textContent  = "220";
  if (livesDisplay)  livesDisplay.textContent  = "";

  // BUG FIX: Sembunyikan ghostBtn
  const ghostBtnEl = document.getElementById("ghostBtn");
  if (ghostBtnEl) ghostBtnEl.style.display = "none";

  // BUG FIX: Hapus match summary jika terbuka
  const summaryModal = document.getElementById("matchSummaryModal");
  if (summaryModal) summaryModal.remove();

  transitionTo(STATE.START_SCREEN);
  startOverlay.classList.remove("hidden");
  stepMode.classList.add("active");
  stepSetup.classList.remove("active");
  stepMulti.classList.remove("active");

  // ★ v8.0: Stop room browser auto-refresh
  stopRoomBrowserAutoRefresh();
  clearTimeout(poopSpawnTimer);
  notify("Kembali ke Menu Utama.", "warning", 2000);
  updateProfilePanel();
}

function startGame() {
  // Multiplayer: now handled via Lobby System (createRoom / joinRoom buttons in section 17B)
  // This function only handles single player mode
  if (selectedMainMode !== "single") return;

  const nameVal = usernameInput.value.trim();
  if (!nameVal) { usernameError.textContent = "Nama wajib diisi!"; return; }
  usernameError.textContent = "";

  currentUsername = nameVal.substring(0, 12);
  saveUserData();
  initAudioContext();

  startOverlay.classList.add("hidden");
  transitionTo(STATE.PLAYING);

  initGame();
  schedulePoopSpawn();

  cancelAnimationFrame(rafId);
  lastLogicTime = performance.now();
  rafId = requestAnimationFrame(renderLoop);

  notify(`Selamat bermain, ${currentUsername}! 🎮`, "success", 3000);

  if (!globalMuted) {
    setTimeout(() => startBGM(), 200);
  }

  const muteBtn = document.getElementById("btnMute");
  if (muteBtn) muteBtn.textContent = globalMuted ? "🔇" : "🔊";
}

function restartGame() {
  // FIX: Hentikan render loop lama agar tidak berjalan double
  cancelAnimationFrame(rafId);
  rafId = null;

  // Reset score display sebelum init
  if (scoreDisplay) scoreDisplay.textContent = "0";
  if (levelDisplay) levelDisplay.textContent = "1";

  transitionTo(STATE.PLAYING);
  initGame();
  schedulePoopSpawn();
  lastLogicTime = performance.now();
  if (!globalMuted) {
    stopBGM();
    setTimeout(() => startBGM(), 100);
  }

  // Sembunyikan game over overlay dengan clear canvas, lalu mulai loop baru
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  rafId = requestAnimationFrame(renderLoop);
}

function addInput(nextDx, nextDy) {
  const last = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : { dx, dy };
  // Cegah input pada sumbu yang sama (sudah bergerak horizontal/vertikal)
  if (nextDx !== 0 && last.dx !== 0) return;
  if (nextDy !== 0 && last.dy !== 0) return;
  // FIX: Cegah reverse direction SELALU — tidak hanya saat snake.length > 1
  if (nextDx !== 0 && nextDx === -last.dx) return;
  if (nextDy !== 0 && nextDy === -last.dy) return;
  if (inputQueue.length < 2) inputQueue.push({ dx: nextDx, dy: nextDy });
}

function togglePause() {
  // BUG FIX: Jangan pause saat level transition
  if (currentState === STATE.LEVEL_TRANSITION) return;
  if (currentState === STATE.PLAYING) {
    transitionTo(STATE.PAUSED);
    pauseIndicator.classList.add("visible");
    notify("⏸ PAUSED · Tekan SPACE untuk lanjut", "warning", 0);
    pauseBGM();
  } else if (currentState === STATE.PAUSED) {
    transitionTo(STATE.PLAYING);
    pauseIndicator.classList.remove("visible");
    lastLogicTime = performance.now();
    notify("▶ LANJUT!", "success", 1500);
    resumeBGM();
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  15. AUDIO UI WIRING
// ════════════════════════════════════════════════════════════════════════════
function initAudioUI() {
  const audioToggle = document.getElementById("audioToggle");
  const bgmSlider   = document.getElementById("bgmVolume");
  const sfxSlider   = document.getElementById("sfxVolume");
  const bgmVal      = document.getElementById("bgmVolVal");
  const sfxVal      = document.getElementById("sfxVolVal");
  const audioCtrls  = document.getElementById("audioControls");

  if (!audioToggle) return;

  audioToggle.checked = !globalMuted;
  bgmSlider.value     = Math.round(bgmVolume * 100);
  sfxSlider.value     = Math.round(sfxVolume * 100);
  bgmVal.textContent  = bgmSlider.value + "%";
  sfxVal.textContent  = sfxSlider.value + "%";
  if (globalMuted) audioCtrls.classList.add("muted");

  audioToggle.addEventListener("change", () => {
    globalMuted = !audioToggle.checked;
    audioCtrls.classList.toggle("muted", globalMuted);
    saveUserPrefs();
  });

  bgmSlider.addEventListener("input", () => {
    bgmVal.textContent = bgmSlider.value + "%";
    applyBGMVolume(parseInt(bgmSlider.value) / 100);
  });

  sfxSlider.addEventListener("input", () => {
    sfxVal.textContent = sfxSlider.value + "%";
    applySFXVolume(parseInt(sfxSlider.value) / 100);
    if (!globalMuted) triggerAudio("eat");
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  16. INTERFACE WIRING
// ════════════════════════════════════════════════════════════════════════════
const multiTabs     = document.querySelectorAll(".multi-tab");
const multiContents = document.querySelectorAll(".multi-content");

multiTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    multiTabs.forEach(t => t.classList.remove("active"));
    multiContents.forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    activeMultiTab = tab.dataset.tab;
    const targetPanelId = `panel${activeMultiTab.charAt(0).toUpperCase() + activeMultiTab.slice(1)}`;
    document.getElementById(targetPanelId).classList.add("active");
  });
});

mainModeBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    mainModeBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedMainMode = btn.dataset.mainmode;
  });
});

btnNext1.addEventListener("click", () => {
  stepMode.classList.remove("active");
  if (selectedMainMode === "multi") {
    document.getElementById("step-multi").classList.add("active");
  } else {
    stepSetup.classList.add("active");
    usernameInput.focus();
  }
});

btnBack1.addEventListener("click", () => { stepSetup.classList.remove("active"); stepMode.classList.add("active"); });
document.getElementById("btnBackMulti").addEventListener("click", () => { document.getElementById("step-multi").classList.remove("active"); stepMode.classList.add("active"); });

document.querySelectorAll(".mode-btn").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".mode-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active"); selectedMode = b.dataset.mode;
  const infoMap = { easy: "3 Nyawa · Dinding Tembus · Kecepatan Normal", medium: "2 Nyawa · Dinding Tembus · Kecepatan Sedang", hard: "1 Nyawa · Dinding Solid · Kecepatan Tinggi" };
  if (modeInfo) modeInfo.textContent = infoMap[selectedMode] || "";
}));
document.querySelectorAll(".mode-btn-m").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".mode-btn-m").forEach(x => x.classList.remove("active"));
  b.classList.add("active"); selectedMode = b.dataset.mode;
}));
document.querySelectorAll(".mode-btn-j").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".mode-btn-j").forEach(x => x.classList.remove("active"));
  b.classList.add("active"); selectedMode = b.dataset.mode;
}));

startBtn.addEventListener("click", startGame);
// startMultiBtn and joinServerBtn are now handled in the Lobby System (section 17B)
nextLevelBtn.addEventListener("click", () => {
  levelPanel.classList.remove("visible");
  transitionTo(STATE.PLAYING);
  lastLogicTime = performance.now();
  schedulePoopSpawn();
  if (!globalMuted) resumeBGM();
});

// ── Input: Keyboard ─────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (currentState === STATE.PLAYING || currentState === STATE.PAUSED) {
    if (e.key === "ArrowUp")    { addInput(0, -CELL); e.preventDefault(); }
    if (e.key === "ArrowDown")  { addInput(0,  CELL); e.preventDefault(); }
    if (e.key === "ArrowLeft")  { addInput(-CELL, 0); e.preventDefault(); }
    if (e.key === "ArrowRight") { addInput( CELL, 0); e.preventDefault(); }
    if (e.key === " ")          { e.preventDefault(); togglePause(); }
    if (e.key === "m" || e.key === "M") { toggleGlobalMute(); }
    if (e.key === "Tab" && selectedMainMode === "multi") {
      e.preventDefault();
      openQuickChatPanel();
    }

    // BUG FIX: ESC — pause dulu, lalu konfirmasi (hindari race condition)
    if (e.key === "Escape") {
      e.preventDefault();
      if (currentState === STATE.PLAYING) {
        togglePause(); // pause dulu
      }
      // Gunakan setTimeout agar pause ter-render sebelum confirm dialog muncul
      setTimeout(() => {
        if (confirm("Keluar dari sesi permainan aktif dan kembali ke menu utama?")) {
          exitToMainMenu();
        } else if (currentState === STATE.PAUSED) {
          togglePause(); // lanjut lagi jika batal
        }
      }, 50);
    }
  }
  if (currentState === STATE.GAME_OVER) {
    if (e.key === "Enter") restartGame();
    if (e.key === "Escape") { e.preventDefault(); exitToMainMenu(); }
  }
  // BUG FIX: Level transition Enter / Space → lanjut level
  if (currentState === STATE.LEVEL_TRANSITION) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const nextBtn = document.getElementById("nextLevelBtn");
      if (nextBtn) nextBtn.click();
    }
  }
});

// ── Input: Click Canvas ─────────────────────────────────────────────────
canvas.addEventListener("click", (e) => {
  if (currentState === STATE.GAME_OVER) { restartGame(); return; }
  if (currentState !== STATE.PLAYING) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  const dX = mx - snake[0].x, dY = my - snake[0].y;
  if (Math.abs(dX) > Math.abs(dY)) addInput(dX > 0 ? CELL : -CELL, 0);
  else addInput(0, dY > 0 ? CELL : -CELL);
});

// ── Input: Touch Swipe ──────────────────────────────────────────────────
canvas.addEventListener("touchstart", (e) => {
  if (currentState === STATE.GAME_OVER) { restartGame(); e.preventDefault(); return; }
  touchSX = e.touches[0].clientX;
  touchSY = e.touches[0].clientY;
  e.preventDefault();
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
  const tdx = e.changedTouches[0].clientX - touchSX;
  const tdy = e.changedTouches[0].clientY - touchSY;
  if (Math.abs(tdx) < 15 && Math.abs(tdy) < 15) return;
  if (Math.abs(tdx) > Math.abs(tdy)) addInput(tdx > 0 ? CELL : -CELL, 0);
  else addInput(0, tdy > 0 ? CELL : -CELL);
  e.preventDefault();
}, { passive: false });

// ── Input: D-Pad ────────────────────────────────────────────────────────
["btn-up","btn-down","btn-left","btn-right"].forEach(id => {
  const dirMap = { "btn-up": [0,-CELL], "btn-down": [0,CELL], "btn-left": [-CELL,0], "btn-right": [CELL,0] };
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener("click",      () => addInput(...dirMap[id]));
  btn.addEventListener("touchstart", (e) => { e.preventDefault(); addInput(...dirMap[id]); }, { passive: false });
});


// ════════════════════════════════════════════════════════════════════════════
//  17. SOCKET.IO NETWORKING — v8.0 Lobby System
// ════════════════════════════════════════════════════════════════════════════
//  FASE 1 — UI HELPERS: Ping Display, Reconnect Overlay, Room Browser
// ════════════════════════════════════════════════════════════════════════════

// ── Ping Display ──────────────────────────────────────────────────────────
function updatePingDisplay(ping) {
  const el = document.getElementById("lobbyMyPing");
  if (!el) return;
  el.textContent = `${ping}ms`;
  el.className = "lobby-ping-badge " + (ping < 80 ? "ping-good" : ping < 200 ? "ping-ok" : "ping-bad");
}

// ── Reconnect Overlay (Phase 1 Upgraded) ─────────────────────────────────
// ★ FASE 1: showReconnectOverlay sekarang di section Phase 1 Functions di bawah

// ── Room Browser (Phase 1 Upgraded) ──────────────────────────────────────
// ★ FASE 1: fetchAndShowRoomBrowser, renderRoomBrowserList, quickJoinToRoom
//   sekarang di section Phase 1 Functions di bawah

function openRoomBrowser() {
  fetchAndShowRoomBrowser();
}

async function fetchRoomList() {
  // Legacy wrapper — delegates to Phase 1 implementation
  fetchAndShowRoomBrowser();
}

function joinFromBrowser(roomId) {
  quickJoinToRoom(roomId);
}

function doQuickJoin() {
  triggerQuickJoin();
}

// ── Host Control Panel (Phase 1 Upgraded) ────────────────────────────────
// ★ FASE 1: kickPlayer, injectHostSettingsPanel, applyHostRoomSettings
//   sekarang di section Phase 1 Functions di bawah

function openHostControlPanel() {
  // Toggle host settings panel
  const panel = document.getElementById("hostSettingsPanel");
  const toggleBtn = document.getElementById("hostSettingsToggleBtn");
  if (panel && toggleBtn) {
    const isHidden = panel.style.display === "none" || !panel.style.display;
    panel.style.display = isHidden ? "" : "none";
    toggleBtn.innerHTML = isHidden ? "✕ Tutup Pengaturan" : "⚙️ Pengaturan Room";
  }
}

function saveHostSettings() {
  applyHostRoomSettings();
}

// ════════════════════════════════════════════════════════════════════════════
let socket     = null;
let mySocketId = null;
let myRoomId   = null;
let isLobbyHost = false;
let lobbyState  = "WAITING";
let _myPing     = 0;

// ── Socket Initialization ──────────────────────────────────────────────────
function initSocket() {
  if (typeof io === "undefined") {
    if (lbStatus) lbStatus.textContent = "Offline Mode";
    return;
  }
  if (!socket) {
    socket = io({
      autoConnect: true,
      transports: ["polling", "websocket"],
    });
  }
  bindSocketEvents();
}

// ── Bind all socket event handlers ─────────────────────────────────────────
function bindSocketEvents() {
  if (!socket) return;
  // BUG FIX: Hapus semua listener sebelum rebind agar tidak duplikat
  socket.offAny();
  socket.removeAllListeners();
  socket.off("connect");
  socket.off("disconnect");
  socket.off("connect_error");
  socket.off("disconnect");

  socket.on("connect", () => {
    mySocketId = socket.id;
    if (lbStatus) lbStatus.textContent = `ID: ${socket.id.slice(0, 6)}`;
    console.log("[Socket] Connected:", socket.id);
    // ── AUTO RECONNECT cek token tersimpan ──────────────────────────
    if (!_reconnectAttempted) {
      _reconnectAttempted = true;
      const saved = loadSessionTokenLocal();
      if (saved && saved.token && saved.roomId) {
        console.log("[Reconnect] Token ditemukan untuk room:", saved.roomId);
        showReconnectOverlay(saved.roomId);
        socket.emit("reconnectWithToken", { token: saved.token });
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("[Socket] Disconnected.");
    if (currentState === STATE.PLAYING && selectedMainMode === "multi") {
      notify("⚠️ Koneksi terputus! Mencoba reconnect...", "warning", 5000);
      showReconnectOverlay(myRoomId);
    }
  });

  // ── PING RTT ────────────────────────────────────────────────────────
  // Server kirim "pingCheck" ke client secara interval, client balas "pongCheck"
  socket.on("pingCheck", ({ ts }) => {
    socket.emit("pongCheck", { ts });
  });
  // Jika server kirim "pongCheck" sebagai reply dari client-initiated ping
  socket.on("pongCheck", ({ ts }) => {
    const rtt = Date.now() - ts;
    _myPing = rtt;
    updatePingDisplay(rtt);
    updateLatencyIndicator(rtt);
    socket.emit("latencyReport", { rtt });
  });
  socket.on("pingUpdate", ({ id, ping }) => {
    if (id === mySocketId) { _myPing = ping; updatePingDisplay(ping); }
    updateMemberPingBadge(id, ping);
  });

  // ── SESSION TOKEN ────────────────────────────────────────────────────
  socket.on("sessionToken", ({ token, roomId }) => {
    saveSessionTokenLocal(token, roomId);
  });
  
  // ── RECONNECT SUCCESS ────────────────────────────────────────────────
  socket.on("reconnectSuccess", (data) => {
    hideReconnectOverlay();
    clearSessionToken();
    myRoomId    = data.roomId;
    isLobbyHost = data.isHost;
    if (data.state === "PLAYING") {
      selectedMainMode = "multi";
      hideLobbyScreen();
      transitionTo(STATE.PLAYING);
      initGame();
      schedulePoopSpawn();
      cancelAnimationFrame(rafId);
      lastLogicTime = performance.now();
      rafId = requestAnimationFrame(renderLoop);
      leaderboardPanel.classList.add("active");
      setTimeout(() => injectQuickChatButton(), 500);
      startOverlay.classList.add("hidden");
      notify(`🔄 Reconnected! Selamat datang kembali!`, "success", 3000);
      if (!globalMuted) setTimeout(() => startBGM(), 200);
    } else {
      showLobbyScreen({ roomId: data.roomId, roomName: data.roomName, isHost: data.isHost });
      notify(`🔄 Kembali ke lobby room ${data.roomId}!`, "success", 3000);
    }
  });

  socket.on("reconnectFailed", ({ reason }) => {
    hideReconnectOverlay();
    clearSessionToken();
    notify("⚠️ Tidak dapat reconnect: " + reason, "warning", 4000);
  });

  socket.on("playerReconnected", ({ username }) => {
    appendLobbyChat(null, `${username} kembali terhubung! 🔄`, "system");
    notify(`🔄 ${username} reconnected!`, "success", 2500);
  });

  // ── KICKED ───────────────────────────────────────────────────────────
  socket.on("kicked", ({ reason }) => {
    hideLobbyScreen(); myRoomId = null; isLobbyHost = false;
    selectedMainMode = "single"; clearSessionToken();
    leaderboardPanel.classList.remove("active");
    startOverlay.classList.remove("hidden");
    transitionTo(STATE.START_SCREEN);
    notify("🚫 " + reason, "warning", 5000);
  });
  socket.on("playerKicked", ({ username }) => {
    appendLobbyChat(null, `${username} telah dikeluarkan dari room.`, "system");
  });

  // ── ROOM SETTINGS UPDATED ────────────────────────────────────────────
  socket.on("roomSettingsUpdated", ({ settings }) => {
    appendLobbyChat(null, `Pengaturan room diperbarui oleh Host.`, "system");
    const rnEl = document.getElementById("lobbyRoomName");
    if (rnEl && settings.name) rnEl.textContent = settings.name;
  });

  // ── QUICK JOIN RESULT ────────────────────────────────────────────────
  // ── [FIX] joinedRoom — Event utama untuk semua join success (host & guest) ──
  // Server sekarang selalu emit "joinedRoom" untuk createRoom, joinRoom, quickJoin
  socket.on("joinedRoom", (data) => {
    const { roomId, roomName, isHost, team } = data;
    myRoomId    = roomId;
    isLobbyHost = isHost;
    selectedMainMode = "multi";

    const statusEl = document.getElementById("connectStatus");
    if (statusEl) {
      statusEl.textContent = isHost
        ? `✅ Room dibuat: ${roomId}`
        : `✅ Bergabung ke room: ${roomId}`;
      statusEl.className = "connect-status success";
    }

    showLobbyScreen({ roomId, roomName: roomName || "Room Multiplayer", isHost });
    notify(
      isHost
        ? `🏠 Room ${roomId} berhasil dibuat! Tunggu pemain lain...`
        : `✅ Bergabung ke room ${roomId}!`,
      "success", 3000
    );
    clearSessionToken(); // reset session lama jika ada
  });

  // ── roomCreated — backward compat (host saja, dipanggil bersamaan joinedRoom) ──
  socket.on("roomCreated", ({ roomId, roomName }) => {
    // joinedRoom sudah handle ini — hanya update state jika belum ada
    if (!myRoomId) {
      myRoomId    = roomId;
      isLobbyHost = true;
      showLobbyScreen({ roomId, roomName: roomName || "Room Multiplayer", isHost: true });
    }
  });

  // ── roomApproved — backward compat (tidak lagi dikirim server baru, tapi jaga compat) ──
  socket.on("roomApproved", (data) => {
    if (!myRoomId && data.roomId) {
      myRoomId    = data.roomId;
      isLobbyHost = !!data.isHost;
      showLobbyScreen({ roomId: data.roomId, roomName: data.roomName, isHost: !!data.isHost });
    }
  });

  // ── serverInfo (LAN/Cloud URL & QR) ─────────────────────────────────────
  socket.on("serverInfo", (data) => {
    const isLocal = window.location.hostname === "localhost" ||
                    window.location.hostname.startsWith("192.168") ||
                    window.location.hostname.startsWith("10.") ||
                    window.location.hostname.startsWith("172.");
    const targetURL = isLocal ? (data.localURL || window.location.origin) : window.location.origin;
    updateLobbyQR(targetURL);
    const hud = document.getElementById("hostUrlDisplay");
    if (hud) hud.textContent = targetURL;
    updateConnectionBadge(data.isCloud);
    if (data.features) updateServerFeaturePills(data.features);
  });

  // ── Lobby Update (member list, state changes) ────────────────────────────
  socket.on("lobbyUpdate", (data) => {
    renderLobbyMembers(data);
    lobbyState = data.state;

    // Update room code & name
    const rcEl = document.getElementById("lobbyRoomCode");
    if (rcEl) rcEl.textContent = data.roomId;
    const rnEl = document.getElementById("lobbyRoomName");
    if (rnEl) rnEl.textContent = data.roomName;

    // Update player count
    const countEl = document.getElementById("lobbyPlayerCount");
    if (countEl) countEl.textContent = data.members.length;
    const maxEl = document.getElementById("lobbyMaxPlayers");
    if (maxEl) maxEl.textContent = data.maxPlayers;

    // ★ FASE 1: Update connection badge dari server data
    if (data.isCloud !== undefined) updateConnectionBadge(data.isCloud);

    // ★ gameMode tag di lobby header
    const gameModeTagEl = document.getElementById("lobbyGameModeTag");
    if (gameModeTagEl) {
      gameModeTagEl.textContent = "🎮 NORMAL";
      gameModeTagEl.className   = `lobby-gamemode-tag normal`;
    }
    // ★ Server feature pills
    if (data.features) renderServerFeaturePills(data.features);

    // Host start button: enable jika semua siap
    const startBtnLobby = document.getElementById("lobbyStartBtn");
    if (startBtnLobby) {
      if (isLobbyHost) {
        const nonHostMembers = data.members.filter(m => !m.isHost);
        const allReady = nonHostMembers.length === 0 || nonHostMembers.every(m => m.isReady);
        const canStart  = data.members.length >= 1 && allReady && data.state === "WAITING";
        startBtnLobby.disabled = !canStart;
        startBtnLobby.classList.toggle("pulse", canStart);

        const hintEl = document.getElementById("lobbyReadyHint") || document.getElementById("lobbyReadyHintText");
        if (hintEl) {
          if (data.members.length < 1) {
            hintEl.textContent = "Menunggu pemain bergabung...";
          } else if (!allReady) {
            const waitCount = nonHostMembers.filter(m => !m.isReady).length;
            hintEl.textContent = `Menunggu ${waitCount} pemain siap...`;
          } else {
            hintEl.textContent = nonHostMembers.length === 0
              ? "✅ Kamu sendirian — bisa mulai kapan saja!"
              : "✅ Semua siap! Tekan MULAI untuk memulai.";
          }
        }
      } else {
        // Guest: tampilkan status sendiri
        startBtnLobby.style.display = "none";
      }
    }
  });

  // ★ FASE 1: pingUpdate — sudah terdaftar di atas (dalam blok RTT Ping), tidak perlu duplikat

  // ── Lobby Chat ───────────────────────────────────────────────────────────
  socket.on("lobbyChatMessage", ({ id, username, message }) => {
    appendLobbyChat(username, message, id === mySocketId ? "me" : "other");
  });

  // ── Player Joined / Left / Disconnected ─────────────────────────────────
  socket.on("playerJoined", ({ username, count }) => {
    appendLobbyChat(null, `${username} bergabung ke lobby. (${count} pemain)`, "system");
  });
  socket.on("playerLeft", ({ username, count }) => {
    appendLobbyChat(null, `${username} meninggalkan room. (${count} pemain)`, "system");
  });
  socket.on("playerDisconnected", ({ username }) => {
    notify(`⚠️ ${username} terputus. Menunggu reconnect...`, "warning", 4000);
    appendLobbyChat(null, `${username} koneksi terputus. Menunggu...`, "system");
  });

  // ── Host Migrated ────────────────────────────────────────────────────────
  socket.on("hostMigrated", ({ newHostId, username, newHostUsername }) => {
    // FIX: server kirim 'username', bukan 'newHostUsername'
    const hostName = username || newHostUsername || "Pemain";
    if (newHostId === mySocketId) {
      isLobbyHost = true;
      updateLobbyHostUI(true);
      notify("👑 Kamu sekarang menjadi Host room!", "gold", 3000);
      // Inject host settings panel untuk host baru
      setTimeout(() => injectHostSettingsPanel(), 200);
    }
    appendLobbyChat(null, `👑 ${hostName} menjadi Host baru.`, "system");
  });

  // ── Match Countdown ──────────────────────────────────────────────────────
  // ★ v8.0 FIX: matchStarting dari server v9.0 (sebelum countdown dimulai)
  socket.on("matchStarting", ({ countdown }) => {
    // Server emit matchStarting { countdown: 3 } lalu matchCountdown secara interval
    appendLobbyChat(null, `⚠️ Match dimulai dalam ${countdown} detik!`, "system");
    notify(`🚦 Match akan dimulai dalam ${countdown} detik!`, "gold", 2500);
  });
  socket.on("matchCountdown", ({ count }) => {
    showLobbyCountdown(count);
    playSynth("eat");
  });
  // Legacy alias (server lama)
  socket.on("countdown", ({ count }) => {
    showLobbyCountdown(count);
    playSynth("eat");
  });

  // ── Match Start ──────────────────────────────────────────────────────────
  socket.on("matchStart", (data) => {
    hideLobbyCountdown();
    hideLobbyScreen();
    beginMatchFromLobby(data);
  });
  // Legacy alias
  socket.on("matchStarted", (data) => {
    hideLobbyCountdown();
    hideLobbyScreen();
    beginMatchFromLobby(data);
  });

  // ── Match Finished ───────────────────────────────────────────────────────
  socket.on("matchFinished", ({ reason, winner, rankings }) => {
    // Tampilkan notifikasi pemenang atau alasan akhir match
    const notifMsg = winner
      ? `🏆 ${winner.username} menang! (Skor: ${winner.score})`
      : "🏁 " + reason;
    notify(notifMsg, "success", 4000);
    // Log rankings ke console untuk debugging (tidak mengubah UI)
    if (rankings && rankings.length > 0) {
      console.log("[matchFinished] Rankings:", rankings);
    }
    setTimeout(() => {
      if (socket && socket.connected) {
        socket.emit("requestMatchSummary");
      }
    }, 800);
  });

  // ── Return To Lobby ──────────────────────────────────────────────────────
  socket.on("returnedToLobby", ({ roomId }) => {
    // BUGFIX: Pastikan selectedMainMode tetap "multi" saat kembali ke lobby
    selectedMainMode = "multi";
    myRoomId = roomId;
    stopBGM();
    leaderboardPanel.classList.remove("active");
    const qcp = document.getElementById("quickChatPanel");
    if (qcp) qcp.remove();
    showLobbyScreen({ roomId, roomName: null, isHost: isLobbyHost });
    notify("🔄 Kembali ke lobby. Siapkan dirimu!", "success", 2500);
  });

  // ── Room Closed ──────────────────────────────────────────────────────────
  socket.on("roomClosed", ({ reason }) => {
    hideLobbyScreen();
    myRoomId    = null;
    isLobbyHost = false;
    selectedMainMode = "single";
    leaderboardPanel.classList.remove("active");
    startOverlay.classList.remove("hidden");
    transitionTo(STATE.START_SCREEN);
    notify("🚪 " + reason, "warning", 4000);
  });

  // ── Join Error ───────────────────────────────────────────────────────────
  socket.on("joinError", ({ message, code }) => {
    const statusEl = document.getElementById("connectStatus");
    if (statusEl) { statusEl.textContent = `❌ ${message}`; statusEl.className = "connect-status error"; }
    notify("❌ " + message, "warning", 4000);
    console.warn("[JoinError]", code, message);
  });
  // Legacy aliases
  socket.on("joinRoomError", ({ message }) => {
    const statusEl = document.getElementById("connectStatus");
    if (statusEl) { statusEl.textContent = `❌ ${message}`; statusEl.className = "connect-status error"; }
    notify("❌ " + message, "warning", 4000);
  });
  socket.on("createRoomError", ({ message }) => {
    notify("❌ " + message, "warning", 4000);
  });
  socket.on("quickJoinError", ({ message }) => {
    notify("❌ " + message, "warning", 4000);
  });

  // ── Start Error ──────────────────────────────────────────────────────────
  socket.on("startError", ({ message }) => {
    notify("❌ " + message, "warning", 3000);
  });
  socket.on("startMatchError", ({ message }) => {
    notify("❌ " + message, "warning", 3000);
  });

  // ── Leaderboard Live Update (saat bermain) ───────────────────────────────
  socket.on("leaderboardLiveUpdate", (payload) => {
    const board   = Array.isArray(payload) ? payload : (payload.board || []);
    const crownId = Array.isArray(payload) ? null     : (payload.crownId || null);

    if (crownId && crownId !== window._prevCrownId) {
      if (window._prevCrownId !== undefined && crownId !== mySocketId) {
        const newLeader = board.find(p => p.id === crownId);
        if (newLeader) notify(`👑 Crown Stolen! ${newLeader.username} kini memimpin!`, "gold", 2500);
      }
      if (crownId === mySocketId && window._prevCrownId !== mySocketId) {
        notify("👑 Kamu adalah PEMIMPIN! Pertahankan mahkotamu!", "gold", 3000);
        playSynth("bonus");
      }
      window._prevCrownId = crownId;
    }

    lbList.innerHTML = board.map((p, i) => `
      <div class="lb-row ${p.id === mySocketId ? 'me' : ''} ${p.status === 'dead' ? 'ghost' : ''} ${p.isCrown ? 'crown-row' : ''}">
        <span>${p.isCrown ? '<span class="crown-icon">👑</span>' : (i + 1) + '.'} ${p.username}</span>
        <span>${p.score}</span>
      </div>
    `).join("");

    window._crownId    = crownId;
    window._crownBoard = board;
  });

  // ── Quick Chat ───────────────────────────────────────────────────────────
  socket.on("quickChatMessage", ({ id, username, message }) => {
    showQuickChatBubble(id, username, message);
  });

  // ── Match Summary ────────────────────────────────────────────────────────
  socket.on("matchSummaryData", (data) => {
    showMatchSummaryModal(data);
  });

  // ── Incoming Poop ────────────────────────────────────────────────────────
  socket.on("incomingPoop", () => {
    if (currentState === STATE.PLAYING) {
      spawnItem("poop", POOP_LIFETIME_MS);
      _sessionSaboteurReceived++;
      showFloatingText(snake[0]?.x + CELL/2 || 250, snake[0]?.y || 100, "SABOTEUR! 💩", "#ff3b5c", 1.2);
    }
  });

  // ── Saboteur result (optional server ack) ────────────────────────────────
  socket.on("saboteurSent", () => {
    _sessionSaboteurSent++;
    notify("💩 Kotoran dikirim ke lawan!", "gold", 1500);
  });

  // ── Room Full (legacy) ───────────────────────────────────────────────────
  socket.on("roomFull", ({ message }) => {
    notify("🚫 " + message, "warning", 4000);
  });

  // ── Server Announcements ──────────────────────────────────────────────────
  socket.on("announcement", ({ message, type }) => {
    notify("📢 " + message, type || "success", 3500);
    appendLobbyChat(null, message, "system");
  });

  // ── All Players Ready ─────────────────────────────────────────────────────
  socket.on("allPlayersReady", ({ count }) => {
    notify(`✅ Semua ${count} pemain siap! Kamu bisa mulai pertandingan.`, "success", 4000);
    const startBtnLobby = document.getElementById("lobbyStartBtn");
    if (startBtnLobby) {
      startBtnLobby.disabled = false;
      startBtnLobby.classList.add("pulse");
    }
    // ★ v8.0 FIX: Coba kedua ID (lobbyReadyHintText dari HTML terbaru, lobbyReadyHint dari HTML lama)
    const hintEl = document.getElementById("lobbyReadyHintText") || document.getElementById("lobbyReadyHint");
    if (hintEl) hintEl.textContent = `✅ ${count} pemain siap! Klik MULAI.`;
  });

  // ── Vote Kick Progress ────────────────────────────────────────────────────
  socket.on("voteKickProgress", ({ targetId, votes, majority }) => {
    const target = document.querySelector(`[data-player-id="${targetId}"] .lp-name`);
    const name   = target?.textContent || "Pemain";
    notify(`🗳️ Vote kick ${name}: ${votes}/${majority} suara`, "warning", 3000);
    appendLobbyChat(null, `Vote kick ${name}: ${votes}/${majority} suara dibutuhkan.`, "system");
  });

  // ── Reconnect events ──────────────────────────────────────────────────────
  socket.on("reconnected", ({ roomId, roomName, isHost }) => {
    hideReconnectOverlay();
    notify("✅ Berhasil reconnect ke room!", "success", 3000);
    showLobbyScreen({ roomId, roomName, isHost });
  });
  socket.on("reconnectFailed", ({ reason }) => {
    hideReconnectOverlay();
    notify("❌ Reconnect gagal: " + reason, "warning", 4000);
  });
  socket.on("playerReconnected", ({ id, username }) => {
    notify(`✅ ${username} berhasil reconnect!`, "success", 3000);
    appendLobbyChat(null, `${username} reconnect ke room.`, "system");
  });

  // ── Player Ready Change ──────────────────────────────────────────────────
  socket.on("playerReadyChange", ({ id, username, isReady }) => {
    appendLobbyChat(null, `${username} ${isReady ? "✅ siap" : "⏳ belum siap"}.`, "system");
  });

  // ── Room Lock Changed ────────────────────────────────────────────────────
  socket.on("roomLockChanged", ({ locked }) => {
    notify(locked ? "🔒 Room dikunci oleh host." : "🔓 Room dibuka oleh host.", "warning", 2500);
    appendLobbyChat(null, locked ? "Room dikunci oleh host." : "Room dibuka kembali.", "system");
  });
} // end bindSocketEvents
// BUGFIX: connectToServer dulu memanggil initSocket() lagi yang menduplikat listener.
// Sekarang socket dibuat fresh dan langsung resolve — listener sudah terpasang via initSocket() awal.
function connectToServer(url) {
  return new Promise((resolve, reject) => {
    if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
    const clean   = url.replace(/^(https?:\/\/|wss?:\/\/)/, "");
    const fullUrl = window.location.protocol + "//" + clean;
    // Railway: polling dulu
    socket = io(fullUrl, { transports: ["polling", "websocket"], timeout: 10000 });
    // Pasang semua event handler ke socket baru
    bindSocketEvents();
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

// ── Emit helpers ───────────────────────────────────────────────────────────
function emitJoin() {
  // Legacy compatibility — called when entering multiplayer without lobby flow
  if (socket && selectedMainMode === "multi" && !myRoomId) {
    socket.emit("joinRoom", { username: currentUsername, mode: selectedMode });
  }
}

// ★ UPDATE FASE 2: Telemetri posisi ditambahkan untuk Predictive AI
function emitToServer(data) {
  if (socket && socket.connected) {
    socket.emit("playerUpdate", {
      ...data,
      lastX: snake[0] ? snake[0].x : 0,
      lastY: snake[0] ? snake[0].y : 0,
      dx: dx,
      dy: dy,
      sessionStats: {
        applesEaten:      playerStats.applesEaten,
        goldCollected:    playerStats.goldCollected,
        bananasCollected: playerStats.bananasCollected,
        poopHits:         playerStats.poopHits,
        powerUpsUsed:     playerStats.powerUpsUsed,
        highestCombo:     playerStats.highestCombo,
        maxLevel:         playerStats.maxLevel,
        saboteurSent:     _sessionSaboteurSent,
        saboteurReceived: _sessionSaboteurReceived,
      }
    });
  }
}

let _sessionSaboteurSent     = 0;
let _sessionSaboteurReceived = 0;

// ── Begin match from lobby ─────────────────────────────────────────────────
function beginMatchFromLobby(data) {
  // BUGFIX: Set selectedMainMode, selectedMode, warna dari data lobby agar game
  // berjalan dengan setting yang benar (bukan default single/easy)
  selectedMainMode = "multi";
  if (data && data.players) {
    const myPlayerData = data.players.find(p => p.id === mySocketId);
    if (myPlayerData) {
      if (myPlayerData.username) currentUsername = myPlayerData.username;
      if (myPlayerData.mode)     selectedMode    = myPlayerData.mode;
      if (myPlayerData.color)    applySnakeColor(myPlayerData.color, myPlayerData.color);
    }
  }
  if (data && data.mode)     selectedMode = data.mode;
  if (data && data.gameMode) updateGameModeTag(data.gameMode);
  currentUsername = currentUsername || "Pemain";

  initAudioContext();
  startOverlay.classList.add("hidden");
  hideLobbyScreen();
  transitionTo(STATE.PLAYING);
  initGame();
  schedulePoopSpawn();
  cancelAnimationFrame(rafId);
  lastLogicTime = performance.now();
  rafId = requestAnimationFrame(renderLoop);
  leaderboardPanel.classList.add("active");
  setTimeout(() => injectQuickChatButton(), 500);
  notify(`🎮 MULAI! Semangat, ${currentUsername}!`, "success", 3000);
  if (!globalMuted) setTimeout(() => startBGM(), 200);
  const muteBtn = document.getElementById("btnMute");
  if (muteBtn) muteBtn.textContent = globalMuted ? "🔇" : "🔊";
}

// ════════════════════════════════════════════════════════════════════════════
//  17A. LOBBY SCREEN UI
// ════════════════════════════════════════════════════════════════════════════

function showLobbyScreen({ roomId, roomName, isHost }) {
  const el = document.getElementById("lobbyScreen");
  if (!el) return;

  // Hide start overlay while lobby is shown
  startOverlay.classList.add("hidden");
  el.classList.remove("hidden");

  isLobbyHost = isHost;

  // Room code
  const rcEl = document.getElementById("lobbyRoomCode");
  if (rcEl) rcEl.textContent = roomId || "——";

  const rnEl = document.getElementById("lobbyRoomName");
  if (rnEl) rnEl.textContent = roomName || "Room Multiplayer";

  // Host-only: QR & share section
  const shareSection = document.getElementById("lobbyShareSection");
  if (shareSection) shareSection.style.display = isHost ? "" : "none";

  if (isHost) {
    const url = window.location.origin + "?room=" + roomId;
    updateLobbyQR(url);
  }

  // Host vs guest actions
  document.getElementById("lobbyHostActions").style.display  = isHost ? "" : "none";
  document.getElementById("lobbyGuestActions").style.display = isHost ? "none" : "";

  updateLobbyHostUI(isHost);

  // ★ FASE 1: Inject host settings panel jika host
  if (isHost) {
    setTimeout(() => injectHostSettingsPanel(), 100);
  }

  // ★ FASE 1: Update connection badge berdasarkan koneksi saat ini
  const isLocal = window.location.hostname === "localhost" ||
                  window.location.hostname.startsWith("192.168") ||
                  window.location.hostname.startsWith("10.") ||
                  window.location.hostname.startsWith("172.");
  updateConnectionBadge(!isLocal);

  // Lobby copy button
  const copyBtn = document.getElementById("lobbyCopyBtn");
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(roomId).then(() => {
        copyBtn.textContent = "✅";
        setTimeout(() => copyBtn.textContent = "📋", 1500);
      }).catch(() => {});
    };
  }

  // Server info line
  const infoEl = document.getElementById("lobbyServerInfo");
  if (infoEl) {
    infoEl.textContent = `Server: ${window.location.host}`;
  }
}

function hideLobbyScreen() {
  const el = document.getElementById("lobbyScreen");
  if (el) el.classList.add("hidden");
  // ★ v8.0: Stop room browser auto-refresh saat lobby disembunyikan
  stopRoomBrowserAutoRefresh();
  const panel = document.getElementById("roomBrowserPanel");
  if (panel) panel.classList.add("hidden");
}

function updateLobbyQR(url) {
  const qrEl = document.getElementById("lobbyQrPlaceholder");
  if (!qrEl) return;
  const encoded = encodeURIComponent(url);
  qrEl.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encoded}"
    style="border-radius:4px; display:block;"
    alt="QR Room"/>`;
}

function updateLobbyHostUI(isHost) {
  document.getElementById("lobbyHostActions").style.display  = isHost ? "" : "none";
  document.getElementById("lobbyGuestActions").style.display = isHost ? "none" : "";
}

function renderLobbyMembers(data) {
  const list = document.getElementById("lobbyPlayerList");
  if (!list) return;
  if (!data.members || data.members.length === 0) {
    list.innerHTML = `<div class="lobby-player-empty">Belum ada pemain di lobby...</div>`;
    return;
  }

  // ★ FASE 1: Ping quality → warna badge
  function pingColor(q) {
    return { excellent: "#00f5c4", good: "#39ff14", fair: "#ffd700", poor: "#ff3b5c", unknown: "#4a5568" }[q] || "#4a5568";
  }
  function pingLabel(q, ping) {
    if (!ping || ping === 0) return "—";
    return ping + "ms";
  }

  list.innerHTML = data.members.map(m => {
    const isMe   = m.id === mySocketId;
    const isHost = m.isHost;
    const status = m.status === "disconnected" ? "disc" : (m.isReady || isHost ? "ready" : "wait");
    const statusLabel = m.status === "disconnected" ? "DISCONNECT" : (m.isReady || isHost ? "SIAP ✓" : "TUNGGU");
    const readyGlow = (m.isReady || isHost) && m.status !== "disconnected";

    // ★ FASE 1: Tier badge pemain
    const tierBadge = m.tier && m.tier !== 'Bronze'
      ? `<span class="lp-badge tier-badge">${m.tier.toUpperCase()}</span>` : '';

    // ★ FASE 1: Ping badge dengan warna kualitas
    const pColor = pingColor(m.pingQuality);
    const pLabel = pingLabel(m.pingQuality, m.ping);
    const pingBadge = `<span class="lp-ping-badge" data-member-id="${m.id}" style="color:${pColor};border-color:${pColor}30;background:${pColor}12">
      <span class="ping-dot" style="background:${pColor}"></span>${pLabel}
    </span>`;

    // ★ FASE 1: Kick button — hanya tampil untuk host, bukan diri sendiri
    const kickBtn = isLobbyHost && !isMe
      ? `<button class="lp-kick-btn" onclick="kickPlayer('${m.id}')" title="Keluarkan pemain">✕</button>` : '';

    // ★ FASE 1: Snake color preview dot (lebih besar dan mencolok)
    const colorDot = `<div class="lp-color-dot ${readyGlow ? 'glow' : ''}" style="--dot-color:${m.color || '#00f5c4'};background:${m.color || '#00f5c4'}"></div>`;

    return `
    <div class="lobby-player-row ${isMe ? 'is-me' : ''} ${isHost ? 'is-host' : ''} ${readyGlow ? 'is-ready' : ''}"
         data-player-id="${m.id}">
      ${colorDot}
      <div class="lp-info">
        <span class="lp-name">${escapeHtml(m.username)}</span>
        <div class="lp-badges">
          ${isHost ? '<span class="lp-badge host">👑 HOST</span>' : ''}
          ${isMe   ? '<span class="lp-badge you">KAMU</span>' : ''}
          ${tierBadge}
          <span class="lp-badge ${status}">${statusLabel}</span>
          <span class="lp-badge mode">${(m.mode || 'easy').toUpperCase()}</span>
        </div>
      </div>
      <div class="lp-right">
        ${pingBadge}
        ${kickBtn}
      </div>
    </div>`;
  }).join("");
}

function appendLobbyChat(username, message, type) {
  const box = document.getElementById("lobbyChatMessages");
  if (!box) return;
  const div = document.createElement("div");
  div.className = `lobby-chat-msg ${type || ""}`;
  if (type === "system") {
    div.innerHTML = `<em>${escapeHtml(message)}</em>`;
  } else {
    div.innerHTML = `<span class="lcm-name" style="color:${type === 'me' ? 'var(--clr-primary)' : '#00cfff'}">${escapeHtml(username)}:</span>${escapeHtml(message)}`;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  // Keep max 80 messages
  while (box.children.length > 80) box.removeChild(box.firstChild);
}

// ════════════════════════════════════════════════════════════════════════════
//  ★ FASE 1: HOST CONTROL PANEL FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

// Kick player — dipanggil dari inline onclick di renderLobbyMembers
function kickPlayer(targetId) {
  if (!isLobbyHost || !socket || !socket.connected) return;
  if (!confirm("Keluarkan pemain ini dari room?")) return;
  socket.emit("kickPlayer", { targetId });
}

// Update room settings dari host settings panel
function applyHostRoomSettings() {
  if (!isLobbyHost || !socket || !socket.connected) return;

  const nameEl     = document.getElementById("hostSettingRoomName") || document.getElementById("hsRoomName");
  const maxEl      = document.getElementById("hostSettingMaxPlayers") || document.getElementById("hsMaxPlayers");
  const privEl     = document.getElementById("hostSettingPrivate") || document.getElementById("hsPrivate");
  const teamEl     = document.getElementById("hostSettingTeamMode") || document.getElementById("hsTeamMode");
  const modeEl     = document.querySelector(".host-mode-btn.active") || document.querySelector(".hs-mode-btn.active");
  const gameModeEl = document.querySelector(".host-gamemode-btn.active") || document.querySelector(".hs-gamemode-btn.active");

  const roomName   = nameEl?.value?.trim() || null;
  const mode       = modeEl?.dataset.mode || null;
  const gameMode   = gameModeEl?.dataset.gamemode || gameModeEl?.dataset.mode || null;
  const maxPlayers = maxEl ? parseInt(maxEl.value) : null;
  const isPrivate  = privEl ? privEl.checked : null;
  const teamMode   = teamEl ? teamEl.checked : null;

  socket.emit("updateRoomSettings", {
    roomName,
    mode,
    gameMode,
    maxPlayers: isNaN(maxPlayers) ? null : maxPlayers,
    isPrivate,
    teamMode,
  });
  notify("⚙️ Pengaturan room diperbarui!", "success", 2000);
  console.log("[Settings] Applied:", { roomName, mode, gameMode, maxPlayers, isPrivate, teamMode });
}

// Inject host settings panel ke lobby screen
function injectHostSettingsPanel() {
  if (!isLobbyHost) return;
  if (document.getElementById("hostSettingsPanel")) return;
  const hostActions = document.getElementById("lobbyHostActions");
  if (!hostActions) return;

  const panel = document.createElement("div");
  panel.id = "hostSettingsPanel";
  panel.className = "host-settings-panel";
  panel.innerHTML = `
    <div class="host-settings-title">⚙️ PENGATURAN ROOM</div>
    <div class="host-settings-row">
      <label>Nama Room</label>
      <input id="hostSettingRoomName" type="text" maxlength="20" placeholder="Nama room..." 
             class="host-settings-input">
    </div>
    <div class="host-settings-row">
      <label>Maks Pemain</label>
      <input id="hostSettingMaxPlayers" type="number" min="1" max="8" value="8" class="host-settings-input small">
    </div>
    <div class="host-settings-row">
      <label>Mode Kesulitan</label>
      <div class="host-mode-row">
        <button class="host-mode-btn active" data-mode="easy">EASY</button>
        <button class="host-mode-btn" data-mode="medium">MEDIUM</button>
        <button class="host-mode-btn" data-mode="hard">HARD</button>
      </div>
    </div>
    <div class="host-settings-row">
      <label>Mode Permainan</label>
      <div class="host-mode-row">
        <button class="host-gamemode-btn active" data-gamemode="normal">🎮 NORMAL</button>
      </div>
    </div>
    <div class="host-settings-row">
      <label>Room Privat</label>
      <label class="toggle-switch" title="Sembunyikan dari Room Browser">
        <input type="checkbox" id="hostSettingPrivate">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="host-settings-row">
      <label>Mode Tim</label>
      <label class="toggle-switch" title="Aktifkan mode tim merah vs biru">
        <input type="checkbox" id="hostSettingTeamMode">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <button class="host-settings-apply-btn" onclick="applyHostRoomSettings()">✅ Terapkan Pengaturan</button>
  `;

  // Wire difficulty mode buttons
  panel.querySelectorAll(".host-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".host-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Wire game mode buttons
  panel.querySelectorAll(".host-gamemode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".host-gamemode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Init room name value
  const hostNameEl = panel.querySelector("#hostSettingRoomName");
  if (hostNameEl) hostNameEl.value = document.getElementById("lobbyRoomName")?.textContent || "";

  hostActions.insertBefore(panel, hostActions.firstChild);

  // Toggle show/hide via button
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "host-settings-toggle-btn";
  toggleBtn.innerHTML = "⚙️ Pengaturan Room";
  toggleBtn.addEventListener("click", () => {
    const isHidden = panel.style.display === "none" || !panel.style.display;
    panel.style.display = isHidden ? "" : "none";
    toggleBtn.textContent = isHidden ? "✕ Tutup Pengaturan" : "⚙️ Pengaturan Room";
  });
  panel.style.display = "none"; // hidden by default
  hostActions.insertBefore(toggleBtn, panel);
}

// ════════════════════════════════════════════════════════════════════════════
//  ★ FASE 1: PING UPDATE — Update badge ping per-member real-time
// ════════════════════════════════════════════════════════════════════════════
function updateMemberPingBadge(memberId, ping) {
  const badge = document.querySelector(`.lp-ping-badge[data-member-id="${memberId}"]`);
  if (!badge) return;

  const quality = ping === 0 ? "unknown" : ping < 50 ? "excellent" : ping < 100 ? "good" : ping < 200 ? "fair" : "poor";
  const colorMap = { excellent: "#00f5c4", good: "#39ff14", fair: "#ffd700", poor: "#ff3b5c", unknown: "#4a5568" };
  const color = colorMap[quality];
  const dot = badge.querySelector(".ping-dot");

  badge.style.color = color;
  badge.style.borderColor = color + "30";
  badge.style.background  = color + "12";
  if (dot) dot.style.background = color;

  // Update text (keep dot element)
  const label = ping > 0 ? ping + "ms" : "—";
  badge.lastChild.textContent = label;
}

// ════════════════════════════════════════════════════════════════════════════
//  ★ FASE 1: RECONNECT OVERLAY
// ════════════════════════════════════════════════════════════════════════════
let _reconnectOverlayEl = null;

function showReconnectOverlay(roomId) {
  if (_reconnectOverlayEl) return;
  const el = document.createElement("div");
  el.id = "reconnectOverlay";
  el.className = "reconnect-overlay";
  el.innerHTML = `
    <div class="reconnect-card">
      <div class="reconnect-spinner">🔄</div>
      <div class="reconnect-title">RECONNECTING...</div>
      <div class="reconnect-sub">Mencoba menyambung kembali ke room <strong>${roomId || "—"}</strong></div>
      <div class="reconnect-timer" id="reconnectTimerText">30 detik tersisa</div>
      <button class="reconnect-cancel-btn" onclick="cancelReconnect()">✕ Batalkan</button>
    </div>
  `;
  document.body.appendChild(el);
  _reconnectOverlayEl = el;
  requestAnimationFrame(() => el.classList.add("show"));

  // Countdown timer display (30 seconds grace)
  let secs = 30;
  const timerEl = el.querySelector("#reconnectTimerText");
  const timerInterval = setInterval(() => {
    secs--;
    if (timerEl) timerEl.textContent = secs + " detik tersisa";
    if (secs <= 0) clearInterval(timerInterval);
  }, 1000);
  el._timerInterval = timerInterval;
}

function hideReconnectOverlay() {
  if (!_reconnectOverlayEl) return;
  clearInterval(_reconnectOverlayEl._timerInterval);
  _reconnectOverlayEl.classList.remove("show");
  setTimeout(() => {
    if (_reconnectOverlayEl) { _reconnectOverlayEl.remove(); _reconnectOverlayEl = null; }
  }, 400);
}

function cancelReconnect() {
  hideReconnectOverlay();
  clearSessionToken();
  notify("Reconnect dibatalkan.", "warning", 2000);
}

// ════════════════════════════════════════════════════════════════════════════
//  ★ FASE 1: ROOM BROWSER — Fetch /api/rooms dan tampilkan panel
// ════════════════════════════════════════════════════════════════════════════

// ★ v8.0 NEW: Auto-refresh timer untuk room browser
let _roomBrowserRefreshTimer = null;

function startRoomBrowserAutoRefresh() {
  stopRoomBrowserAutoRefresh();
  _roomBrowserRefreshTimer = setInterval(() => {
    const panel = document.getElementById("roomBrowserPanel");
    // Hanya refresh jika panel visible
    if (panel && !panel.classList.contains("hidden")) {
      fetchAndShowRoomBrowser(true); // silent refresh (tanpa loading indicator)
    } else {
      stopRoomBrowserAutoRefresh();
    }
  }, 10000); // 10 detik
}

function stopRoomBrowserAutoRefresh() {
  if (_roomBrowserRefreshTimer) {
    clearInterval(_roomBrowserRefreshTimer);
    _roomBrowserRefreshTimer = null;
  }
}

async function fetchAndShowRoomBrowser(silent = false) {
  const panel = document.getElementById("roomBrowserPanel");
  if (!panel) return;
  if (!silent) panel.innerHTML = `<div class="rb-loading">⏳ Mencari room publik...</div>`;
  panel.classList.remove("hidden");
  // ★ v8.0: Mulai auto-refresh ketika browser dibuka
  startRoomBrowserAutoRefresh();

  try {
    const response = await fetch("/api/rooms");
    if (!response.ok) throw new Error("HTTP " + response.status);
    const rooms = await response.json();
    renderRoomBrowserList(rooms);
  } catch (err) {
    if (!silent) {
      panel.innerHTML = `<div class="rb-error">❌ Gagal memuat room: ${err.message}</div>
        <button class="rb-retry-btn" onclick="fetchAndShowRoomBrowser()">🔄 Coba Lagi</button>`;
    }
  }
}

function renderRoomBrowserList(rooms) {
  const panel = document.getElementById("roomBrowserPanel");
  if (!panel) return;

  const modeIcons = { easy: "🟢", medium: "🟡", hard: "🔴" };

  if (!rooms || rooms.length === 0) {
    panel.innerHTML = `
      <div class="rb-empty">
        <div class="rb-empty-icon">🏜️</div>
        <div>Tidak ada room publik aktif saat ini.</div>
        <div class="rb-empty-hint">Buat room baru atau tunggu orang lain masuk.</div>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="rb-header">
      <span>🌐 ${rooms.length} Room Publik Tersedia</span>
      <button class="rb-refresh-btn" onclick="fetchAndShowRoomBrowser()">🔄</button>
    </div>
    ${rooms.map(r => {
      const full = r.isFull;
      const modeIcon = modeIcons[r.mode] || "🎮";
      const pingColor = r.avgPing < 50 ? "#00f5c4" : r.avgPing < 150 ? "#ffd700" : "#ff3b5c";
      return `
      <div class="rb-room-row ${full ? 'full' : ''}" onclick="${full ? '' : `quickJoinToRoom('${r.id}')`}">
        <div class="rb-room-left">
          <div class="rb-room-name">${escapeHtml(r.name)}</div>
          <div class="rb-room-meta">
            ${modeIcon} ${r.mode.toUpperCase()} &nbsp;·&nbsp; 
            Host: ${escapeHtml(r.hostName)}
          </div>
        </div>
        <div class="rb-room-right">
          <div class="rb-room-players ${full ? 'full' : ''}">
            👥 ${r.playerCount}/${r.maxPlayers}
          </div>
          ${r.avgPing > 0 ? `<div class="rb-room-ping" style="color:${pingColor}">📶 ${r.avgPing}ms</div>` : ''}
          ${full ? '<div class="rb-room-full">PENUH</div>' : '<button class="rb-join-btn">JOIN</button>'}
        </div>
      </div>`;
    }).join("")}
  `;
}

// Masuk ke room dari browser
function quickJoinToRoom(roomId) {
  const nameEl = document.getElementById("usernameInputJoin");
  const nameVal = (nameEl?.value.trim()) || currentUsername || "";
  if (!nameVal) {
    notify("❌ Isi nama pemain dulu sebelum join!", "warning", 2500);
    return;
  }

  const color = document.querySelector("#colorGridJoin .color-swatch.active")?.dataset.color || "#00cfff";
  const mode  = document.querySelector(".mode-btn-j.active")?.dataset.mode || "easy";

  currentUsername = nameVal.substring(0, 12);
  selectedMainMode = "multi";
  saveUserData();
  initAudioContext();

  if (socket && socket.connected) {
    socket.emit("joinRoom", { username: currentUsername, color, mode, roomId });
    const statusEl = document.getElementById("connectStatus");
    if (statusEl) statusEl.textContent = "⏳ Bergabung ke room " + roomId + "...";
    // Hide browser panel
    const panel = document.getElementById("roomBrowserPanel");
    if (panel) panel.classList.add("hidden");
  } else {
    notify("⚠️ Socket belum terhubung. Tunggu sebentar lagi.", "warning", 2000);
  }
}

// Quick Join button — cari room otomatis atau buat baru
function triggerQuickJoin() {
  const nameEl = document.getElementById("usernameInputJoin");
  const nameVal = (nameEl?.value.trim()) || currentUsername || "";
  if (!nameVal) {
    notify("❌ Isi nama pemain dulu sebelum Quick Join!", "warning", 2500);
    nameEl?.focus();
    return;
  }
  currentUsername = nameVal.substring(0, 12);
  selectedMainMode = "multi";
  saveUserData();
  initAudioContext();

  const color = document.querySelector("#colorGridJoin .color-swatch.active")?.dataset.color || "#00cfff";
  const mode  = document.querySelector(".mode-btn-j.active")?.dataset.mode || "easy";

  const statusEl = document.getElementById("connectStatus");
  if (statusEl) statusEl.textContent = "⚡ Mencari room...";

  if (socket && socket.connected) {
    socket.emit("quickJoin", { username: currentUsername, color, mode });
  } else {
    notify("⚠️ Socket belum terhubung.", "warning", 2000);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  ★ FASE 1: LAN/CLOUD BADGE update di lobby header
// ════════════════════════════════════════════════════════════════════════════
function updateConnectionBadge(isCloud) {
  const badge = document.getElementById("connectionTypeBadge");
  if (!badge) return;
  if (isCloud) {
    badge.textContent = "☁️ CLOUD";
    badge.className = "connection-badge cloud";
  } else {
    badge.textContent = "📡 LAN";
    badge.className = "connection-badge lan";
  }
}

// Update server feature pills di lobby header
function updateServerFeaturePills(features) {
  const list = document.getElementById("serverFeatureList");
  if (!list || !features) return;
  const icons = {
    "lobby-v2":        "🏛️ Lobby v2",
    "token-reconnect": "🔌 Reconnect",
    "room-browser":    "🌐 Room Browser",
    "quick-join":      "⚡ Quick Join",
    "ping-rtt":        "📶 Ping RTT",
    "kick-player":     "👢 Kick",
  };
  list.innerHTML = features
    .filter(f => icons[f])
    .map(f => `<span class="server-feature-pill">${icons[f]}</span>`)
    .join("");
}

function showLobbyCountdown(num) {
  const overlay = document.getElementById("lobbyCountdown");
  const numEl   = document.getElementById("lobbyCountdownNum");
  if (!overlay || !numEl) return;
  overlay.classList.remove("hidden");
  // BUG FIX: Reset animasi sebelum set angka baru
  numEl.style.animation = "none";
  void numEl.offsetHeight; // force reflow
  numEl.textContent  = num;
  numEl.style.animation = "";
}

function hideLobbyCountdown() {
  const overlay = document.getElementById("lobbyCountdown");
  if (overlay) overlay.classList.add("hidden");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Lobby Button Handlers ──────────────────────────────────────────────────
// BUG FIX: Gunakan flag _wired untuk cegah double-binding
(function initLobbyButtons() {
  // ★ v8.0 FIX: Wire #quickJoinBtn (ada di HTML tapi tidak pernah di-wire di JS)
  const quickJoinBtnEl = document.getElementById("quickJoinBtn");
  if (quickJoinBtnEl && !quickJoinBtnEl._wired) {
    quickJoinBtnEl._wired = true;
    quickJoinBtnEl.addEventListener("click", triggerQuickJoin);
  }
  // Ready button (guest)
  const readyBtn = document.getElementById("lobbyReadyBtn");
  if (readyBtn && !readyBtn._wired) {
    readyBtn._wired = true;
    let isReady = false;
    readyBtn.addEventListener("click", () => {
      isReady = !isReady;
      readyBtn.classList.toggle("active", isReady);
      readyBtn.textContent = isReady ? "⏳ Batalkan" : "✅ SIAP BERMAIN";
      if (socket && socket.connected) socket.emit("playerReady", { isReady });
    });
  }

  // Start button (host)
  const startBtnLobby = document.getElementById("lobbyStartBtn");
  if (startBtnLobby && !startBtnLobby._wired) {
    startBtnLobby._wired = true;
    startBtnLobby.addEventListener("click", () => {
      if (socket && socket.connected) socket.emit("startMatch");
    });
  }

  // Leave lobby
  const leaveBtn = document.getElementById("lobbyLeaveBtn");
  if (leaveBtn && !leaveBtn._wired) {
    leaveBtn._wired = true;
    leaveBtn.addEventListener("click", () => {
      if (!confirm("Keluar dari lobby?")) return;
      if (socket && socket.connected && myRoomId) {
        socket.emit("exitGame");
      }
      hideLobbyScreen();
      myRoomId    = null;
      isLobbyHost = false;
      selectedMainMode = "single";
      startOverlay.classList.remove("hidden");
      transitionTo(STATE.START_SCREEN);
    });
  }

  // Lobby chat
  const chatSend  = document.getElementById("lobbyChatSend");
  const chatInput = document.getElementById("lobbyChatInput");
  function sendLobbyChat() {
    if (!chatInput) return;
    const msg = chatInput.value.trim();
    if (!msg) return;
    if (socket && socket.connected) socket.emit("lobbyChat", { message: msg });
    chatInput.value = "";
  }
  if (chatSend && !chatSend._wired)   { chatSend._wired = true;  chatSend.addEventListener("click", sendLobbyChat); }
  if (chatInput && !chatInput._wired) { chatInput._wired = true; chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendLobbyChat(); } }); }

  // Copy room code in lobby
  const copyBtn = document.getElementById("lobbyCopyBtn");
  if (copyBtn && !copyBtn._wired) {
    copyBtn._wired = true;
    copyBtn.addEventListener("click", () => {
      const code = document.getElementById("lobbyRoomCode")?.textContent;
      if (code && code !== "——") {
        navigator.clipboard.writeText(code).then(() => {
          copyBtn.textContent = "✅";
          setTimeout(() => copyBtn.textContent = "📋", 1500);
        }).catch(() => {});
      }
    });
  }

  // Room ID input uppercase
  const roomIdInput = document.getElementById("joinRoomIdInput");
  if (roomIdInput && !roomIdInput._wired) {
    roomIdInput._wired = true;
    roomIdInput.addEventListener("input", () => {
      const pos = roomIdInput.selectionStart;
      roomIdInput.value = roomIdInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      roomIdInput.setSelectionRange(pos, pos);
    });
  }

  // Host settings toggle
  const hsToggle = document.getElementById("hostSettingsToggle");
  if (hsToggle && !hsToggle._wired) {
    hsToggle._wired = true;
    hsToggle.addEventListener("click", () => {
      const body  = document.getElementById("hostSettingsBody");
      const arrow = hsToggle.querySelector(".toggle-arrow");
      if (body) { const isOpen = body.style.display !== "none"; body.style.display = isOpen ? "none" : ""; if (arrow) arrow.textContent = isOpen ? "▼" : "▲"; }
    });
  }

  // Host apply settings
  const applyBtn = document.getElementById("hostApplySettingsBtn");
  if (applyBtn && !applyBtn._wired) {
    applyBtn._wired = true;
    applyBtn.addEventListener("click", applyHostRoomSettings);
  }

  // Host setting mode buttons
  document.querySelectorAll(".hs-mode-btn").forEach(b => {
    if (!b._wired) { b._wired = true; b.addEventListener("click", () => { document.querySelectorAll(".hs-mode-btn").forEach(x => x.classList.remove("active")); b.classList.add("active"); }); }
  });
  document.querySelectorAll(".hs-gamemode-btn").forEach(b => {
    if (!b._wired) { b._wired = true; b.addEventListener("click", () => { document.querySelectorAll(".hs-gamemode-btn").forEach(x => x.classList.remove("active")); b.classList.add("active"); }); }
  });
})();

// ── Ghost Button (Saboteur poop send) ─────────────────────────────────────
// ★ v8.0 NEW: Wire #ghostBtn yang ada di index.html
(function initGhostButton() {
  const ghostBtnEl = document.getElementById("ghostBtn");
  if (!ghostBtnEl || ghostBtnEl._wired) return;
  ghostBtnEl._wired = true;
  ghostBtnEl.addEventListener("click", () => {
    if (!socket || !socket.connected || selectedMainMode !== "multi") return;
    if (currentState !== STATE.GAME_OVER) return; // Hanya aktif saat spectating (sudah mati)
    // Pilih target acak dari leaderboard
    const board = window._crownBoard || [];
    const alive = board.filter(p => p.id !== mySocketId && p.status !== "dead");
    if (alive.length === 0) { notify("Tidak ada lawan aktif untuk disabotase!", "warning", 2000); return; }
    const target = alive[Math.floor(Math.random() * alive.length)];
    socket.emit("sendPoop", { targetId: target.id });
    notify(`💩 Mengirim kotoran ke ${target.username}...`, "gold", 2000);
  });
})();
document.getElementById("startMultiBtn").addEventListener("click", async function() {
  const nameEl = document.getElementById("usernameInputMulti");
  const errEl  = document.getElementById("usernameErrorMulti");
  const nameVal = nameEl.value.trim();
  if (!nameVal) { errEl.textContent = "Nama Host wajib diisi!"; return; }
  errEl.textContent = "";

  currentUsername = nameVal.substring(0, 12);
  saveUserData();
  selectedMainMode = "multi";
  initAudioContext();

  const color    = document.querySelector("#colorGridMulti .color-swatch.active")?.dataset.color || "#00f5c4";
  const mode     = document.querySelector(".mode-btn-m.active")?.dataset.mode || "easy";
  const roomName = (document.getElementById("roomNameInput")?.value.trim()) || `${currentUsername}'s Room`;
  selectedMode   = mode;

  // Connect socket dengan benar — tunggu sampai benar-benar terhubung
  if (!socket || !socket.connected) {
    if (!socket) initSocket();
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Timeout koneksi")), 10000);
        // BUGFIX: jika sudah connected saat Promise dibuat, langsung resolve
        if (socket.connected) { clearTimeout(t); resolve(); return; }
        socket.once("connect", () => { clearTimeout(t); resolve(); });
        socket.once("connect_error", (e) => { clearTimeout(t); reject(e); });
      });
    } catch (err) {
      notify("⚠️ Tidak dapat terhubung ke server: " + err.message, "warning", 4000);
      return;
    }
  }

  if (socket && socket.connected) {
    socket.emit("createRoom", { username: currentUsername, color, mode, roomName });
  } else {
    notify("⚠️ Tidak dapat terhubung ke server. Pastikan server berjalan.", "warning", 4000);
  }
});

document.getElementById("joinServerBtn").addEventListener("click", async function() {
  const nameEl = document.getElementById("usernameInputJoin");
  const errEl  = document.getElementById("usernameErrorJoin");
  const nameVal = nameEl.value.trim();
  if (!nameVal) { errEl.textContent = "Nama Pemain wajib diisi!"; return; }
  errEl.textContent = "";

  const roomIdVal = (document.getElementById("joinRoomIdInput")?.value || "").trim().toUpperCase();
  if (!roomIdVal || roomIdVal.length < 4) {
    notify("❌ Masukkan kode room yang valid (4-6 karakter).", "warning", 3000);
    return;
  }

  const srvUrl = (document.getElementById("joinUrlInput")?.value || "").trim();
  const statusEl = document.getElementById("connectStatus");
  if (statusEl) { statusEl.textContent = "⏳ Menghubungkan..."; statusEl.className = "connect-status"; }

  currentUsername  = nameVal.substring(0, 12);
  selectedMainMode = "multi";
  saveUserData();
  initAudioContext();

  try {
    if (srvUrl) {
      // BUGFIX: connectToServer sudah tidak double-init, langsung await
      await connectToServer(srvUrl);
    } else {
      if (!socket || !socket.connected) {
        if (!socket) initSocket();
        // Tunggu hingga socket benar-benar terhubung
        // BUGFIX: jika socket sudah connected, langsung lanjut
        if (!socket.connected) {
          await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("Timeout koneksi")), 10000);
            if (socket.connected) { clearTimeout(t); resolve(); return; }
            socket.once("connect", () => { clearTimeout(t); resolve(); });
            socket.once("connect_error", (e) => { clearTimeout(t); reject(e); });
          });
        }
      }
    }

    if (!socket || !socket.connected) {
      if (statusEl) { statusEl.textContent = "❌ Gagal terhubung ke server."; statusEl.className = "connect-status error"; }
      return;
    }

    const color = document.querySelector("#colorGridJoin .color-swatch.active")?.dataset.color || "#00cfff";
    const mode  = document.querySelector(".mode-btn-j.active")?.dataset.mode || "easy";
    selectedMode = mode;
    socket.emit("joinRoom", { username: currentUsername, color, mode, roomId: roomIdVal });
    if (statusEl) { statusEl.textContent = "⏳ Bergabung ke room..."; }
  } catch (err) {
    if (statusEl) { statusEl.textContent = "❌ Tidak dapat terhubung: " + err.message; statusEl.className = "connect-status error"; }
    notify("❌ Koneksi gagal: " + err.message, "warning", 4000);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  18A. CROWN LEADERBOARD — Canvas Overlay
// ════════════════════════════════════════════════════════════════════════════
function drawCrownOverlay() {
  if (selectedMainMode !== "multi") return;
  const crownId = window._crownId;
  if (!crownId || crownId !== mySocketId) return;
  if (currentState !== STATE.PLAYING && currentState !== STATE.PAUSED) return;
  if (!snake || snake.length === 0) return;

  const now  = performance.now();
  const head = snake[0];
  const cx   = head.x + CELL / 2;
  const cy   = head.y;
  const floatY = cy - 12 + Math.sin(now * 0.004) * 3;

  ctx.save();
  ctx.font      = "14px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.shadowColor = "#ffd700";
  ctx.shadowBlur  = 12 + 4 * Math.sin(now * 0.006);
  ctx.fillStyle   = "#ffd700";
  ctx.fillText("👑", cx, floatY);
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
//  18B. QUICK CHAT SYSTEM
// ════════════════════════════════════════════════════════════════════════════
const QUICK_CHAT_PRESETS = [
  "GG!", "Nice!", "Nooo!", "Help!", "Watch Out!",
  "Good Luck!", "I'm Coming!", "😂", "😎", "🔥", "😱", "👑"
];

const _chatBubbles = new Map();

function showQuickChatBubble(socketId, username, message) {
  const old = _chatBubbles.get(socketId);
  if (old) { old.remove(); _chatBubbles.delete(socketId); }
  const bubble = document.createElement("div");
  bubble.className = "qc-bubble";
  bubble.innerHTML = `<span class="qc-name">${username}</span><span class="qc-msg">${message}</span>`;
  const lb = document.getElementById("leaderboardPanel");
  if (lb) {
    lb.appendChild(bubble);
  } else {
    document.body.appendChild(bubble);
    bubble.style.position = "fixed";
    bubble.style.top = "80px";
    bubble.style.right = "10px";
  }
  _chatBubbles.set(socketId, bubble);
  requestAnimationFrame(() => bubble.classList.add("show"));
  setTimeout(() => {
    bubble.classList.remove("show");
    setTimeout(() => { bubble.remove(); _chatBubbles.delete(socketId); }, 400);
  }, 3500);
}

function openQuickChatPanel() {
  if (document.getElementById("quickChatPanel")) { document.getElementById("quickChatPanel").remove(); return; }
  const panel = document.createElement("div");
  panel.id = "quickChatPanel";
  panel.className = "qc-panel";
  panel.innerHTML = `<div class="qc-title">💬 QUICK CHAT</div>
    <div class="qc-grid">${QUICK_CHAT_PRESETS.map(m =>
      `<button class="qc-btn" onclick="sendQuickChat('${m}')">${m}</button>`
    ).join("")}</div>`;
  document.getElementById("gameWrapper")?.appendChild(panel);
  panel._autoClose = setTimeout(() => panel.remove(), 5000);
}

function sendQuickChat(message) {
  if (socket && socket.connected && selectedMainMode === "multi") socket.emit("quickChat", { message });
  showQuickChatBubble(mySocketId, currentUsername, message);
  const panel = document.getElementById("quickChatPanel");
  if (panel) { clearTimeout(panel._autoClose); panel.remove(); }
}

function injectQuickChatButton() {
  if (document.getElementById("btnQuickChat")) return;
  const lb = document.getElementById("leaderboardPanel");
  if (!lb) return;
  const btn = document.createElement("button");
  btn.id = "btnQuickChat";
  btn.className = "qc-open-btn";
  btn.textContent = "💬 CHAT";
  btn.title = "Quick Chat";
  btn.addEventListener("click", openQuickChatPanel);
  lb.appendChild(btn);
}

// ════════════════════════════════════════════════════════════════════════════
//  18C. MATCH SUMMARY & POST-MATCH ANALYTICS
// ════════════════════════════════════════════════════════════════════════════
function requestMatchSummary() {
  if (socket && socket.connected && selectedMainMode === "multi") {
    socket.emit("requestMatchSummary");
  } else {
    const sessionSec = Math.floor((performance.now() - sessionStartTime) / 1000);
    showMatchSummaryModal({
      username:    currentUsername,
      finalScore:  score,
      finalRank:   null,
      totalPlayers: 1,
      stats: {
        applesEaten:      playerStats.applesEaten,
        goldCollected:    playerStats.goldCollected,
        bananasCollected: playerStats.bananasCollected,
        poopHits:         playerStats.poopHits,
        powerUpsUsed:     playerStats.powerUpsUsed,
        highestCombo:     playerStats.highestCombo,
        maxLevel:         playerStats.maxLevel,
        saboteurSent:     0, saboteurReceived: 0,
      },
      awards: [],
    });
  }
}

function showMatchSummaryModal(data) {
  const old = document.getElementById("matchSummaryModal");
  if (old) old.remove();

  const { username, finalScore, finalRank, totalPlayers, stats, awards } = data;
  const rankText = finalRank ? `#${finalRank} dari ${totalPlayers} Pemain` : "Single Player";
  const awardsHTML = awards && awards.length > 0
    ? `<div class="ms-awards">${awards.map(a =>
        `<div class="ms-award"><span>${a.icon}</span><span>${a.label}</span></div>`
      ).join("")}</div>`
    : "";

  const modal = document.createElement("div");
  modal.id = "matchSummaryModal";
  modal.className = "ms-modal";
  modal.innerHTML = `
    <div class="ms-card">
      <div class="ms-header">
        <span class="ms-title">📋 MATCH SUMMARY</span>
        <span class="ms-player">${username}</span>
        <span class="ms-rank">${rankText}</span>
      </div>
      <div class="ms-score-big">SKOR AKHIR: <span>${finalScore}</span></div>
      ${awardsHTML}
      <div class="ms-stats-grid">
        <div class="ms-stat"><span>🍎 Apel</span><span>${stats.applesEaten || 0}</span></div>
        <div class="ms-stat"><span>✨ Emas</span><span>${stats.goldCollected || 0}</span></div>
        <div class="ms-stat"><span>🍌 Pisang</span><span>${stats.bananasCollected || 0}</span></div>
        <div class="ms-stat"><span>💩 Kena Kotoran</span><span>${stats.poopHits || 0}</span></div>
        <div class="ms-stat"><span>🔥 Combo Maks</span><span>${stats.highestCombo || 0}x</span></div>
        <div class="ms-stat"><span>⚡ Power-Up</span><span>${stats.powerUpsUsed || 0}</span></div>
        <div class="ms-stat"><span>⭐ Level Maks</span><span>${stats.maxLevel || 1}</span></div>
        <div class="ms-stat"><span>👻 Saboteur Dikirim</span><span>${stats.saboteurSent || 0}</span></div>
        <div class="ms-stat"><span>🎯 Saboteur Diterima</span><span>${stats.saboteurReceived || 0}</span></div>
        <div class="ms-stat"><span>🏆 Best Score</span><span>${bestScore}</span></div>
      </div>
      <div class="ms-xp-row">+${calcSessionXP()} XP Diperoleh · Account Lv.${accountLevel}</div>
      <div class="ms-actions">
        ${myRoomId ? `<button class="ms-btn primary" onclick="closeSummaryAndRestart()">▶ MAIN LAGI</button>` : `<button class="ms-btn primary" onclick="closeSummaryAndRestart()">▶ MAIN LAGI</button>`}
        <button class="ms-btn" onclick="closeSummaryAndMenu()">🏠 MENU UTAMA</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("show"));
}

function closeSummaryAndRestart() {
  const m = document.getElementById("matchSummaryModal");
  if (m) { m.classList.remove("show"); setTimeout(() => m.remove(), 300); }
  restartGame();
}

function closeSummaryAndMenu() {
  const m = document.getElementById("matchSummaryModal");
  if (m) { m.classList.remove("show"); setTimeout(() => m.remove(), 300); }
  exitToMainMenu();
}
// ════════════════════════════════════════════════════════════════════════════
//  18. BOOTSTRAP
// ════════════════════════════════════════════════════════════════════════════
loadUserData();
loadStats();
loadXP();
loadAchievements();
applySnakeColor(snakeColor, snakeColorName);
updateBestUI();
buildProfilePanel();   // ★ injeksi UI profil ke start screen

if (usernameInput && currentUsername) usernameInput.value = currentUsername;

document.querySelectorAll(".color-swatch").forEach(s => {
  s.classList.toggle("active", s.dataset.color === snakeColor);
});
const dispEl = document.getElementById("colorNameDisplay");
if (dispEl) dispEl.textContent = snakeColorName;

const initMuteBtn = document.getElementById("btnMute");
if (initMuteBtn) initMuteBtn.textContent = globalMuted ? "🔇" : "🔊";

// ★ Inject power-up bar di bawah canvas / notifBar
(function injectPowerUpBar() {
  if (document.getElementById("powerUpBar")) return;
  const bar = document.createElement("div");
  bar.id = "powerUpBar";
  bar.className = "power-up-bar";
  const wrapper = document.getElementById("gameWrapper");
  const notif   = document.getElementById("notifBar");
  if (wrapper && notif) {
    notif.after(bar);
  } else if (wrapper) {
    wrapper.prepend(bar);
  }
})();

initColorPickers();
initAudioUI();
transitionTo(STATE.START_SCREEN);
initSocket();

// ── URL ?room=XXXX Auto-Join ─────────────────────────────────────────────
// Jika ada ?room=KODE di URL (misal dari QR code atau share link),
// langsung tampilkan panel JOIN dan isi kode roomnya.
// Auto-join sesungguhnya baru terjadi setelah user mengisi nama & klik JOIN,
// atau jika nama sudah tersimpan maka langsung auto-join.
(function handleRoomParam() {
  const params  = new URLSearchParams(window.location.search);
  const roomCode = (params.get("room") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!roomCode || roomCode.length < 4) return;

  // Isi field kode room di panel join
  const roomIdInput = document.getElementById("joinRoomIdInput");
  if (roomIdInput) roomIdInput.value = roomCode;

  // Pindah ke step multiplayer → tab JOIN
  selectedMainMode = "multi";
  stepMode.classList.remove("active");
  const stepMultiEl = document.getElementById("step-multi");
  if (stepMultiEl) stepMultiEl.classList.add("active");

  // Aktifkan tab JOIN
  document.querySelectorAll(".multi-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".multi-content").forEach(c => c.classList.remove("active"));
  const tabJoin   = document.getElementById("tabJoin");
  const panelJoin = document.getElementById("panelJoin");
  if (tabJoin)   tabJoin.classList.add("active");
  if (panelJoin) panelJoin.classList.add("active");
  activeMultiTab = "join";

  // Pre-fill nama jika sudah ada
  const nameInput = document.getElementById("usernameInputJoin");
  if (nameInput && currentUsername) nameInput.value = currentUsername;

  // Jika nama sudah tersimpan → auto-join langsung setelah socket connect
  if (currentUsername) {
    function tryAutoJoin() {
      if (!socket || !socket.connected) return;
      const color = document.querySelector("#colorGridJoin .color-swatch.active")?.dataset.color || "#00cfff";
      const mode  = document.querySelector(".mode-btn-j.active")?.dataset.mode || "easy";
      selectedMode = mode;
      selectedMainMode = "multi";
      socket.emit("joinRoom", { username: currentUsername, color, mode, roomId: roomCode });
      const statusEl = document.getElementById("connectStatus");
      if (statusEl) { statusEl.textContent = "⏳ Auto-join ke room " + roomCode + "..."; }
    }
    if (socket && socket.connected) {
      tryAutoJoin();
    } else {
      socket.once("connect", tryAutoJoin);
    }
  }

  // Bersihkan ?room= dari URL bar tanpa reload halaman
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
})();

// Idle animation di start screen
(function idleFrame() {
  if (currentState !== STATE.START_SCREEN && currentState !== STATE.INIT) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  const now = performance.now();
  const cx  = Math.floor(COLS / 2) * CELL;
  const cy  = Math.floor(ROWS / 2) * CELL;
  const col = snakeColor;

  for (let i = 5; i >= 0; i--) {
    const alpha = 0.25 + (5 - i) * 0.13;
    const pulse = 1 + 0.03 * Math.sin(now * 0.002 + i * 0.8);
    ctx.globalAlpha = alpha * pulse;
    const grad = ctx.createRadialGradient(cx - i * CELL + CELL / 2, cy + CELL / 2, 1, cx - i * CELL + CELL / 2, cy + CELL / 2, CELL * 0.6);
    grad.addColorStop(0, i === 0 ? "#ffffff" : col);
    grad.addColorStop(1, hexAlpha(col, 0.2));
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - i * CELL + 1, cy + 1, CELL - 2, CELL - 2, i === 0 ? 7 : 4);
    else ctx.rect(cx - i * CELL + 1, cy + 1, CELL - 2, CELL - 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  applyMatriksPikselCRT();
  requestAnimationFrame(idleFrame);
})();
// ════════════════════════════════════════════════════════════════════════════
//  SNAKE ARCADE v4.1 — FASE 1 UPGRADE PATCH
//  Tambahan: Ping RTT loop, Quick Chat improvements, Latency indicator,
//  Gamemode selector wiring, host-settings gameMode, better UI helpers
// ════════════════════════════════════════════════════════════════════════════

// ── PING RTT LOOP — kirim ping ke server setiap 2 detik ──────────────────
(function startPingLoop() {
  // Ping dikirim dari client ke server setiap 2 detik
  // Server balas "pongCheck" dan client hitung RTT
  function sendPing() {
    if (!socket || !socket.connected) return;
    const ts = Date.now();
    socket.emit("pingCheck", { ts });
  }

  // Mulai loop setelah socket terhubung (tunggu 1 detik pertama)
  let _pingTimer = null;
  function startLoop() {
    if (_pingTimer) return;
    _pingTimer = setInterval(sendPing, 2000);
  }
  function stopLoop() {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
  }

  // Hook ke socket connect/disconnect agar loop berjalan dengan benar
  const _origInitSocket = window.initSocket;
  // Gunakan MutationObserver tidak diperlukan — cukup poll socket connected state
  setInterval(() => {
    if (socket && socket.connected) {
      startLoop();
    } else {
      stopLoop();
    }
  }, 3000);

  // FIX: Tidak pasang listener pongCheck duplikat — sudah ada di bindSocketEvents.
  // updateLatencyIndicator dipanggil dari dalam handler pongCheck di bindSocketEvents.
  window._updateLatencyOnPing = function(rtt) {
    updateLatencyIndicator(rtt);
  };
})();

// ── LATENCY INDICATOR di header (in-game) ────────────────────────────────
function updateLatencyIndicator(rtt) {
  let el = document.getElementById("latencyIndicator");
  if (!el) {
    // Buat elemen jika belum ada
    const modeTagEl = document.getElementById("modeTag");
    if (!modeTagEl) return;
    el = document.createElement("span");
    el.id = "latencyIndicator";
    el.innerHTML = `<span class="lat-dot"></span><span id="latVal">—ms</span>`;
    modeTagEl.insertAdjacentElement("afterend", el);
  }
  const valEl = document.getElementById("latVal");
  if (valEl) valEl.textContent = rtt + "ms";
  el.className = "latency-indicator " + (rtt < 80 ? "good" : rtt < 150 ? "fair" : "poor");
}

// ── GAMEMODE SELECTOR wiring di host panel ────────────────────────────────
(function wireGameModeSelector() {
  function doWire() {
    document.querySelectorAll(".gamemode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".gamemode-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  }
  // Coba langsung, dan juga setelah DOM fully ready
  doWire();
  if (document.readyState !== "complete") {
    window.addEventListener("load", doWire);
  }
})();

// ── QUICK CHAT: Pesan server sudah termasuk dalam QUICK_CHAT_PRESETS ──────────
// FIXED: Override window.injectQuickChatButton dihapus karena menyebabkan
// panel quick chat dirender ulang dengan kelas CSS yang salah (.qc-msg-btn)
// Gunakan QUICK_CHAT_PRESETS yang sudah didefinisikan (sinkron dengan server).
const QUICK_CHAT_EXTENDED = [
  "GG!", "Nice move!", "Siap!", "Follow me!", "Waspada!",
  "Aku di kanan!", "Kumpul sini!",
  "Mantap!", "Ayo semangat!", "Hati-hati poop!",
];

// ── HELPER: sendQC (untuk onclick inline) ────────────────────────────────
window.sendQC = function(msg) {
  if (socket && socket.connected) {
    socket.emit("quickChat", { message: msg });
  }
  closeQuickChatPanel();
};

// ── CLOSE QUICK CHAT PANEL ────────────────────────────────────────────────
function closeQuickChatPanel() {
  const panel = document.querySelector(".qc-panel");
  if (panel) panel.classList.remove("open");
}

// ── GAMEMODE TAG UPDATE ───────────────────────────────────────────────────
function updateGameModeTag(gameMode) {
  const tag = document.getElementById("modeTag");
  if (!tag) return;
  if (selectedMainMode !== "multi") {
    tag.textContent = "SINGLE";
    tag.className   = "mode-tag";
    return;
  }
  const labels = { normal: "MULTI" };
  tag.textContent = labels[gameMode] || "MULTI";
  tag.className   = "mode-tag multi";
}

// ── SERVER FEATURE PILLS render ──────────────────────────────────────────
function renderServerFeaturePills(features) {
  const container = document.getElementById("serverFeatureList");
  if (!container || !features) return;
  container.innerHTML = features.slice(0, 6).map(f =>
    `<span class="sf-pill">✓ ${f}</span>`
  ).join("");
}

// ── LOBBY UPDATE EVENT listener patch ────────────────────────────────────
// FIXED: Handler lobbyUpdate sudah terintegrasi langsung di bindSocketEvents() di atas.
// Patch window.bindSocketEvents dihapus untuk mencegah listener ganda yang menyebabkan
// lobbyUpdate dieksekusi 2x per event.
// Logic gameMode tag, serverFeaturePills, connectionBadge sudah ada di handler utama.

// ── CONNECTION BADGE UPDATE — defined at line 3359, tidak perlu didefinisikan ulang ─

// ── LOBBY CHAT: enter key wiring sudah ada di initLobbyButtons() di atas ──────
// FIXED: Patch window.showLobbyScreen dihapus untuk mencegah double-binding.
// wire() sudah dipanggil di dalam initLobbyButtons() dengan flag _wired.

// ── TRIGGERQUICKJOIN (standalone fallback) ───────────────────────────────
// FIXED: Tidak perlu patch window.triggerQuickJoin — fungsi triggerQuickJoin
// sudah terdefinisi di atas dan tidak memerlukan override.
if (typeof window.triggerQuickJoin !== "function") {
  window.triggerQuickJoin = function() {
    if (!socket || !socket.connected) {
      notify("❌ Belum terhubung ke server!", "danger", 3000);
      return;
    }
    const name  = (document.getElementById("usernameInputJoin")?.value || currentUsername || "").trim();
    const color = document.querySelector("#colorGridJoin .color-swatch.active")?.dataset.color || "#00cfff";
    const mode  = document.querySelector(".mode-btn-j.active")?.dataset.mode || "easy";
    if (!name) { notify("❌ Isi nama terlebih dahulu!", "danger", 2000); return; }
    socket.emit("quickJoin", { username: name, color, mode });
    notify("⚡ Mencari room...", "gold", 2000);
  };
}

// ── ESCAPEHTML (ensure it's global) ──────────────────────────────────────
if (typeof window.escapeHtml !== "function") {
  window.escapeHtml = function(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };
}

// ── AUTO INIT AUDIO UI ─────────────────────────────────────────────────────
// Pastikan audio controls berfungsi dengan benar
(function ensureAudioUI() {
  const toggle = document.getElementById("audioToggle");
  if (toggle && !toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener("change", () => {
      const ctrls = document.getElementById("audioControls");
      if (ctrls) ctrls.classList.toggle("muted", !toggle.checked);
      globalMuted = !toggle.checked;
      if (globalMuted) { stopBGM(); bgmPlaying = false; }
      const btn = document.getElementById("btnMute");
      if (btn) btn.textContent = globalMuted ? "🔇" : "🔊";
      saveUserPrefs();
    });
    // Sync initial state
    toggle.checked = !globalMuted;
    const ctrls = document.getElementById("audioControls");
    if (ctrls) ctrls.classList.toggle("muted", globalMuted);
  }
})();

console.log("[Snake Arcade v8.0] Full Upgrade loaded ✅ — All bugs fixed, all features upgraded.");