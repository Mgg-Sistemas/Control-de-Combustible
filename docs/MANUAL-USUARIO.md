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

> **📍 Edificio / residencia (19-ago-2026):** en cada máquina se muestra el **edificio o
> residencia** donde está, con su sector (ej. **"📍 EDIFICIO PUNTA PIEDRA - MACUTO"**). Sale del
> catálogo de ubicaciones; el sector geográfico (🧭 Este/Oeste) se sigue calculando aparte desde
> el GPS.

> **🆔 El nombre NO identifica a una máquina — la placa o el serial sí (18/08/2026):** el
> nombre **se repite a propósito**. Hoy hay **tres** máquinas llamadas exactamente
> `RETROEXCAVADORA` (identificadores **008**, **053** y **073**), y el sistema lo permite
> porque lo que de verdad distingue a un equipo es su **placa** o su **serial** — de hecho son
> los únicos datos que el sistema obliga a no repetir.
>
> **Esto causó una confusión real.** Un inspector sacó dos reportes del mismo día: en uno una
> RETROEXCAVADORA salía **averiada**, en el otro una RETROEXCAVADORA salía con **9.34 horas
> trabajadas**. Parecía que el sistema se contradecía. Los dos documentos estaban bien: eran
> **dos máquinas distintas con el mismo nombre**. La averiada era la 053; la que trabajó, la 008.
>
> **Qué cambió:** donde antes se veía solo el nombre, ahora se ve **`NOMBRE · PLACA`** (o el
> serial, o el identificador, en ese orden — la placa primero porque es lo que se usa para
> asignar). Aplica en la ficha del trabajador, en la lista de máquinas del operador, en el
> reporte de trazabilidad, en la asignación de inspectores, en el reporte del inspector y en la
> bitácora de asignaciones.
>
> **Además se corrigieron dos sitios que sumaban mal**, y esto sí eran números equivocados, no
> solo confusión:
> - La **ficha del trabajador** agrupaba las horas **por nombre**: las horas de las tres
>   RETROEXCAVADORAS caían en una sola fila.
> - La tarjeta de **litros por máquina** agrupaba el combustible **por nombre**: mezclaba el
>   consumo de equipos distintos.
>
> Ahora ambas agrupan por la **máquina real**, no por su nombre.
>
> **Y ya se puede buscar por placa o serial**, no solo por nombre — en la pantalla del operador
> el buscador acepta los tres. Los PDF de trazabilidad también salen con nombre de archivo
> distinto por máquina; antes tres equipos generaban tres archivos llamados igual y el último
> pisaba a los anteriores.

Cada máquina puede estar en **uno de cuatro estados**:
- 🟢 **Operativa** — trabajando normal.
- 🔴 **No operativa** — dañada o parada.
- 🕓 **En espera** — llegó pero **todavía no se ha recibido** en el control.
- ⏳ **Esperando instrucciones** — se cargó en el sistema pero **todavía no se decidió** si va a
  Operativa o a Parada.

Para cambiar el estado, abre la máquina y toca el botón del estado que quieras.

> **⏳ Esperando instrucciones (08/08/2026):** sirve para máquinas que se cargan en el sistema pero
> aún no se sabe si van a quedar Operativas o Paradas. Mientras una máquina está en este estado,
> **no le sale a los inspectores** para chequeo ni le piden jornada, y **no genera horas ni
> consumo** — queda en pausa hasta que alguien decida qué hacer con ella. Se activa/desactiva con
> un botón en el **detalle** de la máquina: **"⏳ Esperando instrucciones"** para ponerla en espera,
> o **"✅ Ya se decidió (quitar espera)"** cuando ya se sabe si va Operativa o No operativa. En el
> **Catálogo** aparece como una **4ta tarjeta** junto a Operativas / Averiadas / Retiradas.
>
> **Al AGREGAR una máquina nueva:** el formulario trae el check **"⏳ Dejar 'Esperando
> instrucciones' (aún no decidida)"** **activado por defecto** — toda máquina nueva entra
> directo a este estado, salvo que **destildes** esa casilla al crearla (si ya sabes que va
> operativa de una vez).

> **Máquinas inactivas (No operativa):** al marcar una máquina como **No operativa (⛔)**, sale
> del **catálogo** y de la **lista semanal de Control de maquinaria**; solo aparece en la tarjeta
> **"🔴 Maquinaria inactiva"**. Sus **horas ya trabajadas no se borran** (siguen en los reportes).
> Al volverla **✅ Operativa**, regresa al catálogo y al control. Los detalles de **inactiva** y
> **en espera** salen **agrupados por empresa** (desplegables y colapsables). La lista de
> **inactivas arranca COLAPSADA** (se abre al tocar la empresa) y cada máquina muestra su
> **placa y su serial**.
>
> **🔴/🟢 Fecha de inactivación/reactivación:** cada vez que una máquina pasa a **No operativa**
> o vuelve a **Operativa** desde este botón, su tarjeta muestra la fecha: **"🔴 Inactivada el
> DD/MM/AAAA"** o **"🟢 Reactivada el DD/MM/AAAA"**. Es un dato aparte de las averías/paradas que
> reporta un inspector desde el teléfono (ver más abajo) — este lo mueve el **administrador** a
> mano con el botón de estado.

> **🕘 Última parada/avería resuelta:** si una máquina tuvo una parada o avería reportada por un
> inspector y **ya se resolvió** (alguien tocó "🟢 Volver a OPERATIVA"), su ficha muestra un
> resumen: **"Inactivo desde [fecha/hora] hasta [fecha/hora] — Total: Xd Yh"**. Solo se ve cuando
> la máquina **no está parada/averiada en este momento** (si está parada ahora, en su lugar sale
> el aviso de la avería/parada **vigente**, ver 4.7b).

Otras cosas que puedes hacer en cada máquina:
- 📍 **Ubicación** — guarda dónde está (con el GPS).
- 📷 **Foto** — súbele una foto.
  - **📷🗑 Quitar la foto sin reemplazarla (18/08/2026):** toca la foto de la máquina para abrir el
    **visor**. Ahí están la foto de la **MAQUINARIA** y la del **SERIAL / PLACA**, cada una con sus
    botones. Antes solo se podía **"🔄 Cambiar foto"**, así que para sacar una foto mala o que no
    correspondía había que subir otra cualquiera encima. Ahora hay también **"🗑 Quitar foto"**
    —**sale solo cuando hay foto que quitar**— y la máquina queda **sin foto** hasta que alguien
    suba otra. **Pide confirmación**, porque desde el visor es un solo toque y no hay deshacer; la
    pregunta dice **de cuál máquina** es la foto (nombre **+ placa o serial**), para que con varias
    máquinas del mismo nombre no le quites la foto a la equivocada.
  - **El archivo NO se borra del almacenamiento, a propósito:** la bitácora de 🕵️ **Auditoría**
    guarda el **enlace de la foto anterior**, y borrarlo dejaría ese rastro apuntando a un enlace
    muerto justo cuando alguien pregunte **qué foto había antes**. **Quién** la quitó y **cuándo**
    queda registrado en 🕵️ Auditoría.
- 🔳 **QR** — genera su código para identificarla rápido. La hoja del QR muestra el **nombre** de la
  máquina y su **serial** (o placa) — **no** la empresa. El QR queda **sellado con el serial** de la máquina: si más adelante **cambias el serial**, el QR impreso con el serial anterior **deja de funcionar** (al escanearlo solo sale el logo). Reimprime el QR para volver a activarlo con el nuevo serial. *Nota:* los QR impresos antes de esta versión no llevan sello y siguen funcionando hasta que los reimprimas.
  - **🚫 Bloquear QR:** dentro del 🔳 QR hay un botón para **bloquear** ese QR. Al bloquearlo, quien lo escanee **solo verá el logo** (no puede registrar nada). Sirve para **matar un QR viejo o robado** sin tocar el serial. Con **✅ Desbloquear QR** vuelve a funcionar.
  - **🔴 Retirada = QR bloqueado automático:** cuando una máquina se marca **RETIRADA** (fuera de servicio), su QR **deja de funcionar solo** — al escanearlo **solo sale el logo**, sin necesidad de bloquearlo a mano. Si más adelante la **reactivan** (vuelve a Operativa), el QR **vuelve a funcionar** automáticamente. Esto vale **también cuando el inspector la escanea desde el teléfono**: sale solo el logo con un botón **← Volver** para regresar a su vista (no abre el check-in).
  - **🚫 El inspector ya NO ve el Catálogo (19-ago-2026):** se **quitó** la pestaña **🚜 Catálogo** de la vista del teléfono del inspector. El inspector trabaja con **Revisar** (sus máquinas), **Mapa** y **Ubicaciones**.
  - **🏢 Restricción por empresa:** un **operador solo puede usar equipos de SU empresa**. Si un operador escanea el QR de una máquina de **otra empresa** e intenta identificarse, el sistema lo **bloquea** con un aviso ("Este equipo es de X, solo puedes usar equipos de tu empresa") y **no** lo deja iniciar jornada ni registrar nada. **El inspector NO tiene esta restricción:** puede escanear **cualquier** máquina y marcarla **Operativa/No** (check-in de inspección).
  - **📲 Al escanear el QR de la máquina:** sale una pantalla con el **logo** y **dos botones** — **👷 Inspector / Coordinador** y **👤 Otro usuario**. **Ambos llevan al login**: todos ingresan con **usuario y contraseña**. Después de iniciar sesión, cada quien cae en su vista según su rol (supervisión/check-in para inspector/coordinador; vista de operador para el resto). *Nota:* ahora **todos** los que usan el QR de la máquina necesitan **usuario** (ya no se entra de forma anónima solo con el carnet).
- 🪖 **Supervisor** — asigna quién la custodia (Empresa o Militar). Al escribir el nombre sale la lista de los ya usados para elegirlo rápido; cambiar de supervisor deja el anterior en el historial.

> **🏗️ Edificio, referencia y sector visibles en la tarjeta (05/08/2026):** cada máquina del
> Catálogo ya mostraba su **sector**; ahora también muestra su **edificio** (calculado
> automáticamente a partir de la referencia, con el mismo catálogo oficial de sitios que usa el
> check-in del inspector — ej. "Hotel Litoral Palace") y la **referencia** tal como está escrita
> ("Ref: ..."). Si la referencia no coincide con ningún edificio conocido, sale "Sin edificio
> identificado" (la referencia cruda igual se ve). Se edita desde **✏️ Editar** → campo
> "Referencia / Ubicación (edificio)" y "Sector".

**Editar o borrar supervisores:** en el botón 🪖 toca **"⚙️ Editar / borrar supervisores"**. Ahí puedes **✎ renombrar** un supervisor (se corrige en **todos** sus registros) o **🗑 borrarlo** por completo (las máquinas que custodiaba quedan sin supervisor).

**📄 Reporte de CONTEO de equipos (desde el Catálogo), con todos los datos reales
(05/08/2026):** sigue siendo **sin horas ni precios** (para eso está Control de maquinaria), pero
ahora trae el detalle completo de cada equipo, no solo el conteo. Muestra, en este orden:
1. **Total general** de equipos.
2. **Por empresa** — cuántos equipos tiene cada empresa.
3. **Detalle por empresa** — bajo cada empresa, cada equipo sale con: **Equipo (código),
   Clasificación, Serial, Placa, Sector, Edificio o Referencia** (el edificio si la referencia
   coincide con uno del catálogo oficial; si no, la referencia tal como está escrita — nunca los
   dos a la vez), **Inspector ☀️ Día** e **Inspector 🌙 Noche** (los asignados por **✅ CHECK
   MÁQUINA**, uno por turno — puede haber uno distinto en cada turno), y **Estado**.
- **Alcance:** elige **General (todas)** o una **empresa**.
- **Filtro por CLASIFICACIÓN — lista desplegable con casillas:** toca **"🔎 Filtrar por
  clasificación"** para abrir la lista, **escribe** (ej. *"excavación"*, *"remoción"*, *"volteo"*)
  y **tilda ☑** una o varias clasificaciones para ver solo esas (ej. todos los equipos de
  remoción y excavación de una sola vez). Los equipos sin clasificación cargada aparecen bajo
  **"Sin clasificación"**, no se esconden. Botón **⬇️ Descargar PDF (conteo)**.

> **🏢 Varias empresas a la vez (15/08/2026):** el alcance del reporte ya **no es una sola
> empresa**. Las pastillas de empresa ahora son **casillas** y se pueden marcar **varias**:
> marca GOLDEN y LICCIONE y el PDF sale con las dos, agrupadas por empresa como siempre.
> **General (todas)** no es una empresa más — al tocarla se **limpia** la selección y el
> reporte vuelve a salir completo. Arriba se indica cuántas llevas marcadas, y aparece el
> enlace **"✕ Quitar la selección (volver a general)"**. El título del reporte se adapta:
> con una o dos empresas las nombra (*"Conteo de equipos — GOLDEN + LICCIONE"*) y de tres
> en adelante resume (*"Conteo de equipos — 3 empresas"*), porque los nombres completos no
> caben. Los filtros de **estado** y **clasificación** siguen aplicándose encima de lo que
> hayas marcado.

> **☑️ Incluir el inspector asignado (15/08/2026):** justo encima del botón de descarga hay una
> casilla que decide si el PDF trae las dos columnas **Inspector ☀️ Día** e **Inspector 🌙 Noche**.
> Viene **tildada**, que es como salía el reporte hasta ahora: quien no la toque descarga
> exactamente el mismo documento de siempre. Al destildarla el PDF sale **solo con el conteo**
> (equipo, clasificación, serial, placa, sector, edificio y estado), y el botón cambia a
> **"⬇️ Descargar PDF (solo conteo)"** para que sepas qué vas a bajar antes de tocarlo. Sirve
> para cuando el reporte es para alguien que solo necesita cuántos equipos hay y dónde están:
> las dos columnas de inspector estrechan el resto de la tabla y no le aportan nada.

### 4.5. Control de maquinaria (las horas que trabaja cada máquina)
Esta es la parte del **día a día**. Aquí anotas **cuántas horas trabajó** cada máquina.

> **🔗 Control y el Reporte por Empresa dan las MISMAS horas (16-ago-2026).** Antes no
> cuadraban: durante el turno, Control mostraba **0 h** en una máquina que el Reporte por
> Empresa ya daba trabajando, porque Control solo veía las horas ya **guardadas** y el reporte
> contaba además la **jornada abierta**. Ahora los dos usan el mismo cálculo:
> - una jornada **abierta hoy** cuenta desde el **inicio del turno** (7:00 am el día,
>   7:00 pm la noche), aunque el inspector la haya marcado más tarde — con tope de **12 h**;
> - los **días pasados** no cambian **nada**: muestran exactamente lo que quedó guardado, así
>   que **los cierres y los pagos ya hechos siguen igual**.
>
> Lo que ves en Control durante el turno es una **estimación en curso** que va subiendo hasta
> que el inspector cierre la jornada — igual que el Reporte por Empresa.

> **🚫 Días futuros bloqueados (19-ago-2026):** solo se pueden cargar horas a **días pasados** o
> al **día en curso**. Un día que **todavía no ha transcurrido** no puede tener horas: sale
> marcado **"🚫 Día futuro — no se pueden cargar horas"** con los botones (—/6h/12h) y los campos
> de parada/extra **deshabilitados**. La base de datos también lo blinda.

**Anotar el trabajo de un día:**
1. Elige la **semana** con las flechas ◀ ▶ o el calendario.
2. Abre la empresa y luego la máquina.
3. Por cada día verás **☀️ Día** y **🌙 Noche**. Toca:
   - **—** si no trabajó,
   - **Medio · 6h** si trabajó medio turno,
   - **Completo · 12h** si trabajó el turno completo.
4. Si te lo pide, escribe el **operador** de ese turno.
5. Todo **se guarda solo**.

> **Rol ANALISTA (actualizado 06/08/2026):** puede **poner y quitar horas** libremente
> (día/noche, parada y extra), **incluso las que ya estaban cargadas** — ya no aparece el 🔒 que
> antes bloqueaba corregir un valor existente. Lo único que sigue sin poder tocar es el
> **PRECIO** de la jornada; eso lo sigue haciendo solo un **administrador**. Los cambios de horas
> del analista quedan igual con su rastro (ajuste manual) en **🕒 Ver tramos**.

**🕒 Ver tramos (detalle de cada arranque/parada del día):**
- Junto al total de horas de cada día, hay un botón **"🕒 Ver tramos"**.
- Muestra, uno por uno, cada tramo de trabajo que se registró ese día: hora de inicio → hora de
  parada, cuántas horas duró, y por qué se cerró (🏁 cierre manual del inspector, 🔧 parada por
  avería, 📍 parada/no trabajó, 🤖 cierre automático del sistema —**día a las 7:00pm, noche a la
  1:00am**—, o ✏️ un ajuste manual hecho aquí mismo). Es **solo de consulta** — sirve para revisar y
  confiar en el total, no para editarlo (los ajustes se siguen haciendo con los campos de siempre).

> **Cierre de jornada (regla firme):** el **DÍA cierra a las 7:00pm** y la **NOCHE a la 1:00am**
> (permanencia de noche = 6h). **Excepción LUMINARIA:** las **luminarias** (torres/equipos de
> iluminación) trabajan **toda la noche (7pm→7am)**, así que su jornada de **noche cierra a las 7:00am
> (12h)** — igual pueden cerrarse a mano antes. El único equipo que trabaja **24h** y **nunca** se
> auto-cierra es el **COMPRESOR CON MARTILLO (serial 79669)**. Quien opera puede **finalizar manualmente antes**, pero
> si cierra **antes de la hora de fin del turno** (día <7pm / noche <7am) el sistema le exige
> **OBLIGATORIO el MOTIVO del cierre**. **(Regla 15-ago-2026:)** esto aplica ahora a **TODO cierre
> anticipado, sin excepción** — incluye las máquinas del inspector **"SOS LA GUAIRA"** (siempre
> activas) y los **camiones** cerrados desde **Patio**, **Asistencia de camiones** o el **escaneo de
> QR de la máquina**. Así el motivo queda **siempre registrado** y se ve en la lista de
> **🏁 Cerradas / finalizadas**.
- Si un día no tiene tramos (por ejemplo, uno de antes de que existiera esta función), el total
  de arriba sigue siendo válido — simplemente no hay desglose para ese día.

**⚠️ Marcar un equipo averiado (rápido, desde el control):**
- Arriba, toca **⚠️ Marcar equipo averiado**.
- Elige de la **lista desplegable** la **🏢 empresa** y luego el **🚜 equipo** (se muestra con su
  **serial / placa** para no confundirlo). Puedes escribir para buscarlo.
- Escribe el **motivo** de la avería (opcional) y toca **⚠️ Marcar averiado**.
- El equipo queda **No operativa**, **sale del control** y pasa a **"En reparación"** en el módulo
  **Servicio de Maquinaria**, donde se registra su retorno operativo cuando quede lista.

