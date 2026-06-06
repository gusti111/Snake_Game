// ============================================================================
// scripts/matrix-telemetry.js — v5.0 Engineering Edition
// Alat Stress-Test Komparatif: Profiling Render Loop & Telemetri Latensi Jaringan
// Jalankan langsung pada Browser DevTools Console saat sesi game aktif
// ============================================================================

"use strict";

(function AdvancedMatrixTelemetry() {
  // ── 1. CONFIGURATION MATRICES (CIRCULAR BUFFER WINDOW)
  const BUFFER_SIZE  = 120;  // Ukuran sampel (2 detik pada refresh-rate 60Hz)
  const LOG_INTERVAL = 3000; // Interval cetak laporan dalam milidetik (3 detik)

  // ── 2. STATE STORAGE ALLOCATION (FIXED MEMORY PROFILE)
  // Menggunakan array alokasi tetap untuk memotong beban kerja Garbage Collector (GC)
  const frameTimestamps = new Float64Array(BUFFER_SIZE);
  const renderLatencies = new Float64Array(BUFFER_SIZE);
  const networkDeltas   = new Float64Array(BUFFER_SIZE);

  let frameIndex   = 0;
  let renderIndex  = 0;
  let networkIndex = 0;
  
  let lastPacketTimestamp = 0;
  let reportTimer         = null;
  let telemetryActive     = false;

  // Backup pointer internal browser asli
  const originalRAF = window.requestAnimationFrame.bind(window);
  let originalSocketOn = null;

  // ── 3. CORE ANALYTICAL MATHEMATICS
  const mathMath = {
    avg: (typedArray) => {
      let sum = 0, count = 0;
      for (let i = 0; i < typedArray.length; i++) {
        if (typedArray[i] > 0) { sum += typedArray[i]; count++; }
      }
      return count === 0 ? 0 : sum / count;
    },
    max: (typedArray) => {
      let max = 0;
      for (let i = 0; i < typedArray.length; i++) {
        if (typedArray[i] > max) max = typedArray[i];
      }
      return max;
    },
    jitter: (typedArray, avgValue) => {
      let sumDeviation = 0, count = 0;
      for (let i = 0; i < typedArray.length; i++) {
        if (typedArray[i] > 0) {
          sumDeviation += Math.abs(typedArray[i] - avgValue);
          count++;
        }
      }
      return count === 0 ? 0 : sumDeviation / count;
    },
    calculateFPS: () => {
      let count = 0;
      let minTs = Infinity, maxTs = -Infinity;
      for (let i = 0; i < frameTimestamps.length; i++) {
        if (frameTimestamps[i] > 0) {
          count++;
          if (frameTimestamps[i] < minTs) minTs = frameTimestamps[i];
          if (frameTimestamps[i] > maxTs) maxTs = frameTimestamps[i];
        }
      }
      if (count < 2 || maxTs <= minTs) return 0;
      return ((count - 1) / (maxTs - minTs) * 1000);
    }
  };

  // ── 4. LOW-LEVEL INJECTION PIPELINE (HOOK ENGINE)
  function injectPerformanceHooks() {
    // A. Interseptor Grafik Render Loop
    window.requestAnimationFrame = function(callback) {
      return originalRAF(function(timestamp) {
        const t0 = performance.now();
        callback(timestamp);
        const deltaRender = performance.now() - t0;

        // Injeksi indeks siklik ke memori array tetap
        renderLatencies[renderIndex] = deltaRender;
        renderIndex = (renderIndex + 1) % BUFFER_SIZE;

        frameTimestamps[frameIndex] = timestamp;
        frameIndex = (frameIndex + 1) % BUFFER_SIZE;
      });
    };

    // B. Interseptor Jaringan Soket Terdistribusi (Socket.io Network Sniffer)
    if (window.socket && window.socket.on && !originalSocketOn) {
      originalSocketOn = window.socket.on.bind(window.socket);
      window.socket.on = function(event, callback) {
        if (event === "gameStateSync") {
          return originalSocketOn(event, function(data) {
            const now = performance.now();
            if (lastPacketTimestamp > 0) {
              const deltaPacket = now - lastPacketTimestamp;
              networkDeltas[networkIndex] = deltaPacket;
              networkIndex = (networkIndex + 1) % BUFFER_SIZE;
            }
            lastPacketTimestamp = now;
            callback(data);
          });
        }
        return originalSocketOn(event, callback);
      };
      console.log("[Telemetry] Socket.io network sniffer successfully bound.");
    }
  }

  // ── 5. METRIC DASHBOARD GENERATOR (DIALECTICAL COMPARISON)
  function generateEngineReport() {
    const currentFPS   = mathMath.calculateFPS();
    const avgRenderMs  = mathMath.avg(renderLatencies);
    const maxRenderMs  = mathMath.max(renderLatencies);
    
    const avgNetworkMs = mathMath.avg(networkDeltas);
    const maxNetworkMs = mathMath.max(networkDeltas);
    const networkJitter= mathMath.jitter(networkDeltas, avgNetworkMs);

    // Ambil data status internal sandbox dari window scope
    const fsmState   = window.currentState   || "N/A";
    const localScore = window.score          ?? "N/A";
    const level      = window.levelIndex     != null ? window.levelIndex + 1 : "N/A";
    const snakeLen   = window.snake          ? window.snake.length : "N/A";
    const particles  = window.particles      ? window.particles.length : "N/A";

    console.groupCollapsed(
      `%c[MATRIX TELEMETRY] ── ${new Date().toLocaleTimeString()} ── FPS: ${currentFPS.toFixed(1)} ── JITTER: ${networkJitter.toFixed(1)}ms`,
      "color: #00f5c4; font-weight: bold; background: #070720; padding: 4px 8px; border: 1px solid #00f5c4; border-radius: 4px;"
    );

    console.log("%c HARDWARE METRICS (GRAFIKA REKAYASA):", "color: #00cfff; font-weight: bold;");
    console.table({
      "Frames Per Second (FPS)": { Value: currentFPS.toFixed(1) + " Hz", Threshold: ">= 58 Hz Target" },
      "Average Render Execution": { Value: avgRenderMs.toFixed(3) + " ms", Threshold: "< 16.6 ms (60FPS Barrier)" },
      "Peak Render Execution (Spike)": { Value: maxRenderMs.toFixed(3) + " ms", Threshold: "Danger if > 33ms" }
    });

    console.log("%c NETWORK METRICS (TOPOLOGI MULTIPLAYER SERVER-AUTHORITATIVE):", "color: #ffd700; font-weight: bold;");
    console.table({
      "Average Sync Packet Interval": { Value: avgNetworkMs.toFixed(1) + " ms", Threshold: "~33ms Server Engine Rate" },
      "Peak Network Packet Lag (Spike)": { Value: maxNetworkMs.toFixed(1) + " ms", Threshold: "Warning if > 100ms" },
      "Network Delivery Jitter": { Value: networkJitter.toFixed(2) + " ms", Threshold: "< 5ms (Stable Local Routing)" }
    });

    console.log("%c SANDBOX STATE METRICS:", "color: #ff3b5c; font-weight: bold;");
    console.log(`  Engine FSM State : %c${fsmState}`, "color: #fff; font-weight: bold;");
    console.log(`  Real Game Score  : ${localScore}  |  Current Level: ${level}`);
    console.log(`  Matrix Entities  : Snake Size: ${snakeLen} nodes  |  Active Particles: ${particles}`);
    
    // EVALUASI MANAJEMEN RISIKO DAN ANALISIS AMBANG BATAS KRITIS
    if (currentFPS < 55) {
      console.warn("%c[RISK ALERT] ⚠️ Frame rate terdeteksi anjlok. Pipeline render terhambat GPU throttle.", "color: #ff8c00; font-weight: bold;");
    }
    if (networkJitter > 10) {
      console.warn("%c[NETWORK ALERT] ⚠️ Jitter jaringan tinggi! Detak Wi-Fi router mengalami kehilangan paket (Packet Drop).", "color: #ff8c00; font-weight: bold;");
    }

    console.groupEnd();
  }

  // ── 6. GLOBAL SUBSISTEM API EXPOSURE
  window.MatrixTelemetry = {
    start() {
      if (telemetryActive) { console.log("[Telemetry] Engine pemantau sudah aktif."); return; }
      injectPerformanceHooks();
      
      // Bersihkan alokasi memori buffer lama sebelum menulis
      frameTimestamps.fill(0);
      renderLatencies.fill(0);
      networkDeltas.fill(0);
      
      reportTimer = setInterval(generateEngineReport, LOG_INTERVAL);
      telemetryActive = true;
      console.log("%c[Telemetry] ✅ Jaringan Telemetri v5.0 Aktif. Analisis komparatif berjalan tiap 3 dtk.", "color: #00f5c4; font-weight: bold;");
    },
    stop() {
      if (!telemetryActive) return;
      clearInterval(reportTimer);
      window.requestAnimationFrame = originalRAF;
      telemetryActive = false;
      console.log("[Telemetry] Subsistem dinonaktifkan. Pointer rAF dikembalikan ke kondisi native.");
    },
    snapshot() { generateEngineReport(); }
  };

  console.log(
    "%c[Telemetry] Matrix Telemetry v5.0 (Server-Authoritative Compliant) Engine Loaded.\n" +
    "  Execute: %cMatrixTelemetry.start()%c -> Mengaktifkan pemantauan real-time.\n" +
    "  Execute: %cMatrixTelemetry.stop()%c  -> Menonaktifkan telemetri.",
    "color: #00f5c4; font-weight: bold;",
    "color: #fff; font-weight: bold; background: #222; padding: 2px 4px;", "color: #00f5c4;",
    "color: #fff; font-weight: bold; background: #222; padding: 2px 4px;", "color: #00f5c4;"
  );
})();