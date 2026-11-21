// Votómetro: comportamiento de voto de toda la cámara. Los números salen de votometro.json (pipeline:
// votometro.py); acá solo se dibujan. Estado en el #hash: camara, periodo, partido (ranking de disciplina), aparto
// (id del legislador cuyas votaciones «se apartó» están abiertas) y seleccionado (buscador: se resalta en todo).
import { camara, camaraValida, votometro } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, escribirEstado, leerEstado } from "../lib/estado.js";
import { apellidoNombre, fecha, numero, ordenPartido, partidoClase, partidoNombre } from "../lib/formato.js";
import { avatar, chipPartido, chipResultado, chipVoto, enlaceLegislador, enlaceVotacion, listaPaginada, tipoCorto } from "../lib/componentes.js";
import { conectar, soltar } from "../lib/tooltip.js";
import { crearBuscador, resaltar } from "../lib/buscador.js";
import { anchoDe, escala } from "../lib/graficos.js";
import { segmentado } from "./perfil-analisis.js";

const DEFECTOS = { camara: "senado", periodo: "mandato", partido: "", aparto: "", seleccionado: "", medida: "anr" };
const sel = () => leerEstado(DEFECTOS).seleccionado;
const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
let D = null;   // { cam, vm }

const persona = (id) => D.cam.porId.get(Number(id)) || { id: Number(id), nombre: `Legislador ${id}`, nombre_corto: "", partido: "" };
const nombreCorto = (l) => l.nombre_corto || l.nombre;

/** Tooltip de una persona con «Ver perfil» al fijarlo (click o Enter). */
function conectarPersona(nodo, l, lineas) {
  nodo.dataset.persona = l.id;   // para resaltar al elegido en el buscador
  nodo.setAttribute("role", "button");
  nodo.setAttribute("aria-label", `${l.nombre}, ${partidoNombre(l.partido)}. ${lineas.join(". ")}`);
  conectar(nodo, { contenido: (fijo) => [
    el("div", { class: "tooltip__persona" }, avatar(l), el("div", {}, el("strong", {}, apellidoNombre(l.nombre, l.nombre_corto)), el("div", {}, chipPartido(l.partido)))),
    lineas.map((t) => el("p", { class: "tooltip__linea" }, t)),
    fijo && el("p", { class: "tooltip__acciones" }, el("a", { class: "boton", href: enlaceLegislador(l, D.cam.clave) }, "Ver perfil ", el("span", { "aria-hidden": "true" }, "→"))),
  ] });
}

function cambiar(cambios) {
  escribirEstado({ ...leerEstado(DEFECTOS), ...cambios }, DEFECTOS);
  dibujar();
}

// ---------- 1. Disciplina de partido ----------
function filaApartamiento(r) {
  const [id, suVoto, partidoVoto] = r;
  const k = D.cam.posVotacion.get(id);
  const v = D.cam.votaciones[k];
  return el("li", { class: "fila-coincidencia" },
    el("time", { datetime: v.fecha }, fecha(v.fecha)),
    el("a", { href: enlaceVotacion(v, D.cam.clave) }, v.es_ley ? "Proyecto de ley" : tipoCorto(v.tipo_proyecto), v.expediente ? ` · ${v.expediente}` : ""),
    el("span", { class: "fila-coincidencia__votos" }, el("span", { class: "nota" }, "Votó "), chipVoto(suVoto), el("span", { class: "nota" }, " · su partido "), chipVoto(partidoVoto)));
}

function disciplina(pp, e) {
  const filas = pp.disciplina.legisladores;
  const partidos = [...new Set(filas.map((f) => f.partido))].sort((a, b) => filas.filter((f) => f.partido === b).length - filas.filter((f) => f.partido === a).length || ordenPartido(a) - ordenPartido(b));
  const delSel = filas.find((f) => String(f.id) === e.seleccionado);
  const elegido = partidos.includes(e.partido) ? e.partido : delSel ? delSel.partido : partidos[0];
  const sel = $("#f-partido");
  sel.replaceChildren(...partidos.map((p) => el("option", { value: p, selected: p === elegido || null }, `${partidoNombre(p).replace(/ \(.*\)$/, "")} (${p})`)));
  // De menos a más disciplinado (lo que más interesa arriba), de a 10
  const delPartido = filas.filter((f) => f.partido === elegido).sort((x, y) => y.puesto - x.puesto || x.id - y.id);
  const k = delPartido.findIndex((f) => String(f.id) === e.seleccionado);
  if (k > 0) delPartido.unshift(...delPartido.splice(k, 1));   // el elegido en el buscador, arriba de todo
  listaPaginada($("#g-disciplina"), delPartido, (f) => {
    const l = persona(f.id);
    const abiertas = String(f.id) === e.aparto;
    const veces = f.comun - f.igual;
    const lista = el("div", { class: "aparto", hidden: !abiertas, id: `aparto-${f.id}` });
    if (abiertas) listaPaginada(lista, pp.disciplina.se_aparto[String(f.id)], filaApartamiento, { paso: 10, vacio: "Nunca se apartó." });
    return el("li", { class: "fila-disciplina", dataset: { filaPersona: f.id } },
      el("span", { class: "fila-disciplina__puesto" }, `${f.puesto}.º`, el("span", { class: "nota" }, ` de ${f.de}`)),
      avatar(l),
      el("span", { class: "fila-disciplina__nombre" }, el("a", { href: enlaceLegislador(l, D.cam.clave) }, apellidoNombre(l.nombre, l.nombre_corto))),
      el("span", { class: "medidor fila-disciplina__barra", "aria-hidden": "true" }, el("span", { class: partidoClase(f.partido), vars: { "--w": `${Math.round(f.pct * 100)}%` } })),
      el("span", { class: "fila-disciplina__dato" }, el("strong", {}, pct(f.pct)), el("span", { class: "nota" }, ` ${numero(f.igual)} de ${numero(f.comun)}`)),
      el("button", { type: "button", class: "ver-mas fila-disciplina__boton", "aria-expanded": String(abiertas), "aria-controls": `aparto-${f.id}`,
        on: { click: () => cambiar({ aparto: abiertas ? "" : String(f.id) }) } }, veces ? `Se apartó ${numero(veces)} ${veces === 1 ? "vez" : "veces"}` : "Nunca se apartó"),
      lista);
  }, { paso: 10, vacio: "Ningún legislador de este partido tiene votaciones suficientes." });
}

