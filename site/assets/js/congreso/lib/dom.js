// Construcción de DOM con nodos (nunca HTML como texto): todo el texto entra como textContent.

/**
 * el("a", {href: "x", class: "y", dataset: {id: 1}}, "texto", otroNodo)
 * Atributos especiales: class, dataset, vars (variables CSS vía setProperty), on (eventos).
 */
export function el(tag, attrs = {}, ...hijos) {
  const svg = tag.startsWith("svg:");
  const n = svg ? document.createElementNS("http://www.w3.org/2000/svg", tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.setAttribute("class", Array.isArray(v) ? v.filter(Boolean).join(" ") : v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k === "vars") for (const [p, x] of Object.entries(v)) n.style.setProperty(p, String(x));
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  agregar(n, hijos);
  return n;
}

export function agregar(n, hijos) {
  for (const h of hijos.flat(Infinity)) {
    if (h === null || h === undefined || h === false) continue;
    n.append(h instanceof Node ? h : document.createTextNode(String(h)));
  }
  return n;
}

export function vaciar(n, ...hijos) {
  n.replaceChildren();
  return agregar(n, hijos);
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

/** Mensaje de error visible en la página (sin alert). */
export function mostrarError(contenedor, mensaje) {
  vaciar(contenedor, el("p", { class: "error", role: "alert" }, mensaje));
}
