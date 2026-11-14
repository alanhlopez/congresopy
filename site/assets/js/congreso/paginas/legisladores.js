// Legisladores: listado de las dos cámaras con búsqueda y filtros (estado en el #hash).
import { CAMARAS, camara } from "../lib/datos.js";
import { el, mostrarError, $ } from "../lib/dom.js";
import { alCambiarHash, escribirEstado, leerEstado } from "../lib/estado.js";
import { normalizar, numero, partidoNombre, porcentaje } from "../lib/formato.js";
import { avatar, chipPartido, enlaceLegislador, listaPaginada } from "../lib/componentes.js";

const DEFECTOS = { q: "", camara: "todas", partido: "", departamento: "", estado: "activos", orden: "nombre" };
const campos = { q: $("#f-q"), camara: $("#f-camara"), partido: $("#f-partido"), departamento: $("#f-departamento"), estado: $("#f-estado"), orden: $("#f-orden") };
let todos = [];

const presencia = (l) => (l.votaciones ? 1 - l.conteo.ausente / l.votaciones : null);

function tarjeta(l) {
  const info = CAMARAS[l.camara];
  return el("li", {},
    el("a", { class: "tarjeta-legislador", href: enlaceLegislador(l, l.camara) },
      avatar(l),
      el("span", { class: "tarjeta-legislador__cuerpo" },
        el("span", { class: "tarjeta-legislador__nombre" }, l.nombre),
        el("span", { class: "tarjeta-legislador__meta" }, chipPartido(l.partido),
          el("span", {}, l.departamento ? `${info.nombre} · ${l.departamento}` : info.nombre), l.estado !== "activos" && el("span", { class: "chip" }, "Ya no está en el cargo")),
        el("span", { class: "tarjeta-legislador__bancada" }, l.bancada || "Sin bancada declarada")),
      el("span", { class: "tarjeta-legislador__dato" },
        el("strong", {}, porcentaje(presencia(l))),
        el("span", {}, `presencia en ${numero(l.votaciones)} votaciones`))));
}

function aplicar() {
  const e = leerEstado(DEFECTOS);
  for (const [k, c] of Object.entries(campos)) if (c.value !== e[k]) c.value = e[k];
  const q = normalizar(e.q);
  let lista = todos.filter((l) => (e.camara === "todas" || l.camara === e.camara)
    && (!e.partido || l.partido === e.partido)
    && (!e.departamento || l.departamento === e.departamento)
    && (e.estado === "todos" || l.estado === "activos")
    && (!q || l._busqueda.includes(q)));
  if (e.orden === "presencia") lista.sort((a, b) => presencia(a) - presencia(b));
  else if (e.orden === "presencia-desc") lista.sort((a, b) => presencia(b) - presencia(a));
  $("#conteo").textContent = `${numero(lista.length)} de ${numero(todos.length)} legisladores`;
  listaPaginada($("#lista"), lista, tarjeta, { paso: 48, vacio: "Ningún legislador coincide con esos filtros." });
  $("#lista").firstElementChild?.classList.add("grilla-legisladores");
}

function guardar() {
  const e = Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, c.value.trim()]));
  escribirEstado(e, DEFECTOS);
  aplicar();
}

async function iniciar() {
  try {
    const cams = await Promise.all(Object.keys(CAMARAS).map(camara));
    todos = cams.flatMap((d) => d.legisladores.map((l) => ({
      ...l, camara: d.clave, _busqueda: normalizar(`${l.nombre} ${l.nombre_corto} ${l.bancada} ${l.partido} ${partidoNombre(l.partido)} ${l.departamento || ""}`),
    })));
    const partidos = [...new Set(todos.map((l) => l.partido))].sort((a, b) => partidoNombre(a).localeCompare(partidoNombre(b), "es"));
    for (const p of partidos) campos.partido.append(el("option", { value: p }, `${partidoNombre(p)} (${p})`));
    // Departamentos: solo Diputados (el Senado se elige en circunscripción nacional).
    const deptos = [...new Set(todos.map((l) => l.departamento).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    for (const dp of deptos) campos.departamento.append(el("option", { value: dp }, dp));
    aplicar();
  } catch (err) {
    mostrarError($("#lista"), `No se pudieron cargar los datos: ${err.message}`);
  }
}

$("#filtros").addEventListener("submit", (ev) => ev.preventDefault());
campos.q.addEventListener("input", guardar);
for (const k of ["camara", "partido", "departamento", "estado", "orden"]) campos[k].addEventListener("change", guardar);
alCambiarHash(aplicar);
iniciar();
