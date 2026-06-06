# Audio Assets — Snake Arcade v4.0

Letakkan file audio berikut di folder ini:

| Nama File              | Deskripsi                                      | Format  |
|------------------------|------------------------------------------------|---------|
| `bgm_retro_8bit.mp3`   | Musik latar (BGM) loop tema arcade retro 8-bit | MP3/OGG |
| `sfx_eat_normal.wav`   | Efek suara saat makan Apel Merah (+1 poin)     | WAV/MP3 |
| `sfx_eat_bonus.wav`    | Efek suara saat makan Buah Emas/Pisang Super   | WAV/MP3 |
| `sfx_fail_penalty.wav` | Efek suara saat makan Kotoran / nyawa berkurang| WAV/MP3 |

## Sumber Audio Gratis

- https://freesound.org — cari "8-bit game", "retro eat", "fail buzz"
- https://opengameart.org — koleksi game audio CC0
- https://pixabay.com/sound-effects — no-attribution

## Mengaktifkan Audio

Buka `public/game.js` dan uncomment blok AUDIO di bagian initAudioContext().
Tanpa file audio, game tetap berfungsi normal dengan fallback beep Web Audio API.
