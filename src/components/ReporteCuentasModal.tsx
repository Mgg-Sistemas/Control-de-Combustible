// 📄 REPORTE DE CUENTAS (Compras → 💸 Por pagar / 💰 Por cobrar) — 28-oct-2026.
//
// Pedido: «necesito poder sacar un reporte de los que yo selecciono o de todos,
// o lo que yo agrupe». La ventana de opciones del reporte; la lógica (elegir,
// agrupar, sumar, HTML y nombre de archivo) vive en src/lib/cuentasReporte.ts.
//
// ⚠️ Se monta AL FINAL del árbol de CuentasTab y solo mientras está abierta: en
//    web todos los Modal empatan en z-index y gana el último montado.
// ⚠️ Nada con TextInput se declara dentro del componente como <Etiqueta/>
//    (scripts/test-inputs-no-pierden-foco.mjs): el campo del título va directo.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen, SectionTitle, Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { Toggle } from './CubicajeTab';
import { pdfDocument, exportPdf } from '../lib/pdf';
import { LOGOS_POR_DEFECTO, type LogosReporte } from '../lib/cubicaje';
import {
  OPCIONES_CUENTAS_POR_DEFECTO, COLUMNAS_POR_DEFECTO, columnasCuentas, agrupacionesCuentas,
  elegirCuentas, reporteEsFiltrado, armarReporteCuentas, totalesDe, usdTexto, tasaTexto, tituloPorDefecto,
  type CuentaParaReporte, type OpcionesReporteCuentas, type TipoCuentaReporte, type ColumnaCuenta,
} from '../lib/cuentasReporte';

const LOGOS: [keyof LogosReporte, string][] = [
  ['bcv', '🏛️ Banco Central de Venezuela (BCV)'],
  ['sos', '🌴 SOS La Guaira'],
  ['golden', '✨ Golden Touch'],
  ['renace', '🇻🇪 Plan Venezuela Renace'],
  ['jhenzaen', '🏢 Jhenzaen 2.012 C.A'],
];

