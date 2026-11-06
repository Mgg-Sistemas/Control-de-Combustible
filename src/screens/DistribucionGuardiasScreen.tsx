// Distribución de guardias (submenú de Inspecciones): asigna a cada inspector su
// rango de descanso dentro de un ciclo, MANUAL o AUTOGENERANDO una rotación 14x7 por
// grupos (nunca descansan a la vez dos coordinadores ni dos nocturnos), o el modo
// "1 día libre/semana" (cada inspector descansa UN día fijo por semana y el resto
// de la semana trabaja — a diferencia del modo por grupos, aquí nadie deja de
// trabajar la semana completa). Muestra el calendario inspector×día (T/D) y genera
// el PDF (ver src/lib/guardiasReport.ts).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useConfirm } from '../components/ConfirmProvider';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { personalAsignable } from '../lib/personalAsignable';
import { cmpText } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import { DateField } from '../components/DateField';
import {
  generateGuardiasReport,
  GuardInspector,
  GuardShift,
  calcularPeriodosPersonaEnCiclo,
  aplicarCambioManualEnRangos,
  alternarDiaManualEnRangos,
  generarPeriodosAutomaticosTrabajoDescanso,
  calcularGruposSugeridosFormula,
  formatearRangosCortos,
  ModoFormulaTrabajoDescanso,
} from '../lib/guardiasReport';
import { useRealtimeRefresh } from '../hooks/useRealtime';

const CARGOS = ['Coordinador', 'Nocturno', 'Inspector'];
// Paleta de colores por grupo (soporta cualquier cantidad de grupos, no solo A/B/C).
const GRUPO_PALETTE = ['#9AA3AB', '#4BB477', '#E0A040', '#5B8DEF', '#C77DD6', '#E0655B', '#3FBFB0', '#B0894A', '#8A7BE0', '#6AA84F', '#D98CA0', '#7F9CB5'];
const grupoColor = (g: string | null | undefined): string => {
  const i = g ? g.charCodeAt(0) - 65 : -1; // 'A'->0, 'B'->1, …
  return i >= 0 ? GRUPO_PALETTE[i % GRUPO_PALETTE.length] : '#9AA3AB';
};

// Modo "1 día libre/semana": cada inspector tiene un día fijo de la semana como
// descanso (se repite cada semana del ciclo), en vez de un grupo que descansa la
// semana completa.
const DIAS_SEMANA = [
  { code: 'Lu', label: 'Lunes', dow: 1 },
  { code: 'Ma', label: 'Martes', dow: 2 },
  { code: 'Mi', label: 'Miércoles', dow: 3 },
  { code: 'Ju', label: 'Jueves', dow: 4 },
  { code: 'Vi', label: 'Viernes', dow: 5 },
  { code: 'Sa', label: 'Sábado', dow: 6 },
  { code: 'Do', label: 'Domingo', dow: 0 },
] as const;
const DIA_CODES = DIAS_SEMANA.map((d) => d.code) as string[];
const dowOfCode = (code: string) => DIAS_SEMANA.find((d) => d.code === code)?.dow ?? 1;
const DIA_COLOR: Record<string, string> = { Lu: '#4BB477', Ma: '#5B8DEF', Mi: '#E0A040', Ju: '#C77DD6', Vi: '#3FBFB0', Sa: '#E0655B', Do: '#8A7BE0' };
const diaColor = (d: string | null | undefined): string => (d && DIA_COLOR[d]) || '#9AA3AB';
/** Color de la insignia "grupo": si es un código de día (modo semanal) usa diaColor,
 *  si es una letra de grupo (modo por semana completa) usa grupoColor. */
const badgeColorOf = (g: string | null | undefined): string => (g && DIA_CODES.includes(g)) ? diaColor(g) : grupoColor(g);
/** Orden de fila para que los que descansan el MISMO día queden juntos (efecto
 *  "escalera" Lu→Do en el calendario) en vez del orden alfabético (Do, Ju, Lu…).
 *  Las letras de grupo del modo 14x7 (A, B, C…) mantienen su orden alfabético. */
const grupoRank = (g: string | null | undefined): number => {
  if (!g) return 999;
  const i = DIA_CODES.indexOf(g);
  return i >= 0 ? i : 500 + g.charCodeAt(0);
};

