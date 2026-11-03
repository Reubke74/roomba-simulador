/* Simulador de aspiradora robot SIN inteligencia artificial.
 * Solo reglas fijas (máquinas de estados), sensores de choque y azar.
 * Rejilla: 1 celda = 10 cm. Dos habitaciones unidas por una puerta de 80 cm.
 */
(function (root) {
  'use strict';

  const W = 102, H = 40, WALL_X = 60, WALL_T = 2;
  const V = 0.3;            // celdas por paso  -> 0.3 m/s con DT = 0.1 s
  const DT = 0.1;           // s por paso
  const TURN = 0.2;         // rad por paso -> 2 rad/s
  const R = 1.75, R2 = R * R;   // radio de la boquilla/cuerpo en celdas
  const CELL_M = 0.1;
  const RECENT = 30;        // pasos: dentro de esta ventana no cuenta como "nueva pasada"
  const POWER = { base: 3, brush: 10, drive: 5, turn: 3, ai: 3 };   // W (ai: láser + procesador)
  const BATTERY_WH = 30;
  const TARGET = 0.95;
  const DOCK = { x: 4.5, y: 30.5 };
  const DOOR = [16, 24];    // filas libres en el muro (8 celdas = 80 cm)

  const FURNITURE = [
    { n: 'Sofá', x: 6, y: 2, w: 20, h: 7 },
    { n: 'Mesa', x: 30, y: 16, w: 12, h: 8 },
    { n: 'Librero', x: 50, y: 31, w: 9, h: 8 },
    { n: 'Silla', x: 46, y: 6, w: 2, h: 2 },
    { n: 'Cama', x: 78, y: 1, w: 22, h: 16 },
    { n: 'Armario', x: 62, y: 31, w: 7, h: 8 },
    { n: 'Escritorio', x: 86, y: 32, w: 13, h: 6 },
    { n: 'Caja', x: 74, y: 22, w: 3, h: 3 },
  ];

  // la misma casa con los muebles cambiados de lugar
  const FURNITURE_MOVED = [
    { n: 'Sofá', x: 20, y: 28, w: 20, h: 7 },
    { n: 'Mesa', x: 10, y: 8, w: 12, h: 8 },
    { n: 'Librero', x: 50, y: 2, w: 9, h: 8 },
    { n: 'Silla', x: 44, y: 20, w: 2, h: 2 },
    { n: 'Cama', x: 62, y: 1, w: 22, h: 14 },
    { n: 'Armario', x: 93, y: 31, w: 7, h: 8 },
    { n: 'Escritorio', x: 72, y: 32, w: 13, h: 6 },
    { n: 'Caja', x: 88, y: 20, w: 3, h: 3 },
  ];

  const ALGOS = {
    random: {
      name: 'Aleatorio', long: 'Aleatorio (choca y gira)',
      desc: 'Avanza en línea recta hasta chocar y entonces gira un ángulo al azar. No sabe dónde ha estado: es el comportamiento más simple posible.',
    },
    roomba: {
      name: 'Espiral + pared', long: 'Espiral + pared + rebote',
      desc: 'Estilo aspiradora comercial básica: espiral hacia afuera, al chocar sigue la pared un rato, luego rebota al azar y de vez en cuando vuelve a hacer espiral. Sigue sin mapa ni memoria.',
    },
    planned: {
      name: 'Zigzag planificado', long: 'Zigzag planificado por habitación',
      desc: 'Conoce el plano y limpia en carriles paralelos, primero una habitación y luego la otra. Es un plan fijo calculado con búsqueda clásica de caminos (BFS): no aprende ni se adapta.',
    },
    ai: {
      name: 'Robot con IA', long: 'Robot con IA (mapea y planifica)',
      desc: 'No conoce el plano: un sensor láser simulado va construyendo un mapa mientras limpia y el planificador decide en cada momento la zona sucia más cercana, evitando repetir y adaptándose a lo que descubre. Gasta 3 W más por sensor y procesador. Es IA de robótica (percepción + planificación), no una red neuronal.',
    },
  };

  /* ---------- entorno ---------- */
  function makeEnv(items) {
    const free = new Uint8Array(W * H).fill(1);
    const block = (x, y, w, h) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++)
        if (i >= 0 && i < W && j >= 0 && j < H) free[j * W + i] = 0;
    };
    block(0, 0, W, 1); block(0, H - 1, W, 1); block(0, 0, 1, H); block(W - 1, 0, 1, H);
    block(WALL_X, 0, WALL_T, H);
    for (let j = DOOR[0]; j < DOOR[1]; j++) for (let i = WALL_X; i < WALL_X + WALL_T; i++) free[j * W + i] = 1;
    items.forEach(f => block(f.x, f.y, f.w, f.h));

    // centros donde cabe el robot
    const valid = new Uint8Array(W * H);
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      let ok = true;
      for (let j = cy - 2; j <= cy + 2 && ok; j++) for (let i = cx - 2; i <= cx + 2; i++) {
        if ((i - cx) * (i - cx) + (j - cy) * (j - cy) > R2) continue;
        if (i < 0 || j < 0 || i >= W || j >= H || !free[j * W + i]) { ok = false; break; }
      }
      valid[cy * W + cx] = ok ? 1 : 0;
    }
    // alcanzables desde la base
    const reach = new Uint8Array(W * H);
    const sx = Math.floor(DOCK.x), sy = Math.floor(DOCK.y);
    const q = [sy * W + sx]; reach[q[0]] = 1;
    for (let k = 0; k < q.length; k++) {
      const c = q[k], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (valid[n] && !reach[n]) { reach[n] = 1; q.push(n); }
      }
    }
    // celdas que se pueden limpiar
    const cleanable = new Uint8Array(W * H);
    for (let c = 0; c < W * H; c++) {
      if (!reach[c]) continue;
      const cx = c % W, cy = (c / W) | 0;
      for (let j = cy - 2; j <= cy + 2; j++) for (let i = cx - 2; i <= cx + 2; i++) {
        if ((i - cx) * (i - cx) + (j - cy) * (j - cy) > R2) continue;
        if (i >= 0 && j >= 0 && i < W && j < H && free[j * W + i]) cleanable[j * W + i] = 1;
      }
    }
    let nClean = 0, nFree = 0; for (let c = 0; c < W * H; c++) { nClean += cleanable[c]; nFree += free[c]; }
    const env = { free, valid, reach, cleanable, nClean, nFree, furniture: items, stale: false };
    env.plan = buildPlan(env);
    return env;
  }

  // moved = true: la casa real tiene los muebles cambiados, pero el plan guardado es el de la casa original
  function buildEnv(moved) {
    const orig = makeEnv(FURNITURE);
    if (!moved) return orig;
    const real = makeEnv(FURNITURE_MOVED);
    real.plan = orig.plan; real.stale = true;
    return real;
  }

  /* ---------- plan del zigzag (BFS + carriles) ---------- */
  function buildPlan(env) {
    const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H && env.reach[y * W + x];
    const los = (ax, ay, bx, by) => {
      const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 0.25));
      for (let i = 0; i <= n; i++) {
        const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
        if (!ok(Math.floor(x), Math.floor(y))) return false;
      }
      return true;
    };
    const bfs = (a, b) => {
      const prev = new Int32Array(W * H).fill(-2);
      const s = a.y * W + a.x, t = b.y * W + b.x;
      prev[s] = -1; const q = [s];
      for (let k = 0; k < q.length && prev[t] === -2; k++) {
        const c = q[k], x = c % W, y = (c / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!ok(nx, ny)) continue;
          const n = ny * W + nx;
          if (prev[n] === -2) { prev[n] = c; q.push(n); }
        }
      }
      const path = []; for (let c = t; c !== -1; c = prev[c]) path.push({ x: c % W, y: (c / W) | 0 });
      path.reverse();
      // "estirar la cuerda": quitar puntos intermedios con línea de vista libre
      const out = []; let i = 0;
      while (i < path.length - 1) {
        let j = path.length - 1;
        while (j > i + 1 && !los(path[i].x + .5, path[i].y + .5, path[j].x + .5, path[j].y + .5)) j--;
        out.push(path[j]); i = j;
      }
      return out;
    };

    const wps = [];
    let cur = { x: Math.floor(DOCK.x), y: Math.floor(DOCK.y) };
    const goTo = p => {
      if (cur.x === p.x && cur.y === p.y) return;
      bfs(cur, p).forEach(c => wps.push({ x: c.x + .5, y: c.y + .5 }));
      cur = p;
    };
    const rooms = [{ x0: 1, x1: 59, y0: 1, y1: 38 }, { x0: 62, x1: 100, y0: 1, y1: 38 }];
    for (const room of rooms) {
      const lanes = []; let y = room.y0 + 1;
      for (;;) { lanes.push(y); if (y + 1 >= room.y1) break; y += 3; if (y + 1 > room.y1) y = room.y1 - 1; }
      let dir = 1;
      for (const ly of lanes) {
        const runs = []; let a = -1;
        for (let x = room.x0; x <= room.x1 + 1; x++) {
          const g = x <= room.x1 && ok(x, ly);
          if (g && a < 0) a = x;
          if (!g && a >= 0) { runs.push([a, x - 1]); a = -1; }
        }
        if (dir < 0) runs.reverse();
        for (const [ra, rb] of runs) {
          const from = dir > 0 ? ra : rb, to = dir > 0 ? rb : ra;
          goTo({ x: from, y: ly }); goTo({ x: to, y: ly });
        }
        dir = -dir;
      }
    }
    return wps;
  }

  /* ---------- utilidades ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const norm = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  /* ---------- robot ---------- */
  class Sim {
    constructor(algo, seed, env) {
      this.algo = algo; this.env = env; this.rand = rng(seed * 7919 + ({ random: 1, roomba: 2, planned: 3, ai: 4 })[algo]);
      this.x = DOCK.x; this.y = DOCK.y;
      this.th = algo === 'planned' ? 0 : this.rand() * 2 * Math.PI;
      this.pend = 0; this.stepN = 0;
      this.freshAvg = V * 3;
      this.dist = 0; this.energy = 0; this.wasted = 0; this.bumps = 0; this.turnRad = 0;
      this.visits = new Uint16Array(W * H);
      this.lastSeen = new Int32Array(W * H).fill(-1e9);
      this.cleaned = 0; this.totalVisits = 0;
      this.trail = [this.x, this.y];
      this.hist = [[0, 0, 0]];
      this.done = false; this.reason = '';
      this.at95 = null;
      this.mode = 'spiral'; this.sr = 1; this.timer = 0; this.straight = 0;
      if (algo === 'random') this.mode = 'straight';
      this.pi = 0; this.fol = 0; this.folN = 0; this.bumpPi = -1; this.tries = 0;
      this.f = { moved: false, turning: false };
    }

    rot(d) { this.th += d; this.turnRad += Math.abs(d); this.f.turning = true; }
    startTurn(a) { this.pend = a; this.applyPend(); }
    applyPend() {
      const d = Math.sign(this.pend) * Math.min(TURN, Math.abs(this.pend));
      this.rot(d); this.pend -= d;
      if (Math.abs(this.pend) < 1e-6) this.pend = 0;
    }
    probe(d, ang) {
      const x = Math.floor(this.x + Math.cos(ang) * d), y = Math.floor(this.y + Math.sin(ang) * d);
      return x >= 0 && y >= 0 && x < W && y < H && this.env.valid[y * W + x] === 1;
    }
    tryMove(d) {
      const nx = this.x + Math.cos(this.th) * d, ny = this.y + Math.sin(this.th) * d;
      const cx = Math.floor(nx), cy = Math.floor(ny);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H || !this.env.valid[cy * W + cx]) return false;
      this.x = nx; this.y = ny; this.dist += d; this.f.moved = true; return true;
    }
    randTurn() { return (Math.PI / 2 + this.rand() * Math.PI) * (this.rand() < 0.5 ? -1 : 1); }

    wallStep() {  // sigue la pared con el lado derecho
      if (!this.probe(V + 0.7, this.th)) { this.rot(-0.3); return; }
      if (this.probe(1.6, this.th + Math.PI / 2)) this.th += 0.12;
      if (!this.tryMove(V)) this.rot(-0.3);
    }

    behave() {
      if (this.algo === 'random') {
        if (!this.tryMove(V)) { this.bumps++; this.startTurn(this.randTurn()); }
      } else if (this.algo === 'roomba') {
        if (this.mode === 'spiral') {
          const dth = V / this.sr;
          this.th += dth; this.sr += 0.477 * dth;
          if (!this.tryMove(V)) { this.bumps++; this.mode = 'wall'; this.timer = 200 + this.rand() * 400; }
          else if (this.sr > 22) { this.mode = 'straight'; this.straight = 0; }
        } else if (this.mode === 'straight') {
          if (!this.tryMove(V)) {
            this.bumps++;
            if (this.rand() < 0.3) { this.mode = 'wall'; this.timer = 150 + this.rand() * 300; }
            else this.startTurn(this.randTurn());
          } else if (++this.straight > 2500) { this.mode = 'spiral'; this.sr = 1; }
        } else {
          this.wallStep();
          if (--this.timer <= 0) { this.mode = 'straight'; this.straight = 0; this.startTurn((this.rand() - 0.5) * 2 * Math.PI); }
        }
      } else if (this.algo === 'ai') {
        this.behaveAI();
      } else {
        const wp = this.env.plan[this.pi];
        if (!wp) { this.finish(this.env.stale ? 'Plan agotado: el plano guardado ya no coincide con la casa' : 'Plan completado'); return; }
        const dx = wp.x - this.x, dy = wp.y - this.y, d = Math.hypot(dx, dy);
        if (d < 1e-6) { this.pi++; return; }
        const want = Math.atan2(dy, dx), diff = norm(want - this.th);
        if (this.fol > 0) {       // rodeando un obstáculo que su plano no tenía (pared a la derecha)
          this.fol--; this.folN++;
          if (this.folN > 6 && this.probe(1.2, want)) this.fol = 0;      // ya hay paso libre hacia el punto: retoma el plan
          else { this.wallStep(); if (this.fol === 0) this.pi++; return; } // si se agota el tiempo, salta al siguiente punto
        }
        if (Math.abs(diff) > 0.02) this.startTurn(diff);
        else {
          const m = Math.min(V, d);
          if (this.env.stale) {   // el plano guardado ya no coincide con la casa: choca y trata de rodear
            const cx = Math.floor(this.x + Math.cos(want) * m), cy = Math.floor(this.y + Math.sin(want) * m);
            if (!this.env.valid[cy * W + cx]) {
              this.bumps++;
              if (this.bumpPi !== this.pi) { this.bumpPi = this.pi; this.tries = 0; }
              if (++this.tries > 2) { this.pi++; return; }   // tras dos intentos fallidos desiste de ese punto
              this.fol = 100; this.folN = 0; return;
            }
          }
          this.th = want; this.x += Math.cos(want) * m; this.y += Math.sin(want) * m;
          this.dist += m; this.f.moved = true;
          if (d <= V + 1e-9) this.pi++;
        }
      }
    }

    footprint() {
      const { cleanable } = this.env;
      let fresh = 0;
      const x0 = Math.floor(this.x - 2.5), y0 = Math.floor(this.y - 2.5);
      for (let j = y0; j <= y0 + 5; j++) for (let i = x0; i <= x0 + 5; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const dx = i + .5 - this.x, dy = j + .5 - this.y;
        if (dx * dx + dy * dy > R2) continue;
        const c = j * W + i;
        if (!cleanable[c]) continue;
        if (this.visits[c] === 0) { this.visits[c] = 1; this.cleaned++; this.totalVisits++; fresh++; }
        else if (this.stepN - this.lastSeen[c] > RECENT) { this.visits[c]++; this.totalVisits++; }
        this.lastSeen[c] = this.stepN;
      }
      return fresh;
    }

    finish(reason) { this.done = true; this.reason = reason; }

    step() {
      if (this.done) return;
      this.f.moved = false; this.f.turning = false;
      if (this.pend !== 0) this.applyPend(); else this.behave();
      if (this.done) return;
      const { moved, turning } = this.f;
      const P = POWER.base + POWER.brush + (moved ? POWER.drive : turning ? POWER.turn : 0) + (this.algo === 'ai' ? POWER.ai : 0);
      const e = P * DT / 3600;
      this.energy += e; this.stepN++;
      const fresh = (moved || this.stepN === 1) ? this.footprint() : 0;
      this.freshAvg = this.freshAvg * 0.93 + fresh * 0.07;   // las celdas nuevas llegan a ráfagas: se suaviza
      this.wasted += e * (moved ? Math.min(1, Math.max(0, 1 - this.freshAvg / (V * 3))) : 1);
      if (moved) this.trail.push(this.x, this.y);
      const cov = this.cleaned / this.env.nClean;
      if (this.stepN % 10 === 0) this.hist.push([this.energy, cov, this.stepN * DT / 60]);
      if (!this.at95 && cov >= TARGET) this.at95 = { t: this.stepN * DT, dist: this.dist * CELL_M, energy: this.energy };
      if ((this.algo === 'random' || this.algo === 'roomba') && cov >= TARGET) this.finish('Objetivo 95 % alcanzado');
      else if (this.energy >= BATTERY_WH) this.finish('Batería agotada');
    }

    metrics() {
      const cov = this.cleaned / this.env.nClean;
      const areaM2 = this.cleaned * CELL_M * CELL_M;
      const distM = this.dist * CELL_M;
      const idealPath = areaM2 / (3 * CELL_M);                         // m con ancho de 30 cm
      const idealE = idealPath / (V * CELL_M / DT) * (POWER.base + POWER.brush + POWER.drive) / 3600;
      return {
        time: this.stepN * DT, dist: distM, energy: this.energy, battery: Math.max(0, 1 - this.energy / BATTERY_WH),
        coverage: cov, area: areaM2,
        areaTotal: this.env.nFree * CELL_M * CELL_M, areaReach: this.env.nClean * CELL_M * CELL_M,
        pending: (this.env.nClean - this.cleaned) * CELL_M * CELL_M, gross: this.totalVisits * CELL_M * CELL_M,
        redundancy: this.totalVisits ? 1 - this.cleaned / this.totalVisits : 0,
        rePass: (this.totalVisits - this.cleaned) * CELL_M * CELL_M,
        pathEff: distM > 0 ? Math.min(1, idealPath / distM) : 0,
        energyEff: this.energy > 0 ? Math.min(1, idealE / this.energy) : 0,
        wastedPct: this.energy > 0 ? this.wasted / this.energy : 0,
        bumps: this.bumps, turns: this.turnRad / (2 * Math.PI),
        done: this.done, reason: this.reason, at95: this.at95,
      };
    }

    histogram() {
      const h = [0, 0, 0, 0];
      for (let c = 0; c < W * H; c++) {
        const v = this.visits[c];
        if (v === 0) continue;
        h[v === 1 ? 0 : v === 2 ? 1 : v <= 4 ? 2 : 3]++;
      }
      return h;
    }
  }

  const api = { Sim, buildEnv, ALGOS, FURNITURE, DOCK, W, H, TARGET, BATTERY_WH, CELL_M, DT, WALL_X, WALL_T, DOOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoombaSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
