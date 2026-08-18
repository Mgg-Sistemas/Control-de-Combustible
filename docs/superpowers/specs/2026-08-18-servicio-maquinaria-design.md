# Servicio de Maquinaria — registro de reparaciones y ficha técnica

**Fecha:** 18 de agosto de 2026
**Estado:** diseño aprobado, pendiente de plan de implementación

---

## 1. Qué se pide y por qué

El encargado del taller necesita **dejar constancia de lo que se le hizo a cada máquina**, y poder sacarlo después en PDF: para una máquina completa, o para un rango de fechas.

Textual del cliente:

> «En el módulo servicio de maquinaria no vamos a llevar pagos ni nada, el que maneja eso lo va a llevar como una solicitud de servicio, él quiere llevar más que todo un registro de lo que se hizo, que cuando necesite los reportes o arreglos en un tiempo lo pueda sacar en un reporte, que cuando necesite las reparaciones para una máquina completa o en un rango en específico, le salga un PDF, con la primera página con la imagen y placa de la maquinaria, la información del equipo, y en la segunda página que salgan todas las reparaciones del vehículo. Lleva servicios externos e internos también: los internos vienen siendo los que se hicieron con el equipo de la empresa, y los de servicio externo que es con una persona o personas externas.»

El formato de referencia es el documento **«Ficha técnica Jumbo con martillo 0488»** (Golden Touch 1127 C.A.), que trae dos hojas:

1. **Ficha técnica de maquinaria** — tipo de equipo, marca, serial, y un bloque de lubricación (tipo de aceite del motor, cantidad requerida).
2. **Reporte de mantenimiento / reparación** — datos generales, tipo de intervención, descripción del problema, acciones realizadas, repuestos utilizados, y dos firmas.

**No hay dinero en este módulo.** Ni costos, ni autorizaciones de pago, ni estados de aprobación. Eso lo lleva otra persona por fuera. Si alguna vez alguien propone «ya que estamos, agreguemos el costo», la respuesta es no: fue una decisión explícita.

### La restricción de fondo

El cliente lo dijo así:

> «El módulo de servicio de maquinaria y mantenimiento de maquinaria no van a interactuar directamente con las máquinas, solo recibirán los reportes de las máquinas […] no que cuando marque hecho la máquina se va a colocar activa, ya que la idea es evitar que la acumulación de respuestas o reportes pendientes afecten el estado de la maquinaria.»

Y al proponerle desacoplar:

> «¿Y si desvinculamos esos dos módulos de los demás, para que no afecte a lo demás, y se guarda un registro de todo sin que afecte? Que esos dos módulos sean semi independientes: llegan los avisos de mantenimiento y todo, pero que a la vez si los marco como realizado o hago algo, no le afecte a las maquinarias o vehículos.»

Eso convierte el trabajo en dos cosas: **el registro nuevo** y **el desacople de los dos módulos del taller**.

---

## 2. Estado actual (verificado el 18-ago-2026)

### El módulo ya existe

`ServicioMaquinariaScreen.tsx` es un envoltorio de 20 líneas sobre `TallerMaquinariaScreen` con `seccion="servicio"`. La misma pantalla de 1.697 líneas sirve a Mantenimiento y a Servicio; la frontera es `machinery_repairs.tipo`: `'preventivo'` es de Mantenimiento, `'correctivo'` es de Servicio.

Pestañas de Servicio hoy: `⏳ Averías` · `✓ Historial` · `📊 Reporte`.
Servicio **no manda máquinas al taller** — ese circuito se retiró a pedido del cliente y vive solo en Mantenimiento.

### Lo que guarda hoy `machinery_repairs`

```
id · machinery_id · tipo · out_at · estimated_days · estimated_note
work_done · back_at · status · created_by · closed_by · created_at
```

No tiene repuestos, ni interno/externo, ni tipo de intervención, ni descripción del problema separada de las acciones, ni fotos, ni técnico.

### Lo que la máquina ya trae para la ficha

`photo_url`, `photo_serial_url`, `plate`, `serial`, `identifier`, `marca`, `modelo`, `tipo`, `clasificacion`, `company_id`, `last_horometro`, `horometro_base`.

**Falta** el bloque de lubricación del documento: tipo de aceite del motor y cantidad requerida.

### Los tres cables que salen del taller hacia el resto

