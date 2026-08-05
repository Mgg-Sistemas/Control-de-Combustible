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
  - **📲 Al escanear el QR de la máquina:** sale una pantalla con el **logo** y **dos botones** — **👷 Inspector / Coordinador** y **👤 Otro usuario**. **Ambos llevan al login**: todos ingresan con **usuario y contraseña**. Después de iniciar sesión, cada quien cae en su vista según su rol (supervisión/check-in para inspector/coordinador; vista de operador para el resto). *Nota:* ahora **todos** los que usan el QR de la máquina necesitan **usuario** (ya no se entra de forma anónima solo con el carnet).
- 🪖 **Supervisor** — asigna quién la custodia (Empresa o Militar). Al escribir el nombre sale la lista de los ya usados para elegirlo rápido; cambiar de supervisor deja el anterior en el historial.

**Editar o borrar supervisores:** en el botón 🪖 toca **"⚙️ Editar / borrar supervisores"**. Ahí puedes **✎ renombrar** un supervisor (se corrige en **todos** sus registros) o **🗑 borrarlo** por completo (las máquinas que custodiaba quedan sin supervisor).

**📄 Reporte de CONTEO de equipos (desde el Catálogo):** es **solo conteo + detalle, sin horas
ni precios**. Muestra, en este orden:
1. **Total general** de equipos.
2. **Por empresa** — cuántos equipos tiene cada empresa.
3. **Detalle por empresa** — bajo cada empresa, cada equipo sale como **Equipo (tipo) · Serial ·
   Estado** (p. ej. *CAMIÓN VOLTEO TORONTO · A25BE0M · Operativa*).
- **Alcance:** elige **General (todas)** o una **empresa**.
- **Filtro por tipo — lista desplegable con casillas:** toca **"🔎 Filtrar por tipo de equipo"**
  para abrir la lista, **escribe** (ej. *"volteo toronto"*) y **tilda ☑** uno o varios tipos
  para ver solo esos. Botón **⬇️ Descargar PDF (conteo)**.

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

**🕒 Ver tramos (detalle de cada arranque/parada del día):**
- Junto al total de horas de cada día, hay un botón **"🕒 Ver tramos"**.
- Muestra, uno por uno, cada tramo de trabajo que se registró ese día: hora de inicio → hora de
  parada, cuántas horas duró, y por qué se cerró (🏁 cierre manual del inspector, 🔧 parada por
  avería, 📍 parada/no trabajó, 🤖 cierre automático del sistema a las 7am/7pm, o ✏️ un ajuste
  manual hecho aquí mismo). Es **solo de consulta** — sirve para revisar y confiar en el total,
  no para editarlo (los ajustes se siguen haciendo con los campos de siempre).
- Si un día no tiene tramos (por ejemplo, uno de antes de que existiera esta función), el total
  de arriba sigue siendo válido — simplemente no hay desglose para ese día.

**⚠️ Marcar un equipo averiado (rápido, desde el control):**
- Arriba, toca **⚠️ Marcar equipo averiado**.
- Elige de la **lista desplegable** la **🏢 empresa** y luego el **🚜 equipo** (se muestra con su
  **serial / placa** para no confundirlo). Puedes escribir para buscarlo.
- Escribe el **motivo** de la avería (opcional) y toca **⚠️ Marcar averiado**.
- El equipo queda **No operativa**, **sale del control** y pasa a **"En reparación"** en el módulo
  **Mantenimiento de Maquinaria**, donde se registra su retorno operativo cuando quede lista.

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

> **📊 Total del rango (empresa):** justo **debajo del botón "🚚 Flete general de \<empresa\>"** sale el
> **total de horas** y el **total en $** de **toda la empresa** en el rango de fechas seleccionado
> (suma de sus máquinas).
>
> **📊 Total del rango por máquina:** debajo del **botón de flete de cada máquina** (y en su resumen
> compacto cuando la tarjeta está cerrada) sale su **total de horas** y su **total en $** del rango
> (horas × precio/hora). Si la máquina no tiene precio, dice *"sin precio"*.

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
- **🔎 Buscar por tipo de equipo (en 📊 Conteo de equipos):** dentro de la vista previa del
  reporte **Conteo de equipos** hay un buscador **con casillas**. Escribe el tipo —por ejemplo
  **"volqueta toronto"**— para filtrar la lista y **tilda** uno o varios tipos; abajo aparece un
  **número grande** con el **total de equipos** y el **desglose por empresa**. Botón
  **"⬇️ PDF de este conteo"** para imprimir el total, la cantidad por tipo y por empresa.

- **📍 Ubicaciones tácticas (botón en 📊 Conteo de equipos):** genera el **"Reporte Diario de
  Operaciones y Maquinaria – Operación Rescate y Esperanza, La Guaira"** en PDF. Trae las máquinas
  **reales agrupadas por quién las tiene a cargo** (**CVM / Gobernación / FANB / SOS La Guaira**,
  según el campo *"a disposición de"* del equipo), cada una con su **empresa**, **ubicación real**
  (referencia + sector Este/Oeste y subzona por GPS: Macuto, Caraballeda, Aeropuerto…) y **estado**
  (Operativo / Inoperativo / En espera). **Arriba** trae la cantidad de maquinaria por empresa y los
  **equipos por zona** (cuántos en el **ESTE** y cuántos en el **OESTE**, solo totales). Incluye una
  sección con las **camionetas pick-up** del módulo de **Vehículos** a disposición de SOS La Guaira,
  y deja **campos en blanco para llenar a mano**.
- **👷 Ubicaciones tácticas CON PERSONAL:** al lado del botón hay un **switch** *"Solo ubicaciones /
  Con personal"*. Actívalo antes de descargar y el reporte reparte la nómina en los equipos de
  **SOS La Guaira** (no en los de CVM / Gobernación / FANB): a cada máquina le asigna **2 operadores**
  (uno de turno **día** y uno de turno **noche**), en rotación; agrega una sección con **todo el
  personal por departamento (solo totales)**; y otra con los **coordinadores** e **inspectores**
  repartidos por zona (**ESTE / OESTE**). Los cargos se toman del campo *"cargo"* del empleado.
- **👥 Personal por departamento (botón en 📊 Conteo de equipos):** genera el **"Reporte de Personal"**
  con **toda la nómina activa** (del administrativo a los ayudantes de cocina). Arriba lleva un mensaje
  de **agradecimiento** y el **TOTAL de personal**; luego la cantidad por **departamento** y por
  **cargo**; y al final el listado por departamento con **nombre, cargo y cédula**. Los departamentos
  salen **unificados** (p. ej. *administrativo*/*adminitrativo* y *operaciones de máquinas*/*…maquinarias*
  cuentan como uno solo) y a quien no tenga departamento se le asigna el que corresponde **según su
  cargo** (un encargado de cocina sin departamento → **COCINA**). Para dejar la **nómina en la base**
  igual, corre `supabase/nomina_departamentos.sql`.

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

> **La vista arranca vacía:** escribe el nombre de la empresa en el **buscador** para ver su cuenta
> (no se listan todas de golpe).

> **El facturado cuadra con el Informe por jornada:** Control de Pagos usa el **mismo precio del
> reporte** (el del rango/actual, no el snapshot "del cierre") y **no cobra rondas ni fletes
> anteriores al inicio del período**. Así el saldo = **Facturado − Abonado** da igual que el
> reporte real.

> **Cotejo automático:** cada empresa muestra **"📊 Reporte de jornada $X"** con **✓ cuadra**
> (verde) o **⚠️ difiere** (naranja, con la diferencia). El monto del reporte se recalcula solo
> (mismo cálculo del Informe por jornada) para verificar que Control de Pagos coincide. Si sale
> ⚠️, es que una máquina tuvo **precios distintos en la misma semana** o quedó un precio
> **"del cierre" viejo**.

> **Ver por qué da ese saldo:** al abrir una empresa aparece **"🔍 Abonos contados"** con **todos**
> los abonos que se le cuentan (fecha, monto, método, semana) y la cuenta explícita
> **Facturado − Abonado = Saldo**. Ahí puedes **borrar** un abono duplicado o mal cargado con 🗑️.

- El **Tabulador de precios** es la lista maestra de precios por tipo de máquina.
  Puedes **modificarlo** y **sincronizar** los precios actuales.
- **General y por empresa:** arriba del tabulador eliges **💲 General** (aplica a todas las
  empresas) o una **empresa** para ponerle su **precio propio**. Si a una empresa le pones un
  precio en un modelo, ese manda para sus máquinas; si lo **dejas vacío**, usa el **General**.
- Al **sincronizar**, cada máquina toma el precio de **su empresa** (o el General si no tiene
  uno propio) y se aplica a la **empresa correspondiente**.
- Los **cierres viejos no cambian** (quedan con el precio que tenían); los **nuevos** usan
  el precio del tabulador.

> **Los fletes cuentan:** el **total a cobrar** de cada empresa/semana **incluye los fletes/viajes**
> registrados en el Control para esa semana (no solo las horas de máquina).

> **Método de pago del abono:** al **"＋ Registrar abono"** eliges cómo se pagó — **💵 Efectivo ($)
> · ₮ USDT · 🇻🇪 Bs (al cambio)**. Si es en **Bs**, escribes el **monto en Bs** y la **tasa del día**
> (Bs por $) y el sistema calcula el **equivalente en $** (el saldo siempre se lleva en $). Cada
> abono muestra su **método** y, si fue en Bs, el **monto en Bs y la tasa** usada.

> **Excedente que pasa a la otra semana (cascada):** si pagas **más** de lo que debe una semana
> (ej. debe $10 y pagas $15), el **sobrante ($5)** se aplica **solo** a las **otras semanas con deuda**
> de la misma empresa (de la más antigua a la más nueva). Si **no queda ninguna semana pendiente**,
> el sobrante se guarda como **💚 saldo a favor** (prepago) de la empresa. Al final te dice cómo se
> distribuyó el pago.

