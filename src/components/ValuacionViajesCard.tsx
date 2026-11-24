// 📑 SOPORTE DE MEDICIÓN Y ACARREO (VALUACIÓN MIYAMOTO / MPPOP) · tarjeta (24-nov-2026).
//
// Vive en el panel de información de Viajes de camiones (debajo de Informe Operativo).
// Carga de forma perezosa los viajes del rango [desde, hasta] (jornada 7am→7am Caracas),
// permite filtrar por Operación (Miyamoto / TFI), Obra/CDT y Frente, configurar los
// datos contractuales y firmantes (guardados en AsyncStorage) y exportar el PDF multipágina.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Plegable } from './Plegable';
import { DateField } from './DateField';
import { Toggle } from './CubicajeTab';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { selectAllRows } from '../lib/supabase';
import { exportPdf } from '../lib/pdf';
import {
  CONFIG_VALUACION_INICIAL,
  ConfigValuacion,
  MaquinaValuacion,
  ViajeValuacion,
  construirDatosValuacion,
  fmtDec,
  generarHtmlValuacionPdf,
  jornadaDeInstante,
} from '../lib/viajesValuacionPdf';

const STORAGE_KEY = 'valuacion_viajes_cfg_v1';

const COLS_BASE = 'id, registered_at, machinery_id, machine_code, chofer_name, peso_tara_kg, peso_bruto_kg, peso_neto_kg, ubicacion_nombre, placa_snap, frente_id, frente_nombre';
const COLS_OP = `${COLS_BASE}, proyecto_operacion, material_nombre, sentido`;
const COLS_FULL = `${COLS_OP}, responsable_id, responsable_nombre`;

const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = (iso: string) => sumarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));

type Props = {
  canVer: boolean;
};

