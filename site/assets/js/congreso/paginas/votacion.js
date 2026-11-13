// Detalle de una votación: textos, totales, hemiciclo por voto, votos por partido y lista nominal.
import { CAMARAS, camara } from "../lib/datos.js";
import { el, mostrarError, vaciar, $ } from "../lib/dom.js";
import { alCambiarHash, enlace, leerEstado } from "../lib/estado.js";
import { VOTOS, fecha, numero, ordenPartido, partidoNombre } from "../lib/formato.js";
import { hemiciclo } from "../lib/hemiciclo.js";
import { barraTotales, chipPartido, enlaceLegislador, tipoCorto } from "../lib/componentes.js";

const caja = $("#votacion");
const ORDEN_VOTO = ["S", "1", "2", "3", "N", "A", "V", "X"];

async function encontrar(id, preferida) {
  const orden = preferida && Object.hasOwn(CAMARAS, preferida) ? [preferida, ...Object.keys(CAMARAS).filter((c) => c !== preferida)] : Object.keys(CAMARAS);
  for (const c of orden) {
    const d = await camara(c);
    if (d.posVotacion.has(id)) return d;
  }
  return null;
}

function render(d, v) {
  const k = d.posVotacion.get(v.id);
  const presentes = d.legisladores
    .map((l) => ({ ...l, ch: d.votos.legisladores[String(l.id)][k] }))
    .filter((l) => l.ch !== "-")
    .sort((a, b) => ORDEN_VOTO.indexOf(a.ch) - ORDEN_VOTO.indexOf(b.ch) || ordenPartido(a.partido) - ordenPartido(b.partido)
      || a.nombre.localeCompare(b.nombre, "es"));
  const usados = ORDEN_VOTO.filter((c) => presentes.some((l) => l.ch === c));
  const etiquetaVoto = (c) => (v.mociones && v.mociones[c] ? `Moción ${c}` : VOTOS[c].etiqueta);

  const partidos = new Map();
  for (const l of presentes) {
    if (!partidos.has(l.partido)) partidos.set(l.partido, {});
    partidos.get(l.partido)[l.ch] = (partidos.get(l.partido)[l.ch] || 0) + 1;
  }

  document.title = `${v.titulo.slice(0, 70)} · Votación · Monitoreo Congreso del Paraguay`;
  $("#volver").setAttribute("href", enlace("votaciones.html", { camara: d.clave }));

  vaciar(caja,
    el("header", { class: "panel votacion-cabecera" },
      el("p", { class: "votacion-cabecera__meta" },
        el("time", { datetime: v.fecha }, fecha(v.fecha)), el("span", {}, d.info.nombreLargo),
        v.sesion && el("span", {}, `Sesión ${v.sesion.toLowerCase()}`),
        el("span", {}, v.es_ley ? "Proyecto de ley" : tipoCorto(v.tipo_proyecto)),
        v.expediente && el("span", {}, `Expediente ${v.expediente}`)),
      el("h1", {}, v.titulo),
      el("p", { class: "resultado resultado-grande" }, v.resultado || "Sin resultado publicado"),
      v.observacion && el("p", { class: "nota" }, v.observacion),
      v.mocion && el("p", {}, el("strong", {}, "Moción: "), v.mocion),
      v.mociones && el("ol", { class: "lista-simple" }, Object.entries(v.mociones).map(([n, t]) => el("li", { value: n }, t))),
      el("details", { class: "acapite" }, el("summary", {}, "Acápite completo"), el("p", {}, v.acapite || "—")),
      el("p", {}, el("a", { href: v.url, rel: "noopener" }, "Ver la votación en SILpy"))),

    el("section", { class: "seccion panel", "aria-labelledby": "t-res" },
      el("h2", { id: "t-res" }, "Resultado"),
      barraTotales(v.totales, { conLeyenda: true }),
      el("figure", { class: "figura-hemiciclo" },
        hemiciclo(presentes, {
          claseDe: (l) => VOTOS[l.ch].clase,
          enlaceDe: (l) => enlaceLegislador(l, d.clave),
          tituloDe: (l) => `${l.nombre} (${l.partido}): ${etiquetaVoto(l.ch)}`,
          etiqueta: `Voto de cada ${d.info.miembro} en esta votación, agrupados por voto`,
        }),
        el("figcaption", {}, `${numero(presentes.length)} ${d.info.miembros} en el registro, agrupados por voto y, dentro de cada voto, por partido.`))),

    el("section", { class: "seccion panel", "aria-labelledby": "t-part" },
      el("h2", { id: "t-part" }, "Cómo votó cada partido"),
      el("div", { class: "tabla-scroll" },
        el("table", { class: "tabla" },
          el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Partido"), usados.map((c) => el("th", { scope: "col", class: "num" }, etiquetaVoto(c))))),
          el("tbody", {}, [...partidos].sort((a, b) => Object.values(b[1]).reduce((s, n) => s + n, 0) - Object.values(a[1]).reduce((s, n) => s + n, 0))
            .map(([p, x]) => el("tr", {}, el("th", { scope: "row" }, chipPartido(p), " ", partidoNombre(p)),
              usados.map((c) => el("td", { class: "num" }, x[c] ? numero(x[c]) : "·")))))))),

    el("section", { class: "seccion panel", "aria-labelledby": "t-nom" },
      el("h2", { id: "t-nom" }, "Voto de cada legislador"),
      el("div", { class: "grupos-voto" }, usados.map((c) => {
        const xs = presentes.filter((l) => l.ch === c).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
        return el("div", { class: "grupo-voto" },
          el("h3", {}, el("span", { class: ["punto", VOTOS[c].clase], "aria-hidden": "true" }), `${etiquetaVoto(c)} `, el("span", { class: "nota" }, numero(xs.length))),
          el("ul", { class: "lista-nombres" }, xs.map((l) => el("li", {}, el("a", { href: enlaceLegislador(l, d.clave) }, l.nombre_corto), " ", chipPartido(l.partido)))));
      }))));
}

async function iniciar() {
  const e = leerEstado({ camara: "", id: "" });
  const id = Number(e.id);
  if (!id) {
    vaciar(caja, el("p", { class: "vacio" }, "Falta la votación. Elegí una en ", el("a", { href: "votaciones.html" }, "Votaciones"), "."));
    return;
  }
  try {
    const d = await encontrar(id, e.camara);
    if (!d) {
      vaciar(caja, el("p", { class: "vacio" }, `No hay una votación con id ${id} en los datos. `, el("a", { href: "votaciones.html" }, "Ver el listado"), "."));
      return;
    }
    render(d, d.votaciones[d.posVotacion.get(id)]);
  } catch (err) {
    mostrarError(caja, `No se pudieron cargar los datos: ${err.message}`);
  }
}

alCambiarHash(iniciar);
iniciar();