> **Revertir pagos (corregir errores):** en **🗂️ Histórico** puedes **filtrar por empresa** y, con esa
> empresa elegida, usar **"🗑️ Revertir TODOS los abonos de \<empresa\>"** (te muestra cuántos y el
> total, y pide confirmar) para borrarlos todos de una. El saldo de cada semana vuelve a incluir esos
> montos. También puedes borrar **un** abono suelto desde el detalle de la semana.

> **📄 Reportes (botón 📄 arriba):** elige **una o varias empresas** (o todas) y un **rango de
> fechas**, y saca dos PDFs: **⬇️ Reporte detallado** (por semana, con el desglose de máquinas,
> horas y abonos) o **🧾 Estado de cuenta** — enfocado en la cuenta: por cada empresa, sus
> **semanas facturadas** (facturado / abonado / **saldo** / estado) y aparte **todos los pagos
> realizados con su fecha de registro** (monto, método, semana que cubre), y el **saldo pendiente**
> de la empresa. Al final trae los **totales** (facturado, abonado, saldo pendiente).

### 4.6b. Control de pago a personal (dentro de Nómina)
Paga al **personal**. Tiene **dos vistas** (se cambian arriba): **👤 Por persona** (la
principal) y **📅 Por período**. Está dentro de **Nómina** → **💵 Control de pago a personal**.

> **💵 Tasa BCV vigente:** justo debajo del encabezado de "Pago a personal" se muestra una fila
> con la **tasa BCV vigente** (el monto, la **fecha** y si viene del **BCV** o fue puesta a mano
> ("manual")) junto al botón **"🔄 Actualizar tasa BCV"**, que refresca la tasa oficial desde
> **ve.dolarapi.com**. Mientras carga, el botón se **deshabilita** y muestra un pequeño
> **spinner**; si la actualización falla (sin internet, servicio caído, etc.) avisa con una
> **alerta**. Esta es la misma tasa que se usa para todos los equivalentes en Bs de esta pantalla.

> **👤 Por persona (vista principal):** un **listado de empleados**. Abre a una persona y verás
> sus **datos personales**, sus **datos bancarios** y sus **tarifas**. Con **"➕ Generar pago"**
> registras un pago por **frecuencia** — **Diario**, **Semanal**, **Quincenal** o **Mensual**. En
> **Diario** puedes cargar jornadas de **☀️ día y 🌙 noche JUNTAS** en el mismo pago (cada una con
> su cantidad y su precio); el **monto** se sugiere = (días × precio día) + (noches × precio noche)
> y es editable. Esas cantidades **quedan guardadas** y se **precargan** en el próximo pago de esa
> persona. De cada pago sacas su **📄 Recibo**. Abajo está el
> **historial** de esa persona con el total, se puede **🖨️ Imprimir** (histórico por persona) y
> cada movimiento se puede **✏️ Editar** o **🗑️ Borrar**. Las tarifas **Quincena** y **Mes** se
> definen en el **🏷️ Tabulador** (igual que día/noche/semana) y se sincronizan a los empleados.

> **🔎 Filtro por estado (Por persona):** arriba del listado hay 3 opciones — **"Solo activos"**
> (por defecto), **"Todos"** y **"Inactivos/Desincorporados"** (agrupa `inactivo` + `suspendido`).
> El estado **"Otro"** siempre queda fuera de las 3, no entra al control de pago.
>
> **☑️ Selección múltiple + Excel de varios a la vez:** cada persona de la lista tiene un
> **checkbox** a la izquierda (además de tocarla para abrir su ficha); arriba hay
> **"Seleccionar todos"** (marca/desmarca todos los que estás viendo con el filtro/búsqueda
> actual). En cuanto marcas al menos una persona aparece el botón
> **"📥 Excel seleccionados (N)"**: descarga un Excel con nombre, cédula, cargo y el **total
> histórico pagado** de cada una, con la tasa BCV del día (fórmula real, editable) — igual que
> el resto de los Excel de este módulo.

> **💵 Equivalente en Bs (tasa BCV del día):** junto a cada monto en US$ —el **total** del
> empleado, las **tarifas** de la ficha, el **total del historial** y **cada pago individual**— se
> muestra también su equivalente en **Bs** con la tasa BCV del día. Al **"➕ Generar/Editar pago"**,
> el campo **"Monto"** tiene un botón **"$→Bs" / "Bs→$"** para cambiar en qué moneda escribes: si
> escribes en **Bs**, el sistema **convierte a US$ automáticamente** al guardar (siempre se guarda
> en US$) y muestra debajo el equivalente en la otra moneda (**"≈ …"**). El **📄 Recibo** y el
> **histórico PDF** de "Por persona" incluyen el equivalente en Bs y la tasa BCV usada.

**📅 Por período (nóminas):** calcula y paga por **PRECIO por hora, día o semana**, definido **por
trabajador**.

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
- **Cualquier modo (incluido "Por día") precarga a TODO el personal activo.** Los operadores traen
  sus jornadas de **día/noche** solas (por el QR); al resto se le **ajusta la cantidad a mano**.
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
  (efectivo, pago móvil, transferencia…). Se ve el **Pagado** y el **Saldo pendiente**. En el modal
  **"Abonar"**, el campo de **monto** también tiene el botón **"$→Bs" / "Bs→$"** con conversión
  automática (se guarda siempre en US$), y muestra el **total/saldo** también en **Bs** (con la
  tasa BCV del día visible).
- **Reportes:** **🧾 Recibo** por persona y **⬇️ Reporte** del período, ambos en **PDF**.
  El **recibo** muestra el **Total** y el **"Saldo cancelado"**. Ambos documentos incluyen además
  los **montos equivalentes en Bs** y la **tasa BCV del día** usada.
- **📥 Excel del período:** dentro del detalle de un período abierto, junto al botón
  **"⬇️ Reporte"**, hay un botón verde **"📥 Excel"** (mismo alcance: respeta el **filtro de cargo**
  activo del período). Descarga un Excel con, **por persona**, lo **trabajado** (días/noches/horas/
  semanas), el **devengado**, los **bonos**, las **deducciones**, el **total**, lo **pagado** y el
  **saldo** — en **US$ y en Bs** (los Bs con **fórmula real** contra la tasa BCV del día, en una
  **celda editable**: si la cambias, todos los Bs se recalculan solos). Incluye una fila con el
  **contexto del período** (nombre, tipo, rango de fechas, modo de pago, estado, empresa y el
  filtro de cargo si aplica) y una fila **TOTAL** con fórmulas `SUM`. Este Excel **ya no lista
  tarifas** del empleado (eso se retiró de Empleados, ver 4.6d).
- **💵 Equivalente en Bs (tasa BCV del día):** los **totales de cada período**, el del **período
  abierto** (total/pagado/saldo) y el **de cada persona** muestran también su equivalente en **Bs**
  (con la tasa BCV del día visible).
- **💼 Filtrar por cargo:** dentro del período hay una **lista desplegable con casillas**
  ("💼 Filtrar por cargo"). Tildas uno o varios **cargos** y la **lista de personas** y el
  **⬇️ Reporte PDF** salen **solo de esos cargos**, además **agrupados por cargo** con su
  **subtotal**. Sin tildar nada = todos.
- **➕ Incluir a todos (personal faltante):** si hay **empleados activos que no están** en el
  período (por ejemplo, que se registraron después de crearlo), sale un **aviso** con cuántos
  faltan; tócalo y se **agregan todos** (entran con 0 jornadas, luego ajustas). Así el pago
  incluye a **todo** el personal con ese cargo, no solo a quienes tienen jornada validada. El nº
  del **🏷️ Tabulador** cuenta **empleados activos** (mismo universo), para que coincidan.

> **Estados del período:** Borrador → **✅ Aprobar** → **💵 Marcar pagada** (y **↩ Reabrir**). En el
> encabezado se muestra **"Pagada $X"** (lo ya abonado); el saldo queda pequeño y solo si falta por
> pagar. Si **Aprobar / Marcar pagada** no cambia el estado, ahora **te avisa el motivo** (antes
> fallaba en silencio).

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

> **👤 Rol ANALISTA:** puede escanear/marcar asistencia sin que un administrador tenga que darle
> el permiso a mano — el sistema se lo habilita solo. En el teléfono, el analista entra a su vista
> normal (la misma de Inspector) y ahí encuentra el bloque **"MARCAR ASISTENCIA DEL PERSONAL"**;
> en PC lo ve en **Más → Control de asistencia**, igual que cualquier otro usuario con el permiso.
> Al escanear un carnet, además de foto/nombre/cargo/cédula ahora también se ve el **estado del
> empleado** (🟢 activo · 🔴 inactivo · 🟡 suspendido).

### 4.6d. Empleados — filtrar por cargo y reporte de lo seleccionado
En **Empleados** puedes filtrar la lista por **tipo de cargo** y sacar un reporte de lo que elijas:
1. En el recuadro **🏷️ Cargo**, toca para desplegar los cargos (con su cantidad).
2. **Marca uno o varios** cargos (ej. **OPERADOR**, **OBRERO**…). Se pueden combinar; **"Todos"** limpia la selección.
3. La lista de abajo muestra solo esos cargos (también se combina con **Estado** y la **búsqueda**).
4. Toca **"📊 Reporte"**: genera un **PDF** con el **listado de las personas seleccionadas**
   (nombre, cédula, ficha, cargo, empresa, estado, teléfono) y un **resumen por cargo** con el total.

> El reporte respeta TODO lo que estás viendo (estado + cargos marcados + búsqueda): imprime exactamente esa selección.

> El Excel con tarifas por empleado que existía antes en esta pantalla se retiró: no correspondía
> aquí (exportaba tarifas del empleado). El Excel de nómina ahora vive en **Nómina → Control de
> pago a personal → Por período**, junto al **⬇️ Reporte** del período (ver 4.6b).

> **Estado del empleado — "Otro":** además de **Activo / Inactivo / Suspendido**, un empleado puede
> quedar en estado **"Otro"**. Los empleados en **"Otro"** **NO entran al control de pago**: no se
> precargan al crear una nómina/período y **no aparecen** en **Pago a personal → Por persona** (ni
> siquiera en "Todos"). Úsalo para gente que no debe pagarse por este sistema.

