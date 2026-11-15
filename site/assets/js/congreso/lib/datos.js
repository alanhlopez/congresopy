// Carga de site/datos/congreso/*.json con rutas relativas a la página (funciona en / y en /instituciones/congreso/).

const BASE = "datos/congreso/";
const cache = new Map();

export const CAMARAS = {
  senado: { clave: "senado", nombre: "Senado", nombreLargo: "Cámara de Senadores", miembro: "senador", miembros: "senadores", bancas: 45 },
  diputados: { clave: "diputados", nombre: "Diputados", nombreLargo: "Cámara de Diputados", miembro: "diputado", miembros: "diputados", bancas: 80 },
};

export function camaraValida(c) {
  return Object.hasOwn(CAMARAS, c) ? c : "senado";
}

async function json(ruta) {
  if (!cache.has(ruta)) {
    cache.set(ruta, fetch(BASE + ruta).then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar ${ruta} (HTTP ${r.status})`);
      return r.json();
    }));
  }
  return cache.get(ruta);
}

export const manifiesto = () => json("manifiesto.json");

/** Los tres archivos de una cámara, con índices útiles ya armados. */
export async function camara(c) {
  const clave = camaraValida(c);
  const [legisladores, votaciones, votos] = await Promise.all([
    json(`${clave}/legisladores.json`), json(`${clave}/votaciones.json`), json(`${clave}/votos.json`),
  ]);
  const porId = new Map(legisladores.map((l) => [l.id, l]));
  const posVotacion = new Map(votos.orden.map((id, k) => [id, k]));
  return { clave, info: CAMARAS[clave], legisladores, votaciones, votos, porId, posVotacion };
}

/** presencia.json de una cámara: quienes menos votos registran en los últimos 12 meses (lo calcula el pipeline). */
export const presencia = (c) => json(`${camaraValida(c)}/presencia.json`);

/** comisiones.json de una cámara, o null si no está publicado (es opcional: el resto del sitio anda sin él). */
export async function comisiones(c) {
  const clave = camaraValida(c);
  const ruta = `${clave}/comisiones.json`;
  try {
    return await json(ruta);
  } catch {
    cache.delete(ruta);
    return null;
  }
}

/** Comisiones de un legislador: [{comision, periodo, cargo}], el período más reciente primero. */
export async function comisionesDe(id, c) {
  const d = await comisiones(c);
  if (!d) return null;
  const out = [];
  for (const com of d.comisiones) {
    for (const [lid, periodo, cargo] of com.integrantes) if (lid === id) out.push({ comision: com, periodo, cargo });
  }
  return out.sort((a, b) => b.periodo.localeCompare(a.periodo) || a.comision.nombre.localeCompare(b.comision.nombre, "es"));
}

/** Busca un legislador en las dos cámaras (los ids no se repiten). */
export async function buscarLegislador(id, camaraPreferida) {
  const orden = camaraPreferida && Object.hasOwn(CAMARAS, camaraPreferida)
    ? [camaraPreferida, ...Object.keys(CAMARAS).filter((c) => c !== camaraPreferida)]
    : Object.keys(CAMARAS);
  for (const c of orden) {
    const d = await camara(c);
    if (d.porId.has(id)) return { datos: d, legislador: d.porId.get(id) };
  }
  return null;
}
