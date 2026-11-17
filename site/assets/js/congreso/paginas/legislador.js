// Perfil de un legislador. Pestañas: «¿Cómo votó?» (con selector de período y subpestañas Lista | Análisis | Datos
// abiertos) y «Comisiones». Los números de Lista y Análisis salen de analisis.json (pipeline).
// Estado en el #hash: camara, id, vista, sub, periodo, gran, graf, sim, con y los filtros del historial (q, voto, tipo, anio).
import { analisisLegislador, buscarLegislador, comisionesDe, resumenLegislador } from "../lib/datos.js";
import { seccionDatosAbiertos, seccionLeyesClave, seccionPeriodo, seccionSimilitud, segmentado } from "./perfil-analisis.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, enlace, escribirEstado, leerEstado } from "../lib/estado.js";
import { fecha, normalizar, numero, partidoNombre, porcentaje } from "../lib/formato.js";
import { anillo, avatar, chipPartido, chipResultado, chipVoto, coincide, enlaceLegislador, enlaceVotacion, listaPaginada, textoBusqueda, tipoCorto, tituloSilpy } from "../lib/componentes.js";

const DEFECTOS = { camara: "", id: "", vista: "votos", sub: "lista", periodo: "mandato", gran: "mes", graf: "voto", sim: "legisladores", con: "",
  q: "", voto: "", tipo: "todas", anio: "" };
const VISTAS = [["votos", "¿Cómo votó?"], ["comisiones", "Comisiones"]];
const SUBS = [["lista", "Lista"], ["analisis", "Análisis"], ["datos", "Datos abiertos"]];
const perfil = $("#perfil");
let actual = null;   // { datos, legislador, cadena, filas }

function cabecera(d, l) {
  const pres = l.votaciones ? 1 - l.conteo.ausente / l.votaciones : 0;
  return el("header", { class: "perfil-cabecera panel" },
    avatar(l, true),
    el("div", { class: "perfil-cabecera__texto" },
      el("p", { class: "eyebrow" }, l.cargo || d.info.nombreLargo),
      el("h1", {}, l.nombre),
      el("p", { class: "perfil-cabecera__meta" },
        chipPartido(l.partido), el("span", {}, partidoNombre(l.partido)),
        l.departamento ? el("span", {}, `Departamento ${l.departamento}`) : el("span", {}, d.info.nombreLargo),
        l.estado !== "activos" ? el("span", { class: "chip" }, "Ya no está en el cargo") : null),
      el("p", { class: "nota" }, l.bancada || "Sin bancada declarada", l.cargo_bancada ? ` · ${l.cargo_bancada.toLowerCase()} de bancada` : ""),
      el("p", { class: "perfil-cabecera__acciones" },
        el("a", { class: "boton", href: `https://silpy.congreso.gov.py/web/legislador/${l.id}`, rel: "noopener" }, "Ficha en SILpy ", el("span", { "aria-hidden": "true" }, "↗")))),
    el("div", { class: "perfil-cabecera__presencia" }, anillo(pres, "Presencia en votaciones nominales"),
      el("div", {},
        el("p", { class: "stat__etiqueta" }, "Presencia"),
        el("p", { class: "stat__nota" }, `${numero(l.votaciones - l.conteo.ausente)} de ${numero(l.votaciones)} votaciones, del ${fecha(l.primera)} al ${fecha(l.ultima)}`),
        // Las dos cámaras registran distinto: la presencia no se compara entre Senado y Diputados.
        el("p", { class: "stat__nota" }, d.clave === "diputados"
          ? "En Diputados «no vota» figura como ausente."
          : "En el Senado, «presente, no vota» cuenta como presente."),
        el("p", { class: "perfil-cabecera__comparar" },
          el("a", { href: enlace("asistencia.html", { camara: d.clave, seleccionado: l.id }) }, "Ver cómo se compara ", el("span", { "aria-hidden": "true" }, "→"))))));
}

