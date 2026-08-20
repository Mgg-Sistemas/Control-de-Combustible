// ============================================================================
// AUDITORÍA — CAMBIOS DE ESTADO DE UNA MÁQUINA: «¿QUIÉN LA PUSO RETIRADA?».
//
// EL PROBLEMA (pedido del cliente, 20-ago-2026). La bitácora ya guardaba el
// cambio, pero enterrado: una máquina retirada aparecía como
//     «Fulano modificó Máquina · CARGADOR 01 (6 cambios)»
// y había que abrir la fila y leer columna por columna para descubrir que entre
// esos 6 cambios estaba `operational: sí → no`. Con cien filas por día, nadie lo
// encontraba.
//
// ACÁ SE TRADUCE ESO A LO QUE DE VERDAD PASÓ: «⬛ RETIRADA (fuera de servicio)».
//
// LOS CUATRO ESTADOS DE UNA MÁQUINA VIVEN EN CUATRO COLUMNAS (`machinery`), no
// en un campo "estado". Es la MISMA regla que usan el Catálogo, el Dashboard y
// los reportes (`operational=false` = retirada, `en_espera` = esperando
// recepción, `active=false` = eliminada del catálogo):
//   · operational  true→false = RETIRADA        false→true = REACTIVADA
//   · en_espera    false→true = EN ESPERA       true→false = RECIBIDA
//   · active       true→false = ELIMINADA       false→true = RESTAURADA
//   · qr_blocked   false→true = QR BLOQUEADO    true→false = QR LIBERADO
// «Averiada» y «parada» NO están acá a propósito: no son columnas de la máquina,
// se deducen en vivo de `maintenance_requests` / las jornadas (ver
// `machineLiveStatus.ts`). Quien las marcó sale en el módulo de averías.
//
// ⚠️ ESTO ES UNA TRANSICIÓN DE UNA COLUMNA, NO EL ESTADO RESULTANTE.
// El Catálogo (`EquiposScreen.estadoConteoOf`) decide UN estado con prioridad
// EXCLUYENTE: retirada > espera > averiada/parada > operativa. Acá se reporta CADA
// columna que se movió. O sea: a una máquina que ya estaba retirada le ponen
// `en_espera = true` y esta bitácora dirá «⏳ EN ESPERA» mientras el Catálogo la
// sigue mostrando «⬛ Retirada». Las dos cosas son correctas — una cuenta lo que
// pasó, la otra cómo quedó. Por eso el detalle de la fila muestra además
// «Estado AHORA» leído de la ficha: para que nadie tenga que adivinar cuál gana.
//
// FORMA DE `changes` (la escribe el trigger `audit_row`, ver
// supabase/auditoria_quien_y_cambios.sql):
//   · UPDATE        → SOLO las columnas que cambiaron: `{campo: {de, a}}`
//   · INSERT/DELETE → la fila entera:                  `{campo: valor}`
//
// Es lógica PURA (sin React ni Supabase) para poder probarla:
// `scripts/test-auditoria-estado-maquina.mjs` (`npm run test:estados`).
// ============================================================================

/** Tablas cuyo estado sabemos leer. `vehicles` solo tiene `active`. */
export const TABLAS_CON_ESTADO = ['machinery', 'vehicles'] as const;

/** Columnas que DEFINEN el estado visible de la máquina, en orden de importancia. */
export const CAMPOS_ESTADO = ['operational', 'en_espera', 'active', 'qr_blocked'] as const;
export type CampoEstado = (typeof CAMPOS_ESTADO)[number];

/**
 * Columnas que ACOMPAÑAN a un cambio de estado (la fecha y el autor que la propia
 * ficha de la máquina guarda). No son estados: se listan aparte como evidencia de
 * «quién y cuándo», sobre todo para las máquinas retiradas ANTES de que el trigger
 * de auditoría estuviera encendido (`machinery` estuvo sin rastro hasta el 18-ago-2026).
 */
export const CAMPOS_ACOMPANANTES = [
  'inactivated_at', 'inactivated_by', 'reactivated_at', 'reactivated_by',
] as const;

export type CambioEstadoMaquina = {
  /** Identificador estable del tipo de cambio (para contar y filtrar). */
  key: string;
  icon: string;
  /** Lo que pasó, en mayúsculas y en criollo: «RETIRADA (fuera de servicio)». */
  label: string;
  /** Columna que lo produjo (null en el borrado físico de la fila). */
  campo: CampoEstado | null;
  de: boolean | null;
  a: boolean | null;
  /** Color en HEX — el PDF no tiene acceso al tema de la app. */
  hex: string;
};

type Transicion = { key: string; icon: string; label: string; hex: string };

// Qué significa que cada columna quede en `true` o en `false`.
const TRANSICIONES: Record<CampoEstado, { on: Transicion; off: Transicion }> = {
  operational: {
    off: { key: 'retirada', icon: '⬛', label: 'RETIRADA (fuera de servicio)', hex: '#4B5563' },
    on: { key: 'reactivada', icon: '✅', label: 'REACTIVADA (vuelve a servicio)', hex: '#15803D' },
  },
  en_espera: {
    on: { key: 'espera', icon: '⏳', label: 'EN ESPERA por recepción', hex: '#B45309' },
    off: { key: 'recibida', icon: '📥', label: 'RECIBIDA en control (sale de espera)', hex: '#0369A1' },
  },
  active: {
    off: { key: 'eliminada', icon: '🗑️', label: 'ELIMINADA del catálogo', hex: '#B91C1C' },
    on: { key: 'restaurada', icon: '♻️', label: 'RESTAURADA al catálogo', hex: '#15803D' },
  },
  qr_blocked: {
    on: { key: 'qr_bloqueado', icon: '🔒', label: 'QR BLOQUEADO (al escanear solo sale el logo)', hex: '#7C3AED' },
    off: { key: 'qr_liberado', icon: '🔓', label: 'QR liberado', hex: '#0369A1' },
  },
};