| Escritura | Dónde | Efecto afuera |
|---|---|---|
| `machinery.operational = false` | `MantenimientoMaquinariaScreen.tsx:585` | La máquina cambia de estado en todo el sistema |
| `machinery.operational = true, en_espera = false` | `MantenimientoMaquinariaScreen.tsx:629` | Ídem |
| `maintenance_requests.status = 'realizado'` | líneas 427, 428, 440, 630, 631 | La avería desaparece de Control, Equipos, Supervisión y los PDF del inspector |
| `machinery.horometro_base = last_horometro` | línea 402 | Reinicia las horas acumuladas en `machineHoursReport.ts:72` y en Supervisión |

### Por qué el estado de una máquina depende de los reportes pendientes

El estado «averiada» / «parada» **no es un campo guardado**: se calcula preguntando si la máquina tiene `maintenance_requests` pendientes. Textual en `EquiposScreen.tsx:985`:

```
// averiada/parada (según maintenance_requests, no un campo fijo) > operativa.
```

De ahí comen doce lugares: `machineLiveStatus.ts`, `controlEstado.ts`, `ControlMaquinariaScreen`, `EquiposScreen`, `SupervisionScreen`, `CoordinadorOperadoresScreen`, `InspectionsSummary`, `HistoricoJornadasScreen`, `ReportsScreen`, `inspectorReport.ts`, `inspectorSummaryReport.ts` y `CoordinadorQrPanel`.

**Ese cálculo NO se toca en este trabajo.** Se evaluó y se descartó: cambiarlo alteraría cómo se ve el estado de todas las máquinas en todos los reportes, justo después de los cuadres de nómina. Si algún día se quiere, es un proyecto aparte con su propio respaldo.

### Quién más cierra averías

Verificado: el taller **no es el único**. También las cierran `CoordinadorQrPanel.tsx:109` (coordinador reactivando por QR), `SupervisorScreen.tsx:2131/2135` (supervisor desde el teléfono), `offlineQueue.ts:235/238` (cola offline) y `EquiposScreen.tsx:638`.

Por eso quitarle la escritura al taller **no deja averías huérfanas**: se siguen cerrando por donde de verdad se ve la máquina, que es en campo.

---

## 3. La frontera

**Regla:** los módulos de Servicio y Mantenimiento **leen todo, escriben solo en lo suyo.**

### Entra (lectura, sin cambios)

- `maintenance_requests` — los avisos de avería siguen llegando
- `machinery` — datos de la máquina para mostrar e imprimir
- `machine_rounds` / `last_horometro` — para el preventivo por horómetro

### Sale (se corta)

- ❌ `machinery.operational` — se eliminan las escrituras de las líneas 585 y 629
- ❌ `maintenance_requests.status` — se eliminan las escrituras de las líneas 427, 428, 440, 630, 631

### La excepción, decidida por el cliente

- ✅ **`machinery.horometro_base` y `horometro_maint_pending` se quedan.** «Lo de los horómetros que sí funcione.» Confirmar un mantenimiento sigue reiniciando el contador de horas acumuladas de esa máquina. Es la lógica del ciclo de mantenimiento y es deliberada.

Queda escrita como excepción a propósito: es el único punto donde el taller sigue escribiendo fuera de su territorio.

### Escribe (lo suyo)

- `machinery_service_orders` (nueva)
- `machinery_service_parts` (nueva)
- `machinery_repairs` (existente, sin modificar su esquema)

### Consecuencia operativa

Dos cosas dejan de pasar solas, y la gente lo va a notar:

| Antes | Después |
|---|---|
| Mandar al taller ponía la máquina **No operativa** | La máquina no cambia. La saca de operación **Control de Maquinaria** |
| Registrar el retorno la ponía **Operativa** y cerraba sus averías | La máquina no cambia. La reactiva **el coordinador por QR** o **Control de Maquinaria** |

Va al manual con esas palabras.

### Vehículos

Hoy **no existe** taller de vehículos: `vehicles` solo se usa en Autorizaciones y Despachos. Este módulo es de maquinaria. Extenderlo a vehículos es trabajo aparte.

---

## 4. Datos

Todo es **aditivo**. Ninguna tabla existente cambia de esquema; ningún registro existente se modifica.

### 4.1 `machinery_service_orders` (nueva)

