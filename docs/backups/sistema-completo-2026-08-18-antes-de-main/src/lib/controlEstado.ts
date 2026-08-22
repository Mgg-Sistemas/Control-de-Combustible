/**
 * ESTADO de avería/parada del módulo CONTROL DE MAQUINARIA — función PURA.
 *
 * Extraída de ControlMaquinariaScreen (`averiadas`/`averiaTipo`) para poder
 * testearla sin montar la pantalla, y para que la regla quede en un solo lugar.
 *
 * Regla (alineada con el teléfono `segmentoDe` — fuente de verdad, 17-ago-2026):
 *  1. Máquinas SIEMPRE ACTIVO (SOS La Guaira) nunca salen parada/avería.
 *  2. REACTIVADA: si una jornada arrancó DESPUÉS (>=) de la marca, ya no cuenta
 *     (la máquina volvió a trabajar). `openStartByMachine` = inicio de la jornada
 *     abierta más reciente (cualquier turno).
 *  3. ARRASTRADA (marca de un día anterior) + trabajó hoy (bancó horas) → ya no
 *     cuenta, igual que `hoursMine` gana a la arrastrada en el teléfono. La marca
 *     de HOY sí se mantiene (la parada del día gana sobre las horas).
 *  4. Avería REAL (material != 'MÁQUINA PARADA') gana sobre "MÁQUINA PARADA".
 */

export type ControlTicket = {
  machinery_id: string;
  material: string | null;
  created_at: string | null;
};

export type ControlAveriaResult = {
  averiadas: Set<string>;
  tipo: Record<string, 'averia' | 'parada'>;
};

export function computeControlAveriadas(params: {
  /** maintenance_requests PENDIENTES (avería + parada), sin filtrar por turno. */
  tickets: ControlTicket[];
  /** machinery_id de máquinas con inspector SIEMPRE ACTIVO (SOS La Guaira). */
  sos: Set<string>;
  /** machinery_id → instante (ms) de la jornada ABIERTA más reciente (día∪noche). */
  openStartByMachine: Record<string, number>;
  /** machinery_id → horas BANCADAS de hoy (día+noche). */
  workedTodayByMachine: Record<string, number>;
  /** Inicio del día de hoy (ms, Caracas 00:00) para distinguir arrastrada vs de hoy. */
  dayStartMs: number;
}): ControlAveriaResult {
  const { tickets, sos, openStartByMachine, workedTodayByMachine, dayStartMs } = params;
  const averiadas = new Set<string>();
  const tipo: Record<string, 'averia' | 'parada'> = {};
  tickets.forEach((r) => {
    const id = r.machinery_id;
    if (sos.has(id)) return;
    const openStart = openStartByMachine[id];
    const createdMs = r.created_at ? new Date(r.created_at).getTime() : 0;
    if (openStart != null && openStart >= createdMs) return; // reactivada
    // ARRASTRADA (marcada antes de hoy) + trabajó hoy → ya no aplica; la de HOY sí.
    const esArrastrada = createdMs < dayStartMs;
    if (esArrastrada && (workedTodayByMachine[id] ?? 0) > 0) return;
    averiadas.add(id);
    // Avería REAL gana sobre "MÁQUINA PARADA"; no pisa una avería ya asignada con parada.
    if (r.material === 'MÁQUINA PARADA') { if (!tipo[id]) tipo[id] = 'parada'; }
    else tipo[id] = 'averia';
  });
  return { averiadas, tipo };
}