/** Borrado físico de la fila: no lo produce ninguna columna, pero es el cambio de
 *  estado más grave que existe (la máquina deja de estar en la base). */
const BORRADA: Transicion = { key: 'borrada', icon: '💥', label: 'BORRADA de la base de datos', hex: '#7F1D1D' };

/** Al crear, solo se avisa del estado NOTABLE (nace retirada / en espera / bloqueada);
 *  una máquina creada operativa es lo normal y no es noticia. */
const NOTABLE_AL_CREAR: Record<CampoEstado, boolean> = {
  operational: false, en_espera: true, active: false, qr_blocked: true,
};

/**
 * Booleano tolerante: la bitácora es JSON y con los años pasaron por ahí `true`,
 * `"true"`, `"t"` y `1`. Devuelve `null` cuando el valor no dice nada (null,
 * indefinido, texto vacío) — «no sé», que NO es lo mismo que «no».
 */
export function toBool(v: any): boolean | null {
  if (v === true || v === false) return v;
  if (v === 1 || v === 0) return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 't' || s === 'sí' || s === 'si' || s === '1') return true;
    if (s === 'false' || s === 'f' || s === 'no' || s === '0') return false;
  }
  return null;
}

/** Fila de bitácora, en lo mínimo que hace falta acá (no depende de `AuditLog`). */
export type FilaAuditable = {
  action?: string | null;
  table_name?: string | null;
  changes?: Record<string, any> | null;
};

/**
 * Los cambios de ESTADO que trae una fila de la bitácora. Devuelve `[]` cuando la
 * fila no es de una máquina o cuando lo que cambió fue otra cosa (la foto, el
 * precio por hora, el encargado…).
 */
export function cambiosEstadoMaquina(row: FilaAuditable | null | undefined): CambioEstadoMaquina[] {
  if (!row) return [];
  const tabla = String(row.table_name ?? '');
  if (!(TABLAS_CON_ESTADO as readonly string[]).includes(tabla)) return [];
  const action = String(row.action ?? '');
  const changes = row.changes;

  // El borrado físico es un cambio de estado por sí mismo, traiga o no columnas.
  if (action === 'DELETE') {
    return [{ key: BORRADA.key, icon: BORRADA.icon, label: BORRADA.label, campo: null, de: null, a: null, hex: BORRADA.hex }];
  }
  if (!changes || typeof changes !== 'object') return [];

  const out: CambioEstadoMaquina[] = [];
  for (const campo of CAMPOS_ESTADO) {
    if (!(campo in changes)) continue;
    const raw = (changes as any)[campo];

    if (action === 'UPDATE') {
      // `{de, a}`. Si `a` no dice nada, no se inventa una transición.
      const de = toBool(raw?.de);
      const a = toBool(raw?.a);
      if (a === null || de === a) continue;
      const t = a ? TRANSICIONES[campo].on : TRANSICIONES[campo].off;
      out.push({ ...t, campo, de, a });
      continue;
    }
    if (action === 'INSERT') {
      const a = toBool(raw);
      if (a === null || a !== NOTABLE_AL_CREAR[campo]) continue;
      const t = a ? TRANSICIONES[campo].on : TRANSICIONES[campo].off;
      out.push({ ...t, key: `${t.key}_al_crear`, label: `NACIÓ ${t.label}`, campo, de: null, a });
    }
  }
  return out;
}

/** ¿Esta fila de la bitácora es un cambio de estado de máquina? */
export function esCambioDeEstadoMaquina(row: FilaAuditable | null | undefined): boolean {
  return cambiosEstadoMaquina(row).length > 0;
}

/** Los campos «quién / cuándo» que la propia ficha guardó junto al cambio. */
export function acompanantes(row: FilaAuditable | null | undefined): string[] {
  const changes = row?.changes;
  if (!changes || typeof changes !== 'object') return [];
  return CAMPOS_ACOMPANANTES.filter((k) => k in changes);
}

/** Una línea con todos los cambios de estado de la fila: «⬛ RETIRADA · 🔒 QR BLOQUEADO». */
export function resumenCambioEstado(row: FilaAuditable | null | undefined): string | null {
  const cs = cambiosEstadoMaquina(row);
  if (!cs.length) return null;
  return cs.map((c) => `${c.icon} ${c.label}`).join('  ·  ');
}

/**
 * Conteo por tipo de cambio sobre una lista de filas, para el resumen de arriba
 * («⬛ Retiradas 4 · ✅ Reactivadas 1»). Ordenado de más a menos.
 */
export function conteoPorEstado(rows: (FilaAuditable | null | undefined)[]): { key: string; icon: string; label: string; hex: string; n: number }[] {
  const map = new Map<string, { key: string; icon: string; label: string; hex: string; n: number }>();
  rows.forEach((r) => {
    cambiosEstadoMaquina(r).forEach((c) => {
      const prev = map.get(c.key);
      if (prev) prev.n += 1;
      else map.set(c.key, { key: c.key, icon: c.icon, label: c.label, hex: c.hex, n: 1 });
    });
  });
  return Array.from(map.values()).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}
