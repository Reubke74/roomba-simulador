# Simulador de aspiradora robot: sin IA y con IA

Sitio estático (HTML + JS, sin dependencias). Compara cuatro estrategias de limpieza en varias casas:
aleatoria, espiral + pared, zigzag planificado (sin IA) y un robot con IA que mapea y planifica.

Muestra trayectorias, superficie a barrer / barrida / pendiente / re-barrida, consumo, costo en pesos
(tarifa doméstica 1 de CFE), eficiencia, redundancia y efectividad.

## Qué incluye
- **Casas:** dos habitaciones, tres habitaciones y estudio abierto, cada una con su variante de muebles movidos.
- **Escenarios:** muebles movidos (el zigzag conserva su plano viejo), alfombras (gastan más energía),
  mascota (obstáculo móvil), recarga a mitad de limpieza y láser de la IA con ruido.
- **Supuestos editables:** batería, potencias, eficiencia del cargador y tiempo de carga, con un perfil de
  referencia (Roborock S7, datos de listados comerciales).
- **Estadística:** repite cada robot con muchas semillas en un Web Worker (promedio ± desviación estándar).
- **Modo claro y oscuro.**

## Archivos
- `index.html`, `style.css`, `app.js`: página e interfaz.
- `sim.js`: casas, robots sin IA y métricas. `ai.js`: robot con IA. `worker.js`: estadística en segundo plano.
- `tests.js`, `tests.html`, `package.json`: pruebas automáticas.
- `render.yaml`: configuración de Render (sitio estático, raíz del repositorio).

## Probar en local

    python -m http.server 8765

## Pruebas automáticas
`tests.js` comprueba el motor: resultados de referencia con la semilla 7, invariantes (cuentas coherentes, energía
dentro de la batería), todas las casas y escenarios, y las afirmaciones que muestra la página (42 pruebas, unos
segundos). Se ejecutan de dos formas:

    npm test          # en la terminal (requiere Node)

o abriendo `tests.html` en el navegador (también en el sitio publicado). Si cambias a propósito el comportamiento de un
robot, actualiza la tabla `REF` de `tests.js`.

## Supuestos que conviene verificar
- Precios de CFE (`TARIFAS` en `app.js`): tomados de la página oficial de la Tarifa 1 (app.cfe.mx) para noviembre de 2026.
  CFE los cambia cada mes; hay que actualizarlos.
- Perfil por defecto (batería de 30 Wh, 18 W en marcha, +3 W del sensor de la IA): ilustrativo. El perfil «Roborock S7»
  usa la batería y autonomía de los listados, pero el reparto de potencias entre cepillo, tracción y sensor es una estimación.

## Publicar
Render redespliega solo al cambiar el repositorio (`git push`). Al cambiar archivos, sube también el número `?v=` de los
`<script>`, la hoja de estilos y `worker.js` en `index.html` para evitar que el navegador use copias viejas.
