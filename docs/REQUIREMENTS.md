# Requisitos del Sistema — Control de Combustible

| Campo | Valor |
|---|---|
| Proyecto | Control de Combustible |
| Versión del documento | 1.0 |
| Fecha | 2026-06-29 |
| Plataforma | App móvil (Expo / React Native + TypeScript) |
| Backend | Supabase (Postgres + Auth + RLS + Storage) |
| Enfoque | Mobile-first, responsiva, paleta de tonos neutros |

---

## 1. Introducción y alcance

### 1.1 Propósito
El sistema **Control de Combustible** gestiona el ciclo completo del combustible en una operación que utiliza vehículos y maquinaria: desde la recepción/compra (ingresos), el almacenamiento en tanques, las autorizaciones, el despacho/consumo a los activos, hasta los traslados internos entre tanques, con reportes y alertas de stock.

### 1.2 Alcance
El producto es una aplicación móvil para iOS y Android construida con Expo/React Native y TypeScript, respaldada por Supabase como backend (base de datos Postgres, autenticación, seguridad a nivel de fila mediante RLS y almacenamiento de archivos para facturas/evidencias).

**Dentro del alcance:**
- Registro de ingresos de combustible (recepción/compra).
- Registro de consumos/despachos a vehículos y maquinaria.
- Gestión de tanques con nivel/stock derivado de movimientos.
- Flujo de autorizaciones de despacho (pendiente/aprobado/rechazado).
- Catálogo de vehículos y maquinaria.
- Traslados de combustible entre tanques (incluido tanque móvil).
- Dashboard, reportes, históricos y alertas de stock bajo.
- Gestión de usuarios y roles (admin, supervisor, operador, conductor) sobre Auth de Supabase.

**Fuera del alcance (versión 1.0):**
- Integración con surtidores/telemetría automática de tanques (IoT).
- Módulo contable/facturación fiscal completo (solo se registra el nº de factura como dato).
- Mantenimiento de vehículos/maquinaria más allá de su catálogo y rendimiento.
- Compras con flujo de órdenes de compra y pagos a proveedores.

### 1.3 Definiciones clave
Ver **Glosario** (sección 7). Los términos *activo*, *ingreso*, *consumo/despacho*, *traslado*, *movimiento*, *stock derivado* y *autorización* se usan con el significado definido allí.

---

## 2. Roles de usuario y permisos

### 2.1 Roles
| Rol | Descripción |
|---|---|
| **Admin** | Control total. Gestiona usuarios, roles, catálogos, tanques y todos los movimientos. Configura el sistema. |
| **Supervisor** | Aprueba/rechaza autorizaciones, supervisa movimientos, gestiona tanques y catálogos, consulta todos los reportes. |
| **Operador** | Registra ingresos, ejecuta despachos autorizados y registra traslados. No aprueba autorizaciones. |
| **Conductor** | Solicita autorizaciones para su(s) activo(s) y consulta el estado. Acceso de lectura limitado. |

### 2.2 Matriz de permisos (rol × acción por módulo)
Leyenda: **C**=Crear · **L**=Leer · **A**=Actualizar/Editar · **E**=Eliminar · **Ap**=Aprobar/Rechazar · **—**=Sin acceso

| Módulo / Acción | Admin | Supervisor | Operador | Conductor |
|---|---|---|---|---|
| Ingresos de combustible | C L A E | C L A | C L | L (solo propios) |
| Consumos / Despachos | C L A E | C L A | C L | L (solo propios) |
| Tanques | C L A E | C L A | L | L |
| Autorizaciones (registro) | C L A E | C L A | C L | C L (propias) |
| Autorizaciones (aprobar/rechazar) | Ap | Ap | — | — |
| Vehículos | C L A E | C L A | L | L (asignados) |
| Maquinaria | C L A E | C L A | L | L (asignada) |
| Traslados entre tanques | C L A E | C L A | C L | — |
| Dashboard / Reportes | L | L | L (operativos) | L (limitado) |
| Usuarios y Roles | C L A E | L | — | — |

> Nota: La política de aprobación de la **autorización propia** se restringe por RN (un solicitante no aprueba su propia solicitud; ver RN-009).

---

## 3. Requisitos funcionales

> Formato de criterios de aceptación: **Dado** (contexto) / **Cuando** (acción) / **Entonces** (resultado esperado).

### 3.1 Módulo: Ingresos de combustible

