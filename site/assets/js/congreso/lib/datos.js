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