**🟢 Inspector "SOS LA GUAIRA" — máquinas siempre trabajando:**
- Las máquinas asignadas al inspector **SOS LA GUAIRA** **nunca se muestran como parada ni averiada**:
  siempre cuentan como **trabajando** y sus horas paradas se cuentan como **trabajadas** — en el
  catálogo, el panel de Inspecciones (contadores), el teléfono y todos los reportes (por inspector,
  resumen y por empresa).
- Si a una de esas máquinas se le reporta una avería/parada, el ticket **sí queda** en **Servicio
  de Maquinaria** (para el mecánico), pero **no cambia su estado** de trabajando en las inspecciones.

> **📊 Reporte del día por empresa — TODAS las máquinas (15-ago-2026):** el PDF **📊 REPORTE DEL DÍA
> POR EMPRESA** ahora lista **todas las máquinas de cada empresa MENOS las retiradas/eliminadas**,
> agrupadas por estado: **✅ Activas** (trabajaron), **🔴 Averiadas / Paradas**, **⏳ Esperando
> instrucciones** y **⏳ Pendientes por iniciar**. Antes solo salían las que tuvieron actividad
> (trabajaron, avería o parada) y se omitían las de 0 actividad y las en espera.

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
  solo afecta esa semana**. El **Informe por jornada** y **Control de Pagos** usan ese mismo
  precio blindado (el reporte **Maquinaria** no muestra precios ni montos en $ — ver más abajo).
- **Si no cambias el precio, se mantiene el de la semana anterior** (arrastre automático):
  una jornada sin precio propio hereda el último precio que pusiste en una fecha anterior
  de esa misma máquina. Solo tocas el precio cuando **cambia**.
- **Para corregir un corte con precio equivocado:** ve a esa semana, toca la máquina, pon
  el precio correcto con el rango de esas fechas y Guarda. El reporte de ese corte se
  actualiza al instante y los demás no se tocan. Funciona esté el corte **abierto o cerrado**.
- Al **cerrar un corte**, el sistema **congela el precio**: respeta el precio por rango ya
  fijado y a las jornadas sin precio propio les pone el precio actual de la máquina.
- **Reporte 🚜 Maquinaria (17/08/2026 — ahora es SOLO maquinaria, ya no incluye vehículos):** vive
  dentro de **Reportes**, con sus mismos filtros de **rango de fechas**, **empresas** (checkboxes) y
  **clasificación**. Lista **solo las máquinas que TRABAJARON** en el rango de fechas, cada una con su
  **ficha de catálogo**: **Máquina** (nombre), **Marca**, **Modelo**, **Placa**, **Serial** y
  **Clasificación**. Cada fila tiene un botón **"Ver detalle"** que abre el **historial completo de esa
  máquina** (ver **Trazabilidad e Historial por Equipo** más abajo). El botón **⬇️ PDF** genera la
  misma tabla para imprimir o compartir.
- **🧭 Trazabilidad e Historial por Equipo (nuevo):** pantalla propia dentro de **Reportes →
  Maquinaria** (o tocando **"Ver detalle"** desde cualquier fila del listado de arriba, que
  llega con la máquina ya elegida). Muestra la **historia completa de UNA máquina** en el rango de
  fechas que elijas:
  1. Elige la **máquina** (buscador por código, serial, placa, empresa o encargado) y el **rango**
     (Desde/Hasta).
  2. Toca **"🔎 Consultar historial"**. Aparece un **resumen** (días trabajados, horas totales,
     cantidad de averías y paradas, y tiempo total inactivo), la **lista de paradas/averías** (con
     fecha/hora de inicio, de fin o **"vigente"** si sigue activa, y la duración de cada una), y los
     **días trabajados** con sus horas de día/noche/total.
  3. **"📄 Exportar PDF"** descarga el mismo historial para imprimir o archivar.
- **🔎 Buscar por tipo de equipo (en 📊 Conteo de equipos):** dentro de la vista previa del
  reporte **Conteo de equipos** hay un buscador **con casillas**. Escribe el tipo —por ejemplo
  **"volqueta toronto"**— para filtrar la lista y **tilda** uno o varios tipos; abajo aparece un
  **número grande** con el **total de equipos** y el **desglose por empresa**. Botón
  **"⬇️ PDF de este conteo"** para imprimir el total, la cantidad por tipo y por empresa.

- **🗺️ Zona real por GPS — igual al Mapa (botón en 📊 Conteo de equipos, 08/08/2026):** el conteo
  normal por zona **reparte 50/50** las máquinas que no tienen GPS cargado (para que el total de
  Este/Oeste cuadre con el total general). Este botón, en cambio, genera un **PDF que solo cuenta
  Este/Oeste con la ubicación GPS real** de cada máquina —el mismo cálculo que usa la pantalla del
  **Mapa**, sin adivinar—, y **lista aparte** las máquinas **sin GPS** en vez de repartirlas al azar.
  Úsalo cuando necesites el conteo por zona 100% real; usa el conteo normal cuando necesites que el
  total cuadre siempre con la cantidad de equipos.

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
> reporte** (el del rango/actual, no el precio congelado "del cierre") y **no cobra rondas ni fletes
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

> **🏦 Los Excel traen los datos para transferir (19/08/2026).** Antes solo salía el **Nº de
> cuenta**; ahora sale también el **Titular de la cuenta** y su **C.I. del titular**, que es lo
> que el banco exige para procesar la transferencia. Importa porque **la cuenta puede ser de
> otra persona** (la de un familiar, por ejemplo): si el nombre y la cédula no son los del
> **dueño de la cuenta**, el banco rechaza el pago.
> - **Si la ficha del empleado no tiene titular declarado**, se asume que **el titular es el
>   propio trabajador** y se ponen su nombre y su cédula. Es la misma regla que ya usaba el
>   recibo en PDF, así que los dos documentos dicen lo mismo.
> - Para que salga un titular distinto, llénalo en **Empleados → ✏️ Editar → 🏦 Datos
>   bancarios → "Titular (nombre y apellido)" y "Cédula del titular"**.
> - Aplica a los **tres** Excel: el del **período** (📥 Excel), el de **personas
>   seleccionadas** y el **histórico de una persona** (ahí va en la línea de arriba, y solo
>   se nombra al titular cuando **no** es el propio trabajador).

> **🔒 Un período aprobado o pagado no se puede cambiar (19/08/2026).** Cuando el período ya
> no está en **borrador**, no se pueden **agregar ni quitar personas** ni editar montos: queda
> congelado a propósito, porque es el respaldo de lo que ya se pagó. Antes los botones
> simplemente **no aparecían** y no se decía por qué — parecía que estaban rotos. Ahora sale un
> aviso **"🔒 Período APROBADO/PAGADO: no se puede cambiar"** que te dice qué hacer: tocar
> **↩ Reabrir**, que lo devuelve a borrador y habilita todo otra vez.

> **⚠️ "✕ Desmarcar todos" NO saca a nadie del período.** Ese botón (antes se llamaba
> "✕ Quitar selección", y por eso confundía) solo **limpia las casillas ✓** que sirven para
> exportar a Excel o al PDF **solo a los marcados**. Para **sacar de verdad** a una persona del
> período: **✎ Editar** en su tarjeta → **🗑️ Quitar del período**. Requiere que el período
> esté en **borrador**.

> **🧑‍🦰 Desincorporados: mover a alguien de un período a otro (20-ago-2026).** Tres cosas que
> antes no dejaban hacerlo, ya corregidas:
>
> - **👤 Agregar persona** (botón nuevo, junto a "＋ Personal faltante"): busca por nombre,
>   cédula o cargo en **TODO el registro, incluidos los desincorporados** — que salen marcados
>   con su etiqueta roja — y agrega **solo al que elijas**. Antes la única forma de sumar gente
>   era "＋ Personal faltante", que trae **únicamente empleados activos**: a un desincorporado
>   no había manera de meterlo, ni siquiera para moverlo de un período a otro cuando se le queda
>   un pago pendiente al salir. Al agregarlo **se le calculan sus jornadas del rango**, porque
>   pudo haber trabajado parte del período antes de irse, y eso sí se le paga.
> - **🗑️ Quitar del período** ahora aparece en **cualquier** persona con el período en borrador.
>   Antes solo salía en algunas: estaba amarrado a una marca interna que **no** significa "lo
>   agregaron a mano" sino "no tiene jornadas en el rango" — así que justamente a quien **sí
>   trabajó** no había forma de sacarlo.
> - **El filtro "Inactivos/Desincorporados"** ya no mezcla. Antes, una persona **sin ficha
>   resuelta** (cargada suelta, o cuyo empleado se borró del registro) aparecía **a la vez** en
>   "Activos" y en "Inactivos/Desincorporados", y por eso el filtro "no los reconocía". Ahora
>   **sin ficha ≠ desincorporado**: si está cobrando en el período cuenta como activo, y
>   desincorporado es **solo** quien está inactivo o suspendido. Los de estado **"Otro"** no
>   salen en ninguno de los dos filtros, solo en **"Todos"**. Fijado con prueba automática
>   (`npm run test:pagos`).

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

### 4.6bc. Distribución de días libres (dentro de Nómina)
Reparte la **semana libre POR PERSONA**: se navega por **cargo** (para ordenarse), pero el descanso es
de **cada persona**. Abres un cargo, ves su **gente** (del personal activo) y a cada persona le asignas
su semana libre del ciclo — **cada quien puede descansar una semana distinta**. Está dentro de
**Nómina → 🗓️ Distribución de días libres**.

- Los **cargos y su gente** salen solos del **personal activo** de la nómina.
- **🔎 Filtrar por departamento o por cargo:** el departamento es una **lista desplegable buscable**;
  o escribe en **"Buscar cargo…"**. Así trabajas un departamento a la vez y no todo junto. El **PDF
  sale solo de lo filtrado**. **Limpiar ✕** quita el filtro.
- Elige el **Ciclo** (Desde / Hasta) arriba: define cuántas **semanas** hay para repartir (cada 7 días
  = una semana).
- La vista es un **calendario tipo matriz** (filas = personas agrupadas por su cargo). Con el
  **conmutador 📅 Semana / 📆 Día** (arriba a la derecha) eliges si el descanso se marca por **semana
  completa** o por **días sueltos**:
  - **Por semana:** columnas = las semanas del ciclo. **Toca la celda** para marcar la semana libre
    (se pinta de color); toca la marcada para **quitarla**.
  - **Por día:** columnas = cada día del ciclo. **Toca un día** para marcarlo libre (verde) y toca el
    día marcado para quitarlo. Los días que ya vienen de una semana salen con el color de la semana y
    se editan en modo Semana.
- Debajo de cada columna, **"Libres / semana"** cuenta cuántas personas descansan esa semana — así ves
  de un vistazo si se **juntan** (choque).
- **✨ Repartir automático** (arriba) deja, dentro de cada cargo, a su gente en semanas **distintas** de
  una vez. Después ajustas cualquier celda a mano.
- **Toca el nombre** de una persona (columna izquierda) para ver/borrar sus días libres o agregarle una
  **fecha suelta**. **📄 Generar PDF** imprime el calendario de días libres por persona (respeta el filtro).
- Se actualiza **en vivo** entre dispositivos. **SQL a correr:** `supabase/dias_libres_cargo.sql`.

### 4.6c. Distribución de uniformes (módulo propio, antes solo dentro de Nómina)
Lleva las **tallas de uniforme** de cada empleado, sus entregas, e imprime el listado para la
entrega. Tiene **2 pestañas**: **🧥 Dotación básica** (tallas + entregas de uniforme, lo de
siempre) y **🧰 Otras entregas / herramientas** (nueva, 05/08/2026 — ver más abajo).

> **Acceso y permisos (05/08/2026):** este módulo ahora tiene su **propio permiso** llamado
> **"Distribución de uniformes"**, configurable desde **Usuarios → permisos por módulo** (o desde
> un rol dinámico), igual que cualquier otro módulo — antes no existía este permiso y cualquiera
> que llegara a la pantalla podía editar. Por defecto queda **restringido** (como Nómina o
> Empleados): hay que otorgarlo explícitamente a quien lo necesite. También aparece ahora como
> entrada propia **"🦺 Distribución de uniformes"** en el menú **Más** (antes solo se llegaba
> navegando desde dentro de Nómina) — así se le puede dar acceso a alguien SOLO a este módulo, sin
> darle Nómina completa (por ejemplo, a la persona encargada de dotación).

**🧥 Dotación básica:**
1. Verás el **listado de empleados** agrupado por empresa (con **Activos / Todos** y un
   **buscador** por nombre, cédula o cargo).
2. **Toca un empleado**: se abre para cargar su **👕 talla de camisa**, **👖 talla de
   pantalón**, **👟 talla de zapatos**, **🦺 talla de braga** y **🧥 talla de chaqueta**. Guarda.
3. Las tallas quedan en la ficha del empleado (se ven como etiquetas en cada tarjeta).
4. En ese mismo empleado, sección **📦 Registrar entrega**: escribe cuántas **👕 camisas**,
   **👖 pantalones**, **👟 zapatos**, **🦺 bragas** y **🧥 chaquetas** le entregas ahora y toca **"📦 Registrar entrega"**. La
   **fecha y la hora** se guardan solas. Puedes registrar **varias entregas**: se acumulan y ves
   el **total entregado** y el **historial** (con fecha y hora de cada una). Cada tarjeta muestra
   un badge **📦 Entregado** con el total de prendas recibidas.
5. Toca **"⬇️ Listado (tallas)"**: genera un **PDF** con los empleados mostrados, sus tallas y
   una columna de **FIRMA (Recibido / Entregado)** para firmar al recibir el uniforme.
6. Toca **"📦 Reporte de entregas"**: genera un **PDF** por persona con **cada entrega** (su
   **fecha y hora**) y el **total** de camisas, pantalones, zapatos, bragas y chaquetas entregados.
7. **Al final** del listado de tallas (en pantalla y en el PDF) sale un **📊 Resumen por tallas**:
   cuántas **camisas** hay de cada talla (M, S, L…), y lo mismo para **pantalones**, **botas de
   seguridad**, **bragas** y **chaquetas**, con el total de personas con talla cargada. Sirve para saber cuántas piezas pedir.

> Los PDF respetan el filtro y la búsqueda: incluyen exactamente los empleados que estás viendo.
> **Talla** = el número/letra de cada prenda; **Entrega** = cuántas piezas se le han dado (con su
> fecha y hora).
> Quien tenga solo **lectura** en este módulo ve el listado y el historial, pero no puede editar
> tallas ni registrar entregas nuevas (esos controles se ocultan).

**🧰 Otras entregas / herramientas (05/08/2026):** pestaña de **solo lectura**, sin formulario
propio — se llena SOLA a partir de lo que ya se registra en **Inventario**:
- **Salidas de Almacén** (Inventario → 📤 Salida) con empleado(s) marcados como "Recibe".
- **Traslados de Inventario** (Inventario → 🔁 Nota de traslado) dirigidos a un empleado en Destino.

Filtrable por **empleado** y **rango de fecha**, con botón de **reporte PDF** (Fecha, Empleado,
Cédula, Cargo, Detalle, Origen). Sirve para ver de un vistazo qué herramientas, EPP, insumos o
calzado (fuera de la dotación básica de camisas/pantalones/zapatos) se le han entregado a cada
trabajador, sin tener que ir a buscarlo en Inventario. No es lo mismo que la pestaña **"👷
Dotación"** de Inventario (ver 4.8d): esa junta salidas + entregas de uniforme; esta junta salidas
+ traslados, y vive dentro de Uniformes.

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
> el permiso a mano — el sistema se lo habilita solo. Entra a la app normal (pestañas + **Más**),
> **igual en teléfono que en PC** (ver 4.25 "Cada rol entra a SU vista"), y encuentra el bloque
> **"MARCAR ASISTENCIA DEL PERSONAL"** en **Más → Control de asistencia**, igual que cualquier otro
> usuario con el permiso. Al escanear un carnet, además de foto/nombre/cargo/cédula ahora también
> se ve el **estado del empleado** (🟢 activo · 🔴 inactivo · 🟡 suspendido).

### 4.6d. Empleados — filtrar por cargo y reporte de lo seleccionado
En **Empleados** puedes filtrar la lista por **tipo de cargo** y sacar un reporte de lo que elijas:
1. En el recuadro **🏷️ Cargo**, toca para desplegar los cargos (con su cantidad).
2. **Marca uno o varios** cargos (ej. **OPERADOR**, **OBRERO**…). Se pueden combinar; **"Todos"** limpia la selección.
3. La lista de abajo muestra solo esos cargos (también se combina con **Estado** y la **búsqueda**).
4. Toca **"📊 Reporte"**: genera un **PDF** con el **listado de las personas seleccionadas**
   (nombre, cédula, ficha, cargo, empresa, estado, teléfono) y un **resumen por cargo** con el total.

> El reporte respeta TODO lo que estás viendo (estado + empresa + cargos marcados + búsqueda): imprime exactamente esa selección.

> **🏢 Filtrar por empresa (20-ago-2026):** debajo de los chips de **Estado** hay una línea
> **"Empresa: 🏢 Todas · N"**. Tócala y se despliega la lista de empresas **con su cantidad de
> personas**, con buscador; **marca una o varias**. El personal **sin contratista asignado**
> aparece como **SOS LA GUAIRA** (el empleador), siempre de primero. La **✕** al lado limpia la
> selección de un toque. Se combina con Estado, Cargo y la búsqueda, y **los conteos por cargo se
> recalculan** con la empresa elegida.

> El Excel con tarifas por empleado que existía antes en esta pantalla se retiró: no correspondía
> aquí (exportaba tarifas del empleado). El Excel de nómina ahora vive en **Nómina → Control de
> pago a personal → Por período**, junto al **⬇️ Reporte** del período (ver 4.6b).

> **Estado del empleado — "Otro":** además de **Activo / Inactivo / Suspendido**, un empleado puede
> quedar en estado **"Otro"**. Los empleados en **"Otro"** **NO entran al control de pago**: no se
> precargan al crear una nómina/período y **no aparecen** en **Pago a personal → Por persona** (ni
> siquiera en "Todos"). Úsalo para gente que no debe pagarse por este sistema.

> **Historial de dotación en la ficha (05/08/2026):** al abrir la **ficha de un trabajador** (botón
> **"🪪 Ficha"** desde esta lista, o escaneando su **carnet/QR**), si tiene entregas registradas
> aparece la sección **"📦 Historial de dotación y entregas"**: equipos, herramientas, calzado,
> franelas y demás artículos que se le han entregado, con fecha y detalle — lo mismo que muestra la
> pestaña **"👷 Dotación"** de Inventario (ver 4.8d) pero ya filtrado a esa persona.

