# Migrar Requerimiento → Compras — Diseño

**Fecha:** 2026-08-18
**Estado:** Diseño aprobado (pendiente de plan de implementación)
**Módulos afectados:** Inventario, Compras, Cuentas

---

## 1. Objetivo

Sacar el submódulo **Requerimiento** (tabla `inventory_requirements`, correlativo `REQ-####`)
de **Inventario** y llevarlo a **Compras**, conectándolo hacia adelante con **orden de compra**
y **cuenta por pagar**, sin romper la recepción de stock (que sigue cargando a Inventario).

### Alcance confirmado con el usuario
1. **Reubicar el módulo** — la pestaña Requerimiento pasa de Inventario a Compras. **Se retira de Inventario** (sin acceso de solo lectura ahí).
2. **Conectar a cuenta por pagar** — al asignar proveedor se genera la cuenta `por_pagar`.
3. **Migrar datos históricos** — los REQ existentes se operan desde Compras (re-homing, sin copiar filas).
4. **Generar orden de compra** — al aprobar un requerimiento se crea la orden.
5. **Proveedor OPCIONAL** — la orden nace en **BORRADOR**; sin proveedor no hay cuenta por pagar.
6. **Recepción se mantiene en Inventario** — el flujo `recibir()` sigue creando `inventory_movements` (entrada). El **mismo usuario de almacén** recibe.
7. **Se mantiene la estructura de APROBACIÓN** — crear → pendiente → aprobado/rechazado → recibido.

---

## 2. Decisión de arquitectura

**Mantener `inventory_requirements` como la tabla canónica del requerimiento y "re-hogarla" bajo
Compras — NO copiar los datos a `purchase_requests`.**

Razón: `inventory_requirements` ya es la tabla madura y en uso, con correlativo, PDF+firma,
adjunto, notificación y recepción a inventario. `purchase_requests` es un esqueleto con **0 filas**.
Migrar hacia esa tabla sería un *downgrade* (se perdería firma, adjunto, correlativo, recepción).

Por lo tanto **"migrar datos históricos" = re-homing**: los REQ ya existentes se ven/operan desde
Compras sin mover una sola fila. La tabla `purchase_requests` queda deprecada (no se usa).

---

## 3. Flujo unificado

```
Solicitud (Requerimiento REQ-####)  →  pendiente
      │  (admin/gerente aprueba)   ── estructura de aprobación intacta
      ▼
   APROBADO ──► genera ORDEN DE COMPRA en estado BORRADOR (sin proveedor)
      │           │
      │           └─ al ASIGNAR proveedor ──► orden pasa a APROBADA
      │                                        └─► genera CUENTA POR PAGAR (por_pagar, monto items)
      │  (rechazado → revertir → pendiente; sin orden/cuenta)
      ▼
   RECIBIDO ──► carga STOCK en Inventario (inventory_movements entrada)  ← SE MANTIENE igual
```

Estados posibles de la orden: **borrador** (sin proveedor) → **aprobada** (con proveedor).
La cuenta por pagar solo nace cuando hay proveedor.

---

## 4. Cambios de base de datos

Un solo archivo `.sql` idempotente, calcado del patrón de mangueras
(`supabase/fabricacion_mangueras_cuenta_por_pagar.sql`). Se entrega al usuario para el SQL Editor
(el anon key ya no puede escribir tablas operativas por RLS).

### 4.1 Columnas nuevas
- `inventory_requirements.supplier_id uuid references suppliers(id) on delete set null` — proveedor **opcional**.
- `purchase_orders.inventory_requirement_id uuid references inventory_requirements(id) on delete set null` — trazabilidad + idempotencia.
- `cuentas.inventory_requirement_id uuid references inventory_requirements(id) on delete set null` — origen de la deuda.

### 4.2 Índices únicos parciales (idempotencia)
- `create unique index purchase_orders_invreq_uniq on purchase_orders(inventory_requirement_id) where inventory_requirement_id is not null;`
- `create unique index cuentas_invreq_uniq on cuentas(inventory_requirement_id) where inventory_requirement_id is not null;`

### 4.3 Trigger `req_sync_compra()` (AFTER UPDATE OF status, supplier_id — SECURITY DEFINER)
Calcado de `hose_sync_cuenta()`:

- **status → `aprobado`**: `insert ... on conflict (inventory_requirement_id) do update` en `purchase_orders`
  con `estado = 'borrador'`, `total` = suma de items, `supplier_id` = el del requerimiento (puede ser null).
- **`supplier_id` deja de ser null** (con status ya aprobado): la orden pasa a `estado = 'aprobada'`
  y `insert ... on conflict do update` crea/actualiza la `cuenta` `por_pagar`
  (`monto` = total US$, `concepto` = code + title, `estado = 'pendiente'`, `prioridad` heredada).
- **`supplier_id` null**: la orden queda en `borrador`; **no** se crea cuenta.
- **status → `recibido`**: opcional, la cuenta se puede marcar/dejar como está (se mantiene pendiente hasta pagar; no la salda la recepción).
- **status → `rechazado`**: si existe orden en `borrador`/cuenta `pendiente` sin abonos, se anula (`estado='anulada'`); respeta anulaciones/pagos manuales.

