// Guía rápida (PDF descargable) del rol SUPERVISOR EXTERNO DE OBRAS PÚBLICAS
// (vista de teléfono). Mismo patrón visual que patioGuide.ts — ver guideBuilder.ts.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, qaTable, exportGuide,
  phoneFrame, urlBar, appBar, mockupBody, mockupCard, mockupField, mockupBtn,
  badgeLine,
} from './guideBuilder';

export async function generateObrasPublicasGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía de Obras Públicas',
    subtitle: 'Cómo llevar tus máquinas, la jornada y el reporte de m³ por edificio desde el teléfono',
    introCalloutHtml: calloutInfo('🏛️ <b>Tu vista es independiente:</b> ves y manejas SOLO tus máquinas asignadas. Nada de lo que hagas aquí toca el módulo de inspectores — es tu propio módulo de Obras Públicas.'),
  });

  const loginMock = phoneFrame(
    urlBar() +
    mockupBody(
      mockupCard(
        '<div style="text-align:center;font-weight:800;color:#1E3A5F;margin-bottom:10px">🏛️ SOS LA GUAIRA</div>' +
        mockupField('Usuario o cédula', 'maria.lopez', true) +
        mockupField('Contraseña', '••••••••') +
        mockupBtn('ENTRAR', 'primary')
      )
    )
  );
  const step1 = stepSection(1, 'Iniciar sesión', 'Con tu usuario o cédula y tu contraseña, desde el teléfono o la PC',
    twoCol(
      stepList([
        'Abre **soslaguaira.com** en el navegador.',
        'Escribe tu **usuario o cédula** y tu **contraseña**.',
        'Toca **ENTRAR**.',
        'Caes directo en **🏛️ Mis máquinas · Obras Públicas**, con las tarjetas resumen arriba.',
      ]) + calloutInfo('📊 Arriba ves las tarjetas: <b>Máquinas asignadas</b>, <b>Trabajando ahora</b>, <b>Averiadas/Paradas</b>, <b>m³ del día</b> y <b>Edificios hoy</b>.'),
      loginMock
    )
  );

  const maquinaMock = phoneFrame(
    appBar('🚜 CARGADOR 320') +
    mockupBody(
      mockupCard(
        '<div style="color:#6b7280;font-size:10.5px;margin-bottom:6px">Dejar constancia de la visita (con tu ubicación)</div>' +
        '<div style="display:flex;gap:4px;margin-bottom:8px">' +
          '<div style="flex:1;text-align:center;border:1px solid #d1d5db;border-radius:8px;padding:6px;font-size:10.5px">🟢 Trabajando</div>' +
          '<div style="flex:1;text-align:center;border:1px solid #d1d5db;border-radius:8px;padding:6px;font-size:10.5px">🟡 Parada</div>' +
          '<div style="flex:1;text-align:center;border:1px solid #d1d5db;border-radius:8px;padding:6px;font-size:10.5px">⚪ No está</div>' +
        '</div>' +
        mockupBtn('▶️ Iniciar jornada', 'success')
      )
    )
  );
  const step2 = stepSection(2, 'Visita y jornada de una máquina', 'Toca una máquina de tu lista para abrir su ficha',
    twoCol(
      stepList([
        'Toca una **máquina** de la lista.',
        'Deja la **visita** con tu ubicación: **🟢 Trabajando**, **🟡 Parada** o **⚪ No está**.',
        'Toca **▶️ Iniciar jornada** cuando la máquina arranca.',
        'Al terminar, vuelve a abrirla y toca **⏹️ Finalizar jornada**.',
      ]),
      maquinaMock
    ) +
    calloutInfo('⏱️ Las horas se cuentan por <b>tiempo</b> (de que inicias a que finalizas). Lo que quede abierto se cierra solo al fin del turno.')
  );

  const paradaMock = phoneFrame(
    appBar('🚜 CARGADOR 320') +
    mockupBody(
      mockupCard(
        '<div style="display:flex;gap:4px;margin-bottom:6px">' +
          '<div style="flex:1;text-align:center;background:#8A6A00;color:#fff;border-radius:8px;padding:6px;font-size:10.5px;font-weight:700">🔧 Por avería</div>' +
          '<div style="flex:1;text-align:center;border:1px solid #E5C766;border-radius:8px;padding:6px;font-size:10.5px">📍 No trabajó</div>' +
        '</div>' +
        mockupField('Falla (obligatorio)', 'Manguera hidráulica rota', true) +
        mockupBtn('🟡 Confirmar parada', 'warn') +
        mockupBtn('🟢 Poner operativa (quitar avería/parada)', 'success')
      )
    )
  );
  const step3 = stepSection(3, 'Parada, avería y ubicación', 'Cuando la máquina no trabaja, o para quitarle la avería',
    twoCol(
      stepList([
        'En la ficha, elige **🔧 Por avería** (con material y **falla obligatoria**) o **📍 No trabajó** (con el motivo).',
        'Toca **🟡 Confirmar parada** — las horas ya trabajadas quedan guardadas.',
        'Para volverla a poner a trabajar, toca **🟢 Poner operativa (quitar avería/parada)**.',
        'Toca **📍 Actualizar ubicación (mapa)** para fijar dónde está (se ve en el mapa).',
      ]),
      paradaMock
    ) +
    calloutWarn('Una máquina <b>no</b> puede estar averiada y trabajando a la vez: al iniciar jornada se le quita la avería/parada automáticamente.')
  );

  const removidosMock = phoneFrame(
    appBar('⛰️ Removidos hoy · por edificio') +
    mockupBody(
      mockupCard(
        badgeLine('M³ REMOVIDOS HOY: 223 m³', 'ok') +
        '<div style="color:#6b7280;font-size:10px;margin:6px 0 2px">📍 El Palmar</div>' +
        '<div style="border:1px solid #F2B705;border-radius:8px;padding:6px;font-size:10.5px;font-weight:700">🏢 Edificio Sol · <span style="float:right">120 m³</span></div>' +
        '<div style="color:#2563EB;font-size:10px;margin-top:6px">▾ Detalle ✓</div>'
      )
    )
  );
  const step4 = stepSection(4, 'm³ removidos por edificio (+ detalle)', 'El botón ⛰️ Removidos hoy · por edificio (arriba de la lista)',
    twoCol(
      stepList([
        'Toca **⛰️ Removidos hoy · por edificio**.',
        'Busca el **edificio** (están agrupados por sub-sector) y escribe sus **m³ removidos hoy**.',
        'La **1ª vez** de un edificio, escribe también su **m³ acumulados (base)**; después el acumulado crece solo.',
        'Abre **▾ Detalle** (opcional): m³ acarreados, viajes, **maquinaria en uso / inoperativa**, **por requerimiento** (marca tus máquinas con ✓, o **➕ añade una externa**), cuerpos, actividades y **✅ frente entregado**.',
        'Toca **✅ Guardar**.',
      ]),
      removidosMock
    ) +
    calloutInfo('➕ <b>Máquina externa:</b> en "por requerimiento" puedes agregar máquinas que <b>no</b> están en el catálogo (equipos externos) — quedan como check para marcarlas.')
  );

  const step5 = stepSection(5, 'Enviar el reporte por WhatsApp', 'Desde el mismo módulo de removidos',
    twoCol(
      stepList([
        'Primero **guarda** los m³ y el detalle del día.',
        'Toca **📤 Enviar reporte por WhatsApp**.',
        'Se abre WhatsApp con el **texto del reporte del día** por edificio (con totales) listo para enviar.',
      ]),
      calloutInfo('El reporte usa lo que ya está <b>guardado</b>, agrupado por sub-sector, con solo las líneas que tienen dato y los <b>totales del día</b> al final.')
    )
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Todo desde tu teléfono',
    rows: [
      ['Ver tus máquinas', 'Entras y caes en **🏛️ Mis máquinas**; arriba las tarjetas resumen.'],
      ['La máquina arranca', 'Ábrela → visita **🟢 Trabajando** → **▶️ Iniciar jornada**.'],
      ['La máquina termina', 'Ábrela → **⏹️ Finalizar jornada**.'],
      ['La máquina no trabaja / se dañó', '**🔧 Por avería** o **📍 No trabajó** → **🟡 Confirmar parada**.'],
      ['Volver a ponerla a trabajar', '**🟢 Poner operativa (quitar avería/parada)**.'],
      ['Cargar los m³ del día', '**⛰️ Removidos hoy · por edificio** → m³ por edificio → **✅ Guardar**.'],
      ['Detalle del reporte', 'En cada edificio **▾ Detalle** (acarreo, maquinaria, cuerpos, actividades…).'],
      ['Mandar el reporte', '**📤 Enviar reporte por WhatsApp**.'],
    ],
    closingCalloutHtml: calloutInfo('<b>Recuerda:</b> tu módulo es aparte del de inspectores. Guarda siempre antes de enviar el reporte por WhatsApp.'),
    guideTitle: 'Guía de Obras Públicas',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + step4 + step5 + summary);
  return await exportGuide(html, 'Guía de Obras Públicas - SOS La Guaira');
}