/** Cambios de partido, bancada, cargo o estado detectados entre fotos de la nómina de SILpy. */
function historialBancadas(l) {
  if (!l.historial || l.historial.length < 2) return null;
  const campos = [["partido", "Partido"], ["bancada", "Bancada"], ["cargo_bancada", "Cargo en la bancada"], ["estado", "Estado"]];
  const filas = [];
  for (let k = 1; k < l.historial.length; k++) {
    const a = l.historial[k - 1];
    const b = l.historial[k];
    for (const [c, nombre] of campos) {
      if ((a[c] || "") !== (b[c] || "")) {
        filas.push(el("li", {}, el("strong", {}, `${nombre}: `), `${a[c] || "—"} → ${b[c] || "—"}`,
          el("span", { class: "nota" }, ` (entre el ${fecha(a.visto_hasta)} y el ${fecha(b.visto_desde)})`)));
      }
    }
  }
  return el("section", { class: "seccion panel", "aria-labelledby": "t-bancada" },
    el("h2", { id: "t-bancada" }, "Cambios registrados en SILpy"),
    el("ul", { class: "lista-simple" }, filas),
    el("p", { class: "nota" }, "Se detectan comparando fotos periódicas de la nómina de SILpy: el cambio ocurrió en algún momento entre esas dos fechas."));
}

/** Comisiones según la ficha de SILpy: el período más reciente a la vista y los anteriores plegados. */
function seccionComisiones(d, l, filas) {
  if (!filas || !filas.length) return null;
  const enlaceCom = (f) => enlace("comisiones.html", { camara: d.clave, tipo: f.comision.tipo, periodo: f.periodo, c: f.comision.id });
  const item = (f) => el("li", {}, el("a", { href: enlaceCom(f) }, f.comision.nombre),
    f.cargo !== "Miembro" ? el("strong", {}, ` · ${f.cargo}`) : el("span", { class: "nota" }, " · miembro"));
  const grupo = (tipo) => {
    const xs = filas.filter((f) => f.comision.tipo === tipo);
    const porPeriodo = new Map();
    for (const f of xs) { if (!porPeriodo.has(f.periodo)) porPeriodo.set(f.periodo, []); porPeriodo.get(f.periodo).push(f); }
    return [...porPeriodo];   // filas ya viene ordenado: el período más reciente primero
  };
  const asesoras = grupo("asesora");
  const especiales = grupo("especial");
  const bloques = [];
  if (asesoras.length) {
    const [p0, xs0] = asesoras[0];
    bloques.push(el("h3", {}, `Comisiones asesoras ${p0}`), el("ul", { class: "lista-simple" }, xs0.map(item)));
    if (asesoras.length > 1) {
      bloques.push(el("details", { class: "comisiones-anteriores" },
        el("summary", {}, `Períodos anteriores (${asesoras.slice(1).map(([p]) => p).join(", ")})`),
        asesoras.slice(1).map(([p, xs]) => [el("h4", {}, p), el("ul", { class: "lista-simple" }, xs.map(item))])));
    }
  }
  for (const [p, xs] of especiales) {
    bloques.push(el("h3", {}, `Comisiones especiales y de amistad ${p}`), el("ul", { class: "lista-simple" }, xs.map(item)));
  }
  return el("section", { class: "seccion panel", "aria-labelledby": "t-comisiones" },
    el("h2", { id: "t-comisiones" }, "Comisiones"), bloques,
    el("p", { class: "nota" }, "Según la ficha del legislador en SILpy. No incluye fechas de alta o baja dentro de cada período."));
}

