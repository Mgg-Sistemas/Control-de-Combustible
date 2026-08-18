# Respaldo — unificación de horas y estado (18-ago-2026)

Copia tal cual de los 19 archivos que tocan **cálculo de horas** y **clasificación de
estado** (avería / parada / trabajando), tomada **antes** de empezar a unificarlos.

Etiqueta de git equivalente: **`respaldo/reportes-horas-2026-08-18`**.

## Por qué

El cliente reportó que dos reportes sobre el mismo día dan números distintos, y lo
resumió así: *"si saco un reporte y me da algo, y saco el nuevo reporte histórico y me
da otra cosa, diré que el sistema no sirve"*. El caso concreto fue la
RETROEXCAVADORA 008 (serial 92543.0) el 16-ago-2026.

No era un error de un reporte: **cada uno calcula por su cuenta.**

## El diagnóstico que motivó el cambio

**Horas.** Existe una fórmula canónica, `horasTurnoDelDia` en `src/lib/hours.ts`, creada
justamente para esto (lo dice su cabecera). La usan **4** archivos; hay **33** que leen
`day_hours`/`night_hours`. Los otros 29 calculan a mano.

Entre los que NO la usan está `inspectorReport.ts`, el reporte que sale del teléfono:
tiene ~170 líneas propias de cálculo (sus topes de 12 h, su elapsed en vivo, su resta de
paradas), usa `declared_day`/`declared_night` — que la canónica no conoce — e **ignora**
`hours_stopped` y `overtime_hours`, que la canónica sí resta y suma.

**Estado.** Tres clasificadores independientes, con consumidores disjuntos:

| Clasificador | Archivo | Quién lo usa |
|---|---|---|
| `clasificarEstadoTurno` | `inspectorDaySets.ts` | reportes de inspector, Histórico de Jornadas |
| `computeControlAveriadas` | `controlEstado.ts` | solo Control de Maquinaria |
| `makeLiveStatusOf` | `machineLiveStatus.ts` | Dashboard, Equipos, Usuarios, Viajes, Obras Públicas |

## Hacia dónde converge

`horasTurnoDelDia` (extraída del **Reporte por Empresa**, el que el cliente toma como
bueno). Todos los demás se adaptan a ella, no al revés.

**Requisito explícito del cliente:** todo debe trabajar **con la jornada** — anclaje 7am
día / 7pm noche, tope de 12 h, `jornada_start_at`, cierre — **sin chocar** con los
cambios de jornada ni con la automatización de arranque/cierre.

## Cómo volver atrás

```bash
git checkout respaldo/reportes-horas-2026-08-18 -- src/lib src/screens
```

O copiando de vuelta desde `lib/` y `screens/` de esta misma carpeta.
