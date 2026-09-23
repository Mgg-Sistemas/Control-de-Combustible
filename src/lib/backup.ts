import { Platform } from 'react-native';
import { supabase } from './supabase';
import {
  TablaRespaldada, cabeceraSql, insertsDeTabla, nombreArchivoRespaldo, pieSql, seRespalda,
} from './backupSql';

/**
 * RESPALDO DE LA BASE DE DATOS DESDE LA APP (reescrito el 23-sep-2026).
 *
 * Descarga un archivo **.sql** con los datos de todas las tablas, listo para
 * volver a meterlo en Supabase. Solo web (usa Blob + descarga del navegador). Lo
 * que el usuario pueda LEER según RLS es lo que entra; un admin ve todo.
 *
 * TRES COSAS ESTABAN MAL Y SE ARREGLARON JUNTAS:
 *
 *   1. ⚠️ SALÍA EN .JSON. «Ese backup que sea en .SQL», pidió el cliente, y tiene
 *      razón: un .json solo se puede mirar; un .sql se vuelve a meter en la base,
 *      que es para lo que sirve un respaldo.
 *
 *   2. ⚠️ SE DEJABA 75 TABLAS. La lista de tablas estaba ESCRITA A MANO en este
 *      archivo (45 nombres) y cada módulo nuevo la dejaba más vieja: de 107 tablas
 *      con datos, se llevaba 32. Faltaban machinery_locations (7.105 filas),
 *      camion_viajes (4.448), cuentas, suppliers, purchase_orders… Ahora la lista
 *      SE LEE DE LA BASE (`tablas_para_respaldo`), así que no se puede volver a
 *      quedar vieja.
 *
 *   3. ⚠️ SE COLGABA SIN DECIR NADA. No había ni tope de páginas ni tiempo máximo:
 *      si una consulta se quedaba esperando, el respaldo se quedaba pegado en esa
 *      tabla PARA SIEMPRE, con su «Respaldando 5/45…» en pantalla. Y el `catch {}`
 *      se tragaba los errores: una tabla que fallaba se anotaba VACÍA y el archivo
 *      salía incompleto sin que nadie se enterara.
 *
 * ⭐ AHORA NO MIENTE: si una tabla no se pudo leer, se dice con su nombre en la
 *    cabecera del archivo Y en la pantalla. Un respaldo incompleto que parece
 *    completo es peor que uno que falla: nadie lo revisa hasta que hace falta
 *    restaurarlo, y para entonces ya no hay a quién preguntarle.
 */

/** Tope de tiempo por página. Sin esto, una consulta colgada cuelga el respaldo entero. */
export const MS_POR_PAGINA = 45_000;
/** Filas por página. */
export const PAGINA = 1000;
/**
 * Tope de páginas por tabla. Es un seguro contra un bucle infinito: si el servidor
 * devolviera siempre una página llena, `for(;;)` giraría para siempre. Un millón
 * de filas por tabla es muchísimo más de lo que este sistema maneja.
 */
export const MAX_PAGINAS = 1000;

/** La lista de siempre, por si la función de la base todavía no está creada. */
const LISTA_DE_EMERGENCIA = [
  'profiles', 'companies', 'employees', 'machinery', 'machine_rounds', 'machine_inspectors',
  'machine_work_segments', 'maintenance_requests', 'machinery_repairs', 'machine_guards',
  'supervisor_visits', 'operator_assignments', 'attendance', 'truck_attendance', 'truck_yard_logs',
  'fletes', 'company_payments', 'control_closures', 'stock_movements', 'tanks', 'fuel_intakes',
  'dispatches', 'transfers', 'inventory_items', 'inventory_movements', 'inventory_transfers',
  'food_distributions', 'food_company_meals', 'authorizations', 'notifications', 'module_permissions',
  'feature_toggles', 'uniform_deliveries', 'staff_payments', 'staff_pay_periods', 'staff_pay_items',
  'staff_pay_payments', 'payroll_periods', 'payroll_items', 'vehicles', 'work_orders', 'work_centers',
  'hose_services', 'aliados', 'app_roles',
];

