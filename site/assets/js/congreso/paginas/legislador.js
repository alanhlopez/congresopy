// Perfil de un legislador: resumen de votos, comisiones, votos por año, similitud de voto e historial.
// Estado en el #hash: camara, id, la pestaña (vista) y los filtros del historial (q, voto, tipo, anio).
import { buscarLegislador, comisionesDe } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, enlace, escribirEstado, leerEstado } from "../lib/estado.js";
import { EMITIDOS, fecha, normalizar, numero, ordenPartido, partidoClase, partidoNombre, porcentaje } from "../lib/formato.js";
import { anillo, avatar, chipPartido, chipResultado, chipVoto, enlaceLegislador, enlaceVotacion, listaPaginada, tipoCorto,
  tituloSilpy } from "../lib/componentes.js";

const DEFECTOS = { camara: "", id: "", vista: "votos", q: "", voto: "", tipo: "todas", anio: "" };
const VISTAS = [["votos", "¿Cómo votó?"], ["similitud", "¿Con quién vota?"], ["comisiones", "Comisiones"]];
const MIN_COMUN = 20;
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

function tarjetasResumen(d, l) {
  const c = l.conteo;
  const mociones = c.mocion_1 + c.mocion_2 + c.mocion_3;
  const items = [
    ["Afirmativos", c.si, "v-si"], ["Negativos", c.no, "v-no"], ["Abstenciones", c.abstencion, "v-abs"],
    ["Ausencias", c.ausente, "v-aus"],
  ];
  if (d.clave === "senado" || c.no_vota) items.push(["Presente, no vota", c.no_vota, "v-nv"]);
  if (mociones) items.push(["Votos entre mociones", mociones, "v-m1"]);
  return el("section", { class: "seccion", "aria-label": "Resumen de sus votos" },
    el("div", { class: "tarjetas-voto" }, items.map(([nombre, n, clase]) =>
      el("div", { class: ["tarjeta-voto", clase] },
        el("p", { class: "tarjeta-voto__nombre" }, nombre),
        el("p", { class: "tarjeta-voto__n" }, numero(n)),
        el("div", { class: "medidor", "aria-hidden": "true" }, el("span", { vars: { "--w": `${(100 * n) / l.votaciones}%` } })),
        el("p", { class: "tarjeta-voto__pct" }, porcentaje(n / l.votaciones))))));
}

function porAnio(d, cadena) {
  const anios = new Map();
  cadena.split("").forEach((ch, k) => {
    if (ch === "-") return;
    const a = d.votaciones[k].fecha.slice(0, 4);
    if (!anios.has(a)) anios.set(a, {});
    const g = ch === "1" || ch === "2" || ch === "3" ? "M" : ch;
    anios.get(a)[g] = (anios.get(a)[g] || 0) + 1;
  });
  const orden = [["S", "Sí", "v-si"], ["N", "No", "v-no"], ["A", "Abstención", "v-abs"], ["M", "Moción", "v-m1"],
    ["V", "No vota", "v-nv"], ["X", "Ausente", "v-aus"]];
  const usados = orden.filter(([k]) => [...anios.values()].some((x) => x[k]));
  return el("section", { class: "seccion panel", "aria-labelledby": "t-anio" },
    el("h2", { id: "t-anio" }, "Votos por año"),
    el("ul", { class: "leyenda" }, usados.map(([, nombre, clase]) =>
      el("li", {}, el("span", { class: ["punto", clase], "aria-hidden": "true" }), nombre))),
    el("div", { class: "barras-anio" }, [...anios].sort().map(([a, x]) => {
      const total = Object.values(x).reduce((s, n) => s + n, 0);
      return el("div", { class: "barra-anio" },
        el("span", { class: "barra-anio__etiqueta" }, a),
        el("div", { class: "barra-totales", role: "img",
          "aria-label": `${a}: ` + usados.filter(([k]) => x[k]).map(([k, nombre]) => `${nombre} ${x[k]}`).join(", ") },
        usados.filter(([k]) => x[k]).map(([k, nombre, clase]) =>
          el("span", { class: ["seg", clase], vars: { "--w": `${(100 * x[k]) / total}%` }, title: `${nombre}: ${x[k]}` }))),
        el("span", { class: "barra-anio__total" }, numero(total)));
    })));
}

