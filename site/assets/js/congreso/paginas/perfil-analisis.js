// Perfil del legislador: pestañas «Análisis» y «Datos abiertos». Los números salen de analisis.json (pipeline:
// detalle_legislador.py); acá solo se dibujan. La lista de votaciones en las que coincidió o no con otra persona se
// arma filtrando votos.json (no es un cálculo: es mostrar las votaciones que ya cuenta el porcentaje).
import { el } from "../lib/dom.js";
import { VOTOS, apellidoNombre, fecha, numero, ordenPartido, partidoClase, partidoNombre, porcentaje } from "../lib/formato.js";
import { avatar, chipPartido, chipVoto, enlaceLegislador, enlaceVotacion, listaPaginada, tipoCorto } from "../lib/componentes.js";
import { conectar } from "../lib/tooltip.js";
import { anchoTexto, escala } from "../lib/graficos.js";

const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ORDEN_VOTO = [["S", "Sí", "v-si"], ["N", "No", "v-no"], ["A", "Abstención", "v-abs"], ["M", "Moción", "v-m1"], ["V", "No vota", "v-nv"], ["X", "Ausente", "v-aus"]];
const GRANULARIDADES = [["semana", "Semana"], ["mes", "Mes"], ["anio", "Año"]];

function etiquetaTramo(t, g, larga = false) {
  if (g === "anio") return t;
  if (g === "mes") return larga ? `${MESES_LARGOS[Number(t.slice(5, 7)) - 1]} de ${t.slice(0, 4)}` : `${MESES[Number(t.slice(5, 7)) - 1]} ${t.slice(2, 4)}`;
  return larga ? `semana del ${fecha(t)}` : `${t.slice(8, 10)}/${t.slice(5, 7)}`;
}

/** Control segmentado reutilizable: opciones [[valor, texto, deshabilitada?]]. */
export function segmentado(etiqueta, opciones, valor, alCambiar) {
  return el("div", { class: "segmentado segmentado--chico", role: "group", "aria-label": etiqueta },
    opciones.map(([v, t, off]) => el("button", { type: "button", "aria-pressed": String(v === valor), disabled: off || null,
      title: off ? "Disponible si el período dura 6 meses o menos" : null, on: { click: () => alCambiar(v) } }, t)));
}

// ---------- 1. Votaciones de este período ----------
function graficoVotos(serie, g, ancho) {
  const ml = 34, mr = 8, mt = 10, mb = 26;
  const alto = ancho < 560 ? 210 : 250;
  const max = Math.max(1, ...serie.map((t) => t.posibles));
  const x = escala(0, serie.length, ml, ancho - mr);
  const y = escala(0, max, alto - mb, mt);
  const banda = (ancho - ml - mr) / serie.length;
  const svg = el("svg:svg", { class: "barras-tiempo", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group",
    "aria-label": "Votos por tramo: barras apiladas por tipo de voto" });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  const paso = max > 40 ? Math.ceil(max / 40) * 10 : max > 10 ? 5 : 1;
  for (let v = 0; v <= max; v += paso) {
    eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: "eje__guia" }),
      el("svg:text", { x: ml - 5, y: y(v) + 4, "text-anchor": "end", class: "eje__texto" }, numero(v)));
  }
  const cada = Math.max(1, Math.ceil(anchoTexto("may 26", 11) / banda));
  serie.forEach((t, i) => {
    if (i % cada === 0) eje.append(el("svg:text", { x: x(i) + banda / 2, y: alto - mb + 15, "text-anchor": "middle", class: "eje__texto" }, etiquetaTramo(t.p, g)));
  });
  svg.append(eje);
  const w = Math.max(2, banda * 0.72);
  serie.forEach((t, i) => {
    const grupo = el("svg:g", { class: "barra-tramo", role: "img" });
    let base = 0;
    for (const [c, , clase] of ORDEN_VOTO) {
      if (!t[c]) continue;
      grupo.append(el("svg:rect", { x: (x(i) + (banda - w) / 2).toFixed(1), y: y(base + t[c]).toFixed(1), width: w.toFixed(1),
        height: Math.max(0.5, y(base) - y(base + t[c])).toFixed(1), class: ["seg-barra", clase] }));
      base += t[c];
    }
    const lineas = ORDEN_VOTO.filter(([c]) => t[c]).map(([c, nombre]) => `${nombre}: ${numero(t[c])}`);
    grupo.setAttribute("aria-label", `${etiquetaTramo(t.p, g, true)}: ${t.posibles ? lineas.join(", ") : "no estaba en el cargo"}`);
    conectar(grupo, { contenido: () => [el("strong", {}, etiquetaTramo(t.p, g, true)),
      t.posibles ? lineas.map((s) => el("p", { class: "tooltip__linea" }, s)) : el("p", { class: "tooltip__linea" }, "No estaba en el cargo")] });
    svg.append(grupo);
  });
  return svg;
}

