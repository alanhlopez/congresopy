// Estado de la página en el #hash (formato clave=valor&...), para que todo se comparta con un link.

export function leerEstado(defectos = {}) {
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  const e = { ...defectos };
  for (const [k, v] of p) e[k] = v;
  return e;
}

/** Escribe el estado sin agregar una entrada al historial. Omite los valores iguales al defecto. */
export function escribirEstado(estado, defectos = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(estado)) {
    if (v === undefined || v === null || v === "" || v === defectos[k]) continue;
    p.set(k, v);
  }
  const hash = p.toString();
  const url = location.pathname + location.search + (hash ? "#" + hash : "");
  history.replaceState(null, "", url);
}

/** Link a otra página con su estado en el hash. Rutas relativas. */
export function enlace(pagina, estado = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(estado)) if (v !== undefined && v !== null && v !== "") p.set(k, v);
  const h = p.toString();
  return pagina + (h ? "#" + h : "");
}

/** Llama a fn cuando el usuario cambia el hash a mano o navega con atrás/adelante. */
export function alCambiarHash(fn) {
  window.addEventListener("hashchange", fn);
}
