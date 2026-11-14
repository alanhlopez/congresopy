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

/** Foto de SILpy (si hay) recortada en círculo con aro del color del partido; si no carga, quedan las iniciales. */
export function avatar(l, grande = false) {
  const a = el("span", { class: ["avatar", partidoClase(l.partido), grande && "avatar-grande"], "aria-hidden": "true" },
    iniciales(l.nombre));
  if (l.foto) {
    const lado = grande ? 80 : 40;
    const img = el("img", { src: `datos/congreso/${l.foto}`, alt: "", class: "avatar__foto", width: lado, height: lado,
      loading: grande ? "eager" : "lazy", decoding: "async" });
    img.addEventListener("error", () => { img.remove(); a.classList.remove("avatar--foto"); });
    a.classList.add("avatar--foto");
    a.append(img);
  }
  return a;
}

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

// Etiqueta corta de cada tipo de proyecto de SILpy (el texto original sigue en votaciones.json).
const TIPOS = [
  [/^PROYECTO DE LEY/, "Proyecto de ley"],
  [/^RESOLUCIONES UNICAMERALES/, "Resolución"],
  [/^DECLARACIONES UNICAMERALES/, "Declaración"],
  [/^RESOLUCIONES BICAMERALES/, "Resolución bicameral"],
  [/^ACUERDO CONSTITUCIONAL/, "Acuerdo constitucional"],
  [/^ACUERDO LEGAL/, "Acuerdo legal"],
  [/^DESIGNACIONES/, "Designación"],
  [/^CITACI[ÓO]N E INTERPELACI[ÓO]N/, "Interpelación"],
  [/^JUICIO POL[ÍI]TICO/, "Juicio político"],
  [/^INTERVENCI[ÓO]N/, "Intervención"],
  [/^PEDIDO DE INFORMES/, "Pedido de informes"],
];

