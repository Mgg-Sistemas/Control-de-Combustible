// Guía rápida (PDF descargable) del rol COORDINADOR QR (panel_type 'coordinador_qr').
// Sigue el patrón visual/estructural de inspectorGuide.ts — ver guideBuilder.ts.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, exportGuide,
  phoneFrame, urlBar, appBar, mockupBody, mockupCard, mockupField, mockupBtn,
  scanBox, arrowDown,
} from './guideBuilder';

export async function generateCoordinadorQrGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía del Coordinador QR',
    subtitle: 'Surtir gasoil, reportar averías y marcar máquinas listas escaneando su QR',
    introCalloutHtml: calloutInfo('📱 Al iniciar sesión caes directo en tu <b>panel</b> con 3 botones. La mecánica es siempre igual: <b>primero tocas el botón</b> de la acción y <b>luego escaneas el QR</b> de la máquina.'),
  });

  const step1Mock =
    scanBox('Apunta al QR') + arrowDown() +
    phoneFrame(
      urlBar() +
      mockupBody(
        mockupCard(
          '<div style="text-align:center;font-weight:800;color:#1E3A5F;margin-bottom:8px">⛽ Surtir gasoil</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:8px">' +
            '<div style="flex:1;text-align:center"><div style="font-size:9.5px;color:#6b7280">Surtido total</div><div style="font-weight:800;font-size:13px;color:#111827">420 L</div></div>' +
            '<div style="flex:1;text-align:center"><div style="font-size:9.5px;color:#6b7280">Consumido est.</div><div style="font-weight:800;font-size:13px;color:#111827">385 L</div></div>' +
          '</div>' +
          mockupField('Horómetro actual', '1240', true) +
          mockupField('Litros surtidos', '30', true) +
          mockupBtn('⛽ Registrar surtido', 'success')
        )
      )
    );
  const step1 = stepSection(1, '⛽ SURTIR GASOIL', 'Horómetro + litros (surtido vs consumido)',
    twoCol(
      stepList([
        'Toca el botón **⛽ SURTIR GASOIL** (primero el botón, luego el QR).',
        '**Escanea el QR** de la máquina con la cámara del teléfono.',
        'Revisa arriba **Surtido total** vs **Consumido est.** de esa máquina.',
        'Escribe el **Horómetro actual** y los **Litros surtidos**.',
        'Toca **⛽ Registrar surtido** para guardar.',
      ]),
      step1Mock
    )
  );

  const step2Mock = phoneFrame(
    urlBar() +
    mockupBody(
      mockupCard(
        '<div style="text-align:center;font-weight:800;color:#1E3A5F;margin-bottom:6px">🛠️ Avería · MAQ-014</div>' +
        '<div style="color:#6b7280;font-size:10.5px;margin-bottom:4px">¿Qué necesita?</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">' +
          '<div style="background:#1E3A5F;color:#fff;font-weight:700;font-size:10px;border-radius:999px;padding:5px 10px">🛞 Caucho</div>' +
          '<div style="border:1px solid #D1D5DB;color:#374151;font-weight:700;font-size:10px;border-radius:999px;padding:5px 10px">🛢️ Aceite</div>' +
          '<div style="border:1px solid #D1D5DB;color:#374151;font-weight:700;font-size:10px;border-radius:999px;padding:5px 10px">🧴 Filtro</div>' +
          '<div style="border:1px solid #D1D5DB;color:#374151;font-weight:700;font-size:10px;border-radius:999px;padding:5px 10px">🔩 Repuesto</div>' +
        '</div>' +
        mockupField('Cantidad (opcional)', 'Ej: 2', true) +
        mockupField('Nota (opcional)', 'Detalle de la falla', true) +
        mockupBtn('📷 Foto de referencia (opcional)', 'outline') +
        mockupBtn('Registrar avería', 'warn')
      )
    )
  );
  const step2 = stepSection(2, '🛠️ AVERÍA DE MAQUINARIA', 'Reportar una falla (va a Mantenimiento)',
    twoCol(
      step2Mock,
      stepList([
        'Toca **🛠️ AVERÍA DE MAQUINARIA** y luego **escanea el QR** de la máquina.',
        'Elige **al menos un material**: Caucho, Aceite, Filtro o Repuesto.',
        'Si quieres, agrega **Cantidad** y una **Nota** (ambos opcionales).',
        'Puedes adjuntar **📷 Foto de referencia** (opcional).',
        'Toca **Registrar avería**: el reporte va a **Mantenimiento**.',
      ]) + calloutWarn('<b>Obligatorio:</b> el botón "Registrar avería" no se activa hasta elegir <b>al menos un material</b>.')
    )
  );

  const step3Mock = phoneFrame(
    urlBar() +
    mockupBody(
      mockupCard(
        '<div style="text-align:center;font-weight:800;color:#1E3A5F;margin-bottom:8px">✅ MAQ-014</div>' +
        '<div style="text-align:center;color:#6b7280;font-size:11px;margin-bottom:10px">¿Marcar esta máquina como LISTA? Se cerrarán sus averías pendientes y volverá a Operativa.</div>' +
        mockupBtn('Sí, marcar lista', 'primary') +
        mockupBtn('Cancelar', 'ghost')
      )
    )
  );
  const step3 = stepSection(3, '✅ MÁQUINA LISTA', 'Cierra sus averías y la vuelve Operativa',
    twoCol(
      stepList([
        'Toca **✅ MÁQUINA LISTA** y luego **escanea el QR** de la máquina.',
        'Lee la confirmación y toca **Sí, marcar lista**.',
        '**Todas** sus averías pendientes se cierran de una sola vez.',
        'La máquina vuelve a quedar **Operativa**.',
      ]) + calloutWarn('<b>Acción masiva:</b> "MÁQUINA LISTA" cierra <b>todas</b> las averías pendientes de esa máquina a la vez — no se elige cuál cerrar.'),
      step3Mock
    )
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Todo desde el teléfono',
    rows: [
      ['Vas a cargar combustible a una máquina', 'Toca **⛽ SURTIR GASOIL** → escanea el QR → horómetro + litros → **Registrar surtido**.'],
      ['La máquina tiene una falla', 'Toca **🛠️ AVERÍA DE MAQUINARIA** → escanea el QR → elige material → **Registrar avería**.'],
      ['Ya arreglaron la máquina', 'Toca **✅ MÁQUINA LISTA** → escanea el QR → **Sí, marcar lista** (cierra todas sus averías).'],
    ],
    closingCalloutHtml: calloutInfo('<b>Recuerda el orden:</b> siempre <b>primero el botón</b> de la acción y <b>luego el QR</b> — el botón elegido decide qué se abre después de escanear.'),
    guideTitle: 'Guía del Coordinador QR',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + summary);
  return await exportGuide(html, 'Guía del Coordinador QR - SOS La Guaira');
}
