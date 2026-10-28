// ⚖️ REPORTE DE TARAS POR CAMIÓN (06-oct-2026) — el botón y sus opciones.
//
// Vive dentro de «⚙️ Configuración → ⚖️ Tara de romana por camión» (solo full).
// La matemática y el HTML están en `src/lib/reporteTaras.ts`; acá solo hay
// interruptores y el membrete. Las opciones se recuerdan en el equipo: el
// reporte se pide siempre igual (sin empresas, con el logo de Jhenzaen) y
// desmarcarlo todo cada vez era invitar a que un día saliera con nombres.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { Toggle } from './CubicajeTab';
import { pdfDocument, exportPdf } from '../lib/pdf';
import { LOGOS_POR_DEFECTO, type LogosReporte } from '../lib/cubicaje';
import { UNIDADES_PESO } from '../lib/viajesPeso';
import { caracasBusinessToday } from '../lib/caracasDay';
import { listOperatorAssignments } from '../lib/machineOperators';
import {
  OPCIONES_TARAS_POR_DEFECTO, cuerpoReporteTaras, resumenTaras, resumenCombustibleTaras, subtituloReporteTaras,
  nombreArchivoTaras, CSS_REPORTE_TARAS, litrosTexto,
  type CamionParaTara, type TaraParaReporte, type OpcionesReporteTaras,
} from '../lib/reporteTaras';

const CLAVE = 'reporteTaras.opciones.v1';

const LOGOS: [keyof LogosReporte, string][] = [
  ['bcv', 'BCV'],
  ['sos', 'SOS La Guaira'],
  ['golden', 'Golden Touch'],
  ['renace', 'Plan Venezuela Renace'],
  ['jhenzaen', 'Jhenzaen 2.012 C.A'],
];

