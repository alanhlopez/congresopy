// Inicio: resumen de cada cámara y últimas votaciones.
import { CAMARAS, camara, manifiesto } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { enlace } from "../lib/estado.js";
import { fecha, numero } from "../lib/formato.js";
import { filaVotacion, revisarRecortes } from "../lib/componentes.js";

async function iniciar() {
  const resumen = $("#resumen-camaras");
  const ultimas = $("#ultimas");
  try {
    const [m, ...cams] = await Promise.all([manifiesto(), ...Object.keys(CAMARAS).map(camara)]);
    vaciar(resumen, cams.map((d) => {
      const c = m.camaras[d.clave];
      const activos = d.legisladores.filter((l) => l.estado === "activos").length;
      const leyes = d.votaciones.filter((v) => v.es_ley).length;
      const stat = (etiqueta, valor, nota) => el("div", { class: "stat" },
        el("span", { class: "stat__etiqueta" }, etiqueta), el("span", { class: "stat__valor" }, valor),
        nota && el("span", { class: "stat__nota" }, nota));
      return el("article", { class: "tarjeta tarjeta-camara" },
        el("div", { class: "tarjeta-camara__cabeza" },
          el("h3", {}, el("a", { href: enlace("camaras.html", { camara: d.clave }) }, d.info.nombreLargo)),
          el("span", { class: "stat__nota" }, `${d.info.bancas} bancas`)),
        el("div", { class: "tarjeta-camara__principal" },
          stat("Votaciones nominales", numero(c.votaciones), `del ${fecha(c.desde)} al ${fecha(c.hasta)}`)),
        el("div", { class: "tarjeta-camara__secundarios" },
          stat("Sobre proyectos de ley", numero(leyes)),
          stat("Votos individuales", numero(c.votos)),
          // legisladores.json solo trae a quien ya votó: puede haber menos que bancas (recién asumidos)
          stat(`${d.info.miembros[0].toUpperCase()}${d.info.miembros.slice(1)} en ejercicio`, numero(activos),
            activos < d.info.bancas ? `de ${d.info.bancas} bancas` : null)),
        el("p", { class: "tarjeta-camara__acciones" },
          el("a", { class: "boton", href: enlace("legisladores.html", { camara: d.clave }) }, `Ver ${d.info.miembros}`),
          el("a", { class: "boton", href: enlace("votaciones.html", { camara: d.clave }) }, "Ver votaciones")));
    }));
    vaciar(ultimas, cams.map((d) => el("div", { class: "columna-camara lista-votaciones" },
      el("h3", { class: "columna-camara__titulo" }, d.info.nombreLargo),
      el("ul", { class: "lista" }, d.votaciones.slice(0, 5).map((v) => filaVotacion(v, d.clave))))));
    revisarRecortes(ultimas);
  } catch (e) {
    mostrarError(resumen, `No se pudieron cargar los datos: ${e.message}`);
    ultimas.replaceChildren();
  }
}

iniciar();
