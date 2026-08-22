// Guía rápida (PDF descargable) del rol COORDINADOR DE PATIO. Sigue el mismo
// patrón visual/estructural de inspectorGuide.ts — ver guideBuilder.ts.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, qaTable, exportGuide,
  phoneFrame, urlBar, appBar, mockupBody, mockupCard, mockupField, mockupBtn,
  badgeLine, scanBox, arrowDown,
} from './guideBuilder';

export async function generatePatioGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía del Coordinador de Patio',
    subtitle: 'Cómo registrar jornadas, entradas/salidas, gasoil y averías de camiones',
    introCalloutHtml: calloutInfo('🕒 <b>Siempre en dos pasos:</b> primero tocas el botón grande de la acción que vas a hacer, y <b>luego</b> escaneas el QR del camión. El botón que tocaste decide qué se registra.'),
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
  const step1 = stepSection(1, 'Iniciar sesión', 'Con tu usuario o cédula y tu contraseña, desde el teléfono o la PC',
    twoCol(
      stepList([
        'Abre **soslaguaira.com** en el navegador (teléfono o PC).',
        'Escribe tu **usuario o cédula** y tu **contraseña**.',
        'Toca **ENTRAR**.',
        'Caes directo en tu pantalla de **Patio**, con los botones de acciones.',
      ]) + calloutInfo('📱💻 Funciona <b>igual</b> en el teléfono y en la PC: la misma pantalla de Patio con los mismos botones.'),
      step1Mock
    )
  );

  const jornadaMock1 = phoneFrame(
    appBar('🟢 Iniciar jornada') +
    mockupBody(
      mockupCard(
        '<div style="font-weight:800;font-size:11.5px">CAMION VOLTEO TORONTO</div>' +
        '<div style="color:#6b7280;font-size:10px;margin-bottom:8px">🔖 Placa/código escaneado</div>' +
        mockupField('Horómetro inicial (= final de la jornada anterior)', '1240', true) +
        mockupBtn('🟢 Iniciar', 'success')
      )
    )
  );
  const jornadaMock2 = phoneFrame(
    appBar('🏁 Finalizar jornada') +
    mockupBody(
      mockupCard(
        badgeLine('🟢 En curso · desde 7:00 a.m.', 'ok') +
        '<div style="color:#6b7280;font-size:10.5px;margin-bottom:8px">⏱️ Tiempo: 3h 10m</div>' +
        mockupField('Horómetro final', '1246', true) +
        badgeLine('⚙️ Por horómetro: 6 h', 'pend') +
        mockupBtn('Sí, finalizar', 'primary')
      )
    )
  );
  const step2 = stepSection(2, 'Jornada de camión (iniciar / finalizar)', 'Toca 🕒 JORNADA DE CAMIÓN y escanea: el sistema decide solo si inicia o finaliza',
    twoCol(jornadaMock1, jornadaMock2) +
    qaTable('Situación', 'Qué pasa', [
      ['Camión sin jornada abierta hoy', 'Se abre 🟢 **Iniciar jornada**, con el horómetro inicial precargado. Toca **🟢 Iniciar**.'],
      ['Camión con jornada ya abierta', 'Se abre 🏁 **Finalizar jornada**: muestra el tiempo transcurrido y pide el horómetro final. Toca **Sí, finalizar**.'],
      ['Lista "🟢 Camiones en jornada (N)"', 'Debajo del botón: lista en vivo de camiones trabajando, con un atajo **🏁 Finalizar** en cada fila.'],
    ]) +
    calloutWarn('<b>Las horas se calculan por tiempo transcurrido</b> (reloj), no por horómetro — el horómetro solo se muestra como referencia.')
  );

  const step3Mock =
    scanBox('Apunta al QR') + arrowDown() +
    phoneFrame(
      appBar('📷 Entrada / Salida') +
      mockupBody(
        mockupCard(
          '<div style="font-weight:800;font-size:11.5px">CAMION VOLTEO TORONTO</div>' +
          '<div style="color:#6b7280;font-size:10px;margin-bottom:8px">🔖 Código / Placa</div>' +
          mockupBtn('🟢 ENTRADA', 'success') +
          mockupBtn('🟠 SALIDA', 'warn')
        )
      )
    );
  const step3 = stepSection(3, 'Entrada / Salida del patio', 'Registrar la ENTRADA o la SALIDA del camión',
    twoCol(
      stepList([
        'Toca el botón 📷 **ENTRADA / SALIDA**.',
        'Escanea el **QR** del camión.',
        'Revisa el **código/placa** que muestra el modal.',
        'Toca 🟢 **ENTRADA** o 🟠 **SALIDA**, según corresponda.',
      ]),
      step3Mock
    )
  );

  const gasoilMock = phoneFrame(
    appBar('⛽ Surtir gasoil') +
    mockupBody(
      mockupCard(
        badgeLine('Surtido total: 420 L', 'ok') +
        badgeLine('Consumido est.: 380 L', 'pend') +
        mockupField('Horómetro actual', '1246', true) +
        mockupField('Litros surtidos', '40', true) +
        mockupBtn('⛽ Registrar surtido', 'primary')
      )
    )
  );
  const gasoilSteps = stepList([
    'Toca el botón ⛽ **SURTIR GASOIL**.',
    'Escanea el **QR** del camión.',
    'Compara **Surtido total** vs **Consumido est.**',
    'Escribe el **Horómetro actual** y los **Litros surtidos**.',
    'Toca ⛽ **Registrar surtido**.',
  ]);
  const averiaMock = phoneFrame(
    appBar('🛠️ Avería · COD-123') +
    mockupBody(
      mockupCard(
        mockupField('Material', 'Caucho · Aceite · Filtro · Repuesto', true) +
        mockupField('Cantidad (opcional)', '', true) +
        mockupField('Nota (opcional)', '', true) +
        mockupField('📷 Foto de referencia (opcional)', 'Adjuntar', true) +
        mockupBtn('Registrar avería', 'danger')
      )
    )
  );
  const averiaSteps = stepList([
    'Toca el botón 🛠️ **AVERÍA DE MAQUINARIA**.',
    'Escanea el **QR** del camión o máquina.',
    'Elige **al menos un material**: Caucho, Aceite, Filtro o Repuesto.',
    'Completa **Cantidad** y **Nota** si aplica (opcionales).',
    'Agrega una **📷 Foto de referencia** si quieres (opcional).',
    'Toca **Registrar avería**.',
  ]);
  const step4 = stepSection(4, 'Surtir gasoil y avería de maquinaria', 'Dos botones distintos, mismo mecanismo: tocar y luego escanear',
    twoCol(gasoilMock, gasoilSteps) +
    twoCol(averiaSteps, averiaMock) +
    calloutWarn('<b>Avería:</b> no puedes registrar sin elegir <b>al menos un material</b>.')
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Todo desde el teléfono',
    rows: [
      ['Camión sin jornada abierta hoy', 'Toca 🕒 **JORNADA DE CAMIÓN** → escanea → 🟢 **Iniciar**.'],
      ['Camión con jornada ya abierta', 'Toca 🕒 **JORNADA DE CAMIÓN** → escanea → **Sí, finalizar**.'],
      ['El camión entra o sale del patio', 'Toca 📷 **ENTRADA / SALIDA** → escanea → 🟢 **ENTRADA** o 🟠 **SALIDA**.'],
      ['Hay que cargar combustible', 'Toca ⛽ **SURTIR GASOIL** → escanea → horómetro + litros → **⛽ Registrar surtido**.'],
      ['El camión/máquina tiene un daño', 'Toca 🛠️ **AVERÍA DE MAQUINARIA** → escanea → elige material → **Registrar avería**.'],
      ['Marcar entrada/salida de un empleado', 'Toca 🕒 **ASISTENCIA EMPLEADOS** y escanea el carnet.'],
      ['Ver cuántos camiones entraron/salieron por día', 'Card 🚚 **Entrada y salida de camiones** → calendario mensual, **solo lectura**.'],
    ],
    closingCalloutHtml: calloutInfo('<b>Recuerda:</b> primero tocas el botón de la acción, luego escaneas. El calendario de "Entrada y salida de camiones" es solo para <b>consultar</b>, ahí no se registra nada.'),
    guideTitle: 'Guía del Coordinador de Patio',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + step4 + summary);
  return await exportGuide(html, 'Guía del Coordinador de Patio - SOS La Guaira');
}