function cohesionBarras(pp) {
  vaciar($("#g-cohesion"), pp.cohesion.map((c) => el("li", { class: "bloques-sim__fila" },
    el("span", { class: "bloques-sim__nombre" }, chipPartido(c.partido), " ", partidoNombre(c.partido).replace(/ \(.*\)$/, ""), el("span", { class: "nota" }, ` · ${numero(c.integrantes)}`)),
    el("span", { class: "medidor bloques-sim__barra", "aria-hidden": "true" }, el("span", { class: partidoClase(c.partido), vars: { "--w": `${Math.round(c.rice * 100)}%` } })),
    el("span", { class: "bloques-sim__dato" }, el("strong", {}, c.rice.toFixed(2).replace(".", ",")), el("span", { class: "nota" }, ` en ${numero(c.votaciones)}`)))));
}

function cohesionMensual(pp, ancho) {
  const meses = [...new Set(pp.cohesion.flatMap((c) => c.mensual.map((m) => m.mes)))].sort();
  if (meses.length < 2) return el("p", { class: "vacio" }, "Muy pocos meses para ver la evolución.");
  const ml = 36, mr = 10, mt = 10, mb = 24;
  const alto = ancho < 560 ? 190 : 230;
  const x = escala(0, meses.length - 1, ml, ancho - mr);
  const lo = Math.max(0, Math.floor(Math.min(...pp.cohesion.flatMap((c) => c.mensual.map((m) => m.rice))) * 10) / 10);
  const y = escala(lo, 1, alto - mb, mt);
  const svg = el("svg:svg", { class: "linea-grafico", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group", "aria-label": "Cohesión mensual de cada partido" });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  for (let v = 1; v >= lo - 1e-9; v -= (1 - lo) > 0.5 ? 0.2 : 0.1) {
    eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: "eje__guia" }),
      el("svg:text", { x: ml - 5, y: y(v) + 4, "text-anchor": "end", class: "eje__texto" }, v.toFixed(1).replace(".", ",")));
  }
  meses.forEach((m, i) => { if (i === 0 || m.slice(0, 4) !== meses[i - 1].slice(0, 4)) eje.append(el("svg:text", { x: x(i), y: alto - mb + 15, "text-anchor": "middle", class: "eje__texto eje__texto--anio" }, m.slice(0, 4))); });
  svg.append(eje);
  const pos = new Map(meses.map((m, i) => [m, i]));
  for (const c of pp.cohesion) {
    const d = c.mensual.map((m, i) => `${i ? "L" : "M"}${x(pos.get(m.mes)).toFixed(1)},${y(m.rice).toFixed(1)}`).join("");
    svg.append(el("svg:path", { d, class: ["linea-partido", partidoClase(c.partido)] }));
    for (const m of c.mensual) {
      const p = el("svg:circle", { cx: x(pos.get(m.mes)).toFixed(1), cy: y(m.rice).toFixed(1), r: 3, class: ["punto-dato", "punto-dato--chico", partidoClase(c.partido)] });
      const txt = `${c.partido}, ${MESES[Number(m.mes.slice(5)) - 1]} ${m.mes.slice(0, 4)}: cohesión ${m.rice.toFixed(2).replace(".", ",")} en ${numero(m.votaciones)} votaciones`;
      p.setAttribute("aria-label", txt);
      conectar(p, { contenido: () => [el("strong", {}, `${partidoNombre(c.partido)}`), el("p", { class: "tooltip__linea" }, txt)] });
      svg.append(p);
    }
  }
  return svg;
}

// ---------- 2. El voto decisivo ----------
function frase(f) {
  const lado = f.ganador === "S" ? "el Sí" : "el No";
  if (f.tipo === "margen") {
    const base = `Ganó ${lado} por ${numero(f.margen)} ${f.margen === 1 ? "voto" : "votos"} (${numero(f.si)} a ${numero(f.no)}).`;
    return f.alcanzaba_con_ausentes
      ? `${base} Con ${numero(f.para_dar_vuelta)} de los ${numero(f.ausentes)} ausentes votando en contra, el resultado se daba vuelta.`
      : `${base} Había ${numero(f.ausentes)} ausentes: no alcanzaban para dar vuelta el resultado.`;
  }
  const alcanzo = f.diferencia >= 0;
  const base = `Hacía falta ${f.descripcion} (${numero(f.umbral)} votos). ${alcanzo ? `Se alcanzó con ${numero(f.diferencia + 1)} ${f.diferencia === 0 ? "voto" : "votos"} de margen` : `Faltaron ${numero(-f.diferencia)} ${f.diferencia === -1 ? "voto" : "votos"}`} (${numero(f.si)} Sí, ${numero(f.no)} No).`;
  if (alcanzo) return `${base} Si ${numero(f.para_dar_vuelta)} de quienes votaron con la mayoría no lo hacían, el resultado cambiaba.`;
  return f.alcanzaba_con_ausentes ? `${base} Había ${numero(f.ausentes)} ausentes: con ${numero(f.para_dar_vuelta)} de ellos se alcanzaba.` : base;
}

