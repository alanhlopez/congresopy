// congresopy — script común a todas las páginas (módulo ES, sin dependencias).
// Tema: data-theme="light|dark" en <html>. Respeta prefers-color-scheme y recuerda la
// elección del usuario en localStorage (dentro de try/catch: puede no estar disponible).

const CLAVE_TEMA = "congreso:tema";
const raiz = document.documentElement;
const consulta = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function leerTemaGuardado() {
  try {
    const t = localStorage.getItem(CLAVE_TEMA);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

function guardarTema(tema) {
  try {
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Sin localStorage (modo privado, bloqueado): el tema dura lo que dura la página.
  }
}

function temaDelSistema() {
  return consulta && consulta.matches ? "dark" : "light";
}

function actualizarBoton(tema) {
  const boton = document.getElementById("boton-tema");
  if (!boton) return;
  const otro = tema === "dark" ? "claro" : "oscuro";
  boton.setAttribute("aria-label", `Cambiar a tema ${otro}`);
  boton.setAttribute("aria-pressed", String(tema === "dark"));
  const texto = boton.querySelector(".tema__texto");
  if (texto) texto.textContent = `Tema ${otro}`;
}

function aplicarTema(tema) {
  raiz.setAttribute("data-theme", tema);
  actualizarBoton(tema);
}

// Se aplica apenas carga el módulo; el CSS cubre el instante anterior con prefers-color-scheme.
aplicarTema(leerTemaGuardado() ?? temaDelSistema());

// Si el usuario no eligió, seguir los cambios del sistema.
if (consulta) {
  consulta.addEventListener("change", () => {
    if (!leerTemaGuardado()) aplicarTema(temaDelSistema());
  });
}

function iniciar() {
  actualizarBoton(raiz.getAttribute("data-theme") || temaDelSistema());
  const boton = document.getElementById("boton-tema");
  if (boton) {
    boton.addEventListener("click", () => {
      const nuevo = raiz.getAttribute("data-theme") === "dark" ? "light" : "dark";
      aplicarTema(nuevo);
      guardarTema(nuevo);
    });
  }
  // Los ítems del menú que todavía no existen no navegan.
  for (const a of document.querySelectorAll('.menu a[aria-disabled="true"]')) {
    a.addEventListener("click", (e) => e.preventDefault());
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciar);
} else {
  iniciar();
}
