// 👤 QUIÉN RETIRA EL MATERIAL DEL ALMACÉN (02-nov-2026, a pedido: «que me traiga
// la información del empleado o la persona, y poder registrar solo para esa
// vista u otro nombre sin que se registre ese empleado ni choque con nómina»).
//
// Se busca en DOS listas que solo se LEEN: la nómina (`employees`) y los
// choferes/operadores asignados a máquinas (`machine_operators`, que tiene
// gente que no está en nómina). Lo escrito a mano queda SOLO en el retiro de
// ese requerimiento: nada se inserta ni se actualiza en nómina ni en empleados.
//
// PURA: sin Supabase ni React (la carga la hace el componente).

export type PersonaRetiro = {
  clave: string;
  fuente: 'nomina' | 'operador';
  nombre: string;
  cedula: string;
  cargo: string;
  /** Solo las de nómina: el id de la ficha (se guarda como vínculo, no se toca la ficha). */
  employeeId: string | null;
  /** Solo los operadores: la máquina que tienen asignada. */
  machineryId: string | null;
  maquina: string;
  activo: boolean;
};

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export const normTexto = (s: string) => limpio(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const digitos = (s: string) => String(s ?? '').replace(/\D/g, '');

/**
 * Junta nómina + operadores en una sola lista. Un operador que ya está en
 * nómina (mismo employee_id o misma cédula) no se repite: se queda la ficha de
 * nómina, con la máquina del operador pegada.
 */
export function personasParaRetiro(
  empleados: readonly any[] | null | undefined,
  operadores: readonly any[] | null | undefined,
  codigoMaquina: (id: string) => string = () => '',
): PersonaRetiro[] {
  const out: PersonaRetiro[] = [];
  const porEmp = new Map<string, PersonaRetiro>();
  const porCed = new Map<string, PersonaRetiro>();
  for (const e of empleados ?? []) {
    const nombre = limpio([e?.first_name, e?.last_name].filter(Boolean).join(' '));
    if (!nombre) continue;
    const p: PersonaRetiro = {
      clave: `e:${e.id}`,
      fuente: 'nomina',
      nombre,
      cedula: limpio(e?.cedula),
      cargo: limpio(e?.cargo),
      employeeId: String(e.id),
      machineryId: null,
      maquina: '',
      activo: !/inactiv|egresad|retirad|despedid/i.test(String(e?.status ?? '')),
    };
    out.push(p);
    porEmp.set(String(e.id), p);
    if (digitos(p.cedula)) porCed.set(digitos(p.cedula), p);
  }
  for (const o of operadores ?? []) {
    if (o?.active === false) continue;
    const nombre = limpio(o?.operator_name);
    if (!nombre) continue;
    const mid = o?.machinery_id ? String(o.machinery_id) : null;
    const maquina = mid ? limpio(codigoMaquina(mid)) : '';
    const yaEsta = (o?.employee_id && porEmp.get(String(o.employee_id))) || (digitos(o?.cedula) && porCed.get(digitos(o.cedula)));
    if (yaEsta) {
      if (!yaEsta.machineryId && mid) { yaEsta.machineryId = mid; yaEsta.maquina = maquina; }
      continue;
    }
    const clave = `o:${normTexto(nombre)}|${digitos(o?.cedula)}`;
    if (out.some((x) => x.clave === clave)) continue;
    out.push({
      clave,
      fuente: 'operador',
      nombre,
      cedula: limpio(o?.cedula),
      cargo: 'Chofer / operador',
      employeeId: null,
      machineryId: mid,
      maquina,
      activo: true,
    });
  }
  return out;
}

/** Busca por nombre, cédula, cargo o máquina; los activos primero. */
export function buscarPersonasRetiro(lista: readonly PersonaRetiro[], q: string, max = 30): PersonaRetiro[] {
  const t = normTexto(q);
  if (!t) return [];
  const palabras = t.split(' ').filter(Boolean);
  const qd = digitos(q);
  return lista
    .filter((p) => {
      const hay = normTexto(`${p.nombre} ${p.cargo} ${p.maquina}`);
      if (palabras.every((w) => hay.includes(w))) return true;
      return qd.length >= 3 && digitos(p.cedula).includes(qd);
    })
    .slice()
    .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, max);
}
