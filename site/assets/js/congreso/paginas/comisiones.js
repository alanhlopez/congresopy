// Comisiones: integrantes de cada comisión por cámara, tipo y período (estado en el #hash).
// Cada comisión es un <details>: el hash recuerda cuál está abierta (c=id).
import { CAMARAS, camaraValida, comisiones } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, escribirEstado, leerEstado } from "../lib/estado.js";
import { fecha, normalizar, numero, ordenPartido, partidoClase, partidoNombre } from "../lib/formato.js";
import { chipPartido, enlaceLegislador } from "../lib/componentes.js";

const DEFECTOS = { camara: "senado", tipo: "asesora", periodo: "", q: "", c: "" };
const campos = { q: $("#f-q"), tipo: $("#f-tipo"), periodo: $("#f-periodo") };
const DIRECTIVOS = new Set(["Presidente/a", "Vicepresidente/a"]);

function marcarCamara(c) {
  for (const b of document.querySelectorAll("#selector-camara button")) b.setAttribute("aria-pressed", String(b.dataset.camara === c));
}

/** Períodos que tienen integrantes de comisiones de ese tipo, el más reciente primero. */
function periodosDe(d, tipo) {
  const ps = new Set();
  for (const c of d.comisiones) if (c.tipo === tipo) for (const [, p] of c.integrantes) ps.add(p);
  return [...ps].sort().reverse();
}

function nombreDe(d, id) {
  return d.legisladores[String(id)]?.nombre || `Legislador ${id}`;
}

function personaEnlace(d, id, camara) {
  const info = d.legisladores[String(id)] || {};
  const nombre = nombreDe(d, id);
  return info.con_votos ? el("a", { href: enlaceLegislador({ id }, camara) }, nombre) : nombre;
}

/** Barra con la cantidad de integrantes por partido (cada persona cuenta una vez). */
function barraPartidos(d, ids) {
  const cuenta = new Map();
  for (const id of ids) {
    const p = d.legisladores[String(id)]?.partido || "";
    cuenta.set(p, (cuenta.get(p) || 0) + 1);
  }
  const partes = [...cuenta].sort((a, b) => ordenPartido(a[0]) - ordenPartido(b[0]));
  const total = ids.length;
  const texto = partes.map(([p, n]) => `${p || "sin partido"}: ${n}`).join(", ");
  return el("div", { class: "barra-totales", role: "img", "aria-label": `Integrantes por partido: ${texto}` },
    partes.map(([p, n]) => el("span", { class: ["seg", partidoClase(p)], vars: { "--w": `${(100 * n) / total}%` },
      title: `${partidoNombre(p) || "Sin partido"}: ${n}` })));
}

function tarjeta(d, c, filas, camara, abierta) {
  const ids = [...new Set(filas.map(([id]) => id))];
  const directivos = filas.filter(([, , cargo]) => DIRECTIVOS.has(cargo));
  // SILpy publica algunos nombres en MAYÚSCULAS (comisiones de amistad): no se convierten, se muestran más chicos.
  const mayus = c.nombre === c.nombre.toUpperCase();
  const det = el("details", { class: "comision", id: `comision-${c.id}`, open: abierta },
    el("summary", { class: "comision__resumen" },
      el("span", { class: "comision__texto" },
        el("span", { class: ["comision__nombre", mayus && "comision__nombre--mayus"] }, c.nombre),
        el("span", { class: "comision__meta" },
          `${numero(ids.length)} integrante${ids.length === 1 ? "" : "s"}`,
          directivos.length ? ` · ${directivos.map(([id, , cargo]) => `${cargo.replace("/a", "")}: ${nombreDe(d, id)}`).join(" · ")}` : "")),
      el("span", { class: "comision__barra" }, barraPartidos(d, ids))),
    el("div", { class: "tabla-scroll" },
      el("table", { class: "tabla" },
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Cargo"), el("th", { scope: "col" }, "Integrante"), el("th", { scope: "col" }, "Partido"))),
        el("tbody", {}, filas.map(([id, , cargo]) => {
          const info = d.legisladores[String(id)] || {};
          return el("tr", {},
            el("td", {}, cargo),
            el("th", { scope: "row" }, personaEnlace(d, id, camara), info.estado && info.estado !== "activos" ? el("span", { class: "nota" }, " (ya no está en el cargo)") : null),
            el("td", {}, chipPartido(info.partido)));
        })))),
    el("p", { class: "nota" }, el("a", { href: c.url, rel: "noopener" }, "Comisión en SILpy ", el("span", { "aria-hidden": "true" }, "↗"))));
  det.addEventListener("toggle", () => {
    const e = leerEstado(DEFECTOS);
    if (det.open) e.c = String(c.id);
    else if (e.c === String(c.id)) e.c = "";
    escribirEstado(e, DEFECTOS);
  });
  return det;
}