### 4.7. Mantenimiento de Maquinaria (averías + reparaciones)
Módulo para los **coordinadores de mantenimiento**. Tiene tres pestañas:
- **⏳ Averías:** lo que reportan los operadores por QR, **por empresa → máquina** (con su detalle:
  material, cantidad, nota, fecha). Se marca **✓ Realizado** cuando se atiende. **Ya no muestra**
  los tickets internos **"MÁQUINA PARADA"** (el marcador que usa Inspecciones/Control para pintar
  una máquina como parada): esta lista trae **solo averías reales**, sin mezclarse con ese marcador.
  Al reportar por QR,
  además de los materiales predeterminados (**🛞 Caucho · 🛢️ Aceite · 🧴 Filtro · 🔩 Repuesto**) hay
  un botón **✏️ Otro** para **describir a mano** una falla distinta (ej. “no arranca”, “fuga de aceite”).
  Cada **empresa se muestra colapsada** (toca su encabezado para abrir/cerrar sus máquinas) y arriba
  puedes **buscar** por empresa o máquina; al buscar se abren todas para no ocultar resultados.
- **📷 Escanear · reportar avería:** botón arriba del módulo. Escanea el **QR de la máquina** y
  registra la avería directamente (material o **✏️ Otro**, cantidad, nota y foto). Es lo mismo que
  reporta el operador, pero desde la vista del administrador.
- **📊 Reporte (dashboard de averías):** cuarta pestaña. Muestra un **ranking** (gráfico de barras) de
  **qué equipo genera más averías**, con su **total de averías** y el **gasto en $**. Puedes agrupar por
  **🚜 Equipo · 🏢 Empresa · 🏷️ Tipo de maquinaria** y filtrar por tipo. Arriba salen los **totales**
  (total de averías + gasto total). Toca **📄 Exportar reporte (PDF)** para el reporte por empresa → equipo
  (averías, desglose por material —cauchos, filtros…— y gasto).
  - En modo **Equipo**, toca una máquina para ver su **detalle**: empresa, placa/serial, total de averías,
    el **desglose por tipo** (cuántos cauchos, filtros, aceites, repuestos, otros) y **cada avería con su fecha**.
  - El detalle también **cruza con la Inspección de Maquinaria**: muestra la **última inspección** del equipo
    (fecha, inspector, condición general) y los **puntos observados** (🔴/🟠) que detectó. En el ranking por
    equipo aparece un **🔍 N obs.** cuando la última inspección tiene puntos observados.
  - El reporte contempla los **3 casos** y puedes **filtrar** por ellos (con su conteo): **🔧🔍 Avería +
    inspección** (tiene averías y además fue inspeccionado), **🔧 Avería sin inspección** (tiene averías pero
    nunca se le hizo inspección) e **🔍 Inspección sin avería** (fue inspeccionado —a veces con puntos
    observados— pero aún no tiene averías reportadas). Cada equipo del ranking trae su **etiqueta de caso**, y
    el PDF incluye una columna **Caso** con los totales por tipo.

> **💰 De dónde sale el gasto:** el dinero que genera cada equipo se toma del **almacén** — los materiales
> que **salieron del inventario para ese equipo** (cantidad × su costo). Por eso al dar una **salida** en
> Inventario conviene elegir el **🚜 equipo** destino: así el gasto queda bien atribuido en este reporte.
- **🔧 En reparación:** máquinas que salieron a reparación.
- **✓ Historial:** reparaciones ya cerradas.

**⏱️ Alerta por horómetro (mantenimiento preventivo):** cuando una máquina acumula horas desde su
**último mantenimiento confirmado**, aparece arriba un banner colapsable **"⏱️ N máquina(s)
próxima(s) a mantenimiento ▸/▾"** (toca para abrir/cerrar). Los niveles son:
- **🟡 BAJA** — 200 h acumuladas.
- **🟠 MEDIA** — 220 h acumuladas.
- **🔴 ALTA (máxima)** — 250 h acumuladas.

Cada máquina en alerta muestra su **Serial/Código**, su **Empresa** y el **nivel de severidad**, con
el botón **"✓ Confirmar mantenimiento y reiniciar horómetro"**: al confirmar, reinicia el conteo de
horas acumuladas (NO toca el horómetro físico de la máquina). Esta misma alerta también sale en
**Inspecciones**. Además, se genera una **notificación por la campana 🔔** (para admin y
supervisor) apenas una máquina cruza un umbral, sin duplicarse el mismo día por máquina; deja de
generarse en cuanto se confirma el mantenimiento.

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

> **📱 Teléfono vs 💻 PC:** desde un **teléfono**, al iniciar sesión **todos los usuarios** caen
> en el módulo de **Inspectores** (esta pantalla). Desde una **PC** cada quien ve la app normal
> según su rol y la **sesión se mantiene iniciada**. El **coordinador de patio** en teléfono ve su
> propia pantalla (jornada de camiones), no la de máquinas.
> **El administrador** ve arriba un botón **🗂️ SISTEMA** que lo lleva a la **app completa**
> desde el teléfono (para volver a Inspectores, recarga la página). **Jesús Lozada** también ve
> ese mismo botón **🗂️ SISTEMA** dentro de su Vista de Inspector (excepción puntual, igual que el
> administrador), aunque su forma de entrar a la app en el teléfono no cambia (sigue entrando a
> Inspectores como siempre).

> **🔄 Sincronización en vivo:** las pantallas de **CHECK MÁQUINA** (asignación de máquina) y la de
> **entrada/salida de camiones en el patio** se actualizan solas al instante en todos los
> dispositivos, sin necesidad de refrescar a mano.

> **✅ CHECK MÁQUINA (administrador o Coordinador de Inspectores):** asigna las máquinas a los
> inspectores; los inspectores **no se asignan solos** (solo ven las que le pusieron). Toca
> **✅ CHECK MÁQUINA**, **1)** elige el **inspector** de una lista buscable, y **2)** busca la
> máquina y toca el **turno** (☀️ Día / 🌙 Noche) para asignársela (o de nuevo para quitársela). Cada
> máquina tiene **dos inspectores** (día y noche). Queda en la **Auditoría** (✅ *se asignó · Día/Noche
> → nombre*). También hay **"Ver todas"**.
>
> **👥 Coordinador de Inspectores (rol nuevo):** además del administrador, cualquier usuario con el
> permiso de módulo **"Coordinador de inspectores"** (se activa desde **Usuarios**, igual que
> cualquier otro permiso) puede coordinar/asignar inspectores — es un permiso ADICIONAL, no le quita
> nada al administrador ni a nadie que ya podía hacerlo.
>
> **📋 Asignación por lotes:** dentro de **✅ CHECK MÁQUINA → 🕓 Pendientes por asignar**, cada
> máquina tiene un check ☐ a la izquierda. Marca varias (o toca **"Seleccionar todas"**) y aparece
> el botón **"📋 Asignar N seleccionadas…"**: elige el turno (☀️/🌙) y el inspector, y se les asigna
> a TODAS las marcadas de una sola vez (en vez de una por una). Al final muestra cuántas quedaron
> bien y cuántas fallaron, si alguna.
>
> **🕓 Pendientes por asignar solo cuenta máquinas EN SERVICIO (04/08/2026):** antes esta lista
> incluía cualquier máquina sin inspector, incluso las **inactivas**, **averiadas**
> (`operational = false`) o **en espera de recepción** — equipos que no están trabajando y por
> tanto no necesitan un inspector asignado ahora mismo (mismo criterio que ya usa el cron de
> MAQUINAS FALTANTES para no auto-asignarles horas). Ahora esas quedan afuera; solo aparecen las
> que sí están activas, operativas y en servicio pero les falta inspector en algún turno.
>
> **🤖 Filtro "Sin encargado real" vs "Sin nadie" (04/08/2026):** dentro de **🕓 Pendientes por
> asignar** hay dos botones. Desde que existe el usuario de sistema **MAQUINAS FALTANTES** (cubre
> automáticamente, cada 15 min, cualquier turno que se quede sin inspector humano, para que la
> máquina no deje de acumular horas), una máquina puede tener "alguien" asignado sin que sea una
> persona real. **"Sin encargado real"** (por defecto) muestra las que no tienen a nadie Y las que
> solo tiene MAQUINAS FALTANTES — la vista útil para ir asignando inspectores de verdad, y la que
> reproduce el reporte externo de "máquinas pendientes por asignar" que arma el sistema.
> **"Sin nadie (estricto)"** muestra solo las que de verdad no tienen NINGÚN inspector (ni
> siquiera el del sistema) — el comportamiento original. Cada tarjeta ahora también muestra el
> **encargado** de la máquina (el campo fijo del catálogo, si lo tiene) y distingue con color si el
> turno lo tiene una persona real (verde), nadie (rojo/naranja "falta"), o solo el sistema
> (naranja "🤖 sin encargado real").
>
> **📅 Relleno retroactivo de agosto (04/08/2026):** `auto_full_shift_placeholder()` solo carga
> horas para "ayer", así que las máquinas que llevaban días sin inspector ANTES de que este cron
> se activara se quedaron sin horas esos días. `supabase/backfill_maquinas_faltantes_agosto.sql`
> (nuevo, corrido una vez) les carga 12h día / 6h noche (12x12 para bolqueta/toronto) desde el
> **01/08/2026** hasta ayer, SOLO a las máquinas que hoy siguen en manos de MAQUINAS FALTANTES, y
> SOLO en los días que no tuvieran ya un registro (nunca pisa datos de un inspector real). Guarda
> respaldo previo en `backup_machine_rounds_20260804_backfill` / `backup_machine_work_segments_20260804_backfill`.
>
> **🟢 El turno DÍA de MAQUINAS FALTANTES ahora se ve "en curso" desde las 7am (04/08/2026):**
> antes, las 12h del turno día aparecían en silencio horas después (recién a la madrugada
> siguiente). Ahora `supabase/auto_start_dia_maquinas_faltantes.sql` arranca la jornada a las
> **7:00am** (como si un inspector real hubiera tocado "Iniciar jornada") — la máquina se ve
> **🟢 en curso** en el CHECK/Inspecciones durante el día, y el cron que ya cierra jornadas
> (`auto_close_jornadas()`) la cierra solo a las 7:00pm con las 12h reales transcurridas. La
> **noche** sigue cargándose de una vez (6h genérico / 12h camión), sin "vivirse" en tiempo real
> — esto solo aplica al turno de la mañana, como se pidió. Nunca toca una máquina que ya tenga
> una jornada abierta o ya tenga horas registradas ese día (de un inspector real o de este mismo
> sistema).
>
> **⚠️ CORRECCIÓN IMPORTANTE (04/08/2026, misma tarde):** todo lo de arriba (12x12, relleno
> retroactivo, arranque a las 7am) se había construido con un usuario "MAQUINAS FALTANTES"
> **nuevo**, creado con un UUID inventado. Se descubrió que en producción **ya existía** un
> usuario real para esto mismo — **"inspector maquinas faltantes"** (id `3b996dc0-…`), con 143
> asignaciones históricas — que es el que en realidad se ve en el Resumen/dashboard de siempre.
> Los 5 scripts (`maquinas_faltantes.sql`, `cap_truck_hours.sql`,
> `auto_start_dia_maquinas_faltantes.sql`, `backfill_maquinas_faltantes_agosto.sql`) se
> corrigieron para usar el UUID **real**. Si ya habías corrido alguna versión vieja hoy, corre
> además `supabase/migrar_a_inspector_faltantes_real.sql` (nuevo) para mover lo que haya quedado
> mal asignado — es seguro, no duplica ni pisa nada. El usuario inventado no se borra, solo queda
> sin usar.
>
> **🔧 Panel "Gestionar Iniciada/Pendiente por supervisor" (04/08/2026):** en el Resumen de
> Inspecciones, debajo del botón de "Reporte de máquinas por asignar / por iniciar", hay un panel
> (solo para 2 cuentas puntuales, más quien se agregue desde Ajustes) que lista las máquinas
> agrupadas por inspector, con checkbox individual/por grupo/todas, cada fila con su propio turno
> (☀️/🌙 — una máquina con inspector de día Y de noche sale 2 veces, cada una independiente), y dos
> botones para pasarlas en bloque entre **✅ Iniciada** y **⏳ Pendiente por iniciar** — el mismo
> estado de las tarjetas de arriba. "Iniciar" arranca la jornada AHORA (como si el inspector
> tocara "Iniciar jornada", sin pedir horómetro); "Pendiente" borra las horas de ese turno y cierra
> la jornada si estaba abierta en ese mismo turno. Tiene sus propios filtros de turno y estado
> (independientes del switch general del dashboard) y **solo funciona para el día de HOY** (no
> deja tocar días pasados, para no arriesgar cortes ya cerrados). Si la máquina ya tenía horas
> trabajadas hoy, "Pendiente" NO las borra sin dejar rastro: quedan guardadas en el historial
> (`machine_work_segments`, igual que cualquier otro cierre de jornada) y en la bitácora de
> **Auditoría**, con quién lo hizo y cuántas horas había. Un **administrador** puede
> prender/apagar este panel por completo y sumar o quitar personas con acceso desde **Ajustes →
> Herramientas avanzadas** (requiere haber corrido `supabase/feature_toggles.sql` en Supabase;
> mientras tanto sigue funcionando igual, solo para las 2 cuentas fijas).
>
> **🔵 Círculo de estado** en cada máquina asignada: **🟢 verde** = jornada en curso (trabajando) ·
> **🟡 amarillo** = parada (avería) · **🔴 rojo** = jornada finalizada. Cada máquina muestra además su
> **📍 edificio/referencia** y su **serial/placa**. Si una máquina está **parada**, en su ficha sale
> **🟢 Volver a OPERATIVA** (cierra la avería y quita el "MÁQUINA PARADA" de Control).

