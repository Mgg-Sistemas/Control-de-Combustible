// Sección "Reportes" (hub): las 4 categorías del rediseño (docs/reportes-rediseno.html)
// con COLORES DEL SISTEMA. Cada tarjeta abre un modal "runner" (día o rango + filtro
// opcional de inspector/operador) y genera su PDF, o navega a una pantalla existente.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { supabase, selectAllRows } from '../lib/supabase';
import { cmpText, norm } from '../lib/text';
import { DateField } from './DateField';
import ReportesHub, { ReportSection } from './ReportesHub';
import { generateInspectorTrazaReport, type TurnoReporteInspector } from '../lib/inspectorTrazaReport';
import { generateHistoricoInspectorReport } from '../lib/historicoInspectorReport';
import {
  OPCIONES_INSPECTOR_POR_DEFECTO, PASTILLAS_INSPECTOR, alternarColumna, ocultosInspectorEnPalabras,
  type OpcionesInspector,
} from '../lib/inspectorTrazaColumnas';

/** El turno que corre AHORA en Caracas (día 7am–7pm). Es el que abren las tarjetas. */
function turnoActualCaracas(): 'day' | 'night' {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', hour: 'numeric', hour12: false }).format(new Date())) % 24;
  return h >= 7 && h < 19 ? 'day' : 'night';
}

function caracasTodayISO(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x: any) => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Config del modal para una tarjeta que genera PDF.
type RunnerConfig = {
  title: string;
  mode: 'dia' | 'rango';
  pick?: 'inspectors' | 'operators';   // filtro opcional multi-selección
  /** Pide el turno (día / noche / ambos). */
  conTurno?: boolean;
  /** Muestra las pastillas de columnas (como el Conteo de equipos). */
  conColumnas?: boolean;
  run: (a: { date: string; from: string; to: string; names: string[]; turno: TurnoReporteInspector; opciones: OpcionesInspector }) => Promise<boolean>;
};

