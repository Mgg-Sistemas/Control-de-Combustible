import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useTable } from '../../hooks/useTable';
import { Tank, TankLevel } from '../../types/database';
import { cubicarLitros, capacidadCalculada, GeometriaTanque, TipoGeometriaTanque } from '../../lib/fuelRules';

const fmtNum = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });

export default function CubicacionTab() {
  const { colors } = useTheme();
  const { data: tanks } = useTable<Tank>('tanks');
  const { data: tankLevels } = useTable<TankLevel>('tank_levels');

  const [selectedTankId, setSelectedTankId] = useState<string>('');
  const [tipoGeom, setTipoGeom] = useState<TipoGeometriaTanque>('cilindrico_horizontal');

  // Parámetros geométricos (en metros)
  const [diametroM, setDiametroM] = useState('2.00'); // Diámetro o radio * 2
  const [largoM, setLargoM] = useState('4.50');
  const [anchoM, setAnchoM] = useState('2.00');
  const [altoM, setAltoM] = useState('1.80');

  // Altura medida con la vara (en cm)
  const [alturaCm, setAlturaCm] = useState('85');

  const activeTanks = useMemo(() => (tanks || []).filter((t) => t.active !== false), [tanks]);
  const currentTank = activeTanks.find((t) => t.id === selectedTankId) || activeTanks[0] || null;
  const currentLevel = (tankLevels || []).find((l) => l.id === currentTank?.id);

  const geom: GeometriaTanque = useMemo(() => {
    const d = Number(diametroM.replace(',', '.')) || 0;
    return {
      tipo: tipoGeom,
      radio_m: d > 0 ? d / 2 : 0,
      largo_m: Number(largoM.replace(',', '.')) || 0,
      ancho_m: Number(anchoM.replace(',', '.')) || 0,
      alto_m: Number(altoM.replace(',', '.')) || 0,
    };
  }, [tipoGeom, diametroM, largoM, anchoM, altoM]);

  // Cálculos matemáticos
  const hNum = Number(alturaCm.replace(',', '.')) || 0;
  const litrosCubicados = cubicarLitros(geom, hNum);
  const capCalculada = capacidadCalculada(geom);
  const saldoLibros = currentLevel?.current_l || 0;
  const diferencia = litrosCubicados - saldoLibros;

  // Tabla de aforo rápida (de 10 en 10 cm hasta la altura máxima)
  const tablaAforo = useMemo(() => {
    const maxH =
      tipoGeom === 'cilindrico_horizontal'
        ? (geom.radio_m || 0) * 2 * 100
        : (geom.alto_m || 0) * 100;
    const step = 10;
    const items: { cm: number; litros: number }[] = [];
    if (maxH <= 0) return [];
    for (let c = 10; c <= Math.min(maxH, 300); c += step) {
      items.push({ cm: c, litros: cubicarLitros(geom, c) });
    }
    return items;
  }, [geom, tipoGeom]);

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60, gap: spacing.md }}>
      {/* Encabezado Explicativo */}
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
          📐 Cubicación Geométrica de Tanques (Vara / Regleta)
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
          Convierte con exactitud física la altura del combustible medida en centímetros con la vara a litros
          reales. Permite calibrar y detectar mermas frente al saldo teórico en libros.
        </Text>
      </View>

      {/* Selector de Tanque */}
      <View>
        <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
          Tanque a Evaluar
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
          {activeTanks.map((t) => {
            const isSel = (currentTank?.id === t.id);
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => setSelectedTankId(t.id)}
                style={{
                  backgroundColor: isSel ? colors.primary : colors.surface,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: isSel ? colors.primary : colors.border,
                }}
              >
                <Text style={{ fontWeight: '800', fontSize: 13, color: isSel ? colors.primaryContrast : colors.text }}>
                  {t.name}
                </Text>
                <Text style={{ fontSize: 11, color: isSel ? colors.primaryContrast : colors.muted }}>
                  Rotulado: {fmtNum(t.capacity_l)} L
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Tipo de Geometría */}
      <View
        style={{
          backgroundColor: colors.surface,
          padding: spacing.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          gap: spacing.sm,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>Forma del Tanque</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {[
            { id: 'cilindrico_horizontal', label: 'Cilíndrico Horizontal (Cisterna/Bala)' },
            { id: 'rectangular', label: 'Rectangular (Caja)' },
            { id: 'cilindrico_vertical', label: 'Cilíndrico Vertical (Silo)' },
          ].map((item) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => setTipoGeom(item.id as any)}
              style={{
                flex: 1,
                paddingVertical: 8,
                paddingHorizontal: 6,
                backgroundColor: tipoGeom === item.id ? colors.surface : colors.surfaceAlt,
                borderWidth: 1,
                borderColor: tipoGeom === item.id ? colors.primary : colors.border,
                borderRadius: radius.sm,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: tipoGeom === item.id ? colors.primary : colors.text,
                  textAlign: 'center',
                }}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Inputs de dimensiones */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
          {tipoGeom === 'cilindrico_horizontal' ? (
            <>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Diámetro total (m)</Text>
                <TextInput
                  value={diametroM}
                  onChangeText={setDiametroM}
                  keyboardType="numeric"
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
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Largo (m)</Text>
                <TextInput
                  value={largoM}
                  onChangeText={setLargoM}
                  keyboardType="numeric"
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
            </>
          ) : (
            <>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Largo (m)</Text>
                <TextInput
                  value={largoM}
                  onChangeText={setLargoM}
                  keyboardType="numeric"
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
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Ancho (m)</Text>
                <TextInput
                  value={anchoM}
                  onChangeText={setAnchoM}
                  keyboardType="numeric"
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
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Altura total (m)</Text>
                <TextInput
                  value={altoM}
                  onChangeText={setAltoM}
                  keyboardType="numeric"
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
            </>
          )}
        </View>

        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
          Capacidad matemática al 100% de llenado: <Text style={{ fontWeight: '800', color: colors.text }}>{fmtNum(capCalculada)} L</Text>
        </Text>
      </View>

      {/* Medición de la Vara */}
      <View
        style={{
          backgroundColor: colors.surface,
          padding: spacing.md,
          borderRadius: radius.md,
          borderWidth: 2,
          borderColor: colors.primary,
          gap: spacing.sm,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: '900', color: colors.primary }}>
          📏 Lectura de Vara de Medición
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>
              Altura mojada en centímetros (cm)
            </Text>
            <TextInput
              value={alturaCm}
              onChangeText={setAlturaCm}
              keyboardType="numeric"
              placeholder="Ej. 85"
              placeholderTextColor={colors.muted}
              style={{
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.md,
                fontSize: 22,
                fontWeight: '900',
                color: colors.text,
                fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
              }}
            />
          </View>

          <View style={{ flex: 1.2, alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 11, color: colors.muted }}>Volumen Físico Calculado</Text>
            <Text
              style={{
                fontSize: 28,
                fontWeight: '900',
                color: colors.primary,
                fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
              }}
            >
              {fmtNum(litrosCubicados)} <Text style={{ fontSize: 14 }}>L</Text>
            </Text>
          </View>
        </View>

        {/* Comparativa contra Libros del Sistema */}
        <View
          style={{
            backgroundColor: colors.surfaceAlt,
            padding: spacing.md,
            borderRadius: radius.sm,
            marginTop: spacing.xs,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Saldo teórico en libros (sistema):</Text>
            <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>{fmtNum(saldoLibros)} L</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Saldo físico cubicado (vara):</Text>
            <Text style={{ fontSize: 12, fontWeight: '800', color: colors.primary }}>{fmtNum(litrosCubicados)} L</Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: 4,
              marginTop: 4,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>Diferencia / Desvío:</Text>
            <Text
              style={{
                fontSize: 13,
                fontWeight: '900',
                color: diferencia < -50 ? colors.danger : diferencia > 50 ? colors.accent : colors.successSoftText || colors.text,
              }}
            >
              {diferencia > 0 ? '+' : ''}{fmtNum(diferencia)} L
            </Text>
          </View>
        </View>
      </View>

      {/* Tabla de Aforo Rápido */}
      {tablaAforo.length > 0 && (
        <View
          style={{
            backgroundColor: colors.surface,
            padding: spacing.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: spacing.xs }}>
            📋 Tabla de Aforo Estimada (Cada 10 cm)
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {tablaAforo.map((row) => (
              <View
                key={row.cm}
                style={{
                  backgroundColor: colors.surfaceAlt,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: radius.sm,
                  minWidth: 95,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ fontSize: 10.5, fontWeight: '700', color: colors.muted }}>{row.cm} cm:</Text>
                <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.text }}>{fmtNum(row.litros)} L</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
