// 👥 AUDITORÍA DE USUARIOS (09-nov-2026): quién se conecta, desde qué equipo, en qué pantalla
// está, cuánto tiempo y qué hace. Igual que el de Golden Touch, con el resumen calculado en la
// base (solo viaja el resumen) y «por día» de 7am a 7am. Solo lo ve quien ve la auditoría.
// La lógica vive en `lib/actividadUsuarios.ts` (probada); aquí solo se pinta.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { Card, Loading } from './ui';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { pdfDocument, exportPdf } from '../lib/pdf';
import { caracasBusinessToday } from '../lib/caracasDay';
import {
  accionesPorModulo, cargarActividad, cargarActividadUsuario, etiquetaDispositivo, fechaCorta, fmtDuracion, minutosEntre,
  nombreCorto, rangoDePeriodo, totalesActividad, versionCargada, versionVieja,
} from '../lib/actividadUsuarios';
import type { DetalleUsuario, Periodo, ResumenActividad, UsuarioResumen } from '../lib/actividadUsuarios';

const PERIODOS: { k: Periodo; label: string }[] = [
  { k: 'hoy', label: 'Hoy' }, { k: '7d', label: 'Últimos 7 días' }, { k: 'mes', label: 'Este mes' }, { k: 'todo', label: 'Todo' }, { k: 'rango', label: 'Rango…' },
];
type SeccionPdf = 'conectados' | 'tiempo' | 'acciones' | 'dias' | 'modulos' | 'tabla';
const SECCIONES_PDF: { k: SeccionPdf; label: string }[] = [
  { k: 'conectados', label: 'Conectados ahora' }, { k: 'tiempo', label: 'Tiempo por usuario' }, { k: 'acciones', label: 'Acciones por usuario' },
  { k: 'dias', label: 'Actividad por día' }, { k: 'modulos', label: 'Acciones por módulo' }, { k: 'tabla', label: 'Usuarios en el período' },
];
const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hora = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
};

