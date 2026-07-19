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
2. Escribe tu **cédula** y tu **contraseña**. Para revisar que la clave esté bien escrita,
   toca el **ícono de ojo 👁️** dentro del campo de contraseña para **mostrarla u ocultarla**.
3. Toca el botón **Entrar**.
4. Si el teléfono te lo pide, puedes entrar con tu **huella** o tu **cara** la próxima vez.

> ¿Olvidaste la contraseña? Toca **"¿Olvidaste tu contraseña?"** y sigue las
> instrucciones que llegan a tu correo.

> **Cambiar tu contraseña (todos los usuarios):** ya dentro del sistema puedes
> cambiar tu clave cuando quieras. Administrador: **Más → Seguridad → "🔑 Cambiar
> mi contraseña"**. Operador, Supervisor y Cocina: el botón **"🔑 Contraseña"**
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
> **en espera** salen **agrupados por empresa** (desplegables y colapsables), igual que el catálogo.

Otras cosas que puedes hacer en cada máquina:
- 📍 **Ubicación** — guarda dónde está (con el GPS).
- 📷 **Foto** — súbele una foto.
- 🔳 **QR** — genera su código para identificarla rápido. La hoja del QR muestra el **nombre** de la
  máquina y su **serial** (o placa) — **no** la empresa. El QR queda **sellado con el serial** de la máquina: si más adelante **cambias el serial**, el QR impreso con el serial anterior **deja de funcionar** (al escanearlo solo sale el logo). Reimprime el QR para volver a activarlo con el nuevo serial. *Nota:* los QR impresos antes de esta versión no llevan sello y siguen funcionando hasta que los reimprimas.
  - **🚫 Bloquear QR:** dentro del 🔳 QR hay un botón para **bloquear** ese QR. Al bloquearlo, quien lo escanee **solo verá el logo** (no puede registrar nada). Sirve para **matar un QR viejo o robado** sin tocar el serial. Con **✅ Desbloquear QR** vuelve a funcionar.
  - **🏢 Restricción por empresa:** un **operador solo puede usar equipos de SU empresa**. Si un operador escanea el QR de una máquina de **otra empresa** e intenta identificarse, el sistema lo **bloquea** con un aviso ("Este equipo es de X, solo puedes usar equipos de tu empresa") y **no** lo deja iniciar jornada ni registrar nada. **El supervisor NO tiene esta restricción:** puede escanear **cualquier** máquina y marcarla **Operativa/No** (check-in de supervisión).
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

**Precio congelado al cerrar:**
- Al **cerrar un corte**, el sistema **congela el precio** de cada máquina de ese corte.
- Si en el siguiente corte una máquina **sube o baja de precio**, el corte cerrado **mantiene su total original** (en el reporte y en el Histórico). Los cortes **abiertos** usan el precio actual.

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

**Cómo se calcula:**
- Cada trabajador tiene su **Precio por hora**, **Precio por día** y **Precio por semana**
  (los cargas/editas en el renglón de la persona y quedan guardados en su **ficha** para el
  próximo período).
- Cada período elige **"Pago por"**: **Por hora**, **Por día** o **Por semana**. El
  **devengado = precio del modo × cantidad** (horas, días o semanas trabajadas).
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

### 4.6bb. Organigrama (dentro de Nómina)
Muestra la **estructura de la empresa por cargos** (no por nombres). Está dentro de **Nómina**
→ **🗂️ Organigrama**. Toca **"👁️ Vista previa"** para verlo con el logo de la empresa y
guardarlo/imprimirlo como **PDF**, o **"🖼️ Descargar imagen (PNG)"** para bajarlo como imagen.
Se **sincroniza con la nómina**: si en Empleados hay cargos que aún no están ubicados en el
organigrama, aparecen en una caja **"🆕 Otros cargos (por ubicar)"** para que no se pierdan.

### 4.6c. Distribución de uniformes (dentro de Nómina)
Lleva las **tallas de uniforme** de cada empleado e imprime el listado para la entrega. Está
dentro de **Nómina** → **👕 Distribución de uniformes**.

1. Verás el **listado de empleados** agrupado por empresa (con **Activos / Todos** y un
   **buscador** por nombre, cédula o cargo).
2. **Toca un empleado**: se abre para cargar su **👕 talla de camisa**, **👖 talla de
   pantalón** y **👟 talla de zapatos**. Guarda.
3. Las tallas quedan en la ficha del empleado (se ven como etiquetas en cada tarjeta).
4. Toca **"⬇️ Imprimir listado"**: genera un **PDF** con los empleados mostrados, sus tallas y
   una columna de **FIRMA (Recibido / Entregado)** para firmar al recibir el uniforme.
5. **Al final** (en pantalla y en el PDF) sale un **📊 Resumen por tallas**: cuántas **camisas**
   hay de cada talla (M, S, L…), y lo mismo para **pantalones** y **botas de seguridad**, con el
   total de personas con talla cargada. Sirve para saber cuántas piezas de cada talla pedir.

> El PDF respeta el filtro y la búsqueda: imprime exactamente los empleados que estás viendo.
> La columna de firma va en blanco para que cada persona firme el recibido/entregado.

