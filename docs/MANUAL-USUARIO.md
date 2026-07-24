# Manual de usuario — Control de Combustible

> Guía sencilla, paso a paso. Escrita para que **cualquier persona** la entienda, aunque
> nunca haya usado un sistema. Si algo no aparece en tu pantalla, es porque tu usuario no
> tiene permiso para esa parte: pídeselo al administrador.

---

## 1. ¿Qué es este sistema?

Es una aplicación para llevar el control de la operación desde el teléfono o la
computadora: el **combustible**, las **máquinas**, las **horas que trabajan**, los
**pagos**, y más. Reemplaza los cuadernos y el papel.

Puedes usarlo de dos formas, **las dos funcionan igual**:
- En el **teléfono** (aplicación).
- En la **computadora**, abriendo la página web del sistema.

---

## 2. Cómo entrar (iniciar sesión)

1. Abre la aplicación (o la página web).
2. Escribe tu **USUARIO** y tu **contraseña**. (El usuario lo crea el administrador; tiene
   **máximo 10 caracteres**. Ya **no se entra con la cédula**.) Para revisar que la clave esté
   bien escrita, toca el **ícono de ojo 👁️** dentro del campo de contraseña.
3. Toca el botón **Entrar**.
4. Si el teléfono te lo pide, puedes entrar con tu **huella** o tu **cara** la próxima vez.

> **Cuidado con los intentos:** si te equivocas de contraseña **3 veces**, el usuario se
> **BLOQUEA** por seguridad. Solo un **administrador** puede desbloquearlo (Más → Usuarios).

> **Iniciar sesión con huella (TODOS los usuarios):** actívalo con el interruptor
> **"🔐 Iniciar sesión con huella"**. El administrador lo tiene en **Más → Seguridad**; los
> demás roles lo ven en **su propio panel**, en la sección **Seguridad**. Una vez activo, la
> app te pide tu huella o tu cara al abrirla.

> ¿Olvidaste la contraseña? Toca **"¿Olvidaste tu contraseña?"** y sigue las
> instrucciones que llegan a tu correo.

> **Cambiar tu contraseña (todos los usuarios):** ya dentro del sistema puedes
> cambiar tu clave cuando quieras. Administrador: **Más → Seguridad → "🔑 Cambiar
> mi contraseña"**. Operador, Inspector y Cocina: el botón **"🔑 Contraseña"**
> arriba, junto a **Salir**. Escribe la nueva clave (mínimo 6 caracteres),
> repítela y guarda. La próxima vez entras con la nueva.

---

## 3. Cómo moverte por el sistema

En la parte de **abajo** hay unos botones (pestañas). Cada uno te lleva a una sección.
El último botón se llama **"Más"**: ahí están todas las demás secciones.

- Para **abrir** una sección: tócala una vez.
- Para **volver atrás**: usa la flecha **←** de arriba a la izquierda.
- Para **buscar**: escribe en la barra que dice **🔎 Buscar**.

> Consejo: casi todo se **abre tocando** y se **guarda solo** o con un botón azul o verde.

---

## 4. Las secciones, una por una

### 4.1. Tanques (dónde se guarda el combustible)
Aquí ves cada tanque y **cuánto combustible le queda**.
- El nivel **se calcula solo**: no se escribe a mano.
- Para agregar un tanque nuevo: toca **+ Agregar**, llena el nombre y la capacidad, y
  toca **Guardar**.

### 4.2. Ingresos (cuando llega combustible)
Cada vez que **entra** combustible a un tanque, se registra aquí.
1. Toca **+ Agregar**.
2. Elige la **fecha**, el **tanque**, y escribe cuántos **litros** llegaron.
3. Toca **Guardar**. El tanque **sube** solo.

### 4.3. Consumos (cuando se usa combustible)
Cuando una máquina o un vehículo **carga** combustible:
1. Toca **+ Agregar**.
2. Elige si es **vehículo** o **maquinaria** y cuál.
3. Escribe los **litros** y de qué **tanque** salió.
4. Toca **Guardar**. El tanque **baja** solo.

> El sistema **no deja sacar más litros de los que hay**. Si te avisa, revisa el tanque.

### 4.4. Equipos (catálogo de máquinas)
Es la lista de **todas las máquinas**. Cada una tiene su ficha: nombre, empresa, foto,
serial y estado.

Cada máquina puede estar en **uno de tres estados**:
- 🟢 **Operativa** — trabajando normal.
- 🔴 **No operativa** — dañada o parada.
- 🕓 **En espera** — llegó pero **todavía no se ha recibido** en el control.

Para cambiar el estado, abre la máquina y toca el botón del estado que quieras.

> **Máquinas inactivas (No operativa):** al marcar una máquina como **No operativa (⛔)**, sale
> del **catálogo** y de la **lista semanal de Control de maquinaria**; solo aparece en la tarjeta
> **"🔴 Maquinaria inactiva"**. Sus **horas ya trabajadas no se borran** (siguen en los reportes).
> Al volverla **✅ Operativa**, regresa al catálogo y al control. Los detalles de **inactiva** y
> **en espera** salen **agrupados por empresa** (desplegables y colapsables). La lista de
> **inactivas arranca COLAPSADA** (se abre al tocar la empresa) y cada máquina muestra su
> **placa y su serial**.

Otras cosas que puedes hacer en cada máquina:
- 📍 **Ubicación** — guarda dónde está (con el GPS).
- 📷 **Foto** — súbele una foto.
- 🔳 **QR** — genera su código para identificarla rápido. La hoja del QR muestra el **nombre** de la
  máquina y su **serial** (o placa) — **no** la empresa. El QR queda **sellado con el serial** de la máquina: si más adelante **cambias el serial**, el QR impreso con el serial anterior **deja de funcionar** (al escanearlo solo sale el logo). Reimprime el QR para volver a activarlo con el nuevo serial. *Nota:* los QR impresos antes de esta versión no llevan sello y siguen funcionando hasta que los reimprimas.
  - **🚫 Bloquear QR:** dentro del 🔳 QR hay un botón para **bloquear** ese QR. Al bloquearlo, quien lo escanee **solo verá el logo** (no puede registrar nada). Sirve para **matar un QR viejo o robado** sin tocar el serial. Con **✅ Desbloquear QR** vuelve a funcionar.
  - **🏢 Restricción por empresa:** un **operador solo puede usar equipos de SU empresa**. Si un operador escanea el QR de una máquina de **otra empresa** e intenta identificarse, el sistema lo **bloquea** con un aviso ("Este equipo es de X, solo puedes usar equipos de tu empresa") y **no** lo deja iniciar jornada ni registrar nada. **El inspector NO tiene esta restricción:** puede escanear **cualquier** máquina y marcarla **Operativa/No** (check-in de inspección).
