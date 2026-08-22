import { Platform } from 'react-native';
import { selectAllRows } from './supabase';

/**
 * Respaldo (backup) de la base de datos DESDE la app: descarga un archivo JSON con
 * TODAS las filas de las tablas de datos importantes. No es un pg_dump (no incluye
 * esquema/índices/funciones), pero sí un volcado completo de los DATOS para tener
 * una copia. Solo web (usa Blob + descarga del navegador). Lo que el usuario pueda
 * LEER según RLS es lo que entra (los admin ven todo).
 */

// Tablas de datos a respaldar. Las que no existan en el proyecto se saltan solas.
const BACKUP_TABLES = [
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

export type BackupResult = { filename: string; tables: number; rows: number };

/** Arma el JSON del backup (todas las tablas). `onTable` reporta el progreso. */
export async function buildBackupJson(onTable?: (name: string, i: number, total: number) => void): Promise<{ json: string; tables: number; rows: number }> {
  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  let totalRows = 0;
  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const t = BACKUP_TABLES[i];
    onTable?.(t, i + 1, BACKUP_TABLES.length);
    try {
      const rows = (await selectAllRows(t, '*')) as any[];
      data[t] = rows ?? [];
      counts[t] = data[t].length;
      totalRows += data[t].length;
    } catch {
      // Tabla inexistente o sin permiso: se anota vacía y se sigue con el resto.
      data[t] = [];
      counts[t] = 0;
    }
  }
  const payload = {
    _backup: {
      app: 'SOS LA GUAIRA · Control de Combustible',
      generated_at: new Date().toISOString(),
      tables: BACKUP_TABLES.length,
      counts,
      total_rows: totalRows,
    },
    data,
  };
  return { json: JSON.stringify(payload), tables: BACKUP_TABLES.length, rows: totalRows };
}

/** Descarga un texto como archivo (solo web). */
export function downloadTextFile(filename: string, text: string, mime = 'application/json') {
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

/** Genera y descarga el backup completo. Devuelve un resumen. */
export async function runBackup(onTable?: (name: string, i: number, total: number) => void): Promise<BackupResult> {
  const { json, tables, rows } = await buildBackupJson(onTable);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `backup-soslaguaira-${stamp}.json`;
  downloadTextFile(filename, json);
  return { filename, tables, rows };
}
