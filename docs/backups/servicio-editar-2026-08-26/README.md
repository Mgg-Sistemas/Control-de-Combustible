# Respaldo — Servicio de Maquinaria · 26-ago-2026

Copia de los archivos del submódulo **🧾 Servicios** tal como estaban **ANTES**
de agregarle **la edición de un servicio ya registrado** (commit `d5a8ccd9`).
Va junto con la etiqueta de git `respaldo/servicio-editar-2026-08-26`.

## Qué se va a cambiar después de esta copia

El cliente pidió (26-ago-2026, textual):

> «para el modulo de servicios de maquinaria en el submodulo de servicios,
> necesito la opcion de editar un servicio ya existente y que quede el registro
> de quien fue el ultimo que lo edito, y que fue lo que cambio»

- Poder **editar** un servicio que ya se guardó (sus datos y sus repuestos).
- Que quede grabado **quién** fue el último que lo editó y **cuándo**.
- Que quede grabado **qué campos cambió**, con el valor de antes y el de después.

## Qué quedó hecho

| | |
|---|---|
| `supabase/servicio_editar.sql` | **HAY QUE CORRERLO A MANO.** Columnas `updated_at`/`updated_by` + la bitácora `machinery_service_edits` + el trigger de auditoría |
| `src/lib/machineService.ts` | `editarServicio`, `cambiosServicio`, `filaServicioEdicion`, `resumenCambios` |
| `src/screens/ServicioRegistroTab.tsx` | Botón ✏️ Editar, línea de «última edición», modal 🕓 Ver cambios |
| `src/screens/AuditScreen.tsx` | Las dos tablas del módulo entran al mapa (lo exige `test-auditoria-labels.mjs`) |
| `scripts/test-servicio.mjs` | De 142 a 235 aserciones |

**No es bloqueante:** mientras el SQL no se corra, editar funciona y el servicio se
guarda bien; lo único que falta es el rastro, y la pantalla lo dice.

## Cómo volver atrás

```
git checkout respaldo/servicio-editar-2026-08-26 -- src/screens/ServicioRegistroTab.tsx src/lib/machineService.ts
```

o copiando los archivos de esta carpeta a su sitio.

## Archivos

| Archivo | De dónde viene |
|---|---|
| `machineService.ts` | `src/lib/` — las reglas del módulo |
| `machineServiceReport.ts` | `src/lib/` — el PDF |
| `ServicioRegistroTab.tsx` | `src/screens/` — la pestaña 🧾 Servicios |
| `test-servicio.mjs` | `scripts/` — las pruebas |
| `servicio_maquinaria.sql` | `supabase/` — las dos tablas del módulo |
| `servicio_rls_fix.sql` | `supabase/` — las políticas RLS |
