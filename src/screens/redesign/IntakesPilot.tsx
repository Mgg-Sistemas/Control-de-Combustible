import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets } from '../../lib/permissions';
import { INGRESOS_NOTAS_ACTIVAS, INGRESOS_FOTOS_ACTIVAS } from '../../lib/combustibleEdicion';
import EditarFotosCombustibleModal from '../../components/combustible/EditarFotosCombustibleModal';
import { RList, RRow, RAmount, RPill } from '../../components/redesign/RList';
import { FuelIntake, Tank } from '../../types/database';
import SelectorMultiple from '../../components/combustible/SelectorMultiple';
import { filtrarPorTanques, opcionesTanques } from '../../lib/combustibleEquipos';
import { useAuth } from '../../context/AuthContext';
import { useTable } from '../../hooks/useTable';
import { norm } from '../../lib/text';
import { supabase, selectAllRows } from '../../lib/supabase';
import { useToast } from '../../components/ToastProvider';
import OpcionesReporteCombustibleModal from '../../components/combustible/OpcionesReporteCombustibleModal';
import { OPCIONES_REPORTE_ENTRADAS, filtrarEntradas } from '../../lib/combustibleReportes';
import { exportarReporteEntradasPdf } from '../../lib/combustibleReportesPdf';
import {
  MARCADOR_AJUSTE_TANQUE,
  esAjusteManualVisibleLegado,
  esRegistroAjusteTanque,
} from '../../lib/fuelRules';
import type { Field } from '../../components/RecordForm';

const FUEL_OPTIONS = [
  { label: 'Diésel', value: 'diesel' },
  { label: 'Gasolina', value: 'gasolina' },
];

/**
 * PILOTO DE REDISEÑO — Ingresos. Mismo comportamiento y campos que IntakesScreen
 * (crea/edita en `fuel_intakes`, los triggers de la BD suman stock → se sincroniza
 * con la pantalla de Tanques en vivo); solo cambia el look al lenguaje visual nuevo.
 *
 * "Cada encargado tiene su propio tanque": al abrir "Nuevo ingreso" se PRESELECCIONA
 * el "Tanque destino" con el tanque cuyo `responsable` coincide con el nombre del
 * usuario logueado (se puede cambiar). Así el encargado registra su ingreso a su
 * tanque sin buscarlo. Reusa RList → RecordForm (lógica intacta).
 */