function graficoPresencia(serie, g, ancho, camaraNombre) {
  const ml = 40, mr = 10, mt = 12, mb = 26;
  const alto = ancho < 560 ? 210 : 250;
  const vals = serie.flatMap((t) => [t.presencia, t.mediana]).filter((v) => v !== null);
  const lo = Math.max(0, Math.floor(Math.min(...vals, 1) * 10 - 1e-9) / 10);
  const x = escala(0, Math.max(1, serie.length - 1), ml, ancho - mr);
  const y = escala(lo, 1, alto - mb, mt);
  const svg = el("svg:svg", { class: "linea-grafico", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group",
    "aria-label": "Presencia en votaciones nominales por tramo, comparada con la mediana de la cámara" });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  for (let v = 1; v >= lo - 1e-9; v -= (1 - lo) > 0.5 ? 0.2 : 0.1) {
    eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: "eje__guia" }),
      el("svg:text", { x: ml - 5, y: y(v) + 4, "text-anchor": "end", class: "eje__texto" }, `${Math.round(v * 100)}%`));
  }
  const banda = (ancho - ml - mr) / Math.max(1, serie.length);
  const cada = Math.max(1, Math.ceil(anchoTexto("may 26", 11) / banda));
  serie.forEach((t, i) => { if (i % cada === 0) eje.append(el("svg:text", { x: x(i), y: alto - mb + 15, "text-anchor": "middle", class: "eje__texto" }, etiquetaTramo(t.p, g))); });
  svg.append(eje);
  const camino = (clave) => {
    let d = "";
    serie.forEach((t, i) => { if (t[clave] !== null) d += `${d && serie[i - 1]?.[clave] !== null && serie[i - 1]?.[clave] !== undefined ? "L" : "M"}${x(i).toFixed(1)},${y(t[clave]).toFixed(1)}`; });
    return d;
  };
  svg.append(el("svg:path", { d: camino("mediana"), class: "linea-mediana-camara" }), el("svg:path", { d: camino("presencia"), class: "linea-serie" }));
  serie.forEach((t, i) => {
    if (t.presencia === null) return;
    const c = el("svg:circle", { cx: x(i).toFixed(1), cy: y(t.presencia).toFixed(1), r: 4, class: "punto-serie" });
    const lineas = [`Presencia: ${pct(t.presencia)} (${numero(t.posibles - t.X)} de ${numero(t.posibles)})`, `Mediana de ${camaraNombre}: ${pct(t.mediana)}`];
    c.setAttribute("aria-label", `${etiquetaTramo(t.p, g, true)}. ${lineas.join(". ")}`);
    conectar(c, { contenido: () => [el("strong", {}, etiquetaTramo(t.p, g, true)), lineas.map((s) => el("p", { class: "tooltip__linea" }, s))] });
    svg.append(c);
  });
  return svg;
}

