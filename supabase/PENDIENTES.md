# SQL — qué falta correr

> **Creado el 28/08/2026.** Es la **única** lista buena. Antes había **tres**, en tres documentos
> distintos, y **se contradecían entre sí**:
>
> | Dónde estaba | Fecha | Problema |
> |---|---|---|
> | `docs/HANDOFF-CLAUDE.md` §8 | 14-ago | Marcaba un bloqueante que las otras dos ni mencionan |
> | `docs/CONTEXTO-PARA-NUEVO-CHAT.md` §8 | 17-ago | Conjunto **distinto**; se saltaba el bloqueante |
> | `docs/MANUAL-USUARIO.md` §4.25 | — | Una **tercera** lista, y directivas sueltas en 21 líneas más |
>
> Las tres quedan **anuladas por este archivo**. Si encuentras otra lista, está vieja.

---

## ⚠️ Lo primero que hay que entender

**Editar un `.sql` no lo aplica.** Estos archivos no se ejecutan solos: hay que abrirlos, copiarlos
y correrlos a mano en **Supabase → SQL Editor**. Un archivo perfecto sin correr no sirve de nada.

**No hay tabla de migraciones.** Son 175 archivos en `supabase/`, sin numerar y sin registro de
ejecución. La única forma de saber si algo se corrió es **preguntárselo a la base**. Por eso cada
fila de abajo trae su consulta de comprobación.

---

## 🔴 BLOQUEANTE — correr esto primero

### `machine_rounds_jornada_marked_by.sql`

Agrega la columna `jornada_marked_by` y recrea el RPC `upsert_machine_round`.

**Por qué es bloqueante:** la app ya pide esa columna en **21 sitios** de `src/`. Si no existe,
PostgREST devuelve **error 400** y se rompen el **panel de Inspecciones** y dos reportes.

```sql
-- ¿Hace falta? Si devuelve 0 filas, SÍ hace falta.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'machine_rounds'
  and column_name = 'jornada_marked_by';
```

---

## 🟠 De los arreglos del 27/08/2026

### `rol_coordinador_inspectores_enum.sql` ✅ CORRIDO Y VERIFICADO — 28/08/2026

El cliente lo corrió y el bloque 3 devolvió **`quedo_registrado = true`**, con los ocho roles en el
enum: `admin, supervisor, operador, conductor, analista, cocina, coordinador_patio,
coordinador_inspectores`. Cotejados contra las tres listas del código (`UsersScreen.ROLES`, el
`allowed` de la Edge Function y el tipo `UserRole`): **las cuatro coinciden**.

> **Queda una cosa, y NO es SQL.** La Edge Function que crea usuarios sigue sin desplegar, y **el
> CI no la publica**:
> ```bash
> supabase functions deploy admin-create-user
> ```
> No es urgente: la pantalla ya reenvía el rol después de crear, así que el bug está tapado
> aunque la función desplegada siga siendo la vieja. Desplegarla cierra la causa de raíz.

---

## 🟡 Escritos y sin correr

| Archivo | Qué hace | Riesgo |
|---|---|---|
| `quitar_adopcion_automatica_placeholder.sql` | Quita `assign-missing-to-placeholder` | **Ninguno** — verificado que el cajón tiene 0 máquinas |
| `servicio_maquinaria_tabla_propia.sql` | Crea `servicio_registros` con RLS y realtime | Bajo — **solo CREATE**, ningún ALTER de tablas existentes |
| `diagnostico_crons_y_jornadas_abiertas.sql` | Solo lee: lista los `cron.job` | Ninguno |

### Obras Públicas — el módulo degrada solo, pero con funciones caídas

`op_external_machines.sql` · `op_realtime.sql` · `op_edificio_removidos.sql` ·
`op_edificio_reporte_fase2.sql` · `op_daily_reports.sql`

### Horas y cierres — hay que **re-correrlos** por el `least(12, …)` nuevo

`payloaders_noche_0_y_tope_24h.sql` · `auto_close_jornadas.sql`

> ⚠️ **Los crons se desprograman al restaurar la base.** Si se restauró un respaldo, las jornadas
> dejan de cerrarse solas y hay que volver a programar `pg_cron`. Es la causa habitual de
> «jornadas abiertas de días pasados».

---

## ⛔ NO CORRER

### `recuperar_jornadas_sin_cerrar.sql`

**Infla los pagos.** Cierra jornadas viejas contando horas que nadie trabajó. Está escrito y se
conserva, pero **no se corre** sin hablarlo antes con el cliente.

---

## ❓ Citados en la documentación pero **el archivo no existe**

Si alguien te manda correr uno de estos, no lo busques: no está.

| Citado en | Archivo | Qué pasó |
|---|---|---|
| `docs/plan-mejoras.html:239` | `desactivar_maquinas_faltantes.sql` | Se borró a propósito (`034c2118`), **pero el HTML sigue diciendo "✓ Hecho"**. Hay lógica viva en producción sin archivo que la describa. |
| `sos_la_guaira_full_backfill_y_noche_viva.sql:141` | `completar_jornadas_full_maquinas_faltantes.sql` | **Nunca existió** en ninguna rama |
| `src/types/database.ts:142` | `vehiculos_en_espera.sql` | Nunca existió. La columna `en_espera` está tipada en el cliente pero el SQL que la crea no está versionado |

También: la definición de `truck_yard_logs` **solo existe en producción**
(`docs/plan-mejoras.html:697` lo reconoce).

---

## ✅ Corridos y confirmados por el cliente

| Archivo | Cuándo |
|---|---|
| `rol_coordinador_inspectores_enum.sql` | **28/08/2026** — `quedo_registrado = true`, 8 roles en el enum |
| `servicio_editar.sql` | 26/08/2026 — verificación 7/7 en verde |
| `vaciar_obras_publicas.sql` | semana del 14/08 |
| `expira_paradas_no_trabajo_al_cerrar_turno.sql` | semana del 14/08 |
| `machine_segments_source_finish_early.sql` | semana del 14/08 |
| `horas_maquinas_4014_2268_desde_7am.sql` | semana del 14/08 |

---

## 📋 Orden obligatorio en Compras directas

Los cuatro se pisan **las mismas funciones**. Si se recorre uno de los primeros, hay que volver a
correr los siguientes:

```
1º  compras_directas.sql
2º  compras_directas_editar.sql
3º  compras_directas_sin_cuenta.sql     ← quita la cuenta por pagar
```

## 📋 Mangueras

`mangueras_cobrar_todos_encargados.sql` — **todos** los encargados generan cuenta por cobrar,
CHELI incluido, y crea hacia atrás las que faltaban.
`mangueras_orden_gerente_general.sql` — el check «Autorizado bajo orden del Gerente General» para
el rol ALMACENISTA.

```sql
-- ¿Corrió el de CHELI? Si devuelve 0, aún no.
select count(*) from public.cuentas
where tipo = 'por_cobrar' and concepto ilike '%manguera%';
```

---

## Cómo mantener este archivo

1. Cuando corras un `.sql`, **muévelo aquí a "Corridos"** con la fecha.
2. Cuando escribas uno nuevo que haya que correr, **anótalo aquí**, no en otro documento.
3. Si dudas de si algo se corrió, **pregúntaselo a la base** con la consulta de la fila. La
   memoria de nadie cuenta como verificación.

> **Lo que este archivo NO puede decirte:** cuál de estos ya está corrido de verdad. Se armó
> leyendo el repositorio, no la base de datos. Las consultas de comprobación son la única
> respuesta fiable, y hay que correrlas.
