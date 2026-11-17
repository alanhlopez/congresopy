// Votómetro: comportamiento de voto de toda la cámara. Los números salen de votometro.json (pipeline:
// votometro.py); acá solo se dibujan. Estado en el #hash: camara, periodo, partido (ranking de disciplina) y aparto
// (id del legislador cuyas votaciones «se apartó» están abiertas).
import { camara, camaraValida, votometro } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, escribirEstado, leerEstado } from "../lib/estado.js";
import { apellidoNombre, fecha, numero, ordenPartido, partidoClase, partidoNombre } from "../lib/formato.js";
import { avatar, chipPartido, chipResultado, chipVoto, enlaceLegislador, enlaceVotacion, listaPaginada, tipoCorto } from "../lib/componentes.js";
import { conectar } from "../lib/tooltip.js";
import { anchoDe, escala } from "../lib/graficos.js";
import { segmentado } from "./perfil-analisis.js";

const DEFECTOS = { camara: "senado", periodo: "mandato", partido: "", aparto: "" };
const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
let D = null;   // { cam, vm }

const persona = (id) => D.cam.porId.get(Number(id)) || { id: Number(id), nombre: `Legislador ${id}`, nombre_corto: "", partido: "" };
const nombreCorto = (l) => l.nombre_corto || l.nombre;