#### RF-001 — Registrar ingreso de combustible
**Descripción:** El sistema debe permitir registrar un ingreso (recepción/compra) con: fecha, proveedor, tipo (gasolina/diésel), litros, costo unitario, costo total (calculado), tanque destino, nº de factura y responsable.
**Criterios de aceptación:**
- Dado un usuario con permiso de creación de ingresos, Cuando completa los campos obligatorios y guarda, Entonces se crea el ingreso y el stock del tanque destino aumenta en los litros registrados (RN-001).
- Dado que ingresa litros y costo unitario, Cuando el sistema calcula, Entonces el costo total = litros × costo unitario y se muestra de forma automática.
- Dado un tanque destino, Cuando el tipo de combustible del ingreso difiere del tipo del tanque, Entonces el sistema bloquea el guardado y muestra un error (RN-007).

#### RF-002 — Adjuntar factura/evidencia al ingreso
**Descripción:** Permitir adjuntar la imagen/archivo de la factura al ingreso, almacenada en Supabase Storage.
**Criterios de aceptación:**
- Dado un ingreso en edición, Cuando el usuario adjunta un archivo, Entonces se sube a Storage y queda vinculado al ingreso.
- Dado un ingreso con factura, Cuando se consulta el detalle, Entonces se puede visualizar/descargar el archivo según permisos.

#### RF-003 — Listar y filtrar ingresos
**Descripción:** Listar ingresos con filtros por fecha, proveedor, tipo y tanque.
**Criterios de aceptación:**
- Dado el listado de ingresos, Cuando el usuario aplica un filtro, Entonces solo se muestran los registros que cumplen el criterio.
- Dado un rol Conductor, Cuando consulta ingresos, Entonces solo ve los que le corresponden según RLS.

### 3.2 Módulo: Consumos / Despachos

#### RF-010 — Registrar consumo/despacho
**Descripción:** Registrar un despacho a vehículo o maquinaria con: fecha, activo, litros, odómetro (km) u horómetro (h), conductor/operador, tanque origen, autorización vinculada y responsable.
**Criterios de aceptación:**
- Dado un despacho con autorización aprobada vigente, Cuando se guarda, Entonces el stock del tanque origen disminuye en los litros despachados (RN-002).
- Dado un activo tipo vehículo, Cuando se registra el despacho, Entonces el campo de medición solicitado es odómetro (km); si es maquinaria, es horómetro (h).
- Dado un despacho sin autorización aprobada, Cuando se intenta guardar, Entonces el sistema lo rechaza (RN-008).
- Dado un tanque origen con stock menor a los litros solicitados, Cuando se intenta despachar, Entonces el sistema bloquea la operación (RN-004).

#### RF-011 — Vincular despacho a autorización
**Descripción:** Al registrar el despacho debe poder seleccionarse una autorización aprobada del activo correspondiente.
**Criterios de aceptación:**
- Dado un activo seleccionado, Cuando el operador busca autorizaciones, Entonces solo se listan las aprobadas y no consumidas de ese activo.
- Dado un despacho ya vinculado a una autorización, Cuando se aprueba otro despacho contra la misma autorización, Entonces el sistema impide exceder los litros autorizados (RN-010).

#### RF-012 — Listar y filtrar consumos
**Descripción:** Listar consumos con filtros por fecha, activo, tanque y conductor/operador.
**Criterios de aceptación:**
- Dado el listado, Cuando se filtra por activo, Entonces se muestran solo los consumos de ese activo.
- Dado un Conductor, Cuando consulta, Entonces solo ve sus propios despachos (RLS).

### 3.3 Módulo: Tanques

#### RF-020 — Gestionar tanques
**Descripción:** Crear/editar tanques con: nombre, ubicación, tipo de combustible, capacidad (L), nivel/stock actual (derivado) y estado.
**Criterios de aceptación:**
- Dado un usuario con permiso, Cuando crea un tanque, Entonces queda disponible para ingresos, despachos y traslados.
- Dado un tanque, Cuando se consulta, Entonces el nivel/stock se muestra como valor derivado de los movimientos (RN-003), no editable manualmente.

#### RF-021 — Consultar nivel/stock del tanque
**Descripción:** Mostrar el nivel actual y el porcentaje respecto a la capacidad.
**Criterios de aceptación:**
- Dado un tanque con movimientos, Cuando se consulta su nivel, Entonces se calcula como Σ ingresos + Σ traslados entrantes − Σ consumos − Σ traslados salientes.
- Dado un nivel que supera la capacidad por un ingreso/traslado, Cuando se intenta la operación, Entonces el sistema advierte/bloquea según RN-006.

