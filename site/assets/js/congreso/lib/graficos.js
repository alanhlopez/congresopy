// Piezas de gráficos en SVG propio (sin librerías): escalas, ejes, enjambre de puntos y etiquetas sin solaparse.
import { el } from "./dom.js";

export const escala = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

/** Límite inferior «redondo» para un eje de porcentajes (0..1): baja al múltiplo de 0,1 anterior. */
export const pisoDecena = (x) => Math.max(0, Math.floor(x * 10 - 1e-9) / 10);

/** Ancho disponible de un contenedor (con un mínimo, para no dibujar en 0 si todavía no se ve). */
export const anchoDe = (n) => Math.max(280, Math.floor(n.getBoundingClientRect().width));

/** Eje horizontal de porcentajes con líneas guía. */
export function ejePorcentaje(x, d0, y0, y1, { paso = 0.1, etiquetas = true } = {}) {
  const g = el("svg:g", { class: "eje", "aria-hidden": "true" });
  for (let v = d0; v <= 1 + 1e-9; v += paso) {
    const px = x(v);
    g.append(el("svg:line", { x1: px, x2: px, y1: y0, y2: y1, class: "eje__guia" }));
    if (etiquetas) g.append(el("svg:text", { x: px, y: y1 + 16, class: "eje__texto", "text-anchor": "middle" }, `${Math.round(v * 100)}%`));
  }
  return g;
}

/**
 * Enjambre (beeswarm): ubica cada punto en x y busca el desplazamiento vertical más chico que no lo superponga
 * con los ya ubicados. Devuelve [{...item, cx, dy}] y la altura máxima usada (en unidades de dy).
 */
export function enjambre(items, x, r, { separacion = 1 } = {}) {
  const d = 2 * r + separacion;
  const ubicados = [];
  const orden = [...items].sort((a, b) => x(a.valor) - x(b.valor));
  let max = 0;
  for (const it of orden) {
    const cx = x(it.valor);
    const cercanos = ubicados.filter((u) => Math.abs(u.cx - cx) < d);
    let dy = 0;
    for (let k = 0; k < 400; k++) {
      const cand = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (d / 2);
      if (cercanos.every((u) => (u.cx - cx) ** 2 + (u.dy - cand) ** 2 >= d * d)) { dy = cand; break; }
    }
    ubicados.push({ ...it, cx, dy });
    max = Math.max(max, Math.abs(dy));
  }
  return { puntos: ubicados, max };
}

/** Ancho aproximado de un texto en px (sin medir el DOM): suficiente para evitar solapamientos de etiquetas. */
export const anchoTexto = (t, tam = 12) => t.length * tam * 0.56;

/**
 * Coloca etiquetas en filas para que no se solapen horizontalmente. Cada etiqueta: {x, texto}. Devuelve
 * [{...etiqueta, fila, ancla}] con ancla "start" o "end" según el borde.
 */
export function filasDeEtiquetas(etiquetas, ancho, { tam = 12, margen = 6 } = {}) {
  const filas = [];
  return etiquetas.map((e) => {
    const w = anchoTexto(e.texto, tam);
    const ancla = e.x + w > ancho - margen ? "end" : "start";
    const ini = ancla === "start" ? e.x : e.x - w;
    let fila = filas.findIndex((ocup) => ocup.every(([a, b]) => ini + w + margen < a || ini > b + margen));
    if (fila === -1) { fila = filas.length; filas.push([]); }
    filas[fila].push([ini, ini + w]);
    return { ...e, fila, ancla };
  });
}