export function ValuacionViajesCard({ canVer }: Props) {
  const { colors } = useTheme();
  const hoy = jornadaDeInstante(new Date().toISOString());

  const [desde, setDesde] = useState(() => lunesDe(hoy));
  const [hasta, setHasta] = useState(() => hoy);
  const [yaPedido, setYaPedido] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viajes, setViajes] = useState<ViajeValuacion[]>([]);
  const [maquinas, setMaquinas] = useState<MaquinaValuacion[]>([]);

  const [opFiltro, setOpFiltro] = useState<'todas' | 'miyamoto' | 'tfi'>('miyamoto');
  const [obrasSel, setObrasSel] = useState<Set<string>>(new Set());
  const [frentesSel, setFrentesSel] = useState<Set<string>>(new Set());
  const [camionesSel, setCamionesSel] = useState<Set<string>>(new Set());
  const [busqCamion, setBusqCamion] = useState('');

  const [cfg, setCfg] = useState<ConfigValuacion>(CONFIG_VALUACION_INICIAL);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            setCfg((prev) => ({ ...prev, ...parsed }));
          }
        } catch {}
      })
      .catch(() => {});
  }, []);

  const actualizarCfg = useCallback(<K extends keyof ConfigValuacion>(k: K, v: ConfigValuacion[K]) => {
    setCfg((prev) => {
      const next = { ...prev, [k]: v };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const rangoInvalido = hasta < desde;

  const cargar = useCallback(async () => {
    if (rangoInvalido) return;
    setCargando(true);
    setError(null);
    try {
      const finExclusivo = sumarDias(hasta, 1);
      const filtro = (q: any) =>
        q.gte('registered_at', `${desde}T07:00:00-04:00`).lt('registered_at', `${finExclusivo}T07:00:00-04:00`);

      const [filas, maqs] = await Promise.all([
        selectAllRows('camion_viajes', COLS_FULL, filtro)
          .catch(() => selectAllRows('camion_viajes', COLS_OP, filtro)
            .catch(() => selectAllRows('camion_viajes', COLS_BASE, filtro))),
        selectAllRows('machinery', 'id, code, plate, serial').catch(() => [] as any[]),
      ]);
      setViajes((filas ?? []) as ViajeValuacion[]);
      setMaquinas((maqs ?? []) as MaquinaValuacion[]);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los viajes para la valuación.');
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, rangoInvalido]);

  useEffect(() => {
    if (yaPedido) cargar();
  }, [yaPedido, cargar]);

  const opcionesObras = useMemo(() => {
    const s = new Set<string>();
    viajes.forEach((v) => {
      const n = String(v.ubicacion_nombre ?? '').trim();
      if (n) s.add(n);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [viajes]);

  const opcionesFrentes = useMemo(() => {
    const s = new Set<string>();
    viajes.forEach((v) => {
      const n = String(v.frente_nombre ?? '').trim() || 'Sin frente';
      s.add(n);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [viajes]);

  const claveCamion = useCallback((v: ViajeValuacion) =>
    String(v.machinery_id ?? '').trim() || `code:${String(v.machine_code ?? '').trim() || '—'}`, []);

  const opcionesCamiones = useMemo(() => {
    const maqById = new Map(maquinas.map((m) => [m.id, m]));
    const map = new Map<string, { key: string; code: string; placa: string; label: string }>();
    viajes.forEach((v) => {
      if (opFiltro !== 'todas' && String(v.proyecto_operacion ?? '').trim().toLowerCase() !== opFiltro) return;
      const key = claveCamion(v);
      if (map.has(key)) return;
      const m = v.machinery_id ? maqById.get(v.machinery_id) : undefined;
      const code = String(v.machine_code ?? '').trim() || String(m?.code ?? '').trim() || '—';
      const placa = String(v.placa_snap ?? '').trim() || String(m?.plate ?? '').trim() || String(m?.serial ?? '').trim();
      const label = placa ? `${code} · 🏷️ ${placa}` : code;
      map.set(key, { key, code, placa, label });
    });
    const q = busqCamion.trim().toLowerCase();
    return Array.from(map.values())
      .filter((c) => !q || camionesSel.has(c.key) || c.code.toLowerCase().includes(q) || c.placa.toLowerCase().includes(q))
      .sort((a, b) => a.code.localeCompare(b.code, 'es') || a.placa.localeCompare(b.placa, 'es'));
  }, [viajes, maquinas, opFiltro, busqCamion, camionesSel, claveCamion]);

  const viajesFiltrados = useMemo(() => {
    return viajes.filter((v) => {
      if (opFiltro !== 'todas') {
        const op = String(v.proyecto_operacion ?? '').trim().toLowerCase();
        if (op !== opFiltro) return false;
      }
      if (obrasSel.size > 0) {
        const ub = String(v.ubicacion_nombre ?? '').trim();
        if (!obrasSel.has(ub)) return false;
      }
      if (frentesSel.size > 0) {
        const fr = String(v.frente_nombre ?? '').trim() || 'Sin frente';
        if (!frentesSel.has(fr)) return false;
      }
      if (camionesSel.size > 0) {
        if (!camionesSel.has(claveCamion(v))) return false;
      }
      return true;
    });
  }, [viajes, opFiltro, obrasSel, frentesSel, camionesSel, claveCamion]);

  const datos = useMemo(
    () => construirDatosValuacion(viajesFiltrados, desde, hasta, cfg),
    [viajesFiltrados, desde, hasta, cfg]
  );

  if (!canVer) return null;

  const chip = (on: boolean) => ({
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: on ? colors.brand : colors.border,
    backgroundColor: on ? colors.brand : colors.surface,
  });
  const chipTxt = (on: boolean) => ({
    color: on ? colors.brandContrast : colors.text,
    fontWeight: '700' as const,
    fontSize: 11.5,
  });
  const inp = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    color: colors.text,
    fontSize: 12.5,
  };

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, val: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };

  const generarPdf = async () => {
    if (rangoInvalido) return;
    setDescargando(true);
    try {
      const html = generarHtmlValuacionPdf({
        viajes: viajesFiltrados,
        maquinas,
        desde,
        hasta,
        config: cfg,
      });
      await exportPdf(html, `Soporte de medicion ${cfg.valuacion || ''} ${desde} a ${hasta}`.trim());
    } finally {
      setDescargando(false);
    }
  };

  const resumenPlegable = yaPedido
    ? `${datos.totalViajes} viaje(s) · ${fmtDec(datos.totalT)} t · ${datos.totalPaginas} pág(s)`
    : 'Formato contractual multipágina (carátula, frentes y registro diario con firmas)';

  return (
    <Plegable
      titulo="📑 Soporte de Medición / Valuación (Miyamoto)"
      resumen={resumenPlegable}
      onAbrir={() => setYaPedido(true)}
    >
      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 11.5 }}>
          Genera el paquete completo estilo Administración de Contratos: Hoja 1 (Registro diario con acumulados y barras), Hoja 2 (Distribución por frentes, conciliación y 3 firmas) y Hojas 3..N (una por cada día activo con detalle viaje a viaje y 4 firmas).
        </Text>

        {/* Período + Atajos */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' }}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800', marginBottom: 2 }}>DESDE</Text>
            <DateField value={desde} onChange={setDesde} />
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800', marginBottom: 2 }}>HASTA</Text>
            <DateField value={hasta} onChange={setHasta} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <TouchableOpacity onPress={() => { setDesde(lunesDe(hoy)); setHasta(hoy); }} style={chip(false)}>
            <Text style={chipTxt(false)}>📅 Esta semana</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { const ym = hoy.slice(0, 7); setDesde(`${ym}-01`); setHasta(`${ym}-15`); }} style={chip(false)}>
            <Text style={chipTxt(false)}>1ª Quincena</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { const ym = hoy.slice(0, 7); setDesde(`${ym}-06`); setHasta(`${ym}-20`); }} style={chip(false)}>
            <Text style={chipTxt(false)}>06 al 20</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setDesde(`${hoy.slice(0, 7)}-01`); setHasta(hoy); }} style={chip(false)}>
            <Text style={chipTxt(false)}>Mes actual</Text>
          </TouchableOpacity>
        </View>

        {/* Datos rápidos de la valuación */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800', marginBottom: 2 }}>VALUACIÓN N°</Text>
            <TextInput value={cfg.valuacion} onChangeText={(v) => actualizarCfg('valuacion', v)} placeholder="01 (UNO)" placeholderTextColor={colors.muted} style={inp} />
          </View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800', marginBottom: 2 }}>ACUMULADO ANTERIOR (t)</Text>
            <TextInput value={cfg.acumuladoAnterior} onChangeText={(v) => actualizarCfg('acumuladoAnterior', v)} placeholder="Opcional (ej. 0)" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={inp} />
          </View>
        </View>

        {/* Filtro de operación */}
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800' }}>OPERACIÓN</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {([
              ['miyamoto', '🏗️ Miyamoto'],
              ['tfi', '🏗️ TFI'],
              ['todas', 'Todas'],
            ] as const).map(([k, lbl]) => {
              const on = opFiltro === k;
              return (
                <TouchableOpacity key={k} onPress={() => setOpFiltro(k)} style={chip(on)}>
                  <Text style={chipTxt(on)}>{lbl}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Filtro de Obras/CDT */}
        {opcionesObras.length > 0 ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800' }}>SITIO / OBRA (CDT)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <TouchableOpacity onPress={() => setObrasSel(new Set())} style={chip(obrasSel.size === 0)}>
                <Text style={chipTxt(obrasSel.size === 0)}>Todas</Text>
              </TouchableOpacity>
              {opcionesObras.map((o) => {
                const on = obrasSel.has(o);
                return (
                  <TouchableOpacity key={o} onPress={() => toggleSet(setObrasSel, o)} style={chip(on)}>
                    <Text style={chipTxt(on)}>📍 {o}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Filtro de Frentes */}
        {opcionesFrentes.length > 1 ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800' }}>FRENTES DE TRABAJO</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <TouchableOpacity onPress={() => setFrentesSel(new Set())} style={chip(frentesSel.size === 0)}>
                <Text style={chipTxt(frentesSel.size === 0)}>Todos</Text>
              </TouchableOpacity>
              {opcionesFrentes.map((f) => {
                const on = frentesSel.has(f);
                return (
                  <TouchableOpacity key={f} onPress={() => toggleSet(setFrentesSel, f)} style={chip(on)}>
                    <Text style={chipTxt(on)}>⛏️ {f}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Filtro de Camión (con placa y buscador rápido) */}
        {viajes.length > 0 ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800' }}>
              CAMIÓN {camionesSel.size > 0 ? `(${camionesSel.size} seleccionado${camionesSel.size === 1 ? '' : 's'})` : '(TODOS)'}
            </Text>
            <TextInput
              value={busqCamion}
              onChangeText={setBusqCamion}
              placeholder="🔎 Buscar camión por código o placa…"
              placeholderTextColor={colors.muted}
              style={inp}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <TouchableOpacity onPress={() => setCamionesSel(new Set())} style={chip(camionesSel.size === 0)}>
                <Text style={chipTxt(camionesSel.size === 0)}>Todos los camiones</Text>
              </TouchableOpacity>
              {opcionesCamiones.map((c) => {
                const on = camionesSel.has(c.key);
                return (
                  <TouchableOpacity key={c.key} onPress={() => toggleSet(setCamionesSel, c.key)} style={chip(on)}>
                    <Text style={chipTxt(on)}>🚛 {c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Configuración avanzada desplegable */}
        <TouchableOpacity
          onPress={() => setCfgOpen((v) => !v)}
          style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center' }}
        >
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            {cfgOpen ? '▲ Ocultar configuración de carátula y firmantes' : '⚙️ Configurar carátula, partida y firmantes'}
          </Text>
        </TouchableOpacity>

        {cfgOpen ? (
          <View style={{ gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Toggle
              on={cfg.conLogoInstitucional}
              label="🏛️ Mostrar membrete institucional (MPPOP | miyamoto.)"
              onPress={() => actualizarCfg('conLogoInstitucional', !cfg.conLogoInstitucional)}
            />
            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800', marginTop: 4 }}>DATOS CONTRACTUALES</Text>
            {(
              [
                ['contratista', 'Contratista'],
                ['contrato', 'Contrato'],
                ['itemNro', 'Ítem N°'],
                ['codigo', 'Código'],
                ['unidad', 'Unidad'],
                ['contratado', 'Contratado'],
                ['partida', 'Partida'],
                ['sitioDisposicion', 'Sitio de disposición (vacío = automático del CDT)'],
              ] as [keyof ConfigValuacion, string][]
            ).map(([k, lbl]) => (
              <View key={k}>
                <Text style={{ color: colors.muted, fontSize: 10 }}>{lbl}</Text>
                <TextInput value={String(cfg[k])} onChangeText={(v) => actualizarCfg(k, v as any)} style={inp} />
              </View>
            ))}

            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800', marginTop: 6 }}>FIRMAS PÁGINA 2 (ELABORA / CONFORMA / REVISA)</Text>
            {(
              [
                ['elaboraNombre', 'Elabora — Nombre', 'elaboraCi', 'C.I.'],
                ['conformaNombre', 'Conforma — Nombre', 'conformaCi', 'C.I.'],
                ['revisaNombre', 'Revisa — Nombre', 'revisaCi', 'C.I.'],
              ] as [keyof ConfigValuacion, string, keyof ConfigValuacion, string][]
            ).map(([kN, lN, kC, lC]) => (
              <View key={kN} style={{ flexDirection: 'row', gap: spacing.xs }}>
                <View style={{ flex: 2 }}>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>{lN}</Text>
                  <TextInput value={String(cfg[kN])} onChangeText={(v) => actualizarCfg(kN, v as any)} style={inp} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>{lC}</Text>
                  <TextInput value={String(cfg[kC])} onChangeText={(v) => actualizarCfg(kC, v as any)} style={inp} />
                </View>
              </View>
            ))}

            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800', marginTop: 6 }}>FIRMAS DIARIAS PÁGINAS 3..N (SUPERVISORES)</Text>
            {(
              [
                ['sup1Nombre', 'Romana Golden Touch — Nombre', 'sup1Ci', 'C.I.'],
                ['sup2Nombre', 'Romana Miyamoto — Nombre', 'sup2Ci', 'C.I.'],
                ['sup3Nombre', 'Campo Miyamoto — Nombre', 'sup3Ci', 'C.I.'],
                ['sup4Nombre', 'Romana MPPOP — Nombre', 'sup4Ci', 'C.I.'],
              ] as [keyof ConfigValuacion, string, keyof ConfigValuacion, string][]
            ).map(([kN, lN, kC, lC]) => (
              <View key={kN} style={{ flexDirection: 'row', gap: spacing.xs }}>
                <View style={{ flex: 2 }}>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>{lN}</Text>
                  <TextInput value={String(cfg[kN])} onChangeText={(v) => actualizarCfg(kN, v as any)} style={inp} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>{lC}</Text>
                  <TextInput value={String(cfg[kC])} onChangeText={(v) => actualizarCfg(kC, v as any)} style={inp} />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Estado y Resumen */}
        {error ? (
          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ {error}</Text>
        ) : cargando ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando viajes del período…</Text>
        ) : (
          <View style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>
              📊 {datos.dias.length} día(s) en período · {datos.diasActivos.length} con actividad · {datos.totalViajes} viaje(s) · {fmtDec(datos.totalT)} t
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
              Frentes: {datos.frentes.length} · Total páginas del PDF: {datos.totalPaginas} (2 de resumen + {datos.diasActivos.length} hojas diarias)
            </Text>
          </View>
        )}

        <TouchableOpacity
          disabled={cargando || descargando || rangoInvalido}
          onPress={generarPdf}
          style={{
            backgroundColor: colors.brand,
            borderRadius: radius.md,
            paddingVertical: spacing.sm + 2,
            alignItems: 'center',
            opacity: cargando || descargando || rangoInvalido ? 0.55 : 1,
          }}
        >
          <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>
            {descargando ? 'Generando PDF…' : `📑 Generar PDF Soporte de Medición (${datos.totalPaginas} pág.)`}
          </Text>
        </TouchableOpacity>
      </View>
    </Plegable>
  );
}
