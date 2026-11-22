// «¿Cómo se lee este gráfico?» del Mapa político en el tiempo: animación en 4 pasos con los DATOS REALES de la
// cámara (coincidencia con la mayoría de la ANR por ventana de 12 meses, la misma serie que el gráfico de abajo).
// SVG propio; el movimiento es CSS (transform y opacity con transiciones del stylesheet). La posición de cada punto va
// en variables CSS (--x, --y) puestas con CSSOM (style.setProperty), permitido por la CSP.
// Con prefers-reduced-motion no hay movimiento: se muestran los 4 pasos como viñetas estáticas.
import { el, vaciar } from "./dom.js";

const PASOS = [
  ["Cada punto es un legislador", (m) => `Su altura es el porcentaje de votaciones divididas en las que votó como la mayoría de la ANR en la ventana que empieza en ${m.etiquetas[0]}. El color es su partido; la posición horizontal no significa nada.`],
  ["Los que votan parecido quedan juntos", () => "Las franjas marcan dónde está la mitad central de los legisladores de la ANR y la del resto, con todas las ventanas juntas."],
  ["Semestre a semestre", (m) => `Cada punto sube o baja según cómo votó en cada ventana de 12 meses, de ${m.etiquetas[0]} a ${m.etiquetas[m.n - 1]}. Los que no estaban en el cargo aparecen o se desvanecen.`],
  ["Cada recorrido es una línea", () => "El recorrido de cada uno, de izquierda a derecha, es una línea del gráfico de abajo."],
];
const DURACION = 5000;   // por paso
const FUENTE = "Fuente: votaciones nominales de SILpy. Posición estimada a partir de los votos.";

/** Orden horizontal estable y mezclado (la posición horizontal de los pasos 1 a 3 no significa nada). */
const mezcla = (id) => { let h = Number(id) * 2654435761; h ^= h >>> 15; return (h >>> 0) % 100003; };

/**
 * Geometría y series de una escena de ancho W.
 * fuente: { etiquetas, posiciones {id: [v | null]}, zonas {anr, resto}, dominio [y0, y1], marcas [..] }
 */
function modelo(W, fuente) {
  const angosto = W < 560;
  const H = angosto ? 330 : 370;
  const ml = 40, mr = angosto ? 10 : 16, mt = 40, mb = 44;
  const x0 = ml, x1 = W - mr;
  const [d0, d1] = fuente.dominio;
  const yv = (v) => mt + ((d1 - v) / (d1 - d0 || 1)) * (H - mt - mb);
  const n = fuente.etiquetas.length;
  const pad = angosto ? 16 : 26;
  const xs = (k) => x0 + pad + (n === 1 ? 0 : (k * (x1 - x0 - 2 * pad)) / (n - 1));
  const ids = Object.keys(fuente.posiciones).filter((i) => fuente.posiciones[i].some((v) => v !== null));
  const orden = [...ids].sort((a, b) => mezcla(a) - mezcla(b));
  const xr = new Map(orden.map((id, k) => [id, x0 + pad + ((k + 0.5) / orden.length) * (x1 - x0 - 2 * pad)]));
  const r = (angosto ? 2.8 : 3.6) + (ids.length <= 60 ? 0.8 : 0);
  return { ...fuente, W, H, ml, mr, mt, mb, x0, x1, yv, xs, n, ids, xr, r, angosto };
}

/** Valor de la serie en k, o el más cercano disponible (para ubicar a quien no estaba en el cargo). */
function cercano(serie, k) {
  if (serie[k] !== null && serie[k] !== undefined) return serie[k];
  for (let d = 1; d < serie.length; d++) {
    if (serie[k - d] !== null && serie[k - d] !== undefined) return serie[k - d];
    if (serie[k + d] !== null && serie[k + d] !== undefined) return serie[k + d];
  }
  return null;
}

/** Fotogramas de cada paso: clases de la escena y, por legislador, posición y si se ve; segmentos visibles. */
function fotogramas(m) {
  const nube = (k) => (id) => { const s = m.posiciones[id]; return { p: [m.xr.get(id), m.yv(cercano(s, k))], ve: s[k] !== null }; };
  const paso1 = { en: 0, clases: [], k: 0, pos: nube(0), segmentos: 0 };
  const paso2 = { en: 0, clases: ["am--zonas"], k: 0, pos: nube(0), segmentos: 0 };
  const t3 = Math.min(750, 4400 / m.n);
  const paso3 = Array.from({ length: m.n }, (_, k) => ({ en: 250 + k * t3, clases: ["am--zonas", "am--reloj"], k, pos: nube(k), segmentos: 0 }));
  // Paso 4: los puntos recorren las ventanas de izquierda a derecha y dejan su línea
  const t4 = Math.min(650, 3200 / m.n);
  const linea = (k) => (id) => { const s = m.posiciones[id]; return { p: [m.xs(k), m.yv(cercano(s, k))], ve: s[k] !== null }; };
  const paso4 = Array.from({ length: m.n }, (_, k) => ({ en: k * t4, clases: ["am--zonas", "am--ejes", "am--reloj"], k, pos: linea(k), segmentos: k }));
  const fin = { en: m.n * t4 + 300, clases: ["am--zonas", "am--ejes", "am--final"], k: m.n - 1, pos: linea(m.n - 1), segmentos: m.n - 1 };
  paso4.push(fin, { ...fin, en: fin.en + 900, clases: [...fin.clases, "am--cierre"] });
  return [[paso1], [paso2], paso3, paso4];
}

