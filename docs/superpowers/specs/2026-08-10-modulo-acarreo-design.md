# Módulo de Acarreo / Transporte — Diseño

**Fecha:** 2026-08-10
**Alcance elegido:** Interno + servicio a terceros · construir las 5 fases (todo el módulo).
**Restricciones del proyecto:** español en toda la UI; realtime; A→Z natural con `cmpText`;
desplegar a dev+main y actualizar el manual por fase; **no tocar** la facturación de
combustible ni Control de Pagos (este módulo es independiente).

---

## 1. Objetivo

Gestionar el traslado de maquinaria pesada sobre chutos + bateas/lowboys: desde el registro
de la flota, choferes, equipos y clientes, pasando por la **orden de acarreo** con validaciones
automáticas, la **ejecución del viaje** (check-in/out, estados, incidencias, fotos, firma), el
**control financiero** (costos + tarifario a terceros) y los **PDFs + dashboard/KPIs/alertas**.

Es un módulo **nuevo e independiente**. No se confunde con `transfers` (traslado de combustible
tanque→tanque). Reutiliza `machinery`, `profiles` y el patrón de `edificios`/`module_permissions`.

---

## 2. Modelo de datos (tablas nuevas, prefijo `haul_`)

### Datos maestros
- **`haul_clients`** — clientes/proyectos emisor y receptor.
  `id, name, kind ('interno'|'externo'), tax_id, contact, phone, active, created_at`
- **`haul_locations`** — ubicaciones (obra, almacén, taller, mina, pozo).
  `id, name, type, client_id?(→haul_clients), latitude, longitude, active, created_at`
- **`haul_trucks`** — chutos / camiones de arrastre.
  `id, plate(uniq), brand, model, max_tow_ton, odometer_km, maint_interval_km, status ('operativo'|'taller'|'inactivo'), active, created_at`
- **`haul_trailers`** — bateas / lowboys / remolques.
  `id, plate(uniq), kind ('batea'|'lowboy'|'remolque'), axles, max_load_ton, deck_len_m, deck_width_m, deck_height_m, status, active, created_at`
- **`haul_drivers`** — choferes. Enlazable a un usuario existente.
  `id, user_id?(→profiles), full_name, phone, license_number, license_class, license_expires_at, hazmat_expires_at, availability ('disponible'|'en_ruta'|'reposo'|'suspendido'), active, created_at`
- **`haul_documents`** — documentación genérica con vencimiento (dispara alertas).
  `id, owner_type ('truck'|'trailer'|'driver'), owner_id, doc_type ('permiso_carga_pesada'|'poliza'|'revision_tecnica'|'licencia'|'otro'), number, issued_at, expires_at, file_url, created_at`
- **`machinery` (extensión)** — agregar specs de transporte (columnas nullable, no rompen nada):
  `weight_ton, length_m, width_m, height_m, transport_status ('operativa'|'para_reparacion'|'chatarra')`

### Operación
- **`haul_orders`** — orden de acarreo (cabecera del viaje).
  `id, folio(auto), status (haul_status), client_from_id, client_to_id, origin_location_id, dest_location_id, requested_departure_at, required_arrival_at, truck_id, trailer_id, driver_id, route_km_est, tolls_est, per_diem_advanced, cancel_reason, notes, created_by, created_at, updated_at`
- **`haul_order_items`** — equipos a trasladar (1..n máquinas por orden).
  `id, order_id, machinery_id, weight_ton_snap, horometro_ini, horometro_fin, km_ini, km_fin`
- **`haul_status_events`** — bitácora de la máquina de estados (auditoría).
  `id, order_id, from_status, to_status, at, by, notes`
- **`haul_checks`** — check-in de salida / check-out de recepción.
  `id, order_id, kind ('salida'|'recepcion'), fuel_level, tires_ok, straps_ok, checklist(jsonb), signed_by_name, signature_url, at, by`
- **`haul_photos`** — evidencia fotográfica.
  `id, order_id, check_id?, tag ('antes'|'despues'|'amarre'|'incidencia'), url, at, by`
- **`haul_incidents`** — incidencias en ruta.
  `id, order_id, type ('mecanica'|'clima'|'permiso'|'alcabala'|'otro'), description, photo_url, at, by`

### Financiero
- **`haul_expenses`** — gastos del viaje.
  `id, order_id, kind ('combustible'|'viatico_comida'|'viatico_hospedaje'|'peaje'|'otro'), amount, currency, liters?, receipt_url, note, approved, at, by`
- **`haul_tariffs`** — tarifario (servicio a terceros).
  `id, mode ('km'|'ton'|'hora'|'plana'), unit_price, client_id?, route_from_id?, route_to_id?, active, created_at`
  Valorización = se calcula de la orden × la tarifa aplicable (no se almacena precalculada; se congela al emitir el PDF).

**Enum `haul_status`:** `programado, en_carga, en_transito, en_descarga, completado, cancelado`.

---

## 3. Máquina de estados (acordada con el cliente)

| Estado | Evento detonador | Acciones permitidas | Responsable (rol app) |
|---|---|---|---|
| **Programado** | Creación de la orden | Editar datos, reasignar chofer/unidad | Logística/Despacho → `admin`/`analista` |
| **En Carga** | Llegada de la unidad a origen | Check-in de salida, subir fotos | Chofer/Fiscal origen → `conductor`/`supervisor` |
| **En Tránsito** | Check-in de salida completado | Reportar incidencias, tracking | Chofer → `conductor` |
| **En Descarga** | Llegada a destino | Check-out, verificar horómetro | Chofer/Fiscal destino → `conductor`/`supervisor` |
| **Completado** | Firma digital de recepción | Liquidar viáticos, emitir PDF final | Almacén/Administración → `admin` |
| **Cancelado** | Anulación manual por falla | Reagendar carga | Administración → `admin` |

