// Guía rápida (PDF descargable) del rol OPERADOR. Sigue el mismo patrón
// visual/estructural que inspectorGuide.ts — ver guideBuilder.ts.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, exportGuide,
  phoneFrame, urlBar, appBar, mockupBody, mockupCard, mockupField, mockupBtn,
  badgeLine, scanBox, arrowDown,
} from './guideBuilder';

export async function generateOperadorGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía del Operador',
    subtitle: 'Cómo registrar tu jornada y el combustible desde el teléfono',
    introCalloutHtml: calloutInfo('📱 Puedes entrar de <b>dos formas</b>: con tu <b>usuario y contraseña</b> (como cualquier persona), o <b>escaneando el QR</b> pegado en la máquina y tocando 🚜 <b>Operadores</b> para identificarte con tu <b>carnet</b>, sin necesitar sesión.'),
  });

  const step1aMock = phoneFrame(
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
  const step1 = stepSection(1, 'Entrar: con usuario o escaneando el QR', 'Dos caminos posibles según cómo llegues a la máquina',
    twoCol(
      stepList([
        'Con **usuario y contraseña**: abre **soslaguaira.com**, escribe tu usuario/cédula y contraseña, toca **ENTRAR**. Caes directo en tu pantalla de operador con la **máquina ya preseleccionada**.',
        'Sin sesión: **escanea el QR** de la máquina y toca 🚜 **Operadores**.',
        'Escanea tu **carnet** con 📷 **Escanear mi carnet**, escribe tu **cédula** y toca ✅ **ENTRAR**.',
        'Solo entran cargos de **operador, chofer, servicios generales u obrero**, y la cédula debe coincidir con el carnet escaneado.',
      ]) + calloutWarn('<b>Ojo:</b> el botón ✅ ENTRAR permanece deshabilitado hasta que escanees el carnet.'),
      step1aMock
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
  const step2 = stepSection(2, 'Identificarte por QR (sin sesión)', 'Ficha de identificación antes de poder registrar nada',
    twoCol(
      step2Mock,
      stepList([
        'Card 👷 **¿Eres el operador? Identifícate**.',
        'Toca 📷 **Escanear mi carnet** (o **Volver a escanear carnet** si te equivocaste).',
        'Se muestra tu **nombre y cargo**; escribe tu **cédula** en el campo.',
        'Toca ✅ **ENTRAR** para entrar a la pantalla rápida de la máquina.',
      ]) +
      calloutInfo('Tras identificarte verás **5 botones**: 📷 ESCANEAR CARNET (OPERADOR), ⏱️ INICIO DE JORNADA / 🟢 FIN DE JORNADA (según si ya tienes una abierta), ⛽ COMBUSTIBLE, 📍 ACTUALIZAR UBICACIÓN y 🛠️ AVERÍA DE MAQUINARIA.')
    )
  );

  const jornadaMock1 = phoneFrame(
    appBar('⏱️ Inicio de jornada') +
    mockupBody(
      mockupCard(
        mockupBtn('📷 Escanear mi carnet', 'outline') +
        mockupField('Horómetro inicial (precargado)', '1006', true) +
        mockupField('📷 Foto del horómetro (opcional)', 'Tomar foto', true) +
        mockupBtn('🟢 Iniciar jornada', 'success')
      )
    )
  );
  const jornadaMock2 = phoneFrame(
    appBar('🟢 Fin de jornada') +
    mockupBody(
      mockupCard(
        '<div style="font-weight:800;font-size:11.5px">Juan Pérez</div>' +
        '<div style="color:#6b7280;font-size:10px;margin-bottom:8px">🪪 27.514.385 · Horómetro inicial: 1006</div>' +
        mockupField('Horómetro final', '1012', true) +
        badgeLine('⚙️ Total de horas = final − inicial: 6 h', 'pend') +
        mockupBtn('⏹ Finalizar jornada', 'primary')
      )
    )
  );
  const step3 = stepSection(3, 'Registrar tu jornada', 'Formulario en OperatorScreen · o botones INICIO/FIN si entraste por QR',
    twoCol(jornadaMock1, jornadaMock2) +
    stepList([
      'Con **usuario**: en la card **Registrar mi jornada** elige fecha, turno de día y de noche (chips), y opcionalmente **Horas paradas** / **Horas extra**; revisa el total en la vista previa y toca 💾 **Guardar mi jornada**.',
      'Por **QR**: toca ⏱️ **INICIO DE JORNADA**, confirma tu carnet/cédula y el **Horómetro inicial** (precargado), y toca 🟢 **Iniciar jornada**. Al terminar, toca 🟢 **FIN DE JORNADA**, escribe el **Horómetro final** y toca ⏹ **Finalizar jornada**.',
    ]) +
    calloutWarn('<b>Reglas:</b> solo **1 máquina por operador por día**. El horómetro inicial siempre viene **precargado** (es el final de la jornada anterior) y el **final debe ser ≥ al inicial**.')
  );

  const step4Mock = phoneFrame(
    appBar('⛽ Registrar combustible') +
    mockupBody(
      mockupCard(
        mockupField('Fecha', '06/08/2026', true) +
        mockupField('Litros surtidos', '45', true) +
        badgeLine('⛽ Directo de bomba', 'ok') +
        mockupField('Km ida / Km vuelta (opcional)', '', true) +
        mockupBtn('⛽ Registrar combustible', 'primary')
      )
    )
  );
  const step4 = stepSection(4, 'Registrar combustible', 'Card "Registrar combustible" en OperatorScreen · o botón ⛽ COMBUSTIBLE por QR',
    twoCol(
      stepList([
        'Elige la **fecha** y escribe los **Litros surtidos**.',
        'Elige el **Origen**: ⛽ **Directo de bomba** (por defecto) o un **tanque** con nombre.',
        'Opcional: **Km ida**, **Km vuelta**, **Combustible inicial** y **Combustible final**.',
        'Toca ⛽ **Registrar combustible**.',
      ]),
      step4Mock
    ) +
    calloutWarn('<b>Solo se permite una carga de combustible por máquina al día.</b>')
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Todo desde el teléfono',
    rows: [
      ['Tienes usuario y contraseña', 'Entra **normal** en soslaguaira.com → máquina ya preseleccionada.'],
      ['No tienes sesión, estás frente a la máquina', '**Escanea el QR** → 🚜 **Operadores** → identifícate con tu **carnet**.'],
      ['Vas a empezar a trabajar', '💾 **Guardar mi jornada** (con usuario) o 🟢 **Iniciar jornada** (por QR, con horómetro inicial).'],
      ['Terminaste el turno', '⏹ **Finalizar jornada**: escribe el **horómetro final** (≥ al inicial).'],
      ['Cargaste combustible', '⛽ **Registrar combustible**: litros, origen (bomba o tanque) — solo **1 vez al día** por máquina.'],
      ['La máquina se dañó o cambiaste de ubicación', '🛠️ **AVERÍA DE MAQUINARIA** o 📍 **ACTUALIZAR UBICACIÓN** desde el menú de botones (flujo QR).'],
    ],
    closingCalloutHtml: calloutInfo('<b>Recuerda:</b> solo **1 máquina por operador por día**, y en el flujo por QR tu **cargo** y tu **cédula** deben coincidir con la nómina de tu empresa.'),
    guideTitle: 'Guía del Operador',
  });

  const html = guideDocument(cover + step1 + step2 + step3 + step4 + summary);
  return await exportGuide(html, 'Guía del Operador - SOS La Guaira');
}
