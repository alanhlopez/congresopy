// Inicio: resumen de cada cámara y últimas votaciones.
import { CAMARAS, camara, manifiesto, presencia } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { enlace } from "../lib/estado.js";
import { apellidoNombre, fecha, numero, porcentaje } from "../lib/formato.js";
import { avatar, chipPartido, enlaceLegislador, filaVotacion, revisarRecortes } from "../lib/componentes.js";

const pctEntero = (x) => `${Math.round(x * 100)} %`;

/** Columna de una cámara: los de menor presencia (puestos 1 a 3, con empates) y la mediana como referencia. */
function columnaMenosVotos(d, p) {
  const porId = new Map(d.legisladores.map((l) => [l.id, l]));
  return el("div", { class: "columna-camara" },
    el("h3", { class: "columna-camara__titulo" }, d.info.nombreLargo),
    p.menor_presencia.length
      ? el("ol", { class: "menos-votos" }, p.menor_presencia.map((r) => {
        const l = porId.get(r.id) || { id: r.id, nombre: `Legislador ${r.id}` };
        return el("li", {},
          el("a", { class: "menos-votos__fila", href: enlaceLegislador(l, d.clave) },
            el("span", { class: "menos-votos__puesto", "aria-label": `Puesto ${r.puesto}` }, `${r.puesto}.º`),
            avatar(l),
            el("span", { class: "menos-votos__persona" },
              el("span", { class: "menos-votos__nombre" }, apellidoNombre(l.nombre, l.nombre_corto)),
              el("span", { class: "menos-votos__detalle" }, chipPartido(l.partido),
                el("span", {}, `no registró voto en ${numero(r.ausencias)} de ${numero(r.posibles)}`))),
            el("strong", { class: "menos-votos__dato" }, pctEntero(r.presencia), el("span", { class: "sr" }, " de presencia"))));
      }))
      : el("p", { class: "vacio" }, "No hay legisladores con votaciones suficientes en el período."),
    p.mediana !== null && el("p", { class: "menos-votos__mediana" },
      `Mediana ${d.clave === "senado" ? "del Senado" : "de Diputados"}: `, el("strong", {}, pctEntero(p.mediana)),
      ` (${numero(p.elegibles)} ${d.info.miembros} con votaciones suficientes)`));
}

async function iniciar() {
  const resumen = $("#resumen-camaras");
  const ultimas = $("#ultimas");
  try {
    const [m, ...cams] = await Promise.all([manifiesto(), ...Object.keys(CAMARAS).map(camara)]);
    const presencias = await Promise.all(cams.map((d) => presencia(d.clave)));
    vaciar(resumen, cams.map((d, i) => {
      const c = m.camaras[d.clave];
      const p = presencias[i];
      const leyes = d.votaciones.filter((v) => v.es_ley).length;
      const stat = (etiqueta, valor, nota) => el("div", { class: "stat" },
        el("span", { class: "stat__etiqueta" }, etiqueta), el("span", { class: "stat__valor" }, valor),
        nota && el("span", { class: "stat__nota" }, nota));
      // Bancas: según la nómina (en_ejercicio). Si hay vacantes, se dice junto al total.
      const bancas = p.en_ejercicio < d.info.bancas ? `${p.en_ejercicio} de ${d.info.bancas} bancas ocupadas` : `${d.info.bancas} bancas`;
      return el("article", { class: "tarjeta tarjeta-camara" },
        el("div", { class: "tarjeta-camara__cabeza" },
          el("h3", {}, el("a", { href: enlace("camaras.html", { camara: d.clave }) }, d.info.nombreLargo)),
          el("span", { class: "stat__nota" }, bancas)),
        el("div", { class: "tarjeta-camara__principal" },
          stat("Votaciones nominales", numero(c.votaciones), `del ${fecha(c.desde)} al ${fecha(c.hasta)}`)),
        el("div", { class: "tarjeta-camara__secundarios" },
          stat("Sobre proyectos de ley", numero(leyes), `${porcentaje(leyes / c.votaciones)} del total`)),
        el("p", { class: "tarjeta-camara__acciones" },
          el("a", { class: "boton", href: enlace("legisladores.html", { camara: d.clave }) }, `Ver ${d.info.miembros}`),
          el("a", { class: "boton", href: enlace("votaciones.html", { camara: d.clave }) }, "Ver votaciones")));
    }));
    vaciar($("#menos-votos"), cams.map((d, i) => columnaMenosVotos(d, presencias[i])));
    $("#menos-ventanas").textContent = cams.map((d, i) =>
      `${d.info.nombre}, del ${fecha(presencias[i].ventana.desde)} al ${fecha(presencias[i].ventana.hasta)} (${numero(presencias[i].ventana.votaciones)} votaciones)`).join("; ");
    vaciar(ultimas, cams.map((d) => el("div", { class: "columna-camara lista-votaciones" },
      el("h3", { class: "columna-camara__titulo" }, d.info.nombreLargo),
      el("ul", { class: "lista" }, d.votaciones.slice(0, 5).map((v) => filaVotacion(v, d.clave))))));
    revisarRecortes(ultimas);
  } catch (e) {
    mostrarError(resumen, `No se pudieron cargar los datos: ${e.message}`);
    ultimas.replaceChildren();
    $("#menos-votos").replaceChildren();
  }
}

iniciar();