function caracasTodayISO(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x: any) => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function daysBetween(from: string, to: string): string[] {
  const out: string[] = []; let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) { out.push(cur); cur = addDaysISO(cur, 1); }
  return out;
}
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const dowOf = (iso: string) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];
const ddOf = (iso: string) => iso.slice(-2);
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}` : iso; };

type Meta = { id: string; inspector_id: string | null; inspector_name: string; cedula: string | null; telefono: string | null; sector: string | null; cargo: string | null; grupo: string | null };
type Shift = { id: string; inspector_name: string; from_date: string; to_date: string; kind: string; grupo: string | null };
type Prof = { id: string; full_name: string; cedula: string | null };

export default function DistribucionGuardiasScreen() {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;

  const today = caracasTodayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDaysISO(today, 20)); // 21 días (ciclo 14x7)
  const [metas, setMetas] = useState<Meta[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);         // agregar inspector
  const [descansoFor, setDescansoFor] = useState<Meta | null>(null); // agregar rango manual (descanso o trabajo) a inspector
  const [tipoRangoManual, setTipoRangoManual] = useState<'descanso' | 'trabajo'>('descanso');
  const [dFrom, setDFrom] = useState(today);
  const [dTo, setDTo] = useState(addDaysISO(today, 6));
  const [grupoOpen, setGrupoOpen] = useState(false);     // armar grupos 14x7 a mano
  const [grupoSel, setGrupoSel] = useState<Record<string, string>>({}); // metaId → grupo ('A','B','C',…)
  const [diaOpen, setDiaOpen] = useState(false);         // armar "1 día libre/semana" a mano
  const [diaSel, setDiaSel] = useState<Record<string, string>>({}); // metaId → código de día ('Lu','Ma',…)

  // Modal: Calcular automáticamente por Días de Trabajo × Días de Descanso (ej. 14×7, 7×7, 5×2, etc.)
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formTrabajo, setFormTrabajo] = useState('14');
  const [formDescanso, setFormDescanso] = useState('7');
  const [formModo, setFormModo] = useState<ModoFormulaTrabajoDescanso>('escalonado_trabajo');
  const [formGrupoSel, setFormGrupoSel] = useState<Record<string, string>>({});

  // Grupos DINÁMICOS: tantos como hagan falta para ~2 inspectores por grupo (mínimo 3).
  // Antes estaba fijo en A/B/C (3 grupos), y con más inspectores quedaban afuera.
  const nGroups = Math.max(3, Math.ceil(metas.length / 2));
  const GRUPOS = useMemo(() => Array.from({ length: nGroups }, (_, i) => String.fromCharCode(65 + i)), [nGroups]);

  const load = async () => {
    setLoading(true);
    const [m, s, p] = await Promise.all([
      supabase.from('guard_inspector_meta').select('id, inspector_id, inspector_name, cedula, telefono, sector, cargo, grupo'),
      supabase.from('guard_shifts').select('id, inspector_name, from_date, to_date, kind, grupo'),
      personalAsignable('id, full_name, cedula, role').then((data) => ({ data })).catch(() => ({ data: [] })),
    ]);
    setMetas(((m.data ?? []) as any[]).sort((a, b) => grupoRank(a.grupo) - grupoRank(b.grupo) || cmpText(a.inspector_name, b.inspector_name)));
    setShifts((s.data ?? []) as any);
    setProfs(((p.data ?? []) as any[]).map((x) => ({ id: x.id, full_name: x.full_name || '—', cedula: x.cedula ?? null })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  // Sin esto, un descanso/grupo asignado desde otro dispositivo no aparecía hasta
  // recargar — riesgo de que dos inspectores del mismo grupo quedaran "descansando"
  // el mismo día por estar viendo datos viejos.
  useRealtimeRefresh(['guard_inspector_meta', 'guard_shifts'], () => { load(); });

  const days = useMemo(() => daysBetween(from, to), [from, to]);
  const shiftsByName = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach((sh) => { const l = map.get(sh.inspector_name) ?? []; l.push(sh); map.set(sh.inspector_name, l); });
    return map;
  }, [shifts]);
  // 'D' si el día cae en un descanso de ese inspector; si no, 'T'.
  const estadoDe = (name: string, day: string): 'D' | 'T' => {
    const list = shiftsByName.get(name) ?? [];
    for (const sh of list) if (sh.kind === 'descanso' && sh.from_date <= day && day <= sh.to_date) return 'D';
    return 'T';
  };
  const descansoCount = (day: string) => metas.reduce((n, m) => n + (estadoDe(m.inspector_name, day) === 'D' ? 1 : 0), 0);
  // Conflicto: dos COORDINADORES en descanso el mismo día.
  const conflicto = useMemo(() => {
    for (const day of days) {
      const coords = metas.filter((m) => (m.cargo || '') === 'Coordinador' && estadoDe(m.inspector_name, day) === 'D');
      if (coords.length >= 2) return { day, coords: coords.map((c) => c.inspector_name) };
    }
    return null;
  }, [days, metas, shiftsByName]);

  const disponibles = useMemo(() => {
    const usados = new Set(metas.map((m) => (m.inspector_name || '').toLowerCase()));
    return profs.filter((p) => !usados.has((p.full_name || '').toLowerCase())).sort((a, b) => cmpText(a.full_name, b.full_name));
  }, [profs, metas]);

  const agregarInspector = async (p: Prof) => {
    setBusy(true); setNotice(null);
    const { error } = await supabase.from('guard_inspector_meta').insert({
      inspector_id: p.id, inspector_name: p.full_name, cedula: p.cedula, cargo: 'Inspector', updated_by: uid,
    });
    setBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setAddOpen(false); load();
  };
  const patchMeta = async (m: Meta, patch: Partial<Meta>) => {
    setMetas((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...patch } : x))); // optimista
    await supabase.from('guard_inspector_meta').update({ ...patch, updated_by: uid, updated_at: new Date().toISOString() }).eq('id', m.id);
  };
  const quitarInspector = async (m: Meta) => {
    const ok = await confirm({ title: 'Quitar inspector', message: `¿Quitar a ${m.inspector_name} de la distribución? (se borran también sus guardias)`, confirmText: 'Quitar', danger: true });
    if (!ok) return;
    await supabase.from('guard_shifts').delete().eq('inspector_name', m.inspector_name);
    await supabase.from('guard_inspector_meta').delete().eq('id', m.id);
    load();
  };
  // Sincroniza en `guard_shifts` los nuevos rangos de descanso de un inspector
  const reemplazarDescansosInspector = async (
    m: Meta,
    nuevosRangos: { from_date: string; to_date: string }[]
  ): Promise<boolean> => {
    const delRes = await supabase
      .from('guard_shifts')
      .delete()
      .eq('inspector_name', m.inspector_name)
      .eq('kind', 'descanso');
    if (delRes.error) {
      setNotice('❌ ' + delRes.error.message);
      return false;
    }
    if (nuevosRangos.length > 0) {
      const filas = nuevosRangos.map((r) => ({
        inspector_id: m.inspector_id,
        inspector_name: m.inspector_name,
        from_date: r.from_date,
        to_date: r.to_date,
        kind: 'descanso',
        grupo: m.grupo,
        created_by: uid,
      }));
      const insRes = await supabase.from('guard_shifts').insert(filas);
      if (insRes.error) {
        setNotice('❌ ' + insRes.error.message);
        return false;
      }
    }
    return true;
  };

  // Alterna manualmente un solo día en el Calendario del Ciclo entre T (Trabajo) y D (Descanso)
  const toggleDiaCalendario = async (m: Meta, day: string) => {
    if (busy) return;
    const actuales = (shiftsByName.get(m.inspector_name) ?? []).filter((s) => s.kind === 'descanso');
    const { nuevoEstado, rangosDescanso } = alternarDiaManualEnRangos(actuales, day);
    // Actualización optimista inmediata
    setShifts((prev) => {
      const otros = prev.filter((s) => !(s.inspector_name === m.inspector_name && s.kind === 'descanso'));
      const nuevos: Shift[] = rangosDescanso.map((r, idx) => ({
        id: `temp-${m.id}-${idx}-${r.from_date}`,
        inspector_name: m.inspector_name,
        from_date: r.from_date,
        to_date: r.to_date,
        kind: 'descanso',
        grupo: m.grupo,
      }));
      return [...otros, ...nuevos];
    });
    setBusy(true);
    setNotice(null);
    const ok = await reemplazarDescansosInspector(m, rangosDescanso);
    setBusy(false);
    if (ok) {
      setNotice(
        `✅ ${m.inspector_name} · ${dmy(day)} marcado como ${nuevoEstado === 'descanso' ? 'D (Descanso)' : 'T (Trabajo)'}.`
      );
      load();
    } else {
      load();
    }
  };

  // Aplica un rango manual (Descanso D o Trabajo T) al inspector seleccionado
  const aplicarRangoManual = async (
    estadoForzado?: 'descanso' | 'trabajo',
    rangoFrom?: string,
    rangoTo?: string
  ) => {
    if (!descansoFor) return;
    const f = rangoFrom ?? dFrom;
    const t = rangoTo ?? dTo;
    const modoAplicar = estadoForzado ?? tipoRangoManual;
    if (t < f) {
      setNotice('❌ La fecha "hasta" no puede ser menor que "desde".');
      return;
    }
    setBusy(true);
    setNotice(null);
    const actuales = (shiftsByName.get(descansoFor.inspector_name) ?? []).filter(
      (s) => s.kind === 'descanso'
    );
    const nuevosRangos = aplicarCambioManualEnRangos(actuales, f, t, modoAplicar);
    const ok = await reemplazarDescansosInspector(descansoFor, nuevosRangos);
    setBusy(false);
    if (!ok) return;
    setDescansoFor(null);
    setNotice(
      `✅ ${descansoFor.inspector_name}: rango ${dmy(f)} al ${dmy(t)} marcado como ${
        modoAplicar === 'descanso' ? '🛌 Descanso (D)' : '🛠️ Trabajo (T)'
      }.`
    );
    load();
  };

  const quitarShift = async (sh: Shift) => {
    await supabase.from('guard_shifts').delete().eq('id', sh.id);
    load();
  };

  // Sugerencia AUTOMÁTICA de grupos (round-robin por categoría): coordinadores,
  // nocturnos y resto se reparten en A/B/C para que NO coincidan dos coordinadores
  // (ni dos nocturnos) en la misma semana de descanso. Devuelve metaId → 'A'|'B'|'C'.
  const computeAutoGroups = (gruposLista: string[] = GRUPOS): Record<string, string> => {
    const letra = gruposLista.length ? gruposLista : GRUPOS;
    const totalG = letra.length;
    const cat = (m: Meta) => (m.cargo === 'Coordinador' ? 0 : m.cargo === 'Nocturno' ? 1 : 2);
    const orden = [...metas].sort((a, b) => cat(a) - cat(b) || cmpText(a.inspector_name, b.inspector_name));
    const counters = [0, 0, 0];
    const out: Record<string, string> = {};
    orden.forEach((m) => { const c = cat(m); const g = counters[c] % totalG; counters[c]++; out[m.id] = letra[g]; });
    return out;
  };

  // Grupos dinámicos para el modal de Fórmula Trabajo × Descanso
  const numTrabajoFormula = Math.max(1, Math.round(leerNumero(formTrabajo) || 14));
  const numDescansoFormula = Math.max(1, Math.round(leerNumero(formDescanso) || 7));
  const nGruposFormula = useMemo(
    () => calcularGruposSugeridosFormula(numTrabajoFormula, numDescansoFormula),
    [numTrabajoFormula, numDescansoFormula]
  );
  const GRUPOS_FORMULA = useMemo(
    () => Array.from({ length: nGruposFormula }, (_, i) => String.fromCharCode(65 + i)),
    [nGruposFormula]
  );

  const abrirFormulaTrabajoDescanso = () => {
    if (metas.length === 0) {
      setNotice('❌ Primero agrega inspectores.');
      return;
    }
    const gList = Array.from(
      { length: calcularGruposSugeridosFormula(numTrabajoFormula, numDescansoFormula) },
      (_, i) => String.fromCharCode(65 + i)
    );
    const init: Record<string, string> = {};
    let alguno = false;
    metas.forEach((m) => {
      if (m.grupo && gList.includes(m.grupo)) {
        init[m.id] = m.grupo;
        alguno = true;
      }
    });
    setFormGrupoSel(alguno ? { ...computeAutoGroups(gList), ...init } : computeAutoGroups(gList));
    setNotice(null);
    setFormulaOpen(true);
  };

  const aplicarPresetFormula = (w: number, r: number) => {
    setFormTrabajo(String(w));
    setFormDescanso(String(r));
    const gList = Array.from(
      { length: calcularGruposSugeridosFormula(w, r) },
      (_, i) => String.fromCharCode(65 + i)
    );
    setFormGrupoSel(computeAutoGroups(gList));
  };

  const generarPorFormulaTrabajoDescanso = async () => {
    const w = Math.max(1, Math.round(leerNumero(formTrabajo) || 0));
    const r = Math.max(1, Math.round(leerNumero(formDescanso) || 0));
    if (w <= 0 || r <= 0) {
      setNotice('❌ Indica cuántos días de trabajo y cuántos días de descanso (mayores a 0).');
      return;
    }
    if (to < from) {
      setNotice('❌ La fecha "Hasta" no puede ser menor que "Desde".');
      return;
    }
    const esEscalonado = formModo === 'escalonado' || formModo === 'escalonado_trabajo';
    if (esEscalonado) {
      const faltan = metas.filter((m) => !formGrupoSel[m.id]);
      if (faltan.length) {
        setNotice(`❌ Falta asignar grupo a ${faltan.length} inspector(es).`);
        return;
      }
    }
    setBusy(true);
    setNotice(null);
    const indiceDeGrupo: Record<string, number> = {};
    GRUPOS_FORMULA.forEach((l, i) => {
      indiceDeGrupo[l] = i;
    });

    const nuevosShifts: any[] = [];
    for (const m of metas) {
      const letra = esEscalonado ? formGrupoSel[m.id] || 'A' : 'A';
      await supabase
        .from('guard_inspector_meta')
        .update({ grupo: letra, updated_by: uid })
        .eq('id', m.id);
      const idxGrupo = esEscalonado ? indiceDeGrupo[letra] ?? 0 : 0;
      const calc = generarPeriodosAutomaticosTrabajoDescanso({
        from,
        to,
        diasTrabajo: w,
        diasDescanso: r,
        modo: formModo,
        indiceGrupo: idxGrupo,
      });
      for (const pDesc of calc.periodosDescanso) {
        nuevosShifts.push({
          inspector_id: m.inspector_id,
          inspector_name: m.inspector_name,
          from_date: pDesc.from_date,
          to_date: pDesc.to_date,
          kind: 'descanso',
          grupo: letra,
          created_by: uid,
        });
      }
    }
    const delRes = await supabase
      .from('guard_shifts')
      .delete()
      .in(
        'inspector_name',
        metas.map((m) => m.inspector_name)
      );
    if (delRes.error) {
      setBusy(false);
      setNotice('❌ ' + delRes.error.message);
      return;
    }
    if (nuevosShifts.length) {
      const insRes = await supabase.from('guard_shifts').insert(nuevosShifts);
      if (insRes.error) {
        setBusy(false);
        setNotice('❌ ' + insRes.error.message);
        return;
      }
    }
    setBusy(false);
    setFormulaOpen(false);
    load();
    setNotice(`✅ Períodos generados automáticamente: ${w} día(s) de trabajo × ${r} día(s) de descanso.`);
  };

  // AUTOGENERAR 14x7: abre el modal para ARMAR LOS GRUPOS A MANO. Precarga con los
  // grupos ya asignados (si hay) o con la sugerencia automática, y desde el modal se
  // ajusta y se genera la rotación.
  const abrirGrupos = () => {
    if (metas.length === 0) { setNotice('❌ Primero agrega inspectores.'); return; }
    const init: Record<string, string> = {};
    let alguno = false;
    metas.forEach((m) => { if (m.grupo && GRUPOS.includes(m.grupo)) { init[m.id] = m.grupo; alguno = true; } });
    setGrupoSel(alguno ? init : computeAutoGroups());
    setNotice(null);
    setGrupoOpen(true);
  };

  // GENERAR la rotación 14x7 a partir de los grupos elegidos a mano (grupoSel).
  // Cada grupo descansa una semana: A = semana 1, B = semana 2, C = semana 3 (desde
  // el inicio del ciclo). Borra las guardias previas y crea las nuevas.
  const generarRotacion = async () => {
    const faltan = metas.filter((m) => !grupoSel[m.id]);
    if (faltan.length) { setNotice(`❌ Falta asignar grupo a ${faltan.length} inspector(es).`); return; }
    setBusy(true); setNotice(null);
    const semanaDe: Record<string, number> = {}; GRUPOS.forEach((l, i) => { semanaDe[l] = i; });
    const cycleStart = from;
    const nuevosShifts: any[] = [];
    for (const m of metas) {
      const letra = grupoSel[m.id];
      await supabase.from('guard_inspector_meta').update({ grupo: letra, updated_by: uid }).eq('id', m.id);
      const wk = semanaDe[letra] ?? 0;
      const dFromG = addDaysISO(cycleStart, wk * 7);
      const dToG = addDaysISO(cycleStart, wk * 7 + 6);
      nuevosShifts.push({ inspector_id: m.inspector_id, inspector_name: m.inspector_name, from_date: dFromG, to_date: dToG, kind: 'descanso', grupo: letra, created_by: uid });
    }
    await supabase.from('guard_shifts').delete().in('inspector_name', metas.map((m) => m.inspector_name));
    if (nuevosShifts.length) await supabase.from('guard_shifts').insert(nuevosShifts);
    setTo(addDaysISO(cycleStart, nGroups * 7 - 1));
    setBusy(false); setGrupoOpen(false); load();
    setNotice('✅ Rotación 14x7 generada.');
  };

  // Sugerencia AUTOMÁTICA del modo "1 día libre/semana" (round-robin por categoría,
  // igual criterio que los grupos: nunca dos coordinadores ni dos nocturnos el mismo
  // día). Devuelve metaId → código de día ('Lu'..'Do').
  const computeAutoDias = (): Record<string, string> => {
    const cat = (m: Meta) => (m.cargo === 'Coordinador' ? 0 : m.cargo === 'Nocturno' ? 1 : 2);
    const orden = [...metas].sort((a, b) => cat(a) - cat(b) || cmpText(a.inspector_name, b.inspector_name));
    const counters = [0, 0, 0];
    const out: Record<string, string> = {};
    orden.forEach((m) => { const c = cat(m); const d = DIA_CODES[counters[c] % DIA_CODES.length]; counters[c]++; out[m.id] = d; });
    return out;
  };

  // AUTOGENERAR "1 día libre/semana": abre el modal para asignar a mano el día de
  // descanso fijo de cada inspector.
  const abrirDias = () => {
    if (metas.length === 0) { setNotice('❌ Primero agrega inspectores.'); return; }
    const init: Record<string, string> = {};
    let alguno = false;
    metas.forEach((m) => { if (m.grupo && DIA_CODES.includes(m.grupo)) { init[m.id] = m.grupo; alguno = true; } });
    setDiaSel(alguno ? init : computeAutoDias());
    setNotice(null);
    setDiaOpen(true);
  };

  // GENERA el modo "1 día libre/semana": cada inspector descansa SOLO su día fijo,
  // repetido cada semana, dentro del rango [from, to] QUE EL USUARIO ELIGIÓ en la
  // tarjeta "Ciclo" (antes se forzaba a 4 semanas fijas desde el inicio, ignorando
  // el "Hasta" elegido — generaba días de descanso más allá del rango pedido). A
  // diferencia del 14x7, nadie deja de trabajar la semana completa.
  // Borra las guardias previas y crea las nuevas.
  const generarRotacionSemanal = async () => {
    const faltan = metas.filter((m) => !diaSel[m.id]);
    if (faltan.length) { setNotice(`❌ Falta asignar día libre a ${faltan.length} inspector(es).`); return; }
    if (to < from) { setNotice('❌ "Hasta" no puede ser menor que "Desde".'); return; }
    setBusy(true); setNotice(null);
    const rango = daysBetween(from, to);
    const nuevosShifts: any[] = [];
    for (const m of metas) {
      const code = diaSel[m.id];
      await supabase.from('guard_inspector_meta').update({ grupo: code, updated_by: uid }).eq('id', m.id);
      const dow = dowOfCode(code);
      rango.forEach((day) => {
        if (new Date(day + 'T00:00:00Z').getUTCDay() === dow) {
          nuevosShifts.push({ inspector_id: m.inspector_id, inspector_name: m.inspector_name, from_date: day, to_date: day, kind: 'descanso', grupo: code, created_by: uid });
        }
      });
    }
    await supabase.from('guard_shifts').delete().in('inspector_name', metas.map((m) => m.inspector_name));
    if (nuevosShifts.length) await supabase.from('guard_shifts').insert(nuevosShifts);
    setBusy(false); setDiaOpen(false); load();
    setNotice('✅ Turno de 1 día libre por semana generado.');
  };

  const generarPDF = async () => {
    if (metas.length === 0) { setNotice('❌ Agrega inspectores primero.'); return; }
    setBusy(true);
    try {
      const inspectors: GuardInspector[] = metas.map((m) => ({ name: m.inspector_name, grupo: m.grupo, cargo: m.cargo, cedula: m.cedula, telefono: m.telefono, sector: m.sector }));
      const shiftsIn: GuardShift[] = shifts.map((s) => ({ inspector_name: s.inspector_name, from_date: s.from_date, to_date: s.to_date, kind: (s.kind === 'turno' ? 'turno' : 'descanso') }));
      // Detecta el modo por la duración de los descansos: 1 día = "1 día libre/semana",
      // 7 días = 14x7 (grupo completo descansa la semana), mixto = editado a mano.
      const largos = shifts.filter((s) => s.kind === 'descanso').map((s) => daysBetween(s.from_date, s.to_date).length);
      const rotation = largos.length === 0 ? undefined
        : largos.every((n) => n === 1) ? '6x1 (1 día libre/semana)'
        : largos.every((n) => n === 7) ? '14x7'
        : 'Personalizada';
      await generateGuardiasReport({ from, to, rotation, inspectors, shifts: shiftsIn });
    } finally { setBusy(false); }
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SectionTitle>🗓️ Distribución de guardias</SectionTitle>

      {/* Ciclo */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Ciclo · desde</Text>
        <DateField value={from} onChange={setFrom} />
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Hasta</Text>
        <DateField value={to} onChange={setTo} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
          <TouchableOpacity onPress={abrirFormulaTrabajoDescanso} disabled={busy} style={{ flex: 1, minWidth: 165, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12.5 }}>🔢 Días Trabajo × Descanso</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={abrirGrupos} disabled={busy} style={{ flex: 1, minWidth: 130, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12.5 }}>⚙️ Grupo x semana</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={abrirDias} disabled={busy} style={{ flex: 1, minWidth: 130, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12.5 }}>📅 1 libre/semana</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={generarPDF} disabled={busy} style={{ flex: 1, minWidth: 130, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12.5 }}>📄 Generar PDF</Text>
          </TouchableOpacity>
        </View>
      </Card>

      {notice ? <Text style={{ color: notice.startsWith('✅') ? colors.success : colors.danger, fontWeight: '700', marginBottom: spacing.sm }}>{notice}</Text> : null}

      {conflicto ? (
        <View style={{ backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 12.5 }}>⚠️ Dos coordinadores descansan el {dmy(conflicto.day)}: {conflicto.coords.join(' y ')}. Ajusta sus rangos o grupos.</Text>
        </View>
      ) : null}

      {/* Calendario inspector × día */}
      {metas.length > 0 ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>Calendario del ciclo</Text>
            <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>
              👆 Toca cualquier día para cambiarlo manualmente entre T (Trabajo) y D (Descanso)
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              {/* Cabecera */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                <View style={{ width: 152 }}><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>Inspector (T/D)</Text></View>
                {days.map((d) => (
                  <View key={d} style={{ width: 24, alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontSize: 9, fontWeight: '800' }}>{ddOf(d)}</Text>
                    <Text style={{ color: dowOf(d) === 'S' || dowOf(d) === 'D' ? colors.danger : colors.muted, fontSize: 8 }}>{dowOf(d)}</Text>
                  </View>
                ))}
              </View>
              {/* Filas (cada celda es tocable para alternar T <-> D) */}
              {metas.map((m) => {
                const descList = (shiftsByName.get(m.inspector_name) ?? []).filter((s) => s.kind === 'descanso');
                const resumen = calcularPeriodosPersonaEnCiclo(from, to, descList);
                return (
                  <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <View style={{ width: 152, flexDirection: 'row', alignItems: 'center', gap: 3, paddingRight: 4 }}>
                      <View style={{ width: m.grupo && m.grupo.length > 1 ? 20 : 14, height: 14, borderRadius: 3, backgroundColor: m.grupo ? badgeColorOf(m.grupo) : colors.border, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900' }}>{m.grupo || '·'}</Text>
                      </View>
                      <Text style={{ color: colors.text, fontSize: 9.5, fontWeight: '700', flex: 1 }} numberOfLines={1}>{m.inspector_name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 8.5, fontWeight: '800' }}>
                        {resumen.diasTrabajo.length}T·{resumen.diasDescanso.length}D
                      </Text>
                    </View>
                    {days.map((d) => {
                      const st = estadoDe(m.inspector_name, d);
                      return (
                        <TouchableOpacity
                          key={d}
                          disabled={busy}
                          onPress={() => toggleDiaCalendario(m, d)}
                          style={{
                            width: 24,
                            height: 20,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: st === 'D' ? badgeColorOf(m.grupo) + '66' : 'transparent',
                            borderWidth: 0.5,
                            borderColor: colors.border,
                          }}
                        >
                          <Text style={{ color: st === 'D' ? colors.text : colors.muted, fontSize: 9.5, fontWeight: st === 'D' ? '900' : '500' }}>{st}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
              {/* En turno (T) */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <View style={{ width: 152 }}><Text style={{ color: colors.success, fontSize: 9, fontWeight: '800' }}>En trabajo (T)</Text></View>
                {days.map((d) => (
                  <View key={d} style={{ width: 24, alignItems: 'center' }}>
                    <Text style={{ color: colors.success, fontSize: 9, fontWeight: '800' }}>{metas.length - descansoCount(d)}</Text>
                  </View>
                ))}
              </View>
              {/* En descanso (D) */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <View style={{ width: 152 }}><Text style={{ color: colors.muted, fontSize: 9, fontWeight: '800' }}>En descanso (D)</Text></View>
                {days.map((d) => (
                  <View key={d} style={{ width: 24, alignItems: 'center' }}><Text style={{ color: colors.text, fontSize: 9, fontWeight: '700' }}>{descansoCount(d)}</Text></View>
                ))}
              </View>
            </View>
          </ScrollView>
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: spacing.xs }}>D = en descanso · T = en turno (trabajo). Toca cualquier celda para cambiar un día manualmente.</Text>
        </Card>
      ) : null}

      {/* Inspectores + metadata + guardias */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>👮 Inspectores ({metas.length})</Text>
        <TouchableOpacity onPress={() => setAddOpen(true)} style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
          <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>➕ Agregar</Text>
        </TouchableOpacity>
      </View>

      {metas.length === 0 ? (
        <EmptyState title="Sin inspectores" subtitle="Agrega inspectores y define sus días de trabajo y descanso manualmente o con «🔢 Días Trabajo × Descanso»." />
      ) : metas.map((m) => {
        const desc = (shiftsByName.get(m.inspector_name) ?? []).filter((s) => s.kind === 'descanso');
        const periodosCiclo = calcularPeriodosPersonaEnCiclo(from, to, desc);
        return (
          <Card key={m.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }}>👮 {m.inspector_name}</Text>
              <TouchableOpacity onPress={() => quitarInspector(m)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Quitar ✕</Text></TouchableOpacity>
            </View>
            {/* Cargo + grupo */}
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
              {CARGOS.map((c) => {
                const on = (m.cargo || '') === c;
                return (
                  <TouchableOpacity key={c} onPress={() => patchMeta(m, { cargo: c })} style={{ borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + '18' : colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 3, flexShrink: 1, maxWidth: '100%' }}>
                <Text style={{ color: colors.muted, fontSize: 11 }}>Gr.</Text>
                {GRUPOS.map((g) => {
                  const on = (m.grupo || '') === g;
                  return (
                    <TouchableOpacity key={g} onPress={() => patchMeta(m, { grupo: on ? null : g })} style={{ width: 24, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (grupoColor(g)) : colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '800', fontSize: 11 }}>{g}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {/* Cédula / teléfono / sector editables */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
              {([['cedula', 'Cédula'], ['telefono', 'Teléfono'], ['sector', 'Sector']] as const).map(([k, ph]) => (
                <TextInput key={k} defaultValue={(m as any)[k] ?? ''} onEndEditing={(e) => patchMeta(m, { [k]: e.nativeEvent.text.trim() || null } as any)} placeholder={ph} placeholderTextColor={colors.muted}
                  style={{ flex: 1, minWidth: 105, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, fontSize: 12 }} />
              ))}
            </View>
            {/* Resumen de Períodos de Trabajo (T) y Descansos (D) en el ciclo */}
            <View style={{ marginTop: spacing.xs, gap: 3 }}>
              <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                  🛠️ Trabajo en el ciclo ({periodosCiclo.diasTrabajo.length} d):{' '}
                  <Text style={{ fontWeight: '400' }}>
                    {periodosCiclo.periodosTrabajo.length > 0
                      ? formatearRangosCortos(periodosCiclo.periodosTrabajo)
                      : 'Sin días de trabajo en el rango'}
                  </Text>
                </Text>
              </View>
              {desc.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 11.5 }}>🛌 Sin descanso definido (trabaja todos los días del ciclo).</Text>
              ) : (
                desc.map((s) => (
                  <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 }}>
                    <Text style={{ color: colors.text, fontSize: 12 }}>
                      🛌 Descanso: {dmy(s.from_date)} al {dmy(s.to_date)} ({daysBetween(s.from_date, s.to_date).length} d)
                    </Text>
                    <TouchableOpacity onPress={() => quitarShift(s)}>
                      <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Borrar</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
              <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
                <TouchableOpacity
                  onPress={() => {
                    setDescansoFor(m);
                    setTipoRangoManual('descanso');
                    setDFrom(from);
                    setDTo(addDaysISO(from, 6));
                  }}
                  style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
                >
                  <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11.5 }}>➕ Agregar descanso (D)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setDescansoFor(m);
                    setTipoRangoManual('trabajo');
                    setDFrom(from);
                    setDTo(addDaysISO(from, 6));
                  }}
                  style={{ borderWidth: 1, borderColor: colors.success, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
                >
                  <Text style={{ color: colors.success, fontWeight: '700', fontSize: 11.5 }}>🛠️ Marcar días de trabajo (T)</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        );
      })}
      <View style={{ height: spacing.xl }} />

      {/* Modal: agregar inspector */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable onPress={() => setAddOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '80%', padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: spacing.sm }}>➕ Agregar inspector</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {disponibles.length === 0 ? <Text style={{ color: colors.muted, fontSize: 13 }}>Todos los inspectores ya están en la distribución.</Text> : disponibles.map((p) => (
                <TouchableOpacity key={p.id} onPress={() => agregarInspector(p)} disabled={busy} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{p.full_name}</Text>
                  {p.cedula ? <Text style={{ color: colors.muted, fontSize: 11 }}>C.I {p.cedula}</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setAddOpen(false)} style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal: Calcular automáticamente por Días de Trabajo × Días de Descanso */}
      <Modal visible={formulaOpen} transparent animationType="slide" onRequestClose={() => setFormulaOpen(false)}>
        <Pressable onPress={() => setFormulaOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%', padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: 2 }}>
              🔢 Calcular períodos por Días de Trabajo y Descanso
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: spacing.sm }}>
              Indica cuántos días trabaja y cuántos días descansa el personal. El sistema calcula automáticamente los períodos de trabajo (T) y de descanso (D) dentro del ciclo {dmy(from)} — {dmy(to)}.
            </Text>

            {/* Atajos rápidos */}
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>Esquemas frecuentes (o escribe abajo cualquier cantidad):</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: spacing.sm }}>
              {(
                [
                  [14, 7, '14×7'],
                  [7, 7, '7×7'],
                  [21, 7, '21×7'],
                  [10, 4, '10×4'],
                  [6, 1, '6×1'],
                  [5, 2, '5×2'],
                  [4, 2, '4×2'],
                ] as const
              ).map(([w, r, lbl]) => {
                const activo = numTrabajoFormula === w && numDescansoFormula === r;
                return (
                  <TouchableOpacity
                    key={lbl}
                    onPress={() => aplicarPresetFormula(w, r)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: radius.pill,
                      borderWidth: 1.5,
                      borderColor: activo ? colors.success : colors.border,
                      backgroundColor: activo ? colors.success + '22' : colors.surface,
                    }}
                  >
                    <Text style={{ color: activo ? colors.success : colors.text, fontWeight: '800', fontSize: 12 }}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Inputs de Días de Trabajo y Días de Descanso */}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', marginBottom: 3 }}>🛠️ Días de trabajo</Text>
                <TextInput
                  value={formTrabajo}
                  onChangeText={(txt) => {
                    setFormTrabajo(txt);
                    const w = Math.max(1, Math.round(leerNumero(txt) || 1));
                    const gList = Array.from(
                      { length: calcularGruposSugeridosFormula(w, numDescansoFormula) },
                      (_, i) => String.fromCharCode(65 + i)
                    );
                    setFormGrupoSel((prev) => ({ ...computeAutoGroups(gList), ...prev }));
                  }}
                  keyboardType="numeric"
                  placeholder="Ej. 14"
                  placeholderTextColor={colors.muted}
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1.5,
                    borderColor: colors.success,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 8,
                    color: colors.text,
                    fontSize: 15,
                    fontWeight: '800',
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', marginBottom: 3 }}>🛌 Días de descanso</Text>
                <TextInput
                  value={formDescanso}
                  onChangeText={(txt) => {
                    setFormDescanso(txt);
                    const r = Math.max(1, Math.round(leerNumero(txt) || 1));
                    const gList = Array.from(
                      { length: calcularGruposSugeridosFormula(numTrabajoFormula, r) },
                      (_, i) => String.fromCharCode(65 + i)
                    );
                    setFormGrupoSel((prev) => ({ ...computeAutoGroups(gList), ...prev }));
                  }}
                  keyboardType="numeric"
                  placeholder="Ej. 7"
                  placeholderTextColor={colors.muted}
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1.5,
                    borderColor: colors.primary,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 8,
                    color: colors.text,
                    fontSize: 15,
                    fontWeight: '800',
                  }}
                />
              </View>
            </View>

            {/* Botones rápidos para ajustar duración del ciclo a 1 o 2 rotaciones completas */}
            <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginBottom: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setTo(addDaysISO(from, numTrabajoFormula + numDescansoFormula - 1))}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
              >
                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                  📏 Ajustar ciclo a 1 rotación ({numTrabajoFormula + numDescansoFormula} días)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setTo(addDaysISO(from, (numTrabajoFormula + numDescansoFormula) * 2 - 1))}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
              >
                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                  📏 Ajustar a 2 rotaciones ({(numTrabajoFormula + numDescansoFormula) * 2} días)
                </Text>
              </TouchableOpacity>
            </View>

            {/* Modo de distribución */}
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>¿Cómo distribuir los períodos?</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: spacing.sm }}>
              {(
                [
                  ['escalonado_trabajo', '🔄 Por grupos (Grupo A empieza trabajando)'],
                  ['escalonado', '🪜 Por grupos (Grupo A empieza descansando)'],
                  ['simultaneo_trabajo_primero', '👥 Todos igual (empiezan trabajando)'],
                ] as const
              ).map(([mKey, mLbl]) => {
                const on = formModo === mKey;
                return (
                  <TouchableOpacity
                    key={mKey}
                    onPress={() => setFormModo(mKey)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.primary + '18' : colors.surface,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: on ? '800' : '600' }}>{mLbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {notice && formulaOpen ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginBottom: spacing.xs }}>{notice}</Text> : null}

            {/* Lista de personal con su grupo y vista previa de los períodos calculados */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                Vista previa de períodos ({dmy(from)} al {dmy(to)})
              </Text>
              {(formModo === 'escalonado' || formModo === 'escalonado_trabajo') ? (
                <TouchableOpacity
                  onPress={() => setFormGrupoSel(computeAutoGroups(GRUPOS_FORMULA))}
                  style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}
                >
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11 }}>✨ Sugerir grupos</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 260 }}>
              {[...metas]
                .sort((a, b) => cmpText(a.inspector_name, b.inspector_name))
                .map((m) => {
                  const letra = formGrupoSel[m.id] || 'A';
                  const idxG = Math.max(0, GRUPOS_FORMULA.indexOf(letra));
                  const prevCalc = generarPeriodosAutomaticosTrabajoDescanso({
                    from,
                    to,
                    diasTrabajo: numTrabajoFormula,
                    diasDescanso: numDescansoFormula,
                    modo: formModo,
                    indiceGrupo: idxG,
                  });
                  return (
                    <View
                      key={m.id}
                      style={{
                        paddingVertical: 7,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                      }}
                    >
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <View style={{ flex: 1, minWidth: 130, paddingRight: spacing.xs }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }} numberOfLines={1}>
                            {m.inspector_name}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 10.5 }}>{m.cargo || 'Inspector'}</Text>
                        </View>
                        {(formModo === 'escalonado' || formModo === 'escalonado_trabajo') ? (
                          <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', flexShrink: 1, maxWidth: '100%', justifyContent: 'flex-end' }}>
                            {GRUPOS_FORMULA.map((g) => {
                              const on = letra === g;
                              return (
                                <TouchableOpacity
                                  key={g}
                                  onPress={() => setFormGrupoSel((p) => ({ ...p, [m.id]: g }))}
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 6,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: on ? grupoColor(g) : colors.surfaceAlt,
                                    borderWidth: 1.5,
                                    borderColor: on ? grupoColor(g) : colors.border,
                                  }}
                                >
                                  <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '900', fontSize: 12 }}>{g}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                      <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700', marginTop: 3 }}>
                        🛠️ Trabajo ({prevCalc.diasTrabajoList.length} d): {formatearRangosCortos(prevCalc.periodosTrabajo)}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                        🛌 Descanso ({prevCalc.diasDescansoList.length} d): {formatearRangosCortos(prevCalc.periodosDescanso)}
                      </Text>
                    </View>
                  );
                })}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity
                onPress={() => setFormulaOpen(false)}
                style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={generarPorFormulaTrabajoDescanso}
                disabled={busy}
                style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success, opacity: busy ? 0.6 : 1 }}
              >
                <Text style={{ color: '#fff', fontWeight: '900' }}>
                  {busy ? 'Generando…' : `🔢 Aplicar ${numTrabajoFormula}d T × ${numDescansoFormula}d D`}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal: ARMAR GRUPOS 14x7 a mano */}
      <Modal visible={grupoOpen} transparent animationType="slide" onRequestClose={() => setGrupoOpen(false)}>
        <Pressable onPress={() => setGrupoOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%', padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: 2 }}>⚙️ Armar grupos 14x7</Text>
            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: spacing.sm }}>
              Asigna cada inspector a un grupo. Cada grupo descansa una semana distinta (A = semana 1, B = semana 2, …). Hay {nGroups} grupos ({GRUPOS.join(' · ')}), desde {dmy(from)}. Al generar se reemplazan las guardias actuales.
            </Text>
            {/* Sugerir automático + conteo por grupo */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', flex: 1, minWidth: 160, marginRight: spacing.sm }}>
                {GRUPOS.map((g) => (
                  <View key={g} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: grupoColor(g), alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{g}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{metas.filter((m) => grupoSel[m.id] === g).length}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity onPress={() => setGrupoSel(computeAutoGroups())} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11.5 }}>✨ Sugerir automático</Text>
              </TouchableOpacity>
            </View>
            {notice && grupoOpen ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginBottom: spacing.xs }}>{notice}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}>
              {[...metas].sort((a, b) => cmpText(a.inspector_name, b.inspector_name)).map((m) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1, paddingRight: spacing.sm }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{m.inspector_name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 10.5 }}>{m.cargo || 'Inspector'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1 }}>
                    {GRUPOS.map((g) => {
                      const on = grupoSel[m.id] === g;
                      return (
                        <TouchableOpacity key={g} onPress={() => setGrupoSel((prev) => ({ ...prev, [m.id]: g }))} style={{ width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? grupoColor(g) : colors.surfaceAlt, borderWidth: 1.5, borderColor: on ? grupoColor(g) : colors.border }}>
                          <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '900', fontSize: 13 }}>{g}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setGrupoOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={generarRotacion} disabled={busy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Generando…' : '⚙️ Generar rotación 14x7'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal: ARMAR "1 día libre/semana" a mano */}
      <Modal visible={diaOpen} transparent animationType="slide" onRequestClose={() => setDiaOpen(false)}>
        <Pressable onPress={() => setDiaOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%', padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: 2 }}>📅 1 día libre por semana</Text>
            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: spacing.sm }}>
              Asigna a cada inspector UN día fijo de descanso a la semana; los demás días trabaja normal. A diferencia del modo por grupos, ninguna semana queda alguien sin trabajar toda la semana. Se repite cada semana dentro del ciclo {dmy(from)} — {dmy(to)} (ajusta "Ciclo" arriba si necesitas otro rango). Al generar se reemplazan las guardias actuales.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', flex: 1, minWidth: 160, marginRight: spacing.sm }}>
                {DIAS_SEMANA.map((d) => (
                  <View key={d.code} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: diaColor(d.code), alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900' }}>{d.code}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{metas.filter((m) => diaSel[m.id] === d.code).length}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity onPress={() => setDiaSel(computeAutoDias())} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11.5 }}>✨ Sugerir automático</Text>
              </TouchableOpacity>
            </View>
            {notice && diaOpen ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginBottom: spacing.xs }}>{notice}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}>
              {[...metas].sort((a, b) => cmpText(a.inspector_name, b.inspector_name)).map((m) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1, paddingRight: spacing.sm }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{m.inspector_name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 10.5 }}>{m.cargo || 'Inspector'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1 }}>
                    {DIAS_SEMANA.map((d) => {
                      const on = diaSel[m.id] === d.code;
                      return (
                        <TouchableOpacity key={d.code} onPress={() => setDiaSel((prev) => ({ ...prev, [m.id]: d.code }))} style={{ width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? diaColor(d.code) : colors.surfaceAlt, borderWidth: 1.5, borderColor: on ? diaColor(d.code) : colors.border }}>
                          <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '900', fontSize: 11 }}>{d.code}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setDiaOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={generarRotacionSemanal} disabled={busy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{busy ? 'Generando…' : '📅 Generar 1 libre/semana'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal: Marcar rango manual de Descanso (D) o de Trabajo (T) */}
      <Modal visible={!!descansoFor} transparent animationType="slide" onRequestClose={() => setDescansoFor(null)}>
        <Pressable onPress={() => setDescansoFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: spacing.xs }}>
              {tipoRangoManual === 'descanso' ? '🛌 Marcar días de Descanso (D)' : '🛠️ Marcar días de Trabajo (T)'} · {descansoFor?.inspector_name}
            </Text>

            {/* Conmutador Descanso vs Trabajo */}
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setTipoRangoManual('descanso')}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  borderWidth: 1.5,
                  borderColor: tipoRangoManual === 'descanso' ? colors.accent : colors.border,
                  backgroundColor: tipoRangoManual === 'descanso' ? colors.accent + '22' : colors.surface,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>🛌 Días de Descanso (D)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setTipoRangoManual('trabajo')}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  borderWidth: 1.5,
                  borderColor: tipoRangoManual === 'trabajo' ? colors.success : colors.border,
                  backgroundColor: tipoRangoManual === 'trabajo' ? colors.success + '22' : colors.surface,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>🛠️ Días de Trabajo (T)</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Desde</Text>
            <DateField value={dFrom} onChange={setDFrom} />
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Hasta</Text>
            <DateField value={dTo} onChange={setDTo} />

            {/* Botones rápidos para aplicar a todo el ciclo */}
            <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.sm }}>
              <TouchableOpacity
                onPress={() => aplicarRangoManual('trabajo', from, to)}
                disabled={busy}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
              >
                <Text style={{ color: colors.success, fontSize: 11, fontWeight: '800' }}>🛠️ Todo el ciclo en Trabajo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => aplicarRangoManual('descanso', from, to)}
                disabled={busy}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
              >
                <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>🛌 Todo el ciclo en Descanso</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setDescansoFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => aplicarRangoManual()}
                disabled={busy}
                style={{
                  flex: 2,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  backgroundColor: tipoRangoManual === 'descanso' ? colors.accent : colors.success,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: tipoRangoManual === 'descanso' ? colors.accentContrast : '#fff', fontWeight: '800' }}>
                  {busy ? 'Guardando…' : tipoRangoManual === 'descanso' ? '🛌 Guardar descanso' : '🛠️ Guardar días de trabajo'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
