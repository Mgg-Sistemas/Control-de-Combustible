# Plan de expansión — Control de Combustible → ERP operativo

> Documento de planificación. Fecha base: **2026-07-11**.
> Objetivo: llevar el sistema a producción **por fases cortas**, cada una entregable e
> independiente, sumando: **fichas de empleados/operadores, nómina, compras con
> aprobación, inventario por almacenes, gastos por maquinaria y rentabilidad**.
> Principio rector: **uso extremadamente simple, apariencia profesional.** La vista de
> operador se mantiene mínima; el resto del sistema es para administración/oficina.

---

## 0. Qué ya está hecho (base sobre la que construimos)

| Área | Estado | Reutilizable para |
|------|--------|-------------------|
| Auth, roles (admin/supervisor/operador/conductor), permisos por módulo | ✅ | Todos los módulos nuevos |
| Empresas (`companies`) | ✅ | Almacenes, nómina, gastos por empresa |
| Combustible: tanques, ingresos, consumos, traslados, niveles derivados | ✅ | Gastos de combustible por máquina |
| **Autorizaciones con flujo aprobar/rechazar** | ✅ | **Base del flujo de compras** |
| Equipos/Maquinaria (3 estados, GPS, foto, precio/jornada) | ✅ | Gastos y rentabilidad por equipo |
| Control de Maquinaria (rondas, cierres, "En espera") | ✅ | Ingreso generado por día/equipo |
| Control de Pagos (tabulador, cierres, `company_payments`) | ✅ | Ingresos para rentabilidad |
| Mantenimiento (`maintenance_requests`) | ✅ | Gastos por maquinaria |
| Margen de ganancia (costo inicial vs valor útil) | 🟡 parcial | Rentabilidad |
| Nómina (`payrolls`: solo empresa + monto) | 🟡 stub | Se reconstruye en Fase 2 |
| Operadores, Mapa, Reportes PDF, Usuarios | ✅ | — |

---

## 1. Módulos faltantes (evaluación completa)

1. **Recursos Humanos (fichas):** empleados y operadores con datos personales, foto,
   cédula, cargo, empresa, fecha de ingreso, salario base y **carnet con QR** para
   entrar a la empresa (control de acceso).
2. **Nómina real:** períodos de pago, conceptos (sueldo, bonos, horas extra,
   deducciones), cálculo, recibo por empleado, historial, **reportes y filtros**.
3. **Compras:** proveedores + **solicitud de pedido → orden de compra → aprobación**
   (multinivel) → recepción.
4. **Inventario / Almacenes por empresa:** artículos, existencias por almacén,
   entradas (desde compras) y salidas (a maquinaria/consumo), cada almacén asignado a
   una empresa.
5. **Gastos por maquinaria:** consolida mantenimiento + repuestos (inventario) +
   combustible + mano de obra → **costo por equipo**.
6. **Rentabilidad:** cuánto **genera por día** cada equipo/empresa, gastos totales y
   **ganancia neta** (ingresos − gastos). Panel financiero con filtros por rango de
   fecha y empresa.
7. **Panel / Dashboard ejecutivo:** KPIs simples y claros en la pantalla de inicio.

---

## 2. Estrategia de fases (cortas, a producción cada una)

Sprints de **~2 semanas**, cada uno cierra con **despliegue a producción** (Vercel desde
`main`). Se prioriza por **dependencia** y por **valor rápido**. Arranque: **2026-07-14**.

| Fase | Nombre | Fechas | Resultado en producción |
|------|--------|--------|--------------------------|
| **F1** | Empleados y Fichas (RRHH) + Carnet QR | **2026-07-14 → 2026-07-25** | Registrar personal y emitir su carnet |
| **F2** | Nómina | **2026-07-28 → 2026-08-08** | Pagar y emitir recibos con reportes |
| **F3** | Compras (solicitud → orden → aprobación) | **2026-08-11 → 2026-08-22** | Pedir y aprobar compras |
| **F4** | Inventario y Almacenes por empresa | **2026-08-25 → 2026-09-05** | Controlar existencias por almacén |
| **F5** | Gastos por maquinaria | **2026-09-08 → 2026-09-19** | Ver el costo de cada equipo |
| **F6** | Rentabilidad y Panel ejecutivo | **2026-09-22 → 2026-10-03** | Ver ingresos, gastos y ganancia |
| **F7** | Pulido UX + Manual + capacitación | **2026-10-06 → 2026-10-17** | Sistema simple, profesional, documentado |

> **Regla de oro por fase:** cada módulo nuevo empieza **oculto tras permisos**
> (`module_permissions`), se prueba con datos reales de una empresa y luego se abre al
> resto. Nada rompe lo que ya funciona.

---

## 3. Detalle por fase

