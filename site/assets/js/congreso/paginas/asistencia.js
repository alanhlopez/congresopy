// Asistencia: presencia en votaciones nominales de todo el mandato, por cámara. Los datos los calcula el pipeline
// (asistencia.json); acá solo se dibuja. Estado en el #hash: camara, orden (mapa de calor) y seleccionado (id).
import { CAMARAS, asistencia, camara, camaraValida } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, escribirEstado, leerEstado } from "../lib/estado.js";
import { apellidoNombre, fecha, numero, ordenPartido, partidoClase, partidoNombre } from "../lib/formato.js";
import { avatar, chipPartido, enlaceLegislador } from "../lib/componentes.js";
import { alSoltarTooltip, conectar, fijar, soltar } from "../lib/tooltip.js";
import { anchoDe, ejePorcentaje, enjambre, escala, filasDeEtiquetas, pisoDecena } from "../lib/graficos.js";

const DEFECTOS = { camara: "senado", orden: "asc", seleccionado: "" };
const pct = (x) => `${Math.round(x * 100)} %`;
let D = null;                 // { cam, a, porId }
const anclas = new Map();     // id -> punto del gráfico principal (para fijar el seleccionado)

// ---------- tooltip de un legislador ----------
function tarjetaPersona(l, lineas, fijo) {
  return [
    el("div", { class: "tooltip__persona" }, avatar(l),
      el("div", {}, el("strong", {}, apellidoNombre(l.nombre, l.nombre_corto)), el("div", {}, chipPartido(l.partido), " ", partidoNombre(l.partido)))),
    lineas.map((t) => el("p", { class: "tooltip__linea" }, t)),
    fijo && el("p", { class: "tooltip__acciones" }, el("a", { class: "boton", href: enlaceLegislador(l, D.cam.clave) }, "Ver perfil ", el("span", { "aria-hidden": "true" }, "→"))),
  ];
}

function textoPresencia(r) {
  return `Presente en ${numero(r.presentes)} de ${numero(r.posibles)} votaciones (${pct(r.presencia)})`;
}

function conectarPersona(nodo, l, lineas) {
  nodo.setAttribute("role", "button");
  nodo.setAttribute("aria-label", `${l.nombre}, ${partidoNombre(l.partido)}. ${lineas.join(". ")}`);
  conectar(nodo, {
    contenido: (fijo) => tarjetaPersona(l, lineas, fijo),
    clave: String(l.id),
    alFijar: (id) => escribirEstado({ ...leerEstado(DEFECTOS), seleccionado: id }, DEFECTOS),
  });
}
alSoltarTooltip(() => escribirEstado({ ...leerEstado(DEFECTOS), seleccionado: "" }, DEFECTOS));

const persona = (id) => D.porId.get(id) || { id, nombre: `Legislador ${id}`, nombre_corto: "", partido: "" };

// ---------- 1. ¿Quién está cuando se vota? ----------
function indicadores(a) {
  const i = a.indicadores;
  const max = i.maximo && persona(i.maximo.id);
  const stat = (etiqueta, valor, nota) => el("div", { class: "stat" }, el("span", { class: "stat__etiqueta" }, etiqueta),
    el("span", { class: "stat__valor" }, valor), nota && el("span", { class: "stat__nota" }, nota));
  return [
    stat("Presencia mediana", pct(i.mediana), `de ${numero(a.legisladores.length)} ${D.cam.info.miembros}`),
    stat("Ausentes en una votación típica", pct(i.ausentes_votacion_tipica), "mediana por votación"),
    stat("Bajo el 50 %", numero(i.bajo_50), i.bajo_50 === 1 ? D.cam.info.miembro : D.cam.info.miembros),
    max && stat("La presencia más alta", pct(i.maximo.presencia), max.nombre_corto || max.nombre),
  ];
}

