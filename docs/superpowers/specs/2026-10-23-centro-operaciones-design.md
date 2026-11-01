# Centro de Operaciones: diseño (v2, 23/10/2026)

> Estado: **diseño, sin código ni SQL.** Nada de lo descrito aquí está en producción.
> Este documento va a un repositorio público: no lleva nombres de empresas, placas,
> montos ni datos reales; los ejemplos son genéricos a propósito.
>
> v1 se llamaba «Registro del CDT» y cubría solo el registro y los reportes. El cliente amplió
> el pedido el mismo día: ahora es un mini sistema para operar un sitio, en cuatro fases.

## 1. Qué se pide

Una persona encargada de un sitio (el primero es un CDT) lleva hoy, a mano y fuera del
sistema, lo que entra, se mueve, se procesa y sale del sitio, y arma sus propios PDF. El
cliente pidió, con sus palabras:

- «Que ella lleve su registro **sin que sume en los viajes del módulo de viajes**», «sin que
  choque ni pegue», «que no choque ni se enlace con el módulo de viajes».
- «Que ese módulo pueda **recibir** información pero **no enviarla**.»
- «Que pueda registrar **maquinaria que sea solo de ahí**»; usa máquinas del catálogo y
  máquinas fuera del catálogo; «puede ser un camión u otro camión».
- «Que pueda gestionar los viajes **por peso, por viaje o por jornada**.»
- «Un módulo muy completo donde gestionaría el mundo del CDT», «un **mini sistema** para
  esa persona», y **que el nombre no sea CDT**: sirve para cualquier sitio.
- «Que pueda llevar los **materiales**»: lo que se saca o procesa. «Más que todo no es
  venderlo, sino **saber cuánto costó, qué fue, y tener el registro** del material
  procesado.» Qué gastos entran en el costo: «**que se pueda llevar o no llevar**».
- «Aunque esté aislado, en el **reporte consolidado** poder gestionar los precios de esa
  maquinaria **a decisión**: si se usan esas máquinas en ese módulo, se tomaría el acarreo o
  la jornada de trabajo de esas máquinas.»
- Reportes «con todas las opciones de cambiar y quitar».
- Ella «debería poder hacer lo que quiera en ese módulo». No es listera.

## 2. Lo que dice la base (23/10/2026)

Se cruzaron los dos papeles de ejemplo con la base de producción:

- **La recepción de su consolidado no existe en el sistema.** Sus entradas son de cuatro
  contratistas que no están en `companies` (una existe solo como dueña de dos tractores). El
  módulo de Viajes, en el mismo CDT y en las mismas fechas, cuenta otras cinco empresas: los
  camiones que la empresa contrata. Cero empresas y cero viajes en común; ningún rango de
  fechas da su total. Son **dos flujos distintos**.
- **La unidad de su «corte de viajes» está en el catálogo**, con viajes en Viajes solo antes
  del período del papel, y con jornadas en Control que en ese período son automáticas o están
  en cero. Lo que ella documenta no está en ninguna parte.
- **`public.module_level` tiene una lista fija de módulos cerrados**: un módulo nuevo que no
  esté en ella vale `escritura` para todo rol fijo sin fila explícita ni rol de app.

## 3. Los dos papeles de referencia

**A. Consolidado del sitio a una fecha de corte (con hora).** Párrafo de presentación;
tarjetas (viajes recibidos, toneladas netas, promedio t/viaje); recepción por empresa
transportista (viajes, %, toneladas); movimientos internos de terraza a terraza contados por
capacidad del camión en m³; salidas/despacho (material, destino, capacidad, viajes, estado
«esperando pesaje»); desglose por frente u obra de origen (viajes, %, toneladas); resumen de
salidas en texto con el total de m³ (= Σ viajes × capacidad).

**B. Corte de viajes de una unidad en un período.** Tipo de unidad, placa, período, fecha de
emisión; tarjetas (internos, externos «N (+M pendiente)», total); detalle diario (fecha,
internos, externos, observaciones; un día puede estar «Por confirmar» sin número); totales y
«N días evaluados»; consideraciones contractuales en texto libre.

Los dos cuadran internamente. Defectos de forma que no se deben repetir: página final en
blanco, pie de página corrido a la hoja siguiente, código crudo (`$\rightarrow$`) en vez de
la flecha.