**Cómo marca el inspector una máquina (varias formas, todas valen):**
1. Entra con su usuario y contraseña (o desde teléfono, cualquiera cae aquí). Ve **"Mis máquinas asignadas"**.
2. **Asignar:** si la lista está vacía, el **administrador** debe asignarle máquinas con **✅ CHECK MÁQUINA**.
   También hay un botón **📷** para escanear el QR directo.
3. **Desde la lista:** toca la máquina y se abre su ficha de inspección (nombre, empresa, serial/placa).
4. **Escaneando el QR con la CÁMARA del teléfono:** sale una pantalla con el logo y el botón
   **🔓 INICIAR SESIÓN**; entra con su usuario y cae **directo** en la ficha de esa máquina.
5. El sistema toma su **ubicación GPS** y calcula qué tan cerca está de la máquina.

**Botones de la ficha de la máquina:**
- **🟢 INICIAR JORNADA** — pide el **horómetro inicial** (viene **precargado** con el horómetro
  final de la jornada anterior), guarda la **hora de inicio** y marca la máquina en **Inspecciones**.
  El botón cambia a **🏁 FINALIZAR JORNADA** con un **contador** del tiempo trabajado.
- **🏁 FINALIZAR JORNADA** — pide **confirmar** mostrando el **total de horas** y el **horómetro
  final**; al aceptar, las horas (fin − inicio) **se suman a Control de maquinaria** en el turno ☀️
  día / 🌙 noche. **Regla:** ese **horómetro final será el inicial de la próxima jornada**.
- **🟡 PARADA** — al tocarlo se despliegan **2 caminos** para elegir:
  - **🔧 Por avería** — elige el **material** (🛞 Caucho · 🛢️ Aceite · 🧴 Filtro · 🔩 Repuesto ·
    ✏️ Otro), escribe el **texto de la falla** (obligatorio solo si eliges "Otro") y, opcional,
    una **foto**. Al confirmar (**"🟡 Confirmar PARADA + avería"**) crea la solicitud en
    **Mantenimiento de Maquinaria** y la máquina sigue saliendo **PARADA** en Inspecciones/Control.
  - **📍 Parada / No trabajó** — motivo fijo **"NO TRABAJÓ LA MÁQUINA"**: captura la **ubicación
    GPS** del inspector (botón **"📍 Capturar mi ubicación GPS"**) y el **edificio/referencia**. Al
    confirmar (**"🟡 Confirmar PARADA (no trabajó)"**) **solo** se refleja en Inspecciones/Control
    (**no** crea nada en Mantenimiento de Maquinaria).
  - En ambos casos la máquina queda marcada **🟡 PARADA** y en Control sale **🔴 MÁQUINA PARADA**;
    desde la ficha de la máquina sale **🟢 Volver a OPERATIVA** para revertirla.

> El inspector puede marcar **cualquier** máquina (no tiene la restricción por empresa del
> operador). El operador, en cambio, solo puede usar equipos de **su** empresa.

**👷 Iniciar la jornada del operador (si no tiene teléfono):** dentro del mismo check-in de la
máquina, el inspector puede arrancar la jornada del operador con **su** teléfono:
1. Toca **"📷 Escanear carnet del operador"** y lee el **QR del carnet** del operador.
2. El sistema valida que sea **operador/chofer/servicios generales/obrero** de la nómina y que tenga cédula.
3. Elige el **turno** con los botones **☀️ Día / 🌙 Noche** (viene sugerido según la hora, pero el
   inspector puede cambiarlo). El turno elegido define si la jornada cuenta como de día o de noche para el pago.
4. El inspector **coteja la cédula** (debe coincidir con el carnet) e ingresa el **horómetro inicial**.
5. Toca **"🟢 Iniciar jornada del operador"**. Queda registrada la jornada en esa máquina (con las
   mismas reglas: 1 máquina por operador al día y máximo 2 operadores por turno) y la marca de
   quién la registró (el inspector). La ubicación del inspector queda como punto de inicio.

> El inspector marca desde **"Mis máquinas asignadas"** (las que se asignó con **✅ CHECK MÁQUINA**)
> o escaneando el QR físico. El check-in aparece de inmediato en el módulo **Inspecciones**
> (Traza por inspector) y **valida la jornada**.

> **Inspector asignado:** se muestra en el **Catálogo** y en **Control de maquinaria** (🪖 Inspector:
> nombre). **Prioridad:** si el inspector se asignó la máquina con **✅ CHECK MÁQUINA** (teléfono),
> ese es el asignado; si no, se usa el del **último check-in** (visita).

> **✅ Máquinas asignadas por inspector (CHECK):** arriba del módulo de **Inspecciones** sale la
> lista de qué máquinas se asignó **cada inspector** con el botón **✅ CHECK MÁQUINA** del teléfono.
> Se **sincroniza en vivo**. En pantalla ves **inspector → sus máquinas** con **sector, referencia,
> serial/placa, empresa** y fecha/hora.
>
> **Dos reportes en Inspecciones:** (1) **📊 Reporte por inspector** (día/rango, con hora, sector,
> serial/placa, empresa y **estado** de la máquina); y (2) **📄 Asignaciones por sector** — las
> máquinas que cada inspector se asignó con el CHECK, **agrupadas por sector**, con **turno ☀️/🌙 +
> referencia + serial + placa + empresa**, **sin el estado**. El reporte (2) tiene **búsqueda libre**
> (máquina, placa, serial, empresa, inspector, encargado, edificio) y filtros tipo **check** por
> **inspector** y por **edificio/referencia** (con su propia búsqueda).

> **🔎 Búsqueda en Trazabilidad de ubicaciones (Mapa):** arriba de la trazabilidad hay un buscador
> por **máquina, placa, serial, empresa, encargado, referencia/edificio** y **quién registró**
> (inspector/operador).

> **🏢 Edificio (lista desplegable):** en el check-in, el campo **Edificio** es ahora una **lista
> desplegable** con los sitios oficiales (Residencias Militares, La Iguana, Hotel Litoral Palace,
> Residencias Las Palmas, Rita Mar, Arichuna, Mar de Leva, Puente Caraballeda, Tahiti, Club Caribe,
> La Joya, Opp 22/25/26/27/33, Hotel Albatro, Playa escondida Tanaguarena, Santa Eduvigis). Se elige
> de la lista para que **todos escriban igual**; si el sitio no está, se usa **"✏️ Otro (escribir a
> mano)"**. Ese edificio sale en el reporte **Mapa → 📄 Máquinas por sector**.

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