/** Una promesa con tope de tiempo. Lo que pasa el tope se trata como un fallo. */
function conTope<T>(p: PromiseLike<T>, ms: number, queEs: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tardó más de ${Math.round(ms / 1000)}s (${queEs})`)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Las tablas a respaldar. Se le preguntan a la BASE, no a una lista escrita a mano:
 * es lo que hace que el respaldo se entere solo de cada módulo nuevo.
 */
export async function tablasARespaldar(): Promise<string[]> {
  try {
    const { data, error } = await conTope(supabase.rpc('tablas_para_respaldo'), MS_POR_PAGINA, 'lista de tablas');
    if (error) throw error;
    const filas = (data ?? []) as { tabla: string }[];
    const lista = filas.map((f) => f.tabla).filter(seRespalda);
    if (lista.length) return lista;
  } catch {
    // Falta correr `supabase/respaldo_sql.sql`, o no hay permiso. Se sigue con la
    // lista vieja: un respaldo de 45 tablas es mejor que ninguno, y la pantalla
    // avisa de que está incompleto.
  }
  return LISTA_DE_EMERGENCIA.filter(seRespalda);
}

/** Todas las filas de una tabla, paginadas, con tope de tiempo y de vueltas. */
async function traerTabla(tabla: string): Promise<any[]> {
  const out: any[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const desde = pagina * PAGINA;
    const { data, error } = await conTope(
      supabase.from(tabla).select('*').range(desde, desde + PAGINA - 1),
      MS_POR_PAGINA,
      `${tabla}, filas ${desde}+`,
    );
    if (error) throw error;
    const filas = (data ?? []) as any[];
    out.push(...filas);
    if (filas.length < PAGINA) return out;
  }
  throw new Error(`pasó de ${MAX_PAGINAS * PAGINA} filas: se cortó por seguridad`);
}

export type BackupResult = {
  filename: string;
  tablas: number;
  filas: number;
  /** Las que NO se pudieron leer. Si trae algo, el respaldo está INCOMPLETO. */
  fallidas: TablaRespaldada[];
};

/**
 * Arma el .sql completo. `onTabla` reporta el progreso para la pantalla.
 *
 * ⚠️ Una tabla que falla NO detiene el respaldo (mejor tener 106 tablas que
 *    ninguna), pero SÍ queda anotada con su nombre y su motivo, arriba del archivo
 *    y en el resumen que ve el usuario.
 */
export async function construirRespaldoSql(
  onTabla?: (nombre: string, i: number, total: number) => void,
): Promise<{ sql: string; resumen: TablaRespaldada[] }> {
  const tablas = await tablasARespaldar();
  const cuerpo: string[] = [];
  const resumen: TablaRespaldada[] = [];

  for (let i = 0; i < tablas.length; i++) {
    const t = tablas[i];
    onTabla?.(t, i + 1, tablas.length);
    try {
      const filas = await traerTabla(t);
      cuerpo.push(insertsDeTabla(t, filas));
      resumen.push({ tabla: t, filas: filas.length });
    } catch (e: any) {
      const motivo = String(e?.message ?? e ?? 'error desconocido');
      cuerpo.push(`-- ❌ ${t}: NO SE PUDO RESPALDAR (${motivo})\n`);
      resumen.push({ tabla: t, filas: 0, error: motivo });
    }
  }

  const sql = cabeceraSql(resumen, new Date().toISOString()) + cuerpo.join('\n') + pieSql();
  return { sql, resumen };
}

/** Descarga un texto como archivo (solo web). */
export function downloadTextFile(filename: string, text: string, mime = 'application/sql') {
  if (Platform.OS !== 'web') return;
  const w: any = globalThis;
  try {
    const blob = new w.Blob([text], { type: mime });
    const url = w.URL.createObjectURL(blob);
    const a = w.document.createElement('a');
    a.href = url;
    a.download = filename;
    w.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { w.URL.revokeObjectURL(url); } catch {} }, 1500);
  } catch {}
}

/** Genera y descarga el respaldo completo en .sql. Devuelve el resumen. */
export async function runBackup(
  onTabla?: (nombre: string, i: number, total: number) => void,
): Promise<BackupResult> {
  const { sql, resumen } = await construirRespaldoSql(onTabla);
  const filename = nombreArchivoRespaldo();
  downloadTextFile(filename, sql);
  const okey = resumen.filter((r) => !r.error);
  return {
    filename,
    tablas: okey.length,
    filas: okey.reduce((a, r) => a + r.filas, 0),
    fallidas: resumen.filter((r) => r.error),
  };
}
