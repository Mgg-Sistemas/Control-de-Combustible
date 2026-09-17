// HISTORIAL DE ENTREGAS DE UN TICKET · la ventana (14-sep-2026).
//
// Pedido del cliente: que la pastilla «entregado ×7», al tocarla, muestre quién
// imprimió o reimprimió ese ticket y a qué hora. Y poder borrar una entrega,
// quedando quién la borró.
//
// ⭐ BORRAR ES TACHAR. La ventana no cambia filas: llama a `anularEmision`, que le
//    pide a la base que la marque. La base pone el nombre de la sesión, no uno
//    que mande el teléfono. Qué dice cada renglón y en qué orden lo decide
//    `tiqueHistorial.ts`, que se prueba sin pantalla.
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useConfirm } from './ConfirmProvider';
import { useToast } from './ToastProvider';
import { anularEmision, contarPendientesDeFolio, listarEmisionesDeFolio } from '../lib/tiqueEmisiones';
import { filasDelHistorial, resumenHistorial, type FilaHistorial } from '../lib/tiqueHistorial';

export function HistorialTiqueModal({
  folio,
  onClose,
  puedeBorrar = false,
  onCambio,
}: {
  folio: string | null;
  onClose: () => void;
  /** Nivel completo del módulo, el mismo que puede borrar viajes. */
  puedeBorrar?: boolean;
  /** Se avisa al borrar, para que la pantalla recuente la pastilla. */
  onCambio?: (folio: string) => void;
}) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const [cargando, setCargando] = useState(false);
  const [filas, setFilas] = useState<FilaHistorial[]>([]);
  const [resumen, setResumen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  /** Sube en cada borrado: vuelve a leer el historial desde la base. */
  const [vuelta, setVuelta] = useState(0);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  // El state no cambia hasta el próximo render: sin esto, dos toques seguidos
  // mandaban dos borrados de la misma entrega.
  const borrandoRef = useRef(false);
  const ultimoFolioRef = useRef<string | null>(null);

  useEffect(() => {
    if (!folio) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    setPendientes(0);
    // Otro ticket: se limpia. El mismo ticket después de borrar: se deja lo que
    // se ve mientras relee, para que la lista no parpadee.
    if (ultimoFolioRef.current !== folio) { setFilas([]); setResumen(''); }
    ultimoFolioRef.current = folio;
    Promise.all([listarEmisionesDeFolio(folio), contarPendientesDeFolio(folio)])
      .then(([r, p]) => {
        if (!vivo) return;
        // ⚠️ Un fallo de lectura NO se muestra como «no hay entregas». Sería
        //    decirle a la jefa que un ticket no se entregó cuando no se sabe.
        if (r.sinTabla) setError('Falta correr el SQL de la ticketera.');
        else if (r.error) setError(r.error);
        setFilas(filasDelHistorial(r.filas));
        setResumen(resumenHistorial(r.filas));
        setPendientes(p);
      })
      .catch((e: any) => { if (vivo) setError(String(e?.message ?? e)); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [folio, vuelta]);

  const onBorrarEntrega = async (f: FilaHistorial) => {
    if (!folio || borrandoRef.current) return;
    const ok = await confirm({
      title: 'Borrar entrega',
      message: `¿Borrar la entrega del ${f.cuando} (${f.quien}) del ticket ${folio}? Deja de contar, pero queda tachada en el historial con tu nombre. No se puede deshacer.`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    borrandoRef.current = true;
    setBorrandoId(f.id);
    try {
      const r = await anularEmision(f.id);
      if (!r.ok) { toast.error(`No se pudo borrar la entrega: ${r.error}`); return; }
      toast.success(r.yaEstaba ? 'Esa entrega ya estaba borrada.' : 'Entrega borrada.');
      setVuelta((v) => v + 1);
      onCambio?.(folio);
    } finally {
      borrandoRef.current = false;
      setBorrandoId(null);
    }
  };

  return (
    <Modal visible={!!folio} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '82%' }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>🎫 Entregas del ticket {folio}</Text>
          {!cargando && !error ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{resumen}</Text>
          ) : null}

          {pendientes > 0 ? (
            <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, padding: spacing.sm, marginTop: spacing.sm }}>
              <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12 }}>
                ⏳ {pendientes} {pendientes === 1 ? 'entrega de este ticket está' : 'entregas de este ticket están'} en este teléfono sin subir. Todavía no salen en la lista; suben solas al volver la señal.
              </Text>
            </View>
          ) : null}

          {cargando && filas.length === 0 ? (
            <Text style={{ color: colors.muted, marginTop: spacing.md }}>Leyendo el historial…</Text>
          ) : error ? (
            <Text style={{ color: colors.danger, fontWeight: '700', marginTop: spacing.md }}>
              ⚠️ No se pudo leer el historial ({error}). Eso no quiere decir que no se haya entregado.
            </Text>
          ) : (
            <ScrollView style={{ marginTop: spacing.sm }} nestedScrollEnabled>
              {filas.map((f) => (
                <View key={f.clave} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm, opacity: f.borrada ? 0.6 : 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={{ color: f.borrada ? colors.muted : f.esReimpresion ? colors.warning : colors.success, fontWeight: '800', fontSize: 13, textDecorationLine: f.borrada ? 'line-through' : 'none' }}>
                      {f.n != null ? `${f.n}. ` : ''}{f.esReimpresion ? '🔁' : '✅'} {f.titulo}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{f.cuando}</Text>
                  </View>
                  <Text style={{ color: colors.text, fontSize: 13, marginTop: 2 }}>👤 {f.quien}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>🏗️ {f.donde} · {f.medio}</Text>
                  {f.borrada ? (
                    <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: 2 }}>🗑️ {f.borradaTexto}</Text>
                  ) : puedeBorrar ? (
                    <TouchableOpacity
                      onPress={() => onBorrarEntrega(f)}
                      disabled={borrandoId !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`Borrar la entrega ${f.n ?? ''} del ticket ${folio}`}
                      style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    >
                      <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '800' }}>
                        {borrandoId === f.id ? 'Borrando…' : '🗑️ Borrar'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
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
