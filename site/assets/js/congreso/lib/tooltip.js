// Tooltip propio (sin title=""): se muestra con hover o foco y se fija con click / Enter / Espacio.
// Fijado, agrega acciones (por ejemplo «Ver perfil») y se cierra con Escape, con su botón o con un click afuera.
// La posición se calcula con getBoundingClientRect y se aplica con CSSOM (style.setProperty), permitido por la CSP.
import { el } from "./dom.js";

let caja = null;
let cuerpo = null;
let anclaActual = null;
let fijado = null;            // { ancla, clave }
let alSoltar = null;          // callback cuando se suelta un tooltip fijado

function crear() {
  if (caja) return;
  cuerpo = el("div", { class: "tooltip__cuerpo" });
  const cerrar = el("button", { type: "button", class: "tooltip__cerrar", "aria-label": "Cerrar" }, "×");
  cerrar.addEventListener("click", () => soltar(true));
  caja = el("div", { class: "tooltip", id: "tooltip", role: "status", hidden: true }, cerrar, cuerpo);
  document.body.append(caja);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !caja.hidden) soltar(true); });
  document.addEventListener("click", (ev) => {
    if (!fijado || caja.contains(ev.target) || ev.target.closest?.("[data-tooltip]")) return;
    soltar(false);
  });
  window.addEventListener("resize", () => { if (anclaActual && !caja.hidden) ubicar(anclaActual); });
}

function ubicar(ancla) {
  const r = ancla.getBoundingClientRect();
  const w = caja.offsetWidth;
  const h = caja.offsetHeight;
  const margen = 8;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(margen, Math.min(x, document.documentElement.clientWidth - w - margen));
  const arriba = r.top - h - 10;
  const y = arriba >= margen ? arriba : r.bottom + 10;
  caja.style.setProperty("left", `${Math.round(x + window.scrollX)}px`);
  caja.style.setProperty("top", `${Math.round(y + window.scrollY)}px`);
}

function mostrar(ancla, contenido, fijo) {
  crear();
  if (fijado && !fijo && fijado.ancla !== ancla) return;   // uno fijado no se pisa con un hover
  cuerpo.replaceChildren(...[contenido].flat().filter(Boolean));
  caja.classList.toggle("tooltip--fijo", fijo);
  caja.hidden = false;
  anclaActual?.removeAttribute("aria-describedby");
  anclaActual = ancla;
  ancla.setAttribute("aria-describedby", "tooltip");
  ubicar(ancla);
}

function ocultar(ancla) {
  if (!caja || fijado || anclaActual !== ancla) return;
  caja.hidden = true;
  ancla.removeAttribute("aria-describedby");
  anclaActual = null;
}

/** Suelta el tooltip fijado. avisar=true llama al callback (por ejemplo, para limpiar el #hash). */
export function soltar(avisar = true) {
  if (!caja) return;
  const antes = fijado;
  fijado = null;
  caja.hidden = true;
  anclaActual?.removeAttribute("aria-describedby");
  anclaActual?.classList.remove("es-fijado");
  anclaActual = null;
  if (antes && avisar && alSoltar) alSoltar(antes.clave);
}

/** Fija el tooltip sobre un ancla (por ejemplo, al abrir la página con un legislador seleccionado). */
export function fijar(ancla, contenido, clave) {
  soltar(false);
  fijado = { ancla, clave };
  mostrar(ancla, contenido, true);
  ancla.classList.add("es-fijado");
}

export function alSoltarTooltip(fn) { alSoltar = fn; }

/**
 * Conecta un elemento (punto de un gráfico, celda) al tooltip.
 * contenido(fijo) devuelve los nodos; con fijo=true puede agregar acciones. alFijar(clave) se llama al fijarlo.
 */
export function conectar(ancla, { contenido, clave = null, alFijar = null, foco = true }) {
  ancla.dataset.tooltip = "";
  if (foco && !ancla.hasAttribute("tabindex")) ancla.setAttribute("tabindex", "0");
  ancla.addEventListener("mouseenter", () => mostrar(ancla, contenido(false), false));
  ancla.addEventListener("mouseleave", () => ocultar(ancla));
  ancla.addEventListener("focus", () => mostrar(ancla, contenido(false), false));
  ancla.addEventListener("blur", () => ocultar(ancla));
  const activar = (ev) => {
    ev.preventDefault();
    if (fijado && fijado.ancla === ancla) { soltar(true); return; }
    fijar(ancla, contenido(true), clave);
    if (alFijar) alFijar(clave);
  };
  ancla.addEventListener("click", activar);
  ancla.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") activar(ev); });
}