function graficoEnjambre(a, ancho) {
  const r = ancho < 520 ? 4 : 5.5;
  const mi = 12;
  const md = 12;
  const lo = pisoDecena(Math.min(...a.legisladores.map((x) => x.presencia)));
  const x = escala(lo, 1, mi, ancho - md);
  const { puntos, max } = enjambre(a.legisladores.map((x2) => ({ ...x2, valor: x2.presencia })), x, r, { separacion: 1.2 });
  // Etiquetas fijas: los 3 de menor presencia, en filas arriba para no solaparse
  const bajos = [...a.legisladores].slice(0, 3).map((x2) => ({ id: x2.id, x: x(x2.presencia),
    texto: `${persona(x2.id).nombre_corto || persona(x2.id).nombre} ${pct(x2.presencia)}` }));
  const etiquetas = filasDeEtiquetas(bajos, ancho);
  const filasEt = Math.max(0, ...etiquetas.map((e) => e.fila + 1));
  const top = 8 + filasEt * 16 + 6;
  const centro = top + max + r + 4;
  const base = centro + max + r + 6;
  const alto = base + 26;
  const svg = el("svg:svg", { class: "enjambre", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group",
    "aria-label": `Presencia de cada ${D.cam.info.miembro}: un punto por legislador. Mediana ${pct(a.indicadores.mediana)}.` });
  svg.append(ejePorcentaje(x, lo, top - 4, base));
  const xm = x(a.indicadores.mediana);
  svg.append(el("svg:line", { x1: xm, x2: xm, y1: top - 4, y2: base, class: "linea-mediana" }),
    el("svg:text", { x: xm + 4, y: base - 4, class: "linea-mediana__texto" }, `mediana ${pct(a.indicadores.mediana)}`));
  const pos = new Map(puntos.map((p) => [p.id, p]));
  for (const e of etiquetas) {
    const p = pos.get(e.id);
    const ye = 8 + e.fila * 16 + 11;
    svg.append(el("svg:line", { x1: p.cx, x2: p.cx, y1: ye + 3, y2: centro + p.dy - r, class: "etiqueta-linea" }),
      el("svg:text", { x: e.ancla === "start" ? p.cx + 2 : p.cx - 2, y: ye, "text-anchor": e.ancla, class: "etiqueta-dato" }, e.texto));
  }
  anclas.clear();
  for (const p of puntos) {
    const l = persona(p.id);
    const c = el("svg:circle", { cx: p.cx.toFixed(1), cy: (centro + p.dy).toFixed(1), r, class: ["punto-dato", partidoClase(l.partido), !p.en_ejercicio && "punto-dato--inactivo"] });
    conectarPersona(c, l, [textoPresencia(p), !p.en_ejercicio ? "Ya no está en el cargo" : null].filter(Boolean));
    anclas.set(String(p.id), c);
    svg.append(c);
  }
  return svg;
}

function leyendaPartidos(a) {
  const n = new Map();
  for (const r of a.legisladores) n.set(r.partido, (n.get(r.partido) || 0) + 1);
  return [...n].sort((p, q) => ordenPartido(p[0]) - ordenPartido(q[0])).map(([p, k]) =>
    el("li", { class: ["chip", "chip-partido", partidoClase(p)] }, el("span", {}, p || "Sin partido"), el("strong", {}, numero(k)),
      el("span", { class: "sr" }, ` (${partidoNombre(p)})`)));
}

function sinDatos(a) {
  if (!a.sin_datos.length) return null;
  return el("div", { class: "sin-datos" },
    el("h3", {}, "Sin datos suficientes"),
    el("p", { class: "nota" }, `Estuvieron en el cargo en menos de ${numero(a.criterios.minimo_posibles)} votaciones: no se calcula su porcentaje.`),
    el("ul", { class: "lista-simple" }, a.sin_datos.map((r) => {
      const l = persona(r.id);
      return el("li", {}, el("a", { href: enlaceLegislador(l, D.cam.clave) }, l.nombre), " ", chipPartido(l.partido),
        el("span", { class: "nota" }, ` · ${numero(r.posibles)} votaciones en el cargo`));
    })));
}