> **Constancias por empleado:** en cada persona de la lista hay dos botones de constancia.
> **📄 Const. carnet** es la constancia de **entrega de carnet** (trabajo a destajo; la firma el
> colaborador). **📃 Constancia de trabajo** es el **formato estándar** dirigido *"A quien pueda
> interesar"*: hace constar que la persona **presta servicios en SOS La Guaira**, con su **cédula,
> cargo y fecha de ingreso** (**no incluye el sueldo**). Al pie lleva una **firma centrada para la
> Jefa de Administración**. Sale en **PDF** listo para imprimir o guardar.

### 4.6e. Distribución de Guardias (rotación de descanso de inspectores)
Arma el **calendario de descanso** de los inspectores dentro de un ciclo de fechas (por defecto,
21 días — un ciclo **14×7**: 14 días de guardia y 7 de descanso). Se llega desde **Más**, o desde
los paneles de **Coordinador** y **Asistencia**.

- **Calendario inspector × día:** una tabla con cada inspector en una fila y cada día del rango en
  una columna, marcando **T** (trabaja) o **D** (descansa).
- **⚙️ Autogenerar 14×7:** arma los grupos **a mano** (para que nunca coincidan de descanso dos
  coordinadores ni dos inspectores del turno noche) y, al tocar **"⚙️ Generar rotación 14×7"**,
  reparte automáticamente los descansos de todo el ciclo según esos grupos.
- También puedes editar el **rango de descanso** de un inspector **uno por uno**, sin usar el
  autogenerado.
- **📄 Exportar PDF** genera el calendario completo para imprimir o compartir.

### 4.7. El taller: dos secciones separadas
El taller de maquinaria **se ve en dos módulos distintos**, porque son dos trabajos distintos que
antes vivían mezclados en una sola pantalla de cinco pestañas:

| | 🧰 **Mantenimiento** (§4.7a) | 🔧 **Servicio** (§4.7b) |
|---|---|---|
| **¿Quién lo manda?** | El **horómetro** de la máquina | Una **avería** que alguien reportó |
| **¿Es previsible?** | Sí: se sabe con horas de anticipación | No: la máquina se dañó |
| **¿Qué se ve?** | Horas acumuladas y cuánto falta para el próximo servicio | Averías pendientes, taller y gasto |
| **Tipo en el expediente** | `preventivo` | `correctivo` |

> **La frontera es el TIPO.** Cuando envías una máquina al taller, la sección **fija sola** el tipo:
> desde Mantenimiento sale como **🧰 preventivo** y desde Servicio como **🔧 correctivo**. Ya **no
> hay selector de tipo** en el formulario, a propósito: si se pudiera cambiar ahí, el expediente se
> mudaría a la otra sección al guardarlo y quien lo abrió no volvería a encontrarlo.

> **Los permisos no cambiaron.** Quien ya entraba a Mantenimiento entra a las dos secciones sin que
> nadie tenga que tocar nada: **Servicio hereda el permiso de Mantenimiento** mientras un
> administrador no le asigne uno propio. Los **coordinadores de mantenimiento** (preventivo y
> correctivo) siguen viendo **solo** estos módulos.
>
> En **Usuarios → Permisos por módulo** aparece ahora **"Servicio de maquinaria (averías)"** como
> fila aparte, por si quieres separarlos de verdad: al mecánico déjale **Mantenimiento maquinaria**
> en escritura y **Servicio** en *Sin acceso*, o al revés para el coordinador de averías.

### 4.7a. Mantenimiento de Maquinaria (preventivo · horómetros)
Lo **programado**. Abre directo en la pestaña **⏱️ Horómetros**, que es lo que manda aquí. Tiene
tres pestañas: **⏱️ Horómetros · 🧰 En mantenimiento · ✓ Historial**.

**Enviar a mantenimiento:** el botón **"🧰 Enviar a mantenimiento"** abre la lista de máquinas.
Indica la **fecha de entrada**, el **motivo** (ej. *servicio de 250 h, cambio de aceite y filtros*),
los **días estimados** y **qué se le va a cambiar**. Queda registrado como **🧰 preventivo** y, como
cualquier salida al taller, la máquina pasa a **No operativa** mientras esté adentro.

- **⏱️ Horómetros:** pestaña dedicada al **control de horómetros de TODAS las máquinas**. Por cada
  máquina muestra el **horómetro actual**, las **horas acumuladas** desde el último mantenimiento
  confirmado y **lo que falta** para el próximo mantenimiento (objetivo **250 h**), con una barra de
  progreso y el nivel (🟡 200 h · 🟠 220 h · 🔴 250 h / vencido). Cada tarjeta trae **Máquina,
  Serial/Placa, Empresa, Encargado, Inspector asignado (☀️ día / 🌙 noche), Ubicación (GPS),
  Referencia/Edificio** y arriba un resumen
  (máquinas, próximas ≥200 h, vencidas ≥250 h). Se ordena de la **más cercana al mantenimiento**
  primero. El **buscador** filtra por **todas las características** (máquina, serial, placa, empresa,
  encargado, inspector, ubicación/referencia, tipo). Está **vinculada con la FOTO del horómetro** que coloca el
  inspector/operador al iniciar/finalizar la jornada y con **los datos que ingresa** (lectura
  inicial → final, fecha de la jornada y quién la registró): la miniatura se **toca para ampliar**.
  Desde aquí también puedes **✓ Confirmar mantenimiento** (reinicia el conteo de horas acumuladas).

**⏱️ Alerta por horómetro (mantenimiento preventivo):** cuando una máquina acumula horas desde su
**último mantenimiento confirmado**, aparece arriba un banner colapsable **"⏱️ N máquina(s)
próxima(s) a mantenimiento ▸/▾"** (toca para abrir/cerrar). Los niveles son:
- **🟡 BAJA** — 200 h acumuladas.
- **🟠 MEDIA** — 220 h acumuladas.
- **🔴 ALTA (máxima)** — 250 h acumuladas.

> **Se mantiene hasta repararla:** una vez que una máquina llega a las **250 h (vencida)**, queda
> marcada como *requiere mantenimiento* y **NO se sale de la lista** aunque una lectura posterior
> baje el acumulado. La ÚNICA forma de sacarla es el botón **"✓ Confirmar mantenimiento y reiniciar
> horómetro"** (marcarla reparada). Igual que una avería pendiente, arrastra hasta resolverla.

Cada máquina en alerta muestra su **Serial/Código**, su **Empresa** y el **nivel de severidad**, con
el botón **"✓ Confirmar mantenimiento y reiniciar horómetro"**: al confirmar, reinicia el conteo de
horas acumuladas (NO toca el horómetro físico de la máquina). Esta misma alerta también sale en
**Inspecciones**. Además, se genera una **notificación por la campana 🔔** (para admin y
supervisor) apenas una máquina cruza un umbral, sin duplicarse el mismo día por máquina; deja de
generarse en cuanto se confirma el mantenimiento.

**🧰 En mantenimiento** lista las máquinas que están en su servicio programado, y **✓ Historial** los
mantenimientos ya cerrados. Las **reparaciones por avería NO salen aquí** — esas están en Servicio.

### 4.7b. Servicio de Maquinaria (averías · taller · reporte)
Lo que **se dañó**. Abre directo en **⏳ Averías**. Tiene cuatro pestañas:
**⏳ Averías · 🔧 En reparación · ✓ Historial · 📊 Reporte**.

> **✂️ El PDF ya no imprime lubricación ni horómetro (20-ago-2026):** el cliente revisó el documento
> real y pidió quitar los dos bloques. En la flota salían casi siempre vacíos
> (*«SIN DATOS DE LUBRICACIÓN — »*) y empujaban media página antes de las **reparaciones**, que es lo
> que se viene a leer. La ficha del reporte quedó en: **foto + Información general** (tipo, marca,
> modelo, serial, placa, identificador, empresa, encargado) y de ahí directo a las reparaciones.
>
> **Los datos NO se borraron.** El tipo de aceite, la cantidad y el horómetro siguen en la máquina y
> se siguen editando en **🚜 Equipos / Control de Maquinaria**; lo único que cambió es que dejaron de
> **imprimirse** en este PDF.

> **⚙️ Tipos de intervención administrables (20-ago-2026):** en **🧾 Servicios**, los tipos de la
> parte **«2. TIPO DE INTERVENCIÓN»** ya **no están fijos en el programa**. Quien tenga **permiso de
> escritura** ve el botón **"⚙️ Tipos de intervención"** (y el atajo **"⚙️ Administrar los tipos…"**
> debajo de las casillas del formulario), desde donde puede **crear** tipos nuevos —Soldadura, Aire
> acondicionado, lo que el taller necesite—, **renombrarlos** y cambiarles el **orden** en que salen.
>
> - **"Borrar" un tipo en realidad lo DESACTIVA, y es a propósito.** Deja de salir en el formulario
>   (nadie lo puede marcar en un servicio nuevo), pero los servicios **ya registrados** que lo usaban
>   lo **siguen mostrando con su nombre**, tanto en la lista como en el PDF. Si se borrara de verdad,
>   esos registros viejos se quedarían **sin nombre**. Se puede **reactivar** cuando se quiera.
> - El **nombre** se cambia cuando haga falta; la **clave interna no**, porque es lo que quedó escrito
>   dentro de cada servicio ya guardado.
> - **Para habilitarlo hay que correr UNA SOLA VEZ** el archivo
>   `supabase/servicio_tipos_intervencion.sql` en **Supabase → SQL Editor**. Mientras nadie lo corra
>   **no se rompe nada**: el formulario sigue trabajando normal con los **cuatro de siempre**
>   (**Mecánica · Electricidad · Mangueras / Hidráulica · Servicio**) y el modal de administración
>   avisa que falta correrlo.

> **✅ Arreglos del 17-ago-2026:**
> - **El Historial ahora muestra las averías resueltas.** Antes, al marcar una avería como
>   **✓ Realizado**, desaparecía de la pantalla y **no quedaba en ninguna parte**: salía de
>   "Averías" (que solo lista pendientes) y el Historial únicamente mostraba las máquinas que
>   pasaron por el taller. Ahora el Historial trae dos bloques: **✅ Averías resueltas**
>   (con quién la reportó, quién la resolvió y las dos fechas) y **🧰 Pasaron por el taller**.
> - **El buscador funciona en 📊 Reporte.** Era la única pestaña que ignoraba la caja de
>   búsqueda: escribías y la lista no se movía.
> - **El reporte ya no se queda corto.** La consulta se cortaba en ~1000 filas, así que el
>   **gasto salía por debajo de lo real**. Ahora trae todo. Además, si falla la carga te
>   **avisa** y puedes reintentar (antes se quedaba en $0.00 en silencio, para siempre).

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
- **🔧 En reparación:** máquinas que salieron a reparación **por avería** (correctivas). Las que
  están en su **servicio programado** no salen aquí, sino en Mantenimiento → 🧰 En mantenimiento.
- **✓ Historial:** reparaciones correctivas ya cerradas.

**🔴 Paradas viejas sin resolver:** arriba de esta sección aparece un banner rojo cuando una máquina
lleva **más de 4 horas** marcada **"MÁQUINA PARADA"** sin que nadie la libere. Trae el botón
**"✓ Ya está operativa (resolver)"**, que cierra la parada **y** cualquier avería pendiente de esa
máquina. Este aviso vive **solo en Servicio**: una parada es una máquina caída, no un mantenimiento
programado.

**Enviar una máquina a reparación:** toca **"🔧 Enviar a reparación"** (o el botón en la tarjeta de la
máquina). Indica la **fecha de salida**, el **motivo de la avería** (obligatorio), **por cuánto
tiempo** (días estimados) y, si quieres, **qué se le va a cambiar**. Se registra como **🔧
correctivo** y la máquina queda **No operativa** en todo el sistema.

**Registrar el retorno:** cuando vuelve, toca **"✓ Registrar retorno operativo"**, pon **qué se le
cambió** y la **fecha de retorno**. La máquina vuelve a **Operativa** automáticamente, y se cierran
tanto el marcador **MÁQUINA PARADA** como las **averías pendientes** de esa máquina.

> El botón **"✓ Registrar retorno operativo"** funciona igual en las dos secciones — la diferencia
> es solo **cuál** de las dos listas te lo muestra.

### 4.8. Operadores
La lista de operadores. Su vista es **sencilla a propósito**: solo lo que necesitan en el
campo.

### 4.8b. Inspecciones (rondas de inspectores)
Sirve para saber si los inspectores **sí están yendo a las máquinas** a revisar que estén
trabajando. Cada inspector entra con su usuario (**rol inspector**) y su pantalla principal es
**🪖 Revisar** (la lista de todas las máquinas para marcarlas). También tiene 🗺️ Mapa y 🚜 Catálogo.