/** En cada votación decisiva: cómo votó el legislador elegido en el buscador. */
function votoElegido(k) {
  const id = sel();
  const cad = id && D.cam.votos.legisladores[id];
  if (!cad) return null;
  const l = persona(id);
  return el("p", { class: "fila-sala__sel" }, `${nombreCorto(l)}: `, cad[k] === "-" ? el("span", { class: "nota" }, "no estaba en el cargo") : chipVoto(cad[k]));
}

function decisivas(pp) {
  const dec = pp.decisivas;
  if (!dec.votaciones.length) { vaciar($("#g-decisivas"), el("p", { class: "vacio" }, "No hubo votaciones así en este período.")); vaciar($("#g-ganadores"), el("p", { class: "vacio" }, "No hubo votaciones decisivas en este período.")); return; }
  listaPaginada($("#g-decisivas"), dec.votaciones, (f) => {
    const k = D.cam.posVotacion.get(f.id);
    const v = D.cam.votaciones[k];
    return el("li", { class: "fila-decisiva" },
      el("time", { class: "fila-decisiva__fecha", datetime: v.fecha }, fecha(v.fecha)),
      el("div", { class: "fila-decisiva__asunto" }, el("a", { class: "fila-decisiva__link", href: enlaceVotacion(v, D.cam.clave) }, v.es_ley ? "Proyecto de ley" : tipoCorto(v.tipo_proyecto),
        v.expediente ? el("span", { class: "nota" }, ` · ${v.expediente}`) : null),
        el("p", { class: "titulo-silpy clamp clamp-1" }, v.titulo),
        el("p", { class: "fila-decisiva__frase" }, frase(f)),
        votoElegido(k)),
      el("span", { class: "fila-decisiva__resultado" }, chipResultado(v.resultado)));
  }, { paso: 8, vacio: "" });
  const max = dec.ranking[0]?.veces || 0;
  // los 10 primeros puestos, con todos los empatados en el último
  const corte = dec.ranking[Math.min(9, dec.ranking.length - 1)]?.veces ?? 0;
  const visibles = dec.ranking.filter((r) => r.veces >= corte);
  // el elegido en el buscador, aunque no esté entre los primeros
  const suyo = dec.ranking.find((r) => String(r.id) === sel());
  if (suyo && !visibles.includes(suyo)) visibles.push(suyo);
  vaciar($("#g-ganadores"), visibles.map((r) => {
    const l = persona(r.id);
    return el("li", { class: "fila-ganador", dataset: { filaPersona: r.id } }, avatar(l),
      el("a", { href: enlaceLegislador(l, D.cam.clave) }, apellidoNombre(l.nombre, l.nombre_corto)), chipPartido(l.partido),
      el("span", { class: "medidor", "aria-hidden": "true" }, el("span", { class: partidoClase(l.partido), vars: { "--w": `${Math.round((100 * r.veces) / max)}%` } })),
      el("strong", {}, `${numero(r.veces)} de ${numero(dec.votaciones.length)}`));
  }));
}

// ---------- Medidas de posición (las mismas en «Mapa en el tiempo», «Posición y asistencia» y «Posición política») ----------
const MEDIDAS = {
  anr: { nombre: "Coincidencia con la ANR", corto: "Coincidencia", fmt: (x) => pct(x) },
  mds: { nombre: "Escalamiento (MDS)", corto: "Escalamiento", fmt: (x) => x.toFixed(2).replace(".", ",").replace("-", "−") },
};
// Extremos del eje en palabras (versión corta en pantallas angostas)
const extremos = (ancho) => (ancho < 640
  ? ["← más distinto a la ANR", "más como la ANR →"]
  : ["← vota más distinto a la mayoría de la ANR", "vota más como la mayoría de la ANR →"]);
/** Los dos extremos del eje en palabras; si no entran en una línea, uno debajo del otro. Devuelve [nodos, alto]. */
function textosExtremos(x0, x1, y, ancho) {
  const [izq, der] = extremos(ancho);
  const apilar = (izq.length + der.length) * 6.4 + 24 > x1 - x0;
  return [[el("svg:text", { x: x0, y, class: "eje__texto eje__texto--fuerte" }, izq),
    el("svg:text", { x: x1, y: apilar ? y + 14 : y, "text-anchor": "end", class: "eje__texto eje__texto--fuerte" }, der)], apilar ? 14 : 0];
}
const textoMedida = (medida, x) => (medida === "anr" ? `Votó como la mayoría de la ANR en el ${pct(x)} de las votaciones divididas` : `Escalamiento: ${MEDIDAS.mds.fmt(x)}`);
/** Dominio del eje según la medida: la coincidencia va en %, redondeada a décimas; el escalamiento, con margen. */
function dominio(medida, xs) {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (medida === "anr") return [Math.max(0, Math.floor(lo * 10 - 1e-9) / 10), Math.min(1, Math.ceil(hi * 10 - 1e-9) / 10) || 1];
  const pad = (hi - lo) * 0.05 || 0.1;
  return [lo - pad, hi + pad];
}
const ticksAnr = ([a, b]) => { const out = []; const paso = b - a > 0.5 ? 0.2 : 0.1; for (let v = a; v <= b + 1e-9; v += paso) out.push(Math.round(v * 100) / 100); return out; };
function selectorMedida(caja, e) {
  vaciar(caja, segmentado("Medida", Object.entries(MEDIDAS).map(([k, m]) => [k, m.nombre]), e.medida, (v) => cambiar({ medida: v })));
}

