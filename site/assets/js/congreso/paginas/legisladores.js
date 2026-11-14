// Legisladores: listado de las dos cámaras con búsqueda y filtros (estado en el #hash).
import { CAMARAS, camara } from "../lib/datos.js";
import { el, mostrarError, $ } from "../lib/dom.js";
import { alCambiarHash, escribirEstado, leerEstado } from "../lib/estado.js";
import { apellidoNombre, normalizar, numero, partidoNombre, porcentaje } from "../lib/formato.js";
import { avatar, chipPartido, enlaceLegislador, listaPaginada } from "../lib/componentes.js";

const DEFECTOS = { q: "", camara: "todas", partido: "", departamento: "", estado: "activos", orden: "nombre" };
const campos = { q: $("#f-q"), camara: $("#f-camara"), partido: $("#f-partido"), departamento: $("#f-departamento"), estado: $("#f-estado"), orden: $("#f-orden") };
let todos = [];

const presencia = (l) => (l.votaciones ? 1 - l.conteo.ausente / l.votaciones : null);

/** Fila de la lista: foto con aro del partido, «Apellido, Nombre», bancada chica, cámara/departamento,
    sigla del partido y presencia como mini barra con su porcentaje. Toda la fila es el link al perfil. */
function fila(l) {
  const info = CAMARAS[l.camara];
  const p = presencia(l);
  return el("li", { class: "fila-legislador" },
    el("a", { class: "fila-legislador__link", href: enlaceLegislador(l, l.camara) },
      avatar(l),
      el("span", { class: "fila-legislador__persona" },
        el("span", { class: "fila-legislador__nombre" }, apellidoNombre(l.nombre, l.nombre_corto)),
        el("span", { class: "fila-legislador__bancada", title: l.bancada || null },
          l.bancada || "Sin bancada declarada",
          l.estado !== "activos" ? " · ya no está en el cargo" : "")),
      el("span", { class: "fila-legislador__camara" }, info.nombre, l.departamento ? el("span", {}, l.departamento) : null),
      el("span", { class: "fila-legislador__partido" }, chipPartido(l.partido)),
      el("span", { class: "fila-legislador__presencia", title: `Presente en ${numero(l.votaciones - l.conteo.ausente)} de ${numero(l.votaciones)} votaciones nominales` },
        el("span", { class: "medidor", "aria-hidden": "true" }, el("span", { vars: { "--w": `${Math.round((p || 0) * 100)}%` } })),
        el("strong", {}, porcentaje(p)),
        el("span", { class: "sr" }, ` de presencia en ${numero(l.votaciones)} votaciones`))));
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
  $("#conteo").textContent = lista.length === todos.length
    ? `${numero(lista.length)} legisladores` : `${numero(lista.length)} de ${numero(todos.length)} legisladores`;
  listaPaginada($("#lista"), lista, fila, { paso: 50, vacio: "Ningún legislador coincide con esos filtros." });
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
