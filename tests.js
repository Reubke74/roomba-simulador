/* Pruebas automáticas del simulador. Sirven en Node (npm test) y en el navegador (tests.html).
 * Comprueban los resultados de referencia con la semilla 7 y las afirmaciones que muestra la página.
 * Si cambias a propósito el comportamiento de un robot, actualiza la tabla REF.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports && typeof document === 'undefined';
  if (isNode) { root.RoombaSim = require('./sim.js'); require('./ai.js'); }
  const { Sim, buildEnv, BATTERY_WH } = root.RoombaSim;
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
      if (m.energy > BATTERY_WH + 0.01) throw new Error('energía ' + m.energy + ' Wh supera la batería');
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
