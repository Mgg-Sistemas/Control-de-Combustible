// 👥 LOS REPORTES PERSONALIZADOS DE TODOS (03-nov-2026, a pedido: «que los admin
// puedan ver el histórico de cada reporte personalizado que hizo cada persona, y
// poder reutilizarlo también»). Solo se monta para administradores, y la base lo
// exige igual (RLS de reportes_personalizados_historial: cada quien ve lo suyo,
// el admin todo). Lista liviana: las filas del papel se bajan solo al tocar
// Reimprimir o Reusar. Desde aquí no se borra nada de nadie.
import React, { useCallback, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { norm } from '../lib/text';
import { dmyPersonalizado, type RegistroHistorialPersonalizado } from '../lib/reporteMaquinariaPersonalizado';
import { cargarReporteCompleto, listarHistorialDeTodos, type ReporteDeTodos } from '../lib/reportePersonalizadoStorage';

const TODOS = '__todos__';

/** «03/11/2026 6:20 pm» en hora de Caracas. */
function cuandoCaracas(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try {
    return new Date(t).toLocaleString('es-VE', {
      timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function HistorialTodosPersonalizado(props: {
  /** Hay filas en el taller: reusar las reemplaza (pide un segundo toque). */
  hayPapelCargado: boolean;
  onReimprimir: (reg: RegistroHistorialPersonalizado) => Promise<void> | void;
  onReusar: (reg: RegistroHistorialPersonalizado) => void;
}) {
  const { colors } = useTheme();
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lista, setLista] = useState<ReporteDeTodos[] | null>(null);
  const [persona, setPersona] = useState<string>(TODOS);
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmaReusar, setConfirmaReusar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setLista(await listarHistorialDeTodos());
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el histórico de todos.');
    } finally {
      setCargando(false);
    }
  }, []);

  const abrir = () => {
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (nuevo && lista === null) void cargar();
  };

  // Las personas, con cuántos reportes tiene cada una (las de más reportes primero).
  const personas = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; n: number }>();
    for (const r of lista ?? []) {
      const p = m.get(r.autorId) ?? { id: r.autorId, nombre: r.autorNombre, n: 0 };
      p.n += 1;
      m.set(r.autorId, p);
    }
    return Array.from(m.values()).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre));
  }, [lista]);

  const visibles = useMemo(() => {
    const q = norm(busca);
    return (lista ?? [])
      .filter((r) => persona === TODOS || r.autorId === persona)
      .filter((r) => !q || norm([
        r.autorNombre, r.etiqueta, r.titulo, r.resumen?.empresasTexto, r.resumen?.encargadosTexto, r.resumen?.agruparPorTexto, r.resumen?.categoriasTexto,
        r.resumen?.previewEquipos, r.resumen?.rangoTexto, dmyPersonalizado(r.desde), dmyPersonalizado(r.hasta),
      ].filter(Boolean).join(' ')).includes(q));
  }, [lista, persona, busca]);

  const traer = async (r: ReporteDeTodos): Promise<RegistroHistorialPersonalizado | null> => {
    try {
      return await cargarReporteCompleto(r.id);
    } catch (e: any) {
      setError(e?.message || 'No se pudo abrir ese reporte.');
      return null;
    }
  };

  const reimprimir = async (r: ReporteDeTodos) => {
    setOcupado(r.id);
    try {
      const reg = await traer(r);
      if (reg) await props.onReimprimir(reg);
    } finally {
      setOcupado(null);
    }
  };

  const reusar = async (r: ReporteDeTodos) => {
    if (props.hayPapelCargado && confirmaReusar !== r.id) {
      setConfirmaReusar(r.id);
      setTimeout(() => setConfirmaReusar((a) => (a === r.id ? null : a)), 3500);
      return;
    }
    setConfirmaReusar(null);
    setOcupado(r.id);
    try {
      const reg = await traer(r);
      if (reg) props.onReusar(reg);
    } finally {
      setOcupado(null);
    }
  };

  const pastilla = (key: string, label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} onPress={onPress}
      style={{ borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm }}>
      <TouchableOpacity onPress={abrir}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
          👥 Reportes de todos {lista ? `(${lista.length})` : ''} {abierto ? '▲' : '▼'}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
          Solo los administradores ven esto: los reportes personalizados que sacó cada persona. Puedes reimprimirlos como
          estaban o cargarlos en el taller para reusarlos. Desde aquí no se borra nada.
        </Text>
      </TouchableOpacity>

      {abierto ? (
        <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          {error ? <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ {error}</Text> : null}
          {cargando ? <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text> : null}

          {lista && lista.length > 0 ? (
            <>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>👤 ¿De quién?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {pastilla(TODOS, `Todos (${lista.length})`, persona === TODOS, () => setPersona(TODOS))}
                {personas.map((p) => pastilla(p.id, `${p.nombre} (${p.n})`, persona === p.id, () => setPersona(p.id)))}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                <TextInput value={busca} onChangeText={setBusca} placeholder="🔎 Buscar por nombre, empresa, máquina, fecha…" placeholderTextColor={colors.muted}
                  style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                <TouchableOpacity onPress={() => void cargar()} disabled={cargando}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8, opacity: cargando ? 0.5 : 1 }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>🔄 Actualizar</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          {lista && lista.length === 0 && !cargando ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>Todavía nadie ha sacado un reporte personalizado.</Text>
          ) : null}
          {lista && lista.length > 0 && visibles.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>No hay reportes con ese filtro.</Text>
          ) : null}

          {visibles.map((r) => {
            const rango = r.conRango && r.desde ? `📅 Del ${dmyPersonalizado(r.desde)} al ${dmyPersonalizado(r.hasta || r.desde)}` : '';
            const eq = r.resumen?.totalEquipos != null ? `${r.resumen.totalEquipos} equipo(s)` : '';
            const conf = confirmaReusar === r.id;
            return (
              <View key={r.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs, marginTop: 2 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{r.etiqueta || r.titulo || 'Reporte personalizado'}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  👤 {r.autorNombre} · 🕒 {cuandoCaracas(r.sacadoAt)}{eq ? ` · ${eq}` : ''}{r.vecesReimpreso > 0 ? ` · 🖨️ reimpreso ${r.vecesReimpreso} vez(ces)` : ''}
                </Text>
                {rango || r.resumen?.empresasTexto || (r.resumen?.encargadosTexto && r.resumen.encargadosTexto !== 'Todos los encargados') ? (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{[
                    rango,
                    r.resumen?.empresasTexto ? `🏢 ${r.resumen.empresasTexto}` : '',
                    r.resumen?.encargadosTexto && r.resumen.encargadosTexto !== 'Todos los encargados' ? `🧑‍🔧 ${r.resumen.encargadosTexto}` : '',
                    r.resumen?.agruparPorTexto && r.resumen.agruparPorTexto !== 'Sin agrupar' ? `🗂️ ${r.resumen.agruparPorTexto}` : '',
                  ].filter(Boolean).join(' · ')}</Text>
                ) : null}
                {r.resumen?.previewEquipos ? <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={2}>🚜 {r.resumen.previewEquipos}</Text> : null}
                {r.quitadoAt ? (
                  <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>🗑️ {r.autorNombre} lo quitó de su histórico el {cuandoCaracas(r.quitadoAt)} (aquí se conserva).</Text>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <TouchableOpacity onPress={() => void reimprimir(r)} disabled={!!ocupado}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, opacity: ocupado ? 0.5 : 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{ocupado === r.id ? '…' : '🖨️ Reimprimir como estaba'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => void reusar(r)} disabled={!!ocupado}
                    style={{ borderWidth: 1, borderColor: conf ? colors.danger : colors.brandText, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, opacity: ocupado ? 0.5 : 1 }}>
                    <Text style={{ color: conf ? colors.danger : colors.brandText, fontWeight: '800', fontSize: 12 }}>
                      {conf ? '⚠️ Reemplaza lo del taller. Toca otra vez' : '✏️ Reusar y modificar'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