**Reporte de productos y estado (pestaña Existencias):**
- Cada producto tiene un **ESTADO físico** (**Nuevo / Bueno / Regular / Dañado**) que eliges
  al crear o editar. Además muestra su **DISPONIBILIDAD** automática: **Disponible**, **Bajo
  mínimo** o **Agotado** (según la cantidad vs el stock mínimo).
- Toca **"📄 Reporte de productos (cantidad y estado)"**: genera un **PDF** con TODOS los
  productos, su **cantidad**, **disponibilidad** y **estado**.
- Al **✏️ Editar producto** puedes cambiar la **CANTIDAD** (existencia): el sistema registra
  la diferencia como un **AJUSTE DE INVENTARIO** en Movimientos.

### 4.6cc. Control de asistencia (dentro de Nómina)
Registra la **ENTRADA** y la **SALIDA** del personal **escaneando su carnet**; guarda la
**fecha y la hora** automáticamente. Está dentro de **Nómina** → **🕒 Control de asistencia**
(también aparece en el menú **Más** o en el panel del rol, según tus permisos).

1. Toca **"📷 Escanear carnet"** y apunta al **QR del carnet** del trabajador (si no escanea,
   búscalo por **nombre o cédula**).
2. Aparece la persona (**foto, nombre, cargo**) y sus **marcas de hoy**.
3. Toca el **botón grande**: si aún no ha entrado dice **"➡️ Marcar ENTRADA"**; si ya entró dice
   **"⬅️ Marcar SALIDA"**. La hora y la fecha se ponen solas.
4. Se permiten **varias marcas al día** (por ejemplo, sale a almorzar y vuelve): alterna
   entrada/salida y **suma las horas presentes** de todos los pares.
5. Abajo ves **"Marcas de hoy"** con todo lo registrado en el día.

**Reporte:** toca **📊 Reporte**, elige el **rango de fechas** y genera el **PDF**. Sale por
**persona y por día**: entradas/salidas, cuántos pares y el **total de horas presentes**. Si
alguien marcó entrada pero no salida, ese día sale como **"jornada abierta"**.

> Solo los usuarios con el módulo **Control de asistencia** ven y usan esta pantalla (por
> ejemplo, quienes tengan el rol **ALMACENISTA**). Los demás no la ven.

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

### 4.8b. Supervisión (rondas de supervisores)
Sirve para saber si los supervisores **sí están yendo a las máquinas** a revisar que estén
trabajando. Cada supervisor entra con su usuario (**rol Supervisor**) y su pantalla principal es
**🪖 Revisar** (la lista de todas las máquinas para marcarlas). También tiene 🗺️ Mapa y 🚜 Catálogo.

**Cómo marca el supervisor una máquina (tres formas, las tres valen):**
1. Entra con su cédula y contraseña (rol Supervisor). Cae en la pestaña **🪖 Revisar**.
2. **Desde la lista:** busca la máquina y **tócala** (o toca **"📷 Escanear QR"** si la tiene
   pegada). **Ya no hace falta el QR físico** para marcarla.
3. **Escaneando el QR con la CÁMARA del teléfono** (aunque no esté dentro del sistema): al abrir,
   toca el botón azul **"🪖 SOY SUPERVISOR — ENTRAR"**, inicia sesión con su usuario y va
   **directo** al check-in de esa máquina (no pasa por la identificación de operador).
4. El sistema toma su **ubicación GPS** y calcula qué tan cerca está de la máquina.
5. Elige el estado: 🟢 **Trabajando**, 🟡 **Parada** o 🔴 **No está**, y una nota si quiere.
6. Toca **"✅ Marcar como revisada"**. Queda la hora, el estado y la distancia.

> El supervisor puede marcar **cualquier** máquina (no tiene la restricción por empresa del
> operador). El operador, en cambio, solo puede usar equipos de **su** empresa.

**👷 Iniciar la jornada del operador (si no tiene teléfono):** dentro del mismo check-in de la
máquina, el supervisor puede arrancar la jornada del operador con **su** teléfono:
1. Toca **"📷 Escanear carnet del operador"** y lee el **QR del carnet** del operador.
2. El sistema valida que sea **operador/chofer/servicios generales/obrero** de la nómina y que tenga cédula.
3. El supervisor **coteja la cédula** (debe coincidir con el carnet) e ingresa el **horómetro inicial**.
4. Toca **"🟢 Iniciar jornada del operador"**. Queda registrada la jornada en esa máquina (con las
   mismas reglas: 1 máquina por operador al día y máximo 2 operadores por turno) y la marca de
   quién la registró (el supervisor). La ubicación del supervisor queda como punto de inicio.

> Antes el supervisor **solo** podía marcar escaneando el QR físico de cada máquina; ahora su
> pantalla **🪖 Revisar** lista todas las máquinas y puede marcar cualquiera directo. El check-in
> aparece de inmediato en el módulo **Supervisión** (Traza por supervisor) y **valida la jornada**.