export default function IntakesPilot() {
  const { fullName, moduleLevel, session } = useAuth();
  const toast = useToast();
  const { colors } = useTheme();
  // 01-nov-2026: con 'full' en Ingresos se edita la foto/nota de un ingreso ya
  // registrado. Queda detrás de los interruptores: fuel_intakes aún no tiene
  // columnas photos ni notes (ver combustibleEdicion.ts).
  const puedeEditarFotos = levelMeets(moduleLevel('ingresos'), 'full') && (INGRESOS_FOTOS_ACTIVAS || INGRESOS_NOTAS_ACTIVAS);
  const [editFotos, setEditFotos] = useState<any | null>(null);
  const refetchRef = useRef<(() => void) | null>(null);
  const { data: tanks } = useTable<Tank>('tanks');

  // 02-nov-2026: reporte personalizable de entradas (día o rango, gráficas por
  // tanque y por proveedor). Las opciones se recuerdan por persona.
  const [verReporte, setVerReporte] = useState(false);
  // 🛢 02-nov-2026: uno o varios tanques. Vacío = todos.
  const [selTanques, setSelTanques] = useState<string[]>([]);
  const opcionesTq = useMemo(() => opcionesTanques(tanks), [tanks]);
  const generarReporte = useCallback(async ({ desde, hasta, opciones, seleccion }: { desde: string; hasta: string; opciones: Record<string, boolean>; seleccion: string[] }) => {
    const filas = await selectAllRows('fuel_intakes', '*', (q) => q.gte('intake_date', desde).lte('intake_date', hasta));
    const entradas = filtrarPorTanques(filtrarEntradas(filas as any[], desde, hasta), seleccion);
    if (entradas.length === 0) {
      toast.info(`Sin entradas${seleccion.length ? ' de los tanques elegidos' : ''} en ${desde === hasta ? desde : `${desde} al ${hasta}`}: no hay nada que imprimir.`);
      return;
    }
    const nombres = new Map((tanks || []).map((t) => [t.id, t.name] as [string, string]));
    await exportarReporteEntradasPdf({ desde, hasta, filas: entradas, nombreTanque: (id) => nombres.get(id) || '' }, opciones);
  }, [tanks, toast]);

  // Tanque del encargado logueado: el que tenga `responsable` = su nombre (comparación
  // normalizada; exacto primero, luego "contiene"). undefined si no hay match → sin
  // preselección (el usuario elige a mano). Depende de tanks.responsable (SQL nuevo).
  const miTanqueId = useMemo(() => {
    const me = norm(fullName || '');
    if (!me || !tanks?.length) return undefined;
    const exact = tanks.find((t) => norm((t as any).responsable || '') === me);
    if (exact) return exact.id;
    const partial = tanks.find((t) => {
      const r = norm((t as any).responsable || '');
      return r && (r.includes(me) || me.includes(r));
    });
    return partial?.id;
  }, [fullName, tanks]);

  const formFields: Field[] = useMemo(() => ([
    { key: 'intake_date', label: 'Fecha', type: 'date', required: true },
    { key: 'supplier', label: 'Proveedor', type: 'text', defaultValue: 'PDVSA' },
    { key: 'fuel', label: 'Combustible', type: 'select', options: FUEL_OPTIONS, required: true },
    { key: 'liters', label: 'Litros', type: 'number', required: true },
    { key: 'unit_cost', label: 'Costo unitario', type: 'number' },
    { key: 'total_cost', label: 'Costo total', type: 'number' },
    // Preseleccionado con el tanque del encargado (si coincide el responsable). Muestra
    // ubicación + responsable en la etiqueta para distinguir tanques con el mismo nombre.
    // 01-nov-2026: nota opcional — se enciende cuando exista fuel_intakes.notes.
    ...(INGRESOS_NOTAS_ACTIVAS ? [{ key: 'notes', label: 'Nota / observación (opcional)', type: 'textarea' as const }] : []),
    { key: 'tank_id', label: 'Tanque destino', type: 'lookup', table: 'tanks', labelCol: 'name', subLabelCols: ['location', 'responsable'], dropdown: true, required: true, ...(miTanqueId ? { defaultValue: miTanqueId } : {}) },
  ]), [miTanqueId]);

  const cleanedRef = useRef<Set<string>>(new Set());
  const limpiarAjustesIngresos = useCallback(async (rows: FuelIntake[], refetch: () => void) => {
    refetchRef.current = refetch;
    const legados = (rows || []).filter(
      (r) => esAjusteManualVisibleLegado(r) && !cleanedRef.current.has(r.id)
    );
    if (legados.length === 0) return;
    let changed = false;
    for (const r of legados) {
      cleanedRef.current.add(r.id);
      const prev = String(r.supplier || '').trim();
      const { error } = await supabase
        .from('fuel_intakes')
        .update({ supplier: `${MARCADOR_AJUSTE_TANQUE} ${prev || 'Ajuste de nivel en tanque'}` })
        .eq('id', r.id);
      if (!error) changed = true;
    }
    if (changed) refetch();
  }, []);

  const filtrarIngresosReales = useCallback(
    (i: FuelIntake) => !esRegistroAjusteTanque(i) && (selTanques.length === 0 || selTanques.includes(String(i.tank_id ?? ''))),
    [selTanques],
  );

  return (
    <>
    <RList<FuelIntake>
      title="Ingresos"
      table="fuel_intakes"
      orderBy="intake_date"
      editable
      dateField="intake_date"
      baseFilter={filtrarIngresosReales}
      filtroActivo={selTanques.length > 0}
      onDataLoaded={limpiarAjustesIngresos}
      emptyIcon="⬇️"
      emptyTitle="Sin ingresos"
      emptySubtitle="Registra la recepción/compra de combustible."
      formTitle="Nuevo ingreso"
      subtitle={(rows) => {
        const l = rows.reduce((s, r) => s + (Number(r.liters) || 0), 0);
        return `${rows.length} ingreso(s) · ${l.toLocaleString()} L`;
      }}
      formFields={formFields}
      headerExtra={() => (
        <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
          <SelectorMultiple titulo="🛢 Tanques" todosTexto="todos" opciones={opcionesTq} seleccion={selTanques} onChange={setSelTanques} placeholder="Buscar por tanque o responsable…" />
          <Pressable onPress={() => setVerReporte(true)} style={{ alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>🖨️ Reporte</Text>
          </Pressable>
        </View>
      )}
      renderItem={(i) => (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <RAmount tone="brand">{Number(i.liters).toLocaleString()} L</RAmount>
            <RPill label={String(i.fuel).toUpperCase()} tone="brand" />
          </View>
          <View style={{ marginTop: 6 }}>
            <RRow label="Fecha" value={i.intake_date} />
            {i.supplier ? <RRow label="Proveedor" value={i.supplier} /> : null}
            {i.invoice_no ? <RRow label="Factura" value={i.invoice_no} /> : null}
            {i.total_cost != null ? <RRow label="Costo total" value={Number(i.total_cost).toLocaleString()} mono /> : null}
            {INGRESOS_NOTAS_ACTIVAS && (i as any).notes ? <RRow label="Nota" value={String((i as any).notes)} /> : null}
          </View>
          {INGRESOS_FOTOS_ACTIVAS && ((i as any).photos ?? []).length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
              {((i as any).photos as string[]).filter(Boolean).map((uri, k) => (
                <Image key={`${uri}-${k}`} source={{ uri }} style={{ width: 64, height: 64, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }} resizeMode="cover" />
              ))}
            </View>
          ) : null}
          {puedeEditarFotos ? (
            <Pressable onPress={() => setEditFotos(i as any)} style={{ alignSelf: 'flex-start', marginTop: spacing.sm, paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🖼️ Editar foto / nota</Text>
            </Pressable>
          ) : null}
        </>
      )}
    />
    <EditarFotosCombustibleModal
      visible={editFotos != null}
      tabla="fuel_intakes"
      registro={editFotos}
      carpetaId={editFotos?.tank_id || null}
      onClose={() => setEditFotos(null)}
      onSaved={() => refetchRef.current?.()}
    />
    <OpcionesReporteCombustibleModal
      visible={verReporte}
      titulo="Reporte de entradas"
      opciones={OPCIONES_REPORTE_ENTRADAS}
      storageKey="combustible:reporte-entradas"
      seleccion={{ titulo: '🛢 Tanques', todosTexto: 'todos', opciones: opcionesTq }}
      usuarioId={session?.user?.id}
      onClose={() => setVerReporte(false)}
      onGenerar={generarReporte}
    />
    </>
  );
}