export function seccionPeriodo(ctx) {
  const { A, periodo, e, cambiar, ancho, d } = ctx;
  const info = A.periodos.find((p) => p.clave === periodo);
  const pp = A.por_periodo[periodo];
  let g = e.gran;
  if (!pp.series[g]) g = "mes";
  const serie = pp.series[g];
  const vista = e.graf === "presencia" ? "presencia" : "voto";
  const leyenda = vista === "voto"
    ? el("ul", { class: "leyenda leyenda-votos" }, ORDEN_VOTO.filter(([c]) => pp.conteo[c]).map(([, nombre, clase]) =>
      el("li", {}, el("span", { class: ["punto", clase], "aria-hidden": "true" }), nombre)))
    : el("ul", { class: "leyenda leyenda-votos" },
      el("li", {}, el("span", { class: "leyenda-linea", "aria-hidden": "true" }), "Su presencia"),
      el("li", {}, el("span", { class: "leyenda-linea leyenda-linea--punteada", "aria-hidden": "true" }), `Mediana de la ${d.info.nombreLargo}`));
  return el("section", { class: "tarjeta", "aria-labelledby": "t-periodo" },
    el("div", { class: "tarjeta__cabecera" },
      el("div", {}, el("h2", { id: "t-periodo" }, vista === "voto" ? "Votaciones de este período" : "Presencia en votaciones nominales"),
        el("p", { class: "tarjeta__descripcion" }, `${info.nombre}: del ${fecha(info.desde)} al ${fecha(info.hasta)}, ${numero(pp.conteo.posibles)} votaciones en el cargo.`)),
      el("div", { class: "tarjeta__acciones" },
        segmentado("Qué mostrar", [["voto", "Cómo votó"], ["presencia", "Presencia"]], vista, (v) => cambiar({ graf: v })),
        segmentado("Agrupar por", GRANULARIDADES.map(([v, t]) => [v, t, !pp.series[v]]), g, (v) => cambiar({ gran: v })))),
    el("div", { class: "tarjeta__cuerpo" },
      vista === "presencia" && el("p", { class: "aviso-nota aviso-nota--arriba" }, "No es asistencia a sesiones: SILpy no publica la nómina de presentes por sesión; mide si figura como AUSENTE en cada votación nominal."),
      leyenda,
      pp.conteo.posibles
        ? el("div", { class: "grafico" }, vista === "voto" ? graficoVotos(serie, g, ancho) : graficoPresencia(serie, g, ancho, d.info.nombreLargo))
        : el("p", { class: "vacio" }, "No estuvo en el cargo en este período.")));
}

// ---------- 2. Similitud de voto ----------
/** Votaciones del período en las que los dos votaron Sí, No o Abstención, separadas en coincidió / no coincidió. */
function coincidencias(d, idx, cadA, cadB) {
  const si = [], no = [];
  for (const k of idx) {
    if ("SNA".includes(cadA[k]) && "SNA".includes(cadB[k])) (cadA[k] === cadB[k] ? si : no).push(k);
  }
  return { si, no };
}

function filaCoincidencia(d, k, cadA, cadB, otro) {
  const v = d.votaciones[k];
  return el("li", { class: "fila-coincidencia" },
    el("time", { datetime: v.fecha }, fecha(v.fecha)),
    el("a", { href: enlaceVotacion(v, d.clave) }, v.es_ley ? "Proyecto de ley" : tipoCorto(v.tipo_proyecto), v.expediente ? ` · ${v.expediente}` : ""),
    el("span", { class: "fila-coincidencia__votos" }, chipVoto(cadA[k]), el("span", { class: "nota" }, ` ${otro}: `), chipVoto(cadB[k])));
}

