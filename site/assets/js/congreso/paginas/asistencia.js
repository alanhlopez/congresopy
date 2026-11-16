// Asistencia: presencia en votaciones nominales de todo el mandato, por cámara. Los datos los calcula el pipeline
// (asistencia.json); acá solo se dibuja. Estado en el #hash: camara, orden (mapa de calor) y seleccionado (id).
import { CAMARAS, asistencia, camara, camaraValida } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, escribirEstado, leerEstado } from "../lib/estado.js";
import { apellidoNombre, fecha, numero, ordenPartido, partidoClase, partidoNombre } from "../lib/formato.js";
import { avatar, chipPartido, enlaceLegislador, enlaceVotacion, revisarRecortes, tipoCorto, tituloSilpy } from "../lib/componentes.js";
import { alSoltarTooltip, conectar, fijar, soltar } from "../lib/tooltip.js";
import { anchoDe, anchoTexto, ejePorcentaje, enjambre, escala, filasDeEtiquetas, pisoDecena } from "../lib/graficos.js";

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
      return el("li", { dataset: { id: r.id } }, el("a", { href: enlaceLegislador(l, D.cam.clave) }, l.nombre), " ", chipPartido(l.partido),
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
  const arriba = angosto ? 4 : 16;   // lugar para el valor de la mediana de la primera fila
  const H = arriba + grupos.length * alto + 26;
  const pres = new Map(a.legisladores.map((r2) => [r2.id, r2]));
  const svg = el("svg:svg", { class: "partidos-grafico", viewBox: `0 0 ${ancho} ${H}`, width: ancho, height: H, role: "group",
    "aria-label": "Presencia por partido: un punto por legislador y la mediana del partido" });
  svg.append(ejePorcentaje(x, lo, arriba, arriba + grupos.length * alto));
  grupos.forEach((g, i) => {
    const yc = arriba + i * alto + alto / 2;
    const fila = el("svg:g", { class: "partidos-fila" });
    if (i % 2 === 0) fila.append(el("svg:rect", { x: 0, y: arriba + i * alto, width: ancho, height: alto, class: "partidos-fila__fondo" }));
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
    for (const id of g.ids) {
      const p = pres.get(id);
      const l = persona(id);
      const c = el("svg:circle", { cx: x(p.presencia).toFixed(1), cy: yc, r, class: ["punto-dato", "punto-dato--transparente", partidoClase(l.partido)] });
      conectarPersona(c, l, [textoPresencia(p), `Mediana de ${g.partido || "Otros"}: ${pct(g.mediana)}`]);
      fila.append(c);
    }
    // La raya y su valor van encima de los puntos, con halo, para que se lean
    fila.append(el("svg:line", { x1: xm, x2: xm, y1: yc - 11, y2: yc + 11, class: "raya-mediana" }));
    if (!angosto) fila.append(el("svg:text", { x: xm, y: yc - 13, "text-anchor": "middle", class: ["raya-mediana__texto", "etiqueta-dato--halo"] }, pct(g.mediana)));
    svg.append(fila);
  });
  return svg;
}

// ---------- 3. ¿Se falta más que antes? ----------
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;

