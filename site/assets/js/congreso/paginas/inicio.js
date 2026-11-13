// Inicio: resumen de cada cámara y últimas votaciones.
import { CAMARAS, camara, manifiesto } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { enlace } from "../lib/estado.js";
import { fecha, numero } from "../lib/formato.js";
import { filaVotacion } from "../lib/componentes.js";

async function iniciar() {
  const resumen = $("#resumen-camaras");
  const ultimas = $("#ultimas");
  try {
    const [m, ...cams] = await Promise.all([manifiesto(), ...Object.keys(CAMARAS).map(camara)]);
    vaciar(resumen, cams.map((d) => {
      const c = m.camaras[d.clave];
      const activos = d.legisladores.filter((l) => l.estado === "activos").length;
      const leyes = d.votaciones.filter((v) => v.es_ley).length;
      return el("article", { class: "tarjeta-camara" },
        el("h3", {}, el("a", { href: enlace("camaras.html", { camara: d.clave }) }, d.info.nombreLargo)),
        el("dl", { class: "cifras" },
          el("div", {}, el("dt", {}, "Votaciones nominales"), el("dd", {}, numero(c.votaciones))),
          el("div", {}, el("dt", {}, "Sobre proyectos de ley"), el("dd", {}, numero(leyes))),
          el("div", {}, el("dt", {}, "Votos individuales"), el("dd", {}, numero(c.votos))),
          el("div", {}, el("dt", {}, `${d.info.miembros[0].toUpperCase()}${d.info.miembros.slice(1)} en ejercicio`), el("dd", {}, numero(activos)))),
        el("p", { class: "nota" }, `Del ${fecha(c.desde)} al ${fecha(c.hasta)}.`),
        el("p", { class: "acciones" },
          el("a", { href: enlace("legisladores.html", { camara: d.clave }) }, `Ver ${d.info.miembros}`),
          el("a", { href: enlace("votaciones.html", { camara: d.clave }) }, "Ver votaciones")));
    }));
    vaciar(ultimas, cams.map((d) => el("div", { class: "columna-camara" },
      el("h3", {}, d.info.nombreLargo),
      el("ul", { class: "lista" }, d.votaciones.slice(0, 5).map((v) => filaVotacion(v, d.clave))))));
  } catch (e) {
    mostrarError(resumen, `No se pudieron cargar los datos: ${e.message}`);
    ultimas.replaceChildren();
  }
}

iniciar();