function tarjetasPeriodo(d, conteo) {
  const n = conteo.posibles;
  const items = [["Afirmativos", conteo.S, "v-si"], ["Negativos", conteo.N, "v-no"], ["Abstenciones", conteo.A, "v-abs"], ["Ausencias", conteo.X, "v-aus"]];
  if (d.clave === "senado" || conteo.V) items.push(["Presente, no vota", conteo.V, "v-nv"]);
  if (conteo.M) items.push(["Votos entre mociones", conteo.M, "v-m1"]);
  if (!n) return el("p", { class: "vacio" }, "No estuvo en el cargo en este período.");
  return el("section", { class: "seccion", "aria-label": "Resumen de sus votos en el período" },
    el("div", { class: "tarjetas-voto" }, items.map(([nombre, x, clase]) =>
      el("div", { class: ["tarjeta-voto", clase] },
        el("p", { class: "tarjeta-voto__nombre" }, nombre),
        el("p", { class: "tarjeta-voto__n" }, numero(x)),
        el("div", { class: "medidor", "aria-hidden": "true" }, el("span", { vars: { "--w": `${(100 * x) / n}%` } })),
        el("p", { class: "tarjeta-voto__pct" }, porcentaje(x / n))))));
}

function historial(d, l, cadena) {
  const filas = [];
  cadena.split("").forEach((ch, k) => { if (ch !== "-") filas.push({ v: d.votaciones[k], ch }); });
  for (const f of filas) f.busqueda = textoBusqueda(f.v);
  const anios = [...new Set(filas.map((f) => f.v.fecha.slice(0, 4)))].sort().reverse();
  const opcionesVoto = [["", "Todos los votos"], ["S", "Sí"], ["N", "No"], ["A", "Abstención"], ["X", "Ausente"]];
  if (filas.some((f) => f.ch === "V")) opcionesVoto.push(["V", "Presente, no vota"]);
  if (filas.some((f) => "123".includes(f.ch))) opcionesVoto.push(["M", "Mociones"]);
  const sel = (id, opciones) => el("select", { id }, opciones.map(([v, t]) => el("option", { value: v }, t)));
  const campos = {
    q: el("input", { type: "search", id: "h-q", placeholder: "Cualquier palabra del texto, expediente o resultado", autocomplete: "off" }),
    voto: sel("h-voto", opcionesVoto),
    tipo: sel("h-tipo", [["todas", "Todas las votaciones"], ["leyes", "Proyectos de ley"], ["otras", "Otras"]]),
    anio: sel("h-anio", [["", "Todos los años"], ...anios.map((a) => [a, a])]),
  };
  const conteo = el("p", { class: "tarjeta__descripcion", "aria-live": "polite" });
  const lista = el("div");
  actual.historial = { filas, campos, conteo, lista };
  for (const k of ["voto", "tipo", "anio"]) campos[k].addEventListener("change", guardarFiltros);
  campos.q.addEventListener("input", guardarFiltros);
  return el("section", { class: "tarjeta", "aria-labelledby": "t-hist" },
    el("div", { class: "tarjeta__cabecera" }, el("div", {}, el("h2", { id: "t-hist" }, "Historial de votaciones"), conteo)),
    el("div", { class: "tarjeta__filtros" },
      el("form", { class: "filtros", role: "search", on: { submit: (ev) => ev.preventDefault() } },
        el("label", { class: "filtro filtro-ancho" }, "Buscar", campos.q),
        el("label", { class: "filtro" }, "Voto", campos.voto),
        el("label", { class: "filtro" }, "Tipo", campos.tipo),
        el("label", { class: "filtro" }, "Año", campos.anio))),
    el("div", { class: "tarjeta__lista lista-votaciones" },
      el("div", { class: "columnas-votaciones columnas-votaciones--historial", "aria-hidden": "true" },
        el("span", {}, "Fecha"), el("span", {}, "Asunto"), el("span", {}, "Resultado"), el("span", {}, "Su voto"), el("span", {}, "Fuente")),
      lista));
}