function detalleCon(ctx, otroId) {
  const { d, l, idxPeriodo } = ctx;
  const o = d.porId.get(otroId);
  if (!o) return null;
  const cadA = d.votos.legisladores[String(l.id)];
  const cadB = d.votos.legisladores[String(otroId)];
  const { si, no } = coincidencias(d, idxPeriodo, cadA, cadB);
  const nombreO = o.nombre_corto || o.nombre;
  const listaSi = el("div"), listaNo = el("div");
  const orden = (xs) => [...xs].sort((a, b) => d.votaciones[b].fecha.localeCompare(d.votaciones[a].fecha));
  listaPaginada(listaSi, orden(si), (k) => filaCoincidencia(d, k, cadA, cadB, nombreO), { paso: 10, vacio: "Ninguna." });
  listaPaginada(listaNo, orden(no), (k) => filaCoincidencia(d, k, cadA, cadB, nombreO), { paso: 10, vacio: "Ninguna." });
  return el("div", { class: "detalle-con", id: "detalle-con" },
    el("div", { class: "detalle-con__cabeza" }, avatar(o),
      el("p", {}, el("strong", {}, `${l.nombre_corto || l.nombre} y ${nombreO}`), el("br"),
        `Votaron igual en ${numero(si.length)} de ${numero(si.length + no.length)} votaciones (${pct(si.length / Math.max(1, si.length + no.length))}).`),
      el("a", { class: "boton", href: enlaceLegislador(o, d.clave) }, "Ver perfil"),
      el("button", { type: "button", class: "boton", on: { click: () => ctx.cambiar({ con: "" }) } }, "Cerrar")),
    el("div", { class: "dos-columnas" },
      el("div", {}, el("h3", {}, `Coincidieron (${numero(si.length)})`), listaSi),
      el("div", {}, el("h3", {}, `No coincidieron (${numero(no.length)})`), listaNo)));
}

function similitudLegisladores(ctx) {
  const { d, l, pp, cambiar, e } = ctx;
  if (!pp.similitud.length) return el("p", { class: "vacio" }, `No comparte al menos ${ctx.A.criterios.similitud_minimo} votaciones con ningún legislador en ejercicio en este período.`);
  const filas = pp.similitud.map((s) => ({ ...s, o: d.porId.get(s.id), x: s.igual / s.comun })).filter((s) => s.o);
  const grupos = new Map();
  for (const f of filas) { const p = f.o.partido || ""; if (!grupos.has(p)) grupos.set(p, []); grupos.get(p).push(f); }
  const otros = [];
  for (const [p, xs] of [...grupos]) if (xs.length === 1) { otros.push(...xs); grupos.delete(p); }
  const orden = [...grupos].sort((a, b) => (a[0] === l.partido ? -1 : b[0] === l.partido ? 1 : b[1].length - a[1].length || ordenPartido(a[0]) - ordenPartido(b[0])));
  if (otros.length) orden.push(["", otros]);
  const minimo = Math.min(0.5, Math.floor(Math.min(...filas.map((f) => f.x)) * 10) / 10);
  const pos = (x) => `${((x - minimo) / (1 - minimo)) * 100}%`;
  const ticks = [];
  for (let t = minimo; t <= 1.0001; t += (1 - minimo) > 0.45 ? 0.1 : 0.05) ticks.push(t);
  const fila = ([p, xs]) => {
    const carriles = [];
    const fotos = xs.sort((a, b) => a.x - b.x).map((f) => {
      const px = ((f.x - minimo) / (1 - minimo)) * 100;
      let c = carriles.findIndex((ult) => px - ult > 4.2);
      if (c === -1) { c = carriles.length; carriles.push(-Infinity); }
      carriles[c] = px;
      const b = el("button", { type: "button", class: ["foto-sim", String(f.id) === e.con && "es-elegida"], vars: { "--x": pos(f.x), "--carril": c },
        "aria-label": `${f.o.nombre}, ${partidoNombre(f.o.partido)}: votó igual en ${pct(f.x)} de ${numero(f.comun)} votaciones` }, avatar(f.o));
      conectar(b, { contenido: () => [el("strong", {}, apellidoNombre(f.o.nombre, f.o.nombre_corto)), el("p", { class: "tooltip__linea" }, `Votó igual en ${pct(f.x)}: ${numero(f.igual)} de ${numero(f.comun)} votaciones`),
        el("p", { class: "tooltip__linea" }, "Tocá para ver en cuáles coincidieron")], foco: false });
      b.addEventListener("click", () => cambiar({ con: String(f.id) }));
      return b;
    });
    const nombre = p ? `${p}${p === l.partido ? " · su partido" : ""}` : "Otros";
    return el("div", { class: "similitud__fila", vars: { "--carriles": carriles.length } },
      el("div", { class: "similitud__partido" }, el("span", { class: ["punto", p ? partidoClase(p) : "p-otro"], "aria-hidden": "true" }), el("span", {}, nombre),
        el("span", { class: "nota" }, numero(xs.length)), !p && el("span", { class: "nota similitud__otros" }, xs.map((f) => f.o.partido || "sin partido").join(", "))),
      el("div", { class: "similitud__pista similitud__pista--fotos" }, fotos));
  };
  return [
    el("div", { class: "similitud similitud--fotos", role: "group", "aria-label": "Similitud de voto con cada legislador en ejercicio, por partido" },
      el("div", { class: "similitud__eje", "aria-hidden": "true" }, el("span", { class: "similitud__vacio" }),
        el("div", { class: "similitud__ticks" }, ticks.map((t) => el("span", { vars: { "--x": pos(t) } }, `${Math.round(t * 100)}%`)))),
      orden.map(fila)),
    e.con && detalleCon(ctx, Number(e.con)),
  ];
}