**🟢 Jornadas de máquina (inspector):** sección dentro de Inspecciones con **todas** las
jornadas que los inspectores inician con **🟢 INICIAR JORNADA** ese día (en curso, finalizadas,
paradas y pendientes por iniciar); las de usuarios admin no se muestran. Trae:
- **🔎 Buscador** por **inspector, máquina o empresa**.
- Agrupado **por inspector** (tarjetas colapsables): cada tarjeta muestra cuántas máquinas
  tiene, cuántas **paradas**, cuántas **por iniciar** y cuántas **en curso**. Botones
  **"▾ Expandir todo"** / **"▸ Colapsar todo"** para abrir o cerrar todas las tarjetas de una vez.
- Cada máquina de la lista trae su **color de estado**: **🟢 verde** = EN CURSO ·
  **🟡 ámbar** = PARADA · **🔵 azul** = POR INICIAR (antes "por iniciar" salía en amarillo/ámbar y
  se confundía visualmente con PARADA; ahora es **azul** para que las tres se distingan de un
  vistazo). Tocar una máquina abre su **detalle** de la jornada.
- Botón **"📄 Reporte resumen por inspector"** (junto a Expandir/Colapsar todo): genera un **PDF**
  (misma vista previa/impresión que los demás reportes) con una **sección por cada inspector**:
  cuántas máquinas tiene **asignadas**, cuántas **iniciaron jornada** (en curso o finalizada),
  cuántas están **averiadas/paradas** y cuántas **le faltaron por iniciar**. Para las que faltaron
  por iniciar, trae una **tabla de detalle** con: **Edificio, Modelo/Tipo de máquina, Serial/Placa,
  Sector, Referencia y Empresa asignada**. El estado de cada máquina se calcula **por turno**
  (día/noche) del inspector, con el mismo criterio que usa esta lista en pantalla.

Cada inspector trae un **resumen de cercanía** para saber qué tan confiables fueron sus rondas:
**✓ en sitio** (estuvo cerca, dentro de ~300 m), **⚠️ lejos** (marcó sin estar al lado) y
**• sin GPS** (no se pudo verificar). El botón **"📄 Reporte de inspecciones (PDF)"** genera el
informe del día con ese resumen por inspector, el detalle de cada visita (hora, máquina,
empresa, estado y ubicación) y las jornadas sin validar.

> **📊 Reporte por inspector (día o rango):** dentro de Inspecciones hay un reporte con filtro por
> **📅 un día** o **📆 rango de fechas** y un filtro de inspectores **tipo check** (marcas uno o
> varios; vacío = todos). Muestra, por inspector, la **hora de inicio**, la **máquina**, el
> **serial/placa**, el **sector** y la **empresa**, y se puede **descargar en PDF**.

> **🚚 Jornada de camiones (coordinador de patio):** el coordinador de patio **escanea el QR del
> camión** para **iniciar** su jornada; al **escanearlo de nuevo** la **finaliza** (pide confirmar
> con el total de horas). Las horas van a **Control de maquinaria** y la marca aparece en
> **Inspecciones**. En su pantalla ve la lista de **camiones en jornada** (asistencia) con el tiempo
> transcurrido y un botón para finalizar.

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

> **Movimientos (traza):** además de filtrar por **tipo** (Entradas / Salidas / Consumo / Ajustes),
> tienes **🔎 búsqueda libre** (por producto o motivo) y filtro por **rango de fechas** (Desde / Hasta).
> **"✕ Limpiar"** quita los filtros.

> **Revertir una salida:** abre una **SALIDA** en Movimientos y toca **"↩️ Revertir al inventario"**.
> Pide confirmación, **devuelve la cantidad al stock** y elimina esa salida. El stock se recalcula
> solo (no toca el costo/PMP). Úsalo para corregir salidas hechas por error o materiales devueltos.

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
   Elige también la **🏢 empresa registrada** a la que se carga la salida (lista desplegable y
   filtrable): **se guarda en el movimiento** y sale en la nota. (Sigue el campo de empresa **NO
   registrada** en texto libre para casos fuera del sistema.)
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
cantidad y **precio estimado** (en **$ o Bs** — el sistema convierte a dólares con la tasa del día
solo para el cálculo interno). Al **📤 Enviar al jefe** queda guardado como **Pendiente**. El **jefe
(administrador)** lo **✅ Aprueba** o lo **❌ Rechaza**. Si se compra, quien tenga permiso de
**Recibir** (el administrador o alguien con **todos los permisos de Inventario**, desde 04/08/2026)
toca **"📥 Recibir en inventario"**, confirma la **cantidad y el precio real** de cada producto, y el
sistema **crea la entrada** en el almacén (los productos nuevos **se crean solos**); el requerimiento
queda **automáticamente** como **Recibido**. Con **🧾 PDF** puedes imprimir el requerimiento para
pasárselo al jefe — el documento muestra **solo el monto en dólares** (sin Bs ni tasa BCV; esa tasa
es solo referencial dentro del sistema, no sale en ningún reporte impreso). Así todo queda
trazado: quién lo pidió, quién lo aprobó y cuándo se recibió.
Cada requerimiento tiene además **"✏️ Editar"** (cambia título, nota y productos — no si ya fue
recibido) y **"🗑️ Eliminar"** (borra todo el requerimiento, con confirmación), para quien tenga
escritura en Inventario.

> **✏️ Cambiar estado a mano (04/08/2026):** quien tenga **todos los permisos de Inventario** (o
> sea administrador) también ve el botón **"✏️ Cambiar estado"**, que permite corregir el estado
> del requerimiento (Pendiente/Aprobado/Rechazado/Recibido) sin pasar por todo el flujo. Ojo: esto
> **NO** registra entrada de stock — solo cambia la etiqueta del documento. Si el material se
> recibió de verdad y hay que sumarlo al inventario, usa **"📥 Recibir en inventario"** en su lugar.

> **Adjuntar un formato (imagen o PDF):** en cada requerimiento toca **"📎 Subir formato"** y elige
> una **imagen** o un **PDF** (cotización, formato firmado, etc.). Queda guardado (**📎 Formato
> adjunto**). Con **"👁️ Ver formato"** se abre la **vista previa** (imagen o PDF) con botón
> **"⬇️ Descargar / Abrir"**. Al **aprobar** un requerimiento que trae formato, la vista previa
> **se abre sola** para revisarlo y descargarlo.

> **Revertir un rechazo (error de dedo):** si un requerimiento quedó **❌ Rechazado** por
> equivocación, el administrador toca **"↩ Volver a pendiente"**: vuelve a **Pendiente** (se limpia
> el rechazo) y se **notifica a los administradores** que quedó pendiente otra vez.

> **Filtrar y descargar varios de una vez (04/08/2026):** encima de la lista hay un buscador
> "🔎 Buscar" (código, título, nota, solicitante, empresa o producto) y un rango de fechas
> (**Desde** / **Hasta**), combinables con los chips de estatus (Pendientes/Aprobados/etc.). Cada
> requerimiento tiene un checkbox y hay un botón **"Seleccionar todos"** que marca a los que están
> visibles según el filtro activo. El botón **"📥 PDF"** descarga en **un solo documento** (uno por
> página, CON firma) a los que estén marcados; si no hay ninguno marcado, descarga TODOS los que
> quedaron filtrados. El botón **"🧾 PDF"** de cada tarjeta sigue igual para bajar uno solo.
> Al lado hay un botón **"📄 Resumen"** (mismos marcados/filtrados): arma un solo PDF con la misma
> tabla de cada requerimiento pero **SIN firma** y **agrupados uno debajo del otro** (no uno por
> página) — para una vista rápida de todo lo filtrado sin gastar una página completa por cada uno.

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
- **Filtro:** en **📋 Realizados** hay chips para saber si **retorna o no** al inventario:
  **Todos · 📦 Sin retornar** (aún en destino) **· ↩️ Retornados**. Así ves rápido cuáles faltan por reingresar.
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
- **📍 Tu ubicación + máquinas cercanas:** el mapa muestra **tu ubicación** (punto azul, si le
  das permiso de GPS al navegador) y con el botón **📍** dentro del mapa te **centra** en ella y
  lista las **máquinas más cercanas** (≤20 km) con su distancia. Además, al **tocar cualquier
  punto del mapa** aparece un globo con las **máquinas cercanas a ese punto**.
- **🧭 Mostrar / Ocultar rutas:** las **rutas** (recorrido de cada máquina) vienen **ocultas**;
  con el botón **"🧭 Mostrar rutas"** (arriba del mapa) las prendes y apagas cuando quieras.
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
  eliges una máquina (las que faltan por ubicar salen primero; cada una muestra su **placa/serial**
  y su **empresa** para no confundirlas) y **tocas el mapa** en el punto donde está; queda ubicada
  al instante. Al elegirla, el panel muestra la **placa/serial** y la **empresa** de la máquina.
  **Solo los administradores** pueden reubicar máquinas y eliminar ubicaciones del mapa.
- **📄 Máquinas por sector (Este / Oeste) (reporte PDF):** agrupa las máquinas **ubicadas** por
  su **sector geográfico** (macro **🟢 Este / 🟠 Oeste** y su **sub-sector**, según el GPS de la
  máquina), con su **placa/serial**, el **edificio/referencia** que puso el inspector al ubicarla,
  el **inspector** asignado y la **empresa**. Las que **no están en el mapa** salen aparte como
  **"⛔ SIN UBICACIÓN (faltan por ubicar)"** con su placa/serial.
- **🔎 Buscador del mapa:** la lupa de búsqueda está **limitada a La Guaira** — solo encuentra
  calles, sectores y lugares de la franja costera de La Guaira; lo de otros estados no aparece.