// ---------- 3. Mapa político en el tiempo ----------
function trayectoria(tr, medida, ancho) {
  if (tr.ventanas.length < 2) return el("p", { class: "vacio" }, "Todavía no hay ventanas suficientes para ver la evolución.");
  const datos = tr[medida];
  const ml = 44, mr = ancho < 560 ? 12 : 130, mt = 22, mb = medida === "mds" ? 52 : 40;
  const alto = ancho < 560 ? 320 : 400;
  const x = escala(0, tr.ventanas.length - 1, ml, ancho - mr);
  const valores = Object.values(datos.posiciones).flat().filter((v) => v !== null);
  const [y0, y1] = medida === "mds" ? [-1, 1] : dominio("anr", valores);
  const y = escala(y0, y1, alto - mb, mt);
  const destacados = new Set(datos.movimiento.slice(0, 5).map((m) => String(m.id)));
  const svg = el("svg:svg", { class: "trayectoria", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group",
    "aria-label": `${MEDIDAS[medida].nombre} de cada legislador en cada ventana de 12 meses` });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  const guias = medida === "mds" ? [-1, -0.5, 0, 0.5, 1] : ticksAnr([y0, y1]);
  for (const v of guias) {
    eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: medida === "mds" && v === 0 ? "eje__guia eje__guia--anio" : "eje__guia" }));
    if (medida === "anr") eje.append(el("svg:text", { x: ml - 5, y: y(v) + 4, "text-anchor": "end", class: "eje__texto" }, `${Math.round(v * 100)}%`));
  }
  tr.ventanas.forEach((w, i) => {
    const [a, m] = w.desde.split("-");
    eje.append(el("svg:text", { x: x(i), y: alto - mb + 16, "text-anchor": "middle", class: "eje__texto" }, `${MESES[Number(m) - 1]} ${a.slice(2)}`));
    if (medida === "mds") eje.append(el("svg:text", { x: x(i), y: alto - mb + 29, "text-anchor": "middle", class: "eje__texto" }, `${pct(w.var1)}`));
  });
  const corto = ancho < 640;
  eje.append(el("svg:text", { x: ml + 4, y: mt - 8, class: "eje__texto eje__texto--fuerte" }, corto ? "↑ más como la ANR" : "↑ vota más como la mayoría de la ANR"),
    el("svg:text", { x: ml + 4, y: alto - mb + (medida === "mds" ? 44 : 32), class: "eje__texto eje__texto--fuerte" }, corto ? "↓ más distinto a la ANR" : "↓ vota más distinto a la mayoría de la ANR"));
  svg.append(eje);
  const capaFondo = el("svg:g"), capaFrente = el("svg:g");
  const etiquetas = [];
  for (const [id, serie] of Object.entries(datos.posiciones)) {
    const l = persona(id);
    let d = "";
    serie.forEach((p, i) => { if (p !== null) d += `${d && serie[i - 1] !== null && serie[i - 1] !== undefined ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`; });
    if (!d) continue;
    const dest = destacados.has(id) || id === sel();
    const g = el("svg:g", { class: ["trayecto", partidoClase(l.partido), dest && "trayecto--destacado"] },
      el("svg:path", { d, class: "trayecto__linea" }),
      serie.map((p, i) => (p === null ? null : el("svg:circle", { cx: x(i).toFixed(1), cy: y(p).toFixed(1), r: dest ? 3.5 : 2, class: "trayecto__punto" }))));
    const mov = datos.movimiento.find((m) => String(m.id) === id);
    conectarPersona(g, l, [`${MEDIDAS[medida].corto} por ventana: ${serie.map((p) => (p === null ? "—" : MEDIDAS[medida].fmt(p))).join(" → ")}`,
      mov ? `Rango recorrido: ${medida === "anr" ? `${Math.round(mov.rango * 100)} puntos` : MEDIDAS.mds.fmt(mov.rango)}` : "Aparece en una sola ventana"]);
    (dest ? capaFrente : capaFondo).append(g);
    if (dest && ancho >= 560) {
      const ult = serie.findLastIndex((p) => p !== null);
      etiquetas.push({ y: y(serie[ult]), x: x(ult) + 6, texto: nombreCorto(l) });
    }
  }
  etiquetas.sort((a, b) => a.y - b.y);
  let ultimo = -Infinity;
  for (const e of etiquetas) { const ty = Math.max(e.y + 4, ultimo + 13); ultimo = ty; capaFrente.append(el("svg:text", { x: e.x, y: ty, class: ["etiqueta-dato", "etiqueta-dato--halo"] }, e.texto)); }
  svg.append(capaFondo, capaFrente);
  return [svg, el("p", { class: "nota" }, medida === "mds"
    ? "Debajo de cada ventana, cuánto de las diferencias de voto resume el escalamiento. Se resaltan los 5 que más se movieron."
    : "Porcentaje de votaciones divididas de cada ventana en las que votó como la mayoría de la ANR. Se resaltan los 5 que más se movieron.")];
}