Un renglón por trabajo hecho.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `machinery_id` | uuid NOT NULL → `machinery(id)` on delete cascade | |
| `maintenance_request_id` | uuid NULL → `maintenance_requests(id)` on delete set null | **El enlace opcional a la avería que atiende.** Es lo único que une el módulo con los avisos, y es de solo lectura hacia afuera: apuntar a una avería NO la modifica. |
| `service_date` | date NOT NULL default current_date | «1. Fecha» |
| `origen` | text NOT NULL default `'interno'` check in (`'interno'`,`'externo'`) | Interno = equipo de la empresa. Externo = persona o taller de afuera. |
| `technician` | text | «Operador / Técnico». Obligatorio si `origen = 'interno'` (validado en la app). |
| `provider` | text | Nombre de la persona o taller externo. Obligatorio si `origen = 'externo'`. |
| `intervenciones` | text[] NOT NULL default `'{}'` | «2. Tipo de intervención». Valores: `mecanica`, `electricidad`, `mangueras`, `servicio`. Es arreglo porque un mismo trabajo puede ser mecánico e hidráulico a la vez. |
| `problem` | text | «3. Descripción del problema» |
| `work_done` | text | «4. Acciones realizadas» |
| `photos` | text[] NOT NULL default `'{}'` | «Foto referencia (opcional)». Mismo mecanismo que las averías (`captureAndUploadPhoto`). |
| `notes` | text | Libre |
| `created_by` | uuid → `profiles(id)` on delete set null | |
| `created_at` | timestamptz NOT NULL default now() | |

Índices: `machinery_id`, `service_date`, `maintenance_request_id`.

### 4.2 `machinery_service_parts` (nueva)

«5. Repuestos utilizados» — un renglón por repuesto.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `service_order_id` | uuid NOT NULL → `machinery_service_orders(id)` **on delete cascade** | Borrar el servicio se lleva sus repuestos. |
| `quantity` | numeric(12,2) | «Cantidad» |
| `description` | text NOT NULL | «Descripción del repuesto / insumo» |
| `estado` | text | «Estado». Lista sugerida: `nuevo`, `usado`, `reparado`, `reacondicionado`. **Sin `check`**, para que el cliente pueda escribir otro sin migración. |
| `position` | int NOT NULL default 0 | Conserva el orden en que se cargaron los renglones. |

Índice: `service_order_id`.

### 4.3 Columnas nuevas en `machinery`

Para el bloque de lubricación de la ficha:

- `oil_type` text — tipo de aceite recomendado (motor)
- `oil_capacity_l` numeric(10,2) — cantidad requerida, en litros
- `oil_notes` text — nota libre (por si la cantidad no se expresa en litros)

Se editan desde Control de Maquinaria, donde ya se editan `marca` y `modelo`.

### 4.4 RLS y realtime

Mismo patrón que `machine_services.sql`, verbatim:

```sql
alter table public.<t> enable row level security;
create policy <t>_select on public.<t> for select to authenticated using (true);
create policy <t>_write  on public.<t> for all    to authenticated
  using (public.is_staff()) with check (public.is_staff());
```

Más el bloque `do $$ ... alter publication supabase_realtime add table ...` para que las pantallas se refresquen solas.

### 4.5 El SQL

Archivo: `supabase/servicio_maquinaria.sql`.

**Puramente aditivo:** `create table if not exists`, `alter table ... add column if not exists`, `create index if not exists`, políticas y publicación. **Ni un `update`, ni un `delete`, ni un `alter` sobre columnas con datos.**

Se corre a mano (regla de oro del proyecto: editar el `.sql` no lo aplica) con un bloque final de comprobación que cuenta las tablas y columnas creadas. Con respaldo previo, aunque no toque nada existente.

---

## 5. Interfaz

### 5.1 Pestaña nueva

Servicio pasa a tener cuatro pestañas:

```
⏳ Averías (N)   🧾 Servicios   ✓ Historial   📊 Reporte
```

Mantenimiento no gana pestaña: su registro sigue siendo el expediente de taller que ya tiene.

### 5.2 El formulario

