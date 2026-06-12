# 🐍 Snake Arcade v4.1 — Fase 1 Full Upgrade

**PjBL Grafika Komputer · D3 Teknik Informatika · POLNEP**

## 📦 Struktur Folder

```
snake-game-v4/
├── public/
│   ├── assets/audio/       ← Taruh BGM & SFX di sini (lihat README di dalamnya)
│   ├── game.js             ← Logika lengkap + Fase 1 Upgrade Patch
│   ├── index.html          ← Layout UI lengkap
│   └── style.css           ← Tema Cyberpunk Arcade + Fase 1 CSS
├── scripts/
│   └── matrix-telemetry.js ← Stress-test FPS/latency di browser console
├── server.js               ← Express + Socket.io (8 pemain)
├── package.json
├── vercel.json
└── README.md               ← (file ini)
```

## 🚀 Cara Menjalankan

### 1. Install dependensi (WAJIB pertama kali)
```bash
npm install
```

### 2. Jalankan server lokal
```bash
npm start
```

Buka browser: **http://localhost:3000**

### 3. Akses LAN (untuk teman sekelas)
Server akan mencetak URL LAN di terminal, misalnya:
```
➜ LAN : http://192.168.1.x:3000
```
Teman bisa buka URL tersebut di browser mereka untuk join multiplayer.

---

## ❓ Socket.io: Apakah perlu download manual?

**Tidak perlu!** Socket.io diinstall otomatis lewat `npm install`.

File `socket.io.js` yang dibutuhkan browser **disajikan otomatis** oleh server melalui route `/socket.io/socket.io.js`. Ini sudah ditangani oleh library socket.io di Node.js — kamu tidak perlu mendownload atau menyalin file apapun secara manual.

Cukup:
1. `npm install` (sekali saja)
2. `npm start`
3. Buka browser → game siap!

---

## ✨ Fitur Fase 1 (Semua Terupgrade)

| Fitur | Status |
|-------|--------|
| Lobby System v2 — Ping badge, ready glow, snake color dot | ✅ Done |
| Token Reconnect v2 — Auto-reconnect overlay, grace timer 30s | ✅ Done |
| Multi-Method Join — Room Browser, Quick Join button | ✅ Done |
| LAN + Online Unified — LAN/Cloud badge, latency indicator real-time | ✅ Done |
| Host Control Panel — Kick player, update settings, host migration | ✅ Done |
| pingUpdate handler — Update badge ping per-member real-time | ✅ Done |
| Boss Engine FSM — Server-authoritative predictive AI, 10Hz tick | ✅ Done |
| Ranked Elo — K=32 approximation (SQLite opsional, RAM fallback) | ✅ Done |
| Quick Chat + Lobby Chat — Anti-spam, 80 char limit, enter to send | ✅ Done |
| Match Summary Modal — Stats lengkap, XP award | ✅ Done |
| Achievement System — 20+ achievement, popup notifikasi | ✅ Done |
| Account XP & Level — Level 1–10, title progression | ✅ Done |
| Power-Up System — Shield, Magnet, Double Score, Slow Motion | ✅ Done |
| Snake Color Picker — 11 warna + custom hex | ✅ Done |
| Audio Pipeline v5 — BGM loop, 10 SFX synth, volume control | ✅ Done |

## 🔧 Matrix Telemetry (Debug Tool)

Buka browser DevTools Console saat game berjalan, lalu:

```javascript
// Muat script
// Jalankan di konsol setelah halaman game terbuka:
MatrixTelemetry.start()   // Mulai monitoring FPS & network
MatrixTelemetry.stop()    // Hentikan
MatrixTelemetry.snapshot() // Ambil snapshot sekali
```

Script ini ada di `scripts/matrix-telemetry.js` — copy-paste isinya ke console.

## 🎵 Audio Assets

Lihat `public/assets/audio/README.md` untuk panduan menambahkan file audio.
Tanpa file audio, game tetap berjalan dengan fallback synth Web Audio API.

## 🌐 Deploy ke Vercel / Render / Railway

File `vercel.json` sudah dikonfigurasi. Cukup:
1. Push ke GitHub
2. Import di Vercel → deploy otomatis
3. Set environment variable `PUBLIC_URL` ke URL deploy kamu (opsional)