function graficoLinea(a, ancho) {
  const serie = a.mensual.camara;
  const ml = 40, mr = 14, mt = 14, mb = 30;
  const alto = ancho < 560 ? 200 : 240;
  const lo = pisoDecena(Math.min(...serie.filter((s) => s.presencia !== null).map((s) => s.presencia)));
  const x = escala(0, serie.length - 1, ml, ancho - mr);
  const y = escala(lo, 1, alto - mb, mt);
  const maxN = Math.max(...serie.map((s) => s.votaciones));
  const svg = el("svg:svg", { class: "linea-grafico", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group",
    "aria-label": `Presencia mensual de la ${D.cam.info.nombreLargo}` });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  const pasoY = (1 - lo) > 0.5 ? 0.2 : 0.1;
  for (let v = 1; v >= lo - 1e-9; v -= pasoY) {
    eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: "eje__guia" }),
      el("svg:text", { x: ml - 6, y: y(v) + 4, "text-anchor": "end", class: "eje__texto" }, `${Math.round(v * 100)}%`));
  }
  // Años: una guía vertical y la etiqueta en el primer mes de cada año
  serie.forEach((s, i) => {
    if (i === 0 || s.mes.slice(5) === "01" || s.mes.slice(0, 4) !== serie[i - 1].mes.slice(0, 4)) {
      eje.append(el("svg:line", { x1: x(i), x2: x(i), y1: mt, y2: alto - mb, class: "eje__guia eje__guia--anio" }),
        el("svg:text", { x: x(i) + 3, y: alto - mb + 18, class: "eje__texto eje__texto--anio" }, s.mes.slice(0, 4)));
    }
  });
  svg.append(eje);
  let d = "";
  serie.forEach((s, i) => { if (s.presencia !== null) d += `${d && serie[i - 1]?.presencia !== null ? "L" : "M"}${x(i).toFixed(1)},${y(s.presencia).toFixed(1)}`; });
  svg.append(el("svg:path", { d, class: "linea-serie" }));
  serie.forEach((s, i) => {
    if (s.presencia === null) return;
    const c = el("svg:circle", { cx: x(i).toFixed(1), cy: y(s.presencia).toFixed(1), r: (2 + 5 * Math.sqrt(s.votaciones / maxN)).toFixed(1), class: "punto-serie" });
    const texto = `${nombreMes(s.mes)}: presencia ${pct(s.presencia)} en ${numero(s.votaciones)} votación${s.votaciones === 1 ? "" : "es"}`;
    c.setAttribute("aria-label", texto);
    conectar(c, { contenido: () => [el("strong", {}, nombreMes(s.mes)), el("p", { class: "tooltip__linea" }, `Presencia de la cámara: ${pct(s.presencia)}`),
      el("p", { class: "tooltip__linea" }, `${numero(s.votaciones)} votación${s.votaciones === 1 ? "" : "es"}`)] });
    svg.append(c);
  });
  return svg;
}

