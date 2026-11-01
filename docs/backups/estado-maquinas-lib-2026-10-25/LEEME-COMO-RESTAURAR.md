# Respaldo — la lib del estado de las máquinas (antes de las lecturas por ids)

**Fecha:** 25 de octubre de 2026
**Motivo:** el Centro de Operaciones necesita leer el estado de inspección de SUS
máquinas vinculadas (pocas, no el catálogo completo). Para eso
`src/lib/machineLiveStatus.ts` gana, de forma ADITIVA y de solo lectura:

- `fetchAveriaCat(op)` y `fetchJornadaCat(now, op)` con opciones `{ ids, estricto }`
  (sin opciones hacen EXACTAMENTE lo de siempre);
- la constante `MARCADOR_PARADA` (el literal del marcador en un solo lugar);
- la función nueva `fetchNovedadesInspeccion(ids, desdeIso)`.

`fetchInspByShift`, `makeLiveStatusOf`, `estadoConteoDe`, `bucketMachineStatus` y
`ESTADO_CONTEO_*` no cambian. Las seis pantallas que usan la lib (Catálogo, Inicio,
Conteo de Reportes, Frentes, Usuarios y Viajes) siguen llamándola sin argumentos.

Este respaldo guarda la lib **exactamente como estaba antes del cambio**.

---

## Qué hay aquí

Copia literal, con la misma estructura de carpetas:

| Archivo | Para qué sirve |
|---|---|
| `src/lib/machineLiveStatus.ts` | Lectura del estado EN VIVO de las máquinas (averías, jornadas, inspector por turno) y LA regla de los 6 estados del Catálogo |

---

## Cómo restaurar

### Opción A — con la etiqueta de git

El respaldo también está en la etiqueta local
`backup/estado-maquinas-lib-antes-de-lecturas-por-ids` (commit `73cb2412`).
La etiqueta es LOCAL: no se sube al repositorio.

```bash
git checkout backup/estado-maquinas-lib-antes-de-lecturas-por-ids -- src/lib/machineLiveStatus.ts
```

Después hay que quitar (o dejar de llamar) lo que use las funciones nuevas: la
prueba `scripts/test-live-status-lectura.mjs` y, si ya existe, el uso que haga
`src/lib/centroOperacionesDb.ts` de `fetchNovedadesInspeccion` y de las opciones
`{ ids, estricto }`. `npx tsc --noEmit -p .` dice dónde.

### Opción B — copiar el archivo de esta carpeta

```bash
cp docs/backups/estado-maquinas-lib-2026-10-25/src/lib/machineLiveStatus.ts src/lib/machineLiveStatus.ts
```

Con el mismo aviso de la opción A sobre lo que use las funciones nuevas.

### Opción C — a mano, sin git

El archivo de esta carpeta es una copia exacta. Se puede abrir, comparar con el
actual y pegar lo que haga falta (por ejemplo, solo `fetchAveriaCat` o solo
`fetchJornadaCat`).

---

## Importante

- **No se tocó la base de datos.** Este cambio es solo de lectura en la app.
- **El cambio de la lib va en su propio commit** (solo la lib y su prueba), así que
  también se puede deshacer con `git revert <ese commit>`.
- Para comprobar que la vuelta atrás quedó bien: las cinco pruebas de la lib
  (`test-conteo-estados-reales`, `test-estado-averia-arrastrada`,
  `test-estado-transferida`, `test-frentes-estado-vivo`, `test-por-empresa-estados`)
  y `npx tsc --noEmit -p .`.