Idempotente: correr el trigger dos veces no duplica orden ni cuenta.

---

## 5. Permisos (RLS)

Punto delicado — hoy la RLS de `inventory_requirements` usa `can_write_module('inventario')`
(schema.sql:1292-1299).

- La RLS pasa a aceptar **`compras`** para crear/aprobar/decidir requerimientos.
- **Transición sin cortar acceso:** durante el despliegue la RLS acepta **`compras` OR `inventario`**,
  y se otorga `compras` a quienes hoy administran requerimientos por Inventario
  (script `module_permissions`). Cerrada la transición, se puede dejar solo `compras`.
- **Recepción / almacén:** el usuario que recibe necesita **ambos** — `compras` (para ver/operar la
  pestaña ahora en Compras) e **`inventario`** (para escribir `inventory_items`/`inventory_movements`
  en `recibir()`). Se le otorga `compras` explícitamente.
- La tabla `cuentas` conserva su propio candado `cuentas_nivel()` (módulo `cuentas`). El trigger corre
  como `SECURITY DEFINER`, así que crea la cuenta aunque el usuario no tenga permiso directo a `cuentas`.

---

## 6. Cambios de UI

- **Extraer** `RequerimientoTab` de `InventarioScreen.tsx:1456` (~400 líneas) a su propio archivo
  (`src/screens/tabs/RequerimientoTab.tsx`) para montarla sin duplicar.
- **Montar** la pestaña en `ComprasScreen.tsx` (junto a Solicitudes / Órdenes / Proveedores / Cuentas / Resumen),
  gateada por `moduleLevel('compras')`.
- **Quitar** la pestaña y su entrada del hub de Inventario (`InventarioScreen.tsx` hub ~:3133/3155) — sin dejar acceso.
- **Agregar** el desplegable de **Proveedor (opcional)** con "➕ Agregar" (patrón `suppliers` / EdificioPicker).
- **Mostrar** desde el REQ aprobado la **orden** (estado borrador/aprobada) y la **cuenta** generada (link/badge).
- Navegación: el permiso de entrada al módulo Requerimiento pasa de `inventario` a `compras`
  (`src/navigation/index.tsx`).

---

## 7. Datos históricos (re-homing)

- Con la arquitectura elegida, **no hay copia física**: los REQ existentes se ven desde Compras al montar la pestaña.
- Backfill **opcional** para conectar retroactivamente órdenes/cuentas: correr `req_sync_compra()` en bloque
  **solo** sobre REQ `aprobado`/`recibido` que ya tengan `supplier_id` (para no crear deuda sin proveedor).
- `purchase_requests` queda deprecada (0 filas, sin migración).

---

## 8. Manual y tests

- **Manual:** mover el bloque Requerimiento de "4.8d Inventario"
  (`docs/MANUAL-USUARIO.md:1498-1539`, `ManualScreen.tsx:509-520`) a la sección de Compras;
  documentar "aprobado → orden borrador → asignar proveedor → cuenta por pagar" y que la recepción sigue en almacén.
- **Tests** (transpile-in-memory, patrón del repo):
  - Aprobar REQ **sin** proveedor → orden `borrador`, **sin** cuenta.
  - Asignar proveedor → orden `aprobada` + 1 cuenta `por_pagar` por el monto de items.
  - Idempotencia: aprobar/sincronizar dos veces = 1 sola orden y 1 sola cuenta.
  - Recepción sigue cargando stock (`inventory_movements` entrada) sin cambios.

---

## 9. Fases de implementación

1. **BD** — columnas, índices únicos, trigger `req_sync_compra()`; entregar SQL al usuario.
2. **Permisos** — RLS `compras OR inventario` transitoria + otorgar `compras` a almacén.
3. **UI** — extraer `RequerimientoTab`, montar en Compras, quitar de Inventario, agregar proveedor opcional.
4. **Conexión visible** — badges/links de orden y cuenta desde el REQ.
5. **Manual + tests**.
6. **Backfill opcional** de históricos con proveedor.
7. **Deploy** — dev + main (main dispara el robot → soslaguaira.com).

---

## 10. Riesgos y rollback

- **Permisos (Fase 2)** es lo más riesgoso: mal hecho deja gente sin crear/recibir. Mitigación:
  RLS transitoria `compras OR inventario` + otorgar permisos **antes** de cerrar.
- **Recepción cruzada:** el usuario de almacén necesita `inventario` además de `compras`; si solo tiene
  `compras`, `recibir()` falla al escribir stock. Se documenta y se otorga explícitamente.
- **Idempotencia:** los índices únicos parciales evitan órdenes/cuentas duplicadas (igual que mangueras).
- **Rollback:** `alter add column`, índices y triggers son reversibles (drop); la UI se revierte con git.
  Los datos no se destruyen (no se copian ni borran filas).

---

## 11. Preguntas cerradas

- Recepción → el mismo usuario de almacén, con permiso a `compras` (y conserva `inventario`).
- Orden sin proveedor → queda **borrador** hasta asignar proveedor.
- Inventario → **se retira** el submódulo (sin acceso de solo lectura).
- Aprobación → **se mantiene** la estructura actual.
