# Simulador de aspiradora robot: sin IA y con IA

Sitio estático (HTML + JS, sin dependencias). Compara cuatro estrategias de limpieza en dos habitaciones:
aleatoria, espiral + pared, zigzag planificado (sin IA) y un robot con IA que mapea y planifica.

Muestra trayectorias, superficie a barrer / barrida / pendiente / re-barrida, consumo, costo en pesos
(tarifa doméstica 1 de CFE), eficiencia, redundancia y efectividad. Incluye el escenario «Muebles movidos».

## Archivos
- `index.html`, `style.css`: página.
- `sim.js`: casa, robots sin IA y métricas. `ai.js`: robot con IA. `app.js`: interfaz.
- `render.yaml`: configuración de Render (sitio estático, raíz del repositorio).

## Probar en local

    python -m http.server 8765

## Supuestos que conviene verificar
- Precios de CFE (`TARIFAS` en `app.js`): tomados de prensa para junio de 2026; confirmar en cfe.mx.
- Consumo (18 W en marcha, +3 W del sensor de la IA), batería de 30 Wh y pérdidas del cargador (0.85): valores ilustrativos.

## Publicar
Render redespliega solo al cambiar el repositorio. Al cambiar archivos, sube también el número `?v=` de los
`<script>` y la hoja de estilos en `index.html` para evitar que el navegador use copias viejas.
