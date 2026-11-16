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

/** Cifras de la cámara: un dato protagonista y dos de contexto. */
function resumen(d, activos, partidos) {
  const stat = (etiqueta, valor, nota) => el("div", { class: "stat" }, el("span", { class: "stat__etiqueta" }, etiqueta),
    el("span", { class: "stat__valor" }, valor), nota && el("span", { class: "stat__nota" }, nota));
  return el("div", { class: "resumen-camara" },
    stat(`${d.info.miembros[0].toUpperCase()}${d.info.miembros.slice(1)} en ejercicio`, numero(activos.length),
      activos.length < d.info.bancas ? `de ${d.info.bancas} bancas` : `${d.info.bancas} bancas`),
    stat("Partidos", numero(partidos.size)),
    stat("Bancadas", numero(new Set(activos.map((l) => l.bancada || "")).size)));
}

function vistaHemiciclo(d, activos) {
  const orden = ordenar(activos);
  const partidos = new Map();
  for (const l of orden) partidos.set(l.partido, (partidos.get(l.partido) || 0) + 1);
  return [
    resumen(d, activos, partidos),
    el("figure", { class: "figura-hemiciclo" },
      hemiciclo(orden, {
        claseDe: (l) => partidoClase(l.partido),
        enlaceDe: (l) => enlaceLegislador(l, d.clave),
        tituloDe: (l) => `${l.nombre} · ${partidoNombre(l.partido)}${l.departamento ? " · " + l.departamento : ""}`,
        etiqueta: `Hemiciclo de la ${d.info.nombreLargo}: ${activos.length} ${d.info.miembros} por partido`,
      }),
      el("figcaption", { class: "sr" }, `Oposición a la izquierda y el oficialismo (ANR) a la derecha.`)),
    // Leyenda en chips con el conteo, en el mismo orden que el hemiciclo (de izquierda a derecha)
    el("ul", { class: "leyenda-chips", "aria-label": "Bancas por partido" }, [...partidos].map(([p, n]) =>
      el("li", { class: ["chip", "chip-partido", partidoClase(p)], title: partidoNombre(p) },
        el("span", {}, p || "Sin partido"), el("strong", {}, numero(n)), el("span", { class: "sr" }, ` (${partidoNombre(p)})`)))),
    el("p", { class: "nota nota-centrada" }, "Oposición a la izquierda, oficialismo (ANR) a la derecha. Tocá un asiento para ver el perfil."),
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
  const partidos = new Map();
  for (const l of activos) partidos.set(l.partido, (partidos.get(l.partido) || 0) + 1);
  return [resumen(d, activos, partidos), el("div", { class: "bancadas" }, lista.map(([nombre, miembros]) =>
    el("section", { class: "bancada" },
      el("h3", { class: "bancada__titulo" }, chipPartido(miembros[0].partido), el("span", {}, nombre),
        el("span", { class: "bancada__n" }, numero(miembros.length))),
      el("ul", { class: "miembros" }, miembros.map((l) =>
        el("li", {}, el("a", { href: enlaceLegislador(l, d.clave), class: "miembro" }, avatar(l),
          el("span", {}, l.nombre_corto)))))))) ];
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
    document.title = `${d.info.nombreLargo} · Hesakã`;
    $("#nombre-camara").textContent = d.info.nombreLargo;
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
