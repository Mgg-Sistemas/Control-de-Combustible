// Guía rápida (PDF descargable) del rol ADMINISTRADOR. Ver guideBuilder.ts
// (kit compartido) e inspectorGuide.ts (estructura de referencia). Guía corta:
// el admin tiene acceso a toda la app, la única particularidad es cómo entra
// desde el teléfono.
import {
  guideDocument, coverPage, stepSection, summaryPage, twoCol, stepList,
  calloutInfo, calloutWarn, exportGuide,
  phoneFrame, appBar, mockupBody, mockupCard, mockupBtn,
} from './guideBuilder';

export async function generateAdminGuide(): Promise<boolean> {
  const cover = coverPage({
    title: 'Guía del Administrador',
    subtitle: 'Acceso completo al sistema — y la particularidad de cómo se entra desde el teléfono.',
    introCalloutHtml: calloutInfo('💻 <b>Desde la PC</b> entras directo a la <b>app completa</b>. 📱 <b>Desde el teléfono</b>, en cambio, primero caes en la vista de <b>Inspector</b>.'),
  });

  const step1Mock = phoneFrame(
    appBar('🪖 Revisar', '') +
    mockupBody(
      mockupBtn('🗂️ SISTEMA', 'outline') +
      mockupCard(
        '<div style="font-weight:800;color:#1E3A5F;margin-bottom:2px">🪖 Mi ronda de hoy</div>' +
        '<div style="color:#6b7280;font-size:10.5px;margin-bottom:8px">Revisadas hoy: 0</div>' +
        mockupBtn('📷 ESCANEAR QR', 'primary')
      )
    )
  );
  const step1 = stepSection(1, 'Desde el teléfono: Inspector + botón SISTEMA', 'Cómo pasar de la vista de Inspector a la app completa',
    twoCol(
      stepList([
        'Al entrar **desde el teléfono** caes en **Inspectores** (🪖 Revisar), como cualquier inspector.',
        'Toca **"🗂️ SISTEMA"** arriba para saltar a la **app completa** (Tabs + Más).',
        '**Desde PC** siempre entras directo a la app completa, sin este paso.',
      ]) + calloutWarn('Si <b>recargas la página</b> en el teléfono, vuelves a caer en Inspectores: el cambio <b>no se guarda</b>.'),
      step1Mock
    ) + calloutInfo('Desde <b>PC</b>, en <b>Más → Inspecciones</b> hay un botón <b>"📱 Ver vista de inspector"</b> que abre esa misma pantalla dentro de la PC — solo para previsualizar, no cambia dónde entra el administrador.')
  );

  const summary = summaryPage({
    title: 'Resumen rápido',
    subtitle: 'Cómo entras según el dispositivo',
    rows: [
      ['Entras desde el teléfono', 'Caes en Inspectores → toca **"🗂️ SISTEMA"** para pasar a la app completa.'],
      ['Entras desde PC', 'Vas directo a la app completa, sin pasos extra.'],
      ['Quieres ver la vista de inspector desde la PC', '**Más → Inspecciones → "📱 Ver vista de inspector"** (solo para previsualizar).'],
    ],
    closingCalloutHtml: calloutInfo('El cambio a <b>"🗂️ SISTEMA"</b> dura solo esa sesión: si recargas el teléfono, vuelve a Inspectores.'),
    guideTitle: 'Guía del Administrador',
  });

  const html = guideDocument(cover + step1 + summary);
  return await exportGuide(html, 'Guía del Administrador - SOS La Guaira');
}