- 🪖 **Supervisor** — asigna quién la custodia (Empresa o Militar). Al escribir el nombre sale la lista de los ya usados para elegirlo rápido; cambiar de supervisor deja el anterior en el historial.

**Editar o borrar supervisores:** en el botón 🪖 toca **"⚙️ Editar / borrar supervisores"**. Ahí puedes **✎ renombrar** un supervisor (se corrige en **todos** sus registros) o **🗑 borrarlo** por completo (las máquinas que custodiaba quedan sin supervisor).

### 4.5. Control de maquinaria (las horas que trabaja cada máquina)
Esta es la parte del **día a día**. Aquí anotas **cuántas horas trabajó** cada máquina.

**Anotar el trabajo de un día:**
1. Elige la **semana** con las flechas ◀ ▶ o el calendario.
2. Abre la empresa y luego la máquina.
3. Por cada día verás **☀️ Día** y **🌙 Noche**. Toca:
   - **—** si no trabajó,
   - **Medio · 6h** si trabajó medio turno,
   - **Completo · 12h** si trabajó el turno completo.
4. Si te lo pide, escribe el **operador** de ese turno.
5. Todo **se guarda solo**.

> **Rol ANALISTA:** solo puede **INGRESAR horas nuevas** (día/noche, parada y extra), **no
> modificar** las ya cargadas. Cuando un valor ya está cargado aparece un **🔒** y no se puede
> cambiar; si hay que corregirlo, lo hace un **administrador**. Tampoco cambia precios.

**Sección "En espera" (recibir máquinas):**
- Arriba aparece **🕓 En espera** con las máquinas que **aún no se han recibido**.
- Para recibir una: elige su **fecha de entrada** y toca **📥 Recibir**.
- La máquina pasa a **Operativa** y ya entra al control. **Cada máquina puede tener su
  propia fecha** (no tienen que entrar todas el mismo día).

**Flete / viaje (viajes que hizo el equipo):**
- Dentro de cada máquina toca **➕ Flete / viaje**.
- Escribe la **fecha**, el **nº de viajes** y el **precio por viaje**; el sistema calcula el total.
- Ese monto se **suma al TOTAL POR PAGAR** de la empresa **en la semana de esa fecha** (sale en el reporte).
- Puedes registrar **varios** fletes y borrar los que no van con **🗑**.

**Precio por RANGO de fechas (lo nuevo):**
- En el Control, toca el **nombre de una máquina** para abrir su precio. Ahí eliges el
  **rango de fechas** (desde/hasta; por defecto el corte que estás viendo) y ese precio
  queda fijo **solo en ese rango**.
- **Cambiar el precio de un rango NO afecta los reportes de otros cortes.** Ejemplo: un
  camión puede valer **500 del 6 al 12** y **750 del 26 al 05**, y cada corte muestra su
  propio número.
- **Switch 🔒 "Blindar precio a estas fechas"** (viene activado): **clava** el precio en
  esas fechas. Si el precio **sube en otra semana, esta no cambia**; y si lo **modificas,
  solo afecta esa semana**. Todos los reportes (Informe por jornada, Maquinaria/Vehículo y
  Control de Pagos) usan ese mismo precio blindado.
- **Si no cambias el precio, se mantiene el de la semana anterior** (arrastre automático):
  una jornada sin precio propio hereda el último precio que pusiste en una fecha anterior
  de esa misma máquina. Solo tocas el precio cuando **cambia**.
- **Para corregir un corte con precio equivocado:** ve a esa semana, toca la máquina, pon
  el precio correcto con el rango de esas fechas y Guarda. El reporte de ese corte se
  actualiza al instante y los demás no se tocan. Funciona esté el corte **abierto o cerrado**.
- Al **cerrar un corte**, el sistema **congela el precio**: respeta el precio por rango ya
  fijado y a las jornadas sin precio propio les pone el precio actual de la máquina.
- **Reporte 🚚 Maquinaria/Vehículo — Con precios / Sin precios:** en **"💲 Con precios"** se
  lista **cada equipo por unidad** (para facturar) con guardia, horas, precio/hora, total y
  fletes. En **"Sin precios"** se **AGRUPAN** dentro de cada empresa los equipos iguales (todos
  los **JUMBO** juntos, todos los **CAMIÓN DE SERVICIO** juntos…) mostrando la **cantidad** y las
  horas sumadas, no una fila por unidad (Marca/Clasificación salen como el valor común o
  **"Varios"**). Todo **A→Z**.

**Cerrar el control (guardar la semana):**
- Cuando termines de anotar, toca **🔒 Cerrar control**.
- El sistema guarda todo en el **Histórico** y **congela el precio**. Lo cerrado **no se borra**.
- **Lo cerrado SIGUE viéndose en el Control** al navegar por semanas (aparece marcado con
  **🔒 cerrado**) y **se puede seguir editando** (por ejemplo, agregar días que faltaron). Ya no
  desaparece de la pantalla al cerrar.

**Corregir un cierre ya guardado (reabrir):**
- Abre el **🗂️ Histórico**, entra al cierre y toca **♻️ Reabrir cierre**.
- Sus registros **vuelven al control activo** (la semana de ese cierre) para poder
  **editarlos**, y el cierre **sale del histórico**.
- Cuando termines de corregir, **vuelve a cerrar el control** (se congela el precio de nuevo).

**Ver reportes:**
- Toca **📊 Ver reporte**, elige el **rango de fechas** y toca la empresa. Se abre una
  **ventana con la vista previa** del documento y dos botones: **🖨️ Imprimir** y
  **Cancelar**. Toca **Imprimir** para mandarlo a la impresora o guardarlo como PDF.

### 4.6. Control de pagos (cuánto se le paga a cada empresa)
Aquí se ve **cuánto hay que pagar** por las horas trabajadas, según los precios.
- El **Tabulador de precios** es la lista maestra de precios por tipo de máquina.
  Puedes **modificarlo** y **sincronizar** los precios actuales.
- **General y por empresa:** arriba del tabulador eliges **💲 General** (aplica a todas las
  empresas) o una **empresa** para ponerle su **precio propio**. Si a una empresa le pones un
  precio en un modelo, ese manda para sus máquinas; si lo **dejas vacío**, usa el **General**.
- Al **sincronizar**, cada máquina toma el precio de **su empresa** (o el General si no tiene
  uno propio) y se aplica a la **empresa correspondiente**.
