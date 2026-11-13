import { norm } from './text';
import { canonicalCargo } from './cargos';

/**
 * GRUPOS APARTADOS de la nómina (pedido del cliente 29-ago-2026).
 *
 * CARBOZULIA y SEGURIDAD dejan de mezclarse con el resto de la plantilla: cada
 * uno tiene su propia pestaña en el filtro de ESTADO y NO se cuentan ni salen
 * en «Todos», «Activos», «Inactivos» ni «Otro». Se apartan por lo que YA está
 * registrado en la ficha, sin columna nueva ni migración:
 *
 * - CARBOZULIA → por la EMPRESA FILTRO NÓMINA (`payroll_company_id` →
 *   `payroll_companies.name`). Al 29-ago-2026 son 40 personas, todas `activo`.
 * - SEGURIDAD  → por el CARGO. Al 29-ago-2026 son 16 personas, todas `activo`
 *   y todas de SOS LA GUAIRA.
 *
 * Hoy los dos grupos NO se solapan (ningún empleado de Carbozulia tiene cargo
 * SEGURIDAD). Si algún día pasara, manda CARBOZULIA: la empresa que paga pesa
 * más que el cargo, y así una persona nunca sale contada en dos pestañas.
 */
export interface GrupoApartadoConfig {
  id: string;
  label: string;
  color: string;
  tipo: 'empresa' | 'cargo' | 'departamento';
  valor: string;
  builtin?: boolean;
}

export const DEFAULT_GRUPOS_APARTADOS: GrupoApartadoConfig[] = [
  { id: 'carbozulia', label: 'Carbozulia', color: '#7C3AED', tipo: 'empresa', valor: 'carbozul', builtin: true },
  { id: 'seguridad', label: 'Seguridad', color: '#0891B2', tipo: 'cargo', valor: 'SEGURIDAD', builtin: true },
];

export type GrupoApartado = string;

/**
 * ¿La empresa de filtro de nómina es Carbozulia? Se compara por SUBCADENA
 * normalizada (sin tildes, sin mayúsculas) y no por id: así sigue funcionando
 * si la empresa se renombra a "CARBOZULIA C.A.", "Carbozulia SA" o similar.
 */
export function esCarbozulia(empresaNomina?: string | null): boolean {
  return norm(empresaNomina).includes('carbozul');
}

/**
 * ¿El cargo es SEGURIDAD? Pasa por `canonicalCargo` para tomar las variantes
 * de escritura igual que el resto de la pantalla (chips, reporte por cargo).
 */
export function esSeguridad(cargo?: string | null): boolean {
  return canonicalCargo(cargo) === 'SEGURIDAD';
}

const PRIORIDAD_TIPO_GRUPO: Record<GrupoApartadoConfig['tipo'], number> = {
  empresa: 3,
  departamento: 2,
  cargo: 1,
};

function coincideEnCampoDirecto(
  g: GrupoApartadoConfig,
  empresaNomina?: string | null,
  cargo?: string | null,
  departamento?: string | null
): boolean {
  const val = norm(g.valor).trim();
  if (!val) return false;
  if (g.tipo === 'empresa') {
    const emp = norm(empresaNomina).trim();
    if (!emp || emp === 'sin empresa de filtro') return false;
    return emp.includes(val);
  }
  if (g.tipo === 'cargo') {
    const crg = norm(cargo).trim();
    if (!crg) return false;
    return canonicalCargo(cargo) === canonicalCargo(g.valor) || crg.includes(val);
  }
  if (g.tipo === 'departamento') {
    const dep = norm(departamento).trim();
    if (!dep) return false;
    return dep.includes(val);
  }
  return false;
}

/**
 * Evalúa si un empleado cumple la condición de un grupo apartado.
 * Para grupos personalizados (`!g.builtin`) de tipo `departamento` o `empresa`,
 * también reconoce cuando el usuario asignó el valor del grupo en `Empresa filtro nómina`
 * (o exactamente en `Departamento`), evitando que una pestaña quede en 0 si se creó bajo
 * Departamento pero se asignó en Empresa filtro nómina.
 */
export function coincideGrupo(
  g: GrupoApartadoConfig,
  empresaNomina?: string | null,
  cargo?: string | null,
  departamento?: string | null
): boolean {
  if (coincideEnCampoDirecto(g, empresaNomina, cargo, departamento)) {
    return true;
  }
  const val = norm(g.valor).trim();
  if (!val || g.builtin) return false;

  if (g.tipo === 'departamento') {
    const emp = norm(empresaNomina).trim();
    if (emp && emp !== 'sin empresa de filtro' && emp.includes(val)) return true;
  } else if (g.tipo === 'empresa') {
    const dep = norm(departamento).trim();
    if (dep && dep === val) return true;
  }
  return false;
}