let periodosCargados = "";
let primeraVez = true;   // al abrir un link con c=id, bajar hasta esa comisión una sola vez

async function aplicar() {
  const e = leerEstado(DEFECTOS);
  e.camara = camaraValida(e.camara);
  if (!["asesora", "especial"].includes(e.tipo)) e.tipo = DEFECTOS.tipo;
  marcarCamara(e.camara);
  try {
    const d = await comisiones(e.camara);
    if (!d) {
      vaciar($("#lista"), el("p", { class: "vacio" }, `Todavía no hay datos de comisiones de la ${CAMARAS[e.camara].nombreLargo}.`));
      $("#conteo").textContent = "";
      return;
    }
    const periodos = periodosDe(d, e.tipo);
    const clave = `${e.camara}|${e.tipo}`;
    if (periodosCargados !== clave) {
      campos.periodo.replaceChildren(...periodos.map((p) => el("option", { value: p }, p)));
      periodosCargados = clave;
    }
    if (!periodos.includes(e.periodo)) e.periodo = periodos[0] || "";
    for (const [k, c] of Object.entries(campos)) if (c.value !== e[k]) c.value = e[k];

    const q = normalizar(e.q);
    const xs = [];
    for (const c of d.comisiones) {
      if (c.tipo !== e.tipo) continue;
      const filas = c.integrantes.filter(([, p]) => p === e.periodo);
      if (!filas.length) continue;
      if (q && !normalizar(`${c.nombre} ${filas.map(([id]) => nombreDe(d, id)).join(" ")}`).includes(q)) continue;
      xs.push([c, filas]);
    }
    const total = d.comisiones.filter((c) => c.tipo === e.tipo && c.integrantes.some(([, p]) => p === e.periodo)).length;
    $("#nombre-camara").textContent = CAMARAS[e.camara].nombreLargo;
    $("#conteo").textContent = `${xs.length === total ? numero(total) : `${numero(xs.length)} de ${numero(total)}`} comisiones ${e.tipo === "asesora" ? "asesoras" : "especiales y de amistad"}, período ${e.periodo}`;
    vaciar($("#lista"), xs.length
      ? el("div", { class: "comisiones" }, xs.map(([c, filas]) => tarjeta(d, c, filas, e.camara, e.c === String(c.id))))
      : el("p", { class: "vacio" }, "Ninguna comisión coincide con la búsqueda."));
    if (primeraVez && e.c) document.getElementById(`comision-${e.c}`)?.scrollIntoView({ block: "start" });
    primeraVez = false;
    const span = document.querySelector("[data-comisiones-fecha]");
    if (span && d.fichas) span.textContent = d.fichas.desde === d.fichas.hasta ? fecha(d.fichas.hasta) : `del ${fecha(d.fichas.desde)} al ${fecha(d.fichas.hasta)}`;
  } catch (err) {
    mostrarError($("#lista"), `No se pudieron cargar los datos: ${err.message}`);
  }
}

function guardar(cambios = {}) {
  const e = { ...leerEstado(DEFECTOS), ...Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, c.value.trim()])), ...cambios };
  escribirEstado(e, DEFECTOS);
  aplicar();
}

$("#filtros").addEventListener("submit", (ev) => ev.preventDefault());
campos.q.addEventListener("input", () => guardar());
campos.tipo.addEventListener("change", () => guardar({ periodo: "", c: "" }));
campos.periodo.addEventListener("change", () => guardar({ c: "" }));
for (const b of document.querySelectorAll("#selector-camara button")) {
  b.addEventListener("click", () => guardar({ camara: b.dataset.camara, periodo: "", c: "" }));
}
alCambiarHash(aplicar);
aplicar();
