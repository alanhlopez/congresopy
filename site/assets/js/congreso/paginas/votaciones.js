// Votaciones: listado por cámara con búsqueda y filtros (estado en el #hash).
import { camara, camaraValida } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, escribirEstado, leerEstado } from "../lib/estado.js";
import { normalizar, numero } from "../lib/formato.js";
import { coincide, filaVotacion, leyendaVotos, listaPaginada, textoBusqueda } from "../lib/componentes.js";

const DEFECTOS = { camara: "senado", q: "", tipo: "todas", anio: "", res: "" };
const campos = { q: $("#f-q"), tipo: $("#f-tipo"), anio: $("#f-anio"), res: $("#f-res") };
const busqueda = new WeakMap();
let anioCamara = "";

/** Proporción de votos en contra sobre los emitidos (sí/no/abstención): mide qué tan dividida fue. */
function enContra(v) {
  const t = v.totales;
  if (v.tipo_votacion === "mociones") {
    const m = [t.mocion_1 || 0, t.mocion_2 || 0, t.mocion_3 || 0];
    const tot = m.reduce((a, b) => a + b, 0);
    return tot ? (tot - Math.max(...m)) / tot : 0;
  }
  const emit = (t.si || 0) + (t.no || 0) + (t.abstencion || 0);
  return emit ? Math.min(t.si || 0, t.no || 0) / emit : 0;
}

function marcarCamara(c) {
  for (const b of document.querySelectorAll("#selector-camara button")) b.setAttribute("aria-pressed", String(b.dataset.camara === c));
}

async function aplicar() {
  const e = leerEstado(DEFECTOS);
  e.camara = camaraValida(e.camara);
  marcarCamara(e.camara);
  try {
    const d = await camara(e.camara);
    if (anioCamara !== d.clave) {
      const anios = [...new Set(d.votaciones.map((v) => v.fecha.slice(0, 4)))].sort().reverse();
      campos.anio.replaceChildren(el("option", { value: "" }, "Todos"), ...anios.map((a) => el("option", { value: a }, a)));
      anioCamara = d.clave;
      vaciar($("#leyenda"), leyendaVotos(d.votaciones));
      $("#nombre-camara").textContent = d.info.nombreLargo;
    }
    for (const [k, c] of Object.entries(campos)) if (c.value !== e[k]) c.value = e[k];
    const q = normalizar(e.q);
    const xs = d.votaciones.filter((v) => {
      if (e.tipo !== "todas" && (e.tipo === "leyes") !== v.es_ley) return false;
      if (e.anio && !v.fecha.startsWith(e.anio)) return false;
      if (e.res === "divididas" && enContra(v) < 0.1) return false;
      if (e.res === "unanimes" && enContra(v) > 0) return false;
      if (q) {
        if (!busqueda.has(v)) busqueda.set(v, textoBusqueda(v));
        if (!coincide(busqueda.get(v), q)) return false;
      }
      return true;
    });
    $("#conteo").textContent = xs.length === d.votaciones.length
      ? `${numero(xs.length)} votaciones nominales`
      : `${numero(xs.length)} de ${numero(d.votaciones.length)} votaciones nominales`;
    listaPaginada($("#lista"), xs, (v) => filaVotacion(v, d.clave), { paso: 40, vacio: "Ninguna votación nominal coincide con esos filtros. La búsqueda cubre solo votaciones nominales: lo que se vota a mano alzada no queda registrado con el voto de cada legislador." });
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
for (const k of ["tipo", "anio", "res"]) campos[k].addEventListener("change", () => guardar());
for (const b of document.querySelectorAll("#selector-camara button")) {
  b.addEventListener("click", () => guardar({ camara: b.dataset.camara, anio: "" }));
}
alCambiarHash(aplicar);
aplicar();