- **🕵️ Monitoreo (solo administradores):** el panel **"Monitoreo · quién ubica"** (colapsable,
  igual que Sectores) muestra **quién colocó** cada ubicación, con su **fecha y hora**. Toca una
  fila para ver esa máquina en el mapa. Sirve para **vigilar quién está haciendo las ubicaciones**.
  *Nota:* solo registra el nombre a partir de ahora; las ubicaciones anteriores salen sin autor.

### 4.12. Reportes
Genera documentos **PDF** para imprimir o compartir, eligiendo el **rango de fechas** y la
**empresa**. Al generarlos se abre una **ventana con la vista previa** y los botones
**🖨️ Imprimir** y **Cancelar**.

> **Resumen del corte (arriba del Informe por jornada):** en la parte superior del PDF salen
> cuatro recuadros con el **Total de horas por corte**, el **Total $**, el **Total abonado**
> (lo ya pagado en el rango) y el **TOTAL PENDIENTE** (*total $ − abonado*). El detalle por
> empresa/máquina y el total general siguen igual, más abajo.

**👷 Reporte de INSPECTORES (jornadas de inspección):** dentro de Reportes, elige el tipo
**"👷 Inspectores"**. Muestra, agrupado **por inspector**, sus máquinas asignadas con estado
(en curso/parada/finalizada/por iniciar), horas de día/noche/total, desglose por sector y las
ubicaciones cuando una máquina cambió de sitio. La jornada de día la firma un inspector y la
de noche otro; al final de cada uno va su línea de firma.
1. Elige el **Día**.
2. Elige el **Turno**: **☀️ Día**, **🌙 Noche** o **☀️🌙 Ambos**.
3. Debajo aparece **"Inspectores (marca uno o varios)"**: una lista de **checkboxes** con los
   inspectores que tienen jornadas ese día/turno/empresa (se recalcula sola al cambiar la fecha,
   el turno o las empresas marcadas arriba). Hay un checkbox **"👷 Todos"** para marcar/desmarcar
   todos de un tirón (misma mecánica visual que el filtro de empresas), y uno por cada inspector.
   Si la lista sale vacía, avisa *"Sin jornadas de inspección para esta fecha/turno/empresa"*.
4. El PDF generado incluye **únicamente** a los inspectores marcados; si no marcas ninguno
   (queda en "Todos"), salen **todos**.
5. En el PDF, la sección **"🗺️ Máquinas que cambiaron de ubicación"** es una **tabla** (ya no una
   lista) con las columnas: **Máquina/Equipo**, **Ubicación anterior** (sector, referencia y
   coordenadas de origen), **Ubicación nueva** (sector, referencia y coordenadas de destino) y
   **Hora/Fecha** (horario de Caracas) del cambio. Si una máquina cambió de sitio **varias veces**
   en el día, sale **una fila por cada transición** consecutiva.

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

> **Permisos EXTRA por usuario:** aunque tenga un rol, en **Editar usuario → "Permisos por
> módulo"** puedes **darle acceso adicional** a módulos que su rol no incluye (Lectura /
> Escritura / Full control, o el atajo **"✅ Full a todo"**). El sistema toma **el MAYOR**
> entre lo que da su rol y lo que le marcas aquí, así que ese permiso extra **SÍ** se aplica y
> el módulo le aparece. (Antes se ignoraba: podías darle full control y no le salía.)

**Catálogo de roles:** el administrador **crea, EDITA (✏️) y borra** roles FIJOS. Al
crear/editar eliges el **TIPO**:
- **📋 Módulos** — rol fijo que navega por la **app normal** (pestañas + Más) mostrando solo los
  módulos marcados.
- **📷 Coordinador QR** — el usuario ve un panel con **escáner QR** (surtir gasoil, avería,
  marcar máquina lista). No usa módulos.

No se puede **borrar** un rol si tiene **usuarios vinculados** (el sistema te avisa).

---

### 4.13b. Auditoría (bitácora — quién hace qué)

La ven **todos los administradores** (y quien tenga el permiso). Registra, con **fecha y hora**
(horario de Caracas) y **nombre y apellido** de quien lo hizo, todo lo que pasa en el sistema.
Además de las creaciones/modificaciones/eliminaciones de cada módulo, ahora registra **eventos**
que antes no quedaban:

- **🔑 Inició sesión** — quién entró y **desde qué dispositivo** (📱 teléfono o 💻 PC, con el
  sistema: Android/iPhone/Windows).
- **📷 Escaneó** — qué **máquina** se escaneó (código) y a qué hora.
- **🟢 Inició jornada / 🏁 Finalizó jornada / 🟡 Parada** — la máquina, las horas y el motivo.

Se filtra por **día**, por **usuario** y por **tipo**. Tocando un renglón se ve el detalle
completo (quién, qué, a qué máquina, cuándo y desde qué dispositivo).

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

Rol para controlar la **jornada y la entrada/salida de camiones** al patio, y reportar averías, por QR.

- **🕒 Jornada de camión** → escanea el **QR del camión** para **INICIAR** su jornada; al
  **escanearlo de nuevo** la **FINALIZA** (pide confirmar mostrando el total de horas). Las horas
  van a **Control de maquinaria** (turno día/noche) y la jornada aparece en **Inspecciones**.
  Debajo se ve la lista de **🟢 Camiones en jornada** (asistencia) con el tiempo transcurrido y un
  botón **🏁 Finalizar** por cada uno.
- **📷 Entrada / Salida** → elige **ENTRADA** o **SALIDA** del camión (queda con la hora).
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
- **⏱️ Mantenimiento:** una máquina **cruza un umbral de horómetro** (200/220/250 h) desde su
  último mantenimiento confirmado — también le llega al **supervisor**, no solo al administrador.

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

### Carga masiva por Excel (versión web)

Arriba, junto al buscador, hay dos botones:

- **⬇️ Plantilla Excel:** descarga una plantilla con los encabezados y una hoja **"Máquinas (referencia)"** con los códigos/serial válidos para copiar.
- **⬆️ Carga masiva:** sube la plantilla llena para crear **muchas inspecciones de una vez**.

En la plantilla, **1 fila = 1 ítem** del inventario. En cada fila escribe el **código o serial de la máquina** y su ítem (descripción, cantidad, unidad, serial, estado y **nivel**: *bien / regular / falla*). Varias filas con la **misma máquina** se agrupan en **una sola inspección**; la fecha, hora, inspector, operador y condición general se toman de la **primera fila** de esa máquina.

Al subir el Excel, el sistema muestra una **vista previa por máquina** con su **tipo** y el inventario detectado (nº de ítems y semáforo), marcando **✓ lista** o **✕ error** (por ejemplo, si el código no existe o la máquina no trae ítems). Solo se cargan las **✓ listas**; las que tienen error se **omiten** (corrige la plantilla y vuelve a subirla). Toca **"💾 Cargar N inspección(es)"** para guardarlas todas.

---

## 4.25. Notas técnicas (para quien administra el proyecto)

Pendientes que requieren una acción **manual** (fuera del código) para que algunas funciones nuevas
queden 100% operativas:

- **🔴 OBLIGATORIO — Sincronización en vivo de Inspectores y patio:** ejecutar manualmente
  `supabase/fix_realtime_publication.sql` en el **SQL Editor de producción de Supabase**. Agrega
  `public.machine_inspectors` y `public.truck_yard_logs` a la publicación `supabase_realtime`. Sin
  este paso, las pantallas de **CHECK MÁQUINA** y de **entrada/salida de camiones en el patio**
  siguen sin actualizarse solas en todos los dispositivos.
  - Nota: `supabase/inspector_asignacion.sql` ya intentaba agregar `machine_inspectors` a la
    publicación al final del archivo; si ese script ya corrió en producción, esa parte del fix es
    un no-op inofensivo.
  - La tabla `truck_yard_logs` no tiene un `CREATE TABLE` versionado en el repositorio (se creó
    directo en el SQL Editor de producción); conviene documentar/crear su DDL en un archivo
    versionado para no depender solo de la memoria del entorno de producción.
- **🔴 OBLIGATORIO — Alertas por horómetro:** ejecutar `supabase/horometro_alertas.sql` en
  producción. Agrega la columna `machinery.horometro_base`, hace el **backfill** inicial (las
  máquinas sin mantenimiento registrado arrancan en 0 h acumuladas, igualadas a su horómetro
  actual) y crea el **trigger/función** que dispara la notificación por la campana. Si se prefiere
  otro criterio de arranque para alguna máquina, ajustar manualmente esa columna después de correr
  el script.
  - Los **umbrales** (200/220/250 h) están escritos por partida doble, en
    `supabase/horometro_alertas.sql` y en `src/lib/horometroAlertas.ts`: si cambian, hay que editar
    **ambos** archivos en conjunto.
- **No requieren SQL nuevo** (reutilizan tablas/columnas ya existentes):
  - El filtro de inspectores y la tabla de ubicaciones del **Reporte de INSPECTORES** (usa
    `machine_inspectors.shift` y `supervisor_visits.visited_at`, ya existentes).
  - El **Reporte resumen por inspector** (usa `machine_rounds`, `maintenance_requests`,
    `machine_inspectors` y `machinery`, sin cambios de esquema).
  - Los equivalentes en **Bs (BCV)** de Nómina/Pago a personal y el **Excel de Pago a personal**
    (la tasa BCV ya se guarda en la tabla existente `bcv_rates`).
- **Pendiente de revisión visual** (no bloquea el uso, pero conviene chequear cuando se pueda):
  - El salto de página de la nueva **tabla de cambios de ubicación** del Reporte de INSPECTORES,
    con un caso real de máquina con 2+ cambios de ubicación en el día.
  - El layout de las nuevas líneas en **Bs** dentro de las tarjetas de Pago a Personal (se agregó
    texto/alto extra en varias tarjetas): revisar en el navegador (`npm run web`).
  - El botón **"📄 Reporte resumen por inspector"** se validó con `npx tsc --noEmit` (sin errores)
    pero no se probó todavía en un navegador real.
