(function () {
  'use strict';
  const { Sim, buildEnv, ALGOS, FURNITURE, DOCK, W, H, BATTERY_WH, CELL_M } = window.RoombaSim;
  const S = 8;                                   // píxeles por celda
  const COLORS = { random: '#4c9be8', roomba: '#f0a03c', planned: '#4cc38a' };
  const KEYS = Object.keys(ALGOS);
  const HEAT = [null, [47, 158, 122], [217, 164, 65], [232, 116, 59], [229, 72, 77]];

  const env = buildEnv();
  const $ = id => document.getElementById(id);
  const map = $('map'), ctx = map.getContext('2d');
  map.width = W * S; map.height = H * S;
  const heat = document.createElement('canvas'); heat.width = W; heat.height = H;
  const hctx = heat.getContext('2d'); const himg = hctx.createImageData(W, H);

  // capa estática: suelo + muros + muebles
  const stat = document.createElement('canvas'); stat.width = W * S; stat.height = H * S;
  (function () {
    const c = stat.getContext('2d');
    c.fillStyle = '#0e131b'; c.fillRect(0, 0, W * S, H * S);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (env.cleanable[j * W + i]) { c.fillStyle = '#1c2434'; c.fillRect(i * S, j * S, S, S); }
    }
  })();
  const obst = document.createElement('canvas'); obst.width = W * S; obst.height = H * S;
  (function () {
    const c = obst.getContext('2d');
    c.fillStyle = '#2b3547';
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!env.free[j * W + i]) c.fillRect(i * S, j * S, S, S);
    c.fillStyle = '#44516c';
    FURNITURE.forEach(f => c.fillRect(f.x * S, f.y * S, f.w * S, f.h * S));
    c.fillStyle = '#c3cce0'; c.font = '600 11px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    FURNITURE.forEach(f => { if (f.w >= 6 && f.h >= 6) c.fillText(f.n, (f.x + f.w / 2) * S, (f.y + f.h / 2) * S); });
    c.fillStyle = '#7fb4ff'; c.fillRect((DOCK.x - 1.5) * S, (DOCK.y - 1.5) * S, 3 * S, 3 * S);
    c.fillStyle = '#06101c'; c.font = '700 10px system-ui,sans-serif'; c.fillText('base', DOCK.x * S, DOCK.y * S);
  })();

  let seed = 7, sims, trails, drawn, sel = 'roomba', playing = true, ff = false;

  function make() {
    sims = {}; trails = {}; drawn = {};
    KEYS.forEach(k => {
      sims[k] = new Sim(k, seed, env);
      const c = document.createElement('canvas'); c.width = W * S; c.height = H * S; trails[k] = c; drawn[k] = 0;
    });
    ff = false; $('ff').textContent = 'Ejecutar hasta terminar';
  }

  /* ---------- pestañas ---------- */
  KEYS.forEach(k => {
    const b = document.createElement('button');
    b.className = 'tab'; b.setAttribute('role', 'tab');
    b.innerHTML = '<i style="background:' + COLORS[k] + '"></i>' + ALGOS[k].long;
    b.onclick = () => { sel = k; refreshTabs(); update(true); };
    b.dataset.k = k; $('tabs').appendChild(b);
  });
  function refreshTabs() {
    document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.k === sel));
    $('desc').textContent = ALGOS[sel].desc;
  }

  /* ---------- botones ---------- */
  $('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Pausa' : 'Reanudar'; };
  $('reset').onclick = () => { make(); update(true); };
  $('reseed').onclick = () => { seed = (seed * 1103515245 + 12345) % 2147483647; make(); update(true); };
  $('ff').onclick = () => { ff = !ff; $('ff').textContent = ff ? 'Detener' : 'Ejecutar hasta terminar'; if (ff) { playing = true; $('play').textContent = 'Pausa'; } };

  /* ---------- dibujo ---------- */
  function draw() {
    const sim = sims[sel];
    ctx.drawImage(stat, 0, 0);
    if ($('lyHeat').checked) {
      const d = himg.data;
      for (let c = 0; c < W * H; c++) {
        const v = sim.visits[c], o = c * 4;
        if (v === 0) { d[o + 3] = 0; continue; }
        const col = HEAT[v === 1 ? 1 : v === 2 ? 2 : v <= 4 ? 3 : 4];
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 235;
      }
      hctx.putImageData(himg, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(heat, 0, 0, W * S, H * S);
    } else {
      ctx.fillStyle = 'rgba(76,155,232,.35)';
      for (let c = 0; c < W * H; c++) if (sim.visits[c]) ctx.fillRect((c % W) * S, ((c / W) | 0) * S, S, S);
    }
    ctx.drawImage(obst, 0, 0);
    // trayectoria incremental
    const tc = trails[sel].getContext('2d'), tr = sim.trail;
    if (drawn[sel] < tr.length - 2) {
      tc.strokeStyle = 'rgba(255,255,255,.55)'; tc.lineWidth = 1.2; tc.lineJoin = 'round';
      tc.beginPath(); tc.moveTo(tr[drawn[sel]] * S, tr[drawn[sel] + 1] * S);
      for (let i = drawn[sel] + 2; i < tr.length; i += 2) tc.lineTo(tr[i] * S, tr[i + 1] * S);
      tc.stroke(); drawn[sel] = tr.length - 2;
    }
    if ($('lyTrail').checked) ctx.drawImage(trails[sel], 0, 0);
    // robot
    ctx.fillStyle = COLORS[sel]; ctx.strokeStyle = '#06101c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sim.x * S, sim.y * S, 1.7 * S, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sim.x * S, sim.y * S);
    ctx.lineTo((sim.x + Math.cos(sim.th) * 1.7) * S, (sim.y + Math.sin(sim.th) * 1.7) * S); ctx.stroke();
  }

  /* ---------- métricas ---------- */
  const fmtT = s => { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const pct = x => (x * 100).toFixed(1);
  function cards(m) {
    const items = [
      ['Tiempo', fmtT(m.time), 'min:s'],
      ['Distancia', m.dist.toFixed(0), 'm'],
      ['Energía gastada', m.energy.toFixed(1), 'Wh'],
      ['Cobertura', pct(m.coverage), '%'],
      ['Redundancia', pct(m.redundancy), '%'],
      ['Re-limpiado', m.rePass.toFixed(1), 'm²'],
      ['Efic. trayectoria', pct(m.pathEff), '%'],
      ['Efic. energética', pct(m.energyEff), '%'],
      ['Energía sin área nueva', pct(m.wastedPct), '%'],
      ['Choques', m.bumps, ''],
    ];
    $('cards').innerHTML = items.map(i => '<div class="card"><small>' + i[0] + '</small><b>' + i[1] + '<em>' + i[2] + '</em></b></div>').join('');
  }
  function histogram(sim) {
    const h = sim.histogram(), tot = h.reduce((a, b) => a + b, 0) || 1;
    const cols = ['#2f9e7a', '#d9a441', '#e8743b', '#e5484d'], lab = ['1', '2', '3–4', '5+'];
    $('hist').innerHTML = h.map((n, i) => n ? '<div style="flex:' + n + ';background:' + cols[i] + '" title="' + lab[i] + ' veces: ' + (n * CELL_M * CELL_M).toFixed(1) + ' m²">' + (n / tot > .1 ? lab[i] + '×' : '') + '</div>' : '').join('');
  }
  function table() {
    const rows = KEYS.map(k => ({ k, m: sims[k].metrics() }));
    const best = (f, lowIsBetter) => {
      const done = rows.filter(r => r.m.coverage >= 0.95);
      if (done.length < 2) return null;
      return done.reduce((a, b) => (lowIsBetter ? f(b) < f(a) : f(b) > f(a)) ? b : a).k;
    };
    const bT = best(r => (r.m.at95 || { t: 1e9 }).t, true);
    const defs = [
      ['Cobertura', r => pct(r.m.coverage) + '%'],
      ['Tiempo a 95 %', r => r.m.at95 ? fmtT(r.m.at95.t) : '—', bT, 'at95t'],
      ['Distancia', r => r.m.dist.toFixed(0) + ' m'],
      ['Energía', r => r.m.energy.toFixed(1) + ' Wh'],
      ['Redundancia', r => pct(r.m.redundancy) + '%'],
      ['Efic. energética', r => pct(r.m.energyEff) + '%'],
    ];
    const cells = {
      Redundancia: best(r => r.m.redundancy, true), 'Efic. energética': best(r => r.m.energyEff, false),
      Energía: best(r => r.m.energy, true), Distancia: best(r => r.m.dist, true), 'Tiempo a 95 %': bT,
    };
    $('cmp').innerHTML = '<thead><tr><th>Estrategia</th>' + defs.map(d => '<th>' + d[0] + '</th>').join('') + '<th>Estado</th></tr></thead><tbody>' +
      rows.map(r => '<tr class="' + (r.k === sel ? 'sel' : '') + '"><td><span class="dot" style="background:' + COLORS[r.k] + '"></span>' + ALGOS[r.k].name + '</td>' +
        defs.map(d => '<td class="' + (cells[d[0]] === r.k ? 'best' : '') + '">' + d[1](r) + '</td>').join('') +
        '<td>' + (r.m.done ? '✔' : '…') + '</td></tr>').join('') + '</tbody>';
  }
  function chart() {
    const c = $('chart'), g = c.getContext('2d'), w = c.width, h = c.height, L = 46, B = 34, T = 12, Rr = 12;
    g.clearRect(0, 0, w, h);
    g.font = '12px system-ui,sans-serif'; g.fillStyle = '#93a0b6'; g.strokeStyle = '#242d3d'; g.lineWidth = 1;
    const maxE = BATTERY_WH;
    const X = e => L + (e / maxE) * (w - L - Rr), Y = v => T + (1 - v) * (h - T - B);
    g.textAlign = 'right';
    for (let v = 0; v <= 1.001; v += 0.25) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - Rr, Y(v)); g.stroke(); g.fillText(Math.round(v * 100) + '%', L - 6, Y(v) + 4); }
    g.textAlign = 'center';
    for (let e = 0; e <= maxE; e += 5) g.fillText(e + ' Wh', X(e), h - 14);
    g.setLineDash([5, 4]); g.strokeStyle = '#5b6b86'; g.beginPath(); g.moveTo(L, Y(.95)); g.lineTo(w - Rr, Y(.95)); g.stroke(); g.setLineDash([]);
    KEYS.forEach(k => {
      const s = sims[k]; g.strokeStyle = COLORS[k]; g.lineWidth = 2.2; g.beginPath();
      s.hist.forEach((p, i) => { const x = X(Math.min(p[0], maxE)), y = Y(p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
      const last = s.hist[s.hist.length - 1];
      g.fillStyle = COLORS[k]; g.beginPath(); g.arc(X(Math.min(last[0], maxE)), Y(last[1]), 3.5, 0, 7); g.fill();
    });
    g.fillStyle = '#93a0b6'; g.textAlign = 'left';
    KEYS.forEach((k, i) => { g.fillStyle = COLORS[k]; g.fillRect(L + 10 + i * 150, T + 8, 12, 4); g.fillStyle = '#93a0b6'; g.fillText(ALGOS[k].name, L + 28 + i * 150, T + 14); });
  }

  function update(full) {
    const sim = sims[sel], m = sim.metrics();
    draw();
    cards(m);
    $('batBar').style.width = (m.battery * 100).toFixed(1) + '%';
    $('batBar').style.background = m.battery < 0.2 ? '#e5484d' : '';
    $('batTxt').textContent = 'Batería ' + (m.battery * 100).toFixed(0) + '%  ·  ' + m.energy.toFixed(1) + ' / ' + BATTERY_WH + ' Wh';
    $('status').textContent = m.done ? m.reason : 'Limpiando… (' + ALGOS[sel].name + ')';
    $('status').className = 'status' + (m.done ? ' done' : '');
    histogram(sim); table(); chart();
  }

  /* ---------- bucle ---------- */
  let frame = 0;
  function loop() {
    if (playing) {
      const n = ff ? 4000 : +$('speed').value;
      let any = false;
      KEYS.forEach(k => { const s = sims[k]; for (let i = 0; i < n && !s.done; i++) s.step(); if (!s.done) any = true; });
      if (!any && ff) { ff = false; $('ff').textContent = 'Ejecutar hasta terminar'; }
    }
    if (playing || frame++ % 30 === 0) {
      if (frame++ % 2 === 0 || ff) update();
    }
    requestAnimationFrame(loop);
  }
  ['lyTrail', 'lyHeat'].forEach(id => $(id).onchange = () => update());

  make(); refreshTabs(); update(true); requestAnimationFrame(loop);
  window.__roomba = { get sims() { return sims; }, env };
})();