- Los **cierres viejos no cambian** (quedan con el precio que tenían); los **nuevos** usan
  el precio del tabulador.

### 4.6b. Control de pago a personal (dentro de Nómina)
Calcula y paga al **personal** por **PRECIO por hora, día o semana**, definido **por
trabajador**. Está dentro de **Nómina** → **💵 Control de pago a personal**.

> El personal se paga **siempre por la organización (SOS LA GUAIRA)**, no por contratista.
> Al crear un período **no se elige empresa**: se carga a **TODO el personal activo** y todo
> queda bajo **SOS LA GUAIRA**. Así siempre hay a quién ponerle su precio.

> **🏷️ Tabulador por cargo** (botón arriba): define el sueldo **por CARGO**, no uno por uno. Es
> una **lista desplegable**: toca un cargo y se abre su **detalle** editable (sueldo semana,
> ☀️ precio día, 🌙 precio noche, precio hora). Con **"+ Cargo"** añades cargos nuevos (y salen
> los cargos de empleados que aún no tienen tabulador). Al tocar **"🔄 Sincronizar"** ese sueldo
> se copia a **todos los empleados con ese cargo**. Luego, al crear el período, ya traen su sueldo.

**Cómo se calcula:**
- Cada trabajador tiene su **Precio por hora**, **☀️ Precio por día**, **🌙 Precio por noche** y
  **Precio por semana** (los cargas/editas en el renglón de la persona y quedan guardados en su
  **ficha** para el próximo período).
- Cada período elige **"Pago por"**: **Por hora**, **Por día** o **Por semana**. El
  **devengado = precio del modo × cantidad**. En **"Por día"** el pago **separa día y noche**:
  **devengado = (jornadas ☀️ día × precio día) + (jornadas 🌙 noche × precio noche)**. El sistema
  cuenta solo las jornadas de día/noche del operador según el **turno** de cada una.
- **Regla del "Por día": SOLO los operadores cobran por día.** Un período con "Pago por = Por
  día" precarga (y en "Personal faltante" agrega) **únicamente** empleados con cargo
  **operador**. Al resto del personal se le paga en períodos **Por hora** o **Por semana**.
- El **Período** (rango de fechas) puede ser **Día**, **Semana** (dom→sáb) o **Quincena**
  (1–15 / 16–fin de mes). Las fechas se ajustan solas y también se editan a mano.
- **Total a pagar** = devengado + **bonos** − **deducciones**.

**De dónde salen las cantidades (horas / días / semanas):**
- **Operadores:** se cargan **solos** desde sus jornadas (las del escaneo de QR), cruzando
  por **cédula** dentro del rango del período. Las **semanas** = cuántas semanas distintas
  trabajaron.
- **Resto del personal:** se ajusta **a mano**. Si editas la cantidad automática, queda como
  **ajuste manual**.
- Con **"Solo jornadas validadas por el supervisor"** (activado por defecto), una jornada
  solo cuenta si el supervisor **visitó esa máquina ese día** y la marcó **🟢 Trabajando**.
  Las que no tienen visita quedan **pendientes** y **no suman** (avisa con ⚠️).

**Bonos, deducciones y pagos:**
- **Bonos** y **Deducciones** por persona (concepto + monto): ej. *Bono producción*,
  *Adelanto*, *Préstamo*.
- **Abonos:** con el período aprobado, **💵 Abonar** registra pagos parciales o totales
  (efectivo, pago móvil, transferencia…). Se ve el **Pagado** y el **Saldo pendiente**.
- **Reportes:** **🧾 Recibo** por persona y **⬇️ Reporte** del período, ambos en **PDF**.

> Las **analistas** pueden cargar cantidades, bonos y deducciones, pero **no** pueden cambiar
> los **precios** (hora/día/semana) del trabajador.

### 4.6bb. Organigrama y manual de cargos (dentro de Nómina)
Muestra la **estructura corporativa de la empresa por cargos** (no por nombres), con diseño en
dos columnas: **azul** = Administración, servicios y soporte; **naranja** = Operaciones y
mantenimiento de maquinaria. Arriba van **Director General** y **Coordinador General**. La
estructura es **fija y cubre todos los cargos**. Está dentro de **Nómina → 🗂️ Organigrama**.
Toca **"👁️ Vista previa"** para verlo con el logo de la empresa y guardarlo/imprimirlo como
**PDF**, o **"🖼️ Descargar imagen (PNG)"** para bajarlo como imagen.

**📋 Manual de cargos** (mismo panel): descarga las **funciones** de cada cargo, **de quién
depende** (reporta a) y qué **personal tiene a su cargo** (subordinados). Toca **"PDF general —
todos los cargos"** para un solo documento con todos los cargos agrupados por área, o toca un
**cargo de la lista** para descargar solo su ficha individual.

### 4.6c. Distribución de uniformes (dentro de Nómina)
Lleva las **tallas de uniforme** de cada empleado e imprime el listado para la entrega. Está
dentro de **Nómina** → **👕 Distribución de uniformes**.

1. Verás el **listado de empleados** agrupado por empresa (con **Activos / Todos** y un
   **buscador** por nombre, cédula o cargo).
2. **Toca un empleado**: se abre para cargar su **👕 talla de camisa**, **👖 talla de
   pantalón** y **👟 talla de zapatos**. Guarda.
3. Las tallas quedan en la ficha del empleado (se ven como etiquetas en cada tarjeta).
4. En ese mismo empleado, sección **📦 Registrar entrega**: escribe cuántas **👕 camisas**,
   **👖 pantalones** y **👟 zapatos** le entregas ahora y toca **"📦 Registrar entrega"**. La
   **fecha y la hora** se guardan solas. Puedes registrar **varias entregas**: se acumulan y ves
   el **total entregado** y el **historial** (con fecha y hora de cada una). Cada tarjeta muestra
   un badge **📦 Entregado** con el total de prendas recibidas.
5. Toca **"⬇️ Listado (tallas)"**: genera un **PDF** con los empleados mostrados, sus tallas y
   una columna de **FIRMA (Recibido / Entregado)** para firmar al recibir el uniforme.
6. Toca **"📦 Reporte de entregas"**: genera un **PDF** por persona con **cada entrega** (su
   **fecha y hora**) y el **total** de camisas, pantalones y zapatos entregados.
7. **Al final** del listado de tallas (en pantalla y en el PDF) sale un **📊 Resumen por tallas**:
   cuántas **camisas** hay de cada talla (M, S, L…), y lo mismo para **pantalones** y **botas de
   seguridad**, con el total de personas con talla cargada. Sirve para saber cuántas piezas pedir.