const mover = (n, [x, y]) => { n.style.setProperty("--x", x.toFixed(1)); n.style.setProperty("--y", y.toFixed(1)); };

/** Escena SVG; `pintar(fotograma)` la lleva a ese estado y `seleccionar(id)` resalta a una persona. */
function escena(m, etiquetaAria, { persona, clasePartido, conectarPersona }) {
  const { W, H, x0, x1, yv, xs, n } = m;
  const svg = el("svg:svg", { class: "am-svg", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": etiquetaAria });
  const fin = x1 - 6;
  // Franja de fondo y, aparte, su rótulo: el rótulo va encima de puntos y líneas para que se lea
  const franja = (z, cls) => (z ? el("svg:g", { class: `am-franja ${cls}`, "aria-hidden": "true" },
    el("svg:rect", { x: x0, y: yv(z[1]), width: x1 - x0, height: Math.max(yv(z[0]) - yv(z[1]), 4), rx: 6, class: "am-zona" })) : null);
  const rotulo = (z, texto) => {
    if (!z) return null;
    const ancho = texto.length * 5.9 + 8, y = yv(z[1]) + 3;
    return el("svg:g", { class: "am-franja", "aria-hidden": "true" },
      el("svg:rect", { x: fin + 4 - ancho, y, width: ancho, height: 15, rx: 4, class: "am-rotulo__fondo" }),
      el("svg:text", { x: fin, y: y + 11, "text-anchor": "end", class: "am-rotulo" }, texto));
  };
  const corto = m.angosto;
  const ejes = el("svg:g", { class: "eje", "aria-hidden": "true" },
    m.marcas.map((v) => [el("svg:line", { x1: x0, x2: x1, y1: yv(v), y2: yv(v), class: "eje__guia" }),
      el("svg:text", { x: x0 - 5, y: yv(v) + 4, "text-anchor": "end", class: "eje__texto" }, `${Math.round(v * 100)}%`)]),
    el("svg:text", { x: x0 + 4, y: m.mt - 14, class: "eje__texto eje__texto--fuerte" }, corto ? "↑ más como la ANR" : "↑ vota más como la mayoría de la ANR"),
    el("svg:text", { x: x0 + 4, y: H - 8, class: "eje__texto eje__texto--fuerte" }, corto ? "↓ más distinto a la ANR" : "↓ vota más distinto a la mayoría de la ANR"));
  const semestres = el("svg:g", { class: "am-ejes", "aria-hidden": "true" },
    m.etiquetas.map((t, k) => el("svg:text", { x: xs(k), y: H - m.mb + 15, "text-anchor": "middle", class: "eje__texto" }, t)));
  // Reloj de semestres (arriba a la derecha)
  const relojTexto = el("svg:text", { x: x1 - 20, y: m.mt - 14, "text-anchor": "end", class: "am-reloj__texto" }, m.etiquetas[0]);
  const reloj = el("svg:g", { class: "am-reloj", "aria-hidden": "true" },
    el("svg:circle", { cx: x1 - 8, cy: m.mt - 18, r: 7, class: "am-reloj__esfera" }),
    el("svg:line", { x1: x1 - 8, y1: m.mt - 18, x2: x1 - 8, y2: m.mt - 23, class: "am-reloj__aguja" }),
    el("svg:line", { x1: x1 - 8, y1: m.mt - 18, x2: x1 - 4, y2: m.mt - 18, class: "am-reloj__aguja" }), relojTexto);

  const capaLineas = el("svg:g", { class: "am-lineas" }), capaPuntos = el("svg:g", { class: "am-puntos" });
  const gente = m.ids.map((id) => {
    const l = persona(id);
    const s = m.posiciones[id];
    const segs = [];
    for (let k = 1; k < n; k++) {
      if (s[k - 1] === null || s[k] === null) { segs.push(null); continue; }
      segs.push(el("svg:line", { x1: xs(k - 1), y1: yv(s[k - 1]), x2: xs(k), y2: yv(s[k]), class: "am-seg" }));
    }
    const linea = el("svg:g", { class: ["am-linea", clasePartido(l)], dataset: { animPersona: id } }, segs);
    // tabindex -1: fuera del recorrido con Tab (Chrome enfoca los <g> con eventos); el teclado usa el gráfico real
    const punto = el("svg:g", { class: ["am-punto", clasePartido(l)], tabindex: "-1", dataset: { animPersona: id } },
      el("svg:circle", { r: 11, class: "am-aro" }), el("svg:circle", { r: m.r, class: "am-punto__c" }),
      el("svg:text", { x: 13, y: 4, class: "am-nombre" }, l.nombre_corto || l.nombre));
    const serie = s.map((v, k) => `${m.etiquetas[k]}: ${v === null ? "—" : `${Math.round(v * 100)} %`}`).join(" · ");
    conectarPersona(punto, l, [`Coincidencia con la mayoría de la ANR por ventana: ${serie}`]);
    capaLineas.append(linea);
    capaPuntos.append(punto);
    return { id, punto, linea, segs };
  });
  svg.append(
    franja(m.zonas.resto, "am-franja--resto"), franja(m.zonas.anr, "am-franja--anr"),
    ejes, semestres, capaLineas, capaPuntos,
    rotulo(m.zonas.resto, "zona de los que votan distinto"), rotulo(m.zonas.anr, "zona de la mayoría de la ANR"), reloj);

  const todas = ["am--zonas", "am--reloj", "am--ejes", "am--final", "am--cierre"];
  function pintar(fg) {
    for (const c of todas) svg.classList.toggle(c, fg.clases.includes(c));
    for (const g of gente) {
      const { p, ve } = fg.pos(g.id);
      mover(g.punto, p);
      g.punto.classList.toggle("es-oculto", !ve);
      g.segs.forEach((sg, k) => sg?.classList.toggle("es-visible", k < fg.segmentos));
    }
    relojTexto.textContent = m.etiquetas[fg.k];
  }
  function seleccionar(id) {
    svg.classList.toggle("am--seleccion", Boolean(id) && gente.some((g) => g.id === String(id)));
    for (const g of gente) {
      const es = g.id === String(id);
      g.punto.classList.toggle("es-elegido", es);
      g.linea.classList.toggle("es-elegido", es);
      if (es) { capaPuntos.append(g.punto); capaLineas.append(g.linea); }
    }
  }
  return { svg, pintar, seleccionar, reloj: relojTexto };
}

/**
 * Monta la animación en `caja`, dentro del <details> `detalles`: se arma al abrirlo y se reproduce desde el
 * principio; al cerrarlo, se pausa. Devuelve { actualizar(fuente, seleccionado) } para cambiar de cámara o de
 * persona seguida. `ayudas`: { persona(id), clasePartido(l), conectarPersona(nodo, l, lineas), alFinal() }.
 */
export function montarAnimacionMapa(detalles, caja, ayudas) {
  const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)");
  let fuente = null, elegido = "";
  let paso = 0, cuadro = 0, reproduciendo = false, reloj = null, armada = null, anchoArmado = 0;

  const ancho = () => Math.min(760, Math.max(260, Math.floor(caja.getBoundingClientRect().width)));
  const cierre = () => el("p", { class: "am-cierre" }, el("button", { type: "button", class: "boton boton-primario", on: { click: ayudas.alFinal } },
    "Explorá el gráfico ", el("span", { "aria-hidden": "true" }, "↓")));
  const pie = () => el("p", { class: "nota am-fuente" }, FUENTE);

  function armarEstatica() {
    const m = modelo(380, fuente);
    const fs = fotogramas(m);
    const quietos = [fs[0][0], fs[1][0], fs[2][fs[2].length - 1], fs[3][fs[3].length - 1]];
    const escenas = [];
    vaciar(caja, el("div", { class: "am am--estatica" },
      el("ol", { class: "am-vinetas" }, PASOS.map(([t, d], i) => {
        const e = escena(m, `Paso ${i + 1} de 4, ${t}. ${d(m)}`, ayudas);
        e.pintar(quietos[i]);
        if (i === 2) e.reloj.textContent = `${m.etiquetas[0]} → ${m.etiquetas[m.n - 1]}`;
        escenas.push(e);
        return el("li", { class: "am-vineta" }, el("p", { class: "am-vineta__texto" }, el("strong", {}, `${i + 1}. ${t}. `), d(m)), e.svg);
      })),
      pie(), cierre()));
    armada = { estatica: true, escenas };
  }

  function armarAnimada() {
    const m = modelo(ancho(), fuente);
    const fs = fotogramas(m);
    const e = escena(m, `Animación en 4 pasos sobre cómo leer el mapa en el tiempo, con los datos de la cámara.`, ayudas);
    const titulo = el("p", { class: "am-texto" });
    const detalle = el("p", { class: "am-detalle" });
    const vivo = el("div", { class: "am-vivo", "aria-live": "polite" }, titulo, detalle);
    const boton = (etiqueta, contenido, fn, extra = {}) => el("button", { type: "button", class: "boton am-control", "aria-label": etiqueta, on: { click: fn }, ...extra }, contenido);
    const bPlay = boton("Pausa", "❚❚", () => (reproduciendo ? pausar() : reproducir()));
    const bPasos = PASOS.map(([t], i) => el("button", { type: "button", class: "am-paso", "aria-label": `Paso ${i + 1}: ${t}`, on: { click: () => ir(i) } }, String(i + 1)));
    const final = cierre();
    vaciar(caja, el("div", { class: "am" },
      el("div", { class: "am-escenario" }, e.svg),
      vivo,
      el("div", { class: "am-controles" },
        boton("Paso anterior", "‹", () => ir(Math.max(0, paso - 1))), bPlay, boton("Paso siguiente", "›", () => ir(Math.min(3, paso + 1))),
        el("div", { class: "am-pasos", role: "group", "aria-label": "Pasos" }, bPasos),
        boton("Volver a ver desde el principio", "Volver a ver", () => { paso = 0; cuadro = 0; reproducir(); }, { class: "boton am-control am-control--texto" })),
      pie(), final));
    armada = { estatica: false, m, fs, e, titulo, detalle, bPlay, bPasos, final };
    anchoArmado = ancho();
  }

  function mostrar() {
    const a = armada;
    const fg = a.fs[paso][cuadro];
    a.e.pintar(fg);
    a.bPasos.forEach((b, i) => (i === paso ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current")));
    a.bPlay.textContent = reproduciendo ? "❚❚" : "▶";
    a.bPlay.setAttribute("aria-label", reproduciendo ? "Pausa" : "Reproducir");
    a.final.classList.toggle("es-visible", fg.clases.includes("am--cierre"));
  }
  function anunciar() {
    armada.titulo.textContent = `Paso ${paso + 1} de 4. ${PASOS[paso][0]}.`;
    armada.detalle.textContent = PASOS[paso][1](armada.m);
  }

  function siguiente() {
    const fs = armada.fs[paso];
    const espera = cuadro + 1 < fs.length ? fs[cuadro + 1].en - fs[cuadro].en : Math.max(600, DURACION - fs[cuadro].en);
    reloj = setTimeout(() => {
      if (cuadro + 1 < fs.length) cuadro++;
      else if (paso < 3) { paso++; cuadro = 0; anunciar(); }
      else { reproduciendo = false; mostrar(); return; }
      mostrar();
      siguiente();
    }, espera);
  }
  function reproducir() {
    if (!armada || armada.estatica) return;
    clearTimeout(reloj);
    if (paso === 3 && cuadro === armada.fs[3].length - 1) { paso = 0; cuadro = 0; }
    reproduciendo = true;
    anunciar();
    mostrar();
    siguiente();
  }
  function pausar() {
    clearTimeout(reloj);
    reproduciendo = false;
    if (armada && !armada.estatica) mostrar();
  }
  /** Ir a un paso a mano: se pausa y se muestra el paso completo. */
  function ir(i) {
    clearTimeout(reloj);
    reproduciendo = false;
    paso = i;
    cuadro = armada.fs[i].length - 1;
    anunciar();
    mostrar();
  }
  function seleccionar() {
    if (!armada) return;
    if (armada.estatica) armada.escenas.forEach((e) => e.seleccionar(elegido)); else armada.e.seleccionar(elegido);
  }

  /** Arma la escena y la deja en el paso actual; `desdeCero` la reproduce desde el principio. */
  function armar(desdeCero) {
    if (!fuente) return;
    clearTimeout(reloj);
    if (sinMovimiento.matches) { armarEstatica(); seleccionar(); return; }
    armarAnimada();
    seleccionar();
    if (desdeCero) { paso = 0; cuadro = 0; reproducir(); } else { anunciar(); mostrar(); }
  }

  detalles.addEventListener("toggle", () => { if (detalles.open) armar(true); else pausar(); });
  sinMovimiento.addEventListener("change", () => { if (detalles.open) armar(true); });
  new ResizeObserver(() => {
    if (!detalles.open || !armada || armada.estatica || Math.abs(ancho() - anchoArmado) < 40) return;
    const seguia = reproduciendo;
    armar(false);
    if (seguia) reproducir();
  }).observe(caja);

  return {
    actualizar(nueva, seleccionado) {
      const cambio = nueva !== fuente;
      fuente = nueva;
      elegido = seleccionado || "";
      if (cambio && detalles.open) armar(true);
      else seleccionar();
    },
  };
}