// ---------- Ausentismo selectivo ----------
function graficoAusentismo(a, ancho) {
  const pts = a.puntos;
  if (!pts.length) return el("p", { class: "vacio" }, `Hubo ${numero(a.votaciones_objeciones)} votaciones sobre vetos en el período: muy pocas para comparar (hacen falta al menos ${numero(a.minimos.objeciones)} en el cargo).`);
  const ml = 46, mr = 16, mt = 12, mb = 44;
  const alto = Math.round(Math.min(Math.max(ancho * 0.72, 300), 460));
  const hi = Math.min(1, Math.ceil(Math.max(...pts.flatMap((p) => [p.objeciones, p.resto])) * 10 - 1e-9) / 10);
  const x = escala(0, hi, ml, ancho - mr);
  const y = escala(0, hi, alto - mb, mt);
  const svg = el("svg:svg", { class: "dispersion", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group",
    "aria-label": "Ausencia en el resto de las votaciones (horizontal) y en las votaciones sobre vetos (vertical)" });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  const paso = hi > 0.5 ? 0.2 : 0.1;
  for (let v = 0; v <= hi + 1e-9; v += paso) {
    eje.append(el("svg:line", { x1: x(v), x2: x(v), y1: mt, y2: alto - mb, class: "eje__guia" }), el("svg:text", { x: x(v), y: alto - mb + 16, "text-anchor": "middle", class: "eje__texto" }, `${Math.round(v * 100)}%`),
      el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: "eje__guia" }), el("svg:text", { x: ml - 6, y: y(v) + 4, "text-anchor": "end", class: "eje__texto" }, `${Math.round(v * 100)}%`));
  }
  eje.append(el("svg:text", { x: (ml + ancho - mr) / 2, y: alto - 6, "text-anchor": "middle", class: "eje__titulo" }, "ausencia en el resto de las votaciones"),
    el("svg:text", { x: 12, y: (mt + alto - mb) / 2, "text-anchor": "middle", class: "eje__titulo", transform: `rotate(-90 12 ${(mt + alto - mb) / 2})` }, "ausencia en los vetos"));
  svg.append(el("svg:polygon", { points: `${x(0)},${y(0)} ${x(hi)},${y(hi)} ${x(0)},${y(hi)}`, class: "zona-baja" }), eje,
    el("svg:line", { x1: x(0), y1: y(0), x2: x(hi), y2: y(hi), class: "diagonal" }),
    el("svg:text", { x: x(0) + 8, y: y(hi) + 14, class: "zona-baja__texto" }, "faltan más en los vetos"));
  const r = ancho < 560 ? 4.5 : 5.5;
  for (const p of pts) {
    const l = persona(p.id);
    const c = el("svg:circle", { cx: x(p.resto).toFixed(1), cy: y(p.objeciones).toFixed(1), r, class: ["punto-dato", partidoClase(l.partido)] });
    conectarPersona(c, l, [`Ausente en ${pct(p.objeciones)} de ${numero(p.n_objeciones)} votaciones sobre vetos`, `Ausente en ${pct(p.resto)} de ${numero(p.n_resto)} del resto`,
      `Diferencia: ${p.diferencia >= 0 ? "+" : "−"}${Math.abs(Math.round(p.diferencia * 100))} puntos`]);
    svg.append(c);
  }
  const marcados = pts.filter((p) => p.diferencia > 0).slice(0, 3);
  const elegido = pts.find((p) => String(p.id) === sel());
  if (elegido && !marcados.includes(elegido)) marcados.push(elegido);
  let ultimo = -Infinity;
  for (const p of [...marcados].sort((u, v) => y(u.objeciones) - y(v.objeciones))) {
    const l = persona(p.id);
    const d = Math.round(p.diferencia * 100);
    const texto = `${nombreCorto(l)} ${d >= 0 ? "+" : "−"}${Math.abs(d)}`;
    const cx = x(p.resto), ty = Math.max(y(p.objeciones) + 4, ultimo + 15);
    ultimo = ty;
    const w = texto.length * 6.7;
    const tx = cx + 9 + w < ancho - mr ? cx + 9 : Math.max(ml + 2, cx - 9 - w);
    svg.append(el("svg:text", { x: tx.toFixed(1), y: ty.toFixed(1), class: ["etiqueta-dato", "etiqueta-dato--halo"] }, texto));
  }
  return svg;
}

// ---------- Resumen del elegido en el buscador ----------
function resumenSeleccion(pp) {
  const caja = $("#seleccion-resumen");
  const id = sel();
  if (!id || !D) { caja.hidden = true; caja.replaceChildren(); return; }
  const l = persona(id);
  const partes = [];
  const au = pp.ausentismo.puntos.find((p) => String(p.id) === id);
  if (au) partes.push(`ausente en el ${pct(au.objeciones)} de los vetos y el ${pct(au.resto)} del resto`);
  const di = pp.disciplina.legisladores.find((f) => String(f.id) === id);
  if (di) partes.push(`votó como su partido el ${pct(di.pct)} de las veces (${di.puesto}.º de ${di.de} en ${di.partido})`);
  const ga = pp.decisivas.ranking.find((r) => String(r.id) === id);
  if (pp.decisivas.votaciones.length) partes.push(`del lado ganador en ${numero(ga ? ga.veces : 0)} de ${numero(pp.decisivas.votaciones.length)} votaciones decisivas`);
  if (!partes.length) partes.push("no tiene votaciones suficientes en este período para estos análisis");
  const quitar = el("button", { type: "button", class: "seleccion__quitar", "aria-label": `Quitar a ${l.nombre}` }, "×");
  quitar.addEventListener("click", () => { soltar(false); $("#f-buscar").value = ""; cambiar({ seleccionado: "" }); });
  caja.replaceChildren(avatar(l), el("div", { class: "seleccion__texto" }, el("strong", {}, apellidoNombre(l.nombre, l.nombre_corto)), " ", chipPartido(l.partido),
    el("span", { class: "seleccion__dato" }, `En el período: ${partes.join(" · ")}.`)),
  el("a", { class: "boton", href: enlaceLegislador(l, D.cam.clave) }, "Ver perfil"), quitar);
  caja.hidden = false;
  if (!$("#f-buscar").value) $("#f-buscar").value = l.nombre;
}