- **Pendiente de decisión del usuario:**
  - Confirmar si el match de **"JESÚS LOZADA"** para el botón 🗂️ SISTEMA en la Vista de Inspector
    (por nombre completo, sin distinguir mayúsculas/tildes) es suficiente, o si se prefiere
    matchear por **cédula/ID de perfil** en vez de `full_name` (el nombre podría cambiar si se
    edita el perfil).

### Seguridad: fuga de sueldos/datos bancarios a sesión anónima (cerrada)

Se encontró y cerró una fuga real: `EmployeeCardScreen.tsx` (la "Ficha del trabajador" que se abre
al escanear el QR de un carnet, **sin login**) leía la fila completa de `employees`, exponiendo
`base_salary`, `bank_account`, `bank_holder`, `bank_cedula` en la respuesta y en el PDF "Ficha
completa" (sección "🏦 Datos bancarios"). `src/lib/jornada.ts` y `MachineQuickScreen.tsx` (inicio de
jornada por cédula, escaneo de carnet de operador) tenían el mismo patrón.

- Los 3 flujos ahora usan la función RPC pública `employee_public_lookup()` (solo columnas no
  sensibles) en vez de leer `employees` directo.
- **🔴 OBLIGATORIO — si no se ha ejecutado ya:** `supabase/fix_rls_anon_nomina.sql` en producción
  (crea la función + restringe `employees_read`, `staff_pay_items`, `staff_payments`,
  `company_payments`, `payrolls`). **El código ya está desplegado asumiendo que esa función
  existe** — si por algún motivo se revierte esa migración, se rompe el escaneo de QR en campo.
- **🔴 OBLIGATORIO — nuevo:** `supabase/fix_rls_anon_nomina_v2.sql` (follow-up, tablas sin uso
  anónimo: `staff_pay_periods`, `staff_pay_payments`, `staff_cargo_tariffs`, `staff_pay_config`,
  `payroll_periods`, `payroll_items`). Puro SQL, sin dependencia de código.

### Tramos de trabajo por máquina (nueva tabla, 03/08/2026)

Se agregó `public.machine_work_segments`: un historial auditable de cada tramo de trabajo
(inicio → fin) de una máquina, EN PARALELO a `machine_rounds.day_hours`/`night_hours` (que
**no se tocó** — siguen siendo la fuente de verdad para nómina y reportes, exactamente igual
que antes). Cada vez que se cierra una jornada (manual, por parada, automática a las 7am/7pm,
o por un ajuste manual de horas en Control de Maquinaria) se guarda un tramo nuevo, sin borrar
ni pisar nada anterior. Se ve desde el botón "🕒 Ver tramos" en Control de Maquinaria (sección
4.5, arriba).

- **🔴 OBLIGATORIO** — ejecutar `supabase/machine_work_segments.sql` en producción (crea la
  tabla; es aditivo, no afecta nada existente).
- Migración 100% aditiva: no se usó `DROP TABLE`, `DROP COLUMN`, `DELETE` ni `TRUNCATE` en
  ningún archivo de este cambio.
- Los días anteriores a esta fecha no van a tener tramos (no se puede reconstruir el detalle
  histórico), pero su total en `day_hours`/`night_hours` sigue siendo válido.

### Ronda de cierre de auditoría (03/08/2026)

- **✓ EJECUTADO (04/08/2026)** — `supabase/fix_realtime_publication_v2.sql`: completa la
  sincronización en vivo para `dispatches`, `fuel_intakes`, `transfers`, `stock_movements`,
  `tanks`, compras (`purchase_requests`, `purchase_orders`, `suppliers`) y nómina
  (`payroll_periods`, `staff_pay_periods`).
- **Opcional/baja prioridad, sin ejecutar** — `supabase/staff_pay_config.sql`: crea una tabla que
  falta en `schema.sql`, pero no bloquea nada en uso (el módulo de Pago a personal no depende de
  ella hoy). Si al pegarlo da `syntax error at or near "-"`, es que el copiado convirtió el `--`
  del comentario en un solo guion (típico al pasar el texto por un editor enriquecido/Notion/Word
  antes de pegarlo) — cópialo directo del archivo o del "Raw" de GitHub. No es necesario para que
  el resto del sistema funcione.
- **✓ EJECUTADO (04/08/2026)** — `supabase/schema_drift.sql`: deja versionadas dos columnas que ya
  existían en producción pero no en el repo (`profiles.cedula`, `machinery.viajes`/`precio_viaje`).
- **⚠️ Probar antes de confiar ciegamente, sin ejecutar** — `supabase/fix_stock_race_condition.sql`:
  agrega bloqueo (`select ... for update`) al validar stock disponible en despachos/traslados, para
  evitar que dos despachos concurrentes dejen un tanque en negativo. Se recomienda probar con dos
  despachos simultáneos en un entorno de prueba antes de confiar en producción.
- **Ya en el código, sin SQL pendiente:** el cierre manual de jornada nocturna ahora cierra contra
  la fecha en que se inició (no contra "hoy"); el horómetro final ya no acepta un valor menor al
  inicial; el reporte "Estado de máquinas" ya trae totales y firma del responsable.

### Bug de sesión: se cerraba sola y botaba al usuario de su pantalla (04/08/2026)

- **Reporte:** a los administradores se les cerraba la sesión sola y, al sincronizar, la app los
  sacaba de la vista en la que estaban.
- **Causa:** en el **teléfono**, Supabase solo renueva el token de sesión mientras la app está en
  primer plano. `AuthContext.tsx` nunca le avisaba a Supabase cuándo la app pasaba a segundo
  plano/primer plano, así que tras dejar la app en segundo plano varias horas el token vencía sin
  renovarse; al volver, la sesión ya no era válida y se cerraba sola (mostrando el login y
  perdiendo la pantalla en la que se estaba).
- **✓ Hecho, sin SQL** — `src/context/AuthContext.tsx` ahora escucha `AppState` de React Native
  (solo en nativo, no aplica a la versión web) y llama a `supabase.auth.startAutoRefresh()` /
  `stopAutoRefresh()` al entrar/salir de primer plano — el fix que la propia documentación de
  Supabase recomienda para React Native.
- **Si sigue pasando en la web (PC/navegador):** la causa más probable ahí es otra — varias
  pestañas abiertas con la misma cuenta (cada renovación de token invalida la anterior; si dos
  pestañas renuevan casi al mismo tiempo, una queda con un token inválido y se cierra sola). Avisar
  si se puede confirmar que pasa en PC (no solo en el teléfono) para atacar esa causa específica.

**Distinto pero relacionado — "al refrescar la pestaña del navegador me saca de la vista donde
estoy" (04/08/2026):** en `src/navigation/index.tsx` ya existía desde el 30/07 un mecanismo que
guarda en `localStorage` la pantalla/pestaña activa y la restaura al recargar la página — pero
tenía una condición que lo **desactivaba por completo en el teléfono** ("ahí la vista la fija el
rol/dispositivo"). Confirmado con pruebas reales en el navegador (Chrome DevTools emulando un
Android): navegar a otra pestaña en Inspectores y recargar siempre volvía a "Revisar", nunca
guardaba nada. **✓ Hecho y probado:** se quitó esa exclusión — ahora también persiste en teléfono,
guardando en una clave de `localStorage` distinta a la de PC (`NAV_STATE_V1_PHONE` vs
`NAV_STATE_V1`, porque el árbol de pantallas es diferente entre PC y teléfono). Probado en vivo:
recargar ahora sí mantiene la pestaña donde estabas.

### Analistas, RBAC, Coordinador de Inspectores y maquinaria no asignada (04/08/2026)

- **Sin SQL pendiente** — Asistencia para analistas: el rol `analista` ya tiene acceso de escritura
  al módulo `asistencia` por defecto (código en `AuthContext.tsx`), sin necesitar una fila manual en
  `module_permissions`. Si un admin le da explícitamente un nivel mayor a un analista puntual, ese
  nivel manda igual.
- **Sin SQL pendiente** — Coordinador de Inspectores: nuevo permiso de módulo
  `coordinador_inspectores` (se activa desde **Usuarios**, como cualquier otro permiso). Es
  ADITIVO: el administrador sigue pudiendo coordinar igual que siempre.
- **🟡 Opcional** — `supabase/fix_user_role_enum_drift.sql`: agrega el valor `'coordinador_patio'`
  al enum `user_role` de forma idempotente (se sospecha que ya existía en producción agregado a
  mano; el script no falla si ya está). Ejecutar si no se está seguro de que ya existe.
- **`supabase/auto_full_shift_no_asignada.sql` — SUPERADO, no ejecutar.** Quedó reemplazado por
  `supabase/maquinas_faltantes.sql` (ver siguiente sección), que sí tiene la definición de negocio
  ya confirmada por el cliente.

**Auditoría RBAC — mapeo de los 8 cargos pedidos a las pantallas ya existentes:**

| Cargo pedido | Estado hoy |
|---|---|
| Inspectores | Ya resuelto — rol fijo `supervisor` (etiqueta visible "inspector"), pantalla `SupervisorTabs`. |
| Personal de Cocina | Ya resuelto — rol fijo `cocina`, pantalla `CocinaScreen`. |
| Chofer de Camión de Combustible | Ya resuelto — `panel_type='chofer_combustible'` (rol dinámico), pantalla `FuelDriverStack`. |
| Coordinador de Patio | Ya resuelto — rol fijo `coordinador_patio`, pantalla `PatioStack`. |
| Administradores | Ya resuelto — rol fijo `admin`, app completa. |
| Coordinadores Preventivos | Requiere que un admin cree un **rol dinámico** nuevo en Usuarios (`panel_type='modulos'`) y le marque los módulos de Mantenimiento correspondientes — no requiere código nuevo. |
| Coordinadores Correctivos | Igual que el anterior: rol dinámico nuevo con los módulos de averías/reparaciones marcados. |
| Almacenistas | Rol dinámico nuevo con el módulo `inventario` (y `compras` si aplica) marcado. |
| Coordinador de Operadores | Rol dinámico nuevo con el módulo `operadores`/`control_maquinaria` marcado. |
| Coordinador de Inspectores | Ya resuelto en esta ronda — permiso de módulo `coordinador_inspectores` (ver arriba), no rol nuevo. |