function filtrarHistorial() {
  const h = actual?.historial;
  if (!h) return;
  const e = leerEstado(DEFECTOS);
  for (const [k, c] of Object.entries(h.campos)) if (c.value !== e[k]) c.value = e[k];
  const q = normalizar(e.q);
  const enPeriodo = filtroPeriodo(e.periodo);
  const xs = h.filas.filter((f) => enPeriodo(f.v) && (!e.voto || (e.voto === "M" ? "123".includes(f.ch) : f.ch === e.voto))
    && (e.tipo === "todas" || (e.tipo === "leyes") === f.v.es_ley)
    && (!e.anio || f.v.fecha.startsWith(e.anio))
    && (!q || coincide(f.busqueda, q)));
  const delPeriodo = h.filas.filter((f) => enPeriodo(f.v)).length;
  h.conteo.textContent = `${numero(xs.length)} de ${numero(delPeriodo)} votaciones del período`;
  // Misma fila que en Votaciones, con su voto en la última columna en lugar de la barra de totales.
  listaPaginada(h.lista, xs, (f) => el("li", { class: "fila-votacion fila-votacion--historial" },
    el("time", { class: "fila-votacion__fecha", datetime: f.v.fecha }, fecha(f.v.fecha)),
    el("div", { class: "fila-votacion__asunto" },
      el("a", { href: enlaceVotacion(f.v, actual.datos.clave), class: "fila-votacion__link" },
        f.v.es_ley ? "Proyecto de ley" : tipoCorto(f.v.tipo_proyecto),
        f.v.expediente && [el("span", { class: "sep", "aria-hidden": "true" }, "·"), el("span", { class: "fila-votacion__expediente" }, f.v.expediente)]),
      tituloSilpy(f.v.titulo)),
    el("div", { class: "fila-votacion__resultado" }, chipResultado(f.v.resultado)),
    el("div", { class: "fila-votacion__votos fila-votacion__su-voto" }, el("span", { class: "sr" }, "Su voto: "), chipVoto(f.ch)),
    el("a", { class: "fila-votacion__fuente", href: f.v.url, target: "_blank", rel: "noopener" }, "SILpy ", el("span", { "aria-hidden": "true" }, "↗"),
      el("span", { class: "sr" }, " (la votación en SILpy, se abre en otra pestaña)"))),
  { paso: 30, vacio: "Ninguna votación nominal coincide con esos filtros. La búsqueda cubre solo votaciones nominales: lo que se vota a mano alzada no queda registrado con el voto de cada legislador." });
}

function guardarFiltros() {
  const h = actual.historial;
  const e = leerEstado(DEFECTOS);
  for (const [k, c] of Object.entries(h.campos)) e[k] = c.value.trim();
  escribirEstado(e, DEFECTOS);
  filtrarHistorial();
}

/** Pestañas (patrón ARIA tabs): el panel visible sale de e.vista; flechas izquierda/derecha cambian de pestaña. */
function pestanas(paneles) {
  const disponibles = VISTAS.filter(([v]) => paneles[v]);
  const botones = disponibles.map(([v, texto]) => el("button", { type: "button", role: "tab", id: `pestana-${v}`,
    "aria-controls": `panel-${v}`, class: "pestana", dataset: { vista: v } }, texto));
  const lista = el("div", { class: "pestanas", role: "tablist", "aria-label": "Secciones del perfil" }, botones);
  for (const b of botones) {
    b.addEventListener("click", () => elegirVista(b.dataset.vista));
    b.addEventListener("keydown", (ev) => {
      const k = botones.indexOf(b);
      const sig = ev.key === "ArrowRight" ? botones[(k + 1) % botones.length] : ev.key === "ArrowLeft" ? botones[(k - 1 + botones.length) % botones.length] : null;
      if (sig) { ev.preventDefault(); sig.focus(); elegirVista(sig.dataset.vista); }
    });
  }
  const contenedores = disponibles.map(([v]) => el("div", { role: "tabpanel", id: `panel-${v}`, "aria-labelledby": `pestana-${v}`,
    class: "panel-pestana", tabindex: "-1" }, paneles[v]));
  actual.pestanas = { botones, contenedores, disponibles: disponibles.map(([v]) => v) };
  return [lista, contenedores];
}

function elegirVista(v) {
  const e = leerEstado(DEFECTOS);
  e.vista = v;
  escribirEstado(e, DEFECTOS);
  mostrarVista();
}

