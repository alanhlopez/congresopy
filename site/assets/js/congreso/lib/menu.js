// Menú de la cabecera. Los desplegables (Análisis, Más) y el panel móvil son <details>: abren y cierran sin JS.
// Este módulo solo completa el comportamiento esperado de un menú:
//   - abrir uno cierra los demás;
//   - click afuera o Escape lo cierran (Escape devuelve el foco a su botón);
//   - si el foco sale de un desplegable con Tab, se cierra;
//   - aria-expanded en cada <summary> sigue el estado real.

export function iniciarMenu(raiz = document.querySelector(".cabecera")) {
  if (!raiz) return;
  const grupos = [...raiz.querySelectorAll("details.menu__grupo, details.menu-movil")];
  const sincronizar = (d) => d.querySelector(":scope > summary")?.setAttribute("aria-expanded", String(d.open));
  const cerrar = (d, enfocar = false) => {
    if (!d.open) return;
    d.open = false;
    sincronizar(d);
    if (enfocar) d.querySelector(":scope > summary")?.focus();
  };

  for (const d of grupos) {
    sincronizar(d);
    d.addEventListener("toggle", () => {
      sincronizar(d);
      if (d.open) for (const otro of grupos) if (otro !== d) cerrar(otro);
    });
    // Tab fuera del desplegable de escritorio: se cierra (en el panel móvil se deja abierto hasta Escape o click afuera)
    if (d.classList.contains("menu__grupo")) {
      d.addEventListener("focusout", (ev) => { if (!d.contains(ev.relatedTarget)) cerrar(d); });
    }
  }

  document.addEventListener("click", (ev) => {
    for (const d of grupos) if (d.open && !d.contains(ev.target)) cerrar(d);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const abierto = grupos.find((d) => d.open);
    if (abierto) { ev.preventDefault(); cerrar(abierto, abierto.contains(document.activeElement)); }
  });
  // Al pasar de móvil a escritorio (o al revés) no queda nada abierto que ya no se ve
  const ancho = window.matchMedia("(min-width: 1024px)");
  ancho.addEventListener("change", () => { for (const d of grupos) cerrar(d); });
}
