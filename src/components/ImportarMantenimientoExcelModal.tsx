// 📥 IMPORTAR EXCEL / CSV DE MANTENIMIENTOS PREVENTIVOS (24-nov-2026).
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { Card } from './ui';
import {
  leerFilasDesdeBufferExcel,
  parsearMatrizMantenimientoExcel,
  type MaquinaCatalogoExcel,
  type ResultadoParseoMantenimientoExcel,
} from '../lib/mantenimientoExcel';
import { cargarTodosServiciosPreventivos, registrarServicioPreventivo } from '../lib/mantenimientoPreventivoDb';

type Props = {
  visible: boolean;
  catalogo: MaquinaCatalogoExcel[];
  uid: string | null;
  nombreUsuario: string | null;
  onClose: () => void;
  onImportado: () => void;
};

export function ImportarMantenimientoExcelModal({ visible, catalogo, uid, nombreUsuario, onClose, onImportado }: Props) {
  const { colors } = useTheme();
  const toast = useToast();

  const [archivoNombre, setArchivoNombre] = useState('');
  const [analizando, setAnalizando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState('');
  const [resultado, setResultado] = useState<ResultadoParseoMantenimientoExcel | null>(null);

  const seleccionarArchivoWeb = () => {
    if (Platform.OS !== 'web') {
      toast.error('La carga de archivos Excel está disponible desde la versión web.');
      return;
    }
    const doc = (globalThis as any).document;
    if (!doc) return;
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv';
    input.onchange = async (e: any) => {
      const file = e?.target?.files?.[0];
      if (!file) return;
      setArchivoNombre(file.name);
      setAnalizando(true);
      setResultado(null);
      try {
        const buf = await file.arrayBuffer();
        const rows = leerFilasDesdeBufferExcel(buf);
        const existentes = await cargarTodosServiciosPreventivos();
        const res = parsearMatrizMantenimientoExcel(rows, catalogo, existentes);
        setResultado(res);
      } catch (err: any) {
        toast.error(err?.message || 'No se pudo leer el archivo Excel/CSV.');
      } finally {
        setAnalizando(false);
      }
    };
    input.click();
  };

  const confirmarImportacion = async () => {
    if (!resultado || resultado.nuevos.length === 0 || guardando) return;
    setGuardando(true);
    let okCount = 0;
    let errCount = 0;
    let primerError = '';
    const ultimaBasePorMaquina = new Map<string, number>();

    // Inicializar con el horómetro base actual del catálogo
    catalogo.forEach((m) => {
      if (m.horometro_base != null) ultimaBasePorMaquina.set(m.id, m.horometro_base);
    });

    for (let i = 0; i < resultado.nuevos.length; i++) {
      const s = resultado.nuevos[i];
      setProgreso(`Registrando ${i + 1} de ${resultado.nuevos.length}…`);
      const notasPartes = [
        `Importado de Excel (${s.mesEtiqueta})`,
        s.litros != null ? `Litros: ${s.litros} L` : null,
        s.ubicacion ? `Ubicación: ${s.ubicacion}` : null,
        s.proximoCambioPlanilla != null ? `Próx. cambio planilla: ${s.proximoCambioPlanilla} h` : null,
      ].filter(Boolean);

      const horoAnt = ultimaBasePorMaquina.get(s.machineryId) ?? s.horometroBaseActual ?? null;
      const r = await registrarServicioPreventivo({
        machineryId: s.machineryId,
        horometroServicio: s.horometroServicio,
        horometroAnterior: horoAnt,
        lastHorometro: s.lastHorometro,
        fechaServicioISO: `${s.fechaServicio}T12:00:00-04:00`,
        notas: notasPartes.join(' · '),
        uid,
        nombreUsuario,
      });
      if (r.ok) {
        okCount += 1;
        ultimaBasePorMaquina.set(s.machineryId, s.horometroServicio);
      } else {
        errCount += 1;
        if (!primerError && r.error) primerError = r.error;
      }
    }

    setGuardando(false);
    setProgreso('');
    if (okCount > 0) {
      toast.success(`Se registraron ${okCount} mantenimiento(s) desde Excel${errCount ? ` (${errCount} con error)` : ''}.`);
      onImportado();
      onClose();
    } else {
      toast.error(primerError || 'No se pudo registrar ningún mantenimiento.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing.md }}>
        <View style={{ width: '100%', maxWidth: 620, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }}>
              📥 Importar mantenimientos desde Excel / CSV
            </Text>
            <TouchableOpacity onPress={onClose} style={{ padding: spacing.xs }}>
              <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Sube la planilla de control de cambios de aceite (`.xlsx`, `.xls` o `.csv`) con columnas de Equipo, Serial/Placa, Horómetro Actual, Próximo Cambio, Fecha, LT y Ubicación. El sistema cruza por Serial/Placa, evita duplicados y deja el servicio más reciente como base vigente.
            </Text>

            <TouchableOpacity
              onPress={seleccionarArchivoWeb}
              disabled={analizando || guardando}
              style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm + 2, alignItems: 'center', opacity: (analizando || guardando) ? 0.6 : 1 }}
            >
              <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>
                {archivoNombre ? `📄 Cambiar archivo (${archivoNombre})` : '📂 Seleccionar archivo Excel / CSV'}
              </Text>
            </TouchableOpacity>

            {analizando ? (
              <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
                <ActivityIndicator />
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Analizando planilla y cruzando con el catálogo…</Text>
              </View>
            ) : null}

            {resultado ? (
              <>
                <Card style={{ backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13.5 }}>
                    📊 Resumen del archivo
                  </Text>
                  <Text style={{ color: colors.success, fontWeight: '800', fontSize: 12.5, marginTop: 4 }}>
                    ✅ {resultado.nuevos.length} servicio(s) nuevos listos para registrar ({resultado.maquinasCoincidentes} máquina(s))
                  </Text>
                  {resultado.duplicados > 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                      ⏭️ {resultado.duplicados} servicio(s) ya registrados en el historial (se omiten)
                    </Text>
                  ) : null}
                  {resultado.omitidas.length > 0 ? (
                    <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12, marginTop: 2 }}>
                      ⚠️ {resultado.omitidas.length} fila(s) sin coincidencia de Serial/Placa en el catálogo
                    </Text>
                  ) : null}
                </Card>

                {resultado.nuevos.length > 0 ? (
                  <View style={{ gap: spacing.xs }}>
                    <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 11.5 }}>
                      VISTA PREVIA DE SERVICIOS A REGISTRAR ({resultado.nuevos.length})
                    </Text>
                    {resultado.nuevos.slice(0, 40).map((s, idx) => (
                      <Card key={`${s.machineryId}-${s.fechaServicio}-${s.horometroServicio}-${idx}`} style={{ padding: spacing.sm }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, flex: 1 }}>
                            🚜 {s.machineCode} · Placa/Serial: {s.machinePlate || s.serialPlacaPlanilla}
                          </Text>
                          <Text style={{ color: colors.success, fontWeight: '900', fontSize: 12 }}>{s.horometroServicio} h</Text>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
                          📅 {s.fechaServicio}
                          {s.litros != null ? ` · 🛢️ ${s.litros} L` : ''}
                          {s.ubicacion ? ` · 📍 ${s.ubicacion}` : ''}
                        </Text>
                      </Card>
                    ))}
                    {resultado.nuevos.length > 40 ? (
                      <Text style={{ color: colors.muted, fontSize: 11.5, textAlign: 'center' }}>
                        … y {resultado.nuevos.length - 40} servicio(s) más.
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {resultado.omitidas.length > 0 ? (
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 11.5 }}>
                      FILAS SIN COINCIDENCIA EN CATÁLOGO ({resultado.omitidas.length})
                    </Text>
                    {resultado.omitidas.slice(0, 15).map((o, idx) => (
                      <Text key={`${o.filaExcel}-${idx}`} style={{ color: colors.muted, fontSize: 11.5 }}>
                        • Fila {o.filaExcel}: {o.equipo} ({o.serialPlaca})
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}

            {guardando ? (
              <View style={{ paddingVertical: spacing.sm, alignItems: 'center' }}>
                <ActivityIndicator />
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12, marginTop: 4 }}>{progreso}</Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
              <TouchableOpacity
                onPress={onClose}
                disabled={guardando}
                style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm + 2, alignItems: 'center' }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmarImportacion}
                disabled={guardando || !resultado || resultado.nuevos.length === 0}
                style={{ flex: 2, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.sm + 2, alignItems: 'center', opacity: (guardando || !resultado || resultado.nuevos.length === 0) ? 0.5 : 1 }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                  {guardando ? 'Registrando…' : `✅ Registrar ${resultado?.nuevos.length ?? 0} mantenimiento(s)`}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
