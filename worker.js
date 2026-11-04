/* Worker: corre muchas simulaciones fuera del hilo de la página, para que la interfaz no se congele.
 * Recibe { cfg, scenarios: [{ house, moved, opts }], seeds, algos } y devuelve las métricas de cada semilla.
 */
importScripts('sim.js?v=5', 'ai.js?v=5');

self.onmessage = e => {
  const S = self.RoombaSim;
  const { cfg, scenarios, seeds, algos } = e.data;
  Object.assign(S.CFG, cfg);                       // mismos supuestos que la página
  const total = scenarios.length * algos.length * seeds;
  let n = 0;
  const results = [];
  scenarios.forEach((sc, si) => {
    const env = S.buildEnv(sc.moved, sc.house);
    algos.forEach(algo => {
      const rows = [];
      for (let seed = 1; seed <= seeds; seed++) {
        const s = new S.Sim(algo, seed, env, sc.opts);
        const cap = sc.opts && sc.opts.recharge ? 200000 : 70000;
        while (!s.done && s.stepN < cap) s.step();
        const m = s.metrics();
        rows.push({
          cov: m.coverage, eff: m.coverage * m.energyEff, energy: m.energy, time: m.timeTotal / 60, redundancy: m.redundancy,
          rePass: m.rePass, pending: m.pending, bumps: m.bumps, recharges: m.recharges,
        });
        if (++n % 4 === 0 || n === total) self.postMessage({ type: 'progress', done: n, total });
      }
      results.push({ si, algo, rows });
    });
  });
  self.postMessage({ type: 'done', results, total });
};