function similitud(d, l, cadena) {
  const otros = [];
  for (const o of d.legisladores) {
    if (o.id === l.id) continue;
    const c2 = d.votos.legisladores[String(o.id)];
    let comun = 0;
    let igual = 0;
    for (let k = 0; k < cadena.length; k++) {
      const a = cadena[k];
      const b = c2[k];
      if (EMITIDOS.has(a) && EMITIDOS.has(b)) { comun += 1; if (a === b) igual += 1; }
    }
    if (comun >= MIN_COMUN) otros.push({ ...o, sim: igual / comun, comun });
  }
  const seccion = el("section", { class: "seccion panel", "aria-labelledby": "t-sim" },
    el("h2", { id: "t-sim" }, "Similitud de voto"),
    el("p", { class: "nota" }, `Porcentaje de votaciones en las que ${l.nombre_corto} votó igual que cada ${d.info.miembro} de la cámara, entre las que votaron los dos (mínimo ${MIN_COMUN} en común).`));
  if (!otros.length) return agregarA(seccion, el("p", { class: "vacio" }, "No hay suficientes votaciones en común para comparar."));

  const minimo = Math.min(50, Math.floor((Math.min(...otros.map((o) => o.sim)) * 100) / 10) * 10);
  const x = (s) => ((s * 100 - minimo) / (100 - minimo)) * 100;
  const grupos = new Map();
  for (const o of otros.sort((a, b) => a.sim - b.sim)) {
    if (!grupos.has(o.partido)) grupos.set(o.partido, []);
    grupos.get(o.partido).push(o);
  }
  const filas = [...grupos].sort((a, b) => (a[0] === l.partido ? -1 : b[0] === l.partido ? 1 : ordenPartido(b[0]) - ordenPartido(a[0])));
  const ticks = [];
  for (let t = minimo; t <= 100; t += minimo >= 70 ? 5 : 10) ticks.push(t);

  const grafico = el("div", { class: "similitud", role: "group", "aria-label": "Similitud de voto por partido" },
    el("div", { class: "similitud__eje", "aria-hidden": "true" }, el("span", { class: "similitud__vacio" }),
      el("div", { class: "similitud__ticks" }, ticks.map((t) => el("span", { vars: { "--x": `${x(t / 100)}%` } }, `${t}%`)))),
    filas.map(([partido, miembros]) => {
      // Carriles: dos puntos a menos de 2,2 % del ancho del eje van en carriles distintos, para no taparse.
      const carriles = [];
      const puntos = miembros.map((o) => {
        let c = carriles.findIndex((ult) => x(o.sim) - ult > 2.2);
        if (c === -1) { c = carriles.length; carriles.push(-Infinity); }
        carriles[c] = x(o.sim);
        return el("a", { href: enlaceLegislador(o, d.clave), class: ["punto-sim", partidoClase(o.partido), o.estado !== "activos" && "punto-sim--inactivo"],
          vars: { "--x": `${x(o.sim)}%`, "--carril": c },
          title: `${o.nombre}: ${porcentaje(o.sim)} de ${numero(o.comun)} votaciones en común` },
        el("span", { class: "sr" }, `${o.nombre}, ${porcentaje(o.sim)}`));
      });
      return el("div", { class: "similitud__fila", vars: { "--carriles": carriles.length } },
        el("div", { class: "similitud__partido" }, el("span", { class: ["punto", partidoClase(partido)], "aria-hidden": "true" }),
          el("span", {}, partido === l.partido ? `${partido} · su partido` : partido), el("span", { class: "nota" }, numero(miembros.length))),
        el("div", { class: "similitud__pista" }, puntos));
    }));

  const orden = [...otros].sort((a, b) => b.sim - a.sim);
  const listaCorta = (titulo, xs) => el("div", {}, el("h3", {}, titulo), el("ol", { class: "lista-sim" }, xs.map((o) =>
    el("li", {}, el("a", { href: enlaceLegislador(o, d.clave) }, o.nombre_corto), " ", chipPartido(o.partido), " ",
      el("strong", {}, porcentaje(o.sim))))));
  return agregarA(seccion, grafico,
    el("p", { class: "nota" }, "Los puntos huecos son legisladores que ya no están en el cargo. Tocá un punto para ver su perfil."),
    el("div", { class: "dos-columnas" }, listaCorta("Votan más parecido", orden.slice(0, 5)), listaCorta("Votan más distinto", orden.slice(-5).reverse())));
}