const ORDENES = {
  asc: (p, q) => p.presencia - q.presencia || q.posibles - p.posibles,
  desc: (p, q) => q.presencia - p.presencia || q.posibles - p.posibles,
  apellido: (p, q) => apellidoNombre(persona(p.id).nombre, persona(p.id).nombre_corto).localeCompare(apellidoNombre(persona(q.id).nombre, persona(q.id).nombre_corto), "es"),
  partido: (p, q) => ordenPartido(p.partido) - ordenPartido(q.partido) || p.presencia - q.presencia,
};
const MAPA_INICIAL = 20;
// Escala del mapa: amarillo (pocas ausencias) → naranja → rojo oscuro (muchas). Secuencial y legible con
// daltonismo rojo-verde; los mismos cortes que el degradé de la leyenda (congreso.css, .leyenda-mapa__escala).
const ESCALA_AUSENCIA = [[255, 247, 188], [254, 217, 118], [253, 141, 60], [227, 26, 28], [128, 0, 38]];
function colorAusencia(t) {
  const k = Math.min(ESCALA_AUSENCIA.length - 2, Math.floor(t * (ESCALA_AUSENCIA.length - 1)));
  const f = t * (ESCALA_AUSENCIA.length - 1) - k;
  const [a, b] = [ESCALA_AUSENCIA[k], ESCALA_AUSENCIA[k + 1]];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(" ")})`;
}
let mapaCompleto = false;

function mapaCalor(a, orden) {
  const meses = a.mensual.meses;
  const filas = [...a.legisladores].sort(ORDENES[orden] || ORDENES.asc);
  const visibles = mapaCompleto ? filas : filas.slice(0, MAPA_INICIAL);
  // Encabezado: fila de años (colspan) y fila de meses (inicial)
  const anios = [];
  for (const m of meses) { const y = m.slice(0, 4); if (anios.at(-1)?.[0] === y) anios.at(-1)[1]++; else anios.push([y, 1]); }
  const thead = el("thead", {},
    el("tr", {}, el("th", { class: "mapa__nombre", rowspan: 2, scope: "col" }, "Legislador"),
      anios.map(([y, n]) => el("th", { colspan: n, scope: "colgroup", class: "mapa__anio" }, y)),
      el("th", { rowspan: 2, scope: "col", class: "mapa__total" }, "Total")),
    el("tr", {}, meses.map((m) => el("th", { scope: "col", class: "mapa__mes", "aria-label": nombreMes(m) }, MESES[Number(m.slice(5)) - 1][0].toUpperCase()))));
  const tbody = el("tbody", {}, visibles.map((r) => {
    const l = persona(r.id);
    const celdas = a.mensual.legisladores[String(r.id)];
    return el("tr", {},
      el("th", { scope: "row", class: "mapa__nombre" }, el("a", { href: enlaceLegislador(l, D.cam.clave) }, l.nombre_corto || l.nombre),
        el("span", { class: ["punto", partidoClase(l.partido)], "aria-hidden": "true" })),
      celdas.map((c, i) => {
        if (!c) return el("td", { class: "mapa__celda mapa__celda--vacia", "aria-label": `${nombreMes(meses[i])}: sin votaciones en el cargo` });
        const aus = 1 - c[0] / c[1];
        return el("td", { class: "mapa__celda", vars: { "--celda": colorAusencia(aus) }, dataset: { id: r.id, mes: meses[i], p: c[0], n: c[1] },
          "aria-label": `${nombreMes(meses[i])}: presente en ${c[0]} de ${c[1]}` });
      }),
      el("td", { class: "mapa__total" }, pct(r.presencia)));
  }));
  const tabla = el("table", { class: "mapa" }, el("caption", { class: "sr" }, "Presencia mensual por legislador: de amarillo a rojo oscuro, más ausencias"), thead, tbody);
  // Tooltip por celda (delegado: son cientos de celdas)
  const ancla = el("span", { class: "mapa__ancla", "aria-hidden": "true" });
  tabla.addEventListener("mouseover", (ev) => {
    const td = ev.target.closest("td.mapa__celda");
    if (!td || !td.dataset.id) return;
    const l = persona(Number(td.dataset.id));
    td.append(ancla);
    const contenido = () => [el("strong", {}, l.nombre_corto || l.nombre), el("p", { class: "tooltip__linea" }, nombreMes(td.dataset.mes)),
      el("p", { class: "tooltip__linea" }, `Presente en ${td.dataset.p} de ${td.dataset.n} votaciones`)];
    if (!ancla.dataset.tooltip) conectar(ancla, { contenido: () => ancla._contenido(), foco: false });
    ancla._contenido = contenido;
    ancla.dispatchEvent(new MouseEvent("mouseenter"));
  });
  tabla.addEventListener("mouseleave", () => ancla.dispatchEvent(new MouseEvent("mouseleave")));
  const boton = $("#mapa-mas");
  boton.hidden = filas.length <= MAPA_INICIAL;
  boton.textContent = mapaCompleto ? `Ver solo los primeros ${MAPA_INICIAL}` : `Ver los ${numero(filas.length)}`;
  return tabla;
}

// ---------- 4. ¿Quién falta justo cuando la votación se pone difícil? ----------
function graficoDispersion(a, ancho) {
  const pts = a.dispersion.puntos;
  if (!pts.length) {
    return el("p", { class: "vacio" }, `Nadie tiene al menos ${a.criterios.minimo_por_tipo} votaciones de cada tipo: hubo ${numero(a.dispersion.votaciones_renidas)} reñidas en el período.`);
  }
  const ml = 46, mr = 16, mt = 12, mb = 44;
  const alto = Math.round(Math.min(Math.max(ancho * 0.72, 300), 460));
  const lo = pisoDecena(Math.min(...pts.flatMap((p) => [p.consenso, p.renidas])));
  const x = escala(lo, 1, ml, ancho - mr);
  const y = escala(lo, 1, alto - mb, mt);
  const r = ancho < 560 ? 4.5 : 5.5;
  const svg = el("svg:svg", { class: "dispersion", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group",
    "aria-label": "Presencia en votaciones de consenso (eje horizontal) y en reñidas (eje vertical), un punto por legislador" });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  const paso = (1 - lo) > 0.5 ? 0.2 : 0.1;
  for (let v = lo; v <= 1 + 1e-9; v += paso) {
    eje.append(el("svg:line", { x1: x(v), x2: x(v), y1: mt, y2: alto - mb, class: "eje__guia" }),
      el("svg:text", { x: x(v), y: alto - mb + 16, "text-anchor": "middle", class: "eje__texto" }, `${Math.round(v * 100)}%`),
      el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: "eje__guia" }),
      el("svg:text", { x: ml - 6, y: y(v) + 4, "text-anchor": "end", class: "eje__texto" }, `${Math.round(v * 100)}%`));
  }
  eje.append(el("svg:text", { x: (ml + ancho - mr) / 2, y: alto - 6, "text-anchor": "middle", class: "eje__titulo" }, "Presencia en votaciones de consenso"),
    el("svg:text", { x: 12, y: (mt + alto - mb) / 2, "text-anchor": "middle", class: "eje__titulo", transform: `rotate(-90 12 ${(mt + alto - mb) / 2})` }, "Presencia en reñidas"));
  // Zona debajo de la diagonal: aparecen menos en las reñidas
  svg.append(el("svg:polygon", { points: `${x(lo)},${y(lo)} ${x(1)},${y(1)} ${x(1)},${y(lo)}`, class: "zona-baja" }), eje,
    el("svg:line", { x1: x(lo), y1: y(lo), x2: x(1), y2: y(1), class: "diagonal" }),
    el("svg:text", { x: x(1) - 8, y: y(lo) - 8, "text-anchor": "end", class: "zona-baja__texto" }, "aparecen menos en las reñidas"));
  for (const p of pts) {
    const l = persona(p.id);
    const c = el("svg:circle", { cx: x(p.consenso).toFixed(1), cy: y(p.renidas).toFixed(1), r, class: ["punto-dato", partidoClase(l.partido)] });
    conectarPersona(c, l, [`Consenso: ${pct(p.consenso)} de ${numero(p.n_consenso)} votaciones`, `Reñidas: ${pct(p.renidas)} de ${numero(p.n_renidas)}`,
      `Diferencia: ${p.diferencia > 0 ? "+" : "−"}${Math.abs(Math.round(p.diferencia * 100))} puntos`]);
    svg.append(c);
  }
  // Etiquetas para los 3 con mayor caída (después de los puntos, con halo): del lado con más espacio,
  // dentro del área del gráfico y sin solaparse verticalmente.
  const caen = pts.slice(0, 3).map((p) => ({ p, cx: x(p.consenso), cy: y(p.renidas) })).sort((u, v) => u.cy - v.cy);
  let ultimo = -Infinity;
  for (const e of caen) {
    const l = persona(e.p.id);
    const texto = `${l.nombre_corto || l.nombre} ${e.p.diferencia > 0 ? "+" : "−"}${Math.abs(Math.round(e.p.diferencia * 100))}`;
    const w = anchoTexto(texto, 12);
    const ty = Math.max(e.cy + 4, ultimo + 15);
    ultimo = ty;
    const derecha = (ancho - mr) - e.cx >= e.cx - ml;
    const tx = derecha ? Math.min(e.cx + 9, ancho - mr - w) : Math.max(e.cx - 9 - w, ml + 2);
    svg.append(el("svg:text", { x: tx.toFixed(1), y: ty.toFixed(1), class: ["etiqueta-dato", "etiqueta-dato--halo"] }, texto));
  }
  return svg;
}

// ---------- 5. ¿Qué se votó con la sala medio vacía? ----------
function recuadroSala(a) {
  const sv = a.sala_vacia;
  const partes = [];
  if (sv.menos_de_la_mitad > 0) {
    partes.push(D.cam.clave === "diputados"
      ? `En ${numero(sv.menos_de_la_mitad)} votacion${sv.menos_de_la_mitad === 1 ? "" : "es"} votó menos de la mitad de la cámara.`
      : `En ${numero(sv.menos_de_la_mitad)} votacion${sv.menos_de_la_mitad === 1 ? "" : "es"} más de la mitad de la cámara figuró como ausente.`);
  }
  for (const t of sv.temas) partes.push(`${numero(t.n)} de las ${numero(sv.votaciones.length)} son ${t.tema}.`);
  return partes.length ? el("p", { class: "aviso-nota" }, partes.join(" ")) : null;
}

function filaSala(x) {
  const v = D.cam.votaciones[D.cam.posVotacion.get(x.id)];
  const presentes = x.total - x.ausentes;
  const [titulo, verMas] = tituloSilpy(v.titulo);
  titulo.classList.add("clamp-1");
  return el("li", { class: "fila-sala" },
    el("time", { class: "fila-sala__fecha", datetime: v.fecha }, fecha(v.fecha)),
    el("div", { class: "fila-sala__asunto" },
      el("span", { class: "fila-sala__tipo" }, v.es_ley ? "Proyecto de ley" : tipoCorto(v.tipo_proyecto),
        v.expediente && [el("span", { class: "sep", "aria-hidden": "true" }, " · "), v.expediente]),
      titulo, verMas),
    el("div", { class: "fila-sala__barra" },
      el("div", { class: "barra-totales", role: "img", "aria-label": `Presentes ${presentes}, ausentes ${x.ausentes}, de ${x.total}` },
        el("span", { class: "seg seg--presentes", vars: { "--w": `${(100 * presentes) / x.total}%` } }),
        el("span", { class: ["seg", "v-aus"], vars: { "--w": `${(100 * x.ausentes) / x.total}%` } })),
      el("p", { class: "cifras-votos", "aria-hidden": "true" }, el("span", {}, "Presentes ", el("strong", {}, numero(presentes))),
        el("span", {}, "Ausentes ", el("strong", {}, numero(x.ausentes))), el("span", {}, pct(x.ausentes / x.total)))),
    el("a", { class: "boton fila-sala__link", href: enlaceVotacion(v, D.cam.clave) }, "Ver votación", el("span", { class: "sr" }, ` del ${fecha(v.fecha)}`)));
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
SECCIONES.push((a) => {
  vaciar($("#g-linea"), graficoLinea(a, anchoDe($("#g-linea"))));
  const orden = leerEstado(DEFECTOS).orden;
  $("#f-orden").value = ORDENES[orden] ? orden : "asc";
  vaciar($("#g-mapa"), mapaCalor(a, $("#f-orden").value));
});
SECCIONES.push((a) => {
  const g = $("#g-dispersion");
  vaciar(g, graficoDispersion(a, Math.min(anchoDe(g), 760)));
  const c = a.criterios;
  for (const s of document.querySelectorAll("[data-umbral-consenso]")) s.textContent = `${Math.round(c.umbral_consenso * 100)} %`;
  for (const s of document.querySelectorAll("[data-umbral-renida]")) s.textContent = `${Math.round(c.umbral_renida * 100)} %`;
  for (const s of document.querySelectorAll("[data-minimo-tipo]")) s.textContent = numero(c.minimo_por_tipo);
  vaciar($("#sala-recuadro"), recuadroSala(a));
  const ul = el("ol", { class: "lista" }, a.sala_vacia.votaciones.map(filaSala));
  vaciar($("#g-sala"), ul);
  revisarRecortes(ul);
  $("#dispersion-conteo").textContent = `En el mandato hubo ${numero(a.dispersion.votaciones_consenso)} votaciones de consenso y ${numero(a.dispersion.votaciones_renidas)} reñidas; entran ${numero(a.dispersion.puntos.length)} ${D.cam.info.miembros}.`;
});

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
    // Seleccionado sin datos suficientes (no está en los gráficos): se lo marca en la lista aparte
    else if (e.seleccionado && a.sin_datos.some((r) => String(r.id) === e.seleccionado)) {
      const li = $(`#sin-datos [data-id="${e.seleccionado}"]`);
      li?.classList.add("es-seleccionado");
      li?.scrollIntoView({ block: "center" });
    }
  } catch (err) {
    mostrarError($("#g-enjambre"), `No se pudieron cargar los datos: ${err.message}`);
  }
}

$("#f-orden").addEventListener("change", () => { escribirEstado({ ...leerEstado(DEFECTOS), orden: $("#f-orden").value }, DEFECTOS); dibujar(); });
$("#mapa-mas").addEventListener("click", () => {
  mapaCompleto = !mapaCompleto;
  vaciar($("#g-mapa"), mapaCalor(D.a, $("#f-orden").value));
});
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