## 4. Principio rector: recibe, no envía

1. **Tablas propias** con prefijo `cop_` (Centro de OPeraciones). Ninguna columna nueva en
   tablas existentes. **Única excepción, por seguridad:** agregar `'centro_operaciones'` a la
   lista fija de módulos cerrados de `public.module_level`, copiando el cuerpo **leído de la
   base en ese momento** (no de `supabase/schema.sql`). Una palabra más; ningún otro módulo
   cambia. `can_write_module` no se toca: las políticas nuevas no la usan.
2. **Sin llaves foráneas hacia tablas ajenas.** Los ids de otras tablas (máquina, obra) son
   `uuid` sueltos, sin `REFERENCES`: nada de afuera puede bloquear, propagar ni reescribir un
   registro del módulo, y nada del módulo frena a otro. Entre tablas `cop_*` sí hay llaves.
3. **Lo que se recibe se congela como texto** (como `placa_snap` en Viajes).
4. **Lecturas permitidas, solo para sugerir:** `machinery` (+ `companies`), `viaje_frentes`,
   `ubicaciones_obra`. Si una lectura falla, el formulario sigue con texto libre. Además
   (26/10/2026, mesa de maquinaria), para mostrar el estado de inspección de las unidades
   vinculadas, el módulo usa `machineLiveStatus.ts` —que lee `maintenance_requests`,
   `machine_rounds`, `machine_inspectors` y `profiles`— solo desde `centroOperacionesDb.ts`, solo
   lectura.
5. **Escrituras permitidas:** solo a tablas `cop_*`. Sin RPC, sin triggers que escriban fuera
   de la propia fila, sin crons.
6. **Nadie lee las tablas `cop_*` fuera del módulo**, con una sola excepción futura y
   apagada por defecto: el 💰 Reporte consolidado de pagos en la fase 4 (sección 11).
7. **Candados en la suite** para 5 y 6 (sección 12).

## 5. Fases

| Fase | Qué | Depende de |
|---|---|---|
| **1** | Sitios, flota (catálogo + propias), registro de movimientos, listas, textos y los tres papeles | — |
| **2** | Pagos del sitio: tarifas por unidad (jornada / viaje / peso) y jornadas anotadas en el módulo | 1 |
| **3** | Materiales: qué fue, proceso, destino, existencias y costo con componentes elegibles | 1 y 2 |
| **4** | Puente al 💰 consolidado de pagos, apagado por defecto | 2 |

Cada fase se construye, se prueba y se publica por separado. **Este documento detalla la
fase 1**; de las fases 2 a 4 fija lo que la fase 1 tiene que dejar preparado y las preguntas
que se contestan al llegar a cada una. Ninguna fase posterior obliga a rehacer la anterior.

## 6. Quién lo usa y permisos

- Módulo **`centro_operaciones`** («🏭 Centro de Operaciones», nombre propuesto; la etiqueta se
  puede cambiar sin tocar la clave) en `MODULES` de `src/lib/permissions.ts`, nivel por
  defecto **`none`** (se suma a la lista de `defaultLevel`).
- **Lectura:** ve todo y saca los papeles. **Escritura:** además carga y corrige.
  **Full:** además borra y administra sitios, flota, listas y textos. **Ella: Full**, asignado
  por el administrador desde Usuarios (no se crea rol ni se tocan permisos de personas).
- **Por dónde entra:** tarjeta en `MoreScreen`. Ruta `CentroOperaciones`, enlace web
  `centro-operaciones`. (`MODULE_NAV` de `RoleHomeScreen` no sirve: solo se usa dentro de
  `CoordinadorStack`.) Ella no es listera, así que `ViajesStack` no se toca. **Ojo:** los
  roles fijos `supervisor`, `operador` y `coordinador_inspectores` caen en pantallas sin «Más»
  y no verían la tarjeta; su usuario tiene que tener un rol que llegue a «Más» (se verifica en
  la base cuando se sepa quién es). Un rol de app con solo este módulo aterriza en «Más» con
  una sola tarjeta: un toque. No se toca `pickTree`.
- **El acceso es por módulo, no por sitio:** quien tiene el módulo ve todos los sitios. Si
  mañana cada sitio tiene su encargada, se agrega `cop_sitio_usuarios` y se ajustan las
  políticas (por eso `cop_ajustes` ya lleva `sitio_id`).
