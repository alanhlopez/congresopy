// Piezas de interfaz reutilizadas entre páginas.
import { el } from "./dom.js";
import { enlace } from "./estado.js";
import { VOTOS, fecha, iniciales, numero, partidoClase, partidoNombre, porcentaje } from "./formato.js";

export const chipPartido = (p) =>
  el("span", { class: ["chip", "chip-partido", partidoClase(p)], title: partidoNombre(p) }, p || "—");

export const chipVoto = (codigo) => {
  const v = VOTOS[codigo] || VOTOS["-"];
  return el("span", { class: ["chip", "chip-voto", v.clase] }, v.etiqueta);
};

export const avatar = (l, grande = false) =>
  el("span", { class: ["avatar", partidoClase(l.partido), grande && "avatar-grande"], "aria-hidden": "true" }, iniciales(l.nombre));

export const enlaceLegislador = (l, camara) => enlace("legislador.html", { camara, id: l.id });
export const enlaceVotacion = (v, camara) => enlace("votacion.html", { camara, id: v.id });

/** Barra apilada con los totales de una votación (Sí / No / Abst / Ausente / No vota / mociones). */
export function barraTotales(t, { conLeyenda = false } = {}) {
  const partes = [
    ["si", "S"], ["mocion_1", "1"], ["mocion_2", "2"], ["mocion_3", "3"], ["no", "N"],
    ["abstencion", "A"], ["no_vota", "V"], ["ausente", "X"],
  ].filter(([k]) => t[k] > 0);
  const total = t.total || partes.reduce((s, [k]) => s + t[k], 0);
  const barra = el("div", { class: "barra-totales", role: "img",
    "aria-label": partes.map(([k, c]) => `${VOTOS[c].etiqueta}: ${t[k]}`).join(", ") },
  partes.map(([k, c]) => el("span", { class: ["seg", VOTOS[c].clase], vars: { "--w": `${(100 * t[k]) / total}%` },
    title: `${VOTOS[c].etiqueta}: ${t[k]}` })));
  if (!conLeyenda) return barra;
  return el("div", { class: "totales" }, barra,
    el("ul", { class: "leyenda" }, partes.map(([k, c]) =>
      el("li", {}, el("span", { class: ["punto", VOTOS[c].clase], "aria-hidden": "true" }), `${VOTOS[c].etiqueta} `,
        el("strong", {}, numero(t[k]))))));
}

/** Anillo de porcentaje (SVG). */
export function anillo(x, etiqueta) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return el("svg:svg", { class: "anillo", viewBox: "0 0 100 100", role: "img", "aria-label": `${etiqueta}: ${porcentaje(x)}` },
    el("svg:circle", { cx: 50, cy: 50, r, class: "anillo-fondo" }),
    el("svg:circle", { cx: 50, cy: 50, r, class: "anillo-valor", "stroke-dasharray": `${(x * c).toFixed(1)} ${c.toFixed(1)}`,
      transform: "rotate(-90 50 50)" }),
    el("svg:text", { x: 50, y: 50, class: "anillo-texto", "text-anchor": "middle", "dominant-baseline": "central" },
      `${Math.round(x * 100)}%`));
}

/** Fila de una votación para listados. */
export function filaVotacion(v, camara, extra = null) {
  return el("li", { class: "fila-votacion" },
    el("a", { href: enlaceVotacion(v, camara), class: "fila-votacion__link" },
      el("span", { class: "fila-votacion__meta" },
        el("time", { datetime: v.fecha }, fecha(v.fecha)),
        el("span", {}, v.es_ley ? "Proyecto de ley" : tipoCorto(v.tipo_proyecto)),
        v.expediente && el("span", {}, v.expediente)),
      el("span", { class: "fila-votacion__titulo" }, v.titulo),
      el("span", { class: "fila-votacion__pie" },
        el("span", { class: "resultado" }, v.resultado || "Sin resultado publicado"),
        extra)),
    barraTotales(v.totales));
}

export function tipoCorto(t) {
  if (!t) return "Otro";
  const s = t.split(/\s[-(]/)[0].trim();
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/** Paginación simple: "Mostrar N más". */
export function listaPaginada(contenedor, items, render, { paso = 40, vacio = "No hay resultados." } = {}) {
  let mostrados = 0;
  const ul = el("ul", { class: "lista" });
  const mas = el("button", { type: "button", class: "boton boton-secundario" });
  const pie = el("div", { class: "lista-pie" }, mas);
  function siguiente() {
    const fin = Math.min(items.length, mostrados + paso);
    for (let k = mostrados; k < fin; k++) ul.append(render(items[k]));
    mostrados = fin;
    const faltan = items.length - mostrados;
    mas.hidden = faltan <= 0;
    mas.textContent = `Mostrar ${numero(Math.min(paso, faltan))} más (quedan ${numero(faltan)})`;
  }
  mas.addEventListener("click", siguiente);
  contenedor.replaceChildren(items.length ? ul : el("p", { class: "vacio" }, vacio), pie);
  siguiente();
}