export default function ReportesSection(props: { navigation?: any }) {
  const { colors } = useTheme();
  const today = caracasTodayISO();

  const [runner, setRunner] = useState<RunnerConfig | null>(null);
  const [rDate, setRDate] = useState(today);
  const [rFrom, setRFrom] = useState(today);
  const [rTo, setRTo] = useState(today);
  const [rNames, setRNames] = useState<Set<string>>(new Set());
  const [rBusy, setRBusy] = useState(false);
  const [pickList, setPickList] = useState<string[]>([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [rTurno, setRTurno] = useState<TurnoReporteInspector>(turnoActualCaracas());
  const [rOpciones, setROpciones] = useState<OpcionesInspector>(OPCIONES_INSPECTOR_POR_DEFECTO);

  const openRunner = (cfg: RunnerConfig) => {
    setRunner(cfg);
    setRDate(today); setRFrom(today); setRTo(today); setRNames(new Set());
    // Abre en el turno que corre ahora, igual que las tarjetas. Las columnas se
    // conservan entre aperturas: quien ocultó la placa suele quererla oculta otra vez.
    setRTurno(turnoActualCaracas());
    setPickList([]);
    if (cfg.pick) loadPick(cfg.pick);
  };
  const loadPick = async (which: 'inspectors' | 'operators') => {
    setPickLoading(true);
    try {
      if (which === 'inspectors') {
        const { data } = await supabase.from('profiles').select('full_name, role').in('role', ['supervisor', 'coordinador_patio']);
        const names = Array.from(new Set(((data ?? []) as any[]).map((p) => (p.full_name || '').trim()).filter(Boolean)));
        setPickList(names.sort(cmpText));
      } else {
        const rows = await selectAllRows('operator_assignments', 'first_name, last_name');
        const names = Array.from(new Set(((rows ?? []) as any[]).map((r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()).filter(Boolean)));
        setPickList(names.sort(cmpText));
      }
    } catch { setPickList([]); } finally { setPickLoading(false); }
  };
  const toggleName = (n: string) => setRNames((prev) => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; });

  const generar = async () => {
    if (!runner || rBusy) return;
    setRBusy(true);
    try {
      await runner.run({ date: rDate, from: rFrom, to: rTo, names: [...rNames], turno: rTurno, opciones: rOpciones });
      setRunner(null);
    } finally { setRBusy(false); }
  };

  const go = (route: string) => props.navigation?.navigate?.(route);

  const sections: ReportSection[] = [
    {
      key: 'inspector', icon: '✅', title: 'Máquinas asignadas por inspector', defaultOpen: true,
      cards: [
        {
          key: 'rep-inspector', icon: '📊', title: 'Reporte por inspector',
          desc: 'Las máquinas ASIGNADAS a cada inspector en el turno, con su estado y las horas del turno —los mismos números de las tarjetas de arriba— y la hora del check-in. Eliges qué columnas salen.',
          fields: ['Día y turno', 'Estado como las tarjetas', 'Horas del turno', 'Check-in', 'Placa · marca/modelo · empresa', 'Columnas a elegir'],
          onPress: () => openRunner({ title: 'Reporte por inspector', mode: 'dia', pick: 'inspectors', conTurno: true, conColumnas: true, run: ({ date, names, turno, opciones }) => generateInspectorTrazaReport({ date, turno, inspectors: names.length ? names : undefined, opciones }) }),
        },
        {
          key: 'camiones-cal', icon: '📅', title: 'Entrada y salida de camiones',
          desc: 'Calendario con el conteo de camiones que entraron y salieron cada día.',
          fields: ['Vista mensual', 'Entradas', 'Salidas'],
          onPress: () => go('Camiones'),
        },
      ],
    },
    // HISTÓRICO — va JUSTO DEBAJO de "Máquinas asignadas por inspector" y ANTES de
    // "Maquinaria / Vehículos" (posición señalada por el cliente, 17-ago-2026). Es un
    // grupo APARTE a propósito: el de arriba responde "quién tiene qué HOY" y este
    // responde "quién tuvo qué ENTONCES", que es otra pregunta.
    {
      key: 'historico', icon: '🕰️', title: 'Histórico',
      cards: [
        {
          key: 'rep-historico-inspector', icon: '📜', title: 'Histórico por inspector',
          desc: 'La jornada de cada inspector en un RANGO de fechas, tomada de sus check-in (no de la asignación actual): sirve para ver lo que hizo alguien que ya no está en la empresa o a quien le reasignaron las máquinas. Marca a los inspectores que ya no figuran como activos.',
          fields: ['Rango de fechas', 'Por inspector y fecha', 'Máquina', 'Marca / modelo', 'Serial / placa', 'Turno cubierto', 'Horas de SU turno', 'Aviso de inspector dado de baja'],
          onPress: () => openRunner({ title: 'Histórico por inspector', mode: 'rango', pick: 'inspectors', run: ({ from, to, names }) => generateHistoricoInspectorReport({ from, to, inspectors: names.length ? names : undefined }) }),
        },
      ],
    },
    {
      key: 'maquinaria', icon: '🚜', title: 'Maquinaria / Vehículos',
      cards: [
        {
          key: 'rep-trazabilidad-equipo', icon: '🧭', title: 'Trazabilidad e historial por equipo',
          desc: 'Línea de tiempo de una máquina: días trabajados, paradas y averías, con inicio, fin y tiempo total inactivo.',
          fields: ['Filtro por máquina', 'Rango de fechas', 'Exportar PDF'],
          onPress: () => go('MachineTraceability'),
        },
      ],
    },
  ];

  return (
    <View>
      <ReportesHub sections={sections} />

      {/* Modal RUNNER: día o rango + filtro opcional, y Generar. */}
      <Modal visible={!!runner} transparent animationType="slide" onRequestClose={() => setRunner(null)}>
        <Pressable onPress={() => setRunner(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '86%', padding: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flex: 1 }} numberOfLines={2}>📄 {runner?.title}</Text>
              <TouchableOpacity onPress={() => setRunner(null)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Cerrar ✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {runner?.mode === 'dia' ? (
                <>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Día</Text>
                  <DateField value={rDate} onChange={setRDate} maxISO={today} />
                </>
              ) : (
                <>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Desde</Text>
                  <DateField value={rFrom} onChange={setRFrom} maxISO={today} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Hasta</Text>
                  <DateField value={rTo} onChange={setRTo} maxISO={today} />
                </>
              )}

              {runner?.conTurno ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>🕒 Turno</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    {([['day', '☀️ Día'], ['night', '🌙 Noche'], ['both', 'Ambos']] as const).map(([k, label]) => {
                      const on = rTurno === k;
                      return (
                        <TouchableOpacity key={k} onPress={() => setRTurno(k)} style={{ flex: 1, alignItems: 'center', borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + '18' : colors.surface, borderRadius: radius.pill, paddingVertical: 7 }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {runner?.conColumnas ? (
                <View style={{ marginTop: spacing.md }}>
                  {/* Mismas pastillas que el Conteo de equipos: se encienden VARIAS a la
                      vez y ocultan columnas, nunca máquinas. */}
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>🖨️ ¿Qué se oculta?</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {PASTILLAS_INSPECTOR.map((p) => {
                      const on = rOpciones[p.key];
                      return (
                        <TouchableOpacity key={p.key} onPress={() => setROpciones((o) => alternarColumna(o, p.key))} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.warning : colors.border, backgroundColor: on ? colors.warning : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 6 }}>
                          <Text style={{ color: on ? '#FFFFFF' : colors.text, fontWeight: '700', fontSize: 12 }}>{p.chip}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                    {ocultosInspectorEnPalabras(rOpciones)} Los totales no cambian.
                  </Text>
                </View>
              ) : null}

              {runner?.pick ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>
                    {runner.pick === 'inspectors' ? '👮 Inspectores' : '👷 Operadores'} (marca uno o varios · vacío = todos)
                  </Text>
                  {pickLoading ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text>
                  ) : pickList.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Sin nombres para filtrar.</Text>
                  ) : (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {pickList.map((n) => {
                        const on = rNames.has(n);
                        return (
                          <TouchableOpacity key={n} onPress={() => toggleName(n)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + '18' : colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 }}>
                            <Text style={{ fontSize: 13 }}>{on ? '☑️' : '⬜'}</Text>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{n}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : null}

              <TouchableOpacity onPress={generar} disabled={rBusy} activeOpacity={0.85} style={{ marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', opacity: rBusy ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 14 }}>{rBusy ? 'Generando…' : '📄 Generar reporte'}</Text>
              </TouchableOpacity>
              <View style={{ height: spacing.lg }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
