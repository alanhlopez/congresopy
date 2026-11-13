// Hemiciclo en SVG, sin librerías. Los asientos se reparten en filas proporcionales al radio y se
// asignan por ángulo (de izquierda a derecha), así cada grupo ocupa una cuña.
import { el } from "./dom.js";

/**
 * @param {Array} items   ya ordenados de izquierda a derecha
 * @param {Object} o      claseDe(item) -> clase de color, enlaceDe(item) -> href, tituloDe(item) -> tooltip,
 *                        etiqueta -> aria-label del gráfico
 */
export function hemiciclo(items, { claseDe, enlaceDe, tituloDe, etiqueta }) {
  const n = items.length;
  const filas = n <= 24 ? 3 : n <= 60 ? 4 : n <= 120 ? 5 : 6;
  const R = 100;
  const r0 = 38;
  const radios = Array.from({ length: filas }, (_, k) => r0 + ((R - r0) * k) / (filas - 1));
  const suma = radios.reduce((a, b) => a + b, 0);
  const cupos = radios.map((r) => Math.floor((n * r) / suma));
  let resto = n - cupos.reduce((a, b) => a + b, 0);
  for (let k = filas - 1; resto > 0; k = (k - 1 + filas) % filas) { cupos[k] += 1; resto -= 1; }

  const asientos = [];
  radios.forEach((r, k) => {
    const m = cupos[k];
    for (let j = 0; j < m; j++) {
      const ang = m === 1 ? Math.PI / 2 : Math.PI * (1 - j / (m - 1));
      asientos.push({ ang, r, x: r * Math.cos(ang), y: -r * Math.sin(ang) });
    }
  });
  asientos.sort((a, b) => b.ang - a.ang || a.r - b.r);

  const separacionFila = (R - r0) / (filas - 1);
  const separacionArco = Math.min(...radios.map((r, k) => (cupos[k] > 1 ? (Math.PI * r) / (cupos[k] - 1) : Infinity)));
  const radioPunto = 0.42 * Math.min(separacionFila, separacionArco);
  const m = radioPunto + 1;

  const svg = el("svg:svg", {
    class: "hemiciclo", viewBox: `${-R - m} ${-R - m} ${2 * (R + m)} ${R + 2 * m}`,
    role: "img", "aria-label": etiqueta, preserveAspectRatio: "xMidYMid meet",
  });
  items.forEach((it, k) => {
    const a = asientos[k];
    const c = el("svg:circle", { cx: a.x.toFixed(2), cy: a.y.toFixed(2), r: radioPunto.toFixed(2), class: ["asiento", claseDe(it)] },
      el("svg:title", {}, tituloDe(it)));
    const href = enlaceDe && enlaceDe(it);
    svg.append(href ? el("svg:a", { href, class: "asiento-link" }, c) : c);
  });
  return svg;
}