function similitudBloques(ctx) {
  const { pp, l } = ctx;
  if (!pp.bloques.length) return el("p", { class: "vacio" }, "No hay suficientes votaciones para comparar con los partidos en este período.");
  return el("ul", { class: "bloques-sim" }, pp.bloques.map((b) => {
    const x = b.igual / b.comun;
    return el("li", { class: "bloques-sim__fila" },
      el("span", { class: "bloques-sim__nombre" }, chipPartido(b.partido), " ", partidoNombre(b.partido).replace(/ \(.*\)$/, ""), b.partido === l.partido ? el("span", { class: "nota" }, " · su partido") : null),
      el("span", { class: "medidor bloques-sim__barra", "aria-hidden": "true" }, el("span", { class: partidoClase(b.partido), vars: { "--w": `${Math.round(x * 100)}%` } })),
      el("span", { class: "bloques-sim__dato" }, el("strong", {}, pct(x)), el("span", { class: "nota" }, ` ${numero(b.igual)} de ${numero(b.comun)}`)));
  }));
}

export function seccionSimilitud(ctx) {
  const { e, cambiar } = ctx;
  const vista = e.sim === "bloques" ? "bloques" : "legisladores";
  return el("section", { class: "tarjeta", "aria-labelledby": "t-sim" },
    el("div", { class: "tarjeta__cabecera" },
      el("div", {}, el("h2", { id: "t-sim" }, "Similitud de voto"),
        el("p", { class: "tarjeta__descripcion" }, vista === "legisladores"
          ? `Porcentaje de votaciones en las que ${ctx.l.nombre_corto || ctx.l.nombre} votó igual que cada legislador en ejercicio. Tocá una foto para ver en cuáles coincidieron y en cuáles no.`
          : `Porcentaje de votaciones en las que ${ctx.l.nombre_corto || ctx.l.nombre} votó igual que la mayoría de cada partido.`)),
      el("div", { class: "tarjeta__acciones" }, segmentado("Comparar con", [["legisladores", "Legisladores"], ["bloques", "Partidos"]], vista, (v) => cambiar({ sim: v, con: "" })))),
    el("div", { class: "tarjeta__cuerpo" }, vista === "legisladores" ? similitudLegisladores(ctx) : similitudBloques(ctx)),
    el("details", { class: "tarjeta__metodologia" }, el("summary", {}, "Metodología"),
      el("ul", {},
        el("li", {}, "Solo cuentan las votaciones en las que los dos votaron Sí, No o Abstención: las ausencias, «no vota» y las mociones no entran."),
        el("li", {}, `Hace falta compartir al menos ${ctx.A.criterios.similitud_minimo} votaciones en el período; si no, la persona no aparece.`),
        el("li", {}, "Mayoría de un partido: la opción que eligió más de la mitad de sus legisladores que votaron (sin contar a esta persona). Si ninguna opción pasa la mitad, el partido estuvo dividido y esa votación no cuenta."),
        el("li", {}, "Se usa el partido actual de la nómina de SILpy, no la bancada: el historial de bancadas empieza en octubre de 2026 y no cubre el período."),
        el("li", {}, "Casi todo se aprueba por amplia mayoría, así que los porcentajes son altos para todos: mirá las diferencias, no el nivel."))));
}