function mostrarVista() {
  const p = actual?.pestanas;
  if (!p) return;
  let v = leerEstado(DEFECTOS).vista;
  if (!p.disponibles.includes(v)) v = p.disponibles[0];
  for (const b of p.botones) {
    const activa = b.dataset.vista === v;
    b.setAttribute("aria-selected", String(activa));
    b.tabIndex = activa ? 0 : -1;
  }
  for (const c of p.contenedores) c.hidden = c.id !== `panel-${v}`;
}

// ---------- «¿Cómo votó?»: período, subpestañas y contenido ----------
function periodoValido(clave) {
  return actual.A.periodos.some((p) => p.clave === clave) ? clave : "mandato";
}

/** Filtro de votaciones del período elegido (12 meses por fecha; período legislativo por su id). */
function filtroPeriodo(clave) {
  const p = actual?.A.periodos.find((x) => x.clave === periodoValido(clave));
  if (!p || p.clave === "mandato") return () => true;
  if (p.clave === "12m") return (v) => v.fecha >= p.desde && v.fecha <= p.hasta;
  return (v) => String(v.periodo_id) === p.clave;
}

function cambiar(cambios) {
  escribirEstado({ ...leerEstado(DEFECTOS), ...cambios }, DEFECTOS);
  dibujarVotos();
  if ("periodo" in cambios) filtrarHistorial();
}

function selectorPeriodo(e) {
  const legislativos = actual.A.periodos.filter((p) => !["mandato", "12m"].includes(p.clave));
  const enLeg = legislativos.some((p) => p.clave === e.periodo);
  const select = el("select", { id: "f-periodo-leg", "aria-label": "Período legislativo" },
    legislativos.map((p) => el("option", { value: p.clave, selected: p.clave === e.periodo || null }, p.nombre.replace("Período ", ""))));
  select.addEventListener("change", () => cambiar({ periodo: select.value, gran: "mes", con: "" }));
  const p = actual.A.periodos.find((x) => x.clave === e.periodo);
  return el("div", { class: "selector-periodo" },
    segmentado("Período", [["mandato", "Todo el mandato"], ["12m", "Últimos 12 meses"], ["leg", "Período legislativo"]], enLeg ? "leg" : e.periodo,
      (v) => cambiar({ periodo: v === "leg" ? legislativos.at(-1).clave : v, gran: "mes", con: "" })),
    enLeg && el("label", { class: "filtro selector-periodo__leg" }, "Período legislativo", select),
    el("p", { class: "nota selector-periodo__rango", "aria-live": "polite" }, `Del ${fecha(p.desde)} al ${fecha(p.hasta)} · ${numero(p.votaciones)} votaciones nominales de la cámara`));
}

function subpestanas(e) {
  const botones = SUBS.map(([v, t]) => el("button", { type: "button", role: "tab", id: `sub-${v}`, "aria-controls": `subpanel-${v}`,
    class: "subpestana", "aria-selected": String(v === e.sub), tabindex: v === e.sub ? "0" : "-1" }, t));
  botones.forEach((b, k) => {
    b.addEventListener("click", () => cambiar({ sub: SUBS[k][0] }));
    b.addEventListener("keydown", (ev) => {
      const j = ev.key === "ArrowRight" ? (k + 1) % SUBS.length : ev.key === "ArrowLeft" ? (k - 1 + SUBS.length) % SUBS.length : -1;
      if (j >= 0) { ev.preventDefault(); cambiar({ sub: SUBS[j][0] }); document.getElementById(`sub-${SUBS[j][0]}`)?.focus(); }
    });
  });
  return el("div", { class: "subpestanas", role: "tablist", "aria-label": "Vistas de sus votos" }, botones);
}

