# Correcciones manuales a silver/

Cambios hechos a mano sobre los CSV de `silver/` que no salen de SILpy (o que corrigen lo que publica SILpy).
Cada uno con fecha, archivo, qué cambió y de dónde sale el dato. Después de cada corrección se vuelven a
correr `pipeline/analisis.py` y `pipeline/exportar_sitio.py`.

`legisladores.csv` de las dos cámaras ya tenía `nombre_corto` cargado a mano, y el de Diputados se armó
entero a mano desde la nómina de SILpy (ver README del prototipo).

| Fecha | Archivo | Cambio | Fuente |
|---|---|---|---|
| 2026-11-13 | `silver/senado/legisladores.csv` | Eduardo Nakayama (101358): `partido` IA → PLRA. La `bancada` queda como figura en SILpy («Liberal Independiente») hasta confirmar si también cambió. Desde el mismo día está en `silver/senado/correcciones_legisladores.csv`, para que `bancadas.py sincronizar` la mantenga. | Indicación del responsable del proyecto: volvió al PLRA en 2026. |
| 2026-11-13 | `silver/senado/legisladores.csv`, `silver/diputados/legisladores.csv` | `nombre_corto` de los legisladores nuevos de la nómina: Faisal Ale (101624), Fernando Da Silva (101634), Rubén Benítez (101644). | Mismo criterio que el resto (primer nombre y primer apellido). |
| 2026-11-14 | `silver/senado/correcciones_legisladores.csv` | Eduardo Nakayama (101358): se confirma `partido` PLRA. La `bancada` sigue como en SILpy («Liberal Independiente»). | Indicación del responsable del proyecto: lo confirmó el propio senador. |
| 2026-11-14 | `silver/diputados/correcciones_legisladores.csv` | Rubén Rubín (101431): `partido` IND. SILpy lo deja vacío desde la foto del 13/11/2026 (todavía no lo actualizó). | Declaración del propio diputado, confirmada por el responsable del proyecto. |
| 2026-11-14 | `silver/diputados/correcciones_legisladores.csv` | Rubén Benítez (101644): `partido` ANR → PLRA y `color` #ff0000 → #002bc7; sin bancada, como en SILpy. | Indicación del responsable del proyecto. |
| 2026-11-14 | — | Fernando Da Silva (101634): PLRA sin bancada, coincide con SILpy; no hace falta corrección. | Indicación del responsable del proyecto. |
