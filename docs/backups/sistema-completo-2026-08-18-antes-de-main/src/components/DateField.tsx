import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

// ── Utilidades de fecha ISO (sin dependencias externas) ───────────────────────
const pad = (n: number) => `${n}`.padStart(2, '0');
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DOW = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

/** "AAAA-MM-DD" → "DD/MM/AAAA" para mostrar (el valor guardado sigue en ISO). */
function fmtDMY(iso?: string | null): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}
function parseISO(iso?: string | null): { y: number; m: number; d: number } | null {
  const [y, m, d] = (iso || '').split('-').map((n) => parseInt(n, 10));
  return y && m && d ? { y, m: m - 1, d } : null;
}

type Props = {
  value: string;                 // fecha en ISO "AAAA-MM-DD"
  onChange: (iso: string) => void;
  placeholder?: string;
  minISO?: string;               // fecha mínima seleccionable (opcional)
  maxISO?: string;               // fecha máxima seleccionable (opcional)
};

/**
 * Campo de fecha que abre un CALENDARIO para seleccionar (el usuario nunca
 * escribe, así se evitan errores de formato). Guarda/entrega el valor en ISO.
 */
export function DateField({ value, onChange, placeholder = 'Seleccionar fecha', minISO, maxISO }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const sel = parseISO(value);
  const today = new Date();
  // Mes que se está viendo en el calendario (arranca en la fecha seleccionada o hoy).
  const [view, setView] = useState(() => ({
    y: sel ? sel.y : today.getFullYear(),
    m: sel ? sel.m : today.getMonth(),
  }));

  // Al abrir, sincroniza el mes visible con la fecha seleccionada.
  const openCal = () => {
    const s = parseISO(value);
    setView({ y: s ? s.y : today.getFullYear(), m: s ? s.m : today.getMonth() });
    setOpen(true);
  };

  const grid = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const lead = (first.getDay() + 6) % 7; // lunes = 0
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [view]);

  const stepMonth = (delta: number) => {
    let m = view.m + delta;
    let y = view.y;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setView({ y, m });
  };

  const disabled = (iso: string) => (minISO && iso < minISO) || (maxISO && iso > maxISO);

  const pick = (d: number) => {
    const iso = toISO(view.y, view.m, d);
    if (disabled(iso)) return;
    onChange(iso);
    setOpen(false);
  };

  const isToday = (d: number) => view.y === today.getFullYear() && view.m === today.getMonth() && d === today.getDate();
  const isSel = (d: number) => sel && sel.y === view.y && sel.m === view.m && sel.d === d;

  // En WEB usamos el selector de fecha NATIVO del navegador. El usuario puede
  // ESCRIBIR los números directo (día/mes/año) o abrir el calendario con el
  // iconito. No forzamos el calendario para no interrumpir la escritura.
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date',
      value: value || '',
      min: minISO || undefined,
      max: maxISO || undefined,
      onChange: (e: any) => onChange(e.target.value),
      style: {
        padding: '10px', borderRadius: '12px', border: '1px solid ' + colors.border,
        background: colors.surface, color: colors.text, fontSize: '15px', width: '100%',
        boxSizing: 'border-box',
      },
    });
  }

  return (
    <>
      <TouchableOpacity
        onPress={openCal}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
          paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.surface,
        }}
      >
        <Text style={{ color: value ? colors.text : colors.muted, fontSize: 15 }}>
          {value ? fmtDMY(value) : placeholder}
        </Text>
        <Text style={{ fontSize: 16 }}>📅</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}
            style={{ width: 320, maxWidth: '100%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border }}>
            {/* Encabezado: mes/año con flechas */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <TouchableOpacity onPress={() => stepMonth(-1)} style={{ padding: spacing.sm }}>
                <Text style={{ fontSize: 22, color: colors.primary, fontWeight: '800' }}>‹</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{MESES[view.m]} {view.y}</Text>
              <TouchableOpacity onPress={() => stepMonth(1)} style={{ padding: spacing.sm }}>
                <Text style={{ fontSize: 22, color: colors.primary, fontWeight: '800' }}>›</Text>
              </TouchableOpacity>
            </View>

            {/* Nombres de los días */}
            <View style={{ flexDirection: 'row' }}>
              {DOW.map((d) => (
                <Text key={d} style={{ width: `${100 / 7}%`, textAlign: 'center', color: colors.muted, fontSize: 12, fontWeight: '700', paddingBottom: 4 }}>{d}</Text>
              ))}
            </View>

            {/* Cuadrícula de días */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {grid.map((d, i) => {
                if (d == null) return <View key={i} style={{ width: `${100 / 7}%`, height: 40 }} />;
                const iso = toISO(view.y, view.m, d);
                const off = disabled(iso);
                const selected = isSel(d);
                return (
                  <View key={i} style={{ width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                    <TouchableOpacity
                      onPress={() => pick(d)}
                      disabled={!!off}
                      activeOpacity={0.7}
                      style={{
                        width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: selected ? colors.primary : 'transparent',
                        borderWidth: !selected && isToday(d) ? 1 : 0, borderColor: colors.primary,
                        opacity: off ? 0.25 : 1,
                      }}
                    >
                      <Text style={{ color: selected ? colors.primaryContrast : colors.text, fontWeight: selected ? '800' : '600', fontSize: 14 }}>{d}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {/* Acciones rápidas */}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity
                onPress={() => { const iso = toISO(today.getFullYear(), today.getMonth(), today.getDate()); if (!disabled(iso)) { onChange(iso); setOpen(false); } }}
                style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Hoy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }}
              >
                <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 13 }}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export default DateField;