#### RF-022 — Alerta de stock bajo
**Descripción:** El tanque debe disponer de un umbral mínimo y generar alerta cuando el nivel cae por debajo.
**Criterios de aceptación:**
- Dado un tanque con umbral configurado, Cuando el nivel cae por debajo del umbral, Entonces se muestra una alerta en el dashboard (RN-011).

### 3.4 Módulo: Autorizaciones

#### RF-030 — Crear solicitud de autorización
**Descripción:** Registrar una autorización con: solicitante, activo, litros solicitados, motivo, aprobador, estado (pendiente/aprobado/rechazado) y fecha.
**Criterios de aceptación:**
- Dado un Conductor/Operador, Cuando crea una solicitud, Entonces se guarda con estado **pendiente** y fecha de creación.
- Dado un solicitante, Cuando guarda la solicitud, Entonces queda vinculada a un activo válido del catálogo.

#### RF-031 — Aprobar/Rechazar autorización
**Descripción:** Un Admin o Supervisor puede cambiar el estado a aprobado o rechazado.
**Criterios de aceptación:**
- Dado un Supervisor/Admin, Cuando aprueba una solicitud pendiente, Entonces su estado pasa a **aprobado** y queda disponible para despacho.
- Dado un aprobador que es el mismo solicitante, Cuando intenta aprobar su solicitud, Entonces el sistema lo impide (RN-009).
- Dado un Operador/Conductor, Cuando intenta aprobar, Entonces la acción no está disponible (sección 2.2).

#### RF-032 — Consultar estado de autorizaciones
**Descripción:** Listar autorizaciones filtrando por estado, activo, solicitante y fecha.
**Criterios de aceptación:**
- Dado un Conductor, Cuando consulta, Entonces ve únicamente sus solicitudes y su estado actual.
- Dado un Supervisor, Cuando filtra por estado pendiente, Entonces ve la cola de aprobaciones.

### 3.5 Módulo: Vehículos y Maquinaria

#### RF-040 — Gestionar vehículos
**Descripción:** Crear/editar vehículos con: placa, marca, modelo, tipo, capacidad de tanque y rendimiento (km/L).
**Criterios de aceptación:**
- Dado un usuario con permiso, Cuando registra un vehículo, Entonces la placa debe ser única.
- Dado un vehículo, Cuando se usa en un despacho, Entonces solicita odómetro (km).

#### RF-041 — Gestionar maquinaria
**Descripción:** Crear/editar maquinaria con: código, descripción, tipo y rendimiento (L/h).
**Criterios de aceptación:**
- Dado un usuario con permiso, Cuando registra maquinaria, Entonces el código debe ser único.
- Dada una maquinaria, Cuando se usa en un despacho, Entonces solicita horómetro (h).

#### RF-042 — Consultar catálogo de activos
**Descripción:** Listar y buscar vehículos y maquinaria.
**Criterios de aceptación:**
- Dado el catálogo, Cuando el usuario busca por placa/código, Entonces se muestran las coincidencias.

### 3.6 Módulo: Traslados de combustible entre tanques

#### RF-050 — Registrar traslado entre tanques
**Descripción:** Registrar un traslado con: fecha, tanque origen, tanque destino (o tanque móvil), litros, responsable y observaciones.
**Criterios de aceptación:**
- Dado un traslado válido, Cuando se guarda, Entonces el stock del origen disminuye y el del destino aumenta en los mismos litros (RN-005).
- Dado un origen con stock insuficiente, Cuando se intenta el traslado, Entonces el sistema lo bloquea (RN-004).
- Dado origen y destino, Cuando son el mismo tanque, Entonces el sistema impide el traslado.
- Dado un destino cuyo tipo de combustible difiere del origen, Cuando se intenta el traslado, Entonces el sistema lo bloquea (RN-007).

#### RF-051 — Listar y filtrar traslados
**Descripción:** Listar traslados por fecha, tanque origen/destino y responsable.
**Criterios de aceptación:**
- Dado el listado, Cuando se filtra por tanque, Entonces se muestran los traslados entrantes y salientes de ese tanque.

### 3.7 Módulo: Dashboard / Reportes

#### RF-060 — Dashboard de niveles y alertas
**Descripción:** Mostrar niveles de tanque actuales, alertas de stock bajo y resumen de actividad reciente.
**Criterios de aceptación:**
- Dado el dashboard, Cuando se carga, Entonces muestra el nivel de cada tanque y resalta los que están por debajo del umbral.