// ---------- Posición política estimada: una fila por partido ----------
/** Enjambre en una fila: desplazamiento vertical de cada punto (en px) para que no se superpongan. */
function enjambre(xs, r) {
  const orden = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const puestos = [];
  const off = new Array(xs.length).fill(0);
  const d = 2 * r + 0.8;
  for (const [x, i] of orden) {
    for (let k = 0; ; k++) {
      const dy = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (d * 0.86);
      if (puestos.every(([px, py]) => (px - x) ** 2 + (py - dy) ** 2 >= d * d - 0.01)) { puestos.push([x, dy]); off[i] = dy; break; }
    }
  }
  return off;
}

function graficoPosicion(pm, medida, ancho) {
  const pts = pm.puntos;
  if (!pts.length) return el("p", { class: "vacio" }, "No hay legisladores con votaciones suficientes en el período.");
  const ml = 12, mr = 12, r = ancho < 560 ? 3.4 : 5;
  const angosto = ancho < 640;
  const [x0, x1] = dominio(medida, pts.map((p) => p.valor));
  const x = escala(x0, x1, ml, ancho - mr);
  const porId = new Map(pts.map((p) => [String(p.id), p]));
  const cruzados = new Set(pm.cruzados.map((c) => String(c.id)));
  const cercaDe = new Map(pm.cruzados.map((c) => [String(c.id), c.cerca_de]));
  const elegido = sel();
  const capas = [];
  let yBase = 0;
  for (const f of pm.filas) {
    const miembros = pts.filter((p) => pm.grupo[String(p.id)] === f.grupo);
    const off = enjambre(miembros.map((p) => x(p.valor)), r);
    const arriba = Math.max(0, ...off.map((o) => -o)) + r + 4, abajo = Math.max(0, ...off) + r + 4;
    const yTitulo = yBase + 16, yCentro = yTitulo + 8 + arriba;
    const g = el("svg:g", { class: "fila-posicion" });
    const titulo = f.grupo === "Otros" ? `Otros (${f.partidos.join(", ")})` : angosto ? f.grupo : `${partidoNombre(f.grupo).replace(/ \(.*\)$/, "")}`;
    g.append(el("svg:text", { x: ml, y: yTitulo, class: "fila-posicion__titulo" }, `${titulo} · ${numero(f.integrantes)}`,
      el("svg:tspan", { class: "fila-posicion__mediana" }, f.grupo === "Otros" ? "" : ` · mediana ${MEDIDAS[medida].fmt(f.mediana)}`)));
    g.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: yCentro, y2: yCentro, class: "fila-posicion__base" }));
    // la mediana del partido como raya (no para «Otros», que mezcla partidos)
    if (f.grupo !== "Otros") {
      const raya = el("svg:line", { x1: x(f.mediana), x2: x(f.mediana), y1: yCentro - arriba + 2, y2: yCentro + abajo - 2, class: ["mediana-partido", partidoClase(f.grupo)] });
      raya.setAttribute("aria-label", `Mediana de ${titulo}: ${MEDIDAS[medida].fmt(f.mediana)}`);
      conectar(raya, { contenido: () => [el("strong", {}, `Mediana de ${titulo}`), el("p", { class: "tooltip__linea" }, textoMedida(medida, f.mediana))] });
      g.append(raya);
    }
    const etiquetas = [];
    miembros.forEach((p, k) => {
      const l = persona(p.id);
      const cy = yCentro + off[k];
      const c = el("svg:circle", { cx: x(p.valor).toFixed(1), cy: cy.toFixed(1), r, class: ["punto-dato", partidoClase(l.partido)] });
      const lineas = [textoMedida(medida, p.valor)];
      if (cruzados.has(String(p.id))) lineas.push(`Más cerca de la mediana de ${cercaDe.get(String(p.id))} que de la de su partido`);
      conectarPersona(c, l, lineas);
      g.append(c);
      if (cruzados.has(String(p.id)) || String(p.id) === elegido) etiquetas.push({ p, l, cx: x(p.valor), cy, sel: String(p.id) === elegido });
    });
    // Etiquetas fijas debajo del enjambre, en carriles para que no se superpongan, con una línea al punto
    const carriles = [];
    etiquetas.sort((a, b) => a.cx - b.cx);
    const yEtiquetas = yCentro + abajo + 12;
    const guias = el("svg:g"), textos = el("svg:g");   // las líneas detrás de todos los nombres
    for (const e of etiquetas) {
      const texto = nombreCorto(e.l);
      const w = texto.length * 6.6 + 6;
      const tx = Math.min(Math.max(ml, e.cx - w / 2), ancho - mr - w);
      let c = carriles.findIndex((fin) => fin + 4 <= tx);
      if (c < 0) { carriles.push(0); c = carriles.length - 1; }
      carriles[c] = tx + w;
      const ty = yEtiquetas + c * 15;
      guias.append(el("svg:line", { x1: e.cx.toFixed(1), x2: (tx + w / 2).toFixed(1), y1: (e.cy + r).toFixed(1), y2: (ty - 10).toFixed(1), class: "etiqueta-guia" }));
      textos.append(el("svg:text", { x: (tx + 3).toFixed(1), y: ty.toFixed(1), class: ["etiqueta-dato", "etiqueta-dato--halo", e.sel && "etiqueta-dato--sel"] }, texto));
    }
    g.prepend(guias);
    g.append(textos);
    yBase = (carriles.length ? yEtiquetas + (carriles.length - 1) * 15 + 6 : yCentro + abajo) + 10;
    capas.push(g);
  }
  // eje común abajo: marcas (en % para la coincidencia) y extremos en palabras
  const yEje = yBase + 4;
  const [nodosExt, extra] = textosExtremos(ml, ancho - mr, yEje + 32, ancho);
  const alto = yEje + 40 + extra;
  const svg = el("svg:svg", { class: "posicion-filas", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group",
    "aria-label": `${MEDIDAS[medida].nombre}: una fila por partido, un punto por legislador` });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  const marcas = medida === "anr" ? ticksAnr([x0, x1]) : (x0 < 0 && x1 > 0 ? [0] : []);
  for (const v of marcas) {
    eje.append(el("svg:line", { x1: x(v), x2: x(v), y1: 0, y2: yEje, class: medida === "mds" ? "eje__guia eje__guia--anio" : "eje__guia" }));
    eje.append(el("svg:text", { x: x(v), y: yEje + 14, "text-anchor": "middle", class: "eje__texto" }, medida === "anr" ? `${Math.round(v * 100)}%` : "centro de la cámara"));
  }
  eje.append(...nodosExt);
  svg.append(eje, ...capas);
  return svg;
}

