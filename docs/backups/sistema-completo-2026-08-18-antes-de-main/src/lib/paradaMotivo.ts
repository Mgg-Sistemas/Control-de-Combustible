// ============================================================================
// MOTIVO DE PARADA — normalización ÚNICA para TODO el sistema.
// ----------------------------------------------------------------------------
// La nota de una máquina PARADA ("no trabajó") se guarda como:
//   "NO TRABAJÓ[ · <motivo del inspector>] · Edificio: <x> · Ubicación: <lat,lng>"
// (registros viejos: "NO TRABAJÓ LA MÁQUINA · Edificio: … · Ubicación: …").
//
// Antes cada pantalla/reporte tenía su propia copia de la limpieza (InspectionsSummary,
// SupervisorScreen, porEmpresaReport, inspectorReport) y NO coincidían. Centralizado aquí
// para que el teléfono del inspector, el resumen admin y los reportes muestren SIEMPRE lo
// mismo: el texto FIJO "NO TRABAJÓ" con el motivo del inspector al lado, sin arrastrar el
// Edificio/Ubicación (que ya salen en sus propias columnas/líneas).
// ============================================================================

/** Quita el "· Edificio: …" y el "· Ubicación: …" de la nota, dejando solo el POR QUÉ. */
export const stripUbicEdif = (s: string | null | undefined): string =>
  String(s ?? '')
    .replace(/\s*·\s*Ubicaci[óo]n:.*$/i, '')
    .replace(/\s*·\s*Edificio:.*$/i, '')
    .replace(/·\s*$/, '')
    .trim();

/**
 * Motivo de PARADA listo para mostrar: texto FIJO "NO TRABAJÓ" + el motivo del inspector
 * al lado (si lo escribió). Normaliza el marcador viejo "NO TRABAJÓ LA MÁQUINA" a
 * "NO TRABAJÓ". Si la nota no es una "no trabajó" (p. ej. una avería con material), devuelve
 * el texto limpio tal cual.
 */
export const motivoParada = (raw: string | null | undefined): string => {
  const s = stripUbicEdif(raw);
  const m = s.match(/^NO TRABAJ[ÓO](?:\s+LA\s+M[ÁA]QUINA)?\s*·?\s*(.*)$/i);
  if (m) {
    const rest = (m[1] || '').trim();
    return rest ? `NO TRABAJÓ · ${rest}` : 'NO TRABAJÓ';
  }
  return s;
};