```
🔧 REGISTRAR SERVICIO                     Jumbo con Martillo · SINE210HHM1300488

1. DATOS GENERALES
   Fecha  [18/08/2026]     Máquina  [🔎 nombre, placa o serial]
   Operador / Técnico  [__________________]

   ¿Quién lo hizo?   ( ) 🏭 Interno — equipo de la empresa
                     ( ) 🤝 Externo — [nombre de la persona o taller]

2. TIPO DE INTERVENCIÓN            (se puede marcar más de una)
   ☐ Mecánica  ☐ Electricidad  ☐ Mangueras / Hidráulica  ☐ Servicio

3. DESCRIPCIÓN DEL PROBLEMA
   [                                                            ]

   ⚠️ ¿Atiende una avería reportada?   [ninguna ▾]
      └ 16/08 · Falla mecánica · reportada por César Flames

4. ACCIONES REALIZADAS                    📷 Fotos de referencia
   [                                    ]  [ + ]

5. REPUESTOS UTILIZADOS
   Cant.  Descripción                    Estado
   [ 2 ]  [Manguera hidráulica 3/4"  ]   [Nuevo ▾]  🗑
   [ + agregar renglón ]
```

Al guardar **no ocurre ninguna escritura fuera del módulo.**

### 5.3 Las dos verdades, juntas

Cuando un servicio enlaza una avería, el renglón muestra las dos a la vez, para que nunca parezca contradicción:

```
16/08 · Falla mecánica · RETROEXCAVADORA · SLP214TSWE0471955
   ✅ Atendida en taller — 18/08, Manguera + filtro (interno)
   ⏳ El sistema la sigue viendo pendiente
```

«Atendida en taller» **se deriva** de la existencia de un `machinery_service_order` que apunta a esa avería. No hay columna de estado propia y no hay nada que sincronizar.

### 5.4 Identidad de la máquina

Todo lo que muestre o imprima una máquina usa `machineLabel()` de `src/lib/machineLabel.ts` — nombre + placa/serial/identificador. En la flota hay tres máquinas llamadas `RETROEXCAVADORA`; mostrar solo el nombre las vuelve indistinguibles, que fue el bug del 18-ago.

Los nombres de archivo de PDF usan `machineFileLabel()`, por la misma razón.

### 5.5 Permisos

Reutiliza la llave de módulo `'servicio'` que ya existe: `lectura` mira, `escritura` registra. **Sin módulo de permisos nuevo** — nadie tiene que reconfigurar accesos.

---

## 6. El PDF

Archivo nuevo: `src/lib/machineServiceReport.ts`. **Función pura**: recibe los datos ya cargados por la pantalla, no consulta Supabase. Mismo contrato que `hoseServiceReport.ts`.

Usa `pdfDocument()` de `src/lib/pdf.ts` (membrete BCV / SOS La Guaira, `@page{margin:2cm}`, colores forzados en impresión).

### Modo A — una máquina

**Página 1: ficha técnica.** Foto de la máquina (`photo_url`), nombre + discriminante, y tres secciones:

- 🚜 **Información general** — tipo de equipo, marca, modelo, serial, placa, identificador, empresa, encargado
- 🛢️ **Información de lubricación** — tipo de aceite (motor), cantidad requerida, nota
- ⏱️ **Horómetro** — última lectura, lectura del último mantenimiento, horas acumuladas

Estilo tomado de `src/lib/ficha.ts` (`fx-photo`, `h3.sec`, `table.ft`), que ya hace exactamente esto para trabajadores.

Salto de página forzado: `page-break-after: always`.

**Página 2 en adelante: las reparaciones del rango**, una tarjeta por servicio (fecha, origen, quién, intervenciones, problema, acciones, repuestos, avería enlazada), y al final las dos líneas de firma en blanco:

```
──────────────────────         ──────────────────────
   Firma del Técnico              Firma Supervisor
```

Con un solo servicio en el rango, la salida **es la hoja de papel del cliente**. Mismo generador, sin código aparte.

### Modo B — rango, varias máquinas

Sin ficha técnica (serían decenas de páginas). Agrupado por máquina, cada grupo encabezado por su etiqueta completa. Firmas al final del documento.

**El modo lo decide el generador**, no un botón: si el filtro dejó una sola máquina, imprime la ficha.

### Registros anteriores

El PDF junta los `machinery_repairs` de tipo `'correctivo'` con los `machinery_service_orders`, ordenados por fecha. Los viejos salen con lo poco que guardaron (fecha y `work_done`) y **marcados como «registro anterior»**, para que no parezca un formulario llenado a medias.

### Detalles de impresión