### F1 — Empleados y Fichas (RRHH) · 2026-07-14 → 2026-07-25
**Objetivo:** tener el registro central de personas; base de nómina y de acceso.

**Base de datos (nuevas tablas)**
- `employees` — `id, company_id, first_name, last_name, cedula (único), cargo,
  department, phone, address, birth_date, hire_date, base_salary, salary_currency,
  photo_url, status ('activo'|'inactivo'|'suspendido'), operator_profile_id (enlaza con
  operador existente si aplica), created_at`.
- `employee_access_cards` — `id, employee_id, code (QR único), issued_at, valid_until,
  active`. (Carnet para entrar a la empresa.)
- *(Opcional)* `access_logs` — `id, card_code, employee_id, kind ('entrada'|'salida'),
  at, gate` para registrar entradas/salidas al escanear el carnet.

**Pantallas**
- **Empleados** (lista por empresa, buscador, filtros por cargo/estado) con ficha
  completa y foto.
- **Ficha del empleado** (ver/editar) + botón **"Emitir carnet"** que genera el QR y una
  vista imprimible tamaño tarjeta.
- Reutilizar el escáner QR existente (`ScanQrScreen`) para leer carnets → registrar
  entrada/salida (si se activa `access_logs`).

**Criterio de aceptación**
- Se puede crear un empleado, subirle foto, asignarle empresa y cargo.
- Se emite un carnet con QR único e imprimible.
- Al escanear el carnet, el sistema identifica a la persona.

---

### F2 — Nómina · 2026-07-28 → 2026-08-08
**Objetivo:** calcular y pagar la nómina sobre los empleados de F1, con recibos y reportes.

**Base de datos**
- Reemplazar el stub `payrolls` por: `payroll_periods` — `id, company_id, name,
  period_start, period_end, status ('borrador'|'aprobada'|'pagada'), created_by, created_at`.
- `payroll_items` — `id, period_id, employee_id, base_amount, extras (jsonb: bonos/horas
  extra), deductions (jsonb), net_amount, note`.
- Conceptos configurables: `payroll_concepts` — `id, company_id, name, kind
  ('asignacion'|'deduccion'), calc ('fijo'|'porcentaje'|'por_hora'), value`.

**Pantallas**
- **Nómina** → crear período (empresa + rango de fechas) → el sistema **precarga** a los
  empleados activos con su salario base → editar conceptos por empleado → **totales en
  vivo** → aprobar → marcar pagada.
- **Recibo de pago** (PDF) por empleado.
- **Reportes de nómina** con **filtros** (empresa, período, cargo) + exportar PDF.
- Enlace opcional con Operadores: sumar jornadas del Control de Maquinaria como horas.

**Criterio de aceptación**
- Un período precarga empleados y calcula neto = asignaciones − deducciones.
- Se emite recibo por empleado y un reporte del período con filtros.

---

### F3 — Compras: solicitud → orden → aprobación · 2026-08-11 → 2026-08-22
**Objetivo:** formalizar el proceso de compra con aprobaciones (reusa el patrón de
Autorizaciones ya existente).

**Base de datos**
- `suppliers` — `id, name, rif, phone, email, address, active`.
- `purchase_requests` (solicitud de pedido) — `id, company_id, requested_by, needed_for
  (maquinaria/almacén), status ('solicitada'|'aprobada'|'rechazada'|'ordenada'),
  note, created_at`.
- `purchase_request_items` — `id, request_id, description, qty, unit, estimated_price`.
- `purchase_orders` (orden de compra) — `id, request_id, supplier_id, company_id,
  status ('borrador'|'enviada'|'aprobada'|'recibida'|'anulada'), total, approved_by,
  approved_at, created_at`.
- `purchase_order_items` — `id, order_id, description, qty, unit, unit_price, item_id
  (enlace opcional a inventario)`.
- `purchase_approvals` — `id, order_id, level, approver_id, decision, at, comment`.

**Pantallas**
- **Solicitudes de pedido** (crear, listar por estado).
- **Órdenes de compra** (generar desde una solicitud aprobada, elegir proveedor,
  precios).
- **Bandeja de aprobación** (aprobar/rechazar por nivel, con comentario) — misma UX que
  Autorizaciones.

**Criterio de aceptación**
- Flujo completo: solicitud → aprobación → orden → aprobación de orden.
- Cada paso deja traza de quién y cuándo.

---

### F4 — Inventario y Almacenes por empresa · 2026-08-25 → 2026-09-05
**Objetivo:** controlar existencias, con almacenes separados por empresa, alimentados por
las compras de F3.

