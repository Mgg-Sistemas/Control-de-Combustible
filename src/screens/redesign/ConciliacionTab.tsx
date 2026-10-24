import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useAuth } from '../../context/AuthContext';
import { useTable } from '../../hooks/useTable';
import { Tank, TankLevel, FuelIntake, Dispatch, Transfer } from '../../types/database';
import { exportarConciliacionPdf, FilaConciliacionCombustible } from '../../lib/combustiblePdf';
import { useToast } from '../../components/ToastProvider';

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
  const { fullName, session } = useAuth();
  const currentUserName = fullName || session?.user?.email || 'Encargado de Combustible';

  const { data: tanks, loading: loadingTanks } = useTable<Tank>('tanks');
  const { data: tankLevels } = useTable<TankLevel>('tank_levels');
  const { data: intakes } = useTable<FuelIntake>('fuel_intakes');
  const { data: dispatches } = useTable<Dispatch>('dispatches');
  const { data: transfers } = useTable<Transfer>('transfers');

  const [desde, setDesde] = useState(daysAgoIso(7));
  const [hasta, setHasta] = useState(todayIso());
  const [elaboradoPor, setElaboradoPor] = useState(currentUserName);
  const [revisadoPor, setRevisadoPor] = useState('Auditoría Interna');
  const [observaciones, setObservaciones] = useState('');
  const [exporting, setExporting] = useState(false);

  // Mediciones físicas auditadas por tanque (ingresadas por el encargado/auditor)
  const [medicionesFisicas, setMedicionesFisicas] = useState<Record<string, string>>({});

  const activeTanks = useMemo(() => (tanks || []).filter((t) => t.active !== false), [tanks]);

  // Cálculo de la conciliación por tanque en el período
  const filasConciliacion: FilaConciliacionCombustible[] = useMemo(() => {
    return activeTanks.map((t) => {
      const lvl = (tankLevels || []).find((l) => l.id === t.id);
      const cap = t.capacity_l || 0;

      // Entradas al tanque en el período
      const ent = (intakes || [])
        .filter((i) => i.tank_id === t.id && i.intake_date >= desde && i.intake_date <= hasta)
        .reduce((s, i) => s + (Number(i.liters) || 0), 0);

      // Despachos desde el tanque en el período
      const desp = (dispatches || [])
        .filter((d) => d.tank_id === t.id && d.dispatch_date >= desde && d.dispatch_date <= hasta)
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
    setExporting(true);
    try {
      await exportarConciliacionPdf({
        periodoDesde: desde,
        periodoHasta: hasta,
        elaboradoPor: elaboradoPor.trim() || currentUserName,
        revisadoPor: revisadoPor.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
        filas: filasConciliacion,
      });
      toast.success('Acta de conciliación descargada con éxito.');
    } catch (err: any) {
      toast.error('Error al exportar conciliación: ' + (err?.message || 'Error'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60, gap: spacing.md }}>
      {/* Encabezado */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>
          📊 Conciliación & Cierre Periódico de Combustible
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
          Audita el balance volumétrico de combustible (Saldo inicial + Entradas - Consumos ± Traslados = Saldo
          Teórico) y coteja con la medición física de vara para cerrar el período y emitir el acta formal.
        </Text>
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

        {/* Botón Exportar PDF */}
        <TouchableOpacity
          onPress={handleDescargarPdf}
          disabled={exporting}
          style={{
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: spacing.lg,
          }}
        >
          {exporting ? (
            <ActivityIndicator color={colors.primaryContrast} />
          ) : (
            <Text style={{ fontSize: 15, fontWeight: '900', color: colors.primaryContrast }}>
              📄 Descargar Acta de Conciliación en PDF
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
