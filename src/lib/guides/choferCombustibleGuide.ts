// Guía rápida (PDF descargable) del rol CHOFER DE COMBUSTIBLE (panel_type
// 'chofer_combustible'). Sigue el patrón visual/estructural de inspectorGuide.ts
// — ver guideBuilder.ts para las piezas compartidas.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, exportGuide,
  phoneFrame, urlBar, appBar, mockupBody, mockupCard, mockupField, mockupBtn,
  scanBox, arrowDown,
} from './guideBuilder';

export async function generateChoferCombustibleGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía del Chofer de Combustible',
    subtitle: 'Cómo surtir combustible a las máquinas desde el teléfono',
    introCalloutHtml: calloutInfo('⛽ <b>Desde el teléfono</b>, al iniciar sesión caes <b>directo</b> en la pantalla de <b>Surtir combustible</b>. Desde ahí escoges la máquina y registras el surtido.'),
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
        'Caes directo en **Surtir combustible**, sin pasos intermedios.',
      ]),
      step1Mock
    )
  );

  const step2Mock =
    scanBox('Apunta al QR de la máquina') + arrowDown() +
    phoneFrame(
      appBar('⛽ Surtir combustible', 'Salir') +
      mockupBody(
        mockupBtn('📷 ESCANEAR MÁQUINA', 'primary') +
        '<div style="font-weight:800;color:#1E3A5F;font-size:11px;margin:8px 0 6px">O elige la máquina</div>' +
        mockupField('', 'Buscar por código, empresa, serial, placa…', true) +
        mockupCard(
          '<div style="font-weight:700;font-size:11.5px;color:#111827">EXC-014</div>' +
          '<div style="color:#6b7280;font-size:10px">Minerales del Sur · Excavadora</div>' +
          '<div style="color:#6b7280;font-size:10px">Sector: Norte · Parroquia: Vargas</div>'
        )
      )
    );
  const step2 = stepSection(2, 'Elige la máquina', 'Escanéala o búscala en la lista',
    twoCol(
      step2Mock,
      stepList([
        'Toca el botón grande 📷 **ESCANEAR MÁQUINA** y apunta la cámara al QR pegado en la máquina.',
        'O usa **O elige la máquina**: busca por **código, empresa, serial o placa**.',
        'Los resultados muestran el **código**, **empresa/tipo** y **Sector · Parroquia**.',
        '**Toca** la máquina (escaneada o de la lista) para abrir el formulario de surtido.',
      ])
    )
  );

  const step3Mock = phoneFrame(
    appBar('EXC-014', 'Cerrar') +
    mockupBody(
      '<div style="font-weight:800;color:#1E3A5F;font-size:11px;margin:2px 0 6px">¿Qué vas a surtir?</div>' +
      '<div style="display:flex;gap:4px;margin-bottom:8px">' +
      '<div style="flex:1;text-align:center;border:2px solid #1E3A5F;background:#1E3A5F;color:#fff;border-radius:8px;padding:6px 2px;font-size:9px;font-weight:800">⛽ Combustible</div>' +
      '<div style="flex:1;text-align:center;border:2px solid #E5E7EB;border-radius:8px;padding:6px 2px;font-size:9px;font-weight:800;color:#374151">🛢️ Aceite</div>' +
      '<div style="flex:1;text-align:center;border:2px solid #E5E7EB;border-radius:8px;padding:6px 2px;font-size:9px;font-weight:800;color:#374151">💨 Aire</div>' +
      '</div>' +
      mockupCard(
        '<div style="color:#6b7280;font-size:9.5px">Sector</div>' +
        '<div style="font-weight:700;font-size:11.5px;color:#111827;margin-bottom:6px">Norte</div>' +
        '<div style="color:#6b7280;font-size:9.5px">Parroquia</div>' +
        '<div style="font-weight:700;font-size:11.5px;color:#111827">Vargas</div>'
      ) +
      mockupField('Litros surtidos', '120', true) +
      mockupField('Monto por litro', '0,50', true) +
      mockupField('Monto total', '60,00') +
      mockupBtn('📷 Agregar foto', 'ghost') +
      mockupBtn('Registrar surtido', 'success')
    )
  );
  const step3 = stepSection(3, 'Registra el surtido', 'Elige qué le llevas a la máquina, y Sector/Parroquia confirman que estás en el lugar correcto',
    twoCol(
      stepList([
        'Primero elige **¿Qué vas a surtir?**: ⛽ **Combustible**, 🛢️ **Aceite** o 💨 **Aire**.',
        '**Sector** y **Parroquia** salen ya llenos, solo lectura — sirven para confirmar que estás en la máquina correcta.',
        'También puedes elegir/agregar el **EDIFICIO** (ubicación) de la lista compartida.',
        'Con **Combustible** o **Aceite**: escribe los **litros** y el **monto por litro** — el **monto total** se calcula solo.',
        'Con **Aire**: no hay litros, solo una **nota opcional** (ej. "se infló los 4 cauchos").',
        'Toca 📷 **Agregar foto** las veces que necesites; cada miniatura tiene una **×** para borrarla.',
        'Si la máquina tiene una falla, abre **🔧 Reportar avería**: elige el material, describe la falla si es "Otro" y agrega fotos — queda registrada en Mantenimiento.',
        'Toca **Registrar surtido** (o **Registrar aceite** / **Registrar aire**, según lo que elegiste) para guardar.',
      ]) +
      calloutInfo('<b>Sin tope diario (solo Combustible):</b> a diferencia de otros roles, el chofer de combustible <b>no tiene</b> el límite de "2× el consumo esperado" al surtir combustible — puede surtir sin ese tope.') +
      calloutWarn('Después de guardar, el formulario se queda <b>abierto</b> en la misma máquina (litros, monto, nota y fotos se limpian) para registrar un <b>segundo surtido</b> sin volver a buscarla. Toca <b>Cerrar</b> solo cuando termines con esa máquina.'),
      step3Mock
    )
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Todo desde el teléfono',
    rows: [
      ['Tienes el QR a mano', '📷 **ESCANEAR MÁQUINA** y apunta la cámara.'],
      ['No hay QR o prefieres buscarla', 'Usa **O elige la máquina** y busca por código, empresa, serial o placa.'],
      ['Vas a surtir combustible o aceite', 'Elige el tipo arriba, llena **litros** y **monto por litro**, agrega fotos si quieres y toca **Registrar**.'],
      ['Solo le diste aire', 'Elige 💨 **Aire**, escribe una nota si quieres y toca **Registrar aire** (sin litros).'],
      ['La máquina tiene una falla', 'Abre **🔧 Reportar avería**, elige el material y describe/agrega fotos — queda en Mantenimiento.'],
      ['Debes surtir otra vez a la misma máquina', 'El formulario queda **abierto y limpio**: solo llena los datos y **Registrar** de nuevo.'],
      ['Terminaste con esa máquina', 'Toca **Cerrar** para volver a la lista.'],
    ],
    closingCalloutHtml: calloutInfo('<b>Recuerda:</b> Sector y Parroquia son solo informativos, nunca los edites — sirven para confirmar que estás en el lugar correcto.'),
    guideTitle: 'Guía del Chofer de Combustible',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + summary);
  return await exportGuide(html, 'Guía del Chofer de Combustible - SOS La Guaira');
}