function puntajeGrupo(
  g: GrupoApartadoConfig,
  empresaNomina?: string | null,
  cargo?: string | null,
  departamento?: string | null
): [number, number, number, number] {
  const directo = coincideEnCampoDirecto(g, empresaNomina, cargo, departamento) ? 1 : 0;
  const val = norm(g.valor).trim();
  const emp = norm(empresaNomina).trim();
  const dep = norm(departamento).trim();
  const crg = norm(cargo).trim();

  // Si coincidió por empresaNomina (directo o cruzado), tiene jerarquía de empresa (3).
  const coincidioPorEmpresa =
    (g.tipo === 'empresa' && directo === 1) ||
    (g.tipo === 'departamento' && directo === 0 && Boolean(emp && emp !== 'sin empresa de filtro' && emp.includes(val)));
  const tipoPrio = coincidioPorEmpresa ? 3 : (PRIORIDAD_TIPO_GRUPO[g.tipo] ?? 0);

  const campo = coincidioPorEmpresa
    ? emp
    : g.tipo === 'departamento'
      ? dep
      : g.tipo === 'cargo'
        ? crg
        : emp;

  let exactitud = 0;
  if (
    campo === val ||
    (g.tipo === 'cargo' && canonicalCargo(cargo) === canonicalCargo(g.valor) && campo.length <= val.length)
  ) {
    exactitud = 2;
  } else if (campo) {
    const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|\\s|[^a-z0-9ñ])${escaped}(?:$|\\s|[^a-z0-9ñ])`).test(campo)) {
      exactitud = 1;
    }
  }

  return [directo, tipoPrio, exactitud, val.length];
}

/**
 * Grupo apartado de un empleado, o `null` si va en las pestañas normales.
 *
 * Reglas de prioridad para evitar colisiones (ej. `CDT` vs `CDT QUINCENAL`):
 * 1. **Refinamiento / Subgrupo más específico**: Si el empleado coincide con dos grupos
 *    donde el valor de uno contiene al otro (ej. `"CDT QUINCENAL"` contiene a `"CDT"`),
 *    gana siempre el subgrupo más específico (`"CDT QUINCENAL"`), sin importar cuál se creó primero.
 * 2. **Jerarquía de negocio**: La empresa de nómina (`empresa`) pesa más que `departamento` y `cargo`
 *    (p. ej. un empleado de `CARBOZULIA` con cargo `SEGURIDAD` va a `carbozulia`; un operador con
 *    empresa `CDT QUINCENAL` va a `CDT QUINCENAL`).
 * 3. **Exactitud y longitud**: Dentro del mismo nivel, gana la coincidencia exacta (`===`) y el
 *    valor más largo/específico, conservando el orden de `gruposConfig` en caso de empate.
 */
export function grupoApartado(
  empresaNomina?: string | null,
  cargo?: string | null,
  departamento?: string | null,
  gruposConfig: GrupoApartadoConfig[] = DEFAULT_GRUPOS_APARTADOS
): GrupoApartado | null {
  const coincidentes = gruposConfig.filter((g) => coincideGrupo(g, empresaNomina, cargo, departamento));
  if (coincidentes.length === 0) return null;
  if (coincidentes.length === 1) return coincidentes[0].id;

  // 1) Descartar grupos genéricos cuando el empleado también cumple un subgrupo más específico
  //    cuyo `valor` contiene propiamente al del grupo genérico (ej. "cdt quincenal" contiene "cdt").
  const candidatos = coincidentes.filter((g1) => {
    const v1 = norm(g1.valor).trim();
    return !coincidentes.some((g2) => {
      if (g2.id === g1.id) return false;
      const v2 = norm(g2.valor).trim();
      return v2.length > v1.length && v2.includes(v1);
    });
  });

  const listaEval = candidatos.length > 0 ? candidatos : coincidentes;
  let mejorId: GrupoApartado | null = null;
  let mejorScore: [number, number, number, number] | null = null;

  for (const g of listaEval) {
    const score = puntajeGrupo(g, empresaNomina, cargo, departamento);
    if (
      !mejorScore ||
      score[0] > mejorScore[0] ||
      (score[0] === mejorScore[0] && score[1] > mejorScore[1]) ||
      (score[0] === mejorScore[0] && score[1] === mejorScore[1] && score[2] > mejorScore[2]) ||
      (score[0] === mejorScore[0] && score[1] === mejorScore[1] && score[2] === mejorScore[2] && score[3] > mejorScore[3])
    ) {
      mejorScore = score;
      mejorId = g.id;
    }
  }
  return mejorId;
}

/** Pestañas del filtro de ESTADO, en el orden en que se muestran. */
export type FiltroEstado = 'todos' | 'activo' | 'inactivo' | 'otro' | GrupoApartado;

/**
 * ¿El estado corresponde a un empleado INACTIVO / DESINCORPORADO?
 * Cualquier estado distinto de vacío, 'activo' y 'otro' (ej. 'inactivo', 'suspendido',
 * 'retirado', 'egresado', 'baja') vive exclusivamente en el Apartado de Inactivos.
 */
export function esInactivoEstado(estado?: string | null): boolean {
  const st = String(estado ?? '').trim().toLowerCase();
  if (!st) return false;
  return st !== 'activo' && st !== 'otro';
}

/**
 * ¿Este empleado se ve con la pestaña `filtro` puesta?
 *
 * REGLA DE AISLAMIENTO TOTAL DE INACTIVOS:
 * - Si el empleado está INACTIVO (`esInactivoEstado(estado)`), NUNCA aparece en
 *   «Todos», «Activos», «Otro» ni en ninguna pestaña APARTE (`carbozulia`,
 *   `seguridad`, `cdt`, `operadores`, `alimentacion`, etc.).
 * - Los empleados inactivos (incluidos los que pertenecían a grupos apartados)
 *   aparecen ÚNICAMENTE en el apartado `'inactivo'` («🚫 Inactivos»).
 * - Las pestañas normales («Todos», «Activos», «Otro») muestran solo personal
 *   NO inactivo y que NO pertenece a un grupo apartado (`!grupo`).
 * - Las pestañas APARTE muestran solo a los de su grupo que NO están inactivos.
 */
export function pasaFiltroEstado(
  filtro: string | Iterable<string>,
  grupo: string | null,
  estado?: string | null
): boolean {
  if (typeof filtro !== 'string') {
    const lista = Array.from(filtro || []).filter(Boolean);
    if (lista.length === 0) return !grupo && !esInactivoEstado(estado);
    return lista.some((f) => pasaFiltroEstado(f, grupo, estado));
  }
  const inactivo = esInactivoEstado(estado);
  if (filtro === 'inactivo') return inactivo;
  if (inactivo) return false;

  const st = String(estado ?? '').trim().toLowerCase() || 'activo';
  if (filtro === 'todos') return !grupo;
  if (filtro === 'activo') return !grupo && st === 'activo';
  if (filtro === 'otro') return !grupo && st === 'otro';
  return grupo === filtro;
}

/**
 * Alterna un chip en la selección de `Estado / Aparte`:
 * - `'inactivo'` («🚫 Inactivos») funciona como un APARTADO SEPARADO y exclusivo:
 *   tocarlo abre únicamente `Set(['inactivo'])` (y si ya estaba activo, vuelve a `Set(['todos'])`).
 * - Tocar `'todos'` restablece la selección a `Set(['todos'])`.
 * - Tocar cualquier otro chip (`'activo'`, `'otro'` o un grupo aparte) quita
 *   `'todos'` e `'inactivo'` y activa/desactiva ese chip en el conjunto.
 * - Si se desmarcan todos los chips, vuelve automáticamente a `Set(['todos'])`.
 */
export function toggleFiltroEstado(actual: Iterable<string>, key: string): Set<string> {
  if (key === 'todos') {
    return new Set(['todos']);
  }
  const actualSet = new Set(Array.from(actual || []).filter(Boolean));
  if (key === 'inactivo') {
    if (actualSet.size === 1 && actualSet.has('inactivo')) {
      return new Set(['todos']);
    }
    return new Set(['inactivo']);
  }
  const next = new Set(Array.from(actualSet).filter((k) => k !== 'todos' && k !== 'inactivo'));
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  if (next.size === 0) {
    return new Set(['todos']);
  }
  return next;
}

/**
 * Convierte el conjunto de filtros seleccionados en una etiqueta legible
 * para encabezados y reportes PDF (ej. `"Activos, Carbozulia, CDT"`).
 */
export function etiquetaFiltrosEstado(
  filtros: Iterable<string> | string,
  gruposConfig: readonly GrupoApartadoConfig[] = DEFAULT_GRUPOS_APARTADOS
): string {
  const lista = typeof filtros === 'string' ? [filtros] : Array.from(filtros || []).filter(Boolean);
  if (lista.length === 0 || (lista.length === 1 && lista[0] === 'todos')) {
    return 'Todos';
  }
  return lista
    .map((f) => {
      if (f === 'todos') return 'Todos';
      if (f === 'activo') return 'Activos';
      if (f === 'inactivo') return 'Inactivos';
      if (f === 'otro') return 'Otro';
      return gruposConfig.find((g) => g.id === f)?.label ?? f;
    })
    .join(', ');
}