> **Ojo con el teléfono:** los roles dinámicos (Preventivo/Correctivo/Almacenista/Operadores) que
> un admin cree en Usuarios funcionan bien en PC (ven su panel de módulos), pero **en el teléfono**
> hoy caen en la misma vista de Inspector que todos (no se interceptan aparte, como sí se hizo con
> `coordinador_patio` y `chofer_combustible`). Si alguno de estos cargos necesita trabajar
> principalmente desde el teléfono con su propio panel (no la vista de Inspector), avisar para
> agregar esa intercepción específica en `navigation/index.tsx`.

### Jornadas por turno, filtro "Suyas" y MAQUINAS FALTANTES (04/08/2026)

- **Sin SQL pendiente** — Inspecciones → "Jornadas de máquina": los botones "Expandir todo /
  Colapsar todo / Reporte resumen por inspector" se quitaron. En su lugar hay un filtro
  **☀️ Día / 🌙 Noche** que arranca solo en el turno actual (según la hora de Caracas) y se puede
  cambiar en cualquier momento; se combina con la búsqueda libre.
- **Sin SQL pendiente** — Coordinador de Inspectores (teléfono) → "✅ CHECK máquina → Asignar": al
  elegir un inspector, la lista arranca mostrando **solo sus máquinas** ("👤 Suyas"). Para
  reasignarle una máquina de otro inspector o agregarle una nueva, toca "Todas" y búscala — la
  reasignación funciona igual que antes en cualquiera de los 3 modos.
- **Sin SQL pendiente** — Nómina "Por período": si un empleado que ya estaba incluido en un período
  fue desincorporado (inactivo/suspendido) después, ahora se le ve un badge rojo "Desincorporado"
  junto a su nombre en el detalle del período. Es solo un aviso visual, no cambia el monto ya
  cargado ni quita a la persona de la lista.
- **✓ EJECUTADO en producción (04/08/2026)** — `supabase/maquinas_faltantes.sql`: creó un usuario
  **virtual** "MAQUINAS FALTANTES" (cuenta de sistema, nunca inicia sesión — no borrarlo) y activó
  2 cron jobs, ya corriendo:
  - `assign_missing_to_placeholder()` cada 15 min: a cualquier máquina operativa que le falte
    inspector en el turno día y/o noche, se lo asigna automáticamente a MAQUINAS FALTANTES (se ve
    igual que cualquier inspector real en "Resumen"/"Jornadas de máquina").
  - `auto_full_shift_placeholder()` 1 vez al día (00:15 Caracas): le carga **12h** al turno día y/o
    **6h** al turno noche de "ayer" a toda máquina cuyo turno siga en manos de MAQUINAS FALTANTES
    (18h si le faltan los dos). En cuanto un inspector/supervisor reasigna ese turno a una persona
    real desde la app (como siempre se ha hecho), el cron deja de tocarlo.
  - Impacta horómetro, alertas de mantenimiento y nómina — vale la pena revisar `machine_rounds` /
    `machine_work_segments` (filtrando `source = 'auto_full_shift'`) en los próximos días para
    confirmar que el resultado es el esperado. Para desactivarlo si hace falta:
    `select cron.unschedule('assign-missing-to-placeholder');` y
    `select cron.unschedule('auto-full-shift-placeholder');`.

### Bolqueta/toronto sin asignar: jornada 12x12 (04/08/2026)

Pedido del cliente: las bolqueta/toronto (camiones) que quedan **sin inspector asignado** (y por
tanto caen automáticamente en el usuario virtual **MAQUINAS FALTANTES**) deben trabajar **12x12**
(12h día + 12h noche = 24h), no las 18h (12h día + 6h noche) que traían por defecto. Las bolqueta/
toronto que **sí tienen un supervisor real** asignado deben trabajar con total normalidad — horas
reales, mismo flujo de "Iniciar/Finalizar jornada" que cualquier otra máquina, sin el trato especial
que tenían antes (antes se les forzaba a cerrar a la 1:00am con horas fijas 12/6 sin importar quién
las manejara). Solo el usuario "máquinas sin asignar" se ve afectado por este cambio.

- **🔴 SQL pendiente — correr en este orden en Supabase → SQL Editor:**
  1. `supabase/backup_antes_12x12_camiones.sql` — respaldo de las jornadas/segmentos de camiones
     antes del cambio (por si hay que comparar o revertir).
  2. `supabase/cap_truck_hours.sql` — actualizado: el tope de horas (antes 12 día / 6 noche fijo
     para TODO camión) ahora solo aplica mientras el turno siga en manos de MAQUINAS FALTANTES, y
     el tope de noche sube a 12 (antes 6). Si el turno es de un supervisor real, ya no hay tope.
  3. `supabase/auto_close_jornadas.sql` — actualizado: se quitó el cierre especial a la 1:00am con
     horas fijas para camiones. Ahora un camión con supervisor real cierra igual que cualquier
     máquina (7pm día / 7am noche, horas reales).
  4. `supabase/maquinas_faltantes.sql` — actualizado: `auto_full_shift_placeholder()` ahora genera
     12h+12h (24h) para bolqueta/toronto sin inspector, y sigue en 12h+6h (18h) para el resto de
     maquinaria sin inspector. Al final del script corre una asignación inmediata (no hay que
     esperar los 15 min del cron) para poner al día cualquier máquina que hoy no tenga inspector.
  - No se tocan datos históricos — el cambio solo afecta jornadas nuevas hacia adelante.
  - Impacta horómetro, alertas de mantenimiento y nómina de las bolqueta/toronto sin asignar (pasan
    de acumular 18h/día a 24h/día) — vale la pena revisar los próximos días.

### Cierre final de UI/UX: modo oscuro, skeletons y estados (04/08/2026)

- **Sin SQL pendiente** — Se auditaron sistemáticamente los ~45 archivos con color fijo del
  diagnóstico original (repartidos en 4 lotes en paralelo) y se corrigieron los que realmente se
  veían mal en modo oscuro (fondo claro fijo + texto oscuro fijo, o viceversa): banner "⏰
  Recordatorio de pagos" de Control de Pagos (tenía texto blanco fijo sobre un fondo que en oscuro
  queda casi ilegible), texto de turno "abierta" en Asistencia, alerta de consumo de combustible en
  Control de Maquinaria, y el botón "Enviar a reparación"/badge de avería en Mantenimiento de
  Maquinaria. El resto de colores fijos revisados (pines de mapa, botones sólidos con texto blanco,
  esquemas categóricos de más de 3-4 valores, y todo lo que solo se usa para exportar PDF/Excel) se
  dejaron igual a propósito — no son el mismo bug.
- **Sin SQL pendiente** — Nuevo `SkeletonList` (en `src/components/ui.tsx`) reemplaza el spinner que
  dejaba la pantalla en blanco mientras carga, en las 11 pantallas que blanqueaban TODA la pantalla
  (no solo una lista con su cabecera ya visible): fichas/QR (AliadoCard, AliadoInfo, EmployeeCard),
  Asistencia de camiones, Cocina, Comida, Compras, FoodCompany, las 6 sub-vistas de Inventario,
  Supervisión y Supervisor.
- **Sin SQL pendiente** — El estado de VISITA a una máquina (trabajando/parada/no está), que
  `SupervisorScreen.tsx` y `SupervisionScreen.tsx` definían cada uno por su lado con los mismos 3
  colores hex, ahora vive en un solo lugar (`VISIT_STATUS_META` en `src/lib/statusMeta.ts`) y ambas
  pantallas leen de ahí.
- **Sin SQL pendiente** — Nómina "Por período": el cliente pidió, además del badge "Desincorporado"
  agregado antes, poder filtrar esa misma lista — ahora hay un buscador por nombre y los mismos 3
  chips de "Por persona" (Activos/Todos/Inactivos-Desincorporados) en el detalle del período,
  combinables con el filtro de cargo que ya existía.
- **Sin SQL pendiente** — Nómina "Por período" (ampliación el mismo día): cada persona tiene un
  checkbox y hay un botón "Seleccionar todos" que marca a los que están visibles según el filtro
  activo (p. ej. filtrar a "Inactivos/Desincorporados" y seleccionarlos todos). El botón Excel
  exporta SOLO a los seleccionados si hay alguno marcado; si no hay ninguno, exporta todos
  (respetando el filtro de cargo, como siempre). El PDF del período no cambió, sigue exportando
  todo.
- **Sigue sin hacer, a propósito:** el aumento de fuente de metadatos (10–11px → 12–13px) del
  diagnóstico original — es un cambio transversal a toda la app, alto riesgo de romper
  layouts ajustados y no se puede verificar sin QA visual real; y las notificaciones push
  (`expo-notifications`) — requiere credenciales de push y un Edge Function nuevo, fuera de alcance
  hasta que se confirme que se quiere construir.

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
- **🕒 La "fecha de hoy" siempre es la de Caracas:** en TODAS las pantallas (móvil y web), cuando
  el sistema calcula "la fecha/hora de hoy" (por ejemplo, la fecha por defecto de un nuevo período
  de nómina, un abono, un filtro de fecha o un envío a reparación), usa el **horario de Caracas
  (America/Caracas)**, **no** el reloj/zona horaria del dispositivo del usuario. Es una garantía
  del sistema: no cambia según la configuración del teléfono o el navegador de quien lo usa.
- **✅ Avisos de éxito/error:** ahora aparecen como un **mensaje flotante** (verde = éxito,
  rojo = error) en la parte de la pantalla, en vez del cuadro de diálogo de antes, que en la
  versión web **no se veía**. Ya funciona igual en el teléfono y en la computadora.
- **🔽 Deslizar hacia abajo para refrescar:** en varias pantallas de lista (Supervisor,
  Supervisión, Inventario, Compras, fichas/QR, entre otras) puedes **deslizar hacia abajo**
  para recargar la información sin salir ni volver a entrar.

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