> **📄 Mi reporte de jornada — desde el teléfono, cuando quiera (15/08/2026):** el inspector
> tiene en su pantalla un bloque **"📄 Mi reporte de jornada"** con el que se descarga el PDF
> del resumen de **sus** máquinas: cada una con su estado, las horas que trabajó, las de parada
> y el total de la jornada. Es el mismo dato que ve el jefe.
>
> **Antes solo aparecía al terminar el turno** (cuando ya no le quedaba ninguna máquina en
> curso), así que no podía sacar el de ayer ni revisar el de hoy a media jornada. Ahora:
> - Elige el **día** con **◀ ▶** — hacia atrás lo que necesite; hacia adelante no pasa de la
>   última jornada de ese turno.
> - Elige el **turno** ☀️ Día / 🌙 Noche. Arranca en el suyo; se puede cambiar por si cubrió el otro.
> - Descarga con **📄 Descargar reporte (PDF)**.
>
> **📅 El día ya arranca en la jornada que acabas de cerrar (19/08/2026).** El bloque abre en la
> **última jornada de tu turno**, no en la fecha del calendario:
> - **Turno noche:** la noche del **día en que arrancó (7:00pm)**. Si terminas a las 7:00am y
>   descargas tu reporte, sale la noche que acabas de trabajar — aunque el calendario ya haya
>   cambiado de día. Debajo de la fecha dice **"última noche"**.
> - **Turno día:** el día de hoy (antes de las 7:00am todavía es el de ayer).
>
> **Qué pasaba antes:** el bloque arrancaba en el día de calendario, que **cambia a las 7:00am
> en punto** — justo la hora a la que termina el turno de noche. El inspector descargaba su
> reporte y le salía **la noche que todavía no empieza**: 0 horas, y las máquinas con parada o
> avería pendiente de la noche anterior en **"🟡 Parada"**. El mismo equipo, en el reporte que
> se firma con el jefe (donde la fecha se elige a mano), salía **"✅ Finalizada"** con sus
> horas. **No eran dos cálculos distintos** —los dos documentos salen de la misma cuenta— era
> el **día** que el teléfono estaba pidiendo. Caso real: STEVEEN CAMACHO, noche del
> **18/08/2026**, máquina de placa **FF02700X070391**.
>
> **⚠️ Aviso impreso en el PDF:** si el día y turno elegidos **no tienen ni una hora
> registrada**, el reporte lo dice arriba en rojo ("Esta jornada no tiene NINGUNA hora
> registrada. Revisa que el DÍA y el TURNO sean los correctos"). Así, si alguien navega con
> **◀ ▶** hasta un día sin jornada, se ve el aviso en vez de parecer un turno perdido.
>
> **⏱️ Hoy sí cuenta en vivo; un día pasado, no (17/08/2026).** El reporte de **HOY** suma la
> jornada que sigue abierta, así que el número va subiendo hasta que el inspector la cierre.
> El de un **día anterior** muestra **solo lo que quedó guardado al cerrar**.
> Antes no distinguía: si una jornada se quedaba sin cerrar, el reporte de ese día pasado
> contaba "desde las 7am hasta ahora", se topaba en **12 h exactas por máquina** y daba ese
> número inventado para siempre. Caso real del 16/08: el teléfono decía 137,38 h y el
> Histórico 35,38 h — **102 h de diferencia** por unas 8-10 máquinas que nunca cerraron.
>
> ⚠️ **Ojo con lo que esto significa:** si una jornada se queda sin cerrar, su día saldrá con
> **menos horas de las reales** (o en 0). Eso ya no es un error de cálculo, es un aviso de que
> **esas jornadas hay que cerrarlas** — normalmente porque el cierre automático no corrió.
> Ver [[crons-pg-cron-y-restore]].
>
> Si lo pide **a media jornada**, sale el aviso *"⚠️ Todavía tienes máquinas en curso: el reporte
> sale con lo que hay hasta ahora"* — para que no lo confunda con el cierre definitivo. El día
> que manda es el **día de negocio**: el turno de noche pertenece al día en que arrancó, así que
> un reporte de noche pedido a la 1:00 am sigue siendo el del día anterior.
>
> Este botón **solo lee**: genera el PDF y no cambia nada en el sistema. Se puede pedir las veces
> que haga falta.

> **📱 Teléfono vs 💻 PC:** cada rol entra a **su propia pantalla**, igual en teléfono que en PC
> (ver 4.25 "Enrutamiento por rol al iniciar sesión" para el mapa completo) — el **inspector**
> (rol `supervisor`) es quien realmente cae aquí, en 🪖 Revisar. El **coordinador de patio** ve su
> propia pantalla (jornada de camiones), no la de máquinas.
> **El administrador**, en teléfono, SÍ entra a esta Vista de Inspector por defecto, pero con un
> botón **🗂️ SISTEMA** arriba que lo lleva a la **app completa** (para volver a Inspectores, recarga
> la página). **Jesús Lozada** también ve ese mismo botón **🗂️ SISTEMA** dentro de su Vista de
> Inspector (excepción puntual, igual que el administrador), aunque su forma de entrar a la app en
> el teléfono no cambia (sigue entrando a Inspectores como siempre).

> **🔄 Sincronización en vivo:** las pantallas de **CHECK MÁQUINA** (asignación de máquina) y la de
> **entrada/salida de camiones en el patio** se actualizan solas al instante en todos los
> dispositivos, sin necesidad de refrescar a mano.

> **✅ CHECK MÁQUINA (administrador o Coordinador de Inspectores):** asigna las máquinas a los
> inspectores; los inspectores **no se asignan solos** (solo ven las que le pusieron). Toca
> **✅ CHECK MÁQUINA**, **1)** elige el **inspector** de una lista buscable, y **2)** busca la
> máquina y toca el **turno** (☀️ Día / 🌙 Noche) para asignársela (o de nuevo para quitársela). Cada
> máquina tiene **dos inspectores** (día y noche). Queda en la **Auditoría** (✅ *se asignó · Día/Noche
> → nombre*). También hay **"Ver todas"**, con el buscador y los chips de segmento (Todas/Pendientes/
> Iniciadas/Paradas/Por avería) de siempre — la lista de resultados está **colapsada por defecto**
> (botón **"Ver resultados (N)"**) para no volcar de golpe las ~200 máquinas; se despliega al tocarlo
> y respeta el chip que tengas elegido.
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
> **🔧 Panel "Gestionar Iniciada/Pendiente por supervisor":** en el Resumen de Inspecciones,
> debajo del botón de "Reporte de máquinas por asignar / por iniciar", hay un panel — visible
> **solo para las cuentas con acceso** — que lista las máquinas agrupadas por inspector, con
> checkbox individual/por grupo/todas, cada fila con su propio turno (☀️/🌙 — una máquina con
> inspector de día Y de noche sale 2 veces, cada una independiente), y dos botones para pasarlas
> en bloque entre **✅ Iniciada** y **⏳ Pendiente por iniciar** — el mismo estado de las tarjetas
> de arriba. "Iniciar" arranca la jornada AHORA (como si el inspector tocara "Iniciar jornada",
> sin pedir horómetro); "Pendiente" borra las horas de ese turno y cierra la jornada si estaba
> abierta en ese mismo turno. Tiene sus propios filtros de turno y estado (independientes del
> switch general del dashboard) y **solo funciona para el día de HOY** (no deja tocar días
> pasados, para no arriesgar cortes ya cerrados). Si la máquina ya tenía horas trabajadas hoy,
> "Pendiente" NO las borra sin dejar rastro: quedan guardadas en el historial
> (`machine_work_segments`, igual que cualquier otro cierre de jornada) y en la bitácora de
> **Auditoría**, con quién lo hizo y cuántas horas había. *(08/08/2026: el panel de Ajustes para
> prender/apagarlo y administrar los accesos se eliminó por no usarse — el acceso ahora es fijo,
> solo para las cuentas designadas.)*
>
> **🔵 Círculo de estado** en cada máquina asignada: **🟢 verde** = jornada en curso (trabajando) ·
> **🟡 amarillo** = parada (avería) · **🔴 rojo** = jornada finalizada. Cada máquina muestra además su
> **📍 edificio/referencia** y su **serial/placa**. Si una máquina está **parada**, en su ficha sale
> **🟢 Volver a OPERATIVA** (cierra la avería y quita el "MÁQUINA PARADA" de Control).
>
> **⚡ Eficiencia por inspector — es por HORAS TRABAJADAS, no por máquinas encendidas
> (corregido 08/08/2026):** en **👷 POR INSPECTOR** (debajo del panel anterior), cada barra de
> inspector trae su **% de eficiencia** del turno. **No mide si marcó/tocó cada máquina** — mide
> **cuánto tiempo real trabajaron** sus máquinas asignadas: se suman las **horas ya trabajadas +
> las que lleva corriendo AHORA MISMO** (en vivo, no hace falta esperar a que cierre el turno) de
> todas sus máquinas, y se divide entre las **horas que ya pasaron desde que arrancó el turno** ×
> la cantidad de máquinas asignadas. Por eso, si el turno recién empezó, el % parte bajo y va
> **subiendo solo** a medida que corren los minutos — es normal, no es que "se dañó". **🟢 cerca
> de 100%** = sus máquinas están trabajando casi todo el tiempo disponible. **🟡/🔴 más bajo** =
> hay máquinas paradas, averiadas o sin iniciar durante buena parte del turno. Al tocar un
> inspector, su tarjeta de detalle trae una quinta casilla "Eficiencia" junto a
> Iniciadas/Pendientes/Paradas/Averiadas. El botón **"📄 Reporte de eficiencia (todos los
> inspectores)"** (arriba de las barras) genera el PDF con **la misma fórmula que la gráfica**
> (antes usaba otro cálculo y podían no coincidir — ya se unificó), en una tabla ordenada de
> **menor a mayor eficiencia** — los que necesitan seguimiento aparecen primero — más el detalle
> de cada inspector.
>
> **🧩 Excepción — el cajón MAQUINAS FALTANTES (06/08/2026):** el usuario de sistema
> **MAQUINAS FALTANTES** no es una persona chequeando nada, así que ya **no aparece como barra** en
> **👷 POR INSPECTOR** (se quitó del gráfico por no tener un % de eficiencia real que mostrar). En
> su lugar, debajo de las barras hay una tarjeta plegable **"🧩 Máquinas por asignar (N)"**: al
> desplegarla se ve cada máquina que sigue sin inspector real, con un botón **"Asignar ▾"** que
> despliega los inspectores disponibles — al tocar un nombre, la máquina queda asignada a esa
> persona para ese turno al instante (sin salir de esta pantalla).
>
> **🔴 Avería pendiente = se arrastra día a día (06/08/2026, corrección):** una avería real
> **pendiente** (sin resolver) mantiene la máquina **🔴 averiada** todos los días siguientes, no
> solo el día en que se reportó — ya no "baja" sola a parada o pendiente al día siguiente. Antes
> tanto el teléfono como este resumen solo contaban la avería si era del mismo día; se corrigió
> en **ambas** vistas (teléfono e Inspecciones aquí en PC) para que muestren siempre el mismo
> conteo. Solo se quita marcando la máquina **🟢 Volver a OPERATIVA**. Como la **eficiencia**
> (ver arriba) se calcula por horas trabajadas, una máquina **averiada o parada** todo el turno
> también le baja el % al inspector — no solo las que dejó **sin tocar** (pendientes).
>
> **⏱️ Asignación tardía NO baja la eficiencia (19-ago-2026):** una máquina **asignada DESPUÉS
> de que cerró el turno** (p. ej. se cargó a las **7:30pm**, con el **DÍA** ya cerrado a las 7pm)
> **no cuenta** como ⏳ pendiente de ese turno ni le baja el % al inspector — no pudo trabajarlo.
> Para el **turno en curso** (aún abierto) todo lo asignado sí cuenta normal. La misma máquina sí
> entra al turno siguiente (la del 7:30pm cuenta para la **NOCHE**). Aplica igual en el **tablero**,
> el **reporte de eficiencia** y los **conteos** (misma regla en todos).
>
> **🟡 Parada "NO TRABAJÓ" = solo por su turno (13-ago-2026):** a diferencia de la avería, una
> parada marcada por el camino **"📍 Parada / No trabajó"** vale **solo para el turno en que se
> marcó**. Al **cerrar el turno** (día 7pm / noche 7am) esa parada **se resuelve sola** y la
> máquina vuelve a salir **⏳ pendiente por iniciar** al día siguiente — **ya no se arrastra**.
> Así **solo quedan 🔴 averiadas** las que de verdad necesitan **Volver operativa e iniciar
> jornada**. La **parada POR AVERÍA** sí sigue arrastrándose (por su ticket de avería real) hasta
> que se resuelva. Aplica a **ambos turnos**. (Automático vía cron
> `expira_paradas_no_trabajo_al_cerrar_turno.sql`.)
>
> **🟡 "NO TRABAJÓ" anula horas SOLO de tu propio turno (19-ago-2026):** si marcas
> **"📍 Parada / No trabajó"** sobre una máquina que **ya tenía horas acreditadas en tu
> turno** (porque la finalizaste antes o porque la cerró el automático), esas horas se
> **ponen en 0** — es la forma de corregir desde el teléfono cuando la máquina en
> realidad no trabajó. El turno que se anula es **el que está corriendo en ese momento
> por el reloj** (día 7am–7pm, noche 7pm–7am): **nunca el turno del compañero**.
> Marcar "no trabajó" a las 8pm anula **la noche**, jamás el día que ya cerró a las 7pm.
> Si lo que hay que corregir es un turno ya cerrado, eso se hace desde **Control de
> Maquinaria**, no desde el teléfono. Cada anulación deja un **tramo negativo** en la
> línea de tiempo con quién y cuántas horas eran.
>
> *Antes del 19-ago-2026 el turno se tomaba de lo último guardado en la ronda, que
> después de las 7pm seguía diciendo "día": el inspector de **noche** que marcaba "no
> trabajó" le borraba las horas del **día** a su compañero. Esa noche cuatro máquinas
> perdieron su jornada completa, y entre el 10 y el 12-ago se fueron **1.046 horas** en
> 101 casos. Corregido, con prueba automática (`npm run test:parada`).*

**Cómo marca el inspector una máquina (varias formas, todas valen):**
1. Entra con su usuario y contraseña (o desde teléfono, cualquiera cae aquí). Ve **"Mis máquinas asignadas"**.
2. **Asignar:** si la lista está vacía, el **administrador** debe asignarle máquinas con **✅ CHECK MÁQUINA**.
   También hay un botón **📷** para escanear el QR directo.
3. **Desde la lista:** toca la máquina y se abre su ficha de inspección (nombre, empresa, serial/placa).
4. **Escaneando el QR con la CÁMARA del teléfono:** sale una pantalla con el logo y el botón
   **🔓 INICIAR SESIÓN**; entra con su usuario y cae **directo** en la ficha de esa máquina.
5. El sistema toma su **ubicación GPS** y calcula qué tan cerca está de la máquina.

**Botones de la ficha de la máquina:**
- **🟢 INICIAR JORNADA** — campo **"Ingresar horómetro"** (viene **precargado** con el horómetro
  final de la jornada anterior) y un botón **📷 Foto del horómetro** (tómala con la cámara o **carga
  una imagen**). El horómetro y la foto **no son obligatorios**: si los dejas en blanco la jornada
  inicia igual. Guarda la **hora de inicio** y marca la máquina en **Inspecciones**. El botón cambia
  a **🏁 FINALIZAR JORNADA** con un **contador** del tiempo trabajado.
  > **🔴 Máquina averiada / 🟡 parada (13-ago-2026):** si la máquina está **averiada** o **parada**,
  > el botón **INICIAR JORNADA no aparece** — en su lugar sale **🟢 Volver a OPERATIVA**. **Primero**
  > se toca "Volver a OPERATIVA" (eso **cierra la avería** en Servicio) y **después** aparece
  > "INICIAR JORNADA". Antes se podía iniciar jornada directo sobre una averiada, pero la avería
  > quedaba **pendiente** y se **arrastraba**: la máquina volvía a salir **🔴 averiada al día
  > siguiente**. Con este flujo (**averiada → Volver operativa → Iniciar jornada**) ya no reaparece.
- **🏁 FINALIZAR JORNADA** — pide **confirmar** mostrando el **total de horas**, con el campo
  **"Ingresar horómetro"** y su botón **📷 Foto del horómetro** (también sin obligación). Al aceptar,
  las horas (fin − inicio) **se suman a Control de maquinaria** en el turno ☀️ día / 🌙 noche.
  **Regla:** ese **horómetro final será el inicial de la próxima jornada**. La lectura y la foto se
  ven en **Mantenimiento de Maquinaria · ⏱️ Horómetros** (vinculado con ese módulo).
  > **Acumulado del turno (05/08/2026):** tanto en la confirmación como en el aviso final, además
  > del total de la sesión que se está cerrando, se muestra el **acumulado del turno en el día**
  > (lo ya trabajado antes + lo que se acaba de cerrar) — para ver de una vez el total real del
  > turno, no solo el último tramo. Aplica igual en teléfono y en PC.
  > **📝 Motivo de cierre (13-ago-2026 · ampliado 15-ago-2026):** si se finaliza la jornada **antes de
  > la hora de fin** (día <7pm / noche <7am) el sistema exige un **motivo obligatorio**. Ese motivo
  > **se guarda y se muestra**: en la lista **🏁 Cerradas / finalizadas** (por inspector) y en los tres
  > informes — **por firma, por empresa y por jornada** — junto a la máquina. **Desde el 15-ago-2026 el
  > motivo se pide en TODO cierre anticipado, sin excepción:** también en máquinas **"SOS LA GUAIRA"**
  > (siempre activas) y en **camiones** cerrados desde **Patio**, **Asistencia de camiones** o el
  > **escaneo de QR** — antes esos cierres quedaban como `manual_finish` sin motivo y la lista salía en
  > blanco. (Antes solo quedaba en la bitácora; el `source='manual_finish_early'` no lo permitía el
  > CHECK de la tabla y el motivo se perdía — corregido con `supabase/machine_segments_source_finish_early.sql`.)
  > **▶️ Iniciada por / 🏁 Finalizada por (13-ago-2026):** cada jornada ahora muestra **quién la inició**
  > y **quién la finalizó** (nombre y apellido del supervisor/inspector). Aparece **sincronizado en todas
  > las tarjetas** del panel de Inspecciones (lista de máquinas al abrir cualquier categoría y su detalle)
  > y en los tres informes — **por firma, por empresa y por jornada**. El "iniciada por" queda guardado en
  > `machine_rounds.jornada_marked_by` (no se pisa al finalizar) y el "finalizada por" sale del `recorded_by`
  > del tramo de cierre manual. El **cierre automático** de las 7pm/7am no lleva persona (lo hace el sistema).
  > Requiere correr `supabase/machine_rounds_jornada_marked_by.sql`.
