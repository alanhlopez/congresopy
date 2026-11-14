// Hemiciclo en SVG, sin librerías (algoritmo estándar de gráfico de parlamento):
// 1. Filas concéntricas entre un radio interno (0,4 R) y R. Se elige la cantidad de filas con la que la
//    separación entre asientos a lo largo del arco queda más parecida a la separación entre filas: la grilla
//    queda pareja, sin huecos ni amontonamientos.
// 2. Los asientos se reparten entre filas en proporción al radio (método de restos mayores), así la
//    separación a lo largo del arco es la misma en todas las filas.
// 3. Todos los asientos se ordenan por ángulo (de izquierda a derecha) y se asignan en ese orden a los items
//    ya ordenados: cada grupo ocupa una cuña que atraviesa todas las filas.
import { el } from "./dom.js";

const R = 100;
const R0 = 40;

function disposicion(n) {
  let mejor = null;
  for (let filas = 2; filas <= 12; filas++) {
    const radios = Array.from({ length: filas }, (_, k) => R0 + ((R - R0) * k) / (filas - 1));
    const suma = radios.reduce((a, b) => a + b, 0);
    const arco = (Math.PI * suma) / Math.max(n, 1);            // separación entre asientos a lo largo del arco
    const entreFilas = (R - R0) / (filas - 1);
    const error = Math.abs(Math.log(arco / entreFilas));
    if (!mejor || error < mejor.error) mejor = { filas, radios, suma, arco, entreFilas, error };
  }
  return mejor;
}

/**
 * @param {Array} items   ya ordenados de izquierda a derecha
 * @param {Object} o      claseDe(item) -> clase de color, enlaceDe(item) -> href, tituloDe(item) -> nombre accesible
 *                        y tooltip, etiqueta -> aria-label del gráfico
 */
export function hemiciclo(items, { claseDe, enlaceDe, tituloDe, etiqueta }) {
  const n = items.length;
  const { radios, suma, arco, entreFilas } = disposicion(n);

  // Asientos por fila, proporcionales al radio (restos mayores)
  const exactos = radios.map((r) => (n * r) / suma);
  const cupos = exactos.map(Math.floor);
  const orden = exactos.map((x, k) => [x - Math.floor(x), k]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (let i = 0, resto = n - cupos.reduce((a, b) => a + b, 0); i < resto; i++) cupos[orden[i % orden.length][1]] += 1;

  const asientos = [];
  radios.forEach((r, k) => {
    const m = cupos[k];
    for (let j = 0; j < m; j++) {
      const ang = m === 1 ? Math.PI / 2 : Math.PI * (1 - j / (m - 1));
      asientos.push({ ang, r, x: r * Math.cos(ang), y: -r * Math.sin(ang) });
    }
  });
  asientos.sort((a, b) => b.ang - a.ang || a.r - b.r);

  const radioPunto = 0.32 * Math.min(arco, entreFilas);
  const margen = radioPunto + 2;
  const svg = el("svg:svg", {
    class: "hemiciclo", viewBox: `${-R - margen} ${-R - margen} ${2 * (R + margen)} ${R + 2 * margen}`,
    // Con links, cada asiento es un elemento con nombre propio; sin links, el gráfico es una imagen.
    role: enlaceDe ? "group" : "img", "aria-label": etiqueta, preserveAspectRatio: "xMidYMid meet",
  });
  items.forEach((it, k) => {
    const a = asientos[k];
    const titulo = tituloDe(it);
    const c = el("svg:circle", { cx: a.x.toFixed(2), cy: a.y.toFixed(2), r: radioPunto.toFixed(2), class: ["asiento", claseDe(it)] },
      el("svg:title", {}, titulo));
    const href = enlaceDe && enlaceDe(it);
    svg.append(href ? el("svg:a", { href, class: "asiento-link", "aria-label": titulo }, c) : c);
  });
  return svg;
}