> La cercanía es **amplia a propósito** (unos 300 m): si la máquina está trabajando y no se
> puede interrumpir, basta con estar "más o menos cerca". Si está lejos, igual se guarda pero
> queda marcado **"lejos ⚠️"**.

> **REGLA IMPORTANTE:** si el supervisor **NO marca** una máquina que trabajó ese día, esa
> jornada queda **"sin validar"** y **el operador no cobra**.

**Módulo "Supervisión" (para el jefe, en Más):** muestra por día quién marcó cada máquina, a
qué hora, con qué estado y qué tan cerca estaba, y sobre todo la lista de **"⛔ Jornadas sin
validar"** (máquinas que trabajaron pero que ningún supervisor marcó). Con las flechas ◀ ▶
cambias de día. En **"Traza por supervisor"** puedes **tocar cualquier máquina** de la lista y
te lleva a su **ficha en el Catálogo** (con todos sus datos y acciones); el **›** al final de
cada renglón indica que es clickeable.

Cada supervisor trae un **resumen de cercanía** para saber qué tan confiables fueron sus rondas:
**✓ en sitio** (estuvo cerca, dentro de ~300 m), **⚠️ lejos** (marcó sin estar al lado) y
**• sin GPS** (no se pudo verificar). El botón **"📄 Reporte de supervisión (PDF)"** genera el
informe del día con ese resumen por supervisor, el detalle de cada visita (hora, máquina,
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

**Control por empresa (asistencia/entrega):** en **Distribución de comida** (jefe) toca la
pestaña **"📊 Control por empresa"**. Elige un **rango de fechas** (o los atajos *Hoy / 7 días /
30 días*) y verás:
- **Totales del rango**: total entregado y cuánto por desayuno, almuerzo y cena.
- **Resumen por empresa**: cuánto entregó cada empresa por tiempo de comida y en cuántos días.
- Al elegir **una empresa** (filtro de arriba): su **historial día por día** con lo entregado en
  cada comida, la hora y quién lo registró.
- Botón **"📄 Descargar reporte PDF"** para imprimir/llevar el control por empresa del rango.

### 4.8d. Inventario (materiales, nota de entrega y cotización)
Control de **materiales y herramientas**. El inventario es **GENERAL** (no se separa por empresa
ni por máquina al crearlo). Cada material tiene su **existencia** (cuánto hay) y su **costo
promedio (PMP)**, que el sistema calcula solo con las entradas. El **SKU** es automático e
incremental (INV-0001, INV-0002…). Pestañas: **Existencias, Salida, Nota de
traslado, Gastos, Cotización y Movimientos**.

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

**Cotización:** en la pestaña **"Cotización"** armas un presupuesto para un cliente (código,
referencia, descripción, cantidad y precio). El **I.V.A. se coloca como MONTO** (lo escribes tú,
no un porcentaje). Genera un PDF con la base imponible, el IVA y el total.

**Nota de traslado (entre máquinas):** pestaña **🔁 Nota de traslado**. Sirve para
**trasladar materiales de una máquina/empleado (origen) a otra (destino)**. Eliges los
materiales con stock, defines el **Origen** (máquina + responsable) y el **Destino**
(máquina + responsable), y un motivo opcional. Al **generar**, se abre la vista previa del
PDF (con el bloque Origen → Destino y dos firmas: entrega y recibe); al **confirmar**, se
**descuenta del inventario** y queda guardado el registro del traslado (casado con la
máquina y el empleado de cada lado). Si cancelas la vista previa, no se descuenta nada.

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
  Conteo: payloaders, jumbos, tractores, cisternas…), cada uno con su **cantidad**.
  Usa **"Mostrar todas" / "Ocultar todas"**, o toca un tipo para ver sus máquinas y
  elegir una por una.

### 4.12. Reportes
Genera documentos **PDF** para imprimir o compartir, eligiendo el **rango de fechas** y la
**empresa**. Al generarlos se abre una **ventana con la vista previa** y los botones
**🖨️ Imprimir** y **Cancelar**.

### 4.13. Usuarios (solo administrador)
Para crear personas que usan el sistema y **decidir qué puede ver cada una**.

**🏷️ Roles del sistema (roles dinámicos):** en Usuarios, toca **"🏷️ Roles del sistema →
Administrar"**. Ahí puedes:
- **Crear un rol** (ej. *Coordinador de Operadores*): le pones un **nombre** y eliges **qué módulos
  ve** (sin acceso / L / E / F por módulo).
- Ver los roles en una **lista buscable** y **quitarlos** (🗑️).

**Asignar un rol a un usuario:** en la tarjeta del usuario, en **"Rol especial (coordinador)"**,
toca **Asignar** y elige el rol de la **lista buscable** (o **Quitar** para dejarlo sin rol
especial). Un usuario con rol especial ve **SOLO** los módulos de ese rol (no ve el resto).

> Vienen listos 3 roles: **Coordinador de Mantenimiento Preventivo**, **Coordinador de
> Mantenimiento Correctivo** (ambos ven *Mantenimiento de Maquinaria*) y **Coordinador de
> Operadores** (ve *Supervisión* + *Operadores*: si los supervisores hacen sus check-ins y si los
> operadores están trabajando).

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
