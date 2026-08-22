// Guía rápida (PDF descargable) del rol COCINA. Sigue el mismo patrón visual
// y estructural que inspectorGuide.ts — ver guideBuilder.ts.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, exportGuide,
  phoneFrame, urlBar, appBar, mockupBody, mockupCard, mockupField, mockupBtn,
  scanBox, arrowDown,
} from './guideBuilder';

export async function generateCocinaGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía de Cocina',
    subtitle: 'Cómo verificarte y entregar comidas desde el teléfono',
    introCalloutHtml: calloutInfo('🍽️ <b>Desde el teléfono</b>, al iniciar sesión caes <b>directo</b> en tu pantalla de <b>Cocina</b>. Ahí te verificas y entregas las comidas.'),
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
        'Caes directo en tu pantalla de **Cocina**.',
      ]) + calloutInfo('📇 <b>Escaneo a mitad de sesión:</b> si escaneas el carnet de un empleado en cualquier momento, se abre directo su ficha.'),
      step1Mock
    )
  );

  const step2Mock = phoneFrame(
    appBar('🍽️ Cocina') +
    mockupBody(
      mockupCard(
        '<div style="font-weight:800;color:#1E3A5F;margin-bottom:8px">🔒 Verifícate para repartir</div>' +
        mockupBtn('📷 Escanear mi carnet', 'primary') +
        mockupField('Cédula', 'Escribe tu cédula…', true) +
        mockupBtn('Verificar', 'outline')
      ) +
      arrowDown() +
      mockupCard(
        '<div style="font-weight:800;color:#111827;margin-bottom:4px">👨‍🍳 Juan Pérez</div>' +
        mockupBtn('Cambiar', 'ghost')
      )
    )
  );
  const step2 = stepSection(2, 'Verifícate antes de repartir', 'Es el primer paso, obligatorio antes de entregar cualquier comida',
    twoCol(
      stepList([
        'En la tarjeta 🔒 **Verifícate para repartir**, toca 📷 **Escanear mi carnet**.',
        'O escribe tu **cédula** y toca **Verificar**.',
        'Solo pasan cargos de **cocina, cocinero o alimentación**.',
        'Verificado, ves tu tarjeta 👨‍🍳 **{tu nombre}** con un botón **Cambiar** por si te equivocaste de persona.',
      ]) + calloutWarn('<b>Sin verificarte primero, no puedes registrar ninguna comida.</b>'),
      step2Mock
    )
  );

  const step3Mock =
    phoneFrame(
      appBar('🍽️ Cocina') +
      mockupBody(
        mockupCard(
          '<div style="font-weight:800;color:#1E3A5F;margin-bottom:8px">🍽️ Entregar comida</div>' +
          mockupBtn('⚡ Torniquete', 'primary') +
          mockupBtn('🖐 Elegir por persona', 'outline') +
          '<div style="display:flex;gap:6px;margin:8px 0">' +
          mockupBtn('Desayuno', 'outline') +
          mockupBtn('Almuerzo', 'success') +
          mockupBtn('Cena', 'outline') +
          '</div>' +
          '<div style="color:#6b7280;font-size:10.5px;margin-bottom:8px">Sirviendo: Almuerzo · Entregadas en esta sesión: 12</div>' +
          mockupBtn('📷 Escanear carnet — entregar ALMUERZO', 'primary')
        )
      )
    );
  const step3 = stepSection(3, 'Entrega rápida (Torniquete)', 'El modo por defecto: comida fija para todos, escaneo tras escaneo',
    twoCol(
      stepList([
        'El modo **⚡ Torniquete** viene activado por defecto.',
        'Elige la comida que se está sirviendo con los chips **Desayuno / Almuerzo / Cena**.',
        'Verás **Sirviendo: X** y **Entregadas en esta sesión: N**.',
        'Toca 📷 **Escanear carnet — entregar {comida}**: cada escaneo registra esa comida automáticamente.',
      ]) +
      calloutInfo('🕒 El sistema <b>sugiere</b> la comida según la hora (antes de 11:00 desayuno, antes de 16:00 almuerzo, si no cena), pero puedes cambiarla con los chips.') +
      calloutWarn('Cada comida se entrega <b>una sola vez por persona por día</b>. Si repites el escaneo, aparece un aviso ⚠️ de duplicado.'),
      step3Mock
    )
  );

  const step4Mock = phoneFrame(
    appBar('👤 Ficha') +
    mockupBody(
      mockupCard(
        '<div style="font-weight:800;font-size:11.5px">María Rodríguez</div>' +
        '<div style="color:#6b7280;font-size:10px;margin-bottom:8px">🪪 Obrera · 🔖 V-19.885.221 · 🏢 Empresa</div>'
      ) +
      mockupCard(
        '<div style="font-weight:700;font-size:11px;color:#111827;margin-bottom:6px">Marca la comida que se le entrega (1 vez por día cada una)</div>' +
        mockupBtn('Desayuno ✅ 7:32 a.m.', 'ghost') +
        mockupBtn('Almuerzo', 'success') +
        mockupBtn('Cena', 'outline')
      ) +
      mockupBtn('← Escanear otra persona', 'outline')
    )
  );
  const step4 = stepSection(4, 'Elegir por persona (fuera de horario)', 'Para casos que no siguen el horario fijo, ej. almuerzo a las 4pm',
    twoCol(
      step4Mock,
      stepList([
        'Toca 🖐 **Elegir por persona** en la tarjeta 🍽️ **Entregar comida**.',
        'Toca 📷 **Escanear carnet — elegir comida**.',
        'Se abre la ficha: **foto, nombre, cargo, cédula y empresa**.',
        'Toca la comida a entregar (**Desayuno / Almuerzo / Cena**); si ya la recibió, se ve **✅ {hora}** y queda deshabilitada.',
        'Toca **← Escanear otra persona** para reiniciar.',
      ])
    )
  );

  const step5Mock =
    phoneFrame(
      appBar('🍽️ Cocina') +
      mockupBody(
        mockupCard(
          '<div style="color:#6b7280;font-size:11px;margin-bottom:6px">¿No lee el carnet? Busca por cédula</div>' +
          mockupField('Cédula', 'Escribe la cédula…', true) +
          mockupBtn('Entregar', 'primary')
        )
      )
    ) + arrowDown() + scanBox('QR de empresa → registro masivo');
  const step5 = stepSection(5, 'El carnet no lee o es de una empresa', 'Búsqueda manual y escaneo de QR de empresa',
    twoCol(
      stepList([
        '¿No lee el carnet? Escribe la **cédula** en el campo y toca **Entregar** (Torniquete) o **Abrir** (Elegir por persona).',
        'Si escaneas el **QR de una empresa** (no de una persona), se abre el **registro masivo de comidas** de esa empresa en otra pantalla.',
      ]),
      step5Mock
    )
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Todo desde el teléfono',
    rows: [
      ['Primera vez, aún no te verificas', '🔒 **Verifícate para repartir**: escanea tu carnet o escribe tu cédula.'],
      ['Entrega normal, dentro de horario', 'Modo ⚡ **Torniquete**: elige la comida y **escanea carnet** por cada persona.'],
      ['Alguien llega fuera de horario', 'Cambia a 🖐 **Elegir por persona** y marca la comida manualmente en su ficha.'],
      ['El carnet no lee', 'Busca por **cédula** en el campo y toca **Entregar**/**Abrir**.'],
      ['Escaneaste el QR de una empresa', 'Se abre el **registro masivo** de comidas de esa empresa, no una ficha personal.'],
    ],
    closingCalloutHtml: calloutInfo('<b>Recuerda:</b> sin verificarte primero no puedes registrar comidas, y cada comida solo se entrega <b>una vez por persona por día</b>.'),
    guideTitle: 'Guía de Cocina',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + step4 + step5 + summary);
  return await exportGuide(html, 'Guía de Cocina - SOS La Guaira');
}
