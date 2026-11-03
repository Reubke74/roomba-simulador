/* Robot "con IA": no conoce el plano. Un sensor láser simulado construye un mapa
 * mientras limpia y un planificador decide, con lo que ve, la siguiente zona sucia.
 * Es IA de robótica (percepción + mapa + planificación), no una red neuronal.
 */
(function (root) {
  'use strict';
  const { Sim, W, H } = root.RoombaSim;
  const V = 0.3, RANGE = 30;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const norm = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const P = Sim.prototype;

  // láser 360°: marca como libre lo que ve y como ocupado lo que lo detiene
  P.sense = function () {
    const k = this.known, free = this.env.free;
    for (let a = 0; a < 360; a++) {
      const ang = a * Math.PI / 180, cs = Math.cos(ang), sn = Math.sin(ang);
      for (let r = 0; r <= RANGE; r += 0.5) {
        const cx = Math.floor(this.x + cs * r), cy = Math.floor(this.y + sn * r);
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
        const c = cy * W + cx;
        if (!free[c]) { k[c] = 2; break; }
        k[c] = 1;
      }
    }
  };

  // el robot cabe en (x,y) según SU mapa (los 9 cuadros de su huella son libres)
  P.kvalid = function (x, y) {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
    const k = this.known, c = y * W + x;
    return k[c] === 1 && k[c - 1] === 1 && k[c + 1] === 1 && k[c - W] === 1 && k[c - W - 1] === 1 &&
      k[c - W + 1] === 1 && k[c + W] === 1 && k[c + W - 1] === 1 && k[c + W + 1] === 1;
  };

  // cuántos cuadros de su huella en (x,y) siguen sin limpiar
  P.gain = function (x, y) {
    const v = this.visits, c = y * W + x;
    return (v[c] === 0) + (v[c - 1] === 0) + (v[c + 1] === 0) + (v[c - W] === 0) + (v[c - W - 1] === 0) +
      (v[c - W + 1] === 0) + (v[c + W] === 0) + (v[c + W - 1] === 0) + (v[c + W + 1] === 0);
  };

  P.los = function (ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 0.25));
    for (let i = 0; i <= n; i++) {
      if (!this.kvalid(Math.floor(ax + (bx - ax) * i / n), Math.floor(ay + (by - ay) * i / n))) return false;
    }
    return true;
  };

  // hay un cuadro libre conocido pegado a territorio desconocido cerca de (x,y)
  P.nearFrontier = function (x, y) {
    const k = this.known;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const cx = x + dx, cy = y + dy;
      if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1) continue;
      const c = cy * W + cx;
      if (k[c] === 1 && (k[c - 1] === 0 || k[c + 1] === 0 || k[c - W] === 0 || k[c + W] === 0)) return true;
    }
    return false;
  };

  // Una puerta es estrecha y CORTA (el grosor de un muro); un pasillo entre un mueble y la pared es estrecho y largo.
  P.isNarrow = function (x, y, memo) {
    const c = y * W + x;
    if (memo[c]) return memo[c] === 1;
    const k = this.known, at = (cx, cy) => (cx < 0 || cy < 0 || cx >= W || cy >= H) ? 2 : k[cy * W + cx];
    const tight = (cx, cy, ax, ay) => {      // espacio libre <= 0.9 m entre dos obstáculos vistos en el eje (ax, ay)
      if (at(cx, cy) !== 1) return false;
      let u = 0, d = 0;
      while (u < 10 && at(cx - ax * (u + 1), cy - ay * (u + 1)) === 1) u++;
      while (d < 10 && at(cx + ax * (d + 1), cy + ay * (d + 1)) === 1) d++;
      return u < 10 && d < 10 && at(cx - ax * (u + 1), cy - ay * (u + 1)) === 2 &&
        at(cx + ax * (d + 1), cy + ay * (d + 1)) === 2 && u + d + 1 <= 9;
    };
    let narrow = false;
    for (const [ax, ay] of [[0, 1], [1, 0]]) {
      if (!tight(x, y, ax, ay)) continue;
      let len = 1;                           // largo del tramo estrecho, perpendicular al eje
      for (let s = 1; s <= 5 && tight(x - ay * s, y - ax * s, ax, ay); s++) len++;
      for (let s = 1; s <= 5 && tight(x + ay * s, y + ax * s, ax, ay); s++) len++;
      if (len <= 4) { narrow = true; break; }
    }
    memo[c] = narrow ? 1 : 2;
    return narrow;
  };

  // elige el siguiente destino; devuelve false si ya no queda nada por limpiar ni explorar
  P.plan = function () {
    const k = this.known, pr = this.pr || (this.pr = { t0: 7, t1: 3, run: 3, turnW: 1.5, side: 2, c0: 1, skip2: true });
    if (this.fpend >= 0) {            // lo que sigue sin verse tras explorar se da por inaccesible
      const px = this.fpend % W, py = (this.fpend / W) | 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const cx = px + dx, cy = py + dy;
        if (cx >= 0 && cy >= 0 && cx < W && cy < H && k[cy * W + cx] === 0) k[cy * W + cx] = 2;
      }
      this.fpend = -1;
    }
    const rx = Math.floor(this.x), ry = Math.floor(this.y), start = ry * W + rx;
    // Dijkstra con cubetas: cruzar un paso estrecho cuesta de más, así termina una zona antes de pasar a otra
    const dist = new Int32Array(W * H).fill(1e9), prev = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
    const memo = new Int8Array(W * H), buckets = [[start]], q = [], best = [null, null, null];
    dist[start] = 0;
    for (let b = 0; b < buckets.length; b++) {
      const arr = buckets[b];
      if (!arr) continue;
      for (let ai = 0; ai < arr.length; ai++) {
        const c = arr[ai];
        if (done[c] || dist[c] !== b) continue;
        done[c] = 1; q.push(c);
        const x = c % W, y = (c / W) | 0, d = b;
        const g = this.isNarrow(x, y, memo) ? 0 : this.gain(x, y);
        if (g > 0) {
          const t = pr.c0 ? (g >= pr.t1 ? 0 : 2) : (g >= pr.t0 ? 0 : g >= pr.t1 ? 1 : 2);
          let score = d;
          if (d > 0) score += Math.abs(norm(Math.atan2(y - ry, x - rx) - this.th)) * pr.turnW;   // evita giros bruscos
          if ((y - ry) * this.shift < 0) score += pr.side;                                        // mantiene el sentido del zigzag
          if (pr.c0 && t === 0) score = (score + pr.c0) / g;                                      // costo por superficie nueva
          if (!best[t] || score < best[t].score) best[t] = { c, score };
        }
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, n = ny * W + nx;
          if (done[n] || !this.kvalid(nx, ny)) continue;
          const nd = d + 1 + (this.isNarrow(nx, ny, memo) ? 40 : 0);
          if (nd < dist[n]) { dist[n] = nd; prev[n] = c; (buckets[nd] || (buckets[nd] = [])).push(n); }
        }
      }
    }
    let tgt = best[0] || best[1], explore = false;
    if (!tgt) {                       // nada limpio por hacer a la vista: explorar
      for (const c of q) if (this.nearFrontier(c % W, (c / W) | 0)) { tgt = { c }; explore = true; break; }
    }
    this.tier = explore ? 'explorar' : tgt ? (tgt === best[0] ? 'carril' : 'resto') : 'rendija';
    if (!tgt && !pr.skip2) tgt = best[2];          // rendijas sueltas
    if (!tgt) return false;

    const cells = []; for (let c = tgt.c; c !== -1; c = prev[c]) cells.push({ x: c % W, y: (c / W) | 0 });
    cells.reverse();
    const pts = []; let i = 0;        // "estirar la cuerda" con su propio mapa
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.los(cells[i].x + .5, cells[i].y + .5, cells[j].x + .5, cells[j].y + .5)) j--;
      pts.push(cells[j]); i = j;
    }
    if (!pts.length) pts.push(cells[0]);
    const wps = pts.map(p => ({ x: p.x + .5, y: p.y + .5 }));
    const tx = tgt.c % W, ty = (tgt.c / W) | 0;
    if (ty !== ry) this.shift = Math.sign(ty - ry);
    if (explore) this.fpend = tgt.c;
    else {                            // recorre el carril hacia donde haya más suciedad
      let bestDir = 0, bestL = 0;
      for (const dir of [1, -1]) {
        let L = 0;
        for (let s = 1; s <= RANGE; s++) {
          const x = tx + dir * s;
          if (!this.kvalid(x, ty) || this.gain(x, ty) < pr.run || this.isNarrow(x, ty, memo)) break;
          L = s;
        }
        if (L > bestL) { bestL = L; bestDir = dir; }
      }
      if (bestL > 0) wps.push({ x: tx + bestDir * bestL + .5, y: ty + .5 });
    }
    this.q = wps; this.qi = 0;
    return true;
  };

  P.behaveAI = function () {
    if (!this.known) {
      this.known = new Uint8Array(W * H); this.q = []; this.qi = 0; this.shift = 1; this.fpend = -1;
      this.sense();
    }
    if (this.stepN % 10 === 0) this.sense();
    if (this.qi >= this.q.length) {
      this.sense();
      if (!this.plan()) { this.finish('Mapa completo: nada pendiente'); return; }
    }
    const wp = this.q[this.qi];
    const dx = wp.x - this.x, dy = wp.y - this.y, d = Math.hypot(dx, dy);
    if (d < 1e-6) { this.qi++; return; }
    const want = Math.atan2(dy, dx), diff = norm(want - this.th);
    if (Math.abs(diff) > 0.02) this.startTurn(diff);
    else {
      const m = Math.min(V, d);
      this.th = want; this.x += Math.cos(want) * m; this.y += Math.sin(want) * m;
      this.dist += m; this.f.moved = true;
      if (d <= V + 1e-9) this.qi++;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
