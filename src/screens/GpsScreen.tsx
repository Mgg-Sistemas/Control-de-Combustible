// 📡 GPS DE LOS VEHÍCULOS (iTrackSafeX) — 10-nov-2026.
// Ver la ubicación de uno, varios o todos los vehículos SOLO cuando se toca «Actualizar».
//   · La lista de enlaces se lee UNA vez al abrir (tabla gps_enlaces, permiso «GPS»).
//   · Las posiciones se piden DIRECTO a iTrackSafeX desde este teléfono/PC, de 5 en 5:
//     Supabase no recibe ni guarda ninguna (cero escrituras, cero tráfico por consulta).
//   · Nada se actualiza solo: no hay temporizador que consulte (el de 1 minuto solo
//     reescribe «hace X min» en pantalla, sin pedir nada a nadie).
// La lógica (leer enlaces, entender la respuesta, sugerir el vehículo): lib/gps.ts.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Linking } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { levelMeets } from '../lib/permissions';
import { GpsMap, type PuntoGps } from '../components/GpsMap';
import {
  leerEnlaces, consultarPosicion, enTandas, haceCuanto, frescura, diasParaVencer, sugerirEquipo, nombreVehiculo, urlDeEnlace,
  GPS_TANDA, GPS_AVISO_DIAS, type ResultadoGps, type EquipoCatalogo,
} from '../lib/gps';
import { listarEnlacesGps, catalogoParaGps, guardarEnlacesGps, vincularEnlaceGps, borrarEnlaceGps, type EnlaceGps, type EnlaceNuevo } from '../lib/gpsDb';

type Consulta = ResultadoGps & { cuando: number };
type Propuesta = EnlaceNuevo & { valido: boolean; mensaje: string | null; renuevaA: string | null };

