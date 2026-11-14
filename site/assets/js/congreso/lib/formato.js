// Formatos en español del Paraguay y catálogos de votos y partidos.

const num = new Intl.NumberFormat("es-PY");
const pct1 = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const numero = (n) => num.format(n);
export const porcentaje = (x) => (x === null || x === undefined || Number.isNaN(x) ? "—" : pct1.format(x * 100) + " %");

/** "2026-10-14" -> "14/10/2026" */
export function fecha(iso) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** Minúsculas, sin tildes ni signos: para buscar. */
export function normalizar(t) {
  return (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** «Apellido, Nombre» a partir del nombre completo y del nombre_corto cargado a mano («Juan Afara»): la última
    palabra del nombre corto marca dónde empieza el apellido (y las anteriores, si también están en el corto). Si no aparece en el nombre completo, se deja igual. */
export function apellidoNombre(nombre, corto) {
  const partes = (nombre || "").split(/\s+/).filter(Boolean);
  const enCorto = (corto || "").split(/\s+/).filter(Boolean).slice(1).map(normalizar);
  let k = partes.findIndex((p, i) => i > 0 && normalizar(p) === enCorto[enCorto.length - 1]);
  // Apellido compuesto en el nombre corto («Pedro Díaz Verón»): se incluyen las palabras anteriores que también están.
  while (k > 1 && enCorto.includes(normalizar(partes[k - 1]))) k--;
  return k > 0 ? `${partes.slice(k).join(" ")}, ${partes.slice(0, k).join(" ")}` : nombre;
}

/** Iniciales para el avatar: "Juan Eudes Afara Maciel" -> "JA" (primer nombre + primer apellido estimado). */
export function iniciales(nombre) {
  const p = (nombre || "").split(/\s+/).filter((x) => /^[A-ZÁÉÍÓÚÑ]/i.test(x));
  if (!p.length) return "?";
  const ap = p.length >= 4 ? p[p.length - 2] : p[p.length - 1];
  return (p[0][0] + (p.length > 1 ? ap[0] : "")).toUpperCase();
}

// Códigos de votos.json -> etiqueta y clase CSS
export const VOTOS = {
  S: { etiqueta: "Sí", larga: "Afirmativo", clase: "v-si" },
  N: { etiqueta: "No", larga: "Negativo", clase: "v-no" },
  A: { etiqueta: "Abstención", larga: "Abstención", clase: "v-abs" },
  X: { etiqueta: "Ausente", larga: "Ausente", clase: "v-aus" },
  V: { etiqueta: "No vota", larga: "Presente, no vota", clase: "v-nv" },
  1: { etiqueta: "Moción 1", larga: "Moción 1", clase: "v-m1" },
  2: { etiqueta: "Moción 2", larga: "Moción 2", clase: "v-m2" },
  3: { etiqueta: "Moción 3", larga: "Moción 3", clase: "v-m3" },
  "-": { etiqueta: "Fuera del cargo", larga: "Fuera del cargo", clase: "v-fuera" },
};
export const EMITIDOS = new Set(["S", "N", "A", "1", "2", "3"]);

// Partidos: nombre y clase de color. Los códigos y los colores (congreso.css) son los de la nómina de SILpy.
const PARTIDOS = {
  ANR: ["Asociación Nacional Republicana (Partido Colorado)", "p-anr"],
  PLRA: ["Partido Liberal Radical Auténtico", "p-plra"],
  CDN: ["Conciencia Democrática Nacional (Yo Creo)", "p-cdn"],
  PCN: ["Partido Cruzada Nacional", "p-cn"],
  CN: ["Partido Cruzada Nacional", "p-cn"],
  PEN: ["Partido Encuentro Nacional", "p-pen"],
  PPQ: ["Partido Patria Querida", "p-ppq"],
  PPS: ["Partido País Solidario", "p-pps"],
  PPC: ["Partido Participación Ciudadana", "p-ppc"],
  PDP: ["Partido Democrático Progresista", "p-pdp"],
  IND: ["Independiente", "p-ind"],
};
// Orden en el hemiciclo, de izquierda a derecha: oposición por tamaño y el oficialismo (ANR) a la derecha.
export const ORDEN_PARTIDOS = ["PLRA", "CDN", "PEN", "PPQ", "PPS", "PPC", "PDP", "IND", "IA", "PCN", "CN", "ANR"];

// Sigla sin nombre conocido (por ejemplo «IA»): se muestra tal como figura en SILpy, sin inventar el nombre.
export const partidoNombre = (p) => (PARTIDOS[p] ? PARTIDOS[p][0] : p ? `${p} (sigla en SILpy)` : "Sin partido");
export const partidoClase = (p) => (PARTIDOS[p] ? PARTIDOS[p][1] : "p-otro");
export const ordenPartido = (p) => {
  const k = ORDEN_PARTIDOS.indexOf(p);
  return k === -1 ? ORDEN_PARTIDOS.length - 1.5 : k;
};
