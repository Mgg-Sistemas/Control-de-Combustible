import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useAuth } from '../../context/AuthContext';
import { useTable } from '../../hooks/useTable';
import { Tank, TankLevel, FuelIntake, Dispatch, Transfer, Machinery, Vehicle } from '../../types/database';
import { exportarConciliacionPdf, exportarDesgloseRangoPdf, FilaConciliacionCombustible } from '../../lib/combustiblePdf';
import { exportarConciliacionExcel } from '../../lib/combustibleExcel';
import { esRegistroAjusteTanque } from '../../lib/fuelRules';
import { useToast } from '../../components/ToastProvider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { levelMeets } from '../../lib/permissions';
import {
  armarDesgloseRango,
  normalizarOpcionesDesglose,
  OPCIONES_DESGLOSE_DEFECTO,
  OpcionesDesglose,
} from '../../lib/combustibleDesglose';
import { cargarHorometros, claveHorometro, HorometroDia, HOROMETRO_AJUSTES_ACTIVOS } from '../../lib/combustibleHorometro';
import HorometroCombustibleModal from '../../components/combustible/HorometroCombustibleModal';

// 02-nov-2026: interruptores del «🧾 Desglose del rango». Se recuerdan por persona.
const ETIQUETAS_OPCIONES_DESGLOSE: { k: keyof OpcionesDesglose; t: string }[] = [
  { k: 'consumos', t: 'Consumos' },
  { k: 'entradas', t: 'Entradas' },
  { k: 'placa', t: 'Placa' },
  { k: 'serial', t: 'Serial' },
  { k: 'horometro', t: 'Horómetro' },
  { k: 'contador', t: 'Contador de bomba' },
  { k: 'totalesEquipo', t: 'Totales por equipo' },
  { k: 'totalesTanque', t: 'Totales por tanque' },
];
const MAX_FILAS_PANTALLA = 300;