**Base de datos**
- `warehouses` — `id, company_id, name, location, active`.
- `inventory_items` — `id, company_id, sku, name, category, unit, min_stock, photo_url`.
- `inventory_stock` — `id, warehouse_id, item_id, qty` (existencia actual, derivada).
- `inventory_movements` — `id, warehouse_id, item_id, kind ('entrada'|'salida'|'ajuste'|
  'traslado'), qty, ref_type ('compra'|'maquinaria'|'manual'), ref_id, at, by`.
  (Existencia = suma de movimientos, igual patrón que los tanques de combustible.)

**Pantallas**
- **Almacenes** (por empresa) y **Artículos** (catálogo con foto, mínimo de stock).
- **Existencias** por almacén con **alerta de stock bajo**.
- **Entrada** automática al **recibir una orden de compra** (F3).
- **Salida** hacia una máquina (vincula con Gastos por maquinaria, F5).

**Criterio de aceptación**
- Recibir una orden de compra suma stock en el almacén correcto.
- Sacar un repuesto para una máquina descuenta stock y queda registrado.
- Cada empresa ve solo sus almacenes.

---

### F5 — Gastos por maquinaria · 2026-09-08 → 2026-09-19
**Objetivo:** consolidar todo lo que **cuesta** cada equipo.

**Base de datos**
- `machine_expenses` — `id, machinery_id, company_id, date, kind ('mantenimiento'|
  'repuesto'|'combustible'|'mano_obra'|'otro'), amount, source_type, source_id, note`.
  Se alimenta de: `maintenance_requests`, salidas de inventario (F4), consumos de
  combustible (dispatches) y nómina de operadores (F2).

**Pantallas**
- **Gastos por máquina** (lista con total por equipo y por tipo de gasto).
- Filtros por empresa, equipo, tipo y **rango de fechas**.
- Registro manual de gastos que no vengan de otro módulo.

**Criterio de aceptación**
- Cada máquina muestra su gasto total del período, desglosado por tipo.
- Los gastos se toman automáticamente de mantenimiento, inventario y combustible.

---

### F6 — Rentabilidad y Panel ejecutivo · 2026-09-22 → 2026-10-03
**Objetivo:** responder "¿cuánto genero, cuánto gasto, cuánto gano?" por día, equipo y
empresa.

**Cálculos (sin tablas nuevas; vistas/consultas)**
- **Genera por día** = jornadas trabajadas × precio/jornada (del Control de Maquinaria).
- **Gasta** = suma de `machine_expenses` (F5) + nómina asignable + otros.
- **Ganancia neta** = genera − gasta. Margen % = ganancia ÷ genera.

**Pantallas**
- **Panel ejecutivo** (pantalla de inicio) con KPIs grandes y claros: ingreso del
  período, gasto, ganancia, top equipos por ganancia y por gasto.
- **Rentabilidad** con filtros por empresa/equipo/rango y **exportación a PDF**.
- Integrar el Margen de ganancia existente.

**Criterio de aceptación**
- Para un rango de fechas y empresa: se ve ingreso, gasto y ganancia neta.
- Se puede ver la rentabilidad por equipo (cuál gana y cuál pierde).

---

### F7 — Pulido UX + Manual + capacitación · 2026-10-06 → 2026-10-17
**Objetivo:** que todo se sienta **simple y profesional** y que cualquiera lo pueda usar.

- Revisión visual transversal: mismos botones, mismos colores, textos en lenguaje simple.
- **Menú de inicio por rol**: cada quien ve solo lo suyo, con íconos grandes.
- **Manual de usuario** (ver `MANUAL-USUARIO.md`) actualizado con los módulos nuevos.
- Capacitación corta (guías de 1 página por tarea) + videos opcionales.
- QA, permisos por módulo revisados, respaldo y verificación en producción.

---

## 4. Principios de diseño (para todas las fases)

- **Una pantalla, una tarea.** Nada de formularios enormes: pasos cortos.
- **Botones grandes y con ícono + texto.** Verde = hacer/confirmar, rojo = detener.
- **Lenguaje humano.** "Guardar", "Recibir", "Pagar" — nunca términos técnicos.
- **Todo filtrable por empresa y por rango de fecha** (como ya se hace en Pagos/Control).
- **Confirmar antes de acciones importantes** (pagar, aprobar, anular).
- **Permisos primero:** cada módulo respeta la matriz `module_permissions`.
- **La vista de operador se mantiene mínima**: solo lo que necesita en campo.

---

## 5. Riesgos y mitigaciones (de esta expansión)

| Riesgo | Mitigación |
|--------|-----------|
| Crecer el alcance y no llegar a producción | Fases de 2 semanas, cada una se despliega sola |
| Datos sensibles de personal (nómina/cédulas) | Permisos estrictos + RLS por empresa/rol |
| Doble captura (compra ↔ inventario ↔ gasto) | Encadenar automáticamente los módulos |
| Complejidad para el usuario final | Reglas del punto 4 + manual + capacitación |

> Documento vivo: se ajusta al cierre de cada fase.
