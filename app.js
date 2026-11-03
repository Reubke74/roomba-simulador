(function () {
  'use strict';
  const { Sim, buildEnv, ALGOS, DOCK, W, H, BATTERY_WH, CELL_M } = window.RoombaSim;
  const S = 8;                                   // píxeles por celda
  const COLORS = { random: '#4c9be8', roomba: '#f0a03c', planned: '#4cc38a', ai: '#b48ef7' };
  const DASH = { random: [], roomba: [7, 4], planned: [2, 3], ai: [12, 3, 3, 3] };   // para distinguir sin depender del color
  const KEYS = Object.keys(ALGOS);
  const HEAT = [null, [47, 158, 122], [217, 164, 65], [232, 116, 59], [229, 72, 77]];
  const PAD = { l: 52, t: 46, r: 52, b: 12 };    // margen del mapa para las cotas
  // CFE Tarifa 1 doméstica, $/kWh sin IVA, noviembre 2026 (app.cfe.mx, página oficial de la Tarifa 1). CFE las cambia cada mes.
  const TARIFAS = { basico: 1.144, intermedio: 1.389, excedente: 4.067 };
  const IVA = 1.16, EFF_CARGA = 0.85;            // IVA 16 %; la pared entrega más que la batería

  let env = buildEnv(false);
  const $ = id => document.getElementById(id);
  const CW = W * S + PAD.l + PAD.r, CH = H * S + PAD.t + PAD.b;

  /* ---------- capas compartidas ---------- */
  const heat = document.createElement('canvas'); heat.width = W; heat.height = H;
  const hctx = heat.getContext('2d'); const himg = hctx.createImageData(W, H);
  // niebla: lo que el robot con IA todavía no conoce
  const fog = document.createElement('canvas'); fog.width = W; fog.height = H;
  const fctx = fog.getContext('2d'); const fimg = fctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { fimg.data[i * 4] = 6; fimg.data[i * 4 + 1] = 9; fimg.data[i * 4 + 2] = 14; }

  const stat = document.createElement('canvas'); stat.width = W * S; stat.height = H * S;
  function paintStat() {                         // suelo alcanzable
    const c = stat.getContext('2d');
    c.fillStyle = '#0e131b'; c.fillRect(0, 0, W * S, H * S);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (env.cleanable[j * W + i]) { c.fillStyle = '#1c2434'; c.fillRect(i * S, j * S, S, S); }
    }
  }
  const obst = document.createElement('canvas'); obst.width = W * S; obst.height = H * S;
  function paintObst() {                         // muros, muebles, base y cota de la puerta
    const c = obst.getContext('2d'); c.clearRect(0, 0, W * S, H * S);
    c.fillStyle = '#2b3547';
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!env.free[j * W + i]) c.fillRect(i * S, j * S, S, S);
    c.fillStyle = '#44516c';
    env.furniture.forEach(f => c.fillRect(f.x * S, f.y * S, f.w * S, f.h * S));
    c.fillStyle = '#c3cce0'; c.font = '600 11px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    env.furniture.forEach(f => { if (f.w >= 6 && f.h >= 6) c.fillText(f.n, (f.x + f.w / 2) * S, (f.y + f.h / 2) * S); });
    c.fillStyle = '#7fb4ff'; c.fillRect((DOCK.x - 1.5) * S, (DOCK.y - 1.5) * S, 3 * S, 3 * S);
    c.fillStyle = '#06101c'; c.font = '700 10px system-ui,sans-serif'; c.fillText('base', DOCK.x * S, DOCK.y * S);
    c.strokeStyle = '#e6ebf4'; c.fillStyle = '#e6ebf4'; c.lineWidth = 1.2; c.font = '600 10px system-ui,sans-serif';
    const dx = 63.5 * S;
    c.beginPath(); c.moveTo(dx, 16 * S); c.lineTo(dx, 24 * S); c.moveTo(dx - 4, 16 * S); c.lineTo(dx + 4, 16 * S); c.moveTo(dx - 4, 24 * S); c.lineTo(dx + 4, 24 * S); c.stroke();
    c.save(); c.translate(dx + 9, 20 * S); c.rotate(-Math.PI / 2); c.fillText('puerta 0.8 m', 0, 0); c.restore();
  }
  paintStat(); paintObst();

  const dims = document.createElement('canvas'); dims.width = CW; dims.height = CH;   // cotas de las habitaciones
  (function () {
    const c = dims.getContext('2d'), X = x => PAD.l + x * S, Y = y => PAD.t + y * S;
    c.fillStyle = '#0b0f16'; c.fillRect(0, 0, CW, CH);
    c.strokeStyle = '#7f8da6'; c.lineWidth = 1.2; c.font = '600 17px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const line = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
    const label = (txt, x, y, rot) => {
      c.save(); c.translate(x, y); if (rot) c.rotate(-Math.PI / 2);
      const w = c.measureText(txt).width + 12; c.fillStyle = '#0b0f16'; c.fillRect(-w / 2, -11, w, 22);
      c.fillStyle = '#c3cce0'; c.fillText(txt, 0, 0); c.restore();
    };
    const hdim = (xa, xb, y, txt) => { line(X(xa), y, X(xb), y); line(X(xa), y - 7, X(xa), y + 7); line(X(xb), y - 7, X(xb), y + 7); label(txt, (X(xa) + X(xb)) / 2, y, false); };
    const vdim = (ya, yb, x, txt) => { line(x, Y(ya), x, Y(yb)); line(x - 7, Y(ya), x + 7, Y(ya)); line(x - 7, Y(yb), x + 7, Y(yb)); label(txt, x, (Y(ya) + Y(yb)) / 2, true); };
    hdim(0, 60, 24, 'Sala · 6.0 m');
    hdim(62, 102, 24, 'Dormitorio · 4.0 m');
    vdim(0, 40, 26, 'Sala · 4.0 m');
    vdim(0, 40, PAD.l + W * S + 26, 'Dormitorio · 4.0 m');
  })();

  /* ---------- estado ---------- */
  let seed = 7, sims, trails, drawn, sel = 'roomba', view = 'four', playing = true, ff = false;

  function make() {
    sims = {}; trails = {}; drawn = {};
    KEYS.forEach(k => {
      sims[k] = new Sim(k, seed, env);
      const c = document.createElement('canvas'); c.width = W * S; c.height = H * S; trails[k] = c; drawn[k] = 0;
    });
    setFF(false);
  }

  /* ---------- mapas (uno por robot) ---------- */
  const figs = {}, ctxs = {};
  KEYS.forEach(k => {
    const f = document.createElement('figure'); f.className = 'mapfig'; f.dataset.k = k;
    const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Mapa de limpieza: ' + ALGOS[k].long);
    const cap = document.createElement('figcaption');
    cap.innerHTML = '<i style="background:' + COLORS[k] + '"></i><b>' + ALGOS[k].long + '</b><span></span>';
    f.append(cv, cap); f.onclick = () => select(k);
    $('maps').appendChild(f); figs[k] = f; ctxs[k] = cv.getContext('2d');
  });

  KEYS.forEach(k => {
    const b = document.createElement('button');
    b.className = 'tab'; b.setAttribute('role', 'tab');
    b.innerHTML = '<i style="background:' + COLORS[k] + '"></i>' + ALGOS[k].long;
    b.onclick = () => select(k);
    b.dataset.k = k; $('tabs').appendChild(b);
  });

  function applyView() {
    $('maps').className = 'maps ' + view;
    KEYS.forEach(k => { figs[k].hidden = view === 'one' && k !== sel; figs[k].classList.toggle('sel', k === sel && view === 'four'); });
    document.querySelectorAll('#view button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === view));
    document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.k === sel));
    $('desc').textContent = ALGOS[sel].desc;
  }
  function select(k) { sel = k; applyView(); update(); }

  /* ---------- controles ---------- */
  function setFF(on) { ff = on; $('ff').textContent = on ? 'Detener' : 'Ejecutar hasta terminar'; if (!on) $('prog').hidden = true; }
  $('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Pausa' : 'Reanudar'; };
  $('reset').onclick = () => { make(); update(); };
  $('moved').onchange = () => { env = buildEnv($('moved').checked); paintStat(); paintObst(); make(); update(); };
  $('reseed').onclick = () => { seed = (seed * 1103515245 + 12345) % 2147483647; make(); update(); };
  document.querySelectorAll('#view button').forEach(b => b.onclick = () => { view = b.dataset.v; applyView(); update(); });
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(e.target.tagName)) { e.preventDefault(); $('play').click(); }
  });

  // "Ejecutar hasta terminar": avanza por tandas con setTimeout, así no depende de que la animación esté visible
  $('ff').onclick = () => {
    if (ff) { setFF(false); return; }
    setFF(true); playing = true; $('play').textContent = 'Pausa'; $('prog').hidden = false;
    const chunk = () => {
      if (!ff) return;
      let sum = 0, any = false;
      KEYS.forEach(k => {
        const s = sims[k];
        for (let i = 0; i < 3000 && !s.done; i++) s.step();
        if (!s.done) any = true;
        sum += s.done ? 1 : Math.min(0.99, s.cleaned / env.nClean / 0.99);
      });
      const p = Math.round(sum / KEYS.length * 100);
      $('progbar').style.width = p + '%'; $('progtxt').textContent = 'Calculando… ' + p + ' %';
      update();
      if (any) setTimeout(chunk, 0); else setFF(false);
    };
    setTimeout(chunk, 0);
  };

  /* ---------- dibujo ---------- */
  function draw(k) {
    const sim = sims[k], c = ctxs[k];
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(dims, 0, 0); c.translate(PAD.l, PAD.t);
    c.drawImage(stat, 0, 0);
    if ($('lyHeat').checked) {
      const d = himg.data;
      for (let i = 0; i < W * H; i++) {
        const v = sim.visits[i], o = i * 4;
        if (v === 0) { d[o + 3] = 0; continue; }
        const col = HEAT[v === 1 ? 1 : v === 2 ? 2 : v <= 4 ? 3 : 4];
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 235;
      }
      hctx.putImageData(himg, 0, 0);
      c.imageSmoothingEnabled = false;
      c.drawImage(heat, 0, 0, W * S, H * S);
    } else {
      c.fillStyle = 'rgba(76,155,232,.35)';
      for (let i = 0; i < W * H; i++) if (sim.visits[i]) c.fillRect((i % W) * S, ((i / W) | 0) * S, S, S);
    }
    c.drawImage(obst, 0, 0);
    if (k === 'ai' && sim.known && $('lyFog').checked) {
      for (let i = 0; i < W * H; i++) fimg.data[i * 4 + 3] = sim.known[i] === 0 ? 185 : 0;
      fctx.putImageData(fimg, 0, 0);
      c.imageSmoothingEnabled = false;
      c.drawImage(fog, 0, 0, W * S, H * S);
    }
    const tc = trails[k].getContext('2d'), tr = sim.trail;   // trayectoria incremental
    if (drawn[k] < tr.length - 2) {
      tc.strokeStyle = 'rgba(255,255,255,.55)'; tc.lineWidth = 1.2; tc.lineJoin = 'round';
      tc.beginPath(); tc.moveTo(tr[drawn[k]] * S, tr[drawn[k] + 1] * S);
      for (let i = drawn[k] + 2; i < tr.length; i += 2) tc.lineTo(tr[i] * S, tr[i + 1] * S);
      tc.stroke(); drawn[k] = tr.length - 2;
    }
    if ($('lyTrail').checked) c.drawImage(trails[k], 0, 0);
    c.fillStyle = COLORS[k]; c.strokeStyle = '#06101c'; c.lineWidth = 2;   // robot
    c.beginPath(); c.arc(sim.x * S, sim.y * S, 1.7 * S, 0, 7); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(sim.x * S, sim.y * S);
    c.lineTo((sim.x + Math.cos(sim.th) * 1.7) * S, (sim.y + Math.sin(sim.th) * 1.7) * S); c.stroke();
  }

  /* ---------- métricas ---------- */
  const fmtT = s => { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const pct = x => (x * 100).toFixed(1);
  const f1 = x => x.toFixed(1);
  // energía de batería (Wh) -> pesos MXN en el recibo
  const costo = wh => wh / EFF_CARGA / 1000 * TARIFAS[$('tarifa').value] * ($('iva').checked ? IVA : 1);

  function cards(m) {
    const groups = [
      ['Superficie', [
        ['Casa (suelo libre)', f1(m.areaTotal), 'm²'],
        ['A barrer (alcanzable)', f1(m.areaReach), 'm²'],
        ['Barrida efectivamente', f1(m.area), 'm²'],
        ['Pendiente (de menos)', f1(m.pending), 'm²', 'less'],
        ['Re-barrida (de más)', f1(m.rePass), 'm²', 'more'],
        ['Total pasado', f1(m.gross), 'm²'],
      ]],
      ['Limpieza', [
        ['Cobertura', pct(m.coverage), '%'],
        ['Factor de barrido', (m.areaReach ? m.gross / m.areaReach : 0).toFixed(2), '×'],
        ['Redundancia', pct(m.redundancy), '%'],
        ['Efectividad', pct(m.coverage * m.energyEff), '%'],
        ['Efic. trayectoria', pct(m.pathEff), '%'],
        ['Efic. energética', pct(m.energyEff), '%'],
      ]],
      ['Consumo y costo', [
        ['Tiempo', fmtT(m.time), 'min:s'],
        ['Distancia', m.dist.toFixed(0), 'm'],
        ['Energía gastada', m.energy.toFixed(1), 'Wh'],
        ['Energía sin área nueva', pct(m.wastedPct), '%'],
        ['Costo de esta limpieza', '$' + costo(m.energy).toFixed(3), 'MXN'],
        ['Costo al mes (1 diaria)', '$' + (costo(m.energy) * 30).toFixed(2), 'MXN'],
        ['Choques', m.bumps, ''],
      ]],
    ];
    $('cards').innerHTML = groups.map(g => '<div class="cardgroup"><h4>' + g[0] + '</h4><div class="grid">' +
      g[1].map(i => '<div class="card ' + (i[3] || '') + '"><small>' + i[0] + '</small><b>' + i[1] + '<em>' + i[2] + '</em></b></div>').join('') +
      '</div></div>').join('');
  }

  function histogram(sim) {
    const h = sim.histogram(), tot = h.reduce((a, b) => a + b, 0) || 1;
    const cols = ['#2f9e7a', '#d9a441', '#e8743b', '#e5484d'], lab = ['1', '2', '3–4', '5+'];
    $('hist').innerHTML = h.map((n, i) => n ? '<div style="flex:' + n + ';background:' + cols[i] + '" title="' + lab[i] + ' veces: ' + (n * CELL_M * CELL_M).toFixed(1) + ' m²">' + (n / tot > .1 ? lab[i] + '×' : '') + '</div>' : '').join('');
  }

  // filas de la comparación: n = valor numérico para resaltar al mejor (d = 1 más es mejor, -1 menos es mejor)
  // f = true: solo compiten los robots que llegaron al 95 % de cobertura
  const ROWS = [
    { sep: 'Superficie' },
    { t: 'A barrer', v: m => f1(m.areaReach) + ' m²' },
    { t: 'Barrida efectivamente', v: m => f1(m.area) + ' m²', n: m => m.area, d: 1 },
    { t: 'Pendiente (de menos)', v: m => f1(m.pending) + ' m²', n: m => m.pending, d: -1 },
    { t: 'Re-barrida (de más)', v: m => f1(m.rePass) + ' m²', n: m => m.rePass, d: -1, f: true },
    { t: 'Total pasado', v: m => f1(m.gross) + ' m²' },
    { t: 'Factor de barrido', v: m => (m.gross / m.areaReach).toFixed(2) + '×', n: m => m.gross / m.areaReach, d: -1, f: true },
    { sep: 'Resultado' },
    { t: 'Cobertura', v: m => pct(m.coverage) + '%', n: m => m.coverage, d: 1 },
    { t: 'Redundancia', v: m => pct(m.redundancy) + '%', n: m => m.redundancy, d: -1, f: true },
    { t: 'Efic. energética', v: m => pct(m.energyEff) + '%', n: m => m.energyEff, d: 1, f: true },
    { t: 'Efectividad', v: m => pct(m.coverage * m.energyEff) + '%', n: m => m.coverage * m.energyEff, d: 1 },
    { sep: 'Consumo y costo' },
    { t: 'Tiempo a 95 %', v: m => m.at95 ? fmtT(m.at95.t) : '—', n: m => m.at95 ? m.at95.t : null, d: -1, f: true },
    { t: 'Distancia', v: m => m.dist.toFixed(0) + ' m', n: m => m.dist, d: -1, f: true },
    { t: 'Energía', v: m => m.energy.toFixed(1) + ' Wh', n: m => m.energy, d: -1, f: true },
    { t: 'Costo/limpieza', v: m => '$' + costo(m.energy).toFixed(3), n: m => m.energy, d: -1, f: true },
    { t: 'Costo/año', v: m => '$' + (costo(m.energy) * 365).toFixed(0), n: m => m.energy, d: -1, f: true },
    { t: 'Estado', v: m => m.done ? '✔' : '…' },
  ];

  function table() {
    const ms = KEYS.map(k => sims[k].metrics());
    const allDone = ms.every(m => m.done);
    const winners = row => {
      if (!row.d || !allDone) return -1;
      const idx = ms.map((m, i) => i).filter(i => (!row.f || ms[i].coverage >= 0.95) && row.n(ms[i]) !== null);
      if (idx.length < 2) return -1;
      return idx.reduce((a, b) => (row.d > 0 ? row.n(ms[b]) > row.n(ms[a]) : row.n(ms[b]) < row.n(ms[a])) ? b : a);
    };
    $('cmp').innerHTML = '<thead><tr><th>Métrica</th>' + KEYS.map(k => '<th><i style="background:' + COLORS[k] + '"></i>' + ALGOS[k].name + '</th>').join('') + '</tr></thead><tbody>' +
      ROWS.map(r => {
        if (r.sep) return '<tr class="sep"><th colspan="' + (KEYS.length + 1) + '">' + r.sep + '</th></tr>';
        const w = winners(r);
        return '<tr><th>' + r.t + '</th>' + ms.map((m, i) => '<td class="' + (i === w ? 'best' : '') + '">' + r.v(m) + '</td>').join('') + '</tr>';
      }).join('') + '</tbody>';
  }

  function chart() {
    const c = $('chart'), g = c.getContext('2d'), w = c.width, h = c.height, L = 46, B = 34, T = 34, Rr = 12;
    g.clearRect(0, 0, w, h);
    g.font = '12px system-ui,sans-serif'; g.fillStyle = '#93a0b6'; g.strokeStyle = '#242d3d'; g.lineWidth = 1; g.setLineDash([]);
    const maxE = Math.min(BATTERY_WH, Math.max(5, Math.ceil(Math.max(...KEYS.map(k => sims[k].energy)) / 5) * 5));
    const X = e => L + (e / maxE) * (w - L - Rr), Y = v => T + (1 - v) * (h - T - B);
    g.textAlign = 'right';
    for (let v = 0; v <= 1.001; v += 0.25) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - Rr, Y(v)); g.stroke(); g.fillText(Math.round(v * 100) + '%', L - 6, Y(v) + 4); }
    g.textAlign = 'center';
    for (let e = 0; e <= maxE; e += maxE / 5) g.fillText(e + ' Wh', X(e), h - 14);
    g.setLineDash([5, 4]); g.strokeStyle = '#5b6b86'; g.beginPath(); g.moveTo(L, Y(.95)); g.lineTo(w - Rr, Y(.95)); g.stroke();
    KEYS.forEach(k => {
      const s = sims[k]; g.setLineDash(DASH[k]); g.strokeStyle = COLORS[k]; g.lineWidth = 2.4; g.beginPath();
      s.hist.forEach((p, i) => { const x = X(Math.min(p[0], maxE)), y = Y(p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
      const last = s.hist[s.hist.length - 1];
      g.setLineDash([]); g.fillStyle = COLORS[k]; g.beginPath(); g.arc(X(Math.min(last[0], maxE)), Y(last[1]), 3.5, 0, 7); g.fill();
    });
    g.textAlign = 'left'; g.lineWidth = 2.4;      // leyenda con el mismo trazo que la línea
    let lx = L;
    KEYS.forEach(k => {
      g.setLineDash(DASH[k]); g.strokeStyle = COLORS[k]; g.beginPath(); g.moveTo(lx, 14); g.lineTo(lx + 26, 14); g.stroke();
      g.setLineDash([]); g.fillStyle = '#93a0b6'; g.fillText(ALGOS[k].name, lx + 32, 18);
      lx += 32 + g.measureText(ALGOS[k].name).width + 16;
    });
    g.setLineDash([]);
  }

  function summary() {
    const rows = KEYS.map(k => ({ k, m: sims[k].metrics() }));
    if (!rows.every(r => r.m.done)) { $('summary').hidden = true; return; }
    const eff = r => r.m.coverage * r.m.energyEff;
    const best = rows.reduce((a, b) => eff(b) > eff(a) ? b : a);
    const pl = rows.find(r => r.k === 'planned').m;
    let t = '<b>Resultado:</b> con ' + ($('moved').checked ? 'los muebles movidos' : 'la casa original') + ', el robot más efectivo es <b>' + ALGOS[best.k].name +
      '</b> (' + pct(eff(best)) + ' % de efectividad, ' + pct(best.m.coverage) + ' % de la superficie barrida, ' + f1(best.m.rePass) + ' m² re-barridos de más).';
    if (pl.coverage < 0.9) t += ' El zigzag planificado solo barrió ' + pct(pl.coverage) + ' % (' + f1(pl.pending) + ' m² pendientes) porque su plano guardado ya no coincide con la casa.';
    $('summary').innerHTML = t; $('summary').hidden = false;
  }

  function update() {
    const sim = sims[sel], m = sim.metrics();
    KEYS.forEach(k => {
      if (figs[k].hidden) return;
      draw(k);
      const mk = sims[k].metrics();
      figs[k].querySelector('span').textContent = pct(mk.coverage) + ' % · ' + mk.energy.toFixed(1) + ' Wh';
    });
    cards(m);
    $('batBar').style.width = (m.battery * 100).toFixed(1) + '%';
    $('batBar').style.background = m.battery < 0.2 ? '#e5484d' : '';
    $('batTxt').textContent = 'Batería ' + (m.battery * 100).toFixed(0) + '%  ·  ' + m.energy.toFixed(1) + ' / ' + BATTERY_WH + ' Wh';
    $('status').textContent = ALGOS[sel].name + ': ' + (m.done ? m.reason : 'limpiando…');
    $('status').className = 'status' + (m.done ? ' done' : '');
    histogram(sim); table(); chart(); summary();
  }

  /* ---------- bucle de animación ---------- */
  let frame = 0;
  function loop() {
    frame++;
    if (playing && !ff) {
      const n = +$('speed').value;
      KEYS.forEach(k => { const s = sims[k]; for (let i = 0; i < n && !s.done; i++) s.step(); });
    }
    if ((playing && !ff && frame % 2 === 0) || frame % 30 === 0) update();
    requestAnimationFrame(loop);
  }
  ['lyTrail', 'lyHeat', 'lyFog', 'tarifa', 'iva'].forEach(id => $(id).onchange = () => update());

  make(); applyView(); update(); requestAnimationFrame(loop);
  window.__roomba = { get sims() { return sims; }, get env() { return env; } };
})();
