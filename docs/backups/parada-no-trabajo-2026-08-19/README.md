# Respaldo — bug «🟡 PARADA · NO TRABAJÓ» borraba el turno equivocado

**Fecha:** 19-ago-2026 · **Etiqueta git:** `backup/parada-no-trabajo-2026-08-19`

Copia de los archivos **tal como estaban ANTES** del arreglo. Si algo sale mal,
se restauran con un `cp` de vuelta a su ruta original:

| archivo aquí | ruta original |
|---|---|
| `SupervisorScreen.tsx` | `src/screens/SupervisorScreen.tsx` |
| `inspectorDaySets.ts` | `src/lib/inspectorDaySets.ts` |
| `machineRounds.ts` | `src/lib/machineRounds.ts` |
| `machine_segments_source_finish_early.sql` | `supabase/machine_segments_source_finish_early.sql` |

## Qué pasaba

El inspector de **noche** marcaba «🟡 PARADA · NO TRABAJÓ» a partir de las 7pm y
la app le borraba las horas del turno de **día** al compañero.

Probado con datos reales del 19-ago-2026 (`audit_log` + `maintenance_requests`):

| horas borradas | ticket creado | motivo que escribió el inspector |
|---|---|---|
| 19:40:09 · CHUTO 000 · 12 → 0 | 19:40:10 | «NO TRABAJÓ · No trabajo de noche» |
| 20:04:20 · CHUTO LAVEGLIA · 10.3 → 0 | 20:04:20 | «NO TRABAJÓ · No hay acarreó nocturno» |
| 20:13:48 · PAYLOADER APP26 · 11.99 → 0 | 20:13:49 | «NO TRABAJÓ · No trabaja de noche» |
| 20:15:51 · GRÚAS 251619 · 12 → 0 | 20:15:52 | «NO TRABAJÓ · No trabjo» |

En los cuatro casos quien borró es el `inspector_night` de esa misma máquina, y
el motivo que él mismo escribió habla de la **noche**.

## Las dos causas

1. **Turno equivocado.** `jornadaShift` se tomaba de `machine_rounds.jornada_shift`
   (que a las 7:40pm todavía decía `'day'`), no de la hora real. El bloque de
   corrección de «no trabajó» resolvía entonces `shiftKey = 'day_hours'`.
2. **Rastro roto.** `machine_segments_source_finish_early.sql` re-creó el CHECK de
   `machine_work_segments.source` **sin** `'no_trabajo_correction'`, así que el
   tramo negativo auditable se rechazaba y el `.then(() => {}, () => {})` se lo
   tragaba. Por eso no había ni un solo rastro del 13-ago en adelante.

Alcance medido: 101 tramos `no_trabajo_correction` de turno DÍA escritos en horas
de noche, **1.046 h**, entre el 10 y el 12-ago (cuando el rastro todavía
funcionaba). Del 13-ago en adelante siguió pasando sin dejar registro.
