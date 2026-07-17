# Control de pago a personal — diseño

Fecha: 2026-07-17
Módulo dentro de **Nómina**. UI y textos en español.

## 1. Propósito

Calcular y registrar el pago al personal a partir de las jornadas trabajadas,
derivando las tarifas del **sueldo base** del empleado. Cubre operadores
(jornadas automáticas desde el escaneo de QR) y el resto del personal (carga
manual). Permite bonos, deducciones, validación por supervisor, y registro de
pagos por abonos con saldo pendiente.

## 2. Ubicación y acceso

- Nueva tarjeta en `NominaScreen`: **"💵 Control de pago a personal"** → navega a
  una pantalla nueva `PagoPersonalScreen`.
- Se agrupa por **empresa** (mismo patrón que Nómina y Control de pagos).
- Roles: admin y supervisor pueden calcular/registrar pagos; analista puede
  cargar/editar jornadas manuales pero **no** modificar tarifas ni divisores
  (coherente con la regla ya aplicada en Control de maquinaria).

## 3. Cálculo (núcleo)

Punto de partida: `base_salary` (sueldo base mensual) de la ficha del empleado.

Divisores **globales ajustables** (guardados en config, editables solo por
admin/supervisor):
- `dias_mes` (default **30**) → `tarifa_dia = base_salary / dias_mes`
- `horas_mes` (default **240**) → `tarifa_hora = base_salary / horas_mes`

Por persona/período:
- **Modo** (toggle): **Días trabajados** o **Horas trabajadas**.
- **Devengado**:
  - Modo días: `dias_trabajados × tarifa_dia`
  - Modo horas: `horas_trabajadas × tarifa_hora`
- **+ Bonos** (líneas concepto/monto)
- **− Deducciones** (líneas concepto/monto: adelantos, préstamos, etc.)
- **= Total a pagar** = `devengado + Σbonos − Σdeducciones`

## 4. Período

Toggle de período con rango de fechas derivado:
- **Día**: una fecha.
- **Semana**: domingo → sábado.
- **Quincena**: 1–15 / 16–fin de mes.

El rango determina qué jornadas se agregan (por `work_date`).

## 5. Origen de días/horas

- **Operadores — automático**: se agregan desde `operator_assignments` cruzando
  por **cédula** dentro del rango del período. Días = nº de jornadas; horas =
  Σ `worked_hours`.
- **Resto del personal — manual**: botón **"+ Agregar persona"** para capturar
  días/horas a mano.
- **Sobreescritura**: lo automático se puede editar a mano si hace falta (queda
  marcado como ajustado).

## 6. Validación del supervisor (interruptor)

Interruptor **"Solo jornadas validadas por el supervisor"**:
- **Activado**: al agregar jornadas automáticas de operadores, solo cuentan las
  jornadas que tienen check-in de supervisor (GPS) asociado. Las no validadas se
  listan aparte como "pendientes de validación" y no suman.
- **Desactivado**: cuentan todas las jornadas registradas.

Nota: el enganche fino a la tabla de check-ins del supervisor se define en el
plan de implementación (ver [[supervision-valida-jornada]]); si aún no existe el
vínculo dato-a-dato, el interruptor arranca desactivado por defecto.

## 7. Bonos y deducciones

Por persona, dos grupos de líneas editables (patrón `LineEditor` ya usado en
Nómina):
- **Bonos**: concepto + monto (ej. "Bono producción", "Bono asistencia").
- **Deducciones**: concepto + monto (ej. "Adelanto", "Préstamo", "Uniforme").

## 8. Registro del pago (abonos)

Igual que Control de pagos (`company_payments`):
- **Abonos** parciales o totales, cada uno con **fecha** y **método** (efectivo,
  pago móvil, transferencia, otro).
- Muestra **Pagado** (Σ abonos) y **Saldo pendiente** = `total_a_pagar − pagado`.
- Estado derivado: pendiente / parcial / pagado.

## 9. Reportes (PDF)

- **Recibo por persona**: devengado, bonos, deducciones, total, abonos, saldo.
- **Reporte del período**: todas las personas de la empresa, con total a pagar y
  saldo por persona y totales generales.

## 10. Datos nuevos (Supabase)

Se prepara el SQL para `supabase/schema.sql` y se sincroniza
`src/types/database.ts`.

### 10.1 `staff_pay_config` (config global de divisores)
- `id` (pk, single row / por empresa si aplica)
- `dias_mes int default 30`
- `horas_mes int default 240`
- `updated_at`

### 10.2 `staff_pay_periods` (período de pago)
- `id uuid pk`
- `company` (empresa)
- `period_type` (`dia` | `semana` | `quincena`)
- `date_from date`, `date_to date`
- `mode` (`dias` | `horas`)
- `only_validated boolean default false`
- `status` (`borrador` | `aprobada` | `pagada`)
- `created_at`

### 10.3 `staff_pay_items` (línea por persona en el período)
- `id uuid pk`
- `period_id uuid fk → staff_pay_periods`
- `employee_id` / `cedula` (identifica la persona; operador o manual)
- `source` (`auto` | `manual`)
- `dias numeric`, `horas numeric`
- `overridden boolean default false`
- `tarifa_dia numeric`, `tarifa_hora numeric` (snapshot al calcular)
- `devengado numeric`
- `bonos jsonb` (array {concepto, monto})
- `deducciones jsonb` (array {concepto, monto})
- `total numeric`
- `nota text`

### 10.4 `staff_pay_payments` (abonos)
- `id uuid pk`
- `item_id uuid fk → staff_pay_items`
- `monto numeric`
- `metodo text`
- `fecha date`
- `created_at`

RLS: lectura para roles internos; escritura de tarifas/divisores bloqueada para
analista (trigger similar a `machinery_guard_anon`).

## 11. Flujo de la pantalla

1. Elegir empresa → crear/abrir período (tipo, rango, modo, interruptor validación).
2. Precargar operadores (auto) + agregar personas manuales.
3. Revisar días/horas (ajustar si hace falta) → se calcula devengado.
4. Cargar bonos/deducciones por persona.
5. Ver total a pagar por persona y total general.
6. Registrar abonos → ver saldo.
7. Exportar recibo/reporte PDF.

## 12. Fuera de alcance (YAGNI, por ahora)

- Cálculo de impuestos/retenciones legales (no solicitado).
- Integración contable externa.
- Histórico de cambios de tarifa auditado (se guarda snapshot en el item, basta).

## Referencias

- [[supervision-valida-jornada]] — el check-in del supervisor valida la jornada.
- [[subir-ambas-ramas]] — deploy a dev y main.
- [[actualizar-manual-siempre]] — actualizar manual tras el cambio.