- **RLS** (criterio de `horometro_cambios`, mirado en la base), **una política por comando**
  para poder sumar otras sin tocar estas: SELECT con
  `module_level('centro_operaciones') <> 'none'`; INSERT/UPDATE con `escritura` o `full`;
  DELETE con `full`; `anon` revocado en duro. La fase 4 sumará una política de lectura
  aparte para quien abre el consolidado (si no, la RLS le devolvería cero filas sin error).
  Probadas suplantando un usuario con el módulo y uno sin él en `begin … rollback`;
  `get_advisors` (security) después del DDL.
- **Auditoría:** las tablas `cop_*` se mapean a su sección en `src/lib/auditModulos.ts`
  para que sus cambios no salgan como «Otro». Como su `trg_audit` se crea por MCP y no está
  en ningún `.sql` del repositorio, `scripts/test-auditoria-modulos.mjs` aprende a leer
  también una lista declarada de tablas auditadas fuera del git (verificadas en la base), en
  vez de marcar la sección «sin rastro aún», que sería falso.

## 7. Datos de la fase 1

### 7.1 `cop_sitios`
`id`, `nombre` (único entre activos), `nota`, `activo`, `ubicacion_id` (uuid suelto,
opcional: la obra del sistema a la que corresponde), sello de creación. Si hay un solo sitio
activo, la pantalla no pregunta cuál.

### 7.2 `cop_unidades` — la flota de cada sitio
| Columna | Notas |
|---|---|
| `id`, `sitio_id` (→ `cop_sitios`) | |
| `origen` | `catalogo` · `propia` |
| `machinery_id` | uuid suelto; solo si `origen = catalogo`. Única por sitio entre activas. |
| `codigo`, `descripcion`, `placa`, `serial`, `marca`, `modelo` | Copiados del catálogo al agregarla (congelados; botón «Actualizar desde el catálogo»), o escritos por ella si es propia. |
| `dueno` | Empresa dueña / transportista, texto. |
| `capacidad_m3` | Opcional. |
| `activo`, `nota`, sello | Dar de baja = `activo = false`; sus registros siguen. |

Una unidad **propia** no existe fuera del módulo: no aparece en Control de Maquinaria, ni a
los inspectores, ni en ningún reporte del sistema.

### 7.3 `cop_movimientos` — un renglón por anotación
| Columna | Notas |
|---|---|
| `id`, `sitio_id` | |
| `fecha` (date), `hora` (time, opcional) | Fecha de jornada (7.6). |
| `tipo` | `entrada` · `interno` · `salida` · `otro` |
| `unidad_id` (→ `cop_unidades`, opcional) + `unidad_texto`, `placa` | El texto congelado manda en los papeles; permite anotar una unidad sin darla de alta. Si la placa escrita coincide con una unidad activa del sitio, se vincula sola. En 📋 Registros hay «Vincular a unidad» (uno o varios): la fase 2 solo pagará renglones vinculados. |
| `transportista`, `origen`, `destino`, `material` + `*_lista_id` (→ `cop_listas`, `on delete set null`) | El texto se guarda siempre; el id, cuando se eligió de su lista. Así la fase 3 (materiales) y las tarifas por transportista no dependen de cruzar por nombre. **Origen y destino** sugieren según el tipo: entrada = frente/obra → terraza; interno = terraza → terraza; salida = terraza → destino externo. La terraza no lleva columna propia: es una clase de lista que se usa en origen y destino. |
| `capacidad_m3` | Toma la de la unidad; editable. |
| `viajes` | integer ≥ 0, **defecto 1** (cada pesada = 1, o el total del día = n). Vacío solo si está por confirmar. |
| `toneladas`, `m3` | ≥ 0, opcionales. `m3` vacío → `viajes × capacidad_m3`. |
| `estado` | `confirmado` (defecto) · `por_confirmar` · `esperando_pesaje` |
| `observacion`, sello de creación y de última edición | |

Índices: `(sitio_id, fecha)`, `(unidad_id, fecha)`, `(sitio_id, tipo, fecha)`.

### 7.4 `cop_listas`
`id`, `sitio_id` (null = para todos los sitios), `clase` (`transportista` · `origen` ·
`destino` · `material` · `terraza`), `nombre`, `activo`, sello. Único `(sitio, clase,
lower(nombre))` entre activos. **Las contratistas viven aquí, no en `companies`.**