> Los PDF respetan el filtro y la búsqueda: incluyen exactamente los empleados que estás viendo.
> **Talla** = el número/letra de cada prenda; **Entrega** = cuántas piezas se le han dado (con su
> fecha y hora).

**Reporte de productos y estado (pestaña Existencias):**
- Cada producto muestra **CÓMO SE ENCUENTRA** con su color: **🔵 Nuevo**, **🟢 Bueno**,
  **🟡 Regular**, **🔴 Dañado** (o **⚪ Sin estado** si no lo has definido). Lo tildas rápido
  abriendo el producto (chips **"¿Cómo se encuentra?"**) sin entrar al editor, y **se sincroniza
  en vivo** con los demás equipos. Además muestra su **DISPONIBILIDAD** automática:
  **Disponible**, **Bajo mínimo** o **Agotado** (según la cantidad vs el stock mínimo).
- Toca **"📄 Reporte de productos (cantidad y estado)"**: genera un **PDF** con TODOS los
  productos, su **cantidad**, **disponibilidad** y **estado**.
- Al **✏️ Editar producto** puedes cambiar la **CANTIDAD** (existencia): el sistema registra
  la diferencia como un **AJUSTE DE INVENTARIO** en Movimientos.

### 4.6cc. Control de asistencia (dentro de Nómina)
Registra la **ENTRADA** y la **SALIDA** del personal **escaneando su carnet**; guarda la
**fecha y la hora** automáticamente. Se abre desde el botón grande **🕒 ASISTENCIA EMPLEADOS**
que aparece en la **pantalla de inicio** de todos los usuarios (el admin la tiene en el menú
**Más** → **🕒 Control de asistencia**).

1. Toca **"📷 Escanear carnet"** y apunta al **QR del carnet** del trabajador (si no escanea,
   búscalo por **nombre o cédula**).
2. Aparece la persona (**foto, nombre, cargo**) y sus **marcas de hoy**.
3. Toca el **botón grande**: si aún no ha entrado dice **"➡️ Marcar ENTRADA"**; si ya entró dice
   **"⬅️ Marcar SALIDA"**. La hora y la fecha se ponen solas.
   - **Hora manual** (si no dio tiempo de escanear): con la persona abierta, toca
     **"⏱️ Marcar con hora manual"**, elige la **fecha**, escribe la **hora real** en formato 24 h
     (ej. `07:30` o `19:45`), elige **ENTRADA** o **SALIDA** y toca **"💾 Registrar marca manual"**.
