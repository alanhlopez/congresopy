// Buscador de legisladores de las dos cámaras (combobox accesible) y resaltado del elegido en los gráficos.
// Lo usan Asistencia y Votómetro: la página decide qué hacer al elegir (alElegir) y al limpiar (alLimpiar).
import { CAMARAS, camara } from "./datos.js";
import { el } from "./dom.js";
import { apellidoNombre, normalizar } from "./formato.js";
import { avatar, chipPartido } from "./componentes.js";

/**
 * entrada: <input role="combobox">, lista: <ul role="listbox">.
 * alElegir({l, camara}) se llama con la persona elegida; alLimpiar() cuando se borra el campo.
 */
export function crearBuscador({ entrada, lista, alElegir, alLimpiar }) {
  let indice = [];
  Promise.all(Object.keys(CAMARAS).map(camara)).then((cams) => {
    indice = cams.flatMap((d) => d.legisladores.map((l) => ({ l, camara: d.clave,
      clave: normalizar(`${l.nombre} ${l.nombre_corto} ${apellidoNombre(l.nombre, l.nombre_corto)}`) })));
  }).catch(() => {});
  let opciones = [];
  let activa = -1;

  const cerrar = () => { lista.hidden = true; entrada.setAttribute("aria-expanded", "false"); entrada.removeAttribute("aria-activedescendant"); activa = -1; };
  const elegir = (o) => { cerrar(); entrada.value = o.l.nombre; alElegir(o); };
  const marcar = (k) => {
    activa = k;
    [...lista.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === k)));
    if (k >= 0) entrada.setAttribute("aria-activedescendant", lista.children[k].id);
  };

  entrada.addEventListener("input", () => {
    const q = normalizar(entrada.value.trim());
    if (q.length < 2) { cerrar(); return; }
    const palabras = q.split(/\s+/);
    opciones = indice.filter((o) => palabras.every((p) => o.clave.includes(p))).slice(0, 8);
    lista.replaceChildren(...(opciones.length ? opciones.map((o, i) => {
      const li = el("li", { id: `${lista.id}-opcion-${i}`, role: "option", "aria-selected": "false", class: "buscador__opcion" },
        avatar(o.l), el("span", {}, el("strong", {}, apellidoNombre(o.l.nombre, o.l.nombre_corto)), " ", chipPartido(o.l.partido),
          el("span", { class: "nota" }, ` · ${CAMARAS[o.camara].nombre}${o.l.estado !== "activos" ? " · ya no está en el cargo" : ""}`)));
      li.addEventListener("mousedown", (ev) => { ev.preventDefault(); elegir(o); });
      return li;
    }) : [el("li", { class: "buscador__vacio" }, "Ningún legislador coincide.")]));
    lista.hidden = false;
    entrada.setAttribute("aria-expanded", "true");
    marcar(-1);
  });
  entrada.addEventListener("keydown", (ev) => {
    if (lista.hidden || !opciones.length) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); marcar((activa + 1) % opciones.length); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); marcar((activa - 1 + opciones.length) % opciones.length); }
    else if (ev.key === "Enter") { ev.preventDefault(); elegir(opciones[Math.max(0, activa)]); }
    else if (ev.key === "Escape") { cerrar(); }
  });
  entrada.addEventListener("blur", () => setTimeout(cerrar, 100));
  // La «×» del campo (o borrar todo el texto) también quita la selección
  entrada.addEventListener("search", () => { if (!entrada.value) alLimpiar(); });
}

/**
 * Resalta al legislador `id` en el contenido: los elementos con data-persona (puntos y líneas de los gráficos)
 * se atenúan salvo el suyo, que en SVG pasa al frente; las filas con data-fila-persona solo se marcan.
 */
export function resaltar(id, raiz = document.querySelector("#contenido")) {
  for (const n of raiz.querySelectorAll("[data-persona]")) {
    const es = Boolean(id) && n.dataset.persona === String(id);
    n.classList.toggle("es-seleccionado", es);
    n.classList.toggle("es-atenuado", Boolean(id) && !es);
    if (es && n instanceof SVGElement) n.parentNode.append(n);
  }
  for (const n of raiz.querySelectorAll("[data-fila-persona]")) n.classList.toggle("es-seleccionado", Boolean(id) && n.dataset.filaPersona === String(id));
  raiz.classList.toggle("hay-seleccion", Boolean(id));
}