const fechaCorta = (ms: number) => new Date(ms).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function GpsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { session, moduleLevel } = useAuth();
  const uid = session?.user?.id ?? null;
  const nivel = moduleLevel('gps');
  const puedeVer = nivel !== 'none';
  const puedeEditar = levelMeets(nivel, 'escritura');

  const [cargando, setCargando] = useState(true);
  const [enlaces, setEnlaces] = useState<EnlaceGps[]>([]);
  const [faltaSql, setFaltaSql] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [consultas, setConsultas] = useState<Record<string, Consulta>>({});
  const [pidiendo, setPidiendo] = useState<Set<string>>(new Set());
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  // Agregar / renovar enlaces
  const [agregar, setAgregar] = useState(false);
  const [texto, setTexto] = useState('');
  const [revisando, setRevisando] = useState(false);
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [catalogo, setCatalogo] = useState<EquipoCatalogo[] | null>(null);
  /** Elegir vehículo: para un enlace ya guardado (id) o para una propuesta (índice). */
  const [eligiendo, setEligiendo] = useState<{ tipo: 'enlace'; id: string } | { tipo: 'propuesta'; i: number } | null>(null);
  const [buscaEquipo, setBuscaEquipo] = useState('');

  // Solo reescribe «hace X min»: NO consulta nada.
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!puedeVer) { setCargando(false); return; }
    let vivo = true;
    (async () => {
      setCargando(true);
      const r = await listarEnlacesGps();
      if (!vivo) return;
      setEnlaces(r.enlaces); setFaltaSql(r.faltaSql); setError(r.error); setCargando(false);
    })();
    return () => { vivo = false; };
  }, [puedeVer, recarga]);

  const cargarCatalogo = useCallback(async () => {
    if (catalogo) return catalogo;
    try { const c = await catalogoParaGps(); setCatalogo(c); return c; }
    catch (e: any) { toast.error(`No se pudo leer el catálogo: ${e?.message ?? e}`); return [] as EquipoCatalogo[]; }
  }, [catalogo, toast]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return enlaces;
    return enlaces.filter((e) => [e.nombre, e.deviceId, e.equipo?.code, e.equipo?.plate].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [enlaces, query]);

  /** 📡 Pide la posición de estos enlaces, de 5 en 5. Lo único que sale a internet. */
  const actualizar = async (lista: EnlaceGps[]) => {
    if (!lista.length) { toast.info('Marca al menos un vehículo.'); return; }
    setPidiendo((p) => new Set([...p, ...lista.map((e) => e.id)]));
    let bien = 0;
    await enTandas(lista, GPS_TANDA, async (e) => {
      const r = await consultarPosicion(e.authcode);
      if (r.ok) bien++;
      setConsultas((c) => ({ ...c, [e.id]: { ...r, cuando: Date.now() } }));
      setPidiendo((p) => { const n = new Set(p); n.delete(e.id); return n; });
      return r;
    });
    setAhora(Date.now());
    if (lista.length === 1) setSeleccion(lista[0].id);
    if (bien < lista.length) toast.warn(`${bien} de ${lista.length} con ubicación. Revisa los que dicen por qué no.`);
    else toast.success(lista.length === 1 ? 'Ubicación actualizada.' : `${bien} vehículos actualizados.`);
  };

  const puntos = useMemo<PuntoGps[]>(() => enlaces.flatMap((e) => {
    const c = consultas[e.id];
    if (!c || !c.ok) return [];
    const fr = frescura(c.reporte, ahora);
    return [{
      id: e.id, nombre: nombreVehiculo(e), lat: c.lat, lng: c.lng, viejo: fr === 'viejo', enMarcha: c.enMarcha, rumbo: c.rumbo,
      url: e.url || urlDeEnlace(e.authcode, e.serverid),
      lineas: [
        `Último reporte: ${haceCuanto(c.reporte, ahora)}${fr === 'viejo' ? ' (fuera de línea)' : ''}`,
        c.enMarcha ? `🟢 En marcha · ${Math.round(c.velocidad)} km/h` : '⏸️ Detenido',
        ...(c.estadoTexto ? [c.estadoTexto] : []),
        `Consultado ${haceCuanto(c.cuando, ahora)}`,
      ],
    }];
  }), [enlaces, consultas, ahora]);

  // ── Agregar / renovar ──
  const revisarTexto = async () => {
    const leidos = leerEnlaces(texto);
    if (!leidos.length) { toast.warn('No encontré enlaces de iTrackSafeX en lo que pegaste (deben traer «authcode=»).'); return; }
    setRevisando(true);
    const cat = await cargarCatalogo();
    const res = await enTandas(leidos, GPS_TANDA, (l) => consultarPosicion(l.authcode));
    const yaUsados = new Set<string>();
    const props: Propuesta[] = leidos.map((l, i) => {
      const r = res[i];
      const deviceId = (r.ok ? r.deviceId : r.deviceId) ?? '';
      const nombre = (r.ok ? r.nombre : r.nombre) ?? l.nombre;
      const existente = enlaces.find((e) => deviceId && e.deviceId === deviceId) ?? null;
      const sug = existente?.machineryId ? null : sugerirEquipo(nombre, cat.filter((c) => !yaUsados.has(c.id)));
      const machineryId = existente?.machineryId ?? sug?.id ?? null;
      if (machineryId) yaUsados.add(machineryId);
      const valido = !!deviceId && (r.ok || r.motivo === 'sin_posicion');
      return {
        nombre, deviceId, authcode: l.authcode, serverid: l.serverid, url: l.url,
        vence: r.vence ? new Date(r.vence).toISOString() : null, machineryId,
        valido, mensaje: valido ? null : (r.ok ? 'No trae el número del equipo.' : r.mensaje),
        renuevaA: existente ? nombreVehiculo(existente) : null,
      };
    });
    setPropuestas(props);
    setRevisando(false);
  };

  const guardarPropuestas = async () => {
    const buenas = propuestas.filter((p) => p.valido);
    if (!buenas.length) { toast.warn('No hay enlaces vigentes para guardar.'); return; }
    setGuardando(true);
    const r = await guardarEnlacesGps(buenas.map(({ valido: _v, mensaje: _m, renuevaA: _r, ...n }) => n), uid);
    setGuardando(false);
    if (r.error) { toast.error(`No se guardó: ${r.error}`); return; }
    toast.success(`${r.guardados} enlace(s) guardado(s).`);
    setTexto(''); setPropuestas([]); setAgregar(false); setConsultas({}); setRecarga((n) => n + 1);
  };

  const elegirEquipo = async (machineryId: string | null) => {
    const e = eligiendo;
    setEligiendo(null); setBuscaEquipo('');
    if (!e) return;
    if (e.tipo === 'propuesta') { setPropuestas((p) => p.map((x, i) => (i === e.i ? { ...x, machineryId } : x))); return; }
    const r = await vincularEnlaceGps(e.id, machineryId, uid);
    if (r.error) { toast.error(r.error); return; }
    toast.success(machineryId ? 'Vinculado al vehículo.' : 'Quedó sin vincular.');
    setRecarga((n) => n + 1);
  };

  const quitar = async (e: EnlaceGps) => {
    const ok = await confirm({ title: 'Quitar el enlace', message: `¿Quitar el GPS de «${nombreVehiculo(e)}» del sistema? En la app de iTrackSafeX el enlace sigue igual (para cancelarlo, hazlo allá).`, confirmText: 'Quitar', cancelText: 'Cancelar' });
    if (!ok) return;
    const r = await borrarEnlaceGps(e.id);
    if (r.error) { toast.error(r.error); return; }
    toast.success('Enlace quitado.');
    setRecarga((n) => n + 1);
  };

  const pill = (on: boolean, color?: string) => ({
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1,
    borderColor: on ? (color ?? colors.primary) : colors.border, backgroundColor: on ? (color ?? colors.primary) : colors.surface,
  });
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 15 } as const;
  const nombreEquipo = (id: string | null) => {
    if (!id) return 'Sin vincular';
    const c = catalogo?.find((x) => x.id === id);
    return c ? `${c.code ?? '—'}${c.plate ? ` · ${c.plate}` : ''}` : 'Vehículo del catálogo';
  };

  if (!puedeVer) {
    return <Screen><Card><Text style={{ color: colors.text, fontWeight: '800' }}>📡 GPS de los vehículos</Text><Text style={{ color: colors.muted, marginTop: 4 }}>No tienes el permiso «GPS». Pídeselo a un administrador en 👥 Usuarios.</Text></Card></Screen>;
  }
  if (cargando) return <Screen><Loading /></Screen>;

  const avisosVence = enlaces.map((e) => {
    const c = consultas[e.id];
    const v = (c?.vence ?? null) || (e.vence ? Date.parse(e.vence) : null);
    return { e, dias: diasParaVencer(v, ahora) };
  }).filter((x) => x.dias !== null && x.dias < GPS_AVISO_DIAS);

  const listaEquipos = (catalogo ?? []).filter((c) => {
    const q = buscaEquipo.trim().toLowerCase();
    return !q || [c.code, c.plate, c.marca, c.modelo, c.clasificacion].some((v) => String(v ?? '').toLowerCase().includes(q));
  }).slice(0, 60);

  return (
    <Screen>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>📡 GPS de los vehículos</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>
        La ubicación sale de iTrackSafeX y se pide SOLO cuando tocas «Actualizar». No se guarda en el sistema y no se actualiza sola.
      </Text>

      {faltaSql ? (
        <Card><Text style={{ color: colors.warning, fontWeight: '800' }}>⚠️ Falta crear la tabla del GPS en la base (gps_enlaces).</Text><Text style={{ color: colors.muted, fontSize: 12 }}>Hasta correr el SQL no se pueden guardar enlaces.</Text></Card>
      ) : null}
      {error ? <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠️ {error}</Text> : null}

      {avisosVence.length ? (
        <Card>
          <Text style={{ color: colors.warning, fontWeight: '900' }}>⏰ Enlaces por vencer o vencidos</Text>
          {avisosVence.map(({ e, dias }) => (
            <Text key={e.id} style={{ color: colors.text, fontSize: 12 }}>
              • {nombreVehiculo(e)}: {dias! < 0 ? 'VENCIDO' : dias === 0 ? 'vence hoy' : `vence en ${dias} día(s)`}. En la app: Compartir → «1Y» → pégalo en «➕ Agregar o renovar».
            </Text>
          ))}
        </Card>
      ) : null}

      {/* Botones principales */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        <TouchableOpacity disabled={!enlaces.length || pidiendo.size > 0} onPress={() => actualizar(enlaces.filter((e) => marcados.has(e.id)))} style={[pill(true), { opacity: marcados.size ? 1 : 0.5 }]}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>📡 Actualizar marcados{marcados.size ? ` (${marcados.size})` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={!enlaces.length || pidiendo.size > 0} onPress={() => actualizar(enlaces)} style={pill(false)}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>📡 Actualizar todos ({enlaces.length})</Text>
        </TouchableOpacity>
        {enlaces.length ? (
          <TouchableOpacity onPress={() => setMarcados(marcados.size === filtrados.length ? new Set() : new Set(filtrados.map((e) => e.id)))} style={pill(false)}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{marcados.size === filtrados.length && filtrados.length ? '⬜ Desmarcar todos' : '☑️ Marcar todos'}</Text>
          </TouchableOpacity>
        ) : null}
        {puedeEditar && !faltaSql ? (
          <TouchableOpacity onPress={() => { setAgregar((v) => !v); void cargarCatalogo(); }} style={pill(agregar)}>
            <Text style={{ color: agregar ? colors.primaryContrast : colors.brandText, fontWeight: '800' }}>➕ Agregar o renovar enlaces</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {pidiendo.size ? <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Preguntando a iTrackSafeX… faltan {pidiendo.size}.</Text> : null}

      {/* Agregar / renovar */}
      {agregar ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900' }}>➕ Pega uno o varios enlaces</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
            En la app iTrackSafeX: abre el vehículo → Compartir → elige «1Y» (1 año) → Compartir, y pega aquí lo que copia (puedes pegar varios juntos).
            Si el vehículo ya tenía enlace, el nuevo lo REEMPLAZA (así se renueva).
          </Text>
          <TextInput value={texto} onChangeText={setTexto} multiline placeholder="Click to view … track, share duration 1Y: http://itracksafe.com/#/tracking?authcode=…" placeholderTextColor={colors.muted} style={[input, { minHeight: 90, textAlignVertical: 'top' }]} autoCorrect={false} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            <TouchableOpacity disabled={revisando || !texto.trim()} onPress={revisarTexto} style={[pill(true), { opacity: texto.trim() ? 1 : 0.5 }]}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{revisando ? 'Revisando…' : '🔍 Revisar enlaces'}</Text>
            </TouchableOpacity>
          </View>
          {propuestas.length ? (
            <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
              {propuestas.map((p, i) => (
                <View key={p.authcode} style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: p.valido ? colors.border : colors.danger, backgroundColor: colors.surface }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>{p.valido ? '✅' : '❌'} {p.nombre || 'Sin nombre'}{p.deviceId ? ` · equipo ${p.deviceId}` : ''}</Text>
                  {p.valido ? (
                    <>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{p.vence ? `Vale hasta el ${fechaCorta(Date.parse(p.vence))}` : 'Sin fecha de vencimiento'}{p.renuevaA ? ` · renueva el de ${p.renuevaA}` : ''}</Text>
                      <TouchableOpacity onPress={() => { setEligiendo({ tipo: 'propuesta', i }); void cargarCatalogo(); }} style={{ marginTop: 4 }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>🚛 Vehículo del catálogo: {nombreEquipo(p.machineryId)} (cambiar)</Text>
                      </TouchableOpacity>
                    </>
                  ) : <Text style={{ color: colors.danger, fontSize: 12 }}>{p.mensaje} No se guarda.</Text>}
                </View>
              ))}
              <TouchableOpacity disabled={guardando} onPress={guardarPropuestas} style={[pill(true, colors.success), { alignSelf: 'flex-start' }]}>
                <Text style={{ color: '#fff', fontWeight: '900' }}>{guardando ? 'Guardando…' : `💾 Guardar ${propuestas.filter((p) => p.valido).length} enlace(s)`}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* El mapa */}
      <GpsMap puntos={puntos} seleccion={seleccion} />
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, marginBottom: spacing.sm }}>
        🟢 en marcha · 🔵 detenido · ⚪ gris: la última posición tiene más de 1 hora (equipo fuera de línea).
      </Text>

      {/* La lista */}
      {enlaces.length > 6 ? <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar vehículo: nombre, código, placa…" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.xs }]} autoCorrect={false} /> : null}
      {!enlaces.length && !faltaSql ? (
        <Card><Text style={{ color: colors.muted }}>Todavía no hay vehículos con GPS. {puedeEditar ? 'Toca «➕ Agregar o renovar enlaces».' : 'Pídele a quien tenga el permiso GPS completo que los cargue.'}</Text></Card>
      ) : null}
      <View style={{ gap: spacing.xs }}>
        {filtrados.map((e) => {
          const c = consultas[e.id];
          const on = marcados.has(e.id);
          const fr = c?.ok ? frescura(c.reporte, ahora) : null;
          return (
            <View key={e.id} style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: colors.surface }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <TouchableOpacity onPress={() => setMarcados((p) => { const n = new Set(p); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '900' }}>{on ? '☑️' : '⬜'} {nombreVehiculo(e)}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>GPS: {e.nombre || '—'}{e.deviceId ? ` · ${e.deviceId}` : ''}{!e.machineryId ? ' · sin vincular al catálogo' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={pidiendo.has(e.id)} onPress={() => actualizar([e])} style={pill(false)}>
                  <Text style={{ color: colors.brandText, fontWeight: '900' }}>{pidiendo.has(e.id) ? '⏳' : '📡'}</Text>
                </TouchableOpacity>
              </View>
              {c ? (
                c.ok ? (
                  <TouchableOpacity onPress={() => setSeleccion(e.id)}>
                    <Text style={{ color: fr === 'viejo' ? colors.muted : colors.text, fontSize: 12, marginTop: 2 }}>
                      {fr === 'en_linea' ? '🟢 En línea' : fr === 'reciente' ? '🟡 Hace poco' : '⚪ Fuera de línea'} · último reporte {haceCuanto(c.reporte, ahora)} · {c.enMarcha ? `en marcha ${Math.round(c.velocidad)} km/h` : 'detenido'}
                    </Text>
                    {c.estadoTexto ? <Text style={{ color: colors.muted, fontSize: 11 }}>{c.estadoTexto}</Text> : null}
                    <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>🗺️ Ver en el mapa</Text>
                  </TouchableOpacity>
                ) : <Text style={{ color: colors.danger, fontSize: 12, marginTop: 2 }}>⚠️ {c.mensaje}</Text>
              ) : <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Toca 📡 para ver dónde está.</Text>}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: 4 }}>
                <TouchableOpacity onPress={() => Linking.openURL(e.url || urlDeEnlace(e.authcode, e.serverid))}><Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>↗️ Abrir en iTrackSafeX</Text></TouchableOpacity>
                {puedeEditar ? (
                  <>
                    <TouchableOpacity onPress={() => { setEligiendo({ tipo: 'enlace', id: e.id }); void cargarCatalogo(); }}><Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>🚛 {e.machineryId ? 'Cambiar vehículo' : 'Vincular al catálogo'}</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => quitar(e)}><Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>🗑️ Quitar</Text></TouchableOpacity>
                  </>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {/* Elegir el vehículo del catálogo */}
      {eligiendo ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setEligiendo(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.md, zIndex: 9999 }}>
            <View style={{ backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md, maxWidth: 560, width: '100%', maxHeight: '90%', alignSelf: 'center', gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>🚛 ¿Qué vehículo del catálogo es?</Text>
              <TextInput value={buscaEquipo} onChangeText={setBuscaEquipo} placeholder="🔎 Código, placa, marca, modelo…" placeholderTextColor={colors.muted} style={input} autoCorrect={false} />
              <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: 6 }}>
                {catalogo === null ? <Loading /> : null}
                <TouchableOpacity onPress={() => elegirEquipo(null)} style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontWeight: '800' }}>— Sin vincular (se ve con el nombre del GPS)</Text>
                </TouchableOpacity>
                {listaEquipos.map((c) => (
                  <TouchableOpacity key={c.id} onPress={() => elegirEquipo(c.id)} style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{c.code ?? '—'}{c.plate ? ` · ${c.plate}` : ''}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{[c.marca, c.modelo, c.clasificacion].filter(Boolean).join(' · ')}</Text>
                  </TouchableOpacity>
                ))}
                {catalogo && listaEquipos.length === 60 ? <Text style={{ color: colors.muted, fontSize: 11 }}>Hay más: escribe para buscar.</Text> : null}
              </ScrollView>
              <TouchableOpacity onPress={() => setEligiendo(null)} style={[pill(false), { alignSelf: 'flex-start' }]}><Text style={{ color: colors.muted, fontWeight: '800' }}>Cancelar</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}
    </Screen>
  );
}