// ---------- 3. Votaciones clave (detrás de config.LEYES_CLAVE_PUBLICADAS; hoy no hay datos y no se muestra) ----------
export function seccionLeyesClave(A) {
  if (!A.leyes_clave || !A.leyes_clave.length) return null;
  return el("section", { class: "tarjeta", "aria-labelledby": "t-clave" },
    el("div", { class: "tarjeta__cabecera" }, el("h2", { id: "t-clave" }, "Votaciones clave")),
    el("ul", { class: "lista tarjeta__lista" }, A.leyes_clave.map((f) => el("li", { class: "fila-clave" },
      el("strong", {}, f.titulo), el("span", { class: "nota" }, ` ${fecha(f.fecha)} · ${f.resultado} · su partido: ${f.su_partido} · gobierno: ${f.gobierno}`),
      el("span", { class: "fila-clave__voto" }, f.su_voto)))));
}

// ---------- Datos abiertos ----------
export function seccionDatosAbiertos(d, l, resumen) {
  const base = `datos/congreso/${d.clave}/legisladores/${l.id}/`;
  const archivo = (nombre, desc) => el("li", {}, el("a", { class: "boton", href: base + nombre, download: `${l.id}-${nombre}` }, nombre), " ", el("span", { class: "nota" }, desc));
  return [
    el("section", { class: "tarjeta", "aria-labelledby": "t-descargas" },
      el("div", { class: "tarjeta__cabecera" }, el("div", {}, el("h2", { id: "t-descargas" }, "Descargas"),
        el("p", { class: "tarjeta__descripcion" }, "Archivos generados por el pipeline del proyecto, iguales para todos: se pueden enlazar directamente."))),
      el("div", { class: "tarjeta__cuerpo" }, el("ul", { class: "descargas" },
        archivo("votos.csv", "Una fila por votación en la que estaba en el cargo, con su voto."),
        archivo("resumen.json", "Datos del legislador, conteo del mandato, licencia y diccionario de columnas."),
        archivo("analisis.json", "Series por período, similitud de voto y coincidencia con los partidos.")))),
    el("section", { class: "tarjeta", "aria-labelledby": "t-diccionario" },
      el("div", { class: "tarjeta__cabecera" }, el("h2", { id: "t-diccionario" }, "Columnas de votos.csv")),
      el("div", { class: "tarjeta__cuerpo" }, el("dl", { class: "definiciones" },
        Object.entries(resumen?.archivos?.["votos.csv"] || {}).map(([k, v]) => [el("dt", {}, el("code", {}, k)), el("dd", {}, v)])))),
    el("section", { class: "tarjeta", "aria-labelledby": "t-lic" },
      el("div", { class: "tarjeta__cabecera" }, el("h2", { id: "t-lic" }, "Licencia")),
      el("div", { class: "tarjeta__cuerpo" }, el("p", {}, "Los datos derivados se publican bajo ",
        el("a", { href: "https://creativecommons.org/licenses/by-sa/4.0/deed.es", rel: "noopener" }, "CC BY-SA 4.0"),
        ". La fuente original es SILpy – Congreso Nacional del Paraguay, bajo ",
        el("a", { href: "https://creativecommons.org/licenses/by/4.0/deed.es", rel: "noopener" }, "CC BY 4.0"),
        ": al reutilizarlos, citá al Congreso Nacional y a Hesakã."))),
  ];
}

export const CODIGOS_VOTO = ORDEN_VOTO;
export { VOTOS, porcentaje };
