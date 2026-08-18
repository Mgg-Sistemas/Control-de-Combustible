/**
 * AGRUPACIÓN del REPORTE POR EMPRESA — función PURA (activa/avería/espera/pendiente).
 *
 * Extraída de `porEmpresaReport.ts` para poder blindarla con una matriz de tests
 * (`npm run test:empresa-grupo`) y que la regla quede en un solo lugar.
 *
 * REGLA (fuente de verdad = teléfono, por-turno; día independiente de noche):
 *  - Un turno está ACTIVO/LIMPIO si trabajó horas O declaró jornada de ESE turno SIN
 *    avería/parada propia (→ finalizada, aunque cierre en 0h — regla cliente 14-ago-2026).
 *  - La máquina va a ACTIVAS si CUALQUIER turno está activo/limpio, AUNQUE el OTRO turno
 *    esté parado/averiado (ese estado se muestra SOLO en su columna). Una parada/avería de
 *    UN turno NO debe arrastrar toda la máquina a "Averiadas" (bug 17-ago-2026: JUMBO 320
 *    y otras salían averiadas pese a haber iniciado el día).
 *  - AVERÍA: ningún turno activo/limpio y hay avería/parada (en cualquier turno).
 *  - ESPERA: "Esperando instrucciones" (en_espera) sin actividad ni ticket.
 *  - PENDIENTE: sin actividad, sin avería/parada y sin declarar jornada.
 *
 * Prioridad: activa > avería > espera > pendiente.
 */

export type GrupoEmpresa = 'activa' | 'averia' | 'espera' | 'pendiente';

/** Estado de UN turno (día o noche) de una máquina para decidir el grupo. */
export type TurnoEmpresa = {
  /** ¿Bancó/está bancando horas ese turno (dd>0 / nn>0)? */
  worked: boolean;
  /** ¿Declaró jornada de ESE turno (declared_day/declared_night, con fallback a jornada_shift)? */
  declared: boolean;
  /** ¿Ese turno tiene avería/parada propia vigente? */
  hasFault: boolean;
};

/**
 * ¿Un turno cuenta como "activo/LIMPIO"? Trabajó u declaró jornada de ESE turno, PERO
 * SIN avería/parada propia vigente. La avería MANDA sobre el trabajo (misma escalera que
 * Inspecciones/teléfono `clasificarEstadoTurno`: avería > parada > trabajó): una máquina
 * que arrancó en la mañana y se averió NO es "activa" — es AVERIADA (sus horas trabajadas
 * se siguen mostrando/sumando aparte, pero el ESTADO es averiada). Antes `t.worked` ganaba
 * aunque hubiera avería → el reporte por empresa la marcaba Activa mientras Inspecciones la
 * marcaba Averiada (descuadre reportado 18-ago-2026).
 */
export const turnoActivo = (t: TurnoEmpresa): boolean => (t.worked || t.declared) && !t.hasFault;

export function grupoEmpresaDe(params: {
  dia: TurnoEmpresa;
  noche: TurnoEmpresa;
  /** ¿Hay AL MENOS una avería/parada (cualquier turno)? = averiaTxt no vacío. */
  hasFaultAny: boolean;
  /** ¿en_espera = true (esperando instrucciones)? */
  enEspera: boolean;
}): GrupoEmpresa {
  const { dia, noche, hasFaultAny, enEspera } = params;
  if (turnoActivo(dia) || turnoActivo(noche)) return 'activa';
  if (hasFaultAny) return 'averia';
  if (enEspera) return 'espera';
  return 'pendiente';
}