export function ReporteTarasBox({ camiones, taras, fechaCombustible }: {
  camiones: CamionParaTara[];
  taras: Map<string, TaraParaReporte>;
  fechaCombustible?: string;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [op, setOpState] = useState<OpcionesReporteTaras>(OPCIONES_TARAS_POR_DEFECTO);
  const [logos, setLogos] = useState<LogosReporte>(LOGOS_POR_DEFECTO);
  const [generando, setGenerando] = useState(false);
  // 🏙 El interruptor de «una sola empresa» con el campo vacío: encendido pero
  // sin efecto hasta que se escriba el nombre (igual que en frentes).
  const [empresaUnicaOn, setEmpresaUnicaOn] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CLAVE).then((raw) => {
      if (!raw) return;
      const g = JSON.parse(raw);
      if (g?.op) setOpState({ ...OPCIONES_TARAS_POR_DEFECTO, ...g.op });
      if (g?.logos) setLogos({ ...LOGOS_POR_DEFECTO, ...g.logos });
    }).catch(() => {});
  }, []);
  const guardar = (o: OpcionesReporteTaras, l: LogosReporte) => {
    AsyncStorage.setItem(CLAVE, JSON.stringify({ op: o, logos: l })).catch(() => {});
  };
  const setOp = <K extends keyof OpcionesReporteTaras>(k: K, v: OpcionesReporteTaras[K]) => {
    setOpState((prev) => { const n = { ...prev, [k]: v }; guardar(n, logos); return n; });
  };
  const setLogo = (k: keyof LogosReporte, v: boolean) => {
    setLogos((prev) => { const n = { ...prev, [k]: v }; guardar(op, n); return n; });
  };

  const r = resumenTaras(camiones, taras);
  const rComb = resumenCombustibleTaras(camiones, taras, op.alcance);
  const fechaCombDmy = fechaCombustible && /^\d{4}-\d{2}-\d{2}$/.test(fechaCombustible)
    ? `${fechaCombustible.slice(8, 10)}/${fechaCombustible.slice(5, 7)}/${fechaCombustible.slice(0, 4)}`
    : null;

  const generar = async () => {
    if (op.alcance === 'conTara' && r.conTara === 0) {
      toast.error('Todavía no hay camiones con tara cargada. Usa «Toda la flota» para ver cuáles faltan.');
      return;
    }
    setGenerando(true);
    try {
      // 👤 Los choferes se leen SOLO si la columna está encendida, y en el
      // momento de generar: así el papel sale con lo que esté asignado ahora
      // y no se consulta de más cuando la columna está apagada.
      let camionesPdf = camiones;
      if (op.chofer === true) {
        const { rows } = await listOperatorAssignments();
        const dia = new Map<string, string>();
        const noche = new Map<string, string>();
        rows.forEach((a) => (a.shift === 'night' ? noche : dia).set(a.machinery_id, a.operator_name));
        camionesPdf = camiones.map((c) => ({ ...c, choferDia: dia.get(c.id) ?? null, choferNoche: noche.get(c.id) ?? null }));
      }
      const subBase = subtituloReporteTaras(r, op.alcance);
      const subComb = op.combustible !== false && rComb.totalLitros > 0
        ? ` · Combustible${fechaCombDmy ? ` (${fechaCombDmy})` : ''}: ${litrosTexto(rComb.totalLitros)}`
        : '';
      const html = pdfDocument({
        title: 'Reporte de taras',
        subtitle: `${subBase}${subComb}`,
        body: cuerpoReporteTaras(camionesPdf, taras, { ...op, fechaCombustible }),
        extraCss: CSS_REPORTE_TARAS,
        logos,
        // Sin la línea «Banco Central de Venezuela / SOS La Guaira»: el
        // membrete lo deciden los logos, igual que los demás de viajes.
        marcaTexto: false,
      });
      await exportPdf(html, nombreArchivoTaras(op.alcance, caracasBusinessToday(), op));
    } catch (e: any) {
      toast.error(`No se pudo generar el reporte: ${e?.message ?? e}`);
    } finally {
      setGenerando(false);
    }
  };

  const Pastilla = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }}
    >
      <Text style={{ color: on ? colors.primaryContrast : colors.muted, fontWeight: '700', fontSize: 11 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>📄 Reporte de taras</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            {r.conTara} de {r.flota} camión(es) con tara cargada{r.exentos > 0 ? ` · ${r.exentos} no pasan por romana` : ''}
            {rComb.totalLitros > 0 ? ` · ⛽ ${rComb.conCombustible} con combustible (${litrosTexto(rComb.totalLitros)})` : ''}
          </Text>
        </View>
        <TouchableOpacity
          onPress={generar}
          disabled={generando}
          style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.primary, opacity: generando ? 0.6 : 1 }}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{generando ? 'Generando…' : '🖨️ Generar PDF'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, flex: 1 }}>
          🖨️ Qué sale en el reporte{!op.empresa ? ' · sin empresas' : (op.empresaUnica ?? '').trim() ? ' · a nombre de una empresa' : ''}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{abierto ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {abierto ? (
        <View style={{ marginTop: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', marginBottom: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Camiones:</Text>
            <Pastilla on={op.alcance === 'conTara'} label="Solo con tara" onPress={() => setOp('alcance', 'conTara')} />
            <Pastilla on={op.alcance === 'todos'} label="Toda la flota" onPress={() => setOp('alcance', 'todos')} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>⚖️ Pesos en:</Text>
            {UNIDADES_PESO.map((u) => (
              <Pastilla key={`rtu-${u.k}`} on={op.unidad === u.k} label={u.label} onPress={() => setOp('unidad', u.k)} />
            ))}
          </View>
          {/* 19-oct-2026, a pedido: las mismas opciones que frentes y obras/ubicaciones.
              Lo que apagues no deja rastro en el papel; el nombre del archivo sí lo dice. */}
          <Toggle on={op.numeracion !== false} label="1️⃣ Numeración (N°)" onPress={() => setOp('numeracion', op.numeracion === false)} />
          <Toggle on={op.placa !== false} label="🔢 Placa / serial" onPress={() => setOp('placa', op.placa === false)} />
          <Toggle on={op.marcaModelo} label="🏷️ Marca y modelo" onPress={() => setOp('marcaModelo', !op.marcaModelo)} />
          <Toggle
            on={op.combustible !== false}
            label="⛽ Combustible (L)"
            ayuda="Muestra la columna de litros de combustible asignados a cada maquinaria para el día seleccionado y su total."
            onPress={() => setOp('combustible', op.combustible === false)}
          />
          <Toggle
            on={op.clasificacion === true}
            label="◆ Clasificación por capacidad"
            ayuda="Compacto, media o gran capacidad, según los m³ de la tolva. Nace apagada."
            onPress={() => setOp('clasificacion', op.clasificacion !== true)}
          />
          <Toggle
            on={op.chofer === true}
            label="👤 Chofer"
            ayuda="El chofer asignado al camión en «👤 Choferes por camión». Si el de día y el de noche son distintos, salen los dos (☀️/🌙). Nace apagada."
            onPress={() => setOp('chofer', op.chofer !== true)}
          />
          <Toggle
            on={op.empresa}
            label="🏢 Empresa"
            ayuda="Apagado, el nombre de la empresa no aparece en ninguna parte del PDF (ni en la tabla ni en el nombre del archivo)."
            onPress={() => setOp('empresa', !op.empresa)}
          />
          {op.empresa ? (
            <>
              <Toggle
                on={!!(op.empresaUnica ?? '').trim() || empresaUnicaOn}
                label="🏙 Toda la flota a nombre de una sola empresa"
                ayuda="En la columna Empresa sale el mismo nombre para cada camión, como si todos fueran de esa empresa. Solo en el papel: no cambia la ficha de nadie."
                onPress={() => {
                  const encendida = !!(op.empresaUnica ?? '').trim() || empresaUnicaOn;
                  if (encendida) { setEmpresaUnicaOn(false); setOp('empresaUnica', ''); }
                  else setEmpresaUnicaOn(true);
                }}
              />
              {(empresaUnicaOn || !!(op.empresaUnica ?? '').trim()) ? (
                <TextInput
                  value={op.empresaUnica ?? ''}
                  onChangeText={(t) => setOp('empresaUnica', t)}
                  placeholder="Nombre de la empresa (ej. Jhenzaen 2.012 C.A)"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 4 }}
                  autoCorrect={false}
                />
              ) : null}
            </>
          ) : null}
          {op.alcance === 'todos' ? (
            <Toggle on={op.estado !== false} label="⚙️ Estado (con tara / sin tara / no pasa por romana)" onPress={() => setOp('estado', op.estado === false)} />
          ) : null}
          <Toggle on={op.cargadaPor} label="👤 Quién cargó la tara y cuándo" onPress={() => setOp('cargadaPor', !op.cargadaPor)} />
          <Toggle
            on={op.kpis !== false}
            label="📊 Resumen de arriba (total y taras)"
            ayuda="Las cuatro tarjetas: camiones, tara promedio, mayor y menor."
            onPress={() => setOp('kpis', op.kpis === false)}
          />
          <Toggle on={op.notaPie !== false} label="📝 Nota al pie (qué es la tara)" onPress={() => setOp('notaPie', op.notaPie === false)} />

          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.xs, marginBottom: 2 }}>🏷️ QUÉ LOGOS LLEVA EL MEMBRETE</Text>
          {LOGOS.map(([k, label]) => (
            <Toggle key={`rtl-${k}`} on={logos[k]} label={label} onPress={() => setLogo(k, !logos[k])} />
          ))}
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
            Para el reporte que se entrega afuera: apaga 🏢 Empresa y deja solo el logo de Jhenzaen. Las opciones se recuerdan en este equipo.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