- **⛔ Detener la máquina → 🟡 PARADA** — al tocarlo se despliegan **2 caminos** para elegir:
  - **🔧 Por avería** — elige el **material** (🛞 Caucho · 🛢️ Aceite · 🧴 Filtro · 🔩 Repuesto ·
    ✏️ Otro), escribe el **texto de la falla** (obligatorio solo si eliges "Otro") y, opcional,
    una **foto**. Al confirmar (**"🟡 Confirmar PARADA + avería"**) crea la solicitud en
    **Servicio de Maquinaria** y la máquina sigue saliendo **PARADA** en Inspecciones/Control.
  - **📍 Parada / No trabajó** — el texto **"NO TRABAJÓ"** queda **fijo**; opcionalmente escribes
    el **motivo** (sin combustible, sin operador, lluvia…) que aparece **al lado** ("NO TRABAJÓ ·
    &lt;motivo&gt;"). Captura la **ubicación
    GPS** del inspector (botón **"📍 Capturar mi ubicación GPS"**) y el **edificio/referencia**. Al
    confirmar (**"🟡 Confirmar PARADA (no trabajó)"**) **solo** se refleja en Inspecciones/Control
    (**no** crea nada en Servicio de Maquinaria).
  - En ambos casos la máquina queda marcada **🟡 PARADA** y en Control sale **🔴 MÁQUINA PARADA**;
    desde la ficha de la máquina sale **🟢 Volver a OPERATIVA** para revertirla.
  - **📋 Reportar sin detener la máquina → 🛠️ Avería de maquinaria** (sección aparte, más abajo en
    la misma ficha): reporta una falla a Servicio **sin** marcar la máquina como parada — la
    máquina sigue en su estado actual. Es distinto de "⛔ Detener la máquina → 🔧 Por avería", que
    SÍ la marca parada. Desde 05/08/2026 ambas secciones traen un texto corto aclarando cuál hace
    qué, para no confundirlas.

> **Segmentación por estatus (05/08/2026):** arriba de "Mis máquinas asignadas" (y de "Todas las
> máquinas" para admin/coordinador) hay chips con contador para filtrar de un vistazo: **Todas ·
> ⏳ Pendientes por iniciar · 🟢 Iniciadas · 🟡 Paradas · 🔧 Por avería**. Se combinan con el
> buscador de texto. "🔧 Por avería" son las máquinas con una falla real reportada y pendiente
> (distinto de "🟡 Paradas", que puede ser por avería o por un motivo operativo como clima o falta
> de operador).

> **Máquinas inactivas ocultas (05/08/2026):** una máquina marcada **inactiva** o **averiada**
> (`operational`/`active` en `false`, desde el Catálogo) deja de aparecer en la lista operativa del
> inspector — **salvo** que tenga una jornada abierta ahora mismo (así siempre se puede cerrar).
> Al reactivarla desde el Catálogo, reaparece sola, sin ningún paso extra. El **✅ CHECK MÁQUINA**
> (asignación, uso de administrador/coordinador) sigue mostrando el catálogo completo a propósito,
> para poder reactivar equipos desde ahí.

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

> **🔒 No se puede iniciar jornada en una máquina averiada, parada o "Esperando instrucciones":**
> el sistema lo bloquea **tanto si el operador escanea desde su teléfono como si lo hace el
> inspector con el carnet** (ambos caminos usan la misma regla). Si la máquina tiene una avería o
> parada **pendiente**, avisa que primero hay que **resolverla** (marcarla ✅ Operativa desde el
> Catálogo o Control de maquinaria); si está en **⏳ Esperando instrucciones**, avisa que primero
> hay que **sacarla de ese estado** (botón "✅ Ya se decidió" en su detalle, ver 4.4). Cualquiera de
> los dos caminos saca a la máquina del bloqueo.

> **🟢 Iniciar desde el QR ya deja constancia (18/08/2026):** el cliente reportó una máquina
> **iniciada a las 11:30 según la Auditoría** que en **Inspecciones seguía saliendo ⏳ pendiente**.
> Era cierto, y pasaba con **todas** las jornadas arrancadas desde el **QR del operador** o el
> **carnet del inspector**: ese camino guardaba nombre, cédula y horómetro, pero **no guardaba que
> la jornada había arrancado**. Como Inspecciones se fija justamente en ese dato, la máquina salía
> como si nunca hubiera empezado — con el operador trabajando. Desde el 1 de julio le pasó a
> **1.410 rondas**; la mayoría se tapaba sola cuando el sistema les bancaba las horas al cerrar, y
> por eso el problema no saltaba a la vista.
>
> Ya quedó arreglado, y con una ventaja: **los dos caminos de inicio ahora usan la misma regla**
> (antes cada uno tenía la suya). Esa regla es la de siempre, sin cambios:
> - El turno de **día arranca a las 7:00am** y el de **noche a las 7:00pm**. Si se marca **dentro
>   del margen** (hasta las 9:00am / 9:00pm), la jornada se **ancla al arranque del turno** aunque
>   se marque un poco más tarde → cuenta el turno completo.
> - Si se marca **fuera del margen**, conserva la **hora real** y se registra el retraso: no se le
>   regalan 12 horas a una marca muy tardía.
> - Una jornada de **noche** iniciada **pasada la medianoche** pertenece a la noche que arrancó
>   **ayer** a las 7pm, no al día nuevo.
>
> **También se corrigió un estado pegado:** una ronda que nace sin horas queda marcada "parada", y
> al arrancar la jornada nadie la devolvía a **operativa** — quedaban rondas con la jornada abierta
> y el estado en "parada" al mismo tiempo. Importa porque **Control de Pagos lee ese estado**.
>
> **Nada de esto borra ni cambia lo ya registrado:** solo se completan campos que antes quedaban
> vacíos. Las jornadas viejas conservan sus horas tal cual.

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
- **📄 Reporte resumen por inspector, con eficiencia (05/08/2026):** este botón vive hoy dentro de
  **RESUMEN DE INSPECCIONES → 👷 POR INSPECTOR** (ver más abajo), no en esta sección — genera un
  **PDF** con una **tabla de eficiencia** de todos los inspectores al inicio (ver nota de
  eficiencia más abajo) y luego una **sección por cada inspector**: cuántas máquinas tiene
  **asignadas**, cuántas **iniciaron jornada** (en curso o finalizada), cuántas están
  **averiadas/paradas** y cuántas **le faltaron por iniciar**. Para las que faltaron por iniciar,
  trae una **tabla de detalle** con: **Edificio, Modelo/Tipo de máquina, Serial/Placa, Sector,
  Referencia y Empresa asignada**. El estado de cada máquina se calcula **por turno**
  (día/noche) del inspector, con el mismo criterio que usa esta lista en pantalla.

Cada inspector trae un **resumen de cercanía** para saber qué tan confiables fueron sus rondas:
**✓ en sitio** (estuvo cerca, dentro de ~300 m), **⚠️ lejos** (marcó sin estar al lado) y
**• sin GPS** (no se pudo verificar). El botón **"📄 Reporte de inspecciones (PDF)"** genera el
informe del día con ese resumen por inspector, el detalle de cada visita (hora, máquina,
empresa, estado y ubicación) y las jornadas sin validar.

> **📊 Reporte por inspector — "Recorrido del inspector" (PDF):** en **Inspecciones → Reportes →
> ✅ Máquinas asignadas por inspector** hay un reporte con **📅 un día** y un filtro de inspectores
> **tipo check** (marcas uno o varios; vacío = todos). Reconstruye el **recorrido** de cada
> inspector en orden cronológico: **hora de la revisión, máquina, marca/modelo, serial/placa,
> sector/ubicación, estado** en que la encontró y si estaba **cerca** (distancia GPS).
>
> Además trae, en el **mismo documento**, la información de un **reporte diario** (pedido del
> cliente): **horas de día, horas de noche y horas trabajadas** de cada máquina, y la columna
> **"Inició"** con el **nombre de quien marcó el inicio de la jornada**. Arriba sale un
> **resumen general** (inspectores, revisiones, máquinas distintas y horas), y **cada inspector**
> tiene su propio total (máquinas distintas revisadas, horas de día, de noche y trabajadas).
>
> **Tres cosas importantes de leer bien:**
> - Las **horas son del DÍA COMPLETO de la máquina**, no de esa visita. Si el inspector revisó la
>   misma máquina 3 veces, las 3 filas muestran las mismas horas del día.
> - Por eso **los totales cuentan cada máquina UNA sola vez** (aunque tenga varias revisiones): las
>   horas **no** se suman fila por fila.
> - Si una máquina **no tiene ronda registrada** ese día, sus horas salen **"—"** (no hay dato), que
>   **no es lo mismo** que trabajar **0,00** horas.
>
> Las horas se calculan con la **misma fórmula** que el **Reporte del día por empresa** y el
> **Control de maquinaria**, así que los números **coinciden** entre los tres.
>
> **Por qué este reporte es el fiel:** agrupa por **quién hizo el check-in de verdad**, congelado
> en el momento de la visita. El **Histórico de Jornadas** atribuye por la **asignación actual**, así
> que cambia el pasado cuando se **reasignan** máquinas; este **no**.

> **🕰️ Histórico → 📜 Histórico por inspector (PDF):** justo **debajo** de "Máquinas asignadas por
> inspector" hay un apartado aparte llamado **Histórico**. Responde otra pregunta: el de arriba dice
> **quién tiene qué hoy**; este dice **quién tuvo qué entonces**.
>
> **Para qué sirve, con un caso real (17-ago-2026):** *César Flames se fue de la empresa y sus
> máquinas se le reasignaron a José Cardona. El 16 la jornada era de César; el 17, de José.* En los
> reportes que atribuyen por asignación, las horas del 16 pasan a mostrarse bajo José y César
> desaparece. **Aquí no**: César sigue apareciendo el 16 con sus máquinas y sus horas, y José el 17.
>
> Se pide por **📆 rango de fechas** (no por un día) y con filtro de inspectores tipo check. Agrupa
> **por inspector** y, dentro, **por fecha**. A quien ya no figure en la lista de inspectores activos
> se le pone el distintivo **"Ya no activo"** con una nota — es el caso de César.
>
> **Tres cosas de leer bien:**
> - **Los nombres salen de los check-in**, que quedan congelados en el momento en que se hacen. Por
>   eso reasignar una máquina **no** cambia lo que dice este documento.
> - **Solo cuentan las horas del TURNO que cubrió.** Una máquina puede trabajar de día **y** de noche
>   el mismo día (el 16-ago-2026 le pasó a 102 de 173 máquinas). Al inspector de día **no** se le suman
>   las horas de la noche: ese trabajo es del nocturno. El turno sale de la **hora del check-in**
>   (día 7am–7pm). Las columnas **"Día (contexto)"** y **"Noche (contexto)"** muestran el día completo
>   de la máquina, para que puedas comprobar de dónde sale la diferencia — pero el total **no** es su suma.
> - **Nada se cuenta dos veces**: si revisó la misma máquina 3 veces en su turno, la columna **"Rev."**
>   dice 3 pero las horas suman **una sola vez**.
>
> **Un límite que conviene saber:** solo aparece lo que el inspector **alcanzó a revisar**. Si tenía 12
> máquinas asignadas y marcó 8, las otras 4 no salen con su nombre, porque no quedó rastro de que
> fueran suyas. Eso se arregla del todo corriendo `supabase/congelar_inspector_en_la_ronda.sql`, que
> guarda el inspector dentro de la ronda el día que se trabaja.

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
traslado, Gastos, Movimientos y Dotación**.

> **El Requerimiento de compras se movió al módulo COMPRAS** (pestaña **"📝 Requerimiento"**). La
> **recepción del material sigue cargándose al inventario** como siempre.

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

> **Cédula y cargo del empleado en el PDF (05/08/2026):** si elegiste empleados **de la nómina**
> (no texto libre), el PDF de "Nota de salida" muestra una tabla **Recibe** con **nombre, cédula y
> cargo** de cada uno — no solo el nombre. Una persona que reciba **sin estar registrada** (campo de
> texto libre) sigue apareciendo solo por su nombre, porque no es un empleado del sistema y no tiene
> cédula/cargo que mostrar. Esta salida además queda **vinculada al empleado** por dentro (no solo en
> el PDF), lo que alimenta la nueva pestaña **"👷 Dotación"** (ver más abajo) y el historial en su
> ficha.

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

**📝 Requerimiento (pedir compras al jefe):** está en el módulo **COMPRAS**, pestaña
**"📝 Requerimiento"**. Armas una lista de productos que hacen falta —**del inventario** (los traes)
o **NUEVOS** (los escribes)— con cantidad y **precio estimado** (en **$ o Bs** — el sistema convierte
a dólares con la tasa del día solo para el cálculo interno). Al crear puedes elegir, opcionalmente,
el **PROVEEDOR** (chip "Sin proveedor" o uno del catálogo). Al **📤 Enviar al jefe** queda guardado
como **Pendiente**. El **jefe (administrador)** lo **✅ Aprueba** o lo **❌ Rechaza**. Si se compra,
quien tenga permiso de
**Recibir** (el administrador o alguien con **todos los permisos de Inventario**, desde 04/08/2026)
toca **"📥 Recibir en inventario"**, confirma la **cantidad y el precio real** de cada producto, y el
sistema **crea la entrada** en el almacén (los productos nuevos **se crean solos**); el requerimiento
queda **automáticamente** como **Recibido**. Con **🧾 PDF** puedes imprimir el requerimiento para
pasárselo al jefe — el documento muestra **solo el monto en dólares** (sin Bs ni tasa BCV; esa tasa
es solo referencial dentro del sistema, no sale en ningún reporte impreso). Así todo queda
trazado: quién lo pidió, quién lo aprobó y cuándo se recibió.
Cada requerimiento tiene además **"✏️ Editar"** (cambia título, nota y productos — no si ya fue
recibido) y **"🗑️ Eliminar"** (borra todo el requerimiento, con confirmación), para quien tenga
escritura en Compras (o Inventario).

> **Proveedor → orden de compra + cuenta por pagar:** si le asignas un **PROVEEDOR** al
> requerimiento, al **aprobarlo** se genera automáticamente la **orden de compra** (aprobada) y la
> **cuenta por pagar** de ese proveedor por el total de los ítems. **Sin proveedor**, la orden queda
> en **BORRADOR** y no se crea cuenta hasta que le asignes uno (editando el requerimiento). Los
> proveedores se crean en la pestaña **"🏭 Proveedores"** de Compras. Para **recibir** el material
> en el almacén se sigue necesitando permiso de **Inventario**.

> **Cambiar estado a mano (04/08/2026):** quien tenga **todos los permisos de Inventario** (o sea
> administrador) puede tocar el mismo **badge de estado** (arriba a la derecha de cada
> requerimiento, ej. "APROBADO") para desplegar "Cambiar a: Pendiente/Aprobado/Rechazado/Recibido"
> y corregirlo sin pasar por todo el flujo. Ojo: esto **NO** registra entrada de stock — solo
> cambia la etiqueta del documento. Si el material se recibió de verdad y hay que sumarlo al
> inventario, usa **"📥 Recibir en inventario"** en su lugar.

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

> **Cédula y cargo del responsable (05/08/2026):** si el responsable de **Origen** y/o **Destino**
> es un empleado registrado, el PDF de "Nota de traslado" muestra su **C.I. y cargo** debajo del
> nombre, en ambas cajas (Origen/Destino) cuando aplique.

**👷 Dotación (historial de entregas por empleado, 05/08/2026):** pestaña de solo consulta que junta
en un solo listado **todo lo que se le ha entregado a cada trabajador**: herramientas, equipos y
artículos que salieron por **"📤 Salida"** con empleado(s) asignado(s), más la **dotación básica**
(franelas, pantalones, calzado) registrada en **Distribución de uniformes** (ver 4.6c). Una entrega
grupal (varios empleados a la vez) aparece como **una fila por cada empleado**, para que el filtro
por persona sea exacto. Filtros disponibles:
- **👷 Empleado:** buscador desplegable, selección única (o "Todos").
- **Fecha:** rango Desde/Hasta.
- **Tipo/categoría:** chips con las categorías de producto que realmente aparecen en los datos, más
  **"🦺 Uniforme"**.
- **Origen:** **📦 Inventario** o **🦺 Dotación/Uniforme** — estas entregas ya quedan confirmadas al
  generarse (no existe un estado "pendiente"/"aprobado" como en Requerimiento), así que el filtro de
  estatus se resolvió como el origen del dato.

Toca cualquier tarjeta para ver la **cédula, cargo y origen** completos, y **"🧾 Reporte de
dotación"** para bajar un PDF (Fecha · Empleado · Cédula · Cargo · Tipo · Detalle) con los filtros
activos aplicados.

> Este historial depende de que la salida se haya generado **con empleado(s) seleccionados**; las
> salidas antiguas (antes del 05/08/2026) o las que solo tienen máquina/empresa como destino no
> tendrán empleado asociado y no aparecerán aquí.

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
- **👆 Click para ver o ubicar (dentro de cada tipo):** toca una máquina **UBICADA** (su nombre /
  **🗺️ Ver en el mapa**) y el mapa se **enfoca solo en ella** (usa **"← Ver todas las ubicaciones"**
  para volver); la casilla **✅/⬜** de la izquierda sigue sirviendo para mostrar/ocultar su pin.
  En **"⛔ Faltan por ubicar"**, tócala y —si eres **administrador**— el mapa entra en **modo ubicar**:
  toca el punto donde está y queda ubicada al instante. Si no eres admin, avisa que solo un
  administrador puede ubicarlas.
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

> **🟡 Horas paradas (15-ago-2026):** el reporte trae una columna **"Horas parada"** por máquina
> y su desglose por sector, para ver cuánto estuvo detenida cada una. **No lleva el total
> agregado de paradas** arriba (ni el reporte del jefe ni el recibo del teléfono): el dato se
> consulta máquina por máquina.
> Ojo con la diferencia: las **horas trabajadas** de una máquina que trabajó y *después* paró
> **sí cuentan** en el total de la jornada; las **horas paradas** van aparte y **no** suman a la
> jornada (jornada = horas activas).
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
- **🚪 Cerró sesión (08/08/2026)** — antes no quedaba registrado; ahora el cierre de sesión también
  aparece en la bitácora.
- **📷 Escaneó** — qué **máquina** se escaneó (código) y a qué hora.
- **🟢 Inició jornada / 🏁 Finalizó jornada / 🟡 Parada** — la máquina, las horas y el motivo.

Se filtra por **día**, por **usuario** y por **tipo**. Tocando un renglón se ve el detalle
completo (quién, qué, a qué máquina, cuándo y desde qué dispositivo).

> **🚜 «¿Quién puso esta máquina retirada?» — filtro propio (20/08/2026):** debajo del contador de
> acciones hay una casilla nueva: **«🚜 Estados de máquina — quién la retiró, reactivó o puso en
> espera»**. Al marcarla la bitácora deja **solo** las acciones que cambiaron el estado de una
> máquina, y cada una sale con su etiqueta de color y en criollo:
>
> | Etiqueta | Qué pasó | Columna real |
> |---|---|---|
> | ⬛ **RETIRADA** (fuera de servicio) | la sacaron de servicio | `operational` sí → no |
> | ✅ **REACTIVADA** (vuelve a servicio) | volvió a trabajar | `operational` no → sí |
> | ⏳ **EN ESPERA** por recepción | quedó esperando que control la reciba | `en_espera` no → sí |
> | 📥 **RECIBIDA** en control | salió de espera | `en_espera` sí → no |
> | 🗑️ **ELIMINADA** del catálogo | dejó de existir para el sistema | `active` sí → no |
> | ♻️ **RESTAURADA** al catálogo | volvió al catálogo | `active` no → sí |
> | 🔒 **QR BLOQUEADO** | al escanearla solo sale el logo | `qr_blocked` no → sí |
> | 💥 **BORRADA de la base de datos** | se borró la fila completa | — |
>
> **El dato ya estaba, pero enterrado.** Una máquina retirada aparecía como *«Fulano modificó
> Máquina · CARGADOR 01 (6 cambios)»* y había que abrir el renglón y leer columna por columna para
> dar con el `Operativa: sí → no` escondido entre los otros cinco. Con cien acciones por día, nadie
> lo encontraba. Arriba sale además el **conteo** (⬛ Retiradas · 4, ✅ Reactivadas · 1), y todo
> esto sale igual en el **PDF**.
>
> **🕘 Sin adivinar la fecha.** Con el filtro marcado se habilita *«🕘 Buscar en TODO el historial»*
> **aunque no escribas nada** en el buscador — nadie se acuerda del día en que retiraron una
> máquina, que es justamente lo que se viene a preguntar. Se puede porque con ese filtro la
> consulta se acota a máquinas y vehículos: la pantalla le pide **menos** a la base de datos, no más.
>
> **📋 Toda la información, al tocar el renglón.** El detalle de una acción sobre una máquina trae
> ahora, además del antes/después campo por campo, **la ficha de la máquina como está ahora mismo**:
> máquina con su placa/serial, identificador, clase y marca, empresa, encargado, zona/referencia,
> estado actual, si el QR está bloqueado, horómetro, y **«Retirada por / Retirada el»** y
> **«Reactivada por / Reactivada el»**. Esos dos últimos los guarda la **propia ficha de la
> máquina**, aparte de la bitácora: sirven aunque el retiro sea **anterior** a que se encendiera el
> seguimiento (18/08/2026).
>
> **⚠️ «Averiada» y «parada» no salen acá, a propósito.** Esos dos no son un campo de la máquina:
> se deducen en vivo de las averías y de las jornadas. Quién marcó una avería se ve en el módulo de
> **Mantenimiento / Averías**.

> **🚜 Retiros y "en espera" — ahora sí quedan registrados (18/08/2026):** el cliente reportó que
> no veía **quién retiraba una máquina** ni **quién la ponía o la sacaba de "en espera"**. Era
> cierto, y por dos motivos distintos:
>
> - **"En espera" no se guardaba en ninguna parte.** Ese interruptor se cambia desde **cinco**
>   pantallas (Equipos, Control de Maquinaria al sacar y al reingresar, el panel QR del
>   Coordinador, y Mantenimiento al cerrar una reparación). Todas escribían directo, sin dejar
>   rastro, y el vigilante que lo habría capturado solo (`trg_audit` sobre `machinery`) estaba
>   **apagado** desde antes del 10/08/2026.
> - **"Retirar" sí se guardaba, pero en otro sitio y solo la última vez.** Queda en la ficha de la
>   máquina, dentro de **Equipos** — no en Auditoría — y como es un campo de la máquina y no un
>   historial, **se sobrescribe**: si una máquina se retira y se reactiva tres veces, solo
>   sobrevive la última.
>
> Se encendió el vigilante de `machinery` (es un **catálogo** de ~200 filas que se editan de vez en
> cuando, así que no pesa). Desde ahora cada retiro, reactivación y cambio de "en espera" queda con
> **quién, cuándo y el antes/después**.
>
> **Y se lee en cristiano.** Antes la sección "Cambios" mostraba el nombre técnico de la columna:
> `en_espera: false → true`. Ahora dice **"En espera: no → sí"**, **"Activa: sí → no"**, **"Fecha
> de salida: ∅ → 18/08/2026"**. Además el cambio se ve **en la propia lista**, sin tener que abrir
> renglón por renglón: si fueron más de dos campos, se muestran los dos primeros y un **"+N más"**.
> Vale igual para el **PDF**.
>
> **Dos límites que conviene tener claros:**
> - **No recupera el pasado.** Lo que se hizo antes de encenderlo no quedó registrado y no se puede
>   reconstruir. Sirve de aquí en adelante.
> - **Las jornadas siguen sin registrarse.** El vigilante de `machine_rounds` se apagó el
>   09/08/2026 porque el sistema se estaba cayendo: los automatismos escriben esa tabla cada 10
>   minutos por cada una de las ~173 máquinas, y eso generaba entre 15 y 20 mil renglones de
>   bitácora **al día**. Mientras siga apagado, **ningún cambio de horas de jornada deja rastro**.
>   La salida es un vigilante que solo registre cuando hay **una persona** detrás y deje pasar el
>   ruido de los automatismos — pendiente de decisión.

> **🔎 A qué se le hizo — más contexto (08/08/2026):** además de máquinas, empleados y usuarios, la
> auditoría ahora también reconoce por **nombre** (no solo por ID) los **pagos de empresa** (nombre
> de la empresa), los **ingresos de combustible** (proveedor), los **traslados** por **vehículo/
> placa** y los **movimientos de tanque** (nombre del tanque) — así ya no queda ningún registro
> mostrando solo un ID crudo sin explicar a qué corresponde. Las **fechas** dentro del detalle de
> "qué cambió" (antes → después) ahora se muestran **legibles y con hora** (ej. 08/08/2026 03:15
> p.m.), en vez del formato crudo de la base de datos.

> **🔽 Filtros avanzados (08/08/2026):** junto al buscador hay un botón **"🔽 Filtros"** que abre un
> panel con **3 pestañas**:
> - **🔎 Filtrar:** accesos rápidos — **📅 Hoy**, **🗓️ Esta semana**, **🗑️ Solo eliminaciones**,
>   **💰 Solo cambios de dinero** — más selección **múltiple** de **MÓDULO** (⛽ Combustible, 🚜
>   Maquinaria y flota, 📋 Inspecciones y jornadas, 👷 Nómina y personal, 🏢 Empresas y facturación,
>   📦 Inventario y compras, 🍽️ Alimentación, 🔑 Usuarios y permisos) y **tipo de acción** (➕ Creó ·
>   ✏️ Modificó · 🗑️ Eliminó · 📋 Eventos de app). Se pueden combinar varios módulos y varias
>   acciones a la vez, y se suman al buscador de texto y al rango de fechas de arriba.
> - **📚 Agrupar por:** **Módulo**, **Usuario** o **Día** — en vez de una lista plana, los resultados
>   salen agrupados con encabezados **plegables** (toca uno para abrir/cerrar ese grupo).

> **🗂️ Agrupar por módulo, a la vista (20-ago-2026).** La fila **"AGRUPAR POR:"** quedó en la
> pantalla principal, debajo del contador de acciones: **Sin agrupar · 🗂️ Módulo · 👤 Usuario ·
> 📅 Día**, de un solo toque. Antes había que entrar al menú **🔽 Filtros → Agrupar**, y por eso
> casi nadie lo encontraba. Es el mismo ajuste, así que los dos lugares quedan sincronizados.
>
> Al elegir **🗂️ Módulo** aparece además, arriba de la lista, una fila de **totales por módulo**
> (`⛽ Combustible · 14`, `👷 Nómina y personal · 7`…): se ve **dónde se movió más** sin tener que
> abrir cada grupo.
>
> **Y ahora agrupa completo.** Había **once tablas auditadas que no estaban asignadas a ningún
> módulo** y caían todas en **"📁 Otro"** — entre ellas los **viajes de camiones**, los
> **movimientos de combustible**, los **períodos de nómina**, los **proveedores**, **Obras
> Públicas** y los **avisos del sistema**. O sea que medio sistema se veía como "Otro". Ya están
> repartidas, y se agregaron dos módulos nuevos al filtro: **🚛 Viajes de camiones** y
> **🏗️ Obras Públicas** (más **🔔 Avisos del sistema**). Una prueba automática
> (`npm run test:auditoria`) verifica que **ninguna tabla con auditoría vuelva a quedarse fuera**.
> - **⭐ Favoritos:** guarda la combinación **actual** de filtros (texto + módulos + acciones +
>   usuario + rango + agrupación) con un **nombre**, para volver a aplicarla luego **con un toque**.
>   Se guarda **en este dispositivo** (no se comparte entre usuarios).
>
> El **PDF** de auditoría ahora también indica **qué filtros estaban activos** cuando se generó.

> **🕘 Historial COMPLETO de una máquina, inspector o usuario (08/08/2026):** escribe en el
> buscador el código de la máquina, el nombre del inspector, del usuario o lo que necesites
> — y activa el interruptor **"🕘 Buscar en TODO el historial (ignora el rango de fechas)"**
> que aparece debajo. Así el buscador deja de limitarse al rango Desde–Hasta que tengas puesto
> y trae **todo** lo que le haya pasado a esa cosa desde siempre, sin tener que adivinar en qué
> fecha ocurrió. Sin ese interruptor, la búsqueda sigue funcionando igual que antes (dentro del
> rango de fechas elegido).
>
> **🔎 Buscar por cualquier característica:** no hace falta que el nombre exacto esté escrito en
> la bitácora — escribe una **placa**, un **serial**, una **cédula**, el **encargado**, el
> **modelo** o la **clasificación** de la máquina, y el buscador la encuentra igual (resuelve
> el dato contra el Catálogo y Usuarios antes de buscar en el historial).
>
> **📄 PDF con toda la información:** arriba de la lista sale un resumen rápido (➕ Creó · ✏️
> Modificó · 🗑️ Eliminó · 📋 Eventos) sin tener que generar nada. El PDF trae ese mismo resumen
> más quién tuvo más actividad, y por cada acción el **detalle completo**: a qué registro
> afectó y, si fue una modificación, **cada campo que cambió** (antes → después) — lo mismo que
> ves al tocar una fila en pantalla, ahora también impreso.

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
- **🛠️ Avería** → reporta la falla (va a Servicio).
- **🚚 Entrada y salida de camiones** → un **CALENDARIO**: cada día muestra cuántos camiones
  entraron (↓) y salieron (↑); toca un día para el detalle. (El administrador también lo ve
  dentro de *Inspecciones*.)

---

### 4.22. Panel Coordinador QR (preventivo, correctivo, almacén…)

Los roles con panel **📷 Coordinador QR** ven botones grandes: escanean el QR de la máquina y:

- **⛽ Surtir gasoil** (horómetro + litros).
- **🛠️ Registrar avería** (va a Servicio).
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

## 4.24b. Geodesta (topografía) 📐

Módulo de **topografía**: levanta terreno, genera **curvas de nivel**, calcula **volúmenes de corte/relleno**, **inspecciona** en campo con GPS y foto, y **exporta** a CAD/GIS — todo ligado a las **obras/edificios** del sistema. Coordenadas de trabajo: **UTM SIRGAS-REGVEN 19N (EPSG:2202)**.

**Crear un levantamiento**
1. Entra a **"Más → 📐 Geodesta"** y toca **"＋ Nuevo levantamiento"**.
2. Escribe el **nombre**, elige la **obra/edificio** (catálogo de **Ubicaciones**) y la **tolerancia GPS** en metros; toca **"Crear levantamiento"**.
3. Toca el levantamiento para abrir sus pestañas: **Puntos · Mapa · Superficie · Volumen · Salidas**, y el botón **🧭 Inspecciones**.

**📋 Puntos** — Captura por **GPS** (rechaza tomas menos precisas que la tolerancia), **entrada manual** (N/E/Z o lat/lon) o **importación de CSV/TXT** (`P,N,E,Z,desc`, autodetecta encabezados). Cada punto lleva **capa/código**, se puede marcar como **punto de control (GCP)** o **excluir** (outlier). Exporta el CSV.

**⛰️ Superficie** — Genera el **MDT (TIN)** y sus **curvas de nivel** al intervalo elegido (0.5/1/2/5 m). Guarda **versiones** (para comparar en el tiempo); se dibujan sobre el mapa.

**📦 Volumen** — **Cubicación** de corte/relleno comparando **dos superficies** (avance entre fechas) o una superficie contra una **cota de diseño**. Da **corte, relleno y neto en m³**, con **mapa de diferencias** (🟥 corte, 🟦 relleno) y **reporte PDF**.

**🧭 Inspecciones** — Inspección de terreno con **GPS**, **checklist** configurable, hallazgos, **fotos**, firma y **estado** (pendiente/observado/aprobado), con **acta PDF** y mapa por estado.

**📤 Salidas** — **Perfil longitudinal** entre dos puntos, y **exportación** a **DXF** (AutoCAD), **KML** (Google Earth), **GeoJSON** (QGIS/ArcGIS → Shapefile/GeoPackage) y **LandXML** (proyectista y **guiado de maquinaria**: Trimble/Topcon/Leica). **Reporte técnico PDF** consolidado.

**📵 Campo sin señal** — Si capturas puntos sin conexión, quedan guardados en el teléfono y se **sincronizan solos** al volver la señal (aviso con botón **"Sincronizar"**). Las nubes densas se **agrupan** (clusters) en el mapa.

**Herramientas avanzadas** — 🌡️ **mapa de pendientes** y 🧊 **visor 3D** del terreno (en Superficie); ✂️ **secciones transversales** (en Salidas); 📐 **líneas de rotura** (breaklines) para que el MDT respete bordes de talud/vías/muros; 🛰️ **ortofoto propia** (capa base por URL de tiles XYZ/TMS) en el mapa; ✏️ **dibujar sobre las fotos** de inspección; y 🌊 **geoide N** para convertir la altura del GPS en **cota ortométrica** (sobre el nivel del mar).

> **Acceso por permiso:** módulo **"Geodesta"** en *Lectura* (solo ver), *Escritura* (crear/capturar) o *Full control* (eliminar). También existe el rol **"Geodesta"** para asignarlo directo a un usuario.

---

## 4.24c. Lavado de maquinaria 🚿

Módulo **aislado** para el personal de **lavado**: registra qué máquinas se lavan y lleva la cuenta de **cuántas veces al mes** se lavó cada una. No toca inspecciones, horas ni pagos — solo usa el catálogo de máquinas.

**Acceso:** se le da al usuario el rol **"Lavado de maquinaria"** (o el permiso del módulo en *Usuarios*). El lavador **escanea el QR de inicio**, se loguea con su usuario y cae **directo en su vista de lavado** en el teléfono.

**Vista del lavador (teléfono)** — tablero por estado:
- Dos columnas: **🚿 Por lavar** / **✅ Lavadas**, con un selector de periodo arriba (**Hoy · Semana · Mes**; por defecto Hoy).
- **"Por lavar"** = máquinas activas que todavía NO se han lavado en ese periodo. Al registrar el lavado pasan a **"Lavadas"**.
- **Registrar un lavado** (dos formas): (1) buscar la máquina en la lista y tocarla, o (2) botón **"📷 Escanear QR de máquina"** (el mismo QR que ya trae cada máquina). Se abre **"Registrar lavado"**: eliges el **tipo** (Exterior / Motor / Completo, y puedes **agregar** tipos nuevos), escribes una **observación** (opcional) y adjuntas una **foto** (opcional). Al tocar **"✅ Marcar como lavada"** queda registrado con la hora y tu nombre.

**Panel de PC** (*Más → 🚿 Lavado de maquinaria*) — **"Máquinas lavadas"**:
- Muestra, **por mes** (flechas ◀ ▶ para cambiar de mes), **cuántas veces se lavó cada máquina**, más dos totales arriba (lavados del mes · máquinas lavadas).
- Al **tocar una máquina** se abre el **detalle** con cada lavado de ese mes: fecha, tipo, quién lo hizo, observación y foto.

> Los datos de lavado viven en tablas aparte (`lm_*`) y no afectan a ningún otro módulo. Correr una vez `supabase/lavado_maquinaria.sql` en Supabase para crear las tablas.

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

### Continuidad de turnos / fecha operativa — equivalencia de campos (05/08/2026)

El cliente pidió modelar los turnos con campos `tipo` (DIA/NOCHE), `fecha_operativa`,
`fecha_apertura`, `fecha_cierre` y `estado` (ABIERTO/CERRADO), y corregir el cierre del turno
noche a medianoche. **Esos nombres de columna no existen en el esquema real** — se auditó el
código en vez de crearlos, para no duplicar el modelo de datos ni arriesgar el histórico sin
necesidad. Equivalencia real en `machine_rounds`:

| Pedido | Campo real | Nota |
|---|---|---|
| `tipo` | `jornada_shift` ('day'/'night') | |
| `fecha_operativa` | `round_date` | fecha en que ARRANCÓ el turno, nunca se reescribe |
| `fecha_apertura` | `jornada_start_at` | timestamp de inicio; `null` = jornada cerrada |
| `fecha_cierre` | (no se guarda un timestamp de cierre por separado) | el cierre se infiere de `jornada_start_at = null` + `day_hours`/`night_hours` ya sumadas |
| `estado` ABIERTO/CERRADO | `jornada_start_at is not null` | no confundir con la columna `closed` (esa es un flag de **congelamiento de facturación** en Control de maquinaria, sin relación con si la jornada está abierta) |

**Verificado, ya corregido desde el 03/08/2026:** el cron `supabase/auto_close_jornadas.sql`
cierra el turno DÍA a las 19:00 del `round_date` y el turno NOCHE a las **07:00 del día
siguiente**, con un candado que solo permite cerrar si la hora calculada es exactamente 7 o 19
(Caracas) — nunca a medianoche. El `round_date` se mantiene fijo en la fecha de apertura durante
todo el ciclo nocturno (mismo criterio en el cierre manual desde `SupervisorScreen.tsx`). Los
esquemas **12x6** y **12x12** también ya estaban diferenciados donde corresponde: cualquier
inspector humano real siempre trabaja con horas reales sin tope; el patrón 12x6/12x12 con tope
solo aplica a la maquinaria SIN inspector asignado, cargada por el usuario virtual "MAQUINAS
FALTANTES" (ver 4.8b). No se modificó código para este punto, solo se verificó contra el
comportamiento real y se documentó aquí la equivalencia.

### Enrutamiento por rol al iniciar sesión — mapa completo (corregido 05/08/2026)

**Reporte:** en el teléfono, casi todos los roles caían en la **Vista de Inspector**
(`SupervisorTabs`) en vez de su pantalla correspondiente — solo 3 casos tenían ruta propia en
teléfono (Chofer de combustible, Coordinador de patio, admin/Jesús Lozada con el botón SISTEMA).
El resto (operador, cocina, roles dinámicos, etc.) veía Inspectores igual que un inspector real,
aunque en **PC** esos mismos usuarios sí llegaban a su pantalla correcta. Causa: `RootNavigator`
(`src/navigation/index.tsx`) tenía dos árboles de decisión separados — uno "si es teléfono" (casi
un catch-all) y otro "si es PC" (con toda la lógica por rol) — y el de teléfono nunca reutilizaba
la lógica del de PC.

**Corregido:** se unificó en una sola cadena de condiciones, la misma para teléfono y PC. Mapa
completo de a dónde entra cada quien al iniciar sesión (login normal, sin escanear QR):

| Rol / tipo de panel | Pantalla | ¿Cambió con este fix? |
|---|---|---|
| Rol dinámico, panel **Chofer de combustible** | `FuelDriverStack` (surtir combustible) | No — ya era así en ambos |
| `coordinador_patio` | `PatioStack` | No — ya era así en ambos |
| **admin** / Jesús Lozada, en teléfono, sin tocar SISTEMA | Vista de Inspector + botón 🗂️ SISTEMA | No — ya era así |
| **admin** / Jesús Lozada, en teléfono, tocó SISTEMA (o en PC) | App completa (`Tabs`) | No — ya era así |
| `supervisor` (= **Inspector**) | `SupervisorTabs` (Revisar/Mapa/Catálogo) | No — ya era así en ambos |
| Rol dinámico, panel **Coordinador QR** | `CoordinadorStack` (su panel de escaneo) | **Sí, en teléfono** — antes caía en Inspectores |
| Rol dinámico, **solo módulos de combustible** (Tanques/Ingresos/Consumos/Traslados/Solicitudes) | **Directo a `CombustibleScreen`**, en teléfono | **Nuevo** — antes caía en Inspectores |
| Rol dinámico, módulos mixtos (combustible + otros, o ningún módulo de combustible) | App normal filtrada (`Tabs` + Más) | **Sí, en teléfono** — antes caía en Inspectores |
| `operador` | `OperatorScreen` | **Sí, en teléfono** — antes caía en Inspectores |
| `cocina` | `CocinaScreen` | **Sí, en teléfono** — antes caía en Inspectores |
| `analista` / `conductor` (sin rol dinámico asignado) | App normal (`Tabs` + Más) | **Sí, en teléfono** — antes caía en Inspectores |

Ningún flujo de **QR** (escanear máquina/empleado/aliado/comida) se tocó — esos siguen exactamente
igual, son rutas aparte que se resuelven antes de este mapa. Helper nuevo `esRolCombustible()` en
`src/navigation/index.tsx`: un rol dinámico se considera "solo combustible" cuando **todos** sus
módulos con permiso distinto de "Sin acceso" están dentro de {tanques, ingresos, consumos,
traslados, autorizaciones} — si tiene aunque sea un módulo fuera de ese grupo (ej. inventario,
equipos), ya no aplica la entrada directa y usa la app normal con pestañas.

### Enlaces (linking) por árbol de navegación y URL de inicio por rol (06/08/2026)

**Reporte:** en la versión web, el botón **"atrás" del navegador** podía dejar la app trabada o en
blanco. **Causa:** `src/navigation/index.tsx` armaba UN solo `linking` global mezclando las
pantallas de todos los árboles de rol (Tabs/"Más", SupervisorTabs, PatioStack, CoordinadorStack,
FuelDriverStack, CombustibleStack) como si fueran hermanas de un mismo navegador — ej. "Asistencia"
o "Manual" están anidadas bajo "Más" solo en algunos árboles, pero son pantallas de nivel superior
en otros. Ese descalce rompía la traducción entre URL y pantalla de React Navigation.

**Corregido:** el `linking` ahora se arma POR árbol de navegación (uno por cada fila de la tabla
de arriba), reflejando exactamente las pantallas reales de ese árbol — ya no hay una única config
"superset". Además, al iniciar sesión sin un link directo (el navegador cae en "/"), la app
reescribe la URL a la pantalla de inicio de ese rol, sin recargar:

| Rol / panel | URL de inicio |
|---|---|
| admin / rol genérico | `/inicio` |
| Inspector (`supervisor`) | `/revisar` |
| Coordinador de patio | `/patio` |
| Rol dinámico "Coordinador QR" | `/panel` |
| Chofer de combustible | `/surtir` |
| Rol dinámico solo-combustible, en teléfono | `/combustible-directo` |

Con esto, la barra de direcciones y el historial siempre arrancan desde una URL que sí resuelve a
una pantalla real, así que el botón "atrás" tiene a dónde volver. De paso se agregó al `linking` la
pantalla **"Mangueras hidráulicas"** (ver 3.x), que había quedado fuera por un descuido. No cambió
el comportamiento de "tocar Más = ver el menú" (ya funcionaba bien).

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

## 4.26. Fabricación (MRP): Mangueras hidráulicas + maestros de manufactura

**"Más → 🏭 Fabricación"** abre un panel con 4 tarjetas: **Mangueras hidráulicas** (Fase 1, ya en
producción — ver abajo), **Centros de trabajo**, **Recetas (BoM)** y **Rutas de producción**
(Fase 2, maestros de manufactura — ver 4.26b). Todas comparten el mismo permiso de módulo
(`mangueras`, etiquetado "Fabricación" en la matriz de permisos) — no hace falta otorgar accesos
por separado.

### 4.26a. Mangueras hidráulicas (Taller)

Primera fase del módulo de **Fabricación (MRP)**. Lleva el control de cada
**manguera hidráulica** confeccionada o reparada en el taller para la flota: qué máquina la lleva,
qué trabajo se hizo, cuánto costó, si ya está instalada y si su pago ya está autorizado y pagado.

> **Acceso y permisos:** este módulo es **restringido por defecto** ("Sin acceso"), igual que
> Compras o Uniformes — un administrador debe otorgarlo explícitamente desde **Usuarios →
> permisos por módulo** (o en un rol dinámico). Se llega desde **"Más → 🏭 Fabricación → Mangueras
> hidráulicas"**. Los 3 niveles de permiso hacen exactamente esto:
> - **Lectura:** solo puede ver el listado, los filtros y el total invertido. No ve el botón
>   "+ Nueva manguera" ni los botones de acción de cada tarjeta.
> - **Escritura:** además puede **registrar mangueras nuevas**, editarlas, marcarlas
>   **"🔧 Marcar instalada"** y **enviarlas a autorización de pago** ("📤 Enviar a autorización").
> - **Full control:** además de todo lo anterior, es el ÚNICO nivel que puede **aprobar el pago**
>   con el botón **"✅ Aprobar y marcar pagado"** — por ejemplo, se le da este nivel puntual a
>   **Chelia**, igual que se hizo antes con Diana para Uniformes.

**Registrar una manguera nueva:**
1. Toca **"+ Nueva manguera"**.
2. Llena el **Código de la manguera** (la numeración física, ej. "87-AC"), elige la **Máquina**
   (buscador del catálogo de maquinaria existente), la **Descripción del trabajo**, la **Fecha**,
   el **Costo (US$)** y el **Proveedor** (a quién se le paga).
   - 💵 **Proveedor del catálogo:** el proveedor se **elige del catálogo de Proveedores** (puedes
     crear uno nuevo escribiéndolo) y es **obligatorio**.
   - 🧾 **Cuenta por pagar automática:** al guardar, el sistema **crea sola** una cuenta por pagar
     al proveedor por el costo de la manguera, visible en **Más → Cuentas → Por pagar**. Queda
     **sincronizada**: si cambias el costo se actualiza el monto, y cuando la manguera se marca
     **✅ Pagada**, la cuenta se **salda** automáticamente. Convive con el flujo de aprobación
     (Chelia) — es el mismo dato visto desde Cuentas.
   - 🏭 **Máquina o empresa externa (fuera de la flota):** si la manguera **no** es para una máquina
     de la flota, activa el interruptor **"Es para una máquina o empresa externa"**. Se oculta el
     selector de máquina y aparece un campo para **escribir libremente** el nombre de la máquina o
     empresa externa. En la lista y en el reporte PDF sale marcada con **🏭 · Externa**.
   - La **Descripción del trabajo** es ahora un campo de **varias líneas**: escribe el detalle
     completo del trabajo (se desplaza si es largo).

> **Filtrar por origen:** encima de los filtros de estado hay una fila **Todas / 🚜 Flota /
> 🏭 Externas** para separar las mangueras de la flota de las de máquinas/empresas externas. Al
> elegir **🏭 Externas** se limpia el filtro por equipo (las externas no tienen máquina de la flota).
3. Deja el **Estado de instalación** en *En proceso* (o *Instalada*, si ya se montó). Guarda: queda
   con estado de pago **⏳ Pendiente por pagar** automáticamente.
4. Cuando se instale, toca **"🔧 Marcar instalada"** en su tarjeta.
5. Cuando el trabajo esté listo para cobrarse, toca **"📤 Enviar a autorización"**: pasa a
   **📤 Pendiente por autorización**. Esto **genera una alerta (campana)** para los
   administradores, igual que un requerimiento de compra. Solo desde ahí, quien tenga
   **Full control** puede tocar **"✅ Aprobar y marcar pagado"**, que la deja en **✅ Pagado**
   y guarda **quién aprobó y cuándo** (queda visible en la tarjeta: "Aprobado por … el …").
   - 📄 **Autorización (PDF):** con la manguera en autorización o ya pagada aparece el botón
     **"📄 Autorización (PDF)"**, que descarga un documento de la manguera con la **firma del
     Director General (Jesús Lozada)** — para enviárselo a autorizar o archivarlo. Mientras no
     esté pagada sale la línea para firmar a mano; una vez pagada, sale la firma escaneada.

> 💰 **Cuenta por COBRAR automática (a quién se le factura):** además del proveedor, cada manguera
> pide ahora una **Empresa a cobrar**, un **Encargado** (a quién se le cobra — desplegable con opción
> de **agregar** uno nuevo) y un **Margen de cobro (%)** (por defecto 30 %). Tanto la **Empresa a
> cobrar** como el **Encargado** son **listas PROPIAS de mangueras**: podés agregar una empresa o un
> encargado nuevo escribiéndolo y **NO se registran en el catálogo** de Empresas ni en el resto del
> sistema — quedan solo dentro de mangueras. Al guardar, el sistema
> crea sola una **cuenta por cobrar** a esa empresa por **costo + margen**, visible en
> **Compras → 💰 Por cobrar**. Queda sincronizada con la manguera (si cambia el costo/margen se
> ajusta el monto). **Excepción CHELI:** si el encargado es **CHELI** (marcado "no cobrar" en el
> catálogo de encargados), **NO se genera** cuenta por cobrar. Los campos aplican también a las
> mangueras **externas**.
> - 🧾 **Recibo de cobro (PDF):** cuando la manguera es cobrable, su tarjeta muestra el botón
>   **"🧾 Recibo de cobro"**, que descarga un recibo imprimible con la **máquina** a la que se le
>   hizo el cambio de manguera (código + serial, o el cliente externo), la empresa, el encargado, el
>   costo, el margen y el **monto a cobrar**.
>   - 🚜 **Ficha de la máquina en el recibo:** si la manguera está **enlazada a una máquina de la
>     flota**, debajo del monto a cobrar sale la **ficha de la máquina con su FOTO** — la misma que
>     ves en **Servicio de maquinaria**: tipo, marca, modelo, serial, placa, identificador, empresa y
>     encargado. Así quien recibe el cobro ve de una vez a qué equipo se le hizo el trabajo. La ficha
>     va **en la misma hoja** (el recibo sigue siendo de una página). Las mangueras **externas** (y las
>     de una máquina que no se pudo cargar en ese momento) salen **igual que siempre**, sin ficha: el
>     recibo nunca se deja de generar por eso.

> 🛒 **Aprobación desde Compras:** para que el **gerente** no tenga que entrar al módulo de
> Mangueras, todas las mangueras **pendientes** aparecen también en **Compras → pestaña 🔧 Mangueras**.
> Desde ahí puede **enviar a autorización** y **aprobar el pago** (solo si la manguera está
> **instalada**) sin salir de Compras. La manguera se sigue **creando** en su módulo; Compras solo la
> **refleja** para aprobarla más rápido.

> 🗑️ **Eliminar una manguera NO aprobada:** mientras la manguera **no esté aprobada/pagada**
> (cualquier estado distinto de ✅ Pagado), su tarjeta muestra un botón **"🗑️ Eliminar"** —
> tanto en el módulo de **Mangueras** como en **Compras → 🔧 Mangueras**. Pide **confirmación** y,
> al borrar, elimina también la **cuenta pendiente** (por pagar/cobrar) que había generado, para
> no dejarla colgada sin manguera. Una vez **aprobada/pagada** el botón **desaparece**: ese
> registro ya **no se puede borrar** y queda como constancia contable.

**Filtrar por máquina (trazabilidad):**
En la tarjeta **"🚜 Filtro y consulta por equipo"**, busca la máquina por **código, serial o
placa** y elígela. La lista y el recuadro de **total invertido** (en US$ y su equivalente en Bs a
la tasa BCV del día) quedan acotados a esa sola máquina — útil para ver, por ejemplo, todas las
mangueras hechas para una excavadora puntual y cuánto ha costado en fallas de mangueras. Toca
**"✕ Quitar filtro"** para volver a ver todas. También hay chips para filtrar por **estado de
instalación** (En proceso / Instalada) y **estado de pago** (Pendiente / En autorización /
Pagado), y un buscador de texto por código, descripción o proveedor. El **total invertido**
respeta siempre cualquier combinación de filtros activos, con o sin máquina elegida.

**Reporte PDF:**
Toca **"📄 Reporte de confección y pago"**: genera un PDF con el listado que estás viendo (con
los filtros aplicados), el **total invertido**, el detalle de cada manguera (código, máquina,
fecha, descripción, costo, proveedor, estado de instalación, estado de pago) y **quién la
registró** y **quién aprobó el pago**.

### 4.26b. Centros de trabajo · Recetas (BoM) · Rutas de producción (Fase 2)

Datos maestros para planificar y costear fabricación. Se llega desde el panel
**"Más → 🏭 Fabricación"**.

**🏗️ Centros de trabajo:** el lugar donde se produce — una máquina, un área o una cuadrilla.
"+ Nuevo centro de trabajo" pide código, nombre, tipo, la máquina asociada (si el tipo es
"Máquina"), capacidad por hora y los costos de mano de obra y de máquina por hora (para costear
después una orden de fabricación).

**📋 Recetas (BoM):** elige un **producto terminado** del inventario (marcado como tal con
`item_kind`) para ver o crear sus versiones de receta. Cada versión tiene una lista de
**componentes** (producto que consume, cantidad por unidad de salida, unidad, % de merma esperada
y sustitutos opcionales). Solo puede haber **una receta "🟢 Activa" por producto** — la base de
datos lo garantiza: si intentas activar una segunda, sale el aviso "Ya hay una receta activa para
este producto — desactívala primero".

**🛣️ Rutas de producción:** elige un producto terminado para ver o crear sus rutas — la secuencia
de **pasos** (cada uno en un centro de trabajo, con minutos estándar) que sigue la materia prima
hasta terminar el producto. Cada paso puede marcarse como **punto de control de calidad**
(📷 Foto / 📏 Medición / ✅ Aprobación) con una nota de especificación. Los pasos se reordenan con
las flechas ⬆️⬇️. Igual que las recetas, solo puede haber **una ruta "🟢 Activa" por producto** a
la vez.

### 4.26c. Órdenes de Fabricación (MO) y Órdenes de Trabajo (WO) (Fase 3)

Convierte los maestros en producción real. Se llega desde **"Más → 🏭 Fabricación"**.

**📦 Órdenes de fabricación:** "+ Nueva orden" pide el producto terminado y la cantidad a
fabricar; la app toma automáticamente la receta y la ruta **activas** de ese producto. En el
detalle de la orden (código **MO-####**, asignado solo):
- Cada insumo de la receta muestra un semáforo 🟢🟡🔴 contra el stock real de Inventario.
- **"📤 Solicitar faltantes"** crea un requerimiento de compra (el mismo módulo de Compras de
  siempre) con lo que falta.
- **"▶️ Iniciar producción"** genera una Órden de Trabajo por cada paso de la ruta.
- **"🔒 Cerrar orden"** registra en Inventario el consumo de cada insumo y la entrada del
  producto terminado — no se puede deshacer, pide confirmación.

**🧰 Órdenes de trabajo:** lista de todas las tareas por centro de trabajo, con filtro por estado
y buscador. Al entrar a una: asignar operario, **iniciar/pausar/reanudar/completar/cancelar**,
registrar avance de cantidad, reportar una falla (la pausa con el motivo) y — si el paso es un
punto de control de calidad — **aprobar o rechazar**, lo que bloquea "Completar" hasta resolverlo.
Cada acción queda en una bitácora con quién y cuándo.

### 4.26d. Kiosco de planta y Reportes de Fabricación (Fases 4 y 5)

**🖥️ Kiosco de planta:** pensado para una tablet en el taller. Elige tu centro de trabajo, luego
la orden de trabajo, y ahí botones grandes: **INICIAR** (pide escanear tu carnet o escribir tu
cédula — no hace falta cuenta propia), **PAUSAR/REANUDAR**, **REGISTRAR CANTIDAD**, **REPORTAR
FALLA/PARADA** (con motivos rápidos) y **FINALIZAR**. Si el paso es de control de calidad y sigue
pendiente de aprobar, el kiosco no deja finalizar — hay que aprobarlo desde "Órdenes de trabajo"
en oficina. Se llega desde **"Más → 🏭 Fabricación → Kiosco de planta"** (permiso propio
`fabricacion_planta`, separado del resto de Fabricación).

**📊 Reportes de Fabricación:** OEE (Disponibilidad × Rendimiento × Calidad) por rango de fecha y
centro de trabajo, con banda de color, y costeo por orden (estimado vs. real, con la diferencia
resaltada) — se puede completar el costo real de una orden ya cerrada si falta. Botón de exportar
en PDF.

---

## 4.27. Acarreo / Transporte 🚛

Módulo para **trasladar maquinaria en chutos y bateas/lowboys**: desde el registro de la flota y
los choferes hasta la orden de acarreo, la ejecución del viaje (check-in/out con fotos y firma) y el
control de costos. Se entra por **"Más → 🚛 Acarreo / Transporte"**. El acceso es **por usuario**
(módulo `acarreo` en la matriz de permisos; un administrador lo habilita en Usuarios). Es
**independiente** de "Traslados", que mueve combustible entre tanques.

### 4.27a. Datos maestros (lo primero que se carga)

- **🚛 Chutos:** camiones de arrastre — placa, capacidad de arrastre (t), kilometraje y estado
  (operativo / en taller / inactivo). Avisa cuántos km faltan para el mantenimiento.
- **🛻 Bateas / lowboys:** remolques — tipo, ejes, capacidad de carga (t) y dimensiones útiles.
- **👷 Choferes:** nombre, teléfono, licencia con vigencia y disponibilidad (disponible, en ruta,
  de reposo, suspendido). Avisa si la licencia está vencida. Se puede enlazar a un usuario del sistema.
- **🚜 Equipos a trasladar:** se toma la máquina del Catálogo y se le carga su **peso y dimensiones**
  (sirven para validar que no supere la carga del remolque). No crea máquinas nuevas.
- **🏢 Clientes y proyectos:** emisor y receptor. Los **externos** (a los que se factura) usan
  tarifario; los internos solo controlan costos.
- **📍 Ubicaciones:** obras, almacenes, talleres, minas y pozos de origen/destino.
- **📄 Documentos y vencimientos:** permisos de carga pesada, pólizas, revisiones técnicas y
  licencias — con su fecha de vencimiento (disparan alertas).

Todo se busca por sus características y las listas salen en orden natural A→Z.

### 4.27b. Órdenes de acarreo y validaciones automáticas

**"Acarreo → 📋 Órdenes de acarreo"** es cada viaje. Se elige **origen y destino**, el
**chuto + remolque + chofer** y los **equipos a trasladar** (multi-selección con búsqueda; muestra
el peso total en vivo frente a la capacidad del remolque). Al guardar, el sistema **valida solo**:

- **Peso:** si la suma del peso de los equipos supera la capacidad del remolque o el arrastre del
  chuto (bloqueo suave). También avisa si algún equipo no tiene el peso cargado.
- **Vencimientos:** si la licencia del chofer o algún documento del chuto/remolque están vencidos.
- **Solapamiento:** si el chofer, el chuto o el remolque ya tienen otro viaje en esa ventana de fechas.

Las alertas rojas son **bloqueo suave**: avisan y, si de verdad hace falta, un **administrador**
puede marcar "Forzar guardado". Los avisos amarillos (vencimientos, solapamiento) no bloquean.

**Estados del viaje:** Programado → En carga → En tránsito → En descarga → **Completado** (o
**Cancelado** con motivo). Desde el detalle de la orden se avanza el estado y cada cambio queda en
la **bitácora**.

### 4.27c. Ejecución del viaje (check-in / check-out)

Desde el **detalle de la orden**, según el estado, aparece la acción que toca:

- **📦 En carga → Check-in de salida:** nivel de combustible, cauchos y fajas/cadenas de amarre OK,
  observaciones y **fotos "antes"/"amarre"**. Al guardar, la orden pasa a **EN TRÁNSITO**.
- **🚚 En tránsito:** registrar **incidencias** en ruta (mecánica, clima, permiso, alcabala). El
  botón **"Llegó"** la pasa a **EN DESCARGA**.
- **📥 En descarga → Check-out de recepción:** estado de la maquinaria a la llegada, **fotos
  "después"** y **FIRMA** (nombre de quien recibe + foto de la firma/recepción). Al confirmar, la
  orden queda **COMPLETADA**.

Cada inspección, foto e incidencia queda guardada en la orden.

### 4.27d. Control de costos y tarifario

- **💵 Costos del viaje** (en el detalle de la orden): registra **combustible** (con litros →
  **rendimiento km/L**), **viáticos** de comida/hospedaje (con **foto del comprobante**), **peajes**
  y otros. Arriba muestra el **total**, los **viáticos otorgados vs. comprobados** y el rendimiento.
- **🧾 Tarifario** (Acarreo → Financiero): precios **por km, por tonelada, por hora o tarifa plana**,
  general o por **cliente/ruta**. Para los clientes **externos**, la orden calcula sola la
  **valorización sugerida** (según la tarifa más específica que aplique) y la puedes **guardar**.

### 4.27e. Documentos PDF y panel (KPIs + alertas)

- **📄 Documentos** (en el detalle de la orden): **Guía de traslado** (para el chofer, con la
  maquinaria y espacios de firma salida/llegada), **Acta de recepción** (estado pre/post con **fotos**
  y **firma** de conformidad) y **Liquidación de viaje** (gastos, viáticos otorgados vs. comprobados,
  combustible/rendimiento e incidencias). Desde la **lista de órdenes**, el botón **"📄 Consolidado"**
  descarga el resumen de los acarreos según el filtro elegido.
- **📊 Panel** (Acarreo → Operación): **KPIs** — total de acarreos, tiempo promedio de tránsito, %
  a tiempo (On-Time), costo por km — y **alertas**: documentos/licencias **vencidos o por vencer**
  (30 días), **mantenimiento** de unidades por km recorridos y **viajes retrasados** en ruta.

---

## 4.28. Guías descargables por rol (PDF)

Dentro de **Más → Manual / Ayuda**, arriba de los temas del manual, hay una tarjeta
**"📄 Guías descargables"** (plegada por defecto — toca el encabezado para desplegarla): un PDF
corto (una "hoja de referencia") por cada rol, con los pasos exactos de la aplicación — pensado
para **imprimir o enviar por WhatsApp** a alguien que trabaja desde el teléfono y necesita el paso
a paso a mano.

> Disponible para **todos los usuarios** (no depende de ningún permiso de módulo): cada quien
> puede descargar la guía de su propio rol, o la de cualquier otro si necesita ayudar/entrenar a
> alguien.

Hay una guía para cada uno de estos roles (no incluye al Administrador: ya tiene acceso al manual
completo y no le hace falta una hoja de referencia de campo), cada una con sus propios pasos y
mockups de pantalla:

- 🪖 **Inspector** — iniciar sesión, escanear la máquina y llevar la jornada (iniciar/finalizar/parada).
- 👷 **Operador** — registrar tu jornada y el combustible, con usuario o identificándote por QR con tu carnet.
- 🍽️ **Cocina** — verificarte y entregar comidas escaneando el carnet (torniquete o por persona).
- 🚚 **Coordinador de Patio** — jornada de camiones, entrada/salida, surtir gasoil y reportar averías.
- ⛽ **Chofer de Combustible** — elegir/escanear la máquina y registrar el surtido.
- 📷 **Coordinador QR** — surtir gasoil, reportar avería y marcar una máquina lista, todo por QR.
- 📊 **Analista** — marcar la asistencia del personal (tu acceso garantizado) y el resto de módulos según tus permisos.
- 🚛 **Listero (Viajes de camiones)** — buscar el camión, registrar un viaje con un toque y corregir la hora de los tuyos.

Toca **"📄 Descargar"** junto al rol que quieras: se genera el PDF al instante (no se guarda nada
en el servidor) y se abre para imprimir/guardar (en PC) o compartir (en el teléfono), igual que
cualquier otro reporte del sistema.

---

## 4.29. Ajustes
Se llega desde **Más → Ajustes**. La **apariencia** (modo oscuro/claro) y la **seguridad**
(contraseña, huella/Face ID) viven en la **tuerca ⚙️** del encabezado, no aquí — ver 5. En
Ajustes solo quedan:

- **Cerrar sesión.**
- **⬇️ Descargar backup (solo administradores puntuales, en computadora):** descarga un archivo
  con **todos los datos** del sistema (máquinas, jornadas, empleados, pagos, inventario…), por si
  hace falta un respaldo manual. Acceso restringido a las cuentas designadas — el resto de
  administradores no ve este botón.

> **👤 Con qué cuenta estás dentro (14/08/2026):** al abrir la **tuerca ⚙️** del encabezado, arriba
> a la derecha —al lado del título "⚙️ Ajustes"— se muestra **tu nombre** y, debajo, tu **👤 usuario
> de inicio de sesión** (el mismo con el que entras, máximo 10 caracteres). Sirve para saber de un
> vistazo con quién quedó abierta la sesión, sobre todo en las computadoras y teléfonos que usan
> varias personas. Si dice *"sin usuario asignado"*, es que a esa cuenta todavía no le cargaron el
> usuario: pídeselo al administrador (**Más → Usuarios**).

---

## 4.30. Obras Públicas 🏛️

Módulo **aislado** para los **supervisores externos de Obras Públicas**. Ellos manejan las
**jornadas, averías/paradas, visitas y ubicación** de SUS máquinas asignadas, **sin afectar** el
módulo de inspectores. Lo único que se comparte con el resto del sistema es la **ubicación** (se
ve en el mapa y el catálogo).

- **Asignar máquinas:** desde el **Catálogo → botón 🏛️ Obras Públicas** eliges el supervisor (de
  los usuarios con ese rol) y le asignas máquinas **por lote o individual**. La máquina le aparece
  al supervisor en su teléfono ("🏛️ Mis máquinas").
  > **Cualquier empresa (17-ago-2026):** el listado ya NO está limitado a GOLDEN y LICCIONE. Salen
  > **todas** las máquinas del catálogo (operativas y averiadas), de cualquier empresa. Darle o quitarle
  > una máquina a Obras Públicas es cosa de marcarla acá; ya no hace falta tocar el código.
  > **Acarreo por VIAJES (14-ago-2026):** en el "▾ Detalle" de cada edificio, el m³ acarreado ya
  > NO se teclea a mano — se ingresan los **viajes por tipo de vehículo** y el m³ se **calcula solo**:
  > 🚛 **Camión Volteo Toronto = 18 m³/viaje** · 🚚 **Chuto con Volqueta = 25 m³/viaje** (ej.: 4 viajes
  > Toronto = 72 m³). Hay una tarjeta **"🚚 m³ acarreados totales"** (teléfono y PC) que suma todo el
  > acarreo. Al marcar **"✅ Frente entregado"**, los m³ acarreados deben **cuadrar** con los m³ removidos;
  > si no, sale un aviso con la diferencia.
- **Vista del supervisor (teléfono):** arriba ve una fila de **tarjetas resumen**
  (**m³ removidos hoy · edificios de hoy · máquinas asignadas · trabajando · averiadas · m³ totales · m³ acarreados totales**);
  tocar "Trabajando" o "Averiadas" **filtra** la lista, y tocar "m³ removidos hoy" / "Edificios hoy" /
  "m³ totales" abre el **módulo de m³ por edificio**. Por cada máquina registra **visita (GPS)**,
  **inicia/finaliza jornada**, marca **avería o parada** y **actualiza ubicación**.
- **POR USUARIO (sesión) en el teléfono:** cada supervisor ve y maneja **solo SUS** edificios y m³
  (los del otro le son indiferentes). Los **m³ removidos hoy**, los **edificios de hoy** y el **Reporte
  del día** son de su sesión. Lo **único compartido** entre todos es **m³ totales** (el acumulado global
  de toda la operación). En el **panel de PC** todo se ve **consolidado** (todos los supervisores).
- **m³ removidos (por EDIFICIO, ya NO por máquina):** con el botón **⛰️ Removidos hoy · por edificio**
  se abre un módulo aparte. Elige el edificio (la lista está **agrupada por sub-sector**: El Palmar,
  Los Corales…) y escribe los **m³ removidos hoy** de ese edificio. La **primera vez** de cada edificio
  se teclea además el **m³ acumulados (base)**; luego el acumulado **crece solo** con los removidos de
  los días siguientes (acumulado = base + Σ removidos posteriores). Puedes **editar (✎)** o **borrar (🗑)**
  lo del día. Los **acumulados de todos los edificios/supervisores se consolidan en el panel de PC**.
- **Detalle por edificio (reporte diario):** en cada edificio del módulo de removidos hay un
  **▾ Detalle** que despliega los campos del reporte diario: **m³ acarreados, viajes,
  maquinaria en uso / inoperativa, cuerpos (supervivientes / fallecidos),
  actividades del día** y un interruptor **✅ Frente entregado**. **Maquinaria en uso** y **maquinaria
  por requerimiento** se marcan con **check** (multi-selección) sobre la **lista de máquinas asignadas**
  a ese supervisor (más las externas que agregues). La de **en uso** trae además un **buscador** (por
  **código, serial, placa o empresa**) y muestra en cada máquina su **serial · placa · empresa**.
  Es **opcional** y se guarda con el
  mismo botón **Guardar** (un edificio se guarda aunque no tenga m³ si le pusiste detalle).
- **Enviar por WhatsApp (📤):** el botón **"Enviar reporte por WhatsApp"** arma el **texto del reporte
  del día por edificio** (agrupado por sub-sector, con solo las líneas que tienen dato, y los
  **totales del día** al final) y abre WhatsApp con el mensaje listo para enviar. Usa lo **ya
  guardado**, así que **guarda primero**.
- **Reporte del día (📋 Reporte del día):** es **SOLO LECTURA** — ahí **no se ingresa nada**, **TRAE**
  lo que la supervisora ya cargó hoy por edificio en **⛰️ Removidos hoy**. Muestra los **totales del día**
  (removidos, acumulado, acarreados, viajes, edificios, cuerpos) y el **detalle por edificio** (m³,
  maquinaria en uso/inoperativa/requerimiento, cuerpos, actividades, entregado), con **📤 Enviar reporte
  por WhatsApp** al final.
- **Panel de Obras Públicas (Más → 🏛️ Obras Públicas):** panel de **admin/coordinador** que
  **agrega todo el módulo** (todos los supervisores):
  - **KPIs (solo del DÍA):** máquinas asignadas · trabajando ahora · averiadas/paradas · **m³ del día** ·
    edificios de hoy. **Tocar una tarjeta abre su detalle**: máquinas asignadas → lista con su supervisor;
    trabajando/averiadas → esas máquinas; m³/edificios → los edificios atendidos hoy con sus m³. La vista
    muestra **solo lo del día**; lo único que se mantiene y crece es el **Acumulado desde el inicio**.
  - **📚 Histórico (por día, buscable):** botón bajo los KPIs — cada día queda guardado; se filtra por
    **rango de fechas** y por **todas las características** (edificio, sub-sector, supervisor, maquinaria,
    actividad…). Muestra el registro por edificio de cada día (m³, acarreo, maquinaria, cuerpos, actividades).
  - **Reporte de Actividades:** consolida el reporte del día de todas las supervisoras (m³
    removidos, m³ acarreo, cuerpos, traslado camión) y muestra los **acumulados desde el inicio**.
    El admin ajusta la **base acumulada** con **⚙️ Editar base** (m³ base, cuerpos base y fecha de corte).
  - **m³ removidos hoy por edificio:** lista los edificios tratados hoy con sus **m³ del día** y su
    **acumulado** (base + días posteriores). Es la **suma consolidada de todos los supervisores**.
  - **Gráficos:** distribución por estado · **Acarreo Total** (máquinas activas por día, 7/30). El
    gráfico de Acarreo Total es **interactivo**: al **tocar un día** muestra el **detalle** de ese día
    (máquinas con actividad, con **serial · placa · empresa** y horas).
  - **Registros de acarreo:** muestra los **10 más recientes** (máquina con serial · placa · empresa,
    supervisor, estado y fecha). El botón **📚 Ver histórico completo** abre el histórico **buscable**
    por **rango de fechas** (Desde/Hasta) y por **todas las características** (máquina, serial, placa,
    empresa, supervisor, estado…), con **📤 Reporte del histórico por WhatsApp** de lo filtrado.
  - **Estado de flota en campo** (con su supervisor) y **tabla de últimas visitas**.
  - Filtra por **supervisor** con los chips; toca un **KPI** para filtrar la flota.

> Las horas y estados de Obras Públicas **NO** tocan los reportes ni los pagos del módulo de
> inspectores — son datos aparte (tablas `op_*`). Solo la **ubicación** se sincroniza con el
> mapa/catálogo.

---

## 4.31. Viajes de Camiones (Listeros) 🚛

Bitácora de **viajes de los camiones de volteo** (regreso/entrada de la máquina = un viaje),
registrada en campo por los **listeros** — uno por ubicación, cada uno con su propio usuario. Se
entra por **"Más → 🚛 Viajes de camiones"**. El acceso es **por usuario** (módulo
`viajes_camiones`; un administrador lo habilita en Usuarios, sin necesidad de crear ningún rol
nuevo — ver 4.13). El **nivel** decide qué se ve:

- **Escritura** → vista del **listero**: buscar el camión, registrar viajes y ver/corregir los suyos.
- **Full** → además, el **panel de la jefa/administración**: todos los listeros combinados, por
  listero individual, resumen, metas, alerta y reporte.

### Vista del listero

- **Buscar camión:** por código, categoría, marca, modelo, placa o serial, con **chips de estado**
  (✅ Operativa · 🔴 Averiada · 🟡 Parada · ⏳ Esperando instrucciones · ⬛ Retirada) — igual criterio
  que el Catálogo. Si el camión está averiado, parado o retirado, sale un **aviso** antes de
  registrar (no bloquea, solo confirma).
- **Registrar viaje:** un solo botón — **🚛 Registrar viaje**. La hora se toma sola (la del
  teléfono en el momento del toque) y el **chofer** también: es el que el Coordinador de Operadores
  tiene asignado a ese camión en el turno actual (no se escribe a mano).
- **Sin señal:** el viaje se guarda igual en el teléfono y se sube solo en cuanto vuelva la
  conexión — se ve una insignia **ámbar "📤 pendiente"** mientras tanto. Por muchos días que
  pase el listero sin cobertura, nunca se pierde ni se descarta nada.
- **⚠️ Viajes que no pudieron subirse:** si un viaje falla por algo que **no** es la señal (el
  camión se borró del catálogo, un dato quedó inválido), el sistema lo reintenta 3 veces y
  después lo **aparta** — pero **la cola sigue subiendo los demás**. El viaje apartado no se
  pierde: sale en rojo con **"⚠️ no subió"**, el motivo del error debajo, y un aviso arriba con
  botón **🔄 Reintentar** para volver a intentarlo una vez resuelta la causa. Reintentar nunca
  duplica un viaje que ya hubiera entrado.
- **Mis viajes de hoy:** el listero puede **corregir la hora** de un viaje propio mientras su
  jornada siga abierta (no puede borrarlo, ni tocar los de otro listero). Si tocó el camión
  equivocado, debe avisarle a su jefa para que lo corrija.

### Panel de la jefa / administración

- **Resumen de hoy:** ranking de viajes por camión (comparado contra su **meta diaria**, si tiene
  una puesta) y total por listero.
- **⚠️ Camiones sin viaje reciente:** aviso dentro de la pantalla (no es notificación push) cuando
  un camión lleva más del **umbral configurado** (arranca en 6 horas, se ajusta en
  "Configuración") sin registrar viaje — no incluye camiones averiados, parados o retirados, que
  legítimamente no viajan.
- **Lista completa:** todos los viajes de todos los listeros, filtrable por **empresa**, por
  **listero**, por **camión** y por rango de fecha (Hoy / Esta semana / Este mes / Rango libre /
  Días específicos). Desde ahí puede **corregir la hora o borrar cualquier viaje** — el borrado
  queda igual en la auditoría (ver 4.13b), no se pierde el rastro.
- **Configuración:** el **umbral de alerta** (horas) y la **meta de viajes diarios** de cada
  camión, ambos editables en cualquier momento.
- **Compartir / exportar reporte** del rango filtrado, en PDF, igual que el resto del sistema.

### 🏢 Filtrar por empresa y reporte GLOBALIZADO (20-ago-2026)

**Filtro por empresa.** Arriba de los filtros de camión y listero hay una fila **EMPRESA** con un
chip por cada empresa que tenga viajes en el rango, **con su cantidad**. Marca una o varias. La
empresa sale del **camión** (la que tiene en el catálogo de maquinaria), así que no hay que
cargarla en cada viaje. Los camiones sin empresa asignada se agrupan en **"Sin empresa"**.
**✕ Limpiar filtros** borra empresa, camión y listero de un toque.

**Dos formas de ver y de imprimir.** En **VISTA Y REPORTE** eliges:

- **📋 Detallado (viaje por viaje)** — como siempre: una línea por cada viaje. El PDF ahora trae
  además **Empresa** y **Placa / Serial** en cada línea.
- **📊 Resumido (viajes por camión)** — **no desglosa viaje por viaje**. Muestra, y luego imprime:
  - el **TOTAL GENERAL** de viajes y cuántos camiones lo hicieron;
  - por cada **empresa**, su **total de viajes** y cuántos camiones tiene;
  - dentro de cada empresa, el **desglose por camión**: código, placa/serial y **cuántos viajes**
    hizo, de mayor a menor.

> Sirve para las tres cosas que se piden a diario: **un camión** (márcalo y te dice cuántos viajes
> hizo), **varios camiones** (marca los que quieras y cada uno sale con su cantidad), o **una
> empresa completa** (márcala y salen todos sus camiones, el número global de la empresa y el
> desglose de cada uno).

> El modo elegido manda tanto en lo que ves en pantalla como en el PDF, y el reporte **imprime en
> su encabezado los filtros con los que se sacó** (empresas, camiones, listeros), para que después
> se pueda auditar sin adivinar. El total de cada empresa **siempre** cuadra con la suma de su
> desglose y con el total general — eso está fijado con una prueba automática
> (`npm run test:viajes`).

> De paso, el Catálogo y Control de Maquinaria ahora muestran el **operador planeado** por el
> Coordinador de Operadores (antes solo se veía dentro de ese módulo) — mismo tratamiento que ya
> tenía el Inspector, para que una reasignación se note en toda la app, no solo ahí.

---

## 4.32. Cuentas por pagar y por cobrar 🧾

Es la **libreta de deudas** de la empresa. Compras te dice **qué se compró**; esta sección te dice
**qué se debe** y **qué te deben**, con su **fecha de vencimiento** y su **saldo**. Se entra por
*Compras → pestañas 💸 **Por pagar** y 💰 **Por cobrar***, junto a Solicitudes, Órdenes,
Proveedores y Resumen.

**Dos pestañas arriba:**
- **💸 Por pagar** — lo que la empresa le debe a sus **proveedores**.
- **💰 Por cobrar** — lo que las **empresas** le deben a la empresa.

Las dos funcionan **exactamente igual**; lo único que cambia es de qué lado está el dinero.

**Los tres totales de arriba** (son de TODAS las cuentas de esa pestaña, no de lo que estés
buscando):
- **Total pendiente:** todo lo que falta por pagar/cobrar.
- **Vencido:** lo que ya se pasó de la fecha (y cuántas cuentas son).
- **Por vencer:** lo que vence dentro de los **próximos 7 días**.

**Registrar una cuenta** (botón **"+ Nueva"**):
1. Toca **a quién** — el **proveedor** (si es por pagar) o la **empresa** (si es por cobrar). Se
   elige de la lista, **no se escribe**: así, si mañana corrigen ese nombre, todas sus deudas
   quedan corregidas solas. Si el proveedor no aparece, créalo primero en *Compras → Proveedores*.
2. Escribe el **concepto** (por qué se debe) y, si tienes, el **Nº de factura o control**.
3. Pon el **monto** en dólares.
4. Pon la **fecha de emisión** y la de **vencimiento** (formato **AAAA-MM-DD**). Para el
   vencimiento hay botones rápidos: **Hoy · 15 días · 30 días · 60 días**. Si la dejas vacía, esa
   cuenta **nunca vence**.
5. **Guardar cuenta**.

**Cómo se lee la lista:** lo más urgente sale **arriba** (primero lo 🔴 **vencido**, luego lo 🟠
**por vencer**, después lo 🕓 **pendiente**). Cada tarjeta muestra el nombre, el concepto, cuándo
vence (**"hace 3 día(s)"** / **"HOY"** / **"en 12 día(s)"**) y el **saldo**. Lo **vencido** además
lleva una **franja roja al lado izquierdo** para que salte a la vista.

**Toca una cuenta** para desplegarla y ver el monto original, lo abonado, el saldo, la nota y el
historial de abonos. Ahí abajo están los botones:
- **✅ Marcar pagada** — pide confirmación. Si todavía queda saldo, te lo advierte antes.
- **💵 Registrar abono** — para cuando se paga **en partes**: monto, fecha, método (efectivo,
  transferencia, cheque…) y referencia. El saldo baja solo. Cuando el saldo llega a **cero**, la
  cuenta pasa a **pagada** sola, sin que tengas que tocar nada más.
- **✎ Editar** — corrige cualquier dato de la cuenta.
- **⛔ Anular** — para lo que se registró por error. **No se borra**: deja de sumar en los totales
  pero queda en el historial como anulada.
- **↩ Volver a pendiente** — en las pagadas o anuladas, por si fue un error.

**🔎 Buscador:** por nombre, concepto, factura o nota. Por defecto solo se ven las cuentas
**vivas**; con el botón **"Mostrar también pagadas y anuladas"** aparecen todas.

> **Acceso:** el módulo **nace cerrado** — nadie lo ve hasta que un administrador le dé el permiso
> **"Cuentas por pagar y cobrar"** desde *Usuarios*. Con **lectura** solo se consulta; para
> registrar, abonar o marcar pagada hace falta **escritura**.

> ⚠️ **Antes de usarlo hay que correr una vez** `supabase/cuentas_por_pagar_y_cobrar.sql` en
> Supabase (SQL Editor): crea las tablas `cuentas` y `cuenta_abonos`. Ese script **no modifica
> nada** de lo que ya existe. Un detalle a tener en cuenta: a partir de ahí **no se podrá borrar
> un proveedor ni una empresa que tenga cuentas registradas** (la base lo impide a propósito, para
> no perder el rastro de una deuda); primero hay que anular o eliminar sus cuentas.

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