function agregarA(n, ...hijos) { n.append(...hijos); return n; }

function historial(d, l, cadena) {
  const filas = [];
  cadena.split("").forEach((ch, k) => { if (ch !== "-") filas.push({ v: d.votaciones[k], ch }); });
  for (const f of filas) f.busqueda = normalizar(`${f.v.titulo} ${f.v.acapite} ${f.v.mocion} ${f.v.expediente}`);
  const anios = [...new Set(filas.map((f) => f.v.fecha.slice(0, 4)))].sort().reverse();
  const opcionesVoto = [["", "Todos los votos"], ["S", "Sí"], ["N", "No"], ["A", "Abstención"], ["X", "Ausente"]];
  if (filas.some((f) => f.ch === "V")) opcionesVoto.push(["V", "Presente, no vota"]);
  if (filas.some((f) => "123".includes(f.ch))) opcionesVoto.push(["M", "Mociones"]);
  const sel = (id, opciones) => el("select", { id }, opciones.map(([v, t]) => el("option", { value: v }, t)));
  const campos = {
    q: el("input", { type: "search", id: "h-q", placeholder: "Tema, expediente o moción", autocomplete: "off" }),
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
      el("div", { class: "columnas-votaciones", "aria-hidden": "true" },
        el("span", {}, "Fecha"), el("span", {}, "Asunto"), el("span", {}, "Resultado"), el("span", {}, "Su voto")),
      lista));
}

function filtrarHistorial() {
  const h = actual?.historial;
  if (!h) return;
  const e = leerEstado(DEFECTOS);
  for (const [k, c] of Object.entries(h.campos)) if (c.value !== e[k]) c.value = e[k];
  const q = normalizar(e.q);
  const xs = h.filas.filter((f) => (!e.voto || (e.voto === "M" ? "123".includes(f.ch) : f.ch === e.voto))
    && (e.tipo === "todas" || (e.tipo === "leyes") === f.v.es_ley)
    && (!e.anio || f.v.fecha.startsWith(e.anio))
    && (!q || f.busqueda.includes(q)));
  h.conteo.textContent = `${numero(xs.length)} de ${numero(h.filas.length)} votaciones`;
  // Misma fila que en Votaciones, con su voto en la última columna en lugar de la barra de totales.
  listaPaginada(h.lista, xs, (f) => el("li", { class: "fila-votacion" },
    el("time", { class: "fila-votacion__fecha", datetime: f.v.fecha }, fecha(f.v.fecha)),
    el("div", { class: "fila-votacion__asunto" },
      el("a", { href: enlaceVotacion(f.v, actual.datos.clave), class: "fila-votacion__link" },
        f.v.es_ley ? "Proyecto de ley" : tipoCorto(f.v.tipo_proyecto),
        f.v.expediente && [el("span", { class: "sep", "aria-hidden": "true" }, "·"), el("span", { class: "fila-votacion__expediente" }, f.v.expediente)]),
      tituloSilpy(f.v.titulo)),
    el("div", { class: "fila-votacion__resultado" }, chipResultado(f.v.resultado)),
    el("div", { class: "fila-votacion__votos fila-votacion__su-voto" }, el("span", { class: "sr" }, "Su voto: "), chipVoto(f.ch))),
  { paso: 30, vacio: "Ninguna votación coincide con esos filtros." });
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

async function render() {
  const e = leerEstado(DEFECTOS);
  const id = Number(e.id);
  if (actual && actual.legislador.id === id) { mostrarVista(); filtrarHistorial(); return; }
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
    document.title = `${l.nombre} · Hesaka`;
    $("#volver").setAttribute("href", enlace("legisladores.html", { camara: d.clave }));
    const comisiones = await comisionesDe(l.id, d.clave);
    const paneles = {
      votos: [tarjetasResumen(d, l), porAnio(d, cadena), historial(d, l, cadena)],
      similitud: similitud(d, l, cadena),
      comisiones: seccionComisiones(d, l, comisiones),
    };
    vaciar(perfil, cabecera(d, l), historialBancadas(l), pestanas(paneles));
    mostrarVista();
    filtrarHistorial();
  } catch (err) {
    mostrarError(perfil, `No se pudieron cargar los datos: ${err.message}`);
  }
}

alCambiarHash(render);
render();
