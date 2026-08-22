// Guía rápida (PDF descargable) del rol INSPECTOR (`supervisor`). Referencia
// visual/estructural para el resto de guías de rol — ver guideBuilder.ts.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, qaTable, exportGuide,
  phoneFrame, urlBar, appBar, mockupBody, mockupCard, mockupField, mockupBtn,
  mockupRow, badgeLine, scanBox, arrowDown,
} from './guideBuilder';

export async function generateInspectorGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía del Inspector',
    subtitle: 'Cómo trabajar desde el teléfono: iniciar sesión, escanear y la jornada',
    introCalloutHtml: calloutInfo('📱 <b>Desde el teléfono</b>, al iniciar sesión <b>todos</b> caen en el módulo de <b>Inspectores</b> (pantalla 🪖 Revisar). Desde ahí escaneas las máquinas y llevas su jornada.'),
  });

  const step1Mock = phoneFrame(
    urlBar() +
    mockupBody(
      mockupCard(
        '<div style="text-align:center;font-weight:800;color:#1E3A5F;margin-bottom:10px">⛰️ SOS LA GUAIRA</div>' +
        mockupField('Usuario o cédula', '27.514.385', true) +
        mockupField('Contraseña', '••••••••') +
        mockupBtn('ENTRAR', 'primary')
      )
    )
  );
  const step1 = stepSection(1, 'Iniciar sesión', 'Con tu usuario o cédula y tu contraseña',
    twoCol(
      stepList([
        'Abre **soslaguaira.com** en el navegador del teléfono.',
        'Escribe tu **usuario o cédula** y tu **contraseña**.',
        'Toca **ENTRAR**.',
        'Caes directo en tu pantalla de **Inspectores** (🪖 Revisar).',
      ]) + calloutWarn('<b>Importante:</b> solo entran personas registradas por el administrador. Tras <b>3 intentos fallidos</b> el usuario se <b>bloquea</b>.'),
      step1Mock
    )
  );

  const step2Mock =
    scanBox('Apunta al QR') + arrowDown() +
    phoneFrame(
      urlBar() +
      mockupBody(
        '<div style="text-align:center;font-weight:800;color:#1E3A5F;margin-bottom:4px">⛰️ SOS LA GUAIRA</div>' +
        '<div style="text-align:center;color:#6b7280;font-size:11px;margin-bottom:10px">¿Cómo vas a ingresar?</div>' +
        mockupBtn('🔓 INICIAR SESIÓN', 'outline') +
        mockupBtn('🚜 Operadores', 'outlineSuccess')
      )
    );
  const step2 = stepSection(2, 'Escanear el QR de la máquina', 'La forma más rápida: apuntas la cámara al código de la máquina',
    twoCol(
      step2Mock,
      stepList([
        'Con la **cámara del teléfono** escanea el **QR** pegado en la máquina.',
        'Toca 🔓 **INICIAR SESIÓN** e ingresa con tu usuario y contraseña.',
        'Caes **directo** en la ficha de esa máquina (nombre, empresa y serial/placa).',
        'Desde ahí trabajas la jornada (ver **Paso 4**).',
      ]) +
      calloutInfo('🚜 <b>Operadores:</b> ese botón es para el operador que se identifica con su <b>carnet</b> (no usa usuario/contraseña).') +
      calloutWarn('<b>Ojo:</b> "INICIAR SESIÓN" siempre pide usuario y contraseña, aunque ya hubiera una sesión abierta (así queda quién entró).')
    )
  );

  const step3Mock = phoneFrame(
    appBar('🪖 Revisar', 'Salir') +
    mockupBody(
      mockupCard(
        '<div style="font-weight:800;color:#1E3A5F;margin-bottom:2px">🪖 Mi ronda de hoy</div>' +
        '<div style="color:#6b7280;font-size:10.5px;margin-bottom:8px">Revisadas hoy: 0</div>' +
        mockupBtn('📷 ESCANEAR QR', 'primary') +
        mockupField('', 'Buscar por nombre, serial/placa…', true) +
        mockupRow('CAMION VOLTEO TORONTO', 'Serial 69TBA0 · ⏳ Pendiente')
      )
    )
  );
  const step3 = stepSection(3, 'Forma manual (sin escanear)', 'Buscas la máquina en la lista desde tu pantalla de Inspectores',
    twoCol(
      stepList([
        'En 🪖 **Revisar** usa el botón grande 📷 **ESCANEAR QR**, o el buscador.',
        'Busca por **nombre, serial/placa o empresa**.',
        '**Toca** la máquina de la lista para abrir su ficha.',
        'Continúa con **INICIAR / FINALIZAR JORNADA** o **PARADA**.',
      ]) + calloutInfo('<b>Verde = revisada.</b> Regla: si una máquina trabajó y <b>nadie la marcó</b>, esa jornada queda <b>sin validar</b> y el operador no cobra.'),
      step3Mock
    )
  );

  const jornadaMock1 = phoneFrame(
    appBar('✅ Revisé la máquina') +
    mockupBody(
      mockupCard(
        '<div style="font-weight:800;font-size:11.5px">CAMION VOLTEO TORONTO</div>' +
        '<div style="color:#6b7280;font-size:10px;margin-bottom:8px">🏢 Empresa · 🔖 Serial: 69TBA0</div>' +
        mockupField('Horómetro inicial (= final anterior)', '1006', true) +
        mockupBtn('🟢 INICIAR JORNADA', 'success') +
        mockupBtn('🟡 PARADA (avería)', 'warn')
      )
    )
  );
  const jornadaMock2 = phoneFrame(
    appBar('Jornada en curso') +
    mockupBody(
      mockupCard(
        badgeLine('🟢 En curso · desde 8:00 a.m.', 'ok') +
        '<div style="color:#6b7280;font-size:10.5px;margin-bottom:8px">⏱️ Tiempo: 2h 35m</div>' +
        mockupField('Horómetro final', '1012', true) +
        badgeLine('⚙️ Por horómetro: 6 h', 'pend') +
        mockupBtn('🏁 FINALIZAR JORNADA', 'primary')
      )
    )
  );
  const step4 = stepSection(4, 'Trabajar la jornada', 'Iniciar → Finalizar (cuenta horas y horómetro) · o Parada',
    twoCol(jornadaMock1, jornadaMock2) +
    calloutWarn('<b>Regla del horómetro:</b> el <b>final</b> de una jornada será el <b>inicial</b> de la próxima (viene precargado). El final no puede ser menor que el inicial.') +
    qaTable('Botón', 'Qué hace', [
      ['🟢 INICIAR', 'Pide el **horómetro inicial** (precargado), guarda la hora y marca la máquina en Inspecciones.'],
      ['🏁 FINALIZAR', 'Confirma el **total de horas** y pide el **horómetro final**. Las horas van a Control.'],
      ['🟡 PARADA', 'Pide el **motivo** y crea la **avería** (Servicio + Inspecciones).'],
    ])
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Todo desde el teléfono',
    rows: [
      ['La máquina tiene su QR pegado', '**Escanéalo** → INICIAR SESIÓN → ficha de la máquina.'],
      ['No hay QR o prefieres buscarla', 'Entra normal → busca por **nombre/serial/placa** y tócala.'],
      ['La máquina está trabajando', '🟢 **INICIAR JORNADA** (pon el horómetro).'],
      ['Terminó el turno', '🏁 **FINALIZAR JORNADA** (confirma horas + horómetro final).'],
      ['La máquina está dañada/parada', '🟡 **PARADA** y escribe el motivo (crea la avería).'],
    ],
    closingCalloutHtml: calloutInfo('<b>Recuerda:</b> marca <b>todas</b> las máquinas que trabajen. Si no las marcas, la jornada queda <b>sin validar</b>.'),
    guideTitle: 'Guía del Inspector',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + step4 + summary);
  return await exportGuide(html, 'Guía del Inspector - SOS La Guaira');
}