/** Pastilla de elección única (sin TextInput: puede ser componente). */
function Pastilla({ on, label, onPress, disabled }: { on: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, opacity: disabled ? 0.45 : 1 }}
    >
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ReporteCuentasModal({ tipo, lista, todas, universo, marcadas, tasaBcv, hoy, onClose }: {
  tipo: TipoCuentaReporte;
  /** Lo que se ve ahora en la pestaña (con sus filtros). */
  lista: CuentaParaReporte[];
  /** Todas las cuentas de la pestaña, en el orden de la pantalla. */
  todas: CuentaParaReporte[];
  /** La lista SIN filtro de empresa ni búsqueda: contra ella se decide «FILTRADO». */
  universo: CuentaParaReporte[];
  marcadas: ReadonlySet<string>;
  tasaBcv: number | null;
  hoy: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const clave = `reporteCuentas.${tipo}.v1`;
  const nMarcadas = useMemo(() => todas.filter((c) => marcadas.has(c.id)).length, [todas, marcadas]);
  const [op, setOpState] = useState<OpcionesReporteCuentas>({
    ...OPCIONES_CUENTAS_POR_DEFECTO,
    alcance: nMarcadas > 0 ? 'marcadas' : 'todas',
  });
  const [logos, setLogos] = useState<LogosReporte>(LOGOS_POR_DEFECTO);
  const [generando, setGenerando] = useState(false);

  // Lo elegido se recuerda en este equipo (menos el alcance, que depende de las marcas de ahora).
  useEffect(() => {
    AsyncStorage.getItem(clave).then((raw) => {
      if (!raw) return;
      try {
        const g = JSON.parse(raw);
        if (g?.op) setOpState((prev) => ({
          ...prev,
          ...g.op,
          alcance: prev.alcance,
          columnas: { ...COLUMNAS_POR_DEFECTO, ...(g.op.columnas ?? {}) },
        }));
        if (g?.logos) setLogos({ ...LOGOS_POR_DEFECTO, ...g.logos });
      } catch { /* preferencia dañada: quedan las de fábrica */ }
    }).catch(() => {});
  }, [clave]);

  const guardar = (o: OpcionesReporteCuentas, l: LogosReporte) => {
    const { alcance: _a, ...resto } = o;
    AsyncStorage.setItem(clave, JSON.stringify({ op: resto, logos: l })).catch(() => {});
  };
  const setOp = <K extends keyof OpcionesReporteCuentas>(k: K, v: OpcionesReporteCuentas[K]) => {
    setOpState((prev) => { const n = { ...prev, [k]: v }; guardar(n, logos); return n; });
  };
  const setCol = (k: ColumnaCuenta, v: boolean) => {
    setOpState((prev) => { const n = { ...prev, columnas: { ...prev.columnas, [k]: v } }; guardar(n, logos); return n; });
  };
  const setLogo = (k: keyof LogosReporte, v: boolean) => {
    setLogos((prev) => { const n = { ...prev, [k]: v }; guardar(op, n); return n; });
  };

  const elegidas = useMemo(() => elegirCuentas(lista, todas, marcadas, op.alcance), [lista, todas, marcadas, op.alcance]);
  const filtrado = useMemo(() => reporteEsFiltrado(elegidas, universo), [elegidas, universo]);
  const tot = useMemo(() => totalesDe(elegidas), [elegidas]);

  const generar = async () => {
    if (elegidas.length === 0) {
      toast.error(op.alcance === 'marcadas' ? 'No has marcado ninguna cuenta.' : 'La lista está vacía.');
      return;
    }
    setGenerando(true);
    try {
      const r = armarReporteCuentas({ tipo, cuentas: elegidas, op, tasaBcv, hoyISO: hoy, filtrado });
      const html = pdfDocument({
        title: r.titulo,
        subtitle: r.subtitulo,
        body: r.cuerpo,
        extraCss: r.css,
        logos,
        marcaTexto: op.verMarcaTexto === true,
        verEmitida: op.verFechaEmision !== false,
      });
      await exportPdf(html, r.nombreArchivo);
    } catch (e: any) {
      toast.error(`No se pudo generar el reporte: ${e?.message ?? e}`);
    } finally {
      setGenerando(false);
    }
  };

  const cols = columnasCuentas(tipo);
  const nColsOn = cols.filter(([k]) => op.columnas[k] !== false).length;
  const caja = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm } as const;
  const tituloCaja = { color: colors.text, fontWeight: '800' as const, fontSize: 12, marginBottom: spacing.xs };
  const accion = { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt } as const;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Screen>
        <ScrollView>
          <SectionTitle>📄 Reporte · {tituloPorDefecto(tipo)}</SectionTitle>

          {/* ── 1. QUÉ CUENTAS ── */}
          <View style={caja}>
            <Text style={tituloCaja}>QUÉ CUENTAS</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Pastilla on={op.alcance === 'marcadas'} disabled={nMarcadas === 0} label={`☑ Las que marqué (${nMarcadas})`} onPress={() => setOp('alcance', 'marcadas')} />
              <Pastilla on={op.alcance === 'todas'} label={`📋 Todas las de la lista (${lista.length})`} onPress={() => setOp('alcance', 'todas')} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>
              {op.alcance === 'marcadas'
                ? 'Entran todas las que marcaste, aunque el filtro de ahora las esconda.'
                : 'Entra la lista tal como la ves: empresa(s), búsqueda y pagadas/anuladas visibles.'}
            </Text>
            <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800', marginTop: 4 }}>
              Saldrán {tot.cantidad} cuenta(s) · saldo {usdTexto(tot.saldo)}{tasaBcv && op.columnas.bs !== false ? ` · ≈ Bs con tasa ${tasaTexto(tasaBcv)}` : ''}
            </Text>
            {filtrado && elegidas.length > 0 ? (
              <Text style={{ color: colors.warningSoftText, fontSize: 11, fontWeight: '700', marginTop: 2 }}>
                Es una parte de la lista: el papel sale marcado «FILTRADO».
              </Text>
            ) : null}
          </View>

          {/* ── 2. AGRUPAR ── */}
          <View style={caja}>
            <Text style={tituloCaja}>AGRUPAR POR</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {agrupacionesCuentas(tipo).map(([k, label]) => (
                <Pastilla key={`rca-${k}`} on={op.agrupar === k} label={label} onPress={() => setOp('agrupar', k)} />
              ))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>
              Cada grupo lleva su subtotal y al final va el total general.{op.agrupar === 'vencimiento' ? ' Tramos: vencidas · por vencer (7 días) · al día · sin fecha · pagadas o anuladas.' : ''}
            </Text>
          </View>

          {/* ── 3. COLUMNAS ── */}
          <View style={caja}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, marginBottom: spacing.xs }}>
              <Text style={[tituloCaja, { marginBottom: 0 }]}>COLUMNAS ({nColsOn} de {cols.length})</Text>
              <TouchableOpacity onPress={() => { const n = { ...op, columnas: { ...COLUMNAS_POR_DEFECTO } }; setOpState(n); guardar(n, logos); }} style={accion}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>✓ Todas</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Lo que apagues no sale en ninguna parte del papel (ni en la tabla ni en el resumen).</Text>
            {cols.map(([k, label]) => (
              <Toggle
                key={`rcc-${k}`}
                on={op.columnas[k] !== false}
                label={k === 'bs' ? '💱 Equivalente en Bs (saldo)' : label}
                ayuda={k === 'bs'
                  ? (tasaBcv ? `Con la tasa BCV de hoy: Bs ${tasaTexto(tasaBcv)} por $. El papel dice la tasa usada.` : 'Hoy no hay tasa BCV cargada: el reporte sale sin Bs.')
                  : undefined}
                onPress={() => setCol(k, op.columnas[k] === false)}
              />
            ))}
          </View>

          {/* ── 4. TÍTULO Y MEMBRETE ── */}
          <View style={caja}>
            <Text style={tituloCaja}>TÍTULO Y MEMBRETE</Text>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>✏️ Título propio (opcional):</Text>
            <TextInput
              value={op.titulo}
              onChangeText={(t) => setOp('titulo', t)}
              placeholder={`Por defecto: ${tituloPorDefecto(tipo)}`}
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 12, marginBottom: spacing.xs }}
            />
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>🏷️ Logos:</Text>
            {LOGOS.map(([k, label]) => (
              <Toggle key={`rcl-${k}`} on={logos[k]} label={label} onPress={() => setLogo(k, !logos[k])} />
            ))}
            <Toggle
              on={op.verMarcaTexto === true}
              label="📝 Marca institucional de texto («Banco Central de Venezuela / SOS La Guaira»)"
              onPress={() => setOp('verMarcaTexto', op.verMarcaTexto !== true)}
            />
            <Toggle
              on={op.verFechaEmision !== false}
              label="📅 Fecha y hora de emisión («Emitida: …»)"
              onPress={() => setOp('verFechaEmision', op.verFechaEmision === false)}
            />
          </View>

          <Card>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              El alcance, la agrupación y las columnas apagadas van en el NOMBRE del archivo, no en el papel. Los montos van en US$.
            </Text>
          </Card>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.lg }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={generar}
              disabled={generando || elegidas.length === 0}
              style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: generando || elegidas.length === 0 ? 0.5 : 1 }}
            >
              <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{generando ? 'Generando…' : `🖨️ Generar PDF (${elegidas.length})`}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Screen>
    </Modal>
  );
}