/** Tooltip de una persona con «Ver perfil» al fijarlo (click o Enter). */
function conectarPersona(nodo, l, lineas) {
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
  const elegido = partidos.includes(e.partido) ? e.partido : partidos[0];
  const sel = $("#f-partido");
  sel.replaceChildren(...partidos.map((p) => el("option", { value: p, selected: p === elegido || null }, `${partidoNombre(p).replace(/ \(.*\)$/, "")} (${p})`)));
  // De menos a más disciplinado (lo que más interesa arriba), de a 10
  const delPartido = filas.filter((f) => f.partido === elegido).sort((x, y) => y.puesto - x.puesto || x.id - y.id);
  listaPaginada($("#g-disciplina"), delPartido, (f) => {
    const l = persona(f.id);
    const abiertas = String(f.id) === e.aparto;
    const veces = f.comun - f.igual;
    const lista = el("div", { class: "aparto", hidden: !abiertas, id: `aparto-${f.id}` });
    if (abiertas) listaPaginada(lista, pp.disciplina.se_aparto[String(f.id)], filaApartamiento, { paso: 10, vacio: "Nunca se apartó." });
    return el("li", { class: "fila-disciplina" },
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

function decisivas(pp) {
  const dec = pp.decisivas;
  if (!dec.votaciones.length) { vaciar($("#g-decisivas"), el("p", { class: "vacio" }, "No hubo votaciones así en este período.")); vaciar($("#g-ganadores")); return; }
  listaPaginada($("#g-decisivas"), dec.votaciones, (f) => {
    const k = D.cam.posVotacion.get(f.id);
    const v = D.cam.votaciones[k];
    return el("li", { class: "fila-decisiva" },
      el("time", { class: "fila-decisiva__fecha", datetime: v.fecha }, fecha(v.fecha)),
      el("div", { class: "fila-decisiva__asunto" }, el("a", { class: "fila-decisiva__link", href: enlaceVotacion(v, D.cam.clave) }, v.es_ley ? "Proyecto de ley" : tipoCorto(v.tipo_proyecto),
        v.expediente ? el("span", { class: "nota" }, ` · ${v.expediente}`) : null),
        el("p", { class: "titulo-silpy clamp clamp-1" }, v.titulo),
        el("p", { class: "fila-decisiva__frase" }, frase(f))),
      el("span", { class: "fila-decisiva__resultado" }, chipResultado(v.resultado)));
  }, { paso: 8, vacio: "" });
  const max = dec.ranking[0]?.veces || 0;
  // los 10 primeros puestos, con todos los empatados en el último
  const corte = dec.ranking[Math.min(9, dec.ranking.length - 1)]?.veces ?? 0;
  vaciar($("#g-ganadores"), dec.ranking.filter((r) => r.veces >= corte).map((r) => {
    const l = persona(r.id);
    return el("li", { class: "fila-ganador" }, avatar(l),
      el("a", { href: enlaceLegislador(l, D.cam.clave) }, apellidoNombre(l.nombre, l.nombre_corto)), chipPartido(l.partido),
      el("span", { class: "medidor", "aria-hidden": "true" }, el("span", { class: partidoClase(l.partido), vars: { "--w": `${Math.round((100 * r.veces) / max)}%` } })),
      el("strong", {}, `${numero(r.veces)} de ${numero(dec.votaciones.length)}`));
  }));
}

// ---------- 3. Mapa político en el tiempo ----------
function trayectoria(tr, ancho) {
  if (tr.ventanas.length < 2) return el("p", { class: "vacio" }, "Todavía no hay ventanas suficientes para ver la evolución.");
  const ml = 44, mr = ancho < 560 ? 12 : 130, mt = 16, mb = 36;
  const alto = ancho < 560 ? 320 : 400;
  const x = escala(0, tr.ventanas.length - 1, ml, ancho - mr);
  const y = escala(-1, 1, alto - mb, mt);
  const destacados = new Set(tr.movimiento.slice(0, 5).map((m) => String(m.id)));
  const svg = el("svg:svg", { class: "trayectoria", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group",
    "aria-label": "Posición estimada de cada legislador en cada ventana de 12 meses" });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: v === 0 ? "eje__guia eje__guia--anio" : "eje__guia" }));
  }
  tr.ventanas.forEach((w, i) => {
    const [a, m] = w.desde.split("-");
    eje.append(el("svg:text", { x: x(i), y: alto - mb + 16, "text-anchor": "middle", class: "eje__texto" }, `${MESES[Number(m) - 1]} ${a.slice(2)}`),
      el("svg:text", { x: x(i), y: alto - mb + 29, "text-anchor": "middle", class: "eje__texto" }, `${pct(w.var1)}`));
  });
  eje.append(el("svg:text", { x: 12, y: (mt + alto - mb) / 2, "text-anchor": "middle", class: "eje__titulo", transform: `rotate(-90 12 ${(mt + alto - mb) / 2})` }, "posición estimada a partir de los votos"),
    el("svg:text", { x: ml + 4, y: mt + 2, class: "eje__texto" }, "↑ lado donde se ubica la mayoría del ANR"));
  svg.append(eje);
  const capaFondo = el("svg:g"), capaFrente = el("svg:g");
  const etiquetas = [];
  for (const [id, serie] of Object.entries(tr.posiciones)) {
    const l = persona(id);
    let d = "";
    serie.forEach((p, i) => { if (p !== null) d += `${d && serie[i - 1] !== null && serie[i - 1] !== undefined ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`; });
    if (!d) continue;
    const dest = destacados.has(id);
    const g = el("svg:g", { class: ["trayecto", partidoClase(l.partido), dest && "trayecto--destacado"] },
      el("svg:path", { d, class: "trayecto__linea" }),
      serie.map((p, i) => (p === null ? null : el("svg:circle", { cx: x(i).toFixed(1), cy: y(p).toFixed(1), r: dest ? 3.5 : 2, class: "trayecto__punto" }))));
    const mov = tr.movimiento.find((m) => String(m.id) === id);
    conectarPersona(g, l, [`Posición por ventana: ${serie.map((p) => (p === null ? "—" : p.toFixed(2).replace(".", ","))).join(" → ")}`,
      mov ? `Rango recorrido: ${mov.rango.toFixed(2).replace(".", ",")}` : "Aparece en una sola ventana"]);
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
  return [svg, el("p", { class: "nota" }, "Debajo de cada ventana, cuánto de las diferencias de voto resume la posición (varianza explicada). Se resaltan los 5 que más se movieron.")];
}

// ---------- 4 y 5. Dispersión genérica ----------
function dispersion(puntos, ancho, { ejeX, ejeY, valX, valY, dominioY, lineas, etiqueta }) {
  const ml = 46, mr = 14, mt = 12, mb = 42;
  const alto = Math.round(Math.min(Math.max(ancho * 0.66, 280), 440));
  const xs = puntos.map(valX), ys = puntos.map(valY);
  const pad = (a, b) => [a - (b - a) * 0.05, b + (b - a) * 0.05];
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = dominioY || pad(Math.min(...ys), Math.max(...ys));
  const x = escala(x0, x1, ml, ancho - mr);
  const y = escala(y0, y1, alto - mb, mt);
  const svg = el("svg:svg", { class: "dispersion", viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, role: "group", "aria-label": etiqueta });
  const eje = el("svg:g", { class: "eje", "aria-hidden": "true" });
  eje.append(el("svg:line", { x1: x(0), x2: x(0), y1: mt, y2: alto - mb, class: "eje__guia eje__guia--anio" }));
  if (!dominioY) eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(0), y2: y(0), class: "eje__guia eje__guia--anio" }));
  else for (let v = 0; v <= 1; v += 0.25) eje.append(el("svg:line", { x1: ml, x2: ancho - mr, y1: y(v), y2: y(v), class: "eje__guia" }), el("svg:text", { x: ml - 5, y: y(v) + 4, "text-anchor": "end", class: "eje__texto" }, `${v * 100}%`));
  eje.append(el("svg:text", { x: (ml + ancho - mr) / 2, y: alto - 8, "text-anchor": "middle", class: "eje__titulo" }, ejeX),
    el("svg:text", { x: ancho - mr, y: alto - mb + 14, "text-anchor": "end", class: "eje__texto" }, "lado donde se ubica la mayoría del ANR →"),
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
  disciplina(pp, e);
  cohesionBarras(pp);
  vaciar($("#g-cohesion-mensual"), cohesionMensual(pp, anchoDe($("#g-cohesion-mensual"))));
  decisivas(pp);
  vaciar($("#g-trayectoria"), trayectoria(D.vm.trayectoria, anchoDe($("#g-trayectoria"))));
  const mapa = pp.mapa;
  $("#nota-mapa").textContent = `La posición resume el ${pct(mapa.var1)} de las diferencias de voto en ${numero(mapa.divididas)} votaciones divididas del período. Aparecen quienes votaron en al menos ${numero(mapa.minimo_votos)} de ellas (${numero(mapa.puntos.length)} legisladores).`;
  $("#var-ejes").textContent = `el eje horizontal, el ${pct(mapa.var1)}; el vertical, el ${pct(mapa.var2)}`;
  const lineas = (p) => [`Posición: ${p.d1.toFixed(2).replace(".", ",")}`, `Votó en el ${pct(p.voto)} de las votaciones del período en el cargo`];
  vaciar($("#g-pos-pres"), dispersion(mapa.puntos, Math.min(anchoDe($("#g-pos-pres")), 820), {
    ejeX: "posición estimada a partir de los votos", ejeY: "votaciones en las que votó", valX: (p) => p.d1, valY: (p) => p.voto, dominioY: [0, 1], lineas,
    etiqueta: "Posición estimada (horizontal) y porcentaje de votaciones en las que votó (vertical)" }));
  vaciar($("#g-experimental"), dispersion(mapa.puntos, Math.min(anchoDe($("#g-experimental")), 820), {
    ejeX: `dimensión 1 (${pct(mapa.var1)})`, ejeY: `dimensión 2 (${pct(mapa.var2)})`, valX: (p) => p.d1, valY: (p) => p.d2,
    lineas: (p) => [`Dimensión 1: ${p.d1.toFixed(2).replace(".", ",")}`, `Dimensión 2: ${p.d2.toFixed(2).replace(".", ",")}`],
    etiqueta: "Mapa de dos dimensiones del escalamiento (experimental)" }));
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
  b.addEventListener("click", () => { escribirEstado({ ...leerEstado(DEFECTOS), camara: b.dataset.camara, partido: "", aparto: "" }, DEFECTOS); aplicar(); });
}
$("#f-partido").addEventListener("change", () => cambiar({ partido: $("#f-partido").value, aparto: "" }));
let anchoPrevio = 0;
new ResizeObserver(([x]) => {
  const w = Math.round(x.contentRect.width);
  if (D && Math.abs(w - anchoPrevio) > 8) { anchoPrevio = w; requestAnimationFrame(dibujar); }
}).observe($("#contenido"));
alCambiarHash(aplicar);
aplicar();

