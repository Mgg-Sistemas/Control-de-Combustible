// HISTORIAL DE ENTREGAS DE UN TIQUE · la ventana (14-sep-2026).
//
// Pedido del cliente: que la pastilla «entregado ×7», al tocarla, muestre quién
// imprimió o reimprimió ese tique y a qué hora.
//
// ⭐ LEE, NO ESCRIBE. La constancia es un libro de solo agregar; esta ventana
//    solo lo muestra. Qué dice cada renglón y en qué orden lo decide
//    `tiqueHistorial.ts`, que se prueba sin pantalla.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { contarPendientesDeFolio, listarEmisionesDeFolio } from '../lib/tiqueEmisiones';
import { filasDelHistorial, resumenHistorial, type FilaHistorial } from '../lib/tiqueHistorial';

export function HistorialTiqueModal({ folio, onClose }: { folio: string | null; onClose: () => void }) {
  const { colors } = useTheme();
  const [cargando, setCargando] = useState(false);
  const [filas, setFilas] = useState<FilaHistorial[]>([]);
  const [resumen, setResumen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    if (!folio) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    setFilas([]);
    setResumen('');
    setPendientes(0);
    Promise.all([listarEmisionesDeFolio(folio), contarPendientesDeFolio(folio)])
      .then(([r, p]) => {
        if (!vivo) return;
        // ⚠️ Un fallo de lectura NO se muestra como «no hay entregas». Sería
        //    decirle a la jefa que un tique no se entregó cuando no se sabe.
        if (r.sinTabla) setError('Falta correr el SQL de la tiquetera.');
        else if (r.error) setError(r.error);
        setFilas(filasDelHistorial(r.filas));
        setResumen(resumenHistorial(r.filas));
        setPendientes(p);
      })
      .catch((e: any) => { if (vivo) setError(String(e?.message ?? e)); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [folio]);

  return (
    <Modal visible={!!folio} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '82%' }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>🎫 Entregas del tique {folio}</Text>
          {!cargando && !error ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{resumen}</Text>
          ) : null}

          {pendientes > 0 ? (
            <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, padding: spacing.sm, marginTop: spacing.sm }}>
              <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12 }}>
                ⏳ {pendientes} {pendientes === 1 ? 'entrega de este tique está' : 'entregas de este tique están'} en este teléfono sin subir. Todavía no salen en la lista; suben solas al volver la señal.
              </Text>
            </View>
          ) : null}

          {cargando ? (
            <Text style={{ color: colors.muted, marginTop: spacing.md }}>Leyendo el historial…</Text>
          ) : error ? (
            <Text style={{ color: colors.danger, fontWeight: '700', marginTop: spacing.md }}>
              ⚠️ No se pudo leer el historial ({error}). Eso no quiere decir que no se haya entregado.
            </Text>
          ) : (
            <ScrollView style={{ marginTop: spacing.sm }} nestedScrollEnabled>
              {filas.map((f) => (
                <View key={f.clave} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={{ color: f.esReimpresion ? colors.warning : colors.success, fontWeight: '800', fontSize: 13 }}>
                      {f.n}. {f.esReimpresion ? '🔁' : '✅'} {f.titulo}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{f.cuando}</Text>
                  </View>
                  <Text style={{ color: colors.text, fontSize: 13, marginTop: 2 }}>👤 {f.quien}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>🏗️ {f.donde} · {f.medio}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
