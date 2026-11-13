// Cámaras: composición actual (hemiciclo por partido o agrupado por bancada).
import { camara, camaraValida } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, escribirEstado, leerEstado } from "../lib/estado.js";
import { numero, ordenPartido, partidoClase, partidoNombre } from "../lib/formato.js";
import { hemiciclo } from "../lib/hemiciclo.js";
import { avatar, chipPartido, enlaceLegislador } from "../lib/componentes.js";

const DEFECTOS = { camara: "senado", vista: "hemiciclo" };
const contenedor = $("#composicion");

function marcar(grupo, attr, valor) {
  for (const b of document.querySelectorAll(`${grupo} button`)) b.setAttribute("aria-pressed", String(b.dataset[attr] === valor));
}

function ordenar(activos) {
  return [...activos].sort((a, b) => ordenPartido(a.partido) - ordenPartido(b.partido)
    || (a.bancada || "").localeCompare(b.bancada || "", "es") || a.nombre.localeCompare(b.nombre, "es"));
}

function vistaHemiciclo(d, activos) {
  const orden = ordenar(activos);
  const partidos = new Map();
  for (const l of orden) partidos.set(l.partido, (partidos.get(l.partido) || 0) + 1);
  return [
    el("figure", { class: "figura-hemiciclo" },
      hemiciclo(orden, {
        claseDe: (l) => partidoClase(l.partido),
        enlaceDe: (l) => enlaceLegislador(l, d.clave),
        tituloDe: (l) => `${l.nombre} · ${l.partido}${l.bancada ? " · " + l.bancada : ""}`,
        etiqueta: `Hemiciclo de la ${d.info.nombreLargo}: ${activos.length} ${d.info.miembros} por partido`,
      }),
      el("figcaption", {}, `${numero(activos.length)} ${d.info.miembros} en ejercicio · ${partidos.size} partidos · ${new Set(activos.map((l) => l.bancada)).size} bancadas`)),
    el("ul", { class: "leyenda leyenda-partidos" }, [...partidos].sort((a, b) => b[1] - a[1]).map(([p, n]) =>
      el("li", {}, el("span", { class: ["punto", partidoClase(p)], "aria-hidden": "true" }),
        el("span", {}, `${partidoNombre(p)} `), el("strong", {}, numero(n))))),
  ];
}

function vistaBancadas(d, activos) {
  const grupos = new Map();
  for (const l of ordenar(activos)) {
    const k = l.bancada || "Sin bancada declarada";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  }
  const lista = [...grupos].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "es"));
  return el("div", { class: "bancadas" }, lista.map(([nombre, miembros]) =>
    el("section", { class: "bancada" },
      el("h3", { class: "bancada__titulo" }, chipPartido(miembros[0].partido), el("span", {}, nombre),
        el("span", { class: "bancada__n" }, numero(miembros.length))),
      el("ul", { class: "miembros" }, miembros.map((l) =>
        el("li", {}, el("a", { href: enlaceLegislador(l, d.clave), class: "miembro" }, avatar(l),
          el("span", {}, l.nombre_corto))))))));
}

async function render() {
  const e = leerEstado(DEFECTOS);
  e.camara = camaraValida(e.camara);
  if (!["hemiciclo", "bancadas"].includes(e.vista)) e.vista = DEFECTOS.vista;
  marcar("#selector-camara", "camara", e.camara);
  marcar("#selector-vista", "vista", e.vista);
  try {
    const d = await camara(e.camara);
    const activos = d.legisladores.filter((l) => l.estado === "activos");
    document.title = `${d.info.nombreLargo} · Monitoreo Congreso del Paraguay`;
    vaciar(contenedor, e.vista === "hemiciclo" ? vistaHemiciclo(d, activos) : vistaBancadas(d, activos));
  } catch (err) {
    mostrarError(contenedor, `No se pudieron cargar los datos: ${err.message}`);
  }
}

function cambiar(cambios) {
  escribirEstado({ ...leerEstado(DEFECTOS), ...cambios }, DEFECTOS);
  render();
}

for (const b of document.querySelectorAll("#selector-camara button")) b.addEventListener("click", () => cambiar({ camara: b.dataset.camara }));
for (const b of document.querySelectorAll("#selector-vista button")) b.addEventListener("click", () => cambiar({ vista: b.dataset.vista }));
alCambiarHash(render);
render();
