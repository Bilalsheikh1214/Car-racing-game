(() => {
  "use strict";

  /* ============================================================
     TURBO RUSH — a 2D car racing game
     Dodge traffic, collect coins, use nitro, survive!
     ============================================================ */

  /* ---------- Canvas & DOM ---------- */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = (canvas.width = 480);
  const H = (canvas.height = 700);

  const ui = {
    score: document.getElementById("score"),
    speed: document.getElementById("speed"),
    coins: document.getElementById("coins"),
    best: document.getElementById("highscore"),
    boostFill: document.getElementById("boostFill"),
    startScreen: document.getElementById("startScreen"),
    pauseScreen: document.getElementById("pauseScreen"),
    overScreen: document.getElementById("overScreen"),
    finalScore: document.getElementById("finalScore"),
    finalStats: document.getElementById("finalStats"),
    newBest: document.getElementById("newBest"),
    startBtn: document.getElementById("startBtn"),
    resumeBtn: document.getElementById("resumeBtn"),
    restartBtn: document.getElementById("restartBtn"),
    soundBtn: document.getElementById("soundBtn"),
  };

  /* ---------- Utilities ---------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function overlap(a, b, inset = 0) {
    return (
      a.x + inset < b.x + b.w - inset &&
      a.x + a.w - inset > b.x + inset &&
      a.y + inset < b.y + b.h - inset &&
      a.y + a.h - inset > b.y + inset
    );
  }

  function hGap(a, b) {
    return Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  }

  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function loadBest() {
    try {
      return parseInt(localStorage.getItem("turboRushBest") || "0", 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(v) {
    try {
      localStorage.setItem("turboRushBest", String(v));
    } catch (e) {
      /* file:// or private mode — ignore */
    }
  }

  /* ---------- Road layout ---------- */
  const ROAD = { left: 64, right: W - 64 };
  const ROAD_W = ROAD.right - ROAD.left;
  const LANES = 4;
  const LANE_W = ROAD_W / LANES;
  const laneCenter = (i) => ROAD.left + LANE_W * i + LANE_W / 2;

  const CAR_COLORS = [
    "#ef4444", "#3b82f6", "#22c55e", "#eab308",
    "#a855f7", "#ec4899", "#14b8a6", "#f97316",
  ];

  const PLAYER_W = 46;
  const PLAYER_H = 88;
  const STEER_SPEED = 330;

  /* ---------- Sound (Web Audio API) ---------- */
  const Sound = {
    ctx: null,
    master: null,
    engine: null,
    muted: false,

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);

      // Engine: sawtooth osc -> lowpass -> gain
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 60;
      const filt = this.ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 300;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filt);
      filt.connect(gain);
      gain.connect(this.master);
      osc.start();
      this.engine = { osc, filt, gain };
    },

    resume() {
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },

    setEngine(active, speedNorm) {
      if (!this.engine || !this.ctx) return;
      const t = this.ctx.currentTime;
      const vol = active && !this.muted ? 0.055 : 0;
      this.engine.gain.gain.setTargetAtTime(vol, t, 0.12);
      this.engine.osc.frequency.setTargetAtTime(52 + speedNorm * 120, t, 0.1);
      this.engine.filt.frequency.setTargetAtTime(240 + speedNorm * 700, t, 0.1);
    },

    beep(freq, dur = 0.08, type = "square", vol = 0.14, delay = 0) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    coin() {
      this.beep(950, 0.06, "square", 0.12);
      this.beep(1450, 0.09, "square", 0.1, 0.06);
    },

    nearMiss() {
      this.beep(660, 0.05, "sawtooth", 0.07);
      this.beep(880, 0.06, "sawtooth", 0.06, 0.05);
    },

    crash() {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const len = 0.9;
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.setValueAtTime(1600, t);
      filt.frequency.exponentialRampToValueAtTime(120, t + len);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(filt);
      filt.connect(gain);
      gain.connect(this.master);
      src.start(t);
    },

    boost() {
      this.beep(180, 0.25, "sawtooth", 0.08);
      this.beep(360, 0.2, "sawtooth", 0.05, 0.05);
    },
  };

  /* ---------- Input ---------- */
  const keys = { left: false, right: false, up: false, down: false, boost: false };

  const KEY_MAP = {
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
    ArrowUp: "up", KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    Space: "boost",
  };

  document.addEventListener("keydown", (e) => {
    const action = KEY_MAP[e.code];
    if (action) {
      keys[action] = true;
      if (game.state === "playing") e.preventDefault();
    }
    if (e.code === "KeyP" || e.code === "Escape") {
      if (game.state === "playing") pauseGame();
      else if (game.state === "paused") resumeGame();
    }
    if (e.code === "KeyM") toggleMute();
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      if (game.state === "start") startGame();
      else if (game.state === "over" && !ui.overScreen.classList.contains("hidden")) startGame();
    }
  });

  document.addEventListener("keyup", (e) => {
    const action = KEY_MAP[e.code];
    if (action) keys[action] = false;
  });

  // Touch controls
  document.querySelectorAll(".touch-btn").forEach((btn) => {
    const action = btn.dataset.key;
    const press = (e) => { e.preventDefault(); keys[action] = true; };
    const release = (e) => { e.preventDefault(); keys[action] = false; };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  /* ---------- Game state ---------- */
  const game = {
    state: "start", // start | playing | paused | over
    time: 0,
    score: 0,
    coins: 0,
    dodged: 0,
    distance: 0,
    level: 1,
    worldSpeed: 260,
    roadOffset: 0,
    boost: 100,
    boosting: false,
    offRoad: false,
    shake: 0,
    spawnTimer: 1.2,
    coinTimer: 3.5,
    playerDead: false,
    aftermath: 0,
    best: loadBest(),
  };

  const player = {
    x: laneCenter(1) - PLAYER_W / 2,
    y: H - 155,
    w: PLAYER_W,
    h: PLAYER_H,
  };

  let enemies = [];
  let coins = [];
  let particles = [];
  let texts = [];

  /* ---------- Spawning ---------- */
  function spawnTraffic() {
    // Lanes blocked near the top (avoid impossible walls)
    const blocked = new Set();
    enemies.forEach((e) => {
      if (e.y < 170) blocked.add(e.lane);
    });
    const free = [0, 1, 2, 3].filter((l) => !blocked.has(l));
    if (free.length === 0) return;

    const lane = pick(free);
    const isTruck = game.level >= 2 && Math.random() < 0.18;
    const oncoming = !isTruck && game.level >= 3 && Math.random() < 0.16;

    let w, h, speedF;
    if (isTruck) {
      w = 54;
      h = 116;
      speedF = rand(0.5, 0.62); // slow lumbering truck
    } else {
      w = 46;
      h = 88;
      speedF = rand(0.42, 0.82); // relative speed (fraction of player speed)
    }

    enemies.push({
      type: isTruck ? "truck" : "car",
      lane,
      x: laneCenter(lane) - w / 2,
      y: -h - rand(0, 60),
      w,
      h,
      speedF,
      color: pick(CAR_COLORS),
      oncoming,
      changeTimer: rand(1.5, 4.5),
      targetLane: lane,
      passed: false,
    });
  }

  function spawnCoins() {
    const lane = randInt(0, LANES - 1);
    const count = randInt(3, 5);
    for (let i = 0; i < count; i++) {
      coins.push({
        x: laneCenter(lane),
        y: -40 - i * 52,
        r: 12,
        phase: rand(0, Math.PI * 2),
      });
    }
  }

  /* ---------- Particles & floating text ---------- */
  function addParticle(p) {
    particles.push(Object.assign({ life: 0.5, maxLife: 0.5, size: 3, vx: 0, vy: 0, grav: 0, color: "#fff" }, p));
  }

  function explosion(x, y) {
    for (let i = 0; i < 42; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(60, 340);
      addParticle({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.35, 0.85),
        size: rand(2, 5),
        color: pick(["#fbbf24", "#f97316", "#ef4444", "#fef08a"]),
        grav: 320,
      });
    }
    for (let i = 0; i < 14; i++) {
      addParticle({
        x: x + rand(-18, 18),
        y: y + rand(-24, 24),
        vx: rand(-50, 50),
        vy: rand(-140, -30),
        life: rand(0.6, 1.3),
        size: rand(8, 18),
        color: "rgba(80,80,80,0.55)",
        grav: -20,
      });
    }
  }

  function flamePuff() {
    addParticle({
      x: player.x + rand(6, player.w - 6),
      y: player.y + player.h - 6,
      vx: rand(-25, 25),
      vy: rand(240, 400),
      life: rand(0.15, 0.3),
      size: rand(4, 9),
      color: pick(["#fbbf24", "#f97316", "#fde68a"]),
    });
  }

  function smokePuff(x, y) {
    addParticle({
      x, y,
      vx: rand(-30, 30),
      vy: rand(120, 240),
      life: rand(0.4, 0.9),
      size: rand(5, 12),
      color: "rgba(200,200,200,0.35)",
      grav: -30,
    });
  }

  function addText(x, y, str, color) {
    texts.push({ x, y, str, color, life: 1.1, maxLife: 1.1 });
  }

  /* ---------- Game flow ---------- */
  function startGame() {
    Sound.init();
    Sound.resume();

    game.state = "playing";
    game.time = 0;
    game.score = 0;
    game.coins = 0;
    game.dodged = 0;
    game.distance = 0;
    game.level = 1;
    game.worldSpeed = 260;
    game.boost = 100;
    game.boosting = false;
    game.shake = 0;
    game.spawnTimer = 1.1;
    game.coinTimer = 3;
    game.playerDead = false;
    game.aftermath = 0;

    player.x = laneCenter(1) - PLAYER_W / 2;
    enemies = [];
    coins = [];
    particles = [];
    texts = [];

    ui.startScreen.classList.add("hidden");
    ui.pauseScreen.classList.add("hidden");
    ui.overScreen.classList.add("hidden");
    ui.newBest.classList.add("hidden");
  }

  function pauseGame() {
    game.state = "paused";
    ui.pauseScreen.classList.remove("hidden");
  }

  function resumeGame() {
    game.state = "playing";
    ui.pauseScreen.classList.add("hidden");
  }

  function gameOver() {
    game.state = "over";
    game.playerDead = true;
    game.aftermath = 1.1;
    game.shake = 16;
    Sound.crash();
    Sound.setEngine(false, 0);

    explosion(player.x + player.w / 2, player.y + player.h / 2);

    const finalScore = Math.floor(game.score);
    const isBest = finalScore > game.best;
    if (isBest) {
      game.best = finalScore;
      saveBest(finalScore);
    }
    ui.finalScore.textContent = finalScore.toLocaleString();
    ui.finalStats.textContent = `${game.coins} coins · ${game.dodged} cars dodged · top speed ${Math.round(game.worldSpeed * 0.55)} km/h`;
    ui.newBest.classList.toggle("hidden", !isBest);
  }

  function toggleMute() {
    Sound.muted = !Sound.muted;
    ui.soundBtn.textContent = Sound.muted ? "🔇" : "🔊";
    if (Sound.muted) Sound.setEngine(false, 0);
  }

  /* ---------- Update ---------- */
  function updatePlaying(dt) {
    const g = game;
    g.time += dt;

    /* speed & difficulty */
    g.distance += (g.worldSpeed * dt) / 10;
    g.level = Math.min(9, 1 + Math.floor(g.distance / 1600));
    const cruise = 260 + Math.min(300, g.distance / 11);

    /* nitro */
    const wantBoost = keys.boost && g.boost > 4 && !keys.down;
    if (wantBoost !== g.boosting && wantBoost) Sound.boost();
    g.boosting = wantBoost;
    if (g.boosting) {
      g.boost = Math.max(0, g.boost - 30 * dt);
      flamePuff();
      if (Math.random() < 0.7) flamePuff();
    } else {
      g.boost = Math.min(100, g.boost + 9 * dt);
    }

    /* steering */
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    player.x += dir * STEER_SPEED * dt;
    player.x = clamp(player.x, ROAD.left + 4, ROAD.right - 4 - player.w);

    g.offRoad = player.x < ROAD.left + 10 || player.x + player.w > ROAD.right - 10;

    /* throttle / brake / off-road target speed */
    let target = cruise * (keys.up ? 1.25 : keys.down ? 0.45 : 1);
    if (g.boosting) target *= 1.55;
    if (g.offRoad) target *= 0.55;
    g.worldSpeed += (target - g.worldSpeed) * Math.min(1, dt * 2.2);

    if (g.offRoad) {
      g.shake = Math.max(g.shake, 2.5);
      if (Math.random() < 0.5) smokePuff(player.x + player.w / 2 + rand(-14, 14), player.y + player.h);
    }

    /* road scroll */
    g.roadOffset = (g.roadOffset + g.worldSpeed * dt) % 1e6;

    /* score from distance */
    g.score += (g.worldSpeed * dt) / 28;

    /* spawning */
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      spawnTraffic();
      const interval = clamp(1.35 - g.level * 0.09, 0.42, 1.35);
      g.spawnTimer = interval * rand(0.75, 1.25);
    }
    g.coinTimer -= dt;
    if (g.coinTimer <= 0) {
      spawnCoins();
      g.coinTimer = rand(3.2, 6.5);
    }

    /* enemies */
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.y += (e.oncoming ? g.worldSpeed * 1.2 : g.worldSpeed * (1 - e.speedF)) * dt;

      // occasional lane change for normal traffic
      if (!e.oncoming && e.type === "car" && g.level >= 2) {
        e.changeTimer -= dt;
        if (e.changeTimer <= 0 && e.lane === e.targetLane) {
          const nxt = clamp(e.lane + pick([-1, 1]), 0, LANES - 1);
          const busy = enemies.some(
            (o) => o !== e && o.lane === nxt && Math.abs(o.y - e.y) < e.h + 90
          );
          if (nxt !== e.lane && !busy) e.targetLane = nxt;
          e.changeTimer = rand(2, 5);
        }
      }
      if (e.targetLane !== e.lane) {
        const tx = laneCenter(e.targetLane) - e.w / 2;
        e.x += clamp(tx - e.x, -70 * dt, 70 * dt);
        if (Math.abs(tx - e.x) < 2) {
          e.x = tx;
          e.lane = e.targetLane;
        }
      }

      /* near-miss bonus */
      if (!e.passed && e.y > player.y + player.h) {
        e.passed = true;
        g.dodged++;
        if (hGap(player, e) < 30) {
          g.score += 35;
          g.boost = Math.min(100, g.boost + 10);
          addText(player.x + player.w / 2, player.y - 6, "NEAR MISS +35", "#22d3ee");
          Sound.nearMiss();
        }
      }

      /* crash? */
      if (overlap(player, e, 8)) {
        gameOver();
        return;
      }

      if (e.y > H + 160) enemies.splice(i, 1);
    }

    /* coins */
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.y += g.worldSpeed * dt;
      c.phase += dt * 5;

      const box = { x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2 };
      if (overlap(player, box, 6)) {
        coins.splice(i, 1);
        g.coins++;
        g.score += 50;
        g.boost = Math.min(100, g.boost + 12);
        addText(c.x, c.y, "+50", "#fbbf24");
        Sound.coin();
        for (let k = 0; k < 8; k++) {
          const a = rand(0, Math.PI * 2);
          addParticle({
            x: c.x, y: c.y,
            vx: Math.cos(a) * rand(40, 130),
            vy: Math.sin(a) * rand(40, 130),
            life: rand(0.25, 0.5),
            size: rand(2, 4),
            color: "#fde047",
          });
        }
        continue;
      }
      if (c.y > H + 40) coins.splice(i, 1);
    }

    updateEffects(dt);

    /* engine sound */
    Sound.setEngine(true, clamp((g.worldSpeed - 200) / 700, 0, 1));

    updateHUD();
  }

  function updateAftermath(dt) {
    game.aftermath -= dt;
    // burning wreck (while the crash animation plays)
    if (game.aftermath > 0 && Math.random() < 0.9) {
      addParticle({
        x: player.x + rand(6, player.w - 6),
        y: player.y + rand(10, player.h - 10),
        vx: rand(-20, 20),
        vy: rand(-160, -60),
        life: rand(0.4, 0.9),
        size: rand(5, 12),
        color: pick(["#f97316", "#fbbf24", "rgba(70,70,70,0.6)"]),
        grav: -40,
      });
    }
    updateEffects(dt);
    if (game.aftermath <= 0 && ui.overScreen.classList.contains("hidden")) {
      ui.overScreen.classList.remove("hidden");
    }
  }

  function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt;
      t.y -= 45 * dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
    game.shake *= Math.exp(-6 * dt);
  }

  function updateHUD() {
    ui.score.textContent = Math.floor(game.score).toLocaleString();
    ui.speed.textContent = Math.round(game.worldSpeed * 0.55);
    ui.coins.textContent = game.coins;
    ui.best.textContent = Math.max(game.best, Math.floor(game.score)).toLocaleString();
    ui.boostFill.style.width = game.boost.toFixed(0) + "%";
  }

  /* ---------- Drawing ---------- */
  function drawGrass() {
    ctx.fillStyle = "#15803d";
    ctx.fillRect(0, 0, W, H);

    // scrolling mowed stripes
    const band = 64;
    const off = game.roadOffset % band;
    const startIdx = Math.floor(game.roadOffset / band);
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    for (let j = -1, y = -band + off; y < H; j++, y += band) {
      if ((startIdx + j) % 2 === 0) ctx.fillRect(0, y, W, band);
    }
  }

  function drawRoad() {
    // asphalt
    const grad = ctx.createLinearGradient(ROAD.left, 0, ROAD.right, 0);
    grad.addColorStop(0, "#22262e");
    grad.addColorStop(0.5, "#2b3038");
    grad.addColorStop(1, "#22262e");
    ctx.fillStyle = grad;
    ctx.fillRect(ROAD.left, 0, ROAD_W, H);

    // rumble strips (both edges)
    const rh = 26;
    const rOff = game.roadOffset % (rh * 2);
    const rStart = Math.floor(game.roadOffset / rh);
    for (let j = -1, y = -rh + rOff; y < H + rh; j++, y += rh) {
      ctx.fillStyle = (rStart + j) % 2 === 0 ? "#ef4444" : "#e5e7eb";
      ctx.fillRect(ROAD.left - 12, y, 12, rh);
      ctx.fillRect(ROAD.right, y, 12, rh);
    }

    // white edge lines
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(ROAD.left, 0, 4, H);
    ctx.fillRect(ROAD.right - 4, 0, 4, H);

    // dashed lane markers
    const dh = 40;
    const dOff = game.roadOffset % (dh * 2);
    const dStart = Math.floor(game.roadOffset / dh);
    for (let k = 1; k < LANES; k++) {
      const x = ROAD.left + LANE_W * k - 2;
      for (let j = -1, y = -dh + dOff; y < H + dh; j++, y += dh) {
        if ((dStart + j) % 2 === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.fillRect(x, y, 4, dh);
        }
      }
    }
  }

  function drawRoadside() {
    const spacing = 132;
    const off = game.roadOffset % spacing;
    const startIdx = Math.floor(game.roadOffset / spacing);
    for (let j = -1, y = -spacing + off; y < H + spacing; j++, y += spacing) {
      const side = (startIdx + j) % 2 === 0 ? 1 : -1;
      drawTree(30, y, 0.9 + ((startIdx + j) % 3) * 0.12);
      if (side === 1) drawLamp(W - 30, y + spacing / 2);
    }
  }

  function drawTree(x, y, s) {
    ctx.fillStyle = "#78350f";
    ctx.fillRect(x - 3, y, 6, 14 * s);
    ctx.fillStyle = "#166534";
    ctx.beginPath();
    ctx.arc(x, y - 6 * s, 15 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.arc(x - 5 * s, y - 11 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLamp(x, y) {
    ctx.fillStyle = "#334155";
    ctx.fillRect(x - 2, y - 34, 4, 34);
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(x, y - 36, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCarShape(x, y, w, h, color, opts = {}) {
    const { player: isPlayer = false, truck = false } = opts;

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2 + 5, w * 0.58, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // wheels
    ctx.fillStyle = "#0f172a";
    const wy1 = y + h * 0.16, wy2 = y + h * 0.68, wl = h * 0.18;
    ctx.fillRect(x - 4, wy1, 7, wl);
    ctx.fillRect(x + w - 3, wy1, 7, wl);
    ctx.fillRect(x - 4, wy2, 7, wl);
    ctx.fillRect(x + w - 3, wy2, 7, wl);

    // body
    const bodyH = truck ? h * 0.72 : h;
    const bodyY = truck ? y + h * 0.28 : y;
    const grad = ctx.createLinearGradient(x, bodyY, x, bodyY + bodyH);
    grad.addColorStop(0, lighten(color, 0.25));
    grad.addColorStop(0.45, color);
    grad.addColorStop(1, darken(color, 0.25));
    ctx.fillStyle = grad;
    roundRectPath(x, bodyY, w, bodyH, truck ? 5 : 10);
    ctx.fill();

    if (truck) {
      // cabin (front)
      ctx.fillStyle = darken(color, 0.12);
      roundRectPath(x + 2, y + h * 0.06, w - 4, h * 0.24, 7);
      ctx.fill();
      // windshield
      ctx.fillStyle = "#93c5fd";
      roundRectPath(x + w * 0.18, y + h * 0.09, w * 0.64, h * 0.1, 3);
      ctx.fill();
      // box seams
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + h * 0.55);
      ctx.lineTo(x + w - 4, y + h * 0.55);
      ctx.stroke();
    } else {
      // windshield + rear window
      ctx.fillStyle = "#93c5fd";
      roundRectPath(x + w * 0.16, y + h * 0.2, w * 0.68, h * 0.16, 4);
      ctx.fill();
      ctx.fillStyle = "#64748b";
      roundRectPath(x + w * 0.18, y + h * 0.62, w * 0.64, h * 0.13, 4);
      ctx.fill();
      // roof
      ctx.fillStyle = darken(color, 0.15);
      roundRectPath(x + w * 0.13, y + h * 0.38, w * 0.74, h * 0.22, 4);
      ctx.fill();
    }

    if (isPlayer) {
      // racing stripes
      ctx.fillStyle = "#dc2626";
      ctx.fillRect(x + w / 2 - 5, y + h * 0.05, 10, h * 0.9);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(x + w / 2 - 1.5, y + h * 0.05, 3, h * 0.9);
    }

    // headlights (front = top)
    ctx.fillStyle = "#fef3c7";
    roundRectPath(x + 4, y + 3, 9, 6, 3);
    ctx.fill();
    roundRectPath(x + w - 13, y + 3, 9, 6, 3);
    ctx.fill();

    // taillights
    ctx.fillStyle = "#f87171";
    roundRectPath(x + 3, y + h - 9, 10, 6, 3);
    ctx.fill();
    roundRectPath(x + w - 13, y + h - 9, 10, 6, 3);
    ctx.fill();
  }

  function lighten(hex, amt) {
    return shade(hex, Math.round(255 * amt));
  }
  function darken(hex, amt) {
    return shade(hex, -Math.round(255 * amt));
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255);
    const g = clamp(((n >> 8) & 0xff) + amt, 0, 255);
    const b = clamp((n & 0xff) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function drawEnemies() {
    enemies.forEach((e) => {
      if (e.oncoming) {
        // flip so headlights face the player
        ctx.save();
        ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
        ctx.scale(1, -1);
        ctx.translate(-(e.x + e.w / 2), -(e.y + e.h / 2));
        drawCarShape(e.x, e.y, e.w, e.h, e.color, { truck: false });
        ctx.restore();
        // headlight glow
        ctx.fillStyle = "rgba(255,255,200,0.25)";
        ctx.beginPath();
        ctx.ellipse(e.x + e.w / 2, e.y + e.h + 14, 22, 30, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        drawCarShape(e.x, e.y, e.w, e.h, e.color, { truck: e.type === "truck" });
      }
    });
  }

  function drawCoins() {
    coins.forEach((c) => {
      const sx = Math.abs(Math.cos(c.phase));
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(0.35 + sx * 0.65, 1);
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(0, 0, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(0, 0, c.r * 0.68, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b45309";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", 0, 1);
      ctx.restore();
    });
  }

  function drawPlayer() {
    if (game.playerDead) {
      // charred wreck
      drawCarShape(player.x, player.y, player.w, player.h, "#374151");
      return;
    }
    // nitro glow
    if (game.boosting) {
      ctx.fillStyle = "rgba(34,211,238,0.28)";
      ctx.beginPath();
      ctx.ellipse(player.x + player.w / 2, player.y + player.h + 12, 26, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // tilt when steering
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    ctx.save();
    ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
    ctx.rotate(dir * 0.06);
    ctx.translate(-player.w / 2, -player.h / 2);
    drawCarShape(0, 0, player.w, player.h, "#f8fafc", { player: true });
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawTexts() {
    ctx.textAlign = "center";
    ctx.font = "bold 17px 'Segoe UI', sans-serif";
    texts.forEach((t) => {
      ctx.globalAlpha = clamp(t.life / t.maxLife, 0, 1);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    });
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSpeedLines() {
    if (game.worldSpeed < 430 || game.state !== "playing") return;
    const intensity = clamp((game.worldSpeed - 430) / 400, 0, 1);
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + intensity * 0.12})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const x = rand(ROAD.left, ROAD.right);
      const y = rand(0, H);
      const len = 30 + intensity * 70;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }
  }

  function render() {
    ctx.save();
    if (game.shake > 0.3) {
      ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
    }

    drawGrass();
    drawRoad();
    drawRoadside();
    drawCoins();
    drawEnemies();
    drawParticles();
    drawPlayer();
    drawTexts();
    drawSpeedLines();
    drawVignette();

    ctx.restore();

    // level flash
    if (game.state === "playing" && game.time < 1.4) {
      ctx.globalAlpha = clamp(1.4 - game.time, 0, 1);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "italic 800 42px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("GO!", W / 2, H / 2 - 40);
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- Attract mode (idle on start screen) ---------- */
  let demoX = laneCenter(2) - PLAYER_W / 2;
  let demoDir = 1;
  function updateIdle(dt) {
    game.roadOffset = (game.roadOffset + 220 * dt) % 1e6;
    demoX += demoDir * 90 * dt;
    if (demoX < ROAD.left + 10 || demoX > ROAD.right - 10 - PLAYER_W) demoDir *= -1;
    player.x = demoX;
    game.worldSpeed = 220;
    updateEffects(dt);
  }

  /* ---------- Main loop ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (game.state === "playing") updatePlaying(dt);
    else if (game.state === "over") updateAftermath(dt);
    else if (game.state === "start") updateIdle(dt);

    render();
    requestAnimationFrame(frame);
  }

  /* ---------- Wire up UI ---------- */
  ui.startBtn.addEventListener("click", startGame);
  ui.restartBtn.addEventListener("click", startGame);
  ui.resumeBtn.addEventListener("click", resumeGame);
  ui.soundBtn.addEventListener("click", () => {
    Sound.init();
    Sound.resume();
    toggleMute();
  });

  ui.best.textContent = game.best.toLocaleString();
  updateHUD();
  requestAnimationFrame(frame);
})();