// ---------- 4 y 5. Dispersión genérica ----------
function dispersion(puntos, ancho, { ejeX, ejeY, valX, valY, dominioX, dominioY, marcasX, lineas, etiqueta, extremosX }) {
  const ml = 46, mr = 14, mt = 12;
  const apilar = extremosX && textosExtremos(ml, ancho - mr, 0, ancho)[1] > 0;
  const mb = extremosX ? (apilar ? 70 : 56) : 42;
  const alto = Math.round(Math.min(Math.max(ancho * 0.66, 280), 440));
  const xs = puntos.map(valX), ys = puntos.map(valY);
  const pad = (a, b) => [a - (b - a) * 0.05, b + (b - a) * 0.05];
  const [x0, x1] = dominioX || pad(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = dominioY || pad(Math.min(...ys), Math.max(...ys));
  const x = escala(x0, x1, ml, ancho - mr);
  const y = escala(y0, y1, alto - mb, mt);
  const svg = el("svg:svg", { class: "dispersion", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group", "aria-label": etiqueta });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  if (marcasX) {
    for (const v of marcasX) eje.append(el("svg:line", { x1: x(v), x2: x(v), y1: mt, y2: alto - mb, class: "eje__guia" }), el("svg:text", { x: x(v), y: alto - mb + 14, "text-anchor": "middle", class: "eje__texto" }, `${Math.round(v * 100)}%`));
  } else if (x0 < 0 && x1 > 0) {
    // La línea del 0 es el centro de la cámara (el escalamiento está centrado en el promedio): se rotula
    eje.append(el("svg:line", { x1: x(0), x2: x(0), y1: mt, y2: alto - mb, class: "eje__guia eje__guia--anio" }),
      el("svg:text", { x: x(0) + 4, y: mt + 10, class: "eje__texto" }, "centro de la cámara"));
  }
  if (!dominioY) eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(0), y2: y(0), class: "eje__guia eje__guia--anio" }));
  else for (let v = 0; v <= 1; v += 0.25) eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: "eje__guia" }), el("svg:text", { x: ml - 5, y: y(v) + 4, "text-anchor": "end", class: "eje__texto" }, `${v * 100}%`));
  if (extremosX) eje.append(...textosExtremos(ml, ancho - mr, alto - mb + 32, ancho)[0]);
  eje.append(el("svg:text", { x: (ml + ancho - mr) / 2, y: alto - 8, "text-anchor": "middle", class: "eje__titulo" }, ejeX),
    el("svg:text", { x: 12, y: (mt + alto - mb) / 2, "text-anchor": "middle", class: "eje__titulo", transform: `rotate(-90 12 ${(mt + alto - mb) / 2})` }, ejeY));
  svg.append(eje);
  const r = ancho < 560 ? 4.5 : 5.5;
  for (const p of puntos) {
    const l = persona(p.id);
    const c = el("svg:circle", { cx: x(valX(p)).toFixed(1), cy: y(valY(p)).toFixed(1), r, class: ["punto-dato", partidoClase(l.partido)] });
    conectarPersona(c, l, lineas(p));
    svg.append(c);
  }
  return svg;
}

/** El mapa 2D va dentro de un <details>: se dibuja cuando está abierto (cerrado no tiene ancho). */
function dibujarMapaCompleto(pp) {
  const caja = $("#g-experimental");
  if (!$("#mapa-completo").open) { vaciar(caja); return; }
  const mapa = pp.mapa;
  vaciar(caja, dispersion(mapa.puntos, Math.min(anchoDe(caja), 820), {
    ejeX: `Diferencia principal entre legisladores (${pct(mapa.var1)})`, ejeY: `Segunda diferencia (${pct(mapa.var2)}, explica poco)`,
    valX: (p) => p.d1, valY: (p) => p.d2, extremosX: true,
    lineas: (p) => [`Diferencia principal: ${MEDIDAS.mds.fmt(p.d1)}`, `Segunda diferencia: ${MEDIDAS.mds.fmt(p.d2)}`],
    etiqueta: "Mapa completo del escalamiento en dos dimensiones (experimental)" }));
  resaltar(sel());
}