export function UsuariosActividad() {
  const { colors } = useTheme();
  const hoy = caracasBusinessToday();
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<ResumenActividad | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<UsuarioResumen | null>(null);
  const [detalle, setDetalle] = useState<DetalleUsuario | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const [ocultosPdf, setOcultosPdf] = useState<Set<SeccionPdf>>(new Set());
  const [opcionesPdf, setOpcionesPdf] = useState(false);
  const pedido = useRef(0);
  const miVersion = useMemo(() => versionCargada(), []);

  const rango = useMemo(() => rangoDePeriodo(periodo, hoy, desde, hasta), [periodo, hoy, desde, hasta]);

  const cargar = useCallback(async () => {
    const n = ++pedido.current;
    setCargando(true); setError(null);
    try {
      const r = await cargarActividad(rango.desde, rango.hasta);
      if (n === pedido.current) setDatos(r);
    } catch (e: any) {
      if (n === pedido.current) setError(e?.message || 'No se pudo cargar la actividad.');
    } finally {
      if (n === pedido.current) setCargando(false);
    }
  }, [rango]);
  useEffect(() => { cargar(); }, [cargar]);
  // «Conectados ahora» se refresca solo cada 2 minutos (una consulta chica).
  useEffect(() => { const t = setInterval(() => cargar(), 120_000); return () => clearInterval(t); }, [cargar]);

  const abrir = async (u: UsuarioResumen) => {
    setSel(u); setDetalle(null); setErrorDetalle(null);
    try { setDetalle(await cargarActividadUsuario(u.user_id, rango.desde, rango.hasta)); } catch (e: any) { setErrorDetalle(e?.message || 'No se pudo cargar el detalle.'); }
  };

  const tot = datos ? totalesActividad(datos) : null;
  const porTiempo = useMemo(() => (datos?.usuarios ?? []).filter((u) => u.minutos > 0).sort((a, b) => b.minutos - a.minutos), [datos]);
  const porAcciones = useMemo(() => (datos?.usuarios ?? []).filter((u) => u.acciones > 0).sort((a, b) => b.acciones - a.acciones), [datos]);
  const modulos = useMemo(() => accionesPorModulo(datos?.acciones_por_tabla ?? []), [datos]);

  // ── PDF (vista previa; lo oculto no deja rastro; el período va al nombre del archivo) ──
  const pdf = async () => {
    if (!datos || !tot) return;
    const ve = (k: SeccionPdf) => !ocultosPdf.has(k);
    const tabla = (cab: string[], filas: string[][]) => `<table><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const partes: string[] = [`<div class="kpis"><div><b>${tot.conectados}</b><span>Conectados ahora</span></div><div><b>${esc(fmtDuracion(tot.minutos))}</b><span>Tiempo total conectado (${tot.sesiones} sesiones)</span></div><div><b>${tot.activos}</b><span>Usuarios activos</span></div><div><b>${tot.acciones}</b><span>Acciones registradas</span></div></div>`];
    if (ve('conectados')) partes.push(`<h3>Conectados ahora (${datos.conectados.length})</h3>` + (datos.conectados.length ? tabla(['Usuario', 'Equipo', 'Pantalla', 'Desde', 'Conectado'], datos.conectados.map((c) => [esc(c.nombre), esc(etiquetaDispositivo(c.dispositivo)), esc(c.pantalla ?? '—'), esc(hora(c.inicio)), esc(fmtDuracion(minutosEntre(c.inicio, datos.ahora)))])) : '<p>Nadie conectado en este momento.</p>'));
    if (ve('tiempo')) partes.push('<h3>Tiempo conectado por usuario</h3>' + tabla(['Usuario', 'Sesiones', 'Tiempo'], porTiempo.map((u) => [esc(u.nombre), String(u.sesiones), esc(fmtDuracion(u.minutos))])));
    if (ve('acciones')) partes.push('<h3>Acciones por usuario</h3>' + tabla(['Usuario', 'Acciones'], porAcciones.map((u) => [esc(u.nombre), String(u.acciones)])));
    if (ve('dias')) partes.push('<h3>Actividad por día (jornada de 7am a 7am)</h3>' + tabla(['Jornada', 'Usuarios', 'Tiempo', 'Acciones'], datos.por_dia.map((d) => [esc(fechaCorta(d.dia)), String(d.usuarios), esc(fmtDuracion(d.minutos)), String(d.acciones)])));
    if (ve('modulos')) partes.push('<h3>Acciones por módulo</h3>' + tabla(['Módulo', 'Acciones'], modulos.map((m) => [esc(m.modulo), String(m.n)])));
    if (ve('tabla')) partes.push('<h3>Usuarios en el período</h3>' + tabla(['Usuario', 'Rol', 'Sesiones', 'Tiempo', 'Acciones', 'Última actividad'], (datos.usuarios ?? []).map((u) => [esc(u.nombre), esc(u.rol ?? '—'), String(u.sesiones), esc(fmtDuracion(u.minutos)), String(u.acciones), esc(hora(u.ultima))])));
    const html = pdfDocument({
      title: 'Auditoría de usuarios',
      subtitle: esc(rango.texto),
      extraCss: `.kpis{display:flex;gap:8px;margin:6px 0 10px}.kpis div{flex:1;border:1px solid #c9d2dc;border-radius:6px;padding:8px;text-align:center}.kpis b{display:block;font-size:17px;color:#16324F}.kpis span{font-size:10px;color:#555}
        h3{font-size:12px;color:#16324F;margin:12px 0 4px}table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border:1px solid #c9d2dc;padding:4px 6px;text-align:left}th{background:#16324F;color:#fff}tr{page-break-inside:avoid}`,
      body: partes.join(''),
    });
    await exportPdf(html, `Auditoria de usuarios - ${rango.texto.replace(/[\\/:*?"<>|]/g, '-')}`);
  };

  // ── Piezas ──
  const pastilla = (on: boolean) => ({ backgroundColor: on ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs });
  const Kpi = ({ t, v, n, destacado }: { t: string; v: string; n: string; destacado?: boolean }) => (
    <View style={{ flexGrow: 1, flexBasis: 150, borderWidth: 1, borderColor: destacado ? colors.warning : colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>{t.toUpperCase()}</Text>
      <Text style={{ color: destacado ? colors.warning : colors.text, fontSize: 22, fontWeight: '900' }}>{v}</Text>
      <Text style={{ color: colors.muted, fontSize: 10 }}>{n}</Text>
    </View>
  );
  const Barras = ({ filas, valor, texto, color, onPress }: { filas: UsuarioResumen[] | { modulo: string; n: number }[]; valor: (f: any) => number; texto: (f: any) => string; color: string; onPress?: (f: any) => void }) => {
    const max = Math.max(1, ...filas.map(valor));
    return (
      <View style={{ gap: 4 }}>
        {filas.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Sin datos en el período.</Text> : null}
        {filas.map((f: any, i) => (
          <TouchableOpacity key={i} disabled={!onPress} onPress={() => onPress?.(f)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text numberOfLines={1} style={{ width: 120, color: colors.text, fontSize: 11, fontWeight: '700' }}>{nombreCorto(f.nombre ?? f.modulo)}</Text>
            <View style={{ flex: 1, height: 10, backgroundColor: colors.surfaceAlt, borderRadius: 5, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(2, (valor(f) / max) * 100)}%`, height: '100%', backgroundColor: color, borderRadius: 5 }} />
            </View>
            <Text style={{ width: 62, textAlign: 'right', color: colors.text, fontSize: 11, fontWeight: '800' }}>{texto(f)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Quién se conecta, desde qué equipo, en qué pantalla está, cuánto tiempo y qué hace (cambios, aprobaciones, registros). Toca un usuario para ver su detalle.
      </Text>

      {/* Período */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' }}>
        {PERIODOS.map((p) => (
          <TouchableOpacity key={p.k} onPress={() => setPeriodo(p.k)} style={pastilla(periodo === p.k)}>
            <Text style={{ color: periodo === p.k ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => setOpcionesPdf((v) => !v)} disabled={!datos} style={[pastilla(false), { marginLeft: 'auto' }]}>
          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>🖨️ Vista previa PDF</Text>
        </TouchableOpacity>
      </View>
      {periodo === 'rango' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>DESDE</Text><DateField value={desde} onChange={setDesde} maxISO={hoy} /></View>
          <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>HASTA</Text><DateField value={hasta} onChange={setHasta} maxISO={hoy} /></View>
        </View>
      ) : null}
      {opcionesPdf ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>¿Qué sale en el PDF?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {SECCIONES_PDF.map((s) => {
              const on = !ocultosPdf.has(s.k);
              return (
                <TouchableOpacity key={s.k} onPress={() => setOcultosPdf((prev) => { const n = new Set(prev); if (n.has(s.k)) n.delete(s.k); else n.add(s.k); return n; })} style={pastilla(on)}>
                  <Text style={{ color: on ? colors.primaryContrast : colors.text, fontSize: 11, fontWeight: '700' }}>{on ? '✓ ' : ''}{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity onPress={pdf} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>📄 Ver PDF</Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      <Text style={{ color: colors.muted, fontSize: 11 }}>{rango.texto} · jornada de 7am a 7am{cargando ? ' · actualizando…' : ''}</Text>
      {error ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠️ {error}</Text>
          <TouchableOpacity onPress={cargar} style={{ alignSelf: 'flex-start' }}><Text style={{ color: colors.danger, fontWeight: '800' }}>🔄 Reintentar</Text></TouchableOpacity>
        </View>
      ) : null}
      {!datos && cargando ? <Loading /> : null}

      {datos && tot ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Kpi t="Conectados ahora" v={String(tot.conectados)} n="latido < 3 min" destacado />
            <Kpi t="Tiempo total conectado" v={fmtDuracion(tot.minutos)} n={`${tot.sesiones} sesión(es)`} />
            <Kpi t="Usuarios activos" v={String(tot.activos)} n="en el período" />
            <Kpi t="Acciones registradas" v={String(tot.acciones)} n="cambios / aprobaciones…" />
          </View>

          <Card>
            <Text style={{ color: colors.success, fontWeight: '900', marginBottom: 6 }}>🟢 CONECTADOS AHORA ({datos.conectados.length})</Text>
            {datos.conectados.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Nadie conectado en este momento.</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {datos.conectados.map((c) => {
                const vieja = versionVieja(c.version, miVersion);
                return (
                  <View key={c.user_id} style={{ borderWidth: 1, borderColor: vieja ? colors.warning : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4, backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>● {c.nombre} · {fmtDuracion(minutosEntre(c.inicio, datos.ahora))}</Text>
                    <Text style={{ color: colors.muted, fontSize: 10 }}>{etiquetaDispositivo(c.dispositivo)}{c.navegador ? ` · ${c.navegador}` : ''}{c.pantalla ? ` · 📍 ${c.pantalla}` : ''}</Text>
                    {vieja ? <Text style={{ color: colors.warning, fontSize: 10, fontWeight: '800' }}>⚠️ Versión anterior: pídele que recargue (Ctrl + F5)</Text> : null}
                  </View>
                );
              })}
            </View>
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <View style={{ flexGrow: 1, flexBasis: 320 }}>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '900', marginBottom: 6 }}>⏱️ TIEMPO CONECTADO POR USUARIO</Text>
                <Barras filas={porTiempo} valor={(u) => u.minutos} texto={(u) => fmtDuracion(u.minutos)} color={colors.success} onPress={abrir} />
                <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>El tiempo se mide desde el 09/11/2026 (cuando empezó el latido). Toca una barra para ver el detalle.</Text>
              </Card>
            </View>
            <View style={{ flexGrow: 1, flexBasis: 320 }}>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '900', marginBottom: 6 }}>⚡ ACCIONES POR USUARIO</Text>
                <Barras filas={porAcciones} valor={(u) => u.acciones} texto={(u) => String(u.acciones)} color={colors.warning} onPress={abrir} />
              </Card>
            </View>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <View style={{ flexGrow: 1, flexBasis: 320 }}>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '900', marginBottom: 6 }}>📈 ACTIVIDAD POR DÍA</Text>
                <Barras filas={datos.por_dia.map((d) => ({ modulo: `${fechaCorta(d.dia)} · ${d.usuarios} usuario(s)`, n: d.acciones }))} valor={(d) => d.n} texto={(d) => `${d.n} acc.`} color={colors.primary} />
              </Card>
            </View>
            <View style={{ flexGrow: 1, flexBasis: 320 }}>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '900', marginBottom: 6 }}>🧩 ACCIONES POR MÓDULO</Text>
                <Barras filas={modulos} valor={(m) => m.n} texto={(m) => String(m.n)} color="#8B5CF6" />
              </Card>
            </View>
          </View>

          <Card>
            <Text style={{ color: colors.text, fontWeight: '900', marginBottom: 6 }}>👥 USUARIOS EN EL PERÍODO ({datos.usuarios.length})</Text>
            <ScrollView horizontal>
              <View style={{ minWidth: 620 }}>
                <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 4 }}>
                  {['Usuario', 'Sesiones', 'Tiempo', 'Acciones', 'Última actividad', 'Estado'].map((h, i) => (
                    <Text key={h} style={{ width: i === 0 ? 200 : 84, color: colors.muted, fontSize: 10, fontWeight: '800' }}>{h.toUpperCase()}</Text>
                  ))}
                </View>
                {datos.usuarios.map((u) => {
                  const conectado = datos.conectados.some((c) => c.user_id === u.user_id);
                  return (
                    <TouchableOpacity key={u.user_id} onPress={() => abrir(u)} style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text numberOfLines={1} style={{ width: 200, color: colors.text, fontSize: 12, fontWeight: '700' }}>{u.nombre}{u.rol ? <Text style={{ color: colors.muted, fontWeight: '400' }}> · {u.rol}</Text> : null}</Text>
                      <Text style={{ width: 84, color: colors.text, fontSize: 12 }}>{u.sesiones}</Text>
                      <Text style={{ width: 84, color: colors.text, fontSize: 12 }}>{fmtDuracion(u.minutos)}</Text>
                      <Text style={{ width: 84, color: colors.text, fontSize: 12 }}>{u.acciones}</Text>
                      <Text style={{ width: 84, color: colors.text, fontSize: 11 }}>{hora(u.ultima)}</Text>
                      <Text style={{ width: 84, color: conectado ? colors.success : colors.muted, fontSize: 11, fontWeight: '800' }}>{conectado ? '● Conectado' : 'Desconectado'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </Card>
        </>
      ) : null}

      {/* Detalle de un usuario */}
      <Modal visible={!!sel} transparent animationType="fade" onRequestClose={() => setSel(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ maxHeight: '90%', backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ flex: 1, color: colors.text, fontWeight: '900', fontSize: 16 }}>👤 {sel?.nombre}</Text>
              <TouchableOpacity onPress={() => setSel(null)} style={{ padding: 6 }}><Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>✕</Text></TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>{rango.texto} · {sel?.sesiones ?? 0} sesión(es) · {fmtDuracion(sel?.minutos ?? 0)} · {sel?.acciones ?? 0} acción(es)</Text>
            {errorDetalle ? <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠️ {errorDetalle}</Text> : null}
            {!detalle && !errorDetalle ? <Loading /> : null}
            {detalle ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '900', marginTop: 4 }}>🖥️ Sesiones</Text>
                {detalle.sesiones.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Sin sesiones registradas en el período (el tiempo se mide desde el 09/11/2026).</Text> : null}
                {detalle.sesiones.map((s, i) => (
                  <Text key={i} style={{ color: colors.text, fontSize: 12, paddingVertical: 2 }}>
                    {hora(s.inicio)} → {hora(s.ultimo_latido)} · {fmtDuracion(minutosEntre(s.inicio, s.ultimo_latido))} · {etiquetaDispositivo(s.dispositivo)}{s.navegador ? ` (${s.navegador})` : ''}{s.pantalla ? ` · última pantalla: ${s.pantalla}` : ''}
                  </Text>
                ))}
                <Text style={{ color: colors.text, fontWeight: '900', marginTop: spacing.sm }}>🧩 Acciones por módulo</Text>
                {accionesPorModulo(detalle.acciones_por_tabla).map((m) => (
                  <Text key={m.modulo} style={{ color: colors.text, fontSize: 12 }}>• {m.modulo}: {m.n}</Text>
                ))}
                <Text style={{ color: colors.text, fontWeight: '900', marginTop: spacing.sm }}>🕑 Últimas acciones</Text>
                {detalle.ultimas.map((a, i) => (
                  <Text key={i} style={{ color: colors.muted, fontSize: 11 }}>{hora(a.at)} · {a.action} · {a.table_name}{a.row_label ? ` · ${a.row_label}` : ''}</Text>
                ))}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default UsuariosActividad;
