// Guía rápida (PDF descargable) del rol ANALISTA. Ver guideBuilder.ts (kit
// compartido) e inspectorGuide.ts (estructura de referencia). Guía corta: el
// analista no tiene un flujo lineal único, usa la app completa según los
// permisos que le dé el administrador.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, exportGuide,
  phoneFrame, urlBar, mockupBody, mockupCard, mockupBtn, mockupRow,
} from './guideBuilder';

export async function generateAnalistaGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía del Analista',
    subtitle: 'Para quien registra la asistencia del personal y consulta los módulos que el administrador le habilite.',
    introCalloutHtml: calloutInfo('📱💻 <b>Desde el teléfono o la PC</b> entras igual: al <b>Inicio</b> con las pestañas que tengas habilitadas y el menú <b>Más</b>. No hay una pantalla especial para el analista.'),
  });

  const step1Mock = phoneFrame(
    urlBar() +
    mockupBody(
      mockupCard(
        '<div style="font-weight:800;color:#1E3A5F;margin-bottom:8px">Inicio</div>' +
        mockupBtn('🕒 ASISTENCIA EMPLEADOS', 'primary')
      ) +
      mockupRow('🕒 Control de asistencia', 'Marcar entrada/salida del personal escaneando el carnet (hora y fecha), con reporte')
    )
  );
  const step1 = stepSection(1, 'Marcar asistencia del personal', 'Tu acceso garantizado, esté como esté configurada tu cuenta',
    twoCol(
      stepList([
        'Desde **Inicio** toca la tarjeta **"🕒 ASISTENCIA EMPLEADOS"** (o **Más → Control de asistencia**).',
        'Escanea el **carnet** de la persona.',
        'Confirma **entrada** o **salida**.',
      ]) + calloutWarn('🔒 <b>En Control de maquinaria</b> puedes cargar <b>horas nuevas</b>, pero no puedes modificar horas ya cargadas ni editar precios.'),
      step1Mock
    ) + calloutInfo('El resto de los módulos que veas (Inventario, Compras, Vehículos, Reportes…) depende de los <b>permisos</b> que te dé el <b>administrador</b>.')
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Asistencia + lo que te habiliten',
    rows: [
      ['Quieres marcar asistencia', 'Toca **"🕒 ASISTENCIA EMPLEADOS"** en Inicio (o Más → Control de asistencia) y escanea el carnet.'],
      ['Ves otro módulo en el menú', 'Puedes usarlo: el administrador te dio permiso para ese módulo.'],
      ['Vas a cargar horas en Control de maquinaria', 'Puedes cargar horas nuevas, pero no editar horas ya cargadas ni precios.'],
    ],
    closingCalloutHtml: calloutInfo('Si te falta un módulo que necesitas, pídeselo al <b>administrador</b>.'),
    guideTitle: 'Guía del Analista',
  });

  const html = guideDocument(cover + step1 + summary);
  return await exportGuide(html, 'Guía del Analista - SOS La Guaira');
}
