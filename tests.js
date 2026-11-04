/* Pruebas automáticas del simulador. Sirven en Node (npm test) y en el navegador (tests.html).
 * Comprueban los resultados de referencia con la semilla 7 y las afirmaciones que muestra la página.
 * Si cambias a propósito el comportamiento de un robot, actualiza la tabla REF.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports && typeof document === 'undefined';
  if (isNode) { root.RoombaSim = require('./sim.js'); require('./ai.js'); }
  const { Sim, buildEnv, CFG } = root.RoombaSim;
  const SEED = 7, MAX_STEPS = 70000;

  // Resultados de referencia con la semilla 7 (cobertura, energía en Wh, distancia en m)
  const REF = {
    orig:  { random: [0.95, 9.52, 434.5],   roomba: [0.95, 11.105, 578.8], planned: [0.9776, 2.294, 117.3], ai: [0.999, 2.868, 123.4] },
    moved: { random: [0.9503, 10.694, 489.1], roomba: [0.9503, 10.252, 524.2], planned: [0.5272, 2.93, 99.1], ai: [0.999, 3.079, 133.3] },
  };
  const ALGOS = ['random', 'roomba', 'planned', 'ai'];
  const LAYOUTS = ['orig', 'moved'];
  const NAME = { orig: 'casa original', moved: 'muebles movidos', random: 'aleatorio', roomba: 'espiral + pared', planned: 'zigzag planificado', ai: 'robot con IA' };

  const envs = {}, cache = {};
  const env = l => envs[l] || (envs[l] = buildEnv(l === 'moved'));
  function run(algo, layout, seed) {
    const key = algo + layout + (seed || SEED);
    if (!cache[key]) {
      const s = new Sim(algo, seed || SEED, env(layout));
      while (!s.done && s.stepN < MAX_STEPS) s.step();
      cache[key] = { s, m: s.metrics() };
    }
    return cache[key];
  }
  const eff = r => r.m.coverage * r.m.energyEff;
  const near = (a, b, rel) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * rel);

  const tests = [];
  const sep = t => tests.push({ sep: t });
  const test = (name, fn) => tests.push({ name, fn });

  sep('Casa');
  test('Casa original: 2862 cuadros a barrer y 2933 libres', () => {
    const e = env('orig'); if (e.nClean !== 2862 || e.nFree !== 2933) throw new Error('nClean=' + e.nClean + ', nFree=' + e.nFree);
  });
  test('Casa con muebles movidos: 2938 a barrer y 2977 libres', () => {
    const e = env('moved'); if (e.nClean !== 2938 || e.nFree !== 2977) throw new Error('nClean=' + e.nClean + ', nFree=' + e.nFree);
  });
  LAYOUTS.forEach(l => test('Las dos habitaciones son alcanzables por la puerta (' + NAME[l] + ')', () => {
    const e = env(l); let left = 0, right = 0;
    for (let c = 0; c < e.reach.length; c++) if (e.reach[c]) { if (c % 102 < 60) left++; else if (c % 102 > 61) right++; }
    if (!left || !right) throw new Error('izquierda=' + left + ', derecha=' + right);
  }));
  test('El plano guardado del zigzag es el de la casa original, también con muebles movidos', () => {
    if (JSON.stringify(env('moved').plan) !== JSON.stringify(env('orig').plan)) throw new Error('el plan no es el original');
    if (!env('moved').stale || env('orig').stale) throw new Error('bandera stale incorrecta');
  });

  sep('Determinismo');
  test('La misma semilla da exactamente el mismo resultado (robot con IA)', () => {
    const a = run('ai', 'orig'), b = new Sim('ai', SEED, env('orig'));
    while (!b.done && b.stepN < MAX_STEPS) b.step();
    if (a.s.energy !== b.energy || a.s.cleaned !== b.cleaned || a.s.stepN !== b.stepN) throw new Error('difieren');
  });
  test('Otra semilla cambia el resultado del robot aleatorio', () => {
    if (run('random', 'orig').s.energy === run('random', 'orig', 3).s.energy) throw new Error('iguales');
  });

  LAYOUTS.forEach(l => {
    sep('Invariantes · ' + NAME[l]);
    ALGOS.forEach(a => test(NAME[a] + ': termina, cuentas coherentes y energía dentro de la batería', () => {
      const { s, m } = run(a, l);
      if (!s.done) throw new Error('no terminó en ' + MAX_STEPS + ' pasos');
      if (m.coverage < 0 || m.coverage > 1) throw new Error('cobertura fuera de rango: ' + m.coverage);
      if (!near(m.area + m.pending, m.areaReach, 1e-6)) throw new Error('barrida + pendiente ≠ a barrer');
      if (m.gross + 1e-9 < m.area) throw new Error('total pasado menor que lo barrido');
      let sum = 0; for (let c = 0; c < s.visits.length; c++) sum += s.visits[c];
      if (sum !== s.totalVisits) throw new Error('suma de visitas ' + sum + ' ≠ ' + s.totalVisits);
      if (m.energy > CFG.battery + 0.01) throw new Error('energía ' + m.energy + ' Wh supera la batería');
    }));
  });

  sep('Resultados de referencia (semilla ' + SEED + ')');
  LAYOUTS.forEach(l => ALGOS.forEach(a => test(NAME[a] + ' · ' + NAME[l] + ': cobertura, energía y distancia', () => {
    const { m } = run(a, l), r = REF[l][a], bad = [];
    if (Math.abs(m.coverage - r[0]) > 0.005) bad.push('cobertura ' + m.coverage.toFixed(4) + ' (ref ' + r[0] + ')');
    if (!near(m.energy, r[1], 0.015)) bad.push('energía ' + m.energy.toFixed(3) + ' Wh (ref ' + r[1] + ')');
    if (!near(m.dist, r[2], 0.015)) bad.push('distancia ' + m.dist.toFixed(1) + ' m (ref ' + r[2] + ')');
    if (bad.length) throw new Error(bad.join('; '));
  })));

  sep('Afirmaciones que muestra la página');
  test('Aleatorio y espiral se detienen al llegar al 95 % de cobertura', () => {
    LAYOUTS.forEach(l => ['random', 'roomba'].forEach(a => {
      const c = run(a, l).m.coverage; if (c < 0.95 || c > 0.96) throw new Error(NAME[a] + ' · ' + NAME[l] + ': ' + c);
    }));
  });
  test('El robot con IA barre al menos 98 % en ambas casas y nunca choca', () => {
    LAYOUTS.forEach(l => { const m = run('ai', l).m; if (m.coverage < 0.98 || m.bumps !== 0) throw new Error(NAME[l] + ': cobertura ' + m.coverage + ', choques ' + m.bumps); });
  });
  test('El robot con IA es al menos 3 veces más efectivo que aleatorio y espiral', () => {
    LAYOUTS.forEach(l => ['random', 'roomba'].forEach(a => {
      const r = eff(run('ai', l)) / eff(run(a, l)); if (r < 3) throw new Error(NAME[a] + ' · ' + NAME[l] + ': solo ' + r.toFixed(2) + '×');
    }));
  });
  test('Casa original: el zigzag planificado es más efectivo que el robot con IA', () => {
    if (!(eff(run('planned', 'orig')) > eff(run('ai', 'orig')))) throw new Error('ya no se cumple');
  });
  test('Muebles movidos: el zigzag deja más de 30 % sin barrer y el robot con IA es más efectivo', () => {
    const p = run('planned', 'moved'), a = run('ai', 'moved');
    if (p.m.coverage > 0.7) throw new Error('el zigzag barrió ' + p.m.coverage);
    if (!(eff(a) > eff(p))) throw new Error('la IA ya no gana en efectividad');
  });
  test('Muebles movidos: el zigzag choca y rodea obstáculos (bumps > 0)', () => {
    if (run('planned', 'moved').m.bumps <= 0) throw new Error('no hubo choques');
  });

  /* ---------- más casas y escenarios ---------- */
  const HOUSES = Object.keys(root.RoombaSim.HOUSES);
  const xc = {};
  function runX(algo, house, moved, opts, seed) {
    const key = [algo, house, moved, JSON.stringify(opts || {}), seed || SEED].join('|');
    if (!xc[key]) {
      const e = buildEnv(moved, house), s = new Sim(algo, seed || SEED, e, opts);
      const cap = opts && opts.recharge ? 200000 : MAX_STEPS;
      while (!s.done && s.stepN < cap) s.step();
      xc[key] = { s, m: s.metrics(), e };
    }
    return xc[key];
  }
  const withCfg = (patch, fn) => {            // aplica supuestos distintos y los restaura siempre
    const old = Object.assign({}, CFG);
    try { Object.assign(CFG, patch); return fn(); } finally { for (const k in CFG) if (!(k in old)) delete CFG[k]; Object.assign(CFG, old); }
  };

  sep('Otras casas');
  HOUSES.forEach(h => [false, true].forEach(mv => test('Casa «' + root.RoombaSim.HOUSES[h].name + '»' + (mv ? ' con muebles movidos' : '') + ': todas las habitaciones alcanzables y los cuatro robots terminan', () => {
    const e = buildEnv(mv, h);
    root.RoombaSim.HOUSES[h].rooms.forEach(r => {
      let n = 0; for (let c = 0; c < e.reach.length; c++) if (e.reach[c] && c % 102 >= r.x0 && c % 102 < r.x1) n++;
      if (!n) throw new Error('la habitación ' + r.n + ' no es alcanzable');
    });
    ALGOS.forEach(a => {
      const { s, m } = runX(a, h, mv);
      if (!s.done) throw new Error(NAME[a] + ' no terminó');
      if (!near(m.area + m.pending, m.areaReach, 1e-6)) throw new Error(NAME[a] + ': barrida + pendiente ≠ a barrer');
    });
    const ai = runX('ai', h, mv).m;
    if (ai.coverage < 0.97) throw new Error('el robot con IA barrió solo ' + ai.coverage);
  })));

  sep('Escenarios: alfombra, mascota, ruido del láser y recarga');
  test('Alfombra: gasta más energía sin cambiar lo barrido', () => {
    ['random', 'planned', 'ai'].forEach(a => {
      const base = runX(a, 'dos', false).m, car = runX(a, 'dos', false, { carpet: true }).m;
      if (!(car.energy > base.energy) || !(car.carpetWh > 0)) throw new Error(NAME[a] + ': sin sobrecosto de alfombra');
      if (Math.abs(car.coverage - base.coverage) > 1e-9) throw new Error(NAME[a] + ': la alfombra cambió la cobertura');
    });
  });
  test('Mascota: la IA sigue barriendo al menos 98 % en todas las casas', () => {
    HOUSES.forEach(h => { const m = runX('ai', h, false, { pet: true }).m; if (m.coverage < 0.98) throw new Error(h + ': ' + m.coverage); });
  });
  test('Mascota: todos los robots terminan y la trayectoria de la mascota es igual para todos', () => {
    ALGOS.forEach(a => { if (!runX(a, 'dos', false, { pet: true }).s.done) throw new Error(NAME[a] + ' no terminó'); });
    const p1 = new Sim('random', 5, env('orig'), { pet: true }), p2 = new Sim('ai', 5, env('orig'), { pet: true });
    for (let i = 0; i < 300; i++) { p1.step(); p2.step(); }
    if (p1.pet.x !== p2.pet.x || p1.pet.y !== p2.pet.y) throw new Error('la mascota se mueve distinto para cada robot');
  });
  test('Ruido del láser: la IA choca más y gasta más, pero sigue barriendo al menos 95 %', () => {
    const c0 = runX('ai', 'dos', false).m, hi = runX('ai', 'dos', false, { noise: 0.04 }).m;
    if (hi.coverage < 0.95) throw new Error('cobertura ' + hi.coverage);
    if (!(hi.bumps > c0.bumps) || !(hi.energy > c0.energy)) throw new Error('el ruido no empeoró nada: choques ' + hi.bumps + ', energía ' + hi.energy);
  });
  test('Recarga: con batería chica el robot se recarga, el tiempo total incluye la carga y la energía crece', () => {
    withCfg({ battery: 3 }, () => {
      const base = runX('random', 'dos', false).m;                         // sin recarga: se detiene al agotar
      const r = new Sim('random', SEED, env('orig'), { recharge: true });
      while (!r.done && r.stepN < 200000) r.step();
      const m = r.metrics();
      if (m.recharges < 1) throw new Error('no se recargó nunca');
      if (!(m.timeTotal > m.time + m.chargeMin * 60 - 1)) throw new Error('el tiempo total no suma la carga');
      if (m.coverage < 0.95) throw new Error('cobertura ' + m.coverage);
      if (base.reason !== 'Batería agotada' && base.recharges !== 0) throw new Error('el modo sin recarga recargó');
    });
  });
  test('Recarga: con la batería de 30 Wh la IA y el zigzag no necesitan recargarse', () => {
    ['ai', 'planned'].forEach(a => { const m = runX(a, 'dos', false, { recharge: true }).m; if (m.recharges !== 0) throw new Error(NAME[a] + ' se recargó ' + m.recharges); });
  });
  test('Supuestos: el perfil de referencia (Roborock S7) cambia batería y energía, y los supuestos se restauran', () => {
    const before = JSON.stringify(CFG);
    withCfg(root.RoombaSim.PRESETS.s7, () => {
      if (CFG.battery !== 68) throw new Error('batería ' + CFG.battery);
      const e = new Sim('ai', SEED, env('orig')); while (!e.done && e.stepN < MAX_STEPS) e.step();
      if (!(e.energy > run('ai', 'orig').m.energy)) throw new Error('la energía no subió con más potencia');
    });
    if (JSON.stringify(CFG) !== before) throw new Error('los supuestos no se restauraron');
  });

  function runAll() {
    const rows = []; let pass = 0, total = 0;
    const t0 = performance.now();
    tests.forEach(t => {
      if (t.sep) { rows.push({ sep: t.sep }); return; }
      total++;
      try { t.fn(); pass++; rows.push({ ok: true, name: t.name }); }
      catch (e) { rows.push({ ok: false, name: t.name, msg: e.message }); }
    });
    return { rows, pass, total, secs: ((performance.now() - t0) / 1000).toFixed(1) };
  }
  const reset = () => { for (const k in cache) delete cache[k]; };

  if (isNode) {
    const r = runAll();
    r.rows.forEach(x => console.log(x.sep ? '\n' + x.sep : (x.ok ? '  ✔ ' : '  ✘ ') + x.name + (x.msg ? '\n      → ' + x.msg : '')));
    console.log('\n' + r.pass + ' de ' + r.total + ' pruebas pasan (' + r.secs + ' s)');
    process.exitCode = r.pass === r.total ? 0 : 1;
  } else {
    root.RoombaTests = { runAll, reset };
  }
})(typeof window !== 'undefined' ? window : globalThis);