### 7.5 `cop_ajustes`
`id`, `sitio_id` (null = general), `clave`, `valor` (jsonb), `updated_at`,
`updated_by_nombre`; único `(sitio_id, clave)` tratando null como general. Textos fijos del
papel (presentación, consideraciones, títulos), logos preferidos.

### 7.6 Reglas de cálculo (librería pura, sin imports)
- **Fecha de jornada** (7am a 7am, regla de la casa). «Hoy» por defecto = jornada en curso.
  Una `hora` anterior a las 07:00 ocurrió el día calendario siguiente a su `fecha`.
- **Rango:** `desde ≤ fecha ≤ hasta`. Con **fecha de corte con hora** se compara el momento
  real del renglón (fecha + hora, +1 día si la hora es < 07:00) con el instante del corte; un
  renglón sin hora entra si su fecha está en el rango.
- **Instante del corte (R33, revisión final, 25-oct-2026):** el corte es el FIN de lo que se
  cuenta: con una hora < 07:00 **o con las 07:00 en punto** cierra la jornada `hasta`, así que
  ocurre el día calendario siguiente (`momentoDelCorte`). Es la regla del Reporte General
  (R28). Un *renglón* anotado a las 07:00 en punto, en cambio, abre su jornada (`momentoReal`).
  La usan el rango (`enRango`), el rótulo «Corte:» (`corteCop`), el período del papel, el
  nombre del archivo y el aviso de la pantalla. Antes las 07:00 quedaban en el mismo día y un
  minuto (06:59 contra 07:00) movía el papel 24 horas.
- **m³:** `m3`, o `viajes × capacidad_m3`, o no suma.
- **Promedio t/viaje:** sobre renglones de entrada con ambos datos.
- **Pendientes:** nada `por_confirmar` suma al total confirmado. Sin `viajes` → «(+N
  pendiente)», N = cantidad de renglones (así lo dice su papel). Con `viajes` → «(+V por
  confirmar)», V = suma de esos viajes. Si hay de los dos, salen los dos. `esperando_pesaje`
  sí cuenta sus viajes y queda fuera del promedio t/viaje mientras no tenga toneladas.
- **Participación %:** un decimal; la fila de totales dice 100 %.
- Orden: más viajes (como sus papeles) o A→Z con `cmpText`.

## 8. Pantallas de la fase 1

Selector de sitio arriba (oculto si hay uno solo). Pestañas:

1. **✍️ Cargar** (Escritura/Full): pastillas de tipo; fecha; unidad desde la flota del sitio
   o escrita; transportista, origen, destino, material y terraza desde sus listas con
   sugerencias del sistema y texto libre; capacidad, viajes, toneladas, m³, estado,
   observación. **«Guardar y otro»** deja puestos los campos para cargar una serie rápido, y
   el campo viajes permite anotar el total del día en un solo renglón (no hace falta una
   pesada por renglón). Debajo, lo cargado ese día con ✏️ y 🗑️. Si falla la conexión al
   guardar, lo escrito queda como borrador en el equipo y avisa. Sin importador de Excel en
   la fase 1 (se agrega si ella trae datos atrasados en un archivo).
   *Revisión final (25-oct-2026):* no acepta una jornada futura (B-M8, como el 📅 Parte
   diario); lo anotado en el 📅 Parte diario (bloques y salidas con vehículo) no se corrige
   aquí ni en 📋 Registros: la fila dice en qué bloque (A#1); ✏️ o «Cancelar» con algo sin
   guardar preguntan antes de descartarlo (B-M2); «Lo cargado el …» nunca muestra las filas
   de otro día (B-M1).
2. **📋 Registros:** filtros (rango, tipo, unidad, transportista, origen, destino, material,
   estado), buscador, totales, ✏️, 🗑️ (Full, con confirmación), Excel con `src/lib/xlsx.ts`.
   *Revisión final:* lista, totales y Excel solo con lo cargado del rango pedido (B-I3); en
   el Excel, las toneladas solo de lo confirmado y los m³ vacíos en lo por confirmar, como el
   📋 Listado y el TOTAL (A#4).
3. **🚛 Flota** (Full para cambiar): unidades del sitio; «➕ Del catálogo» (buscador sobre
   el catálogo **completo**: placa, código, serial, empresa) y «➕ Propia».
4. **📄 Reportes:** los tres papeles (sección 9).
5. **⚙️ Ajustes** (Full): sitios, listas y textos fijos.

Lectura ve 2, 3 y 4 sin botones de cambio. Sin tiempo real: refresca al entrar y al deslizar.

## 9. Papeles de la fase 1

1. **Consolidado del sitio** (papel A).
2. **Corte por unidad** (papel B): una o varias unidades (una hoja cada una); columnas =
   internos y una por destino de salida, o una sola «Salidas»; días sin anotación como 0 o
   escondidos.
3. **Listado detallado:** columnas elegibles; agrupado por día, unidad o tipo.

**Opciones** (checks y pastillas): rango y corte con hora; filtros; **¿qué se oculta?** (cada
sección y columna); **logos** de `pdfDocument` (Golden Touch por defecto, como sus papeles);
**textos editables** (título, subtítulo, presentación, consideraciones, fecha de emisión con
`emitida`); **resumen ejecutivo editable** (patrón `EdicionResumen` de `frentesReporte.ts`:
esconder, renombrar, valor y nota a mano, hasta 6 tarjetas propias, lo vacío vuelve al
automático); orden y agrupación.

**Reglas:** lo oculto no deja rastro; opciones y filtros no se anuncian en el papel (van al
nombre del archivo y a la pantalla); membrete neutro; sin página en blanco, pie en su hoja,
flechas como carácter; el formateador de números de los demás reportes. Las opciones de cada
papel se recuerdan en el equipo (con `try/catch`); los textos fijos, en `cop_ajustes`.

## 10. Lo que la fase 1 deja preparado (y lo que se pregunta después)

**Fase 2 — Pagos del sitio.** Tablas previstas: `cop_tarifas` (por unidad: modo `jornada` ·
`viaje` · `tonelada`, monto, **vigente desde**: cambiar un precio no reescribe el pasado) y
`cop_jornadas` (unidad, fecha, turno, horas o turno completo, operador en texto, nota). Papel
de pago del sitio con las mismas opciones. *Preguntas al llegar:* ¿la jornada se paga por
turno completo o proporcional a las horas?; ¿una unidad puede tener dos modos a la vez (por
ejemplo, jornada para lo interno y viaje para lo externo)?

**Fase 3 — Materiales con su costo.** Catálogo de materiales del sitio (nombre, unidad m³ o
t); movimientos de material: entrada (qué fue y de dónde), **proceso** (insumo → producto,
con cantidades), salida con destino como etiqueta (uso propio, transferencia, regalo, venta;
**no se factura**); existencias = entradas + producido − salidas. **Costo** = suma de los
componentes marcados ÷ cantidad producida en el período. Componentes: pago de las unidades del
sitio (fase 2) y otros gastos anotados (`cop_gastos`: fecha, categoría, monto, nota). **Cada
componente y cada categoría se puede llevar o no llevar** (checks). El campo `material` de la
fase 1 se vuelve una lista elegible sin perder lo ya anotado. *Preguntas al llegar:* si un
proceso da dos productos (triturado y acero), ¿cómo se reparte el costo?

**Fase 4 — Puente al consolidado.** Check **apagado por defecto** en el 💰 Reporte
consolidado: suma un grupo propio con lo que pagan las unidades del sitio según la fase 2. El
módulo sigue sin escribir afuera: el consolidado lo lee. **Riesgo:** una unidad del catálogo
con jornada en Control y también en el módulo el mismo día. Recomendación a confirmar: para
esa máquina y ese día vale lo del módulo y no se suma lo de Control, y un cuadro lista cada
caso. Es el único archivo fuera del módulo que leerá `cop_*`; el candado 2 se ajusta ahí.

## 11. Anti-objetivos

Sería un fracaso, aunque funcione, si:
- algo que ella carga cambia un número en otro módulo (salvo el check de la fase 4, que se
  prende a propósito);
- algo de otro módulo cambia, borra o bloquea un registro del módulo;
- una unidad propia aparece en Control, en Viajes o a los inspectores;
- sus papeles delatan opciones apagadas o filtros.

## 12. Candados (`scripts/test-centro-operaciones.mjs`)

1. Los archivos del módulo solo escriben en tablas `cop_*` y no llaman `rpc`.
2. Ningún archivo fuera del módulo menciona una tabla `cop_*`, salvo una lista cerrada de
   permitidos que solo las nombran: `src/types/database.ts`, `src/lib/auditModulos.ts` y la
   prueba de auditoría.
3. La librería reproduce la **estructura** de los dos papeles con **cifras y nombres
   sintéticos** (ni las cifras reales van al git público): totales, %, promedio, m³ y
   «(+N pendiente)». La comprobación con las cifras reales se hace una vez fuera del
   repositorio.
4. Opciones apagadas: el HTML no contiene la sección/columna ni su título; el nombre del
   archivo sí lo dice.
5. Fecha de corte con hora, incluida la regla de las 07:00.

## 13. Construcción

- Rama `feature/centro-operaciones` desde `dev`, en un worktree aparte (la copia principal
  tiene trabajo ajeno sin guardar). Merge a `dev`; a `main` por cherry-pick de los commits
  propios, verificando otra vez en `main` (tsc + suite completa + `git show --stat`).
- SQL (tablas, RLS, sello, `trg_audit`, la palabra en `module_level`): **por MCP, después de
  pedir permiso en texto**, verificado, **nunca al git**. `src/types/database.ts` al día.
- Librería pura `src/lib/centroOperaciones.ts`; datos en `src/lib/centroOperacionesDb.ts`;
  pantalla `src/screens/CentroOperacionesScreen.tsx` (+ componentes por pestaña).
- Toda escritura verificada con `.select('id')`.
- Manuales: `docs/MANUAL-USUARIO.md` y `src/screens/ManualScreen.tsx`.
- Probar el PDF real generado, no solo tsc.

### 13.1 Qué se reutiliza (pedido del cliente: «usa cosas que ya existen»)

- **Del sistema (fase 1):** `pdfDocument` (logos, `emitida`); el patrón de opciones y
  `EdicionResumen` de `frentesReporte.ts` / `FrentesTrabajo.tsx`; el «recibe, no envía» de
  `ReporteMaquinariaPersonalizadoCard.tsx` y su candado de escrituras; `src/lib/xlsx.ts`;
  el buscador del catálogo por placa/código/serial/empresa de `FrentesTrabajo.tsx`;
  `DateField`, `Toggle`, pastillas, `cmpText`, `leerNumero` (`src/lib/numeros.ts`).
- **De La Cantera (`Desktop/lacantera-develop`, fases 2 y 3):** el modelo de Explotación
  (plantas, producción, salidas de planta) y de Costos (centro de costo, costo por m³) como
  guía de datos y de cálculo. **No se copia código**: es otra pila (Vite + Tailwind + jsPDF)
  y no corre en esta app (Expo + `pdfDocument`).

## 14. Decisiones tomadas sin preguntar (revisar)

1. Nombre «Centro de Operaciones», clave `centro_operaciones`, prefijo `cop_`.
2. Varios sitios desde el principio; el CDT es el primero.
3. Campo `viajes` con defecto 1: sirve para cada pesada o para el total del día.
4. Contratistas en una lista propia, no en `companies`.
5. Sin llaves foráneas hacia tablas ajenas.
6. Borrar movimientos es real (Full, con confirmación; la copia queda en `audit_log`). Las
   unidades y sitios no se borran: se desactivan.
7. Buscador de unidades sobre el catálogo completo.
8. Logo Golden Touch por defecto.
9. Fecha de jornada (7am a 7am).
10. Sin cola offline; borrador local si falla el guardado.
11. Sin tiempo real.
12. Pruebas con cifras sintéticas.
13. Acceso por módulo (todos los sitios); por sitio, cuando haga falta.
14. «Por confirmar» con número se muestra como «(+V por confirmar)» aparte del «(+N
    pendiente)» de su papel; ninguno suma al total.
15. La terraza es una lista que se usa en origen y destino, no una columna.
16. Junto al texto se guarda el id de su lista (transportista, origen, destino, material).
17. Sin importador de Excel en la fase 1.
18. Las tablas `cop_*` se ven en Auditoría bajo su sección; la prueba de auditoría aprende a
    leer las tablas auditadas fuera del git.

**Aprobado por el cliente el 23/10/2026** («dale y vamos modificando»).