export function tipoCorto(t) {
  if (!t) return "Otro";
  for (const [re, etiqueta] of TIPOS) if (re.test(t)) return etiqueta;
  const s = t.split(/\s[-(]/)[0].trim();
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// Resultado: etiqueta legible y tono (positivo, negativo o neutro). Lo que no está en la lista se muestra
// tal como lo publica SILpy, con tono neutro.
const RESULTADOS = {
  "APROBADO": ["Aprobado", "pos"],
  "APROBADO CON MODIFICACIONES": ["Aprobado con modificaciones", "pos"],
  "APROBADAS LAS MODIFICACIONES": ["Aprobadas las modificaciones", "pos"],
  "APRUEBA RESOLUCION UNICAMERAL": ["Aprueba la resolución", "pos"],
  "APRUEBA DECLARACIÓN UNICAMERAL": ["Aprueba la declaración", "pos"],
  "APRUEBA (SANCIONA PARTE NO OBJETADA)": ["Aprueba y sanciona la parte no objetada", "pos"],
  "APRUEBA (NO SANCIONA PARTE NO OBJETADA)": ["Aprueba sin sancionar la parte no objetada", "pos"],
  "APRUEBA EN MAYORIA DE 2/3": ["Aprueba por mayoría de 2/3", "pos"],
  "APRUEBA TERNA": ["Aprueba la terna", "pos"],
  "APRUEBA TERNA (MAYORIA ABSOLUTA)": ["Aprueba la terna (mayoría absoluta)", "pos"],
  "PRESTA EL ACUERDO": ["Presta el acuerdo", "pos"],
  "DESIGNA MIEMBROS": ["Designa miembros", "pos"],
  "RECHAZADO": ["Rechazado", "neg"],
  "RECHAZADAS LAS MODIFICACIONES": ["Rechazadas las modificaciones", "neg"],
  "DENIEGA EL ACUERDO": ["Deniega el acuerdo", "neg"],
  "SE RATIFICA": ["Se ratifica", "neutro"],
  "NO SE RATIFICA": ["No se ratifica", "neutro"],
  "POSTERGADO": ["Postergado", "neutro"],
  "PARTE APRUEBA/PARTE RECHAZA": ["Aprueba una parte y rechaza otra", "neutro"],
  "DECLARA CULPABLE EN MAYORÍA 2/3 Y SEPARA DEL CARGO": ["Culpable por 2/3: separado del cargo", "neutro"],
  "DESTITUYE (MAYORÍA ABSOLUTA)": ["Destituye (mayoría absoluta)", "neutro"],
};

export function chipResultado(r) {
  const [etiqueta, tono] = RESULTADOS[r] || [r || "Sin resultado publicado", "neutro"];
  return el("span", { class: ["chip", "chip-resultado", `tono-${tono}`], title: r || null }, etiqueta);
}

// Abreviaturas de las cifras debajo de la barra
const CORTO = { S: "Sí", N: "No", A: "Abst.", X: "Aus.", V: "No vota", 1: "M1", 2: "M2", 3: "M3" };
const LEYENDA = { S: "Sí", N: "No", A: "Abstención", X: "Ausente", V: "Presente, no vota", 1: "Moción 1", 2: "Moción 2", 3: "Moción 3" };
const CLAVES_TOTALES = [["si", "S"], ["mocion_1", "1"], ["mocion_2", "2"], ["mocion_3", "3"], ["no", "N"],
  ["abstencion", "A"], ["no_vota", "V"], ["ausente", "X"]];

/** Cifras visibles de una votación: «Sí 28 · No 5 · Abst. 2 · Aus. 10» (solo las que no son cero).
    Los lectores de pantalla ya tienen las cifras en el aria-label de la barra. */
export function cifrasVotos(t) {
  return el("ul", { class: "cifras-votos", "aria-hidden": "true" }, CLAVES_TOTALES.filter(([k]) => t[k] > 0).map(([k, c]) =>
    el("li", {}, el("span", { class: ["punto", VOTOS[c].clase] }), CORTO[c], " ", el("strong", {}, numero(t[k])))));
}

/** Leyenda única de colores de voto para una lista, con los tipos que aparecen en esas votaciones. */
export function leyendaVotos(votaciones) {
  const hay = new Set();
  for (const v of votaciones) for (const [k, c] of CLAVES_TOTALES) if (v.totales[k] > 0) hay.add(c);
  return el("ul", { class: "leyenda leyenda-votos" }, CLAVES_TOTALES.filter(([, c]) => hay.has(c)).map(([, c]) =>
    el("li", {}, el("span", { class: ["punto", VOTOS[c].clase], "aria-hidden": "true" }), LEYENDA[c])));
}

let idTitulo = 0;
/** Título de SILpy en mayúsculas, chico y recortado a dos líneas, con «ver más» si no entra. */
export function tituloSilpy(texto) {
  const id = `titulo-silpy-${++idTitulo}`;
  const p = el("p", { class: "titulo-silpy clamp", id }, texto);
  const etiqueta = el("span", {}, "ver más");
  const boton = el("button", { type: "button", class: "ver-mas", "aria-expanded": "false", "aria-controls": id, hidden: true },
    etiqueta, el("span", { class: "sr" }, " del título"));
  boton.addEventListener("click", () => {
    const abierto = !p.classList.toggle("clamp");
    boton.setAttribute("aria-expanded", String(abierto));
    etiqueta.textContent = abierto ? "ver menos" : "ver más";
  });
  return [p, boton];
}

/** Muestra el «ver más» solo en los títulos que de verdad quedaron recortados. */
export function revisarRecortes(raiz) {
  requestAnimationFrame(() => {
    for (const p of raiz.querySelectorAll(".titulo-silpy.clamp")) {
      const boton = p.nextElementSibling;
      if (boton && boton.classList.contains("ver-mas")) boton.hidden = p.scrollHeight <= p.clientHeight + 1;
    }
  });
}

/** Fila de una votación: Fecha | Asunto (tipo + expediente arriba, título de SILpy abajo) | Resultado | Votos. */
export function filaVotacion(v, camara, extra = null) {
  return el("li", { class: "fila-votacion" },
    el("time", { class: "fila-votacion__fecha", datetime: v.fecha }, fecha(v.fecha)),
    el("div", { class: "fila-votacion__asunto" },
      el("a", { href: enlaceVotacion(v, camara), class: "fila-votacion__link" },
        v.es_ley ? "Proyecto de ley" : tipoCorto(v.tipo_proyecto),
        v.expediente && [el("span", { class: "sep", "aria-hidden": "true" }, "·"),
          el("span", { class: "fila-votacion__expediente" }, v.expediente)]),
      tituloSilpy(v.titulo),
      extra),
    el("div", { class: "fila-votacion__resultado" }, chipResultado(v.resultado)),
    el("div", { class: "fila-votacion__votos" }, barraTotales(v.totales), cifrasVotos(v.totales)));
}

/** Paginación simple: "Mostrar N más". */
export function listaPaginada(contenedor, items, render, { paso = 40, vacio = "No hay resultados.", clase = null } = {}) {
  let mostrados = 0;
  const ul = el("ul", { class: ["lista", clase] });
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
  mas.addEventListener("click", () => { siguiente(); revisarRecortes(ul); });
  contenedor.replaceChildren(items.length ? ul : el("p", { class: "vacio" }, vacio), pie);
  siguiente();
  revisarRecortes(ul);
}