- Transiciones válidas: `programado→en_carga→en_transito→en_descarga→completado`; `cancelado`
  alcanzable desde cualquier estado no terminal. Cada cambio escribe en `haul_status_events`.
- Gate de acciones por `module_permissions.module = 'acarreo'` (none/lectura/escritura/full) +
  el rol responsable de la fila. (Acceso por-usuario, consistente con el resto del sistema.)

---

## 4. Flujo operativo (pantallas)

Todas bajo `src/screens/acarreo/`, con acceso desde la sección "Más" (módulo `acarreo`).

**A. Despacho (crear/editar orden)** — seleccionar equipos + estatus, origen/destino,
fecha-hora, asignar chuto+remolque+chofer. Al guardar corre **validaciones automáticas**:
1. Peso total de los equipos > `max_load_ton` del remolque (o `max_tow_ton` del chuto) → alerta.
2. Licencia del chofer / documentación del camión vencida (`expires_at < hoy`) → alerta.
3. Chofer o unidad ya asignados a otra orden que solapa la ventana de tiempo → alerta.
Las alertas son **bloqueantes suaves** (avisan y piden confirmación admin para forzar).

**B. Ejecución (detalle del viaje)** — tarjeta de estado con la barra de la máquina de estados;
botón que avanza al siguiente estado según el responsable:
- *En Carga:* checklist (combustible, cauchos, cadenas/fajas), horómetro/km de cada equipo, fotos "antes"/"amarre".
- *En Tránsito:* registrar incidencias (mecánica/clima/permiso/alcabala).
- *En Descarga:* check-out (estado de llegada, horómetro/km final), fotos "después", firma digital del responsable en destino.

**C. Financiero (por orden)** — registrar gastos (combustible con litros → rendimiento km/L
estimado vs real, viáticos con foto de comprobante, peajes), viáticos otorgados vs comprobados,
y —si es a terceros— aplicar tarifa y ver la valorización.

**D. Maestros** — CRUD de flota (chutos/bateas), choferes (con vigencias/disponibilidad),
equipos (specs de transporte sobre `machinery`), clientes y ubicaciones. Buscables A→Z con `cmpText`.

---

## 5. PDFs (reutilizan `src/lib/pdf.ts` + patrón `guideBuilder.ts`)

1. **Guía de Traslado / Orden de Acarreo** — documento para el chofer: datos camión/chofer,
   origen/destino, specs de la maquinaria, ruta autorizada, espacios de firma salida/llegada.
2. **Acta de Recepción e Inspección** — estado físico pre/post con las fotos adjuntas y firmas.
3. **Liquidación de Viaje (interno)** — combustible consumido, viáticos otorgados vs comprobados,
   km recorridos, incidencias.
4. **Consolidado de Acarreos** — filtros por fecha/obra/cliente; resumen del período, tiempos
   promedio y costos.

---

## 6. Dashboard, KPIs y alertas

**KPIs:** total de acarreos del período · tiempo promedio de tránsito por ruta · costo promedio
por tonelada/km · % de cumplimiento a tiempo (On-Time = llegada real ≤ `required_arrival_at`).

**Alertas (derivadas, realtime):**
- Vencimiento de permisos/seguros/licencias (`haul_documents.expires_at`, `haul_drivers.*_expires_at`).
- Mantenimiento preventivo de unidades por km (`haul_trucks.odometer_km` vs `maint_interval_km`).
- Retrasos en ruta (viaje en tránsito que excede el tiempo estimado).

---

## 7. Permisos y navegación

- Nuevo módulo lógico **`acarreo`** en `module_permissions` (none/lectura/escritura/full por usuario).
- Entrada en la navegación ("Más") visible solo con nivel ≥ lectura.
- RLS de las tablas `haul_*`: select a autenticados; escritura a `is_staff()` + chequeo por módulo
  (mismo patrón que `edificios`/`maintenance_requests`).

---

## 8. Plan de implementación (orden de dependencia, aunque se hace "todo de una")

1. **Migración SQL** — enums + todas las tablas `haul_*` + columnas nuevas en `machinery` + RLS +
   índices + triggers de auditoría de estado. Sincronizar `src/types/database.ts`.
2. **Maestros** (Fase 1) — pantallas CRUD flota/choferes/equipos/clientes/ubicaciones + documentos.
3. **Órdenes + validaciones** (Fase 2) — despacho y las 3 validaciones automáticas.
4. **Ejecución** (Fase 3) — estados, check-in/out, fotos, incidencias, firma.
5. **Financiero** (Fase 4) — gastos, viáticos, tarifario, valorización.
6. **PDFs + Dashboard/KPIs/Alertas** (Fase 5).
7. Manual (`ManualScreen.tsx` + `docs/MANUAL-USUARIO.md`) y despliegue dev+main **por fase**.

---

## 9. Decisiones tomadas por defecto (dime si cambio alguna)

- **Choferes = tabla propia `haul_drivers`** (no solo el rol `conductor`), porque el spec pide
  licencias, vigencias y estado de disponibilidad. Se puede enlazar a un usuario `profiles`.
- **Equipos a trasladar = la misma `machinery`** (se le agregan peso/dimensiones), no un catálogo
  aparte, para no duplicar la flota.
- **Ubicaciones = tabla nueva `haul_locations`** (con tipo y coords), más rica que `edificios`.
- **Alertas de validación = bloqueo suave** (avisan; admin puede forzar), no bloqueo duro.
- **Firma digital = imagen de firma** (canvas/base64) subida como las demás fotos.
- **Tarifario** solo se activa para clientes `externo`; lo interno usa solo control de costos.
