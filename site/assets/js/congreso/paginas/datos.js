// Datos abiertos: tabla de archivos a partir del manifiesto.
import { manifiesto } from "../lib/datos.js";
import { el, $ } from "../lib/dom.js";
import { fecha, numero } from "../lib/formato.js";

const tamanio = (b) => (b >= 1e6 ? `${(b / 1e6).toLocaleString("es-PY", { maximumFractionDigits: 1 })} MB` : `${Math.round(b / 1e3)} kB`);

async function iniciar() {
  const tbody = $("#tabla-archivos tbody");
  try {
    const m = await manifiesto();
    tbody.replaceChildren(...m.archivos.map((a) => el("tr", {},
      el("td", {}, el("a", { href: `datos/congreso/${a.archivo}` }, el("code", {}, a.archivo))),
      el("td", { class: "num" }, numero(a.filas)),
      el("td", { class: "num" }, tamanio(a.bytes)),
      el("td", {}, el("time", { datetime: a.generado }, fecha(a.generado.slice(0, 10)))),
      el("td", {}, el("code", { class: "hash", title: a.sha256 }, `${a.sha256.slice(0, 12)}…`)))));
  } catch (err) {
    tbody.replaceChildren(el("tr", {}, el("td", { colspan: 5, class: "error" }, `No se pudo leer el manifiesto: ${err.message}`)));
  }
}

iniciar();
