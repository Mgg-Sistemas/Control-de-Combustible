// Guía rápida (PDF descargable) del módulo de FABRICACIÓN (MRP). A diferencia
// de las 7 guías de rol, esta cubre el módulo COMPLETO (mangueras, maestros,
// órdenes y kiosco de planta) para el administrador/encargado de taller — por
// eso es más larga. Sigue el mismo patrón visual/estructural de patioGuide.ts
// y coordinadorQrGuide.ts — ver guideBuilder.ts.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, qaTable, exportGuide,
  phoneFrame, appBar, mockupBody, mockupCard, mockupField, mockupBtn, mockupRow,
} from './guideBuilder';

export async function generateFabricacionGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía de Fabricación (MRP)',
    subtitle: 'Del maestro al producto terminado: mangueras, centros de trabajo, recetas, rutas, órdenes y kiosco de planta',
    introCalloutHtml: calloutInfo(
      '🏭 El módulo tiene <b>5 fases</b> en producción: mangueras hidráulicas, maestros (centros/recetas/rutas), ' +
      'órdenes (fabricación y trabajo), kiosco de planta y reportes. Casi todo requiere el permiso <b>Fabricación</b> ' +
      '(módulo <b>mangueras</b> — "Sin acceso" por defecto); el <b>Kiosco de planta</b> usa un permiso APARTE, ' +
      '<b>fabricacion_planta</b>, pensado para un operario que solo debe ver el kiosco.'
    ),
  });

  // ── Sección 1 — Entrada y panel ─────────────────────────────────────────
  const hubMock = phoneFrame(
    appBar('🏭 Fabricación') +
    mockupBody(
      mockupRow('🧵 Mangueras hidráulicas', 'Confección/reparación, costeo y pago') +
      mockupRow('🏗️ Centros de trabajo', 'Áreas, máquinas y cuadrillas') +
      mockupRow('📋 Recetas (BoM)', 'Componentes y % de merma') +
      mockupRow('🛣️ Rutas de producción', 'Pasos y control de calidad') +
      mockupRow('🏭 Órdenes de fabricación', 'Planifica y cierra la producción') +
      mockupRow('🛠️ Órdenes de trabajo', 'Avance por centro de trabajo') +
      mockupRow('🖥️ Kiosco de planta', 'Pantalla táctil del operario') +
      mockupRow('📊 Reportes de Fabricación', 'OEE y costeo por orden')
    )
  );
  const step1 = stepSection(1, 'Cómo se entra y qué hay en el panel', 'Más → 🏭 Fabricación — un hub con 8 tarjetas',
    twoCol(
      stepList([
        'Entra por **Más → 🏭 Fabricación**.',
        'Verás hasta **8 tarjetas**, una por pantalla del módulo.',
        'Cada tarjeta se muestra u oculta según el permiso de quien entró.',
        'El **Kiosco de planta** también tiene su **propia fila directa** en "Más" (aparte de Fabricación), para dar acceso solo a esa pantalla.',
      ]),
      hubMock
    ) +
    calloutWarn(
      'El permiso <b>Fabricación</b> (mangueras) tiene 3 niveles: <b>👁️ lectura</b> (solo ver), ' +
      '<b>✍️ escritura</b> (crear/editar mangueras, centros, recetas, rutas, MO y WO) y <b>🔓 full</b> ' +
      '(todo lo de escritura + aprobar y marcar pagada una manguera). El permiso <b>Kiosco de planta</b> ' +
      '(fabricacion_planta) es independiente: con solo lectura ahí, el kiosco se ve pero no deja tocar botones.'
    ) +
    qaTable('Nivel', 'Qué te deja hacer', [
      ['Sin acceso', 'No ves la tarjeta/pantalla (es el valor por defecto de ambos permisos).'],
      ['👁️ Lectura', 'Ver todo el módulo, sin botones de crear/editar/accionar.'],
      ['✍️ Escritura', 'Crear y editar mangueras, centros de trabajo, recetas, rutas, órdenes de fabricación y de trabajo. NO puede aprobar pagos de mangueras.'],
      ['🔓 Full', 'Todo lo de escritura, más "✅ Aprobar y marcar pagado" en Mangueras (el nivel de quien autoriza el pago).'],
    ])
  );

  // ── Sección 2 — Mangueras hidráulicas ───────────────────────────────────
  const step2Mock = phoneFrame(
    appBar('🧵 Nueva fabricación') +
    mockupBody(
      mockupCard(
        mockupField('Código de la fabricación', '0014 (automático)', true) +
        mockupField('🏭 ¿Máquina/empresa externa?', 'No', true) +
        mockupField('Máquina', 'CAMION VOLTEO TORONTO', true) +
        mockupField('Descripción del trabajo', 'Manguera del brazo hidráulico (varias líneas)', true) +
        mockupField('Fecha', '06/08/2026', true) +
        mockupField('Costo (US$)', '85', true) +
        mockupField('Proveedor', 'Hidra C.A.', true) +
        mockupBtn('Guardar', 'primary')
      )
    )
  );
  const step2 = stepSection(2, 'Mangueras hidráulicas', 'Confección/reparación por máquina, con su ciclo de instalación y de pago',
    twoCol(
      step2Mock,
      stepList([
        'Toca **+ Nueva fabricación**. El **código de la fabricación es automático** (correlativo de 4 dígitos: 0001, 0002…, no editable). Llena máquina, descripción, fecha, costo (US$) y proveedor.',
        'Al **buscar la máquina** se muestran su **serial/placa**, la **empresa** y el **encargado** (además del código), y puedes filtrar por cualquiera de esos datos.',
        '🏭 Si la manguera es para una **máquina o empresa EXTERNA** (fuera de la flota), activa el interruptor **"Es para una máquina o empresa externa"**: se oculta el selector de máquina y escribes libremente el nombre de esa máquina/empresa. En la lista y el reporte sale marcada con 🏭 · Externa.',
        'La **Descripción del trabajo** es un campo de **varias líneas** (textarea): puedes escribir el detalle completo del trabajo.',
        'Con **✏️ Editar** corriges los datos mientras no esté pagada.',
        'El botón **🔧 Marcar instalada** pasa el estado de instalación de 🟡 En proceso a 🟢 Instalada.',
        'El botón **📤 Enviar a autorización** manda el pago de ⏳ Pendiente a 📤 En autorización.',
        'Solo el nivel 🔓 full ve **✅ Aprobar y marcar pagado** (pasa a ✅ Pagado).',
        'Arriba, la card **🚜 Filtro y consulta por equipo** filtra el historial de mangueras por máquina; hay reporte **📄 Reporte de confección y pago** en PDF.',
        'El filtro de **origen** (**Todas / 🚜 Flota / 🏭 Externas**) separa las fabricaciones de la flota de las de máquinas/empresas externas. Al elegir 🏭 Externas se limpia el filtro por equipo.',
      ])
    ) +
    qaTable('Instalación', 'Significado', [
      ['🟡 En proceso', 'Aún no se ha instalado en la máquina.'],
      ['🟢 Instalada', 'Ya está instalada (botón "🔧 Marcar instalada").'],
    ]) +
    qaTable('Pago', 'Significado', [
      ['⏳ Pendiente', 'Recién registrada, nada enviado todavía.'],
      ['📤 En autorización', 'Enviada a autorizar (botón "📤 Enviar a autorización").'],
      ['✅ Pagado', 'Aprobada y pagada (botón "✅ Aprobar y marcar pagado", solo nivel 🔓 full).'],
    ]) +
    calloutWarn(
      '<b>Candado nuevo:</b> no se puede aprobar el pago de una manguera que <b>no esté instalada</b> — el botón de aprobar ' +
      'ni siquiera aparece si sigue en 🟡 En proceso (y queda bloqueado también del lado de la base de datos, no solo en pantalla). ' +
      'Además, una vez que la manguera ya está <b>✅ Pagada</b>, el campo "Estado de instalación" del formulario de edición queda ' +
      'BLOQUEADO (solo texto informativo) para no poder "desinstalarla" por accidente.'
    ) +
    calloutInfo(
      'Las máquinas dadas de baja (⛔ inactivas) NO se ocultan del buscador de "Filtro y consulta por equipo": se siguen viendo, ' +
      'marcadas con el badge <b>⛔ Inactiva</b>, para poder consultar su historial de mangueras.'
    )
  );

  // ── Sección 3 — Centros de trabajo ──────────────────────────────────────
  const step3 = stepSection(3, 'Centros de trabajo', 'Áreas, máquinas o cuadrillas que se usan para planificar y costear',
    stepList([
      'Toca **+ Nuevo centro de trabajo**.',
      'Llena **código**, **nombre** y **tipo** (🏭 Máquina, 📍 Área o 👷 Cuadrilla). Si el tipo es Máquina, eliges la **máquina asociada**.',
      'Registra el **costo de mano de obra (US$/hora)** y el **costo de máquina (US$/hora)** — se usan luego para costear las órdenes.',
      'Opcional: minutos de **alistamiento (setup)** y de **limpieza**, y el **Estado** (✅ Activo / ⛔ Inactivo).',
    ]) +
    qaTable('Tipo', 'Uso típico', [
      ['🏭 Máquina', 'Un equipo concreto del catálogo (se le asocia su ficha de "machinery").'],
      ['📍 Área', 'Una zona de trabajo sin máquina asociada (ej. banco de armado).'],
      ['👷 Cuadrilla', 'Un grupo de personas (mano de obra, sin costo de máquina).'],
    ]) +
    calloutInfo('Un centro de trabajo ⛔ inactivo NO se borra: sigue existiendo para no perder el historial, pero se marca como inactivo en las listas y selectores.')
  );

  // ── Sección 4 — Recetas (BoM) ───────────────────────────────────────────
  const step4 = stepSection(4, 'Recetas (BoM)', 'Componentes, cantidades y merma esperada por producto terminado',
    stepList([
      'El producto debe existir primero en **Inventario** como `item_kind` = producto terminado.',
      'En Recetas, busca el producto y toca **+ Nueva versión** (arranca en 🟡 Borrador).',
      'Carga la **cantidad de salida**, la **unidad** y los **componentes** (cantidad, unidad, % de merma y sustitutos).',
      'Toca **✅ Activar receta**: te pide confirmar ("¿Activar la versión N?...") y pasa a 🟢 Activa.',
      'Para retirarla, toca **⚪ Marcar obsoleta** (también pide confirmar): pasa a ⚪ Obsoleta y deja de ser la receta activa del producto.',
    ]) +
    qaTable('Estado', 'Significado', [
      ['🟡 Borrador', 'Se puede editar libremente: cantidad, unidad y componentes.'],
      ['🟢 Activa', 'Es la que usan las nuevas Órdenes de fabricación. Solo puede haber UNA activa por producto.'],
      ['⚪ Obsoleta', 'Ya no se usa para nuevas órdenes, queda solo de referencia/historial.'],
    ]) +
    calloutWarn(
      'Una vez que una versión está 🟢 Activa u ⚪ Obsoleta, sus <b>componentes ya NO se pueden editar</b> en el mismo formulario ' +
      '— la pantalla lo avisa con "🔒 Esta versión ya está... — para cambiar algo, crea una nueva versión". Para modificar algo, ' +
      'usa "+ Nueva versión" y arma la receta corregida ahí.'
    )
  );

  // ── Sección 5 — Rutas de producción ─────────────────────────────────────
  const step5 = stepSection(5, 'Rutas de producción', 'Pasos por centro de trabajo, con checkpoints de calidad opcionales',
    stepList([
      'Selecciona el producto y toca **+ Nueva ruta** (arranca en 🟡 Borrador).',
      'Con **+ Agregar paso** cargas: nombre, descripción, **centro de trabajo**, **minutos estándar** y si es punto de control de calidad.',
      'Si es punto de control, eliges el tipo: **📷 Foto**, **📏 Medición** o **✅ Aprobación**, y puedes agregar una nota/especificación.',
      'Reordena los pasos con **⬆️** / **⬇️**; edítalos con **✏️ Editar** o bórralos con **🗑️ Eliminar** (mientras la ruta esté en borrador).',
      'Toca **✅ Activar ruta**: solo puede haber UNA ruta activa por producto; para reemplazarla primero pásala a **⚪ Marcar obsoleta**.',
    ]) +
    calloutWarn(
      'Igual que en Recetas: una ruta 🟢 Activa u ⚪ Obsoleta ya no permite tocar sus pasos ("🔒 Esta ruta ya está... — para cambiar ' +
      'los pasos, crea una nueva versión"). Los centros de trabajo ⛔ inactivos NO se ocultan del selector de pasos: se marcan ' +
      'como "— ⛔ inactivo" en la lista para no asignarlos por error.'
    )
  );

  // ── Sección 6 — De cero a un producto fabricable ────────────────────────
  const step6 = stepSection(6, 'De cero a un producto fabricable', 'El orden en que hay que tener todo listo antes de lanzar una orden',
    stepList([
      '**1)** Crear el producto terminado en **Inventario** (`item_kind` = producto terminado).',
      '**2)** Tener al menos un **centro de trabajo** creado.',
      '**3)** Tener una **receta (BoM) activa** para ese producto.',
      '**4)** Tener una **ruta de producción activa** para ese producto.',
      '**5)** Con eso listo, ya se puede lanzar una **Orden de fabricación** para ese producto.',
    ]) +
    calloutInfo('Si falta la receta o la ruta activas, igual se puede crear la orden — pero sin receta no calcula componentes, y sin ruta no se pueden generar órdenes de trabajo. La pantalla de "Nueva orden" avisa exactamente qué falta.')
  );

  // ── Sección 7 — Órdenes de fabricación (MO) ─────────────────────────────
  const step7 = stepSection(7, 'Órdenes de fabricación (MO)', 'Nace de un producto + su receta y ruta activas — código MO-####',
    stepList([
      'Toca **+ Nueva orden**: elige el **producto terminado** y la **cantidad a planificar**; fechas y nota son opcionales.',
      'Al crear, queda con su código correlativo **MO-####** y en estado 🟡 Planificada.',
      'El detalle muestra un semáforo por componente: **🔴 Sin stock**, **🟡 Insuficiente** o **🟢 Disponible**.',
      'Si hay faltantes, aparece **📤 Solicitar faltantes** (genera un requerimiento con los renglones cortos).',
      'Con receta y ruta activas, **▶️ Iniciar producción** genera las Órdenes de trabajo (una por paso) y pasa la MO a 🟢 En proceso.',
      'Una barra de **% de avance** en el detalle suma en vivo el avance real de sus Órdenes de trabajo.',
      '**🔒 Cerrar orden** registra el consumo de insumos y la entrada del producto terminado en Inventario — es irreversible.',
      '**❌ Cancelar orden** está disponible en cualquier estado que no sea ya cerrada o cancelada.',
    ]) +
    qaTable('Estado de la MO', 'Significado', [
      ['🟡 Planificada / 🔵 Reservada', 'Recién creada, aún no arrancó producción.'],
      ['🟢 En proceso', 'Ya se generaron sus Órdenes de trabajo.'],
      ['✅ Completada', 'Las WOs terminaron su avance; falta cerrarla.'],
      ['🔒 Cerrada', 'Ya se registró el consumo y la entrada del producto — no se puede deshacer.'],
      ['⛔ Cancelada', 'Se canceló antes de cerrarla.'],
    ]) +
    calloutWarn(
      '<b>"📤 Solicitar faltantes" NO va a Compras:</b> el requerimiento que genera aparece en <b>Inventario → pestaña ' +
      '📝 Requerimiento</b> (es la misma tabla/flujo que usa esa pestaña para pedidos manuales). Es un sistema distinto al ' +
      'módulo de Compras aunque el nombre se parezca — revisa ahí, no en Compras, para ver o recibir lo solicitado.'
    ) +
    calloutInfo(
      '<b>Cerrar orden</b> usa el <b>avance REAL</b> de las Órdenes de trabajo (no lo planificado). Si lo producido de verdad ' +
      'queda muy por debajo de lo planificado, pide una <b>segunda confirmación</b> explícita mostrando ambas cifras antes de cerrar. ' +
      'Si tu permiso de Fabricación no incluye escritura en Inventario, ahora sale un aviso claro pidiendo ese permiso, en vez de un error técnico.'
    )
  );

  // ── Sección 8 — Órdenes de trabajo (WO) ─────────────────────────────────
  const step8 = stepSection(8, 'Órdenes de trabajo (WO)', 'Una por paso de la ruta — se generan al iniciar la producción de una MO',
    stepList([
      'Abre una WO de la lista para asignar el **operario** con el buscador.',
      'Botones de estado: **▶️ Iniciar**, **⏸️ Pausar**, **▶️ Reanudar**, **✅ Completar**, **🚫 Cancelar**.',
      '**📦 Registrar cantidad**: suma avance sin pasar la cantidad planificada.',
      '**♻️ Registrar scrap/merma (opcional)**: registra piezas dañadas/perdidas — alimenta el % de Calidad del OEE.',
      '**⚠️ Reportar falla**: describe el motivo y la orden queda 🟸 Pausada.',
      'Si el paso es un punto de control de calidad, hay que **✅ Aprobar** o **❌ Rechazar** antes de poder completar.',
    ]) +
    calloutWarn(
      'El <b>candado de calidad</b> bloquea "✅ Completar" mientras el control de calidad de ese paso siga <b>⏳ pendiente</b> — ' +
      'está blindado también del lado de la base de datos (trigger), así que no se puede saltar aunque falle la validación en pantalla.'
    )
  );

  // ── Sección 9 — Kiosco de planta ─────────────────────────────────────────
  const step9Mock = phoneFrame(
    appBar('🖥️ Kiosco de planta') +
    mockupBody(
      mockupCard(
        '<div style="text-align:center;font-weight:800;color:#1E3A5F;margin-bottom:8px">3. TROQUELADO</div>' +
        '<div style="text-align:center;color:#6b7280;font-size:11px;margin-bottom:10px">MO-0032 · Manguera 3/4"</div>' +
        mockupBtn('▶️ INICIAR', 'success') +
        mockupBtn('⏸️ PAUSAR', 'warn') +
        mockupBtn('🔢 REGISTRAR CANTIDAD', 'primary') +
        mockupBtn('⚠️ REPORTAR FALLA / PARADA', 'danger') +
        mockupBtn('✅ FINALIZAR', 'success')
      )
    )
  );
  const step9 = stepSection(9, 'Kiosco de planta', 'Pantalla táctil para el piso de planta, sin cuenta individual — permiso aparte',
    twoCol(
      stepList([
        'Permiso independiente **fabricacion_planta** ("Fabricación · Kiosco de planta") — no hace falta el permiso de Fabricación completo.',
        '**Paso 1:** elegir el **centro de trabajo**.',
        '**Paso 2:** elegir la **orden de trabajo** (pendiente, en proceso o pausada de ese centro).',
        '**Paso 3:** identificarse (escanear el **carnet** o escribir la **cédula**) y tocar el botón grande de la acción.',
        'Botones grandes: **▶️ INICIAR**, **⏸️ PAUSAR** / **▶️ REANUDAR**, **🔢 REGISTRAR CANTIDAD**, **⚠️ REPORTAR FALLA / PARADA**, **✅ FINALIZAR**.',
      ]),
      step9Mock
    ) +
    calloutWarn(
      'La identificación ahora se pide para <b>toda la sesión de uso</b>, no solo al iniciar: la primera vez que tocas cualquier ' +
      'botón (pausar, registrar cantidad, reportar falla, finalizar) el kiosco pide carnet/cédula UNA vez y usa esa identidad para ' +
      'el resto de acciones de esa sesión. También valida que el <b>cargo</b> del empleado sea operativo y que su <b>empresa</b> ' +
      'coincida con la de la orden.'
    ) +
    calloutInfo(
      'Reportar una falla genera <b>automáticamente</b> una solicitud en Servicio (además de pausar la orden). El candado ' +
      'de calidad también aplica aquí: si el paso tiene control de calidad pendiente, el botón "✅ FINALIZAR" no aparece — el ' +
      'kiosco avisa que hace falta que un supervisor apruebe o rechace la calidad desde oficina.'
    )
  );

  // ── Sección 10 — Reportes de Fabricación ────────────────────────────────
  const step10 = stepSection(10, 'Reportes de Fabricación', 'OEE (disponibilidad × rendimiento × calidad) y costeo por orden',
    stepList([
      'Filtra por **rango de fechas** y, opcionalmente, por **centro de trabajo**.',
      'El panel de **OEE** muestra el % general y su desglose: Disponibilidad, Rendimiento y Calidad.',
      'Debajo, el **costeo por orden** compara el costo **estimado** vs. el **real** de cada MO del período.',
      'Órdenes 🔒 cerradas sin costo real todavía muestran **✏️ Registrar costo real** para cargarlo a mano.',
      'Botón **📄 Exportar PDF** para el reporte completo del período.',
    ]) +
    qaTable('Banda de OEE', 'Qué significa', [
      ['🟢 ≥ 85%', 'Nivel mundo-clase.'],
      ['🟡 60% – 84%', 'Nivel típico, hay margen de mejora.'],
      ['🔴 < 60%', 'Nivel bajo — revisar paradas, merma o ritmo de producción.'],
    ])
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Situaciones frecuentes del módulo de Fabricación',
    rows: [
      ['Faltó un insumo para una orden', 'Abre la MO → **📤 Solicitar faltantes** → revisa en **Inventario → pestaña 📝 Requerimiento** (no en Compras).'],
      ['No puedo activar una receta/ruta nueva', 'Primero pasa la versión activa actual a **⚪ Marcar obsoleta** — solo puede haber una activa por producto.'],
      ['La WO no me deja completar', 'Revisa si el paso tiene un **control de calidad ⏳ pendiente**: hay que **✅ Aprobar** o **❌ Rechazar** primero.'],
      ['Quiero saber qué máquina generó más gasto en mangueras', 'En Mangueras, usa **🚜 Filtro y consulta por equipo** y el reporte **📄 Reporte de confección y pago**.'],
      ['No puedo aprobar el pago de una manguera', 'Revisa que ya esté **🟢 Instalada** — no se puede aprobar el pago si sigue 🟡 En proceso.'],
      ['El kiosco solo me deja ver, no puedo tocar los botones', 'Tu permiso "Fabricación · Kiosco de planta" está en 👁️ lectura — pide escritura o full a un administrador.'],
      ['No tengo acceso al kiosco', 'Pide el permiso **"Fabricación · Kiosco de planta"** (fabricacion_planta) a un administrador — es aparte del permiso de Fabricación.'],
      ['Cerré una MO por error', 'El cierre es irreversible (ya movió inventario) — corrige el efecto con un ajuste manual en Inventario, no hay botón para deshacerlo.'],
      ['Quiero comparar el costo estimado vs. el real de una orden', 'En **Reportes de Fabricación**, sección "💰 Costeo por orden" — carga el real con **✏️ Registrar costo real** si aún falta.'],
      ['¿Cómo sé si el taller está rindiendo bien?', 'Revisa el **OEE** en Reportes: 🟢 ≥85% mundo-clase, 🟡 60-84% típico, 🔴 <60% bajo.'],
    ],
    closingCalloutHtml: calloutInfo(
      '<b>Orden recomendado del maestro:</b> producto en Inventario → centro(s) de trabajo → receta activa → ruta activa → ' +
      'ya se puede lanzar la Orden de fabricación. Recuerda que el <b>Kiosco de planta</b> usa un permiso aparte del resto de Fabricación.'
    ),
    guideTitle: 'Guía de Fabricación (MRP)',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + step4 + step5 + step6 + step7 + step8 + step9 + step10 + summary);
  return await exportGuide(html, 'Guía de Fabricación (MRP) - SOS La Guaira');
}