4. Cada marca queda etiquetada como **☀️ Día** (6:00–17:59) o **🌙 Noche** (resto), según la hora.
5. Al registrar una **SALIDA** el sistema **pide confirmación** ("¿Seguro que quieres registrar
   la salida?") y recuerda a qué hora fue la última entrada. Si la entrada fue hace **menos de
   2 minutos**, avisa **"¿Doble escaneo?"** (casi seguro escanearon el carnet dos veces por error)
   para que no se marque una salida sin querer.
6. Se permiten **varias marcas al día** (sale a almorzar y vuelve): alterna entrada/salida y
   **suma las horas presentes** de todos los pares.
7. Abajo tienes un **calendario del mes** con toda la asistencia (no solo la de hoy):
   - Usa **◀ ▶** para cambiar de mes. Los días con marcas se **resaltan** y muestran un
     **globo con el número de personas** que marcaron ese día.
   - Toca un **día** y se abre en **☀️ Día** y **🌙 Noche** (con cuántas personas hay en cada uno).
   - Toca un **turno** y ves el **detalle por persona**: entrada → salida y **horas** de cada par.
   - Cada día tiene su **📊 Reporte del día** (PDF), además del reporte por rango.

**Reporte:** toca **📊 Reporte**, elige el **rango de fechas** y genera el **PDF** (o usa el
**📊 Reporte del día** dentro del calendario). Sale por
**persona**: cada jornada con su **fecha**, **☀️/🌙 turno**, **entrada**, **salida** y **horas**,
con **subtotales de día y de noche**. Una entrada sin salida sale como **"abierta"**; las jornadas
de noche que cruzan la medianoche se emparejan bien.

> Las marcas se **sincronizan en tiempo real**: si otra persona marca desde otro dispositivo, el
> calendario se actualiza solo. **Cualquier usuario** del sistema puede marcar la asistencia con el
> botón **🕒 ASISTENCIA EMPLEADOS** (así el portero/vigilante registra al personal sin darle acceso
> al resto del sistema).

### 4.6d. Empleados — filtrar por cargo y reporte de lo seleccionado
En **Empleados** puedes filtrar la lista por **tipo de cargo** y sacar un reporte de lo que elijas:
1. En el recuadro **🏷️ Cargo**, toca para desplegar los cargos (con su cantidad).
2. **Marca uno o varios** cargos (ej. **OPERADOR**, **OBRERO**…). Se pueden combinar; **"Todos"** limpia la selección.
3. La lista de abajo muestra solo esos cargos (también se combina con **Estado** y la **búsqueda**).
4. Toca **"📊 Reporte"**: genera un **PDF** con el **listado de las personas seleccionadas**
   (nombre, cédula, ficha, cargo, empresa, estado, teléfono) y un **resumen por cargo** con el total.

> El reporte respeta TODO lo que estás viendo (estado + cargos marcados + búsqueda): imprime exactamente esa selección.

### 4.7. Mantenimiento de Maquinaria (averías + reparaciones)
Módulo para los **coordinadores de mantenimiento**. Tiene tres pestañas:
- **⏳ Averías:** lo que reportan los operadores por QR, **por empresa → máquina** (con su detalle:
  material, cantidad, nota, fecha). Se marca **✓ Realizado** cuando se atiende.
- **🔧 En reparación:** máquinas que salieron a reparación.
- **✓ Historial:** reparaciones ya cerradas.

**Enviar una máquina a reparación:** toca **"🔧 Enviar una máquina a reparación"** (o el botón en la
tarjeta de la máquina). Indica: **tipo** (correctivo/preventivo), **fecha de salida**, **por cuánto
tiempo** (días estimados) y, si quieres, **qué se le va a cambiar**. Al enviarla, la máquina queda
**No operativa** en todo el sistema.

**Registrar el retorno:** cuando vuelve, toca **"✓ Registrar retorno operativo"**, pon **qué se le
cambió** y la **fecha de retorno**. La máquina vuelve a **Operativa** automáticamente.

> Los **coordinadores de mantenimiento** (preventivo y correctivo) ven **solo** este módulo.

### 4.8. Operadores
La lista de operadores. Su vista es **sencilla a propósito**: solo lo que necesitan en el
campo.

### 4.8b. Inspecciones (rondas de inspectores)
Sirve para saber si los inspectores **sí están yendo a las máquinas** a revisar que estén
trabajando. Cada inspector entra con su usuario (**rol inspector**) y su pantalla principal es
**🪖 Revisar** (la lista de todas las máquinas para marcarlas). También tiene 🗺️ Mapa y 🚜 Catálogo.

**Cómo marca el inspector una máquina (tres formas, las tres valen):**
1. Entra con su cédula y contraseña (rol inspector). Cae en la pestaña **🪖 Revisar**.
2. **Desde la lista:** busca la máquina y **tócala** (o toca **"📷 Escanear QR"** si la tiene
   pegada). **Ya no hace falta el QR físico** para marcarla.
3. **Escaneando el QR con la CÁMARA del teléfono** (aunque no esté dentro del sistema): al abrir,
   toca el botón azul **"🪖 SOY INSPECTOR — ENTRAR"**, inicia sesión con su usuario y va
   **directo** al check-in de esa máquina (no pasa por la identificación de operador).
4. El sistema toma su **ubicación GPS** y calcula qué tan cerca está de la máquina.
5. Elige el estado: 🟢 **Trabajando**, 🟡 **Parada** o 🔴 **No está**, y una nota si quiere.
6. Toca **"✅ Marcar como revisada"**. Queda la hora, el estado y la distancia.

> El inspector puede marcar **cualquier** máquina (no tiene la restricción por empresa del
> operador). El operador, en cambio, solo puede usar equipos de **su** empresa.

**👷 Iniciar la jornada del operador (si no tiene teléfono):** dentro del mismo check-in de la
máquina, el inspector puede arrancar la jornada del operador con **su** teléfono:
1. Toca **"📷 Escanear carnet del operador"** y lee el **QR del carnet** del operador.
2. El sistema valida que sea **operador/chofer/servicios generales/obrero** de la nómina y que tenga cédula.
3. El inspector **coteja la cédula** (debe coincidir con el carnet) e ingresa el **horómetro inicial**.
4. Toca **"🟢 Iniciar jornada del operador"**. Queda registrada la jornada en esa máquina (con las
   mismas reglas: 1 máquina por operador al día y máximo 2 operadores por turno) y la marca de
   quién la registró (el inspector). La ubicación del inspector queda como punto de inicio.

> Antes el inspector **solo** podía marcar escaneando el QR físico de cada máquina; ahora su
> pantalla **🪖 Revisar** lista todas las máquinas y puede marcar cualquiera directo. El check-in
> aparece de inmediato en el módulo **Inspecciones** (Traza por inspector) y **valida la jornada**.

> **Inspector asignado:** el inspector que hizo el **último check-in** de una máquina queda como su
> **inspector asignado** y se muestra en el **Catálogo** y en **Control de maquinaria** (🪖 Inspector: nombre).

> La cercanía es **amplia a propósito** (unos 300 m): si la máquina está trabajando y no se
> puede interrumpir, basta con estar "más o menos cerca". Si está lejos, igual se guarda pero
> queda marcado **"lejos ⚠️"**.

> **REGLA IMPORTANTE:** si el inspector **NO marca** una máquina que trabajó ese día, esa
> jornada queda **"sin validar"** y **el operador no cobra**.

**Módulo "Inspecciones" (para el jefe, en Más):** muestra por día quién marcó cada máquina, a
qué hora, con qué estado y qué tan cerca estaba, y sobre todo la lista de **"⛔ Jornadas sin
validar"** (máquinas que trabajaron pero que ningún inspector marcó). Con las flechas ◀ ▶
cambias de día. En **"Traza por inspector"** puedes **tocar cualquier máquina** de la lista y
te lleva a su **ficha en el Catálogo** (con todos sus datos y acciones); el **›** al final de
cada renglón indica que es clickeable.

Cada inspector trae un **resumen de cercanía** para saber qué tan confiables fueron sus rondas:
**✓ en sitio** (estuvo cerca, dentro de ~300 m), **⚠️ lejos** (marcó sin estar al lado) y
**• sin GPS** (no se pudo verificar). El botón **"📄 Reporte de inspecciones (PDF)"** genera el
informe del día con ese resumen por inspector, el detalle de cada visita (hora, máquina,
empresa, estado y ubicación) y las jornadas sin validar.

### 4.8c. Distribución de comida
Lleva el control de **cuántas comidas** se le reparten a cada persona. Quien reparte es un
usuario con **rol Cocina** (entra con su nombre y contraseña).

**Cómo se registra una comida:**
1. La persona de **Cocina** inicia sesión.
2. Se **verifica** escaneando **su propio carnet** (o por **cédula**). Solo se habilita si su
   **cargo en nómina** es de cocina/alimentación (**ayudante de cocina, alimentación, cocinero,
   cocina**). Si su cargo no es de cocina, **no puede** ingresar cantidades.
3. **Escanea el carnet de nómina** de la persona (el mismo del empleado) o la busca por **cédula**.
4. Ve los datos de la persona (foto, cargo, cédula).
5. Marca **Desayuno**, **Almuerzo** o **Cena**: cada botón se marca **1 sola vez por día** por persona.
6. Queda guardado con la **hora**. Debajo se ve lo ya marcado hoy a esa persona.

> Debajo se ve lo que ya se le entregó a esa persona **hoy** y el total. Si te equivocaste,
> puedes borrar una entrega con 🗑.

> Si escaneas el **carnet pegado (sticker)** con la cámara del teléfono: estando con sesión de
> Cocina abre **directo** el registro de esa persona; si no has entrado, toca **"🍽️ ¿Eres de
> cocina? Inicia sesión"** y al entrar caes en el registro de esa misma persona.

**Módulo "Distribución de comida" (en Más, para el jefe):** por día muestra las comidas
repartidas **por empresa** (desayuno/almuerzo/cena) y también **por persona**, con sus totales.
Con las flechas ◀ ▶ cambias de día.

**Comida POR EMPRESA (con QR):**
1. En **Distribución de comida** (jefe), toca **"🖼️ QR por empresa (imágenes)"** y descarga el QR
   de cada empresa como **imagen individual** (logo + QR + nombre). Las **empresas desactivadas
   no aparecen**.
2. La cocina **escanea el QR** de la empresa (con la **cámara del teléfono** O desde el botón
   **"Escanear carnet"** dentro de su propia pantalla de Cocina) → se abre la pantalla de comidas
   del día de esa empresa.
3. Se **verifica** con su carnet/cédula (solo **cargo de cocina/alimentación**).
4. Toca uno de los **3 botones grandes**: **Desayuno, Almuerzo o Cena** (cada uno **1 sola vez
   por día** por empresa).
5. El sistema **sugiere** el total = **máquinas de la empresa × 2 + 15**; el cocinero escribe
   cuántas comidas **entregó realmente** y registra.

> Queda guardado con la **empresa**, la **cantidad**, la **hora** y **quién** la registró.
> Ese registro **ES el control de asistencia/entrega** de la empresa.

> **Empresa "solo comidas":** en **Empresas** (admin) puedes marcar una empresa como
> **"🍽️ Solo comidas"**. Esa empresa aparecerá **únicamente en la distribución de comidas** y
> **no saldrá en ningún otro** selector, lista ni reporte del sistema (p. ej. **PNB Canica**).
> Es distinto de **"🚫 Ocultar"**, que la desactiva en todo (incluida la comida).

**Control por empresa (asistencia/entrega):** en **Distribución de comida** (jefe) toca la
pestaña **"📊 Control por empresa"**. Elige un **rango de fechas** (o los atajos *Hoy / 7 días /
30 días*) y verás:
- **Totales del rango**: total entregado y cuánto por desayuno, almuerzo y cena.
- **Resumen por empresa**: cuánto entregó cada empresa por tiempo de comida y en cuántos días.
- Al elegir **una empresa** (filtro de arriba): su **historial día por día** con lo entregado en
  cada comida, la hora y quién lo registró.
- Botón **"📄 Descargar reporte PDF"** para imprimir/llevar el control por empresa del rango.

### 4.8d. Inventario (materiales, requerimiento y traslados)
Control de **materiales y herramientas**. El inventario es **GENERAL** (no se separa por empresa
ni por máquina al crearlo). Cada material tiene su **existencia** (cuánto hay) y su **costo
promedio (PMP)**, que el sistema calcula solo con las entradas. El **SKU** es automático e
incremental (INV-0001, INV-0002…). Pestañas: **Existencias, Salida, Nota de
traslado, Gastos, Requerimiento y Movimientos**.

**💵 Precios en $ y en Bs (tasa BCV):** en **Existencias**, arriba, se muestra la **tasa del BCV
del día** (Bs por US$). El sistema la **baja automáticamente** cada día; con **🔄 Actualizar** la
refrescas y los **administradores** pueden **fijarla a mano** (por si el servicio falla). Cada
producto muestra su **PMP y su valor en stock en $ y en Bs** al cambio del día. Al cargar un
**costo**, puedes escribirlo en **$ o en Bs** (con el botón **$↔Bs**): el sistema guarda el precio
en **US$** y te muestra el equivalente en la otra moneda.

**🏷️ Tipo de producto y filtro:** al crear/editar un producto puedes ponerle un **TIPO**
(bombona, silla, mecate…) — lo escribes o lo tocas de las sugerencias. Arriba de la lista aparece
**"Filtrar por tipo"** con un chip por cada tipo (y su cantidad): toca uno para ver **solo esos
productos**. El tipo también sale en el **reporte de productos**.

**🛢️ Bombonas — carga (vacía / en uso / llena):** en los productos tipo **bombona** aparecen
botones para tildar su carga (🔴 vacía, 🟡 en uso, 🟢 llena) directo en la tarjeta o en el editor
(vuelve a tocar el mismo para quitarlo). Arriba tienes **"Filtrar por carga"** para ver solo las
llenas, en uso o vacías, y **"🛢️ Reporte de bombonas por carga"** genera un PDF con cuántas hay
en cada estado. Si una bombona sale en **"Sin definir"** es porque **aún no le tildaste la carga**
(por eso los contadores 🟢🟡🔴 dan **0**). Cada bombona registrada **cuenta como 1** aunque su
existencia esté en 0; si tiene cantidad mayor, se **suma esa cantidad**.

**🗑 Eliminar un producto:** entra a **✏️ Editar producto** y abajo toca **"🗑 Eliminar
producto"**. Pide confirmación y borra el producto **y todo su historial** de movimientos
(no se puede deshacer).

**Salida** — el documento (nota de salida) que se hace cuando salen materiales:
1. Ve a la pestaña **"📤 Salida"**.
2. Busca cada producto y agrégalo; indica la **cantidad** de cada uno.
3. Elige la **🚜 máquina** (lista desplegable y filtrable) y los **👷 empleados** que reciben
   (lista de la nómina, filtrable, se pueden marcar varios). Escribe el destino/motivo si quiere.
4. Toca **"🧾 Generar nota de salida (PDF)"**: se abre la **vista previa** con logo, fecha, productos y la
   línea de firma autorizado.
5. Toca **🖨️ Imprimir** para guardar/imprimir. **Recién ahí se descuenta del inventario.**

> **IMPORTANTE:** la salida se descuenta del inventario **SOLO cuando confirmas**
> (Imprimir/Guardar). Si le das **Cancelar** en la vista previa, **no se descuenta nada** y **no
> se pierde** lo que ya elegiste: productos, cantidades, máquina y empleados quedan tal cual para
> seguir editándolos.

**Gastos** — cada material que **sale del almacén es un gasto**. En la pestaña **"💸 Gastos"**
ves el **TOTAL GASTADO**. Cuenta todo lo que sale del almacén: **salidas y consumos** manuales,
**notas de entrega** y **traslados**; cada gasto se valoriza al **PMP** que tenía el material al
salir. Elige el **período** (Hoy, Esta semana, Este mes o Todo) y el total se recalcula solo. Ves
el desglose **por categoría** (toca una para filtrar solo esos gastos; tócala de nuevo para
quitarlo) y con **"📄 Reporte de gastos (PDF)"** obtienes el resumen por categoría más el detalle
de cada salida (fecha, producto, cantidad, costo y gasto) con el total. Las **entradas (compras)**
y los **ajustes NO** cuentan como gasto: el gasto es el material que efectivamente sale.

**📝 Requerimiento (pedir compras al jefe):** en la pestaña **"📝 Requerimiento"** armas una lista
de productos que hacen falta —**del inventario** (los traes) o **NUEVOS** (los escribes)— con
cantidad y **precio estimado** (en **$ o Bs**). Al **📤 Enviar al jefe** queda guardado como
**Pendiente**. El **jefe (administrador)** lo **✅ Aprueba** o lo **❌ Rechaza**. Si se compra, el
administrador toca **"📥 Recibir en inventario"**, confirma la **cantidad y el precio real** de cada
producto, y el sistema **crea la entrada** en el almacén (los productos nuevos **se crean solos**);
el requerimiento queda como **Recibido**. Con **🧾 PDF** puedes imprimir el requerimiento para
pasárselo al jefe. Así todo queda trazado: quién lo pidió, quién lo aprobó y cuándo se recibió.
Cada requerimiento tiene además **"✏️ Editar"** (cambia título, nota y productos — no si ya fue
recibido) y **"🗑️ Eliminar"** (borra todo el requerimiento, con confirmación), para quien tenga
escritura en Inventario.

**🔁 Nota de traslado (entre máquinas):** pestaña **🔁 Nota de traslado**. Tiene dos vistas:
**🔁 Trasladar** y **📋 Realizados**.
- **Trasladar:** eliges los materiales con stock, defines el **Origen** (máquina + responsable) y el
  **Destino** (máquina + responsable), el **📍 lugar/obra** a donde va, el **estado del material**
  (**usado / lleno / vacío / dañado**) y un motivo opcional. Al **generar**, se abre la vista previa del PDF;
  al **confirmar**, se **descuenta del inventario** y queda guardado el traslado. Si cancelas, no se
  descuenta nada.
- **Realizados:** ves la lista de traslados. En cada uno tocas **"↩️ Retornar al inventario"**:
  indicas el **estado** con que vuelve (usado/dañado/lleno/vacío) y **cuánto queda disponible**, y eso
  **reingresa la cantidad al almacén** (queda como entrada, sin cambiar el costo promedio).
- **📄 Reporte:** el botón **"📄 Reporte"** (arriba, visible en ambas vistas) genera un **PDF con
  todos los traslados** —de cualquier estatus— con fecha, origen → destino, lugar, estado, materiales
  y si ya se **retornaron** o siguen **en destino**.

### 4.9. Autorizaciones
Cuando algo necesita **permiso**, se pide aquí. La persona autorizada lo **aprueba** o lo
**rechaza**.

### 4.10. Traslados
Para mover combustible **de un tanque a otro**. Se descuenta de uno y se suma al otro,
automáticamente.

### 4.11. Mapa
Muestra **en un mapa** dónde está cada máquina (según su última ubicación GPS).
- Con el panel **🗺️ Sectores (zonas)** ves u ocultas las **zonas de La Guaira** (Sector Oeste
  y Sector Este). Cada zona tiene su **color** y sus **límites** (Oeste/Este). El **nombre** de
  la zona aparece al **pasar el cursor** por encima (computadora) o al **tocar** la zona (teléfono).
- Con el panel **🗂️ Capas** prendes y apagas los puntos por **TIPO de equipo** (igual que el
  Conteo: payloaders, jumbos, tractores, cisternas…). Cada tipo muestra cuántas están
  **UBICADAS del total** (ej. **📍 22/25 · faltan 3**) y arriba el total ubicadas/total del
  sistema, para saber cuántas **faltan por ubicar**.
  Usa **"Mostrar todas" / "Ocultar todas"**, o toca un tipo para ver sus máquinas y
  elegir una por una.
- **📍 Ubicar manualmente (solo administradores):** en el panel **"Ubicar manualmente (admin)"**
  eliges una máquina (las que faltan por ubicar salen primero) y **tocas el mapa** en el punto
  donde está; queda ubicada al instante. **Solo los administradores** pueden reubicar máquinas
  y eliminar ubicaciones del mapa.
- **📄 Referencias por inspector (reporte PDF):** hoja de **ruta de inspección**. Agrupa las
  máquinas por su **inspector asignado** (quien hizo el último check-in, igual que en el catálogo)
  y por cada inspector lista sus máquinas con **placa/serial**, la **referencia** de ubicación
  (edificio, parque, plaza, calle) y la **empresa**. Las que tienen referencia pero aún sin
  inspector salen en **"Sin inspector asignado"**.
- **🕵️ Monitoreo (solo administradores):** el panel **"Monitoreo · quién ubica"** (colapsable,
  igual que Sectores) muestra **quién colocó** cada ubicación, con su **fecha y hora**. Toca una
  fila para ver esa máquina en el mapa. Sirve para **vigilar quién está haciendo las ubicaciones**.
  *Nota:* solo registra el nombre a partir de ahora; las ubicaciones anteriores salen sin autor.

### 4.12. Reportes
Genera documentos **PDF** para imprimir o compartir, eligiendo el **rango de fechas** y la
**empresa**. Al generarlos se abre una **ventana con la vista previa** y los botones
**🖨️ Imprimir** y **Cancelar**.

### 4.13. Usuarios (solo administrador)
Para crear personas que usan el sistema y **decidir qué puede ver cada una**.

**🏷️ Roles del sistema (roles FIJOS):** en Usuarios, toca **"🏷️ Roles del sistema →
Administrar"**. Ahí puedes:
- **Crear un rol** (ej. *Coordinador de Operadores*): le pones un **nombre** y eliges **qué módulos
  ve** (sin acceso / L / E / F por módulo).
- Ver los roles en una **lista buscable** y **quitarlos** (🗑️).

> Todos los roles son **FIJOS**: los que creas navegan por la **app normal** (pestañas + Más)
> mostrando solo los módulos que les marques. **Ya no hay "panel dinámico" aparte.** Así, con
> darle permiso a un módulo (ej. Inspecciones de Maquinaria) ya le aparece, sin configurar más.

**Rol asignado (unificado):** cada usuario tiene **UN solo rol**. En su tarjeta se ve
**"Rol asignado: X"**. Para elegirlo o cambiarlo:
- **Al crear** el usuario: en **"Rol asignado"** se abre una **lista desplegable** con **todos
  los roles** — los **del sistema** (admin, inspector, analista, operador, conductor, cocina,
  coordinador de patio) y los **personalizados** (los que creaste en 🏷️ Roles del sistema).
- **Al editar** el usuario: toca **"Rol asignado → Cambiar ▾"** y elige el nuevo rol.

Un usuario con un rol **personalizado** ve **SOLO** los módulos de ese rol (no ve el resto):
en las pestañas de abajo verá **Inicio** y **Más** siempre, y **Control / Mapa / Catálogo**
solo si su rol tiene ese módulo. (No puedes cambiar **tu propio** rol.)

**Catálogo de roles:** el administrador **crea, EDITA (✏️) y borra** roles FIJOS. Al
crear/editar eliges el **TIPO**:
- **📋 Módulos** — rol fijo que navega por la **app normal** (pestañas + Más) mostrando solo los
  módulos marcados.
- **📷 Coordinador QR** — el usuario ve un panel con **escáner QR** (surtir gasoil, avería,
  marcar máquina lista). No usa módulos.

No se puede **borrar** un rol si tiene **usuarios vinculados** (el sistema te avisa).

---

### 4.20. Surtir gasoil (por QR)

Se registra el surtido de gasoil escaneando el **QR de la máquina**, desde: el **Inspector**
(en su check-in), el **Coordinador de Patio** y los **Coordinadores QR**.

1. Toca **"⛽ Surtir gasoil"** y escanea el QR de la máquina.
2. Escribe el **HORÓMETRO** actual y los **LITROS** surtidos.
3. Toca **"Registrar surtido"**.

> La pantalla muestra el **SURTIDO total** (litros echados) y el **CONSUMIDO estimado**
> (horas desde el último surtido × rendimiento L/h de la máquina), para comparar.

---

### 4.21. Coordinador de Patio

Rol para controlar la **entrada y salida de camiones** al patio, y reportar averías, por QR.

- **📷 Escanear QR** → elige **ENTRADA** o **SALIDA** del camión (queda con la hora).
- **⛽ Surtir gasoil** → horómetro + litros.
- **🛠️ Avería** → reporta la falla (va a Mantenimiento).
- **🚚 Entrada y salida de camiones** → un **CALENDARIO**: cada día muestra cuántos camiones
  entraron (↓) y salieron (↑); toca un día para el detalle. (El administrador también lo ve
  dentro de *Inspecciones*.)

---

### 4.22. Panel Coordinador QR (preventivo, correctivo, almacén…)

Los roles con panel **📷 Coordinador QR** ven botones grandes: escanean el QR de la máquina y:

- **⛽ Surtir gasoil** (horómetro + litros).
- **🛠️ Registrar avería** (va a Mantenimiento).
- **✅ Marcar máquina lista** → cierra las **averías pendientes** de esa máquina y la vuelve
  **Operativa**.

El panel también trae **Cambiar contraseña**, **Huella** y **Salir**.

---

## 4.23. Notificaciones (la campana) 🔔

Arriba a la derecha, junto a la fecha y hora, aparece una **campana 🔔** (solo para el **administrador**). Avisa de lo que va pasando en el sistema sin tener que revisar cada módulo.

Hoy te avisa cuando:

- **📝 Inventario:** alguien monta un **requerimiento**.
- **🛒 Compras:** se crea una **solicitud de compra**.
- **🛠️ Control:** se guarda un **cierre de control** (con el rango de fechas y cuántas máquinas).

El **número rojo** sobre la campana es la cantidad **sin leer**. Toca la campana para ver la lista; toca un aviso para marcarlo leído e **ir directo al módulo**. También hay **"Marcar todo leído"**. Cada quien tiene sus propios "leídos" (que un admin lo lea no lo marca para otro) y se actualiza sola en línea.

---

## 4.24. Inspecciones de Maquinaria (control por equipo) 🔍

Módulo para inspeccionar **cada equipo**: qué herramientas/accesorios tiene y en qué estado, con su **REPORTE DE INSPECCIÓN** en PDF.

1. Entra a **"Más → 🔍 Inspecciones de Maquinaria"**.
2. Busca el equipo por **placa, serial o nombre** y tócalo (son los mismos equipos del **catálogo**, en orden A→Z natural).
3. Ves su **detalle** (placa/serial/empresa) y el **historial** de inspecciones. Cada una tiene **"📄 PDF"** (reimprimir), **"✏️ Editar"** (reabre el formulario con todos sus datos para corregir y regenerar el PDF) y **"🗑️ Eliminar"** (con confirmación).
4. Toca **"📋 REPORTE DE INSPECCIÓN (nueva)"**.
5. Pon **fecha y hora**, agrega los **ítems** (descripción, cantidad, serial/especificación y su **estado** con color 🟢 Bien / 🟠 Regular / 🔴 Falla), las **observaciones** y, opcional, el **inspector** y el **chofer/operador** (para las firmas).
6. Toca **"💾 Guardar y generar REPORTE DE INSPECCIÓN"**: se guarda en el historial y se abre el PDF (nombre **"REPORTE DE INSPECCION - <equipo>"**).

> **Control por equipo:** al hacer una inspección **nueva** se **precargan los ítems de la última**, así solo ajustas cantidades y estados sin reteclear todo.

---

## 5. Cosas que sirven en TODAS las secciones

- **🔎 Buscar:** escribe parte del nombre, serial o empresa.
- **🏢 Filtrar por empresa:** toca el selector de empresa para ver solo esa.
- **📅 Rango de fechas:** en los reportes, elige "desde" y "hasta".
- **Guardar:** el botón **verde** o **azul** confirma. El **rojo** detiene o cancela.
- **Volver:** la flecha **←** de arriba.
- **🔢 Números:** los campos de **cédula, dinero, horas, litros y kilómetros** solo aceptan
  **números** (no dejan escribir letras).
- **🖨️ Imprimir:** los reportes se abren en una **ventana con vista previa** y los botones
  **Imprimir** y **Cancelar**.
- **🔄 Actualizaciones:** cuando se publica una versión nueva del sistema, aparece abajo una
  **barra azul** que dice *"Sistema en proceso de actualización"*. Toca el botón **ACTUALIZAR**
  y la página se refresca con la versión nueva. Ya no hace falta refrescar a mano.

---

## 6. Preguntas frecuentes

**No veo una sección.**
Tu usuario no tiene permiso para esa parte. Pídeselo al administrador.

**Me equivoqué al anotar las horas.**
Vuelve a tocar la opción correcta (—, Medio o Completo). Se corrige y se guarda solo.

**¿El nivel del tanque se escribe a mano?**
No. Se calcula solo con los ingresos, consumos y traslados.

**Cerré el control sin querer.**
No pasa nada: lo cerrado queda guardado en el **Histórico**. Puedes seguir anotando la
semana siguiente.

**Se ve distinto en el teléfono y en la computadora.**
Es normal: se acomoda a la pantalla. Funciona igual en ambos.

---

## 7. Recomendaciones para el día a día

1. Anota el trabajo de las máquinas **el mismo día**; así nada se olvida.
2. Revisa que cada turno tenga su **operador**.
3. Antes de **cerrar el control**, revisa el reporte para confirmar las horas.
4. Sube la **foto** y la **ubicación** de las máquinas nuevas.
5. Cuando llegue una máquina, recíbela desde **En espera** con su **fecha de entrada**.

---

> Este manual es general y se irá ampliando con las secciones nuevas (empleados y fichas,
> nómina, compras, inventario y ganancias) a medida que estén listas.