// ---------- página ----------
function dibujar() {
  if (!D) return;
  const e = leerEstado(DEFECTOS);
  const periodos = D.vm.periodos;
  if (!periodos.some((p) => p.clave === e.periodo)) e.periodo = "mandato";
  const info = periodos.find((p) => p.clave === e.periodo);
  const pp = D.vm.por_periodo[e.periodo];
  vaciar($("#selector-periodo"), segmentado("Período", periodos.map((p) => [p.clave, p.clave === "mandato" ? "Todo el mandato" : p.nombre.replace("Período ", "")]), e.periodo,
    (v) => cambiar({ periodo: v, aparto: "" })));
  $("#periodo-texto").textContent = `${D.cam.info.nombreLargo} · del ${fecha(info.desde)} al ${fecha(info.hasta)} · ${numero(info.votaciones)} votaciones nominales`;
  vaciar($("#periodo-aviso"), info.aviso ? el("p", { class: "aviso-nota" }, info.aviso) : null);
  for (const s of document.querySelectorAll("[data-min-disciplina]")) s.textContent = numero(D.vm.criterios.minimo_disciplina);
  const au = pp.ausentismo;
  vaciar($("#g-ausentismo"), graficoAusentismo(au, Math.min(anchoDe($("#g-ausentismo")), 760)));
  for (const x of document.querySelectorAll("[data-min-vetos]")) x.textContent = numero(au.minimos.objeciones);
  for (const x of document.querySelectorAll("[data-min-resto]")) x.textContent = numero(au.minimos.resto);
  $("#ausentismo-conteo").textContent = `En el período hubo ${numero(au.votaciones_objeciones)} votaciones sobre vetos y ${numero(au.votaciones_resto)} del resto; entran ${numero(au.puntos.length)}.`;
  disciplina(pp, e);
  cohesionBarras(pp);
  vaciar($("#g-cohesion-mensual"), cohesionMensual(pp, anchoDe($("#g-cohesion-mensual"))));
  decisivas(pp);
  if (!MEDIDAS[e.medida]) e.medida = "anr";
  for (const c of ["#medida-tiempo", "#medida-pos-pres", "#medida-posicion"]) selectorMedida($(c), e);
  vaciar($("#g-trayectoria"), trayectoria(D.vm.trayectoria, e.medida, anchoDe($("#g-trayectoria"))));
  const pm = pp.posicion[e.medida];
  const m = MEDIDAS[e.medida];
  const quienes = `Aparecen quienes votaron en al menos ${numero(pm.minimo_votos)} de las ${numero(pm.divididas)} votaciones divididas del período (${numero(pm.puntos.length)} legisladores).`;
  $("#nota-mapa").textContent = e.medida === "anr" ? quienes : `El escalamiento resume el ${pct(pp.mapa.var1)} de las diferencias de voto. ${quienes}`;
  $("#nota-posicion").textContent = quienes;
  const r = pp.posicion.correlacion;
  $("#correlacion-texto").textContent = r === null ? "" : `Correlación entre las dos medidas en el período: ${r.toFixed(2).replace(".", ",")}${r > 0.9 ? ": las dos medidas ordenan casi igual." : "."}`;
  const marcas = e.medida === "anr" ? ticksAnr(dominio("anr", pm.puntos.map((p) => p.valor))) : null;
  vaciar($("#g-pos-pres"), dispersion(pm.puntos, Math.min(anchoDe($("#g-pos-pres")), 820), {
    ejeX: m.nombre, ejeY: "votaciones en las que votó", valX: (p) => p.valor, valY: (p) => p.voto, dominioY: [0, 1], extremosX: true,
    dominioX: e.medida === "anr" ? dominio("anr", pm.puntos.map((p) => p.valor)) : null, marcasX: marcas,
    lineas: (p) => [textoMedida(e.medida, p.valor), `Votó en el ${pct(p.voto)} de las votaciones del período en el cargo`],
    etiqueta: `${m.nombre} (horizontal) y porcentaje de votaciones en las que votó (vertical)` }));
  vaciar($("#g-posicion"), graficoPosicion(pm, e.medida, Math.min(anchoDe($("#g-posicion")), 980)));
  dibujarMapaCompleto(pp);
  resumenSeleccion(pp);
  resaltar(e.seleccionado);
  if (e.aparto) document.getElementById(`aparto-${e.aparto}`)?.scrollIntoView({ block: "nearest" });
}

let cargada = "";
async function aplicar() {
  const e = leerEstado(DEFECTOS);
  e.camara = camaraValida(e.camara);
  for (const b of document.querySelectorAll("#selector-camara button")) b.setAttribute("aria-pressed", String(b.dataset.camara === e.camara));
  if (cargada === e.camara && D) { dibujar(); return; }
  try {
    const [cam, vm] = await Promise.all([camara(e.camara), votometro(e.camara)]);
    D = { cam, vm };
    cargada = e.camara;
    dibujar();
  } catch (err) {
    mostrarError($("#g-disciplina"), `No se pudieron cargar los datos: ${err.message}`);
  }
}

for (const b of document.querySelectorAll("#selector-camara button")) {
  b.addEventListener("click", () => { $("#f-buscar").value = ""; escribirEstado({ ...leerEstado(DEFECTOS), camara: b.dataset.camara, partido: "", aparto: "", seleccionado: "" }, DEFECTOS); aplicar(); });
}
crearBuscador({
  entrada: $("#f-buscar"),
  lista: $("#buscador-lista"),
  alElegir: (o) => { soltar(false); escribirEstado({ ...leerEstado(DEFECTOS), camara: o.camara, seleccionado: String(o.l.id), partido: "", aparto: "" }, DEFECTOS); aplicar(); },
  alLimpiar: () => { if (sel()) { soltar(false); cambiar({ seleccionado: "" }); } },
});
$("#mapa-completo").addEventListener("toggle", () => { if (D) { const e = leerEstado(DEFECTOS); dibujarMapaCompleto(D.vm.por_periodo[D.vm.periodos.some((p) => p.clave === e.periodo) ? e.periodo : "mandato"]); } });
$("#f-partido").addEventListener("change", () => cambiar({ partido: $("#f-partido").value, aparto: "" }));
let anchoPrevio = 0;
new ResizeObserver(([x]) => {
  const w = Math.round(x.contentRect.width);
  if (D && Math.abs(w - anchoPrevio) > 8) { anchoPrevio = w; requestAnimationFrame(dibujar); }
}).observe($("#contenido"));
alCambiarHash(aplicar);
aplicar();