/** Redibuja lo que depende del período y de las vistas (no el historial, que conserva el foco del buscador). */
function dibujarVotos() {
  const e = leerEstado(DEFECTOS);
  e.periodo = periodoValido(e.periodo);
  if (!SUBS.some(([v]) => v === e.sub)) e.sub = "lista";
  const c = actual.contenedores;
  c.selector.replaceChildren(selectorPeriodo(e));
  c.subs.replaceChildren(subpestanas(e));
  for (const [v] of SUBS) c[v].hidden = v !== e.sub;
  const pp = actual.A.por_periodo[e.periodo];
  c.tarjetas.replaceChildren(tarjetasPeriodo(actual.datos, pp.conteo));
  if (e.sub === "analisis") {
    const ancho = Math.max(280, Math.floor(c.analisis.getBoundingClientRect().width || perfil.getBoundingClientRect().width) - 48);
    const ctx = { A: actual.A, d: actual.datos, l: actual.legislador, periodo: e.periodo, pp, e, cambiar, ancho,
      idxPeriodo: actual.datos.votaciones.map((v, k) => (filtroPeriodo(e.periodo)(v) ? k : -1)).filter((k) => k >= 0) };
    c.analisis.replaceChildren(seccionPeriodo(ctx), seccionSimilitud(ctx), seccionLeyesClave(actual.A) || "");
    if (e.con) document.getElementById("detalle-con")?.scrollIntoView({ block: "nearest" });
  }
  if (e.sub === "datos" && !c.datos.childElementCount) {
    resumenLegislador(actual.datos.clave, actual.legislador.id).catch(() => null)
      .then((r) => c.datos.replaceChildren(...seccionDatosAbiertos(actual.datos, actual.legislador, r)));
  }
}

function panelVotos(d, l, cadena) {
  const c = {
    selector: el("div"), subs: el("div"), tarjetas: el("div"),
    lista: el("div", { role: "tabpanel", id: "subpanel-lista", "aria-labelledby": "sub-lista", class: "panel-pestana" }),
    analisis: el("div", { role: "tabpanel", id: "subpanel-analisis", "aria-labelledby": "sub-analisis", class: "panel-pestana" }),
    datos: el("div", { role: "tabpanel", id: "subpanel-datos", "aria-labelledby": "sub-datos", class: "panel-pestana" }),
  };
  c.lista.append(c.tarjetas, historial(d, l, cadena));
  actual.contenedores = c;
  return [c.selector, c.subs, c.lista, c.analisis, c.datos];
}

async function render() {
  const e = leerEstado(DEFECTOS);
  const id = Number(e.id);
  // Links viejos: vista=similitud ahora es la subpestaña Análisis de «¿Cómo votó?»
  if (e.vista === "similitud") { escribirEstado({ ...e, vista: "votos", sub: "analisis" }, DEFECTOS); }
  if (actual && actual.legislador.id === id) { mostrarVista(); dibujarVotos(); filtrarHistorial(); return; }
  if (!id) {
    vaciar(perfil, el("p", { class: "vacio" }, "Falta el legislador. Elegí uno en ", el("a", { href: "legisladores.html" }, "Legisladores"), "."));
    return;
  }
  try {
    const r = await buscarLegislador(id, e.camara);
    if (!r) {
      vaciar(perfil, el("p", { class: "vacio" }, `No hay un legislador con id ${id} en los datos. `, el("a", { href: "legisladores.html" }, "Ver el listado"), "."));
      return;
    }
    const { datos: d, legislador: l } = r;
    const cadena = d.votos.legisladores[String(l.id)];
    actual = { datos: d, legislador: l };
    document.title = `${l.nombre} · Hesakã`;
    $("#volver").setAttribute("href", enlace("legisladores.html", { camara: d.clave }));
    const [comisiones, A] = await Promise.all([comisionesDe(l.id, d.clave), analisisLegislador(d.clave, l.id)]);
    actual.A = A;
    const paneles = {
      votos: panelVotos(d, l, cadena),
      comisiones: seccionComisiones(d, l, comisiones),
    };
    vaciar(perfil, cabecera(d, l), historialBancadas(l), pestanas(paneles));
    mostrarVista();
    dibujarVotos();
    filtrarHistorial();
  } catch (err) {
    mostrarError(perfil, `No se pudieron cargar los datos: ${err.message}`);
  }
}

alCambiarHash(render);
render();