const fmtNum = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export default function ConciliacionTab() {
  const { colors } = useTheme();
  const toast = useToast();
  const { fullName, session, moduleLevel } = useAuth();
  const currentUserName = fullName || session?.user?.email || 'Encargado de Combustible';

  const { data: tanks, loading: loadingTanks, refetch: refetchTanks } = useTable<Tank>('tanks', { realtimeFrom: ['tanks', 'stock_movements', 'dispatches', 'fuel_intakes', 'transfers'] });
  const { data: tankLevels, refetch: refetchLevels } = useTable<TankLevel>('tank_levels', { realtimeFrom: ['stock_movements', 'tanks', 'dispatches', 'fuel_intakes', 'transfers'] });
  const { data: intakes, refetch: refetchIntakes } = useTable<FuelIntake>('fuel_intakes', { realtimeFrom: ['fuel_intakes'] });
  const { data: dispatches, refetch: refetchDispatches } = useTable<Dispatch>('dispatches', { realtimeFrom: ['dispatches'] });
  const { data: transfers, refetch: refetchTransfers } = useTable<Transfer>('transfers', { realtimeFrom: ['transfers'] });
  // 02-nov-2026: catálogo para nombrar los equipos del desglose.
  const { data: machineryList } = useTable<Machinery>('machinery', { realtimeFrom: ['machinery'], orderBy: 'code' });
  const { data: vehiclesList } = useTable<Vehicle>('vehicles', { realtimeFrom: ['vehicles'], orderBy: 'plate' });

  const [desde, setDesde] = useState(daysAgoIso(7));
  const [hasta, setHasta] = useState(todayIso());
  const [elaboradoPor, setElaboradoPor] = useState(currentUserName);
  const [revisadoPor, setRevisadoPor] = useState('Auditoría Interna');
  const [observaciones, setObservaciones] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Mediciones físicas auditadas por tanque (ingresadas por el encargado/auditor)
  const [medicionesFisicas, setMedicionesFisicas] = useState<Record<string, string>>({});

  const activeTanks = useMemo(() => (tanks || []).filter((t) => t.active !== false), [tanks]);

  // ── 🧾 Desglose del rango (02-nov-2026) ───────────────────────────────────
  // Lo mismo que el parte diario del Surtidor, pero para el rango desde–hasta de
  // arriba, con consumos Y entradas. El horómetro es el de los inspectores (solo
  // lectura); con 'full' en Consumos y la tabla de correcciones creada, ✏️ lo corrige.
  const puedeCorregirHorometro = HOROMETRO_AJUSTES_ACTIVOS && levelMeets(moduleLevel('consumos'), 'full');
  const [desgloseAbierto, setDesgloseAbierto] = useState(false);
  const [opcDesglose, setOpcDesglose] = useState<OpcionesDesglose>(OPCIONES_DESGLOSE_DEFECTO);
  const [horometros, setHorometros] = useState<Map<string, HorometroDia>>(new Map());
  const [cargandoHorometro, setCargandoHorometro] = useState(false);
  const [exportingDesglose, setExportingDesglose] = useState(false);
  const [editHorometro, setEditHorometro] = useState<{ machineryId: string; fecha: string; equipo: string } | null>(null);
  const claveOpciones = `comb_desglose_rango_opciones:${session?.user?.id ?? 'anon'}`;

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(claveOpciones);
        if (vivo && raw) setOpcDesglose(normalizarOpcionesDesglose(JSON.parse(raw)));
      } catch {
        /* sin opciones guardadas: valores por defecto */
      }
    })();
    return () => {
      vivo = false;
    };
  }, [claveOpciones]);

  const cambiarOpcion = (k: keyof OpcionesDesglose) => {
    setOpcDesglose((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      try {
        AsyncStorage.setItem(claveOpciones, JSON.stringify(next)).catch(() => {});
      } catch {
        /* sin almacenamiento: la opción vale solo en esta sesión */
      }
      return next;
    });
  };

  const rangoValido = /^\d{4}-\d{2}-\d{2}$/.test(desde) && /^\d{4}-\d{2}-\d{2}$/.test(hasta) && desde <= hasta;

  // Máquinas surtidas en el rango (para leer su horómetro).
  const idsMaquinasRango = useMemo(() => {
    if (!rangoValido) return [] as string[];
    const ids = new Set<string>();
    for (const d of dispatches || []) {
      const f = String(d.dispatch_date ?? '').slice(0, 10);
      if (d.machinery_id && f >= desde && f <= hasta) ids.add(d.machinery_id);
    }
    return Array.from(ids).sort();
  }, [dispatches, desde, hasta, rangoValido]);
  const firmaIds = idsMaquinasRango.join(',');

  const recargarHorometros = useCallback(async () => {
    const ids = firmaIds ? firmaIds.split(',') : [];
    if (!rangoValido || ids.length === 0) {
      setHorometros(new Map());
      return;
    }
    setCargandoHorometro(true);
    try {
      // Un día antes: un surtido de madrugada pertenece a la jornada anterior (7am–7am).
      const dt = new Date(`${desde}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - 1);
      setHorometros(await cargarHorometros(ids, dt.toISOString().slice(0, 10), hasta));
    } finally {
      setCargandoHorometro(false);
    }
  }, [rangoValido, firmaIds, desde, hasta]);

  useEffect(() => {
    if (desgloseAbierto && opcDesglose.horometro) recargarHorometros();
  }, [desgloseAbierto, opcDesglose.horometro, recargarHorometros]);

  const desglose = useMemo(() => {
    if (!desgloseAbierto || !rangoValido) return null;
    return armarDesgloseRango({
      dispatches: dispatches || [],
      intakes: intakes || [],
      maquinas: machineryList || [],
      vehiculos: vehiclesList || [],
      tanques: tanks || [],
      horometros,
      desde,
      hasta,
    });
  }, [desgloseAbierto, rangoValido, dispatches, intakes, machineryList, vehiclesList, tanks, horometros, desde, hasta]);

  const handleDesglosePdf = async () => {
    if (!desglose) return;
    if (!opcDesglose.consumos && !opcDesglose.entradas) {
      toast.error('Enciende Consumos o Entradas para sacar el desglose.');
      return;
    }
    setExportingDesglose(true);
    try {
      await exportarDesgloseRangoPdf({ desglose, opciones: opcDesglose, elaboradoPor: elaboradoPor.trim() || currentUserName });
      toast.success('Desglose del rango descargado en PDF.');
    } catch (err: any) {
      toast.error('Error al exportar el desglose: ' + (err?.message || 'Error'));
    } finally {
      setExportingDesglose(false);
    }
  };

  // Sincronización manual en tiempo real
  const handleSincronizar = async () => {
    setSyncing(true);
    try {
      await Promise.all([
        refetchTanks?.(),
        refetchLevels?.(),
        refetchIntakes?.(),
        refetchDispatches?.(),
        refetchTransfers?.(),
      ]);
      toast.success('Conciliación sincronizada con los últimos datos.');
    } catch (err: any) {
      toast.error('Error al sincronizar datos: ' + (err?.message || 'Error'));
    } finally {
      setSyncing(false);
    }
  };

  // Cálculo de la conciliación por tanque en el período
  const filasConciliacion: FilaConciliacionCombustible[] = useMemo(() => {
    return activeTanks.map((t) => {
      const lvl = (tankLevels || []).find((l) => l.id === t.id);
      const cap = t.capacity_l || 0;

      // Entradas al tanque en el período (excluyendo ajustes internos de tanque)
      const ent = (intakes || [])
        .filter((i) => i.tank_id === t.id && i.intake_date >= desde && i.intake_date <= hasta && !esRegistroAjusteTanque(i))
        .reduce((s, i) => s + (Number(i.liters) || 0), 0);

      // Despachos desde el tanque en el período (excluyendo ajustes internos de tanque y los
      // registros viejos sin_descuento, que no movieron el stock — 02-nov-2026)
      const desp = (dispatches || [])
        .filter((d) => d.tank_id === t.id && d.dispatch_date >= desde && d.dispatch_date <= hasta && !esRegistroAjusteTanque(d) && !d.sin_descuento)
        .reduce((s, d) => s + (Number(d.liters) || 0), 0);

      // Traslados: entradas (+ destino) y salidas (- origen)
      const trIn = (transfers || [])
        .filter((tr) => tr.to_tank_id === t.id && tr.transfer_date >= desde && tr.transfer_date <= hasta)
        .reduce((s, tr) => s + (Number(tr.liters) || 0), 0);

      const trOut = (transfers || [])
        .filter((tr) => tr.from_tank_id === t.id && tr.transfer_date >= desde && tr.transfer_date <= hasta)
        .reduce((s, tr) => s + (Number(tr.liters) || 0), 0);

      const trNeto = trIn - trOut;

      const saldoTeorico = (lvl?.current_l ?? 0);
      const saldoInicialCalculado = Math.max(0, saldoTeorico - ent + desp - trNeto);

      const valorIngresado = medicionesFisicas[t.id];
      const saldoFisico =
        valorIngresado !== undefined && valorIngresado !== ''
          ? Number(valorIngresado.replace(',', '.')) || 0
          : saldoTeorico;

      const dif = saldoFisico - saldoTeorico;
      const pct = saldoTeorico > 0 ? (dif / saldoTeorico) * 100 : 0;

      return {
        tanqueNombre: t.name,
        combustible: t.fuel,
        capacidadL: cap,
        saldoInicialL: Math.round(saldoInicialCalculado),
        entradasL: Math.round(ent),
        despachosL: Math.round(desp),
        trasladosNetosL: Math.round(trNeto),
        saldoTeoricoL: Math.round(saldoTeorico),
        saldoFisicoVaraL: Math.round(saldoFisico),
        diferenciaL: Math.round(dif),
        pctDiferencia: Math.round(pct * 10) / 10,
        estado: dif < -20 ? 'merma' : dif > 20 ? 'sobrante' : 'cuadrado',
      };
    });
  }, [activeTanks, tankLevels, intakes, dispatches, transfers, desde, hasta, medicionesFisicas]);

  const handleDescargarPdf = async () => {
    setExportingPdf(true);
    try {
      await exportarConciliacionPdf({
        periodoDesde: desde,
        periodoHasta: hasta,
        elaboradoPor: elaboradoPor.trim() || currentUserName,
        revisadoPor: revisadoPor.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
        filas: filasConciliacion,
      });
      toast.success('Acta de conciliación descargada en PDF.');
    } catch (err: any) {
      toast.error('Error al exportar conciliación en PDF: ' + (err?.message || 'Error'));
    } finally {
      setExportingPdf(false);
    }
  };

  const handleDescargarExcel = async () => {
    setExportingExcel(true);
    try {
      const ok = await exportarConciliacionExcel({
        periodoDesde: desde,
        periodoHasta: hasta,
        elaboradoPor: elaboradoPor.trim() || currentUserName,
        revisadoPor: revisadoPor.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
        filas: filasConciliacion,
      });
      if (ok) {
        toast.success('Conciliación exportada a Excel (.xlsx).');
      } else {
        toast.error('La exportación a Excel solo está disponible en entorno Web.');
      }
    } catch (err: any) {
      toast.error('Error al exportar conciliación a Excel: ' + (err?.message || 'Error'));
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <>
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60, gap: spacing.md }}>
      {/* Encabezado */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: spacing.sm,
        }}
      >
        <View style={{ flex: 1, minWidth: 260 }}>
          <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>
            📊 Conciliación & Cierre Periódico de Combustible
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
            Audita el balance volumétrico de combustible (Saldo inicial + Entradas - Consumos ± Traslados = Saldo
            Teórico) y coteja con la medición física de vara para cerrar el período y emitir el acta formal.
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleSincronizar}
          disabled={syncing}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surfaceAlt,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.primary,
            gap: 6,
          }}
        >
          {syncing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={{ fontSize: 14 }}>🔄</Text>
          )}
          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primary }}>
            {syncing ? 'Sincronizando…' : 'Sincronizar datos'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Rango de Fechas y Firmantes */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
          gap: spacing.sm,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>Parámetros de Auditoría</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Desde (AAAA-MM-DD)</Text>
            <TextInput
              value={desde}
              onChangeText={setDesde}
              style={{
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.sm,
                padding: spacing.sm,
                fontSize: 13,
                color: colors.text,
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Hasta (AAAA-MM-DD)</Text>
            <TextInput
              value={hasta}
              onChangeText={setHasta}
              style={{
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.sm,
                padding: spacing.sm,
                fontSize: 13,
                color: colors.text,
              }}
            />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Elaborado por</Text>
            <TextInput
              value={elaboradoPor}
              onChangeText={setElaboradoPor}
              style={{
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.sm,
                padding: spacing.sm,
                fontSize: 13,
                color: colors.text,
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Revisado / Auditor</Text>
            <TextInput
              value={revisadoPor}
              onChangeText={setRevisadoPor}
              style={{
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.sm,
                padding: spacing.sm,
                fontSize: 13,
                color: colors.text,
              }}
            />
          </View>
        </View>
      </View>

      {/* Tabla de Conciliación por Tanque */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: spacing.sm }}>
          Balance por Tanque / Cisterna
        </Text>

        <View style={{ gap: spacing.md }}>
          {filasConciliacion.map((f, idx) => {
            const t = activeTanks[idx];
            return (
              <View
                key={f.tanqueNombre}
                style={{
                  backgroundColor: colors.surfaceAlt,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: f.diferenciaL < -50 ? colors.danger : colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: colors.text }}>{f.tanqueNombre}</Text>
                  <View
                    style={{
                      backgroundColor: f.diferenciaL < -50 ? colors.dangerSoftBg : colors.successSoftBg,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: radius.sm,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '800',
                        color: f.diferenciaL < -50 ? colors.danger : colors.successSoftText || colors.text,
                      }}
                    >
                      {f.diferenciaL < -50 ? '⚠️ Merma detectada' : '✅ Cuadrado'}
                    </Text>
                  </View>
                </View>

                {/* Métricas de balance */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, flexWrap: 'wrap', gap: 6 }}>
                  <View>
                    <Text style={{ fontSize: 10, color: colors.muted }}>Saldo Inicial</Text>
                    <Text style={{ fontWeight: '700', fontSize: 12, color: colors.text }}>{fmtNum(f.saldoInicialL)} L</Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 10, color: colors.muted }}>+ Entradas</Text>
                    <Text style={{ fontWeight: '700', fontSize: 12, color: colors.primary }}>+{fmtNum(f.entradasL)} L</Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 10, color: colors.muted }}>- Despachos</Text>
                    <Text style={{ fontWeight: '700', fontSize: 12, color: colors.danger }}>-{fmtNum(f.despachosL)} L</Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 10, color: colors.muted }}>± Traslados</Text>
                    <Text style={{ fontWeight: '700', fontSize: 12, color: colors.text }}>
                      {f.trasladosNetosL >= 0 ? '+' : ''}{fmtNum(f.trasladosNetosL)} L
                    </Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 10, color: colors.muted }}>Saldo Teórico</Text>
                    <Text style={{ fontWeight: '900', fontSize: 13, color: colors.text }}>{fmtNum(f.saldoTeoricoL)} L</Text>
                  </View>
                </View>

                {/* Input de Saldo Físico medido */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>
                    Saldo físico auditado (Vara / Regla):
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <TextInput
                      value={medicionesFisicas[t?.id] ?? String(f.saldoTeoricoL)}
                      onChangeText={(val) => {
                        if (t) {
                          setMedicionesFisicas((prev) => ({ ...prev, [t.id]: val }));
                        }
                      }}
                      keyboardType="numeric"
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.primary,
                        borderRadius: radius.sm,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        fontSize: 13,
                        fontWeight: '800',
                        color: colors.primary,
                        width: 90,
                        textAlign: 'right',
                      }}
                    />
                    <Text style={{ fontSize: 12, color: colors.muted }}>L</Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Diferencia / Merma calculada:</Text>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '800',
                      color: f.diferenciaL < 0 ? colors.danger : colors.text,
                    }}
                  >
                    {f.diferenciaL > 0 ? '+' : ''}{fmtNum(f.diferenciaL)} L ({f.pctDiferencia}%)
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Botones de Exportación ("Sacarlo" en PDF y Excel) */}
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, flexWrap: 'wrap' }}>
          <TouchableOpacity
            onPress={handleDescargarPdf}
            disabled={exportingPdf || exportingExcel}
            style={{
              flex: 1,
              minWidth: 200,
              backgroundColor: colors.primary,
              borderRadius: radius.md,
              paddingVertical: spacing.md,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {exportingPdf ? (
              <ActivityIndicator color={colors.primaryContrast} />
            ) : (
              <Text style={{ fontSize: 14, fontWeight: '900', color: colors.primaryContrast }}>
                📄 Descargar Acta en PDF
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDescargarExcel}
            disabled={exportingPdf || exportingExcel}
            style={{
              flex: 1,
              minWidth: 200,
              backgroundColor: '#1E7E34', // Verde Excel corporativo
              borderRadius: radius.md,
              paddingVertical: spacing.md,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {exportingExcel ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#FFFFFF' }}>
                📊 Exportar a Excel (.xlsx)
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* 🧾 Desglose del rango (02-nov-2026): consumos y entradas del desde–hasta de arriba */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
          gap: spacing.sm,
        }}
      >
        <TouchableOpacity
          onPress={() => setDesgloseAbierto((v) => !v)}
          style={{
            backgroundColor: desgloseAbierto ? colors.surfaceAlt : colors.primary,
            borderRadius: radius.md,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: colors.primary,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '900', color: desgloseAbierto ? colors.primary : colors.primaryContrast }}>
            {desgloseAbierto ? '▲ Cerrar desglose del rango' : '🧾 Desglose del rango'}
          </Text>
        </TouchableOpacity>

        {desgloseAbierto && !rangoValido ? (
          <Text style={{ fontSize: 12, color: colors.danger }}>
            Escribe un rango válido arriba (AAAA-MM-DD, «desde» antes de «hasta»).
          </Text>
        ) : null}

        {desgloseAbierto && desglose ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              Del {desglose.desde} al {desglose.hasta}. Toca una opción para quitarla o ponerla: lo apagado no sale en
              pantalla ni en el PDF.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {ETIQUETAS_OPCIONES_DESGLOSE.map(({ k, t }) => {
                const on = opcDesglose[k];
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => cambiarOpcion(k)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.primary : colors.surfaceAlt,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: on ? colors.primaryContrast : colors.muted }}>
                      {on ? '✓ ' : ''}{t}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Resumen */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
              {opcDesglose.entradas ? (
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primary }}>
                  Entró: {fmtNum(desglose.totalEntrado)} L ({desglose.entradas.length})
                </Text>
              ) : null}
              {opcDesglose.consumos ? (
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.danger }}>
                  Salió: {fmtNum(desglose.totalConsumido)} L ({desglose.consumos.length} surtidos)
                </Text>
              ) : null}
              {opcDesglose.horometro && cargandoHorometro ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>

            {/* Consumos */}
            {opcDesglose.consumos ? (
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: colors.text }}>⛽ Consumos</Text>
                {desglose.consumos.length === 0 ? (
                  <Text style={{ fontSize: 12, color: colors.muted }}>Sin consumos en el rango.</Text>
                ) : null}
                {desglose.consumos.slice(0, MAX_FILAS_PANTALLA).map((c) => {
                  const ident = [opcDesglose.placa && c.placa ? `Placa ${c.placa}` : '', opcDesglose.serial && c.serial ? `Serial ${c.serial}` : '']
                    .filter(Boolean)
                    .join(' · ');
                  const tieneHorometro = c.horometroIni != null || c.horometroFin != null;
                  return (
                    <View
                      key={c.id || `${c.fecha}-${c.hora}-${c.equipoClave}`}
                      style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, flexShrink: 1 }}>{c.equipo}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '900', color: colors.danger }}>{fmtNum(c.litros)} L</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.muted }}>
                        {c.fecha}{c.hora ? ` ${c.hora}` : ''} · {c.tanque}{ident ? ` · ${ident}` : ''}
                      </Text>
                      {opcDesglose.contador && c.contadorIni != null && c.contadorFin != null ? (
                        <Text style={{ fontSize: 11, color: colors.text }}>Contador: {fmtNum(c.contadorIni)} ➔ {fmtNum(c.contadorFin)}</Text>
                      ) : null}
                      {opcDesglose.horometro && (tieneHorometro || (puedeCorregirHorometro && c.machineryId)) ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          {tieneHorometro ? (
                            <Text style={{ fontSize: 11, color: colors.text }}>
                              Horómetro{c.horometroFuente === 'ajuste' ? ' (corregido)' : ''}: {c.horometroIni != null ? fmtNum(c.horometroIni) : '?'} ➔{' '}
                              {c.horometroFin != null ? fmtNum(c.horometroFin) : '?'}{c.horas != null ? ` (${fmtNum(c.horas)} h)` : ''}
                            </Text>
                          ) : null}
                          {puedeCorregirHorometro && c.machineryId ? (
                            <TouchableOpacity
                              onPress={() => setEditHorometro({ machineryId: c.machineryId as string, fecha: c.jornada, equipo: c.equipo })}
                              style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary }}
                            >
                              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.primary }}>✏️ Horómetro</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      ) : null}
                      {c.autorizado ? <Text style={{ fontSize: 11, color: colors.muted }}>Autorizó: {c.autorizado}</Text> : null}
                      {c.nota ? <Text style={{ fontSize: 11, color: colors.muted }}>Nota: {c.nota}</Text> : null}
                    </View>
                  );
                })}
                {desglose.consumos.length > MAX_FILAS_PANTALLA ? (
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    En pantalla van los primeros {MAX_FILAS_PANTALLA} de {desglose.consumos.length}; el PDF los trae todos.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Entradas */}
            {opcDesglose.entradas ? (
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: colors.text }}>📥 Entradas</Text>
                {desglose.entradas.length === 0 ? (
                  <Text style={{ fontSize: 12, color: colors.muted }}>Sin entradas en el rango.</Text>
                ) : null}
                {desglose.entradas.slice(0, MAX_FILAS_PANTALLA).map((e) => (
                  <View
                    key={e.id || `${e.fecha}-${e.tanque}-${e.litros}`}
                    style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, flexShrink: 1 }}>{e.proveedor || 'Sin proveedor'}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '900', color: colors.primary }}>+{fmtNum(e.litros)} L</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {e.fecha} · {e.tanque}{e.factura ? ` · Factura ${e.factura}` : ''}
                      {e.costoTotal != null ? ` · Total ${fmtNum(e.costoTotal)}` : ''}
                    </Text>
                    {e.nota ? <Text style={{ fontSize: 11, color: colors.muted }}>Nota: {e.nota}</Text> : null}
                  </View>
                ))}
                {desglose.entradas.length > MAX_FILAS_PANTALLA ? (
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    En pantalla van las primeras {MAX_FILAS_PANTALLA} de {desglose.entradas.length}; el PDF las trae todas.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Totales por equipo */}
            {opcDesglose.consumos && opcDesglose.totalesEquipo && desglose.porEquipo.length > 0 ? (
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: colors.text }}>🚜 Totales por equipo</Text>
                {desglose.porEquipo.map((e) => (
                  <View key={e.clave} style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 12, color: colors.text, flexShrink: 1 }}>
                      {e.equipo}
                      {opcDesglose.placa && e.placa ? ` · ${e.placa}` : ''}
                      {opcDesglose.serial && e.serial ? ` · ${e.serial}` : ''}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>
                      {fmtNum(e.litros)} L · {e.surtidos} surt.{opcDesglose.horometro && e.horas != null ? ` · ${fmtNum(e.horas)} h` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Totales por tanque */}
            {opcDesglose.totalesTanque && desglose.porTanque.length > 0 && (opcDesglose.consumos || opcDesglose.entradas) ? (
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: colors.text }}>🛢️ Totales por tanque</Text>
                {desglose.porTanque.map((t) => (
                  <View key={t.tanque} style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 12, color: colors.text, flexShrink: 1 }}>{t.tanque}</Text>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>
                      {[opcDesglose.entradas ? `Entró ${fmtNum(t.entro)} L` : '', opcDesglose.consumos ? `Salió ${fmtNum(t.salio)} L` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <TouchableOpacity
              onPress={handleDesglosePdf}
              disabled={exportingDesglose}
              style={{
                backgroundColor: colors.primary,
                borderRadius: radius.md,
                paddingVertical: spacing.md,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: spacing.sm,
              }}
            >
              {exportingDesglose ? (
                <ActivityIndicator color={colors.primaryContrast} />
              ) : (
                <Text style={{ fontSize: 14, fontWeight: '900', color: colors.primaryContrast }}>📄 Descargar desglose en PDF</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </ScrollView>

    {/* Modales al final (en web gana el último montado) */}
    {puedeCorregirHorometro && editHorometro ? (
      <HorometroCombustibleModal
        visible
        machineryId={editHorometro.machineryId}
        fecha={editHorometro.fecha}
        equipo={editHorometro.equipo}
        horometro={horometros.get(claveHorometro(editHorometro.machineryId, editHorometro.fecha)) ?? null}
        autor={currentUserName}
        onClose={() => setEditHorometro(null)}
        onError={(msg) => toast.error(msg)}
        onSaved={() => {
          setEditHorometro(null);
          toast.success('Corrección de horómetro guardada (solo para Combustible).');
          recargarHorometros();
        }}
      />
    ) : null}
    </>
  );
}
