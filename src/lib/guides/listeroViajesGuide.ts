// Guía rápida (PDF descargable) del módulo VIAJES DE CAMIONES, para el
// LISTERO (permiso `viajes_camiones`, nivel escritura). No hay un rol/panel
// propio: se entra por Más → 🚛 Viajes de camiones, igual que Asistencia de
// camiones — mismo patrón visual/estructural que analistaGuide.ts /
// coordinadorOperadoresGuide.ts — ver guideBuilder.ts.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, qaTable, exportGuide,
  phoneFrame, urlBar, appBar, mockupBody, mockupCard, mockupField, mockupBtn, mockupRow,
  badgeLine,
} from './guideBuilder';

export async function generateListeroViajesGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía del Listero de Camiones',
    subtitle: 'Registrar cada viaje del camión, en un solo toque',
    introCalloutHtml: calloutInfo('📱💻 Entra con tu <b>usuario y contraseña</b>, como siempre, y ve a <b>Más → 🚛 Viajes de camiones</b>. No hay una pantalla especial para el listero: es un módulo más dentro de "Más".'),
  });

  const step1Mock = phoneFrame(
    urlBar() +
    mockupBody(
      mockupCard(
        '<div style="font-weight:800;font-size:11.5px">🚛 Viajes de camiones</div>' +
        '<div style="color:#6b7280;font-size:10px;margin-bottom:6px">Hoy · 14 viajes registrados</div>' +
        mockupRow('COD-123 · Camión Volteo Toronto', '✅ Operativa · 5 viajes hoy') +
        mockupRow('COD-118 · Chuto con Volqueta', '🔴 Averiada · 2 viajes hoy')
      )
    )
  );
  const step1 = stepSection(1, '¿Qué es esta pantalla?', 'Un viaje = cada vez que el camión REGRESA o ENTRA',
    twoCol(
      stepList([
        'Sirve para llevar la cuenta de **cuántos viajes** hace cada camión en el día.',
        'Cada vez que un camión **vuelve o entra** (por ejemplo, después de vaciar su carga), tú registras "**un viaje**".',
        'No hace falta escribir de dónde venía ni para dónde iba — **solo que hizo el viaje**.',
        'El **chofer** que va manejando se toma solo (el que está asignado a ese camión en ese turno) — tú no lo escribes.',
      ]),
      step1Mock
    )
  );

  const step2Mock = phoneFrame(
    urlBar() +
    mockupBody(
      mockupField('🔎 Buscar camión (placa o código)', 'COD', true) +
      mockupCard(
        mockupRow('COD-123 · Camión Volteo Toronto', '✅ Operativa') +
        mockupRow('COD-118 · Chuto con Volqueta', '🔴 Averiada') +
        mockupRow('COD-091 · Camión Volteo Toronto', '🟡 Parada')
      )
    )
  );
  const step2 = stepSection(2, 'Buscar el camión y leer su estado', 'Escribe la placa o el código y toca el camión de la lista',
    twoCol(
      stepList([
        'Escribe en el buscador la **placa o el código** del camión (no hace falta el nombre completo).',
        'Toca el camión en la lista para abrirlo.',
        'Junto al nombre del camión verás un **ícono de estado** — revisa la tabla al lado.',
      ]),
      step2Mock
    ) +
    qaTable('Ícono', 'Qué significa', [
      ['✅ Operativa', 'El camión está trabajando normal, sin novedad.'],
      ['🔴 Averiada', 'Tiene una avería reportada.'],
      ['🟡 Parada', 'Está parada (sin avería reportada).'],
      ['⏳ Esperando instrucciones', 'Aún no se decidió si va operativa o no.'],
      ['⬛ Retirada', 'Fue sacada de servicio — no debería tener viajes nuevos.'],
    ]) +
    calloutWarn('Si al abrir el camión sale un aviso de que está 🔴 <b>averiado</b> o 🟡 <b>parado</b>, es <b>solo un aviso</b> — igual puedes registrar el viaje con normalidad. Si ves ⬛ <b>Retirada</b> y de verdad hizo un viaje, avísale a tu jefa.')
  );

  const step3BeforeMock = phoneFrame(
    appBar('🚛 COD-123 · Camión Volteo Toronto') +
    mockupBody(
      mockupCard(
        badgeLine('🔴 Averiada · solo aviso', 'pend') +
        '<div style="font-size:10.5px;color:#374151;margin:6px 0">Chofer de turno: J. Ramírez · ☀️ Día</div>' +
        mockupBtn('🚛 Registrar viaje', 'primary') +
        '<div style="text-align:center;color:#9CA3AF;font-size:9.5px;margin-top:4px">La hora se pone sola</div>'
      )
    )
  );
  const step3AfterMock = phoneFrame(
    appBar('🚛 COD-123 · Camión Volteo Toronto') +
    mockupBody(
      mockupCard(
        badgeLine('✅ Viaje registrado · 10:42 a.m.', 'ok') +
        '<div style="font-size:10.5px;color:#374151;margin-top:6px">Ya puedes buscar el próximo camión.</div>'
      )
    )
  );
  const step3 = stepSection(3, 'Registrar el viaje', 'Un solo botón — la hora se pone sola, no hay que escribirla',
    twoCol(step3BeforeMock, step3AfterMock) +
    stepList([
      'Dentro del camión, toca el botón grande 🚛 **Registrar viaje**.',
      'Listo — no hay que llenar más campos ni escribir la hora, queda registrada al instante.',
      'La pantalla te confirma con "✅ Viaje registrado" y la hora exacta.',
    ]) +
    calloutInfo('📶 <b>¿Sin señal?</b> No pasa nada: el viaje se guarda igual en tu teléfono y se sube solo apenas vuelva la señal. No hace falta hacer nada especial ni volver a registrarlo.')
  );

  const step4Mock = phoneFrame(
    appBar('📋 Mis viajes de hoy') +
    mockupBody(
      mockupCard(
        mockupRow('COD-123 · 10:42 a.m.', '☀️ Día · ✎ Corregir hora') +
        mockupRow('COD-118 · 1:15 p.m.', '☀️ Día · ✎ Corregir hora')
      )
    )
  );
  const step4 = stepSection(4, 'Corregir un viaje tuyo', 'Solo la hora, y solo mientras tu jornada siga abierta',
    twoCol(
      stepList([
        'Abre **"Mis viajes de hoy"** para ver los que ya registraste.',
        'Toca ✎ **Corregir hora** en el viaje que quieras ajustar.',
        'Solo puedes cambiar la **hora** — y solo mientras tu **jornada del día siga abierta**.',
      ]),
      step4Mock
    ) +
    calloutWarn('<b>No puedes borrar un viaje.</b> Si te equivocaste de <b>camión</b> (no de hora), no lo corrijas tú: avísale a tu jefa para que lo corrija o lo borre.')
  );

  const step5 = stepSection(5, 'Nota para la jefa o administración', 'Solo si tienes el permiso Full del módulo "Registro de viajes (camiones)"',
    calloutInfo('Esto es solo para tu conocimiento — no hace falta explicárselo a los listeros, ellos solo ven lo de los pasos anteriores.') +
    stepList([
      'Puedes ver **todos los viajes de todos los listeros**, no solo los tuyos.',
      'Puedes filtrar **por listero individual** para revisar su día.',
      'Tienes un **resumen y metas de viajes por camión** (cuántos debería hacer cada uno).',
      'Puedes **corregir o borrar cualquier viaje** — no solo la hora, como el listero.',
      'Puedes ajustar la **alerta de "camión sin viajes"** (cada cuántas horas sin registrar uno se avisa).',
    ])
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Todo desde el teléfono',
    rows: [
      ['Vas a registrar un viaje', 'Busca el camión (placa o código) → tócalo → 🚛 **Registrar viaje**. La hora queda sola.'],
      ['El camión sale 🔴 averiado o 🟡 parado', 'Es solo un aviso — igual puedes registrar el viaje.'],
      ['No hay señal', 'Se guarda igual en tu teléfono y sube solo cuando vuelva la señal.'],
      ['Te equivocaste de HORA', '"Mis viajes de hoy" → ✎ **Corregir hora**, mientras tu jornada siga abierta.'],
      ['Te equivocaste de CAMIÓN', 'No lo puedes corregir ni borrar tú — avísale a tu jefa.'],
      ['Eres la jefa/admin (permiso Full)', 'Ves todos los viajes por listero, con metas por camión; corriges/borras cualquiera y ajustas la alerta de "sin viajes".'],
    ],
    closingCalloutHtml: calloutInfo('<b>Recuerda:</b> un viaje = un regreso o entrada del camión. No hace falta escribir de dónde venía ni para dónde iba — solo toca el botón cuando el camión llegue.'),
    guideTitle: 'Guía del Listero de Camiones',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + step4 + step5 + summary);
  return await exportGuide(html, 'Guía del Listero de Camiones - SOS La Guaira');
}