#### RF-061 — Reporte de consumo por activo
**Descripción:** Generar consumo agregado por activo en un rango de fechas, con litros totales y rendimiento estimado.
**Criterios de aceptación:**
- Dado un rango de fechas y un activo, Cuando se genera el reporte, Entonces muestra litros consumidos y rendimiento (km/L o L/h) calculado con odómetro/horómetro.

#### RF-062 — Histórico de movimientos
**Descripción:** Consultar el histórico unificado de ingresos, consumos y traslados.
**Criterios de aceptación:**
- Dado el histórico, Cuando se filtra por tipo de movimiento y fecha, Entonces se listan cronológicamente los movimientos correspondientes.

#### RF-063 — Exportar reportes
**Descripción:** Exportar reportes (p. ej. CSV/PDF) para compartir.
**Criterios de aceptación:**
- Dado un reporte generado, Cuando el usuario exporta, Entonces se produce un archivo descargable/compartible con los datos visibles.

### 3.8 Módulo: Usuarios y Roles

#### RF-070 — Gestionar usuarios
**Descripción:** El Admin crea/edita/desactiva usuarios sobre Supabase Auth y asigna rol.
**Criterios de aceptación:**
- Dado un Admin, Cuando crea un usuario, Entonces se registra en Auth y se le asigna uno de los roles definidos.
- Dado un usuario desactivado, Cuando intenta autenticarse, Entonces el acceso es denegado.

#### RF-071 — Autenticación
**Descripción:** Inicio de sesión mediante Supabase Auth.
**Criterios de aceptación:**
- Dado un usuario válido, Cuando inicia sesión con credenciales correctas, Entonces obtiene una sesión y acceso según su rol.
- Dado credenciales inválidas, Cuando intenta iniciar sesión, Entonces el sistema rechaza el acceso con mensaje claro.

#### RF-072 — Control de acceso por rol
**Descripción:** Cada acción y dato se restringe según la matriz de permisos (sección 2.2), aplicada en cliente y en RLS de Supabase.
**Criterios de aceptación:**
- Dado un rol sin permiso para una acción, Cuando intenta ejecutarla, Entonces la UI la oculta/deshabilita y RLS rechaza la operación en backend (RNF de seguridad).

---

## 4. Requisitos no funcionales

### 4.1 Rendimiento
- **RNF-001:** Las pantallas de listado deben cargar las primeras 50 filas en ≤ 2 s en una conexión 4G típica, con paginación/scroll incremental.
- **RNF-002:** El cálculo del nivel de tanque (derivado) debe resolverse en ≤ 1 s, apoyándose en vistas/agregados en Postgres.

### 4.2 Seguridad
- **RNF-003 (Auth):** Toda operación requiere sesión válida vía Supabase Auth; los tokens se gestionan de forma segura en el dispositivo.
- **RNF-004 (RLS):** La autorización de datos se aplica con Row Level Security en Postgres, alineada a la matriz de permisos; el cliente nunca es la única barrera.
- **RNF-005 (Storage):** Los archivos (facturas/evidencias) se almacenan en buckets con políticas de acceso por rol.
- **RNF-006 (Auditoría):** Cada movimiento (ingreso, consumo, traslado, aprobación) registra responsable, usuario y marca de tiempo (created_by, created_at).
- **RNF-007 (Integridad):** El stock se deriva siempre de movimientos; no existe edición directa del nivel para evitar inconsistencias.

### 4.3 Usabilidad móvil
- **RNF-008:** Diseño mobile-first y responsivo, con objetivos táctiles ≥ 44 px y formularios optimizados para una mano.
- **RNF-009:** Paleta de tonos neutros, alto contraste para lectura en exteriores (uso de campo).
- **RNF-010:** Mensajes de error y validaciones claros en español; teclados numéricos en campos de litros/odómetro/horómetro.

### 4.4 Offline / conectividad
- **RNF-011:** Ante pérdida de conexión, la app indica el estado offline y evita pérdida de datos del formulario en curso (persistencia local del borrador).
- **RNF-012:** Las operaciones críticas (despacho, traslado) requieren validar stock contra el backend al sincronizar; los borradores offline se confirman al recuperar conexión.

### 4.5 Disponibilidad
- **RNF-013:** El backend (Supabase) debe ofrecer disponibilidad acorde a su SLA gestionado; la app degrada con elegancia ante indisponibilidad temporal (reintentos y mensajes).