- `tr{page-break-inside:avoid}` ya viene en `PDF_BASE_CSS`
- Cada tarjeta de servicio lleva `page-break-inside:avoid`
- Las fotos van como miniaturas con `max-width` acotado, para no inflar el archivo

---

## 7. Estructura del código

| Archivo | Qué es | Por qué |
|---|---|---|
| `src/lib/machineService.ts` | **nuevo** — tipos, validación y armado del registro. Lógica pura, sin React ni Supabase en las funciones que se prueban. | Es lo que hace la suite de pruebas posible. Mismo criterio que `auditLabels.ts` y `machineLabel.ts`. |
| `src/lib/machineServiceReport.ts` | **nuevo** — el PDF. Función pura. | Igual que `hoseServiceReport.ts`. |
| `src/screens/ServicioRegistroTab.tsx` | **nuevo** — la pestaña 🧾 Servicios: lista, formulario, filtros, botón de PDF. | `MantenimientoMaquinariaScreen.tsx` ya tiene 1.697 líneas. Meter esto adentro la vuelve inmanejable. La pestaña se monta como componente aparte y recibe lo que ya cargó la pantalla. |
| `src/screens/MantenimientoMaquinariaScreen.tsx` | **se modifica** — se agrega la pestaña y se quitan las 7 escrituras hacia afuera. | |
| `src/screens/ControlMaquinariaScreen.tsx` | **se modifica** — campos de lubricación en la ficha de la máquina. | Es donde ya se editan `marca` y `modelo`. |
| `supabase/servicio_maquinaria.sql` | **nuevo** — tablas, columnas, RLS, realtime, comprobación. | |
| `scripts/test-servicio.mjs` | **nuevo** — suite `test:servicio`. | |
| `src/screens/ManualScreen.tsx` | **se modifica** — el módulo nuevo y el cambio de comportamiento. | Convención no negociable del proyecto. |

---

## 8. Pruebas

Suite nueva `npm run test:servicio`, con la forma de las diez que ya corren (`.mjs` que transpila el `.ts` en memoria). Se agrega a `test:all` **sin tocar los scripts de la compañera**.

Qué se prueba:

1. **La frontera** — guardar un servicio no produce ninguna escritura a `machinery` ni a `maintenance_requests`. Se verifica sobre un cliente Supabase simulado que registra cada `.from(...).update(...)`, no de palabra. **Esta es la prueba más importante del trabajo.**
2. El enlace a la avería es opcional; con enlace y sin enlace ambos guardan.
3. Validación: `interno` exige técnico; `externo` exige proveedor; sin máquina o sin fecha no guarda.
4. Repuestos: cero, uno y diez renglones; renglón sin descripción se descarta; el orden se conserva.
5. `intervenciones` vacío, con una y con las cuatro.
6. El PDF con 0, 1 y N servicios; máquina sin foto; máquina sin placa ni serial; registro viejo mezclado con nuevo.
7. El modo del PDF: una máquina → con ficha; varias → sin ficha.
8. `machineFileLabel` distingue las tres RETROEXCAVADORA en el nombre del archivo.

Antes de dar nada por terminado: `npx tsc --noEmit` limpio y las **once** suites en verde. Compilar no es probar.

---

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Al quitar las escrituras, alguien manda una máquina al taller y esta se queda operativa en el sistema | Es lo pedido. Va al manual y la pantalla lo dice en el momento: «esto no cambia el estado de la máquina; para eso, Control de Maquinaria». |
| Choque con los cambios de la compañera | Rama `feature/*` desde `dev`, rebase antes de subir, y sus scripts de `package.json` se conservan y se les agrega el nuevo — nunca se sobrescriben. |
| El SQL se edita pero no se corre | El archivo abre con un bloque de comprobación y la entrega no se declara hecha hasta que el cliente pegue el resultado. |
| «Ya que estamos, agreguemos costos» | No. Decisión explícita del cliente: este módulo no lleva dinero. |
| El PDF sale enorme por las fotos | Miniaturas acotadas por CSS; el original queda en el registro, no en el PDF. |

---

## 10. Fuera de alcance

- Cambiar cómo se calcula el estado «averiada» de una máquina (los doce lugares que leen `maintenance_requests` pendientes). Proyecto aparte.
- Taller de vehículos.
- Costos, pagos, autorizaciones.
- Obras Públicas.
- Tocar registros existentes: horas de jornada, cuadres de nómina, las 252 horas fantasma, las 1.410 rondas viejas.
