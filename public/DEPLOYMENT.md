# Snake Arcade v8.0 — Deployment Guide

## Struktur File yang Diubah

```
snake-game-v4/
├── public/
│   ├── game.js      ← ✅ UPDATED — Lobby System client
│   ├── index.html   ← ✅ UPDATED — Lobby Screen UI
│   └── style.css    ← ✅ UPDATED — Lobby CSS
├── server.js        ← ✅ UPDATED — Lobby FSM + Room Persistence
├── package.json
└── vercel.json
```

---

## 🖥️ Jalankan Lokal (LAN / Localhost)

```bash
npm install
npm start
# Buka: http://localhost:3000
# Kawan di jaringan yang sama: http://<IP-LAN>:3000
```

---

## ☁️ Deploy ke Railway (Rekomendasi — Free Tier)

1. Push semua file ke GitHub repo
2. Buka https://railway.app → New Project → Deploy from GitHub
3. Pilih repo → Railway otomatis detect `server.js`
4. Di Settings → Environment Variables, tambahkan:
   ```
   PUBLIC_URL = https://<nama-app>.railway.app
   PORT       = 3000
   ```
5. Deploy → Dapatkan URL publik
6. Semua pemain tinggal buka URL tersebut dari browser manapun

## ☁️ Deploy ke Render (Alternatif — Free Tier)

1. https://render.com → New Web Service → Connect GitHub
2. Build Command: `npm install`
3. Start Command: `node server.js`
4. Environment Variables:
   ```
   PUBLIC_URL = https://<nama-app>.onrender.com
   PORT       = 10000
   ```

## ☁️ Deploy ke Fly.io

```bash
fly launch     # ikuti wizard
fly deploy
fly secrets set PUBLIC_URL=https://<app-name>.fly.dev
```

---

## 🎮 Alur Lobby System v8.0

```
Host                              Guest
  │                                 │
  ├─[Buat Room]                     │
  ├─→ roomCreated {roomId}          │
  ├─→ Lobby Screen muncul           │
  │   - QR Code                     │
  │   - Kode Room (6 karakter)      │
  │                                 │
  │        [Masukkan Kode Room]────►│
  │              joinRoom───────────┤
  │                    roomApproved─┤
  │                  Lobby Screen───┤
  │                                 │
  │◄── lobbyUpdate (member list) ──►│
  │◄── playerJoined notif ─────────►│
  │                                 │
  │              [Tekan SIAP]───────┤
  │◄── playerReadyChange ──────────►│
  │                                 │
  ├─[Tombol MULAI aktif]            │
  ├─→ startMatch                    │
  ├─→ matchCountdown (3-2-1)───────►│
  ├─→ matchStart ──────────────────►│
  │                                 │
  │    === PERTANDINGAN BERJALAN === │
  │                                 │
  │◄── leaderboardLiveUpdate ──────►│
  │                                 │
  ├─→ matchFinished ───────────────►│
  ├─→ matchSummaryData ────────────►│
  │                                 │
  ├─→ returnedToLobby (8 dtk) ─────►│
  │    [Kembali ke Lobby]            │
```

---

## 🔒 Fitur Keamanan & Ketahanan

| Fitur | Detail |
|-------|--------|
| Room ID unik | 6 karakter alphanumeric, tidak bisa collision |
| Whitelist chat | Quick Chat hanya dari preset yang diizinkan |
| Cooldown chat | 2.5 detik antara pesan |
| Reconnect grace | 20 detik sebelum slot dilepas |
| Auto host migration | Host baru otomatis jika host disconnect |
| Room cleanup | Room dihapus saat semua pemain keluar |
| CORS | `*` untuk development; restrict ke domain kamu di production |

---

## 📱 Responsif

- Mobile (≤400px): layout stack vertikal, tombol besar
- Tablet (768px+): lobby max 600px, chat lebih tinggi  
- Desktop: centered, max 600px wide, lebih banyak ruang