// ---------- 2. ¿Qué partidos están más presentes? ----------
function graficoPartidos(a, ancho) {
  const angosto = ancho < 560;
  const li = angosto ? 74 : 190;     // columna de etiquetas
  const alto = 34;
  const r = angosto ? 4.5 : 5.5;
  const lo = pisoDecena(Math.min(...a.legisladores.map((x) => x.presencia)));
  const x = escala(lo, 1, li + 8, ancho - 10);
  const grupos = [...a.partidos];
  const H = grupos.length * alto + 26;
  const pres = new Map(a.legisladores.map((r2) => [r2.id, r2]));
  const svg = el("svg:svg", { class: "partidos-grafico", viewBox: `0 0 ${ancho} ${H}`, width: ancho, height: H, role: "group",
    "aria-label": "Presencia por partido: un punto por legislador y la mediana del partido" });
  svg.append(ejePorcentaje(x, lo, 0, grupos.length * alto));
  grupos.forEach((g, i) => {
    const yc = i * alto + alto / 2;
    const fila = el("svg:g", { class: "partidos-fila" });
    if (i % 2 === 0) fila.append(el("svg:rect", { x: 0, y: i * alto, width: ancho, height: alto, class: "partidos-fila__fondo" }));
    const nombre = g.partido || "Otros";
    const etiqueta = el("svg:g", { class: ["partidos-etiqueta", !g.partido && "partidos-etiqueta--otros"] },
      el("svg:circle", { cx: 6, cy: yc, r: 4.5, class: ["punto-dato", "punto-dato--leyenda", g.partido ? partidoClase(g.partido) : "p-otro"] }),
      el("svg:text", { x: 16, y: yc + 4, class: "partidos-etiqueta__texto" }, angosto ? `${nombre} (${g.n})` : `${g.partido ? partidoNombre(g.partido).replace(/ \(.*\)$/, "") : "Otros"} (${g.n})`));
    if (!g.partido) {
      // «Otros»: el tooltip dice quiénes son
      const quienes = g.ids.map((id) => { const l = persona(id); return `${l.nombre_corto || l.nombre} (${l.partido || "sin partido"})`; });
      etiqueta.setAttribute("role", "button");
      etiqueta.setAttribute("aria-label", `Otros: ${quienes.join(", ")}`);
      conectar(etiqueta, { contenido: () => [el("strong", {}, "Otros: un integrante por partido"), el("ul", { class: "tooltip__lista" }, quienes.map((q) => el("li", {}, q)))] });
    }
    fila.append(etiqueta);
    const xm = x(g.mediana);
    fila.append(el("svg:line", { x1: xm, x2: xm, y1: yc - 11, y2: yc + 11, class: "raya-mediana" }));
    if (!angosto) fila.append(el("svg:text", { x: xm, y: yc - 13, "text-anchor": "middle", class: "raya-mediana__texto" }, pct(g.mediana)));
    for (const id of g.ids) {
      const p = pres.get(id);
      const l = persona(id);
      const c = el("svg:circle", { cx: x(p.presencia).toFixed(1), cy: yc, r, class: ["punto-dato", "punto-dato--transparente", partidoClase(l.partido)] });
      conectarPersona(c, l, [textoPresencia(p), `Mediana de ${g.partido || "Otros"}: ${pct(g.mediana)}`]);
      fila.append(c);
    }
    svg.append(fila);
  });
  return svg;
}

// ---------- render ----------
const SECCIONES = [];   // (a, ancho) => void; cada sección dibuja lo suyo
SECCIONES.push((a) => {
  vaciar($("#indicadores"), indicadores(a));
  vaciar($("#g-enjambre"), graficoEnjambre(a, anchoDe($("#g-enjambre"))));
  vaciar($("#leyenda-partidos"), leyendaPartidos(a));
  vaciar($("#sin-datos"), sinDatos(a));
});
SECCIONES.push((a) => vaciar($("#g-partidos"), graficoPartidos(a, anchoDe($("#g-partidos")))));

function dibujar() {
  if (!D) return;
  for (const s of SECCIONES) s(D.a);
  const sel = leerEstado(DEFECTOS).seleccionado;
  const ancla = sel && anclas.get(sel);
  if (ancla) {
    const l = persona(Number(sel));
    const r = D.a.legisladores.find((x) => String(x.id) === sel);
    fijar(ancla, tarjetaPersona(l, [textoPresencia(r)], true), sel);
  }
}

let camaraCargada = "";
async function aplicar() {
  const e = leerEstado(DEFECTOS);
  e.camara = camaraValida(e.camara);
  for (const b of document.querySelectorAll("#selector-camara button")) b.setAttribute("aria-pressed", String(b.dataset.camara === e.camara));
  if (camaraCargada === e.camara && D) { dibujar(); return; }
  try {
    const [cam, a] = await Promise.all([camara(e.camara), asistencia(e.camara)]);
    D = { cam, a, porId: cam.porId };
    camaraCargada = e.camara;
    soltar(false);
    for (const s of document.querySelectorAll("[data-minimo]")) s.textContent = numero(a.criterios.minimo_posibles);
    $("#periodo-texto").textContent = `${CAMARAS[e.camara].nombreLargo} · del ${fecha(a.periodo.desde)} al ${fecha(a.periodo.hasta)} · ${numero(a.periodo.votaciones)} votaciones nominales`;
    dibujar();
    if (e.seleccionado && anclas.get(e.seleccionado)) anclas.get(e.seleccionado).scrollIntoView({ block: "center" });
  } catch (err) {
    mostrarError($("#g-enjambre"), `No se pudieron cargar los datos: ${err.message}`);
  }
}

for (const b of document.querySelectorAll("#selector-camara button")) {
  b.addEventListener("click", () => { escribirEstado({ ...leerEstado(DEFECTOS), camara: b.dataset.camara, seleccionado: "" }, DEFECTOS); aplicar(); });
}
// Los gráficos se adaptan al ancho: se redibujan cuando cambia (sin redibujar por cambios de alto)
let anchoPrevio = 0;
new ResizeObserver(([e]) => {
  const w = Math.round(e.contentRect.width);
  if (D && Math.abs(w - anchoPrevio) > 8) { anchoPrevio = w; requestAnimationFrame(dibujar); }
}).observe($("#contenido"));
alCambiarHash(aplicar);
aplicar();