### 4.6 Compatibilidad iOS / Android
- **RNF-014:** Soporte para iOS y Android mediante Expo/React Native, con paridad funcional entre plataformas.
- **RNF-015:** Compatibilidad con versiones de SO soportadas por la versión de Expo SDK utilizada; sin dependencias específicas de una sola plataforma para funciones del dominio.

### 4.7 Mantenibilidad
- **RNF-016:** Código en TypeScript con tipado estricto del dominio (tanques, movimientos, activos, autorizaciones).

---

## 5. Reglas de negocio

| ID | Regla |
|---|---|
| **RN-001** | Un **ingreso** suma litros al stock del tanque destino. |
| **RN-002** | Un **consumo/despacho** resta litros del stock del tanque origen. |
| **RN-003** | El **nivel/stock** de un tanque es siempre un valor **derivado** de la suma de sus movimientos; no se edita manualmente. |
| **RN-004** | No se puede despachar ni trasladar **más litros que el stock disponible** del tanque origen. |
| **RN-005** | Un **traslado** resta del tanque origen y suma al tanque destino la misma cantidad de litros (conservación). |
| **RN-006** | Ningún ingreso o traslado puede dejar el stock por encima de la **capacidad** del tanque destino (bloqueo/advertencia). |
| **RN-007** | El **tipo de combustible** del movimiento debe coincidir con el tipo del tanque destino/origen involucrado. |
| **RN-008** | Un **consumo requiere una autorización aprobada** vigente (según rol y RF-010/RF-011). |
| **RN-009** | El **aprobador no puede ser el mismo solicitante** de la autorización (segregación de funciones). |
| **RN-010** | Los litros despachados contra una autorización **no pueden exceder** los litros autorizados. |
| **RN-011** | Cuando el nivel de un tanque cae por debajo de su **umbral mínimo**, se genera una alerta de stock bajo. |
| **RN-012** | Los despachos a **vehículos** registran odómetro (km); a **maquinaria**, horómetro (h). |
| **RN-013** | El **rendimiento** se calcula como km/L (vehículos) o L/h (maquinaria) a partir de litros y la medición del activo. |

---

## 6. Supuestos y restricciones

### 6.1 Supuestos
- Existe conectividad a internet de forma habitual; el uso offline es excepcional y se sincroniza al reconectar.
- Cada activo (vehículo/maquinaria) está dado de alta en el catálogo antes de registrar consumos.
- Los usuarios y sus roles se administran exclusivamente por el rol Admin.
- Las mediciones de odómetro/horómetro son ingresadas manualmente por el responsable y se asumen veraces.

### 6.2 Restricciones
- Stack fijo: Expo/React Native + TypeScript en el cliente; Supabase (Postgres, Auth, RLS, Storage) en el backend.
- No se contemplan integraciones con hardware de surtidores/telemetría en la versión 1.0.
- La autorización de datos debe implementarse con RLS; el cliente no es la barrera de seguridad principal.
- Idioma de la interfaz: español. Unidades: litros (L), kilómetros (km), horas (h).
- Diseño mobile-first con paleta de tonos neutros.

---

## 7. Glosario

| Término | Definición |
|---|---|
| **Activo** | Vehículo o maquinaria que consume combustible. |
| **Ingreso** | Recepción/compra de combustible que incrementa el stock de un tanque. |
| **Consumo / Despacho** | Entrega de combustible a un activo; reduce el stock del tanque origen. |
| **Traslado** | Movimiento de combustible entre tanques (incluido tanque móvil); conserva el total. |
| **Movimiento** | Cualquier transacción que afecta el stock: ingreso, consumo o traslado. |
| **Stock / Nivel derivado** | Cantidad de combustible en un tanque, calculada a partir de sus movimientos. |
| **Tanque** | Depósito de combustible con tipo, capacidad y ubicación; puede ser fijo o móvil. |
| **Tanque móvil** | Tanque transportable usado como origen/destino en traslados y despachos en campo. |
| **Autorización** | Solicitud aprobada que habilita un despacho de combustible a un activo. |
| **Odómetro** | Lectura de kilómetros recorridos por un vehículo (km). |
| **Horómetro** | Lectura de horas de operación de una maquinaria (h). |
| **Rendimiento** | Eficiencia del activo: km/L (vehículos) o L/h (maquinaria). |
| **Umbral mínimo** | Nivel de stock por debajo del cual se genera alerta de stock bajo. |
| **RLS** | Row Level Security: control de acceso a filas en Postgres/Supabase. |
| **Responsable** | Usuario que ejecuta/registra un movimiento. |
| **Aprobador** | Usuario (Admin/Supervisor) que aprueba o rechaza una autorización. |
