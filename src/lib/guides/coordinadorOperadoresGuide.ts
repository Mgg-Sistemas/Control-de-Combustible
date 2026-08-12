// Guía rápida (PDF descargable) del rol COORDINADOR DE OPERADORES. Mismo
// patrón visual/estructural que operadorGuide.ts/inspectorGuide.ts — ver
// guideBuilder.ts.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, exportGuide,
  phoneFrame, urlBar, appBar, mockupBody, mockupCard, mockupBtn,
  badgeLine,
} from './guideBuilder';

export async function generateCoordinadorOperadoresGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía del Coordinador de Operadores',
    subtitle: 'Asignar operadores a las máquinas, controlar su asistencia y avisar novedades',
    introCalloutHtml: calloutInfo('📱 Entra con tu <b>usuario y contraseña</b>: caes DIRECTO en esta pantalla (no hace falta pasar por el menú "Más"). Se organiza <b>por máquina</b>, no por persona — como Inspecciones, pero al revés.'),
  });

  const step1Mock = phoneFrame(
    urlBar() +
    mockupBody(
      mockupCard(
        '<div style="font-weight:800;font-size:11.5px">EXC-014 · Transporte Ávila</div>' +
        badgeLine('Activa', 'ok') +
        '<div style="font-size:10.5px;color:#374151;margin-top:6px">Planeado: 👷 J. Ramírez</div>' +
        '<div style="font-size:10.5px;color:#374151">En sitio: 👷 J. Ramírez</div>' +
        '<div style="font-size:10px;color:#15803D;margin-top:4px">🟢 Marcó entrada 6:52 a.m.</div>'
      )
    )
  );
  const step1 = stepSection(1, 'Elegir el turno y leer la lista', 'Cada tarjeta es UNA máquina, no una persona',
    twoCol(
      stepList([
        'Arriba elige ☀️ **Día** o 🌙 **Noche** — toda la pantalla cambia a ese turno.',
        'Los 3 números de arriba resumen el turno: **Activas**, **Sin asignar** y **No coincide**.',
        'Cada tarjeta muestra la máquina, su estado (Activa/Parada/Avería/Cerrada), el operador **planeado** y el que está **en sitio** de verdad.',
        'Si el operador en sitio NO es el planeado, aparece ⚠️ **"El operador en sitio no es el planeado"**.',
        '📷 **ESCANEAR QR**: apunta al QR de la máquina y te lleva DIRECTO a la ficha del operador planeado en ese turno (foto, cédula, horas trabajadas). Si la máquina no tiene operador asignado, abre de una vez la hoja para asignar uno.',
        '🪪 **Marcar asistencia (escanear operador)**: el botón chico debajo del de escanear. Apunta al CARNET del operador (no al QR de la máquina) y le registra la ENTRADA o SALIDA al instante — decide sola cuál toca según su última marca de hoy.',
      ]),
      step1Mock
    )
  );

  const step2Mock = phoneFrame(
    appBar('👷 Asignar operador · 🚜 PAL-007') +
    mockupBody(
      mockupCard(
        '<div style="font-size:10.5px;color:#374151;margin-bottom:6px">Planeado ahora: <b>C. Salazar</b></div>' +
        mockupBtn('🔎 Buscar operador…', 'outline') +
        '<div style="font-size:10.5px;padding:6px 0;border-top:1px solid #e5e7eb">M. Duarte · Operador de maquinaria</div>' +
        '<div style="font-size:10.5px;padding:6px 0;border-top:1px solid #e5e7eb">P. Gómez · Operador de maquinaria</div>'
      )
    )
  );
  const step2 = stepSection(2, 'Asignar o reasignar un operador', 'Toca la tarjeta de la máquina',
    twoCol(
      stepList([
        'Toca cualquier tarjeta de máquina para abrir la hoja de asignación.',
        'Elige el turno (☀️/🌙) dentro de la hoja — puedes planear el otro turno sin salir.',
        'Busca al operador por nombre o cédula y tócalo: queda asignado al instante.',
        'Solo aparecen personas con cargo de **operador, chofer, obrero o servicios generales**.',
        'Para quitar la asignación sin poner a otro, toca ➖ **Quitar**.',
      ]),
      step2Mock
    ) + calloutWarn('<b>Un operador planeado por máquina y turno.</b> Si ya había alguien, reasignar lo reemplaza — no se duplica.')
  );

  const step3 = stepSection(3, 'Qué significan los avisos', 'Los mismos 3 casos que ves en "Novedades"',
    stepList([
      '🧩 **Sin asignar** — la máquina está en juego este turno (asignada, trabajando, parada o averiada) pero nadie tiene el operador planeado todavía.',
      '⚠️ **No coincide** — el operador que planeaste no es el que de verdad escaneó el QR y está en la máquina. Revisa si hubo un cambio de último momento.',
      '🔴 **Sin marcar entrada** — el operador planeado no ha marcado su carnet de entrada hoy. Márcasela tú mismo con 🪪 **Marcar asistencia** arriba, sin salir de esta pantalla.',
    ]) + calloutInfo('Estos 3 avisos se calculan solos, en vivo — no hay que registrar nada aparte para que aparezcan.')
  );

  const step4Mock = phoneFrame(
    appBar('📋 Novedades de hoy') +
    mockupBody(
      mockupCard(
        mockupBtn('📤 Compartir con Coordinador de Operaciones', 'primary')
      )
    )
  );
  const step4 = stepSection(4, 'Reportar novedades', 'Pestaña "Novedades" → botón compartir',
    twoCol(
      stepList([
        'Abre la pestaña 📋 **Novedades** para ver los 3 avisos juntos, ya organizados.',
        'Toca 📤 **Compartir novedades**: genera un PDF con todo lo pendiente del turno.',
        'Envíalo al Coordinador de Operaciones o al Jefe de Operaciones de Maquinaria (WhatsApp, correo, o imprímelo).',
      ]),
      step4Mock
    )
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Todo desde el teléfono',
    rows: [
      ['Empezar el turno', 'Elige ☀️ **Día** o 🌙 **Noche** arriba — la lista completa cambia.'],
      ['Asignar un operador', 'Toca la tarjeta de la máquina → elige de la lista (solo cargos de operador).'],
      ['Reasignar', 'Toca la tarjeta → elige otro operador; reemplaza al anterior sin duplicar.'],
      ['Marcar asistencia', '🪪 **Marcar asistencia** arriba → escanea su carnet. Entrada/salida automática.'],
      ['Ver quién falta cubrir', 'Pestaña 🧩 **Sin asignar**.'],
      ['Ver quién no coincide o no marcó entrada', 'Pestaña 📋 **Novedades**.'],
      ['Avisar arriba', '📤 **Compartir novedades** desde la pestaña Novedades.'],
    ],
    closingCalloutHtml: calloutInfo('<b>Recuerda:</b> lo que ves aquí es lo que <b>PLANEASTE</b>. Lo que la máquina realmente registra (quién escaneó el QR) puede diferir — para eso está el aviso ⚠️ <b>No coincide</b>.'),
    guideTitle: 'Guía del Coordinador de Operadores',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + step4 + summary);
  return await exportGuide(html, 'Guía del Coordinador de Operadores - SOS La Guaira');
}
