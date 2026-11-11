// 📡 PANEL GPS DENTRO DEL 🗺️ MAPA DE LA MAQUINARIA (10-nov-2026, a pedido: «la idea es que
// se vea en el mismo mapa de la maquinaria que ya está»).
//   · Solo aparece con el permiso «GPS».
//   · Lee la lista de enlaces UNA vez (gps_enlaces). Las posiciones se piden DIRECTO a
//     iTrackSafeX desde este teléfono/PC, de 5 en 5, y SOLO al tocar «Actualizar»:
//     Supabase no recibe ni guarda ninguna.
//   · Lo consultado se manda al mapa como una CAPA aparte (📡), sin recargarlo: los pines
//     de siempre (la ubicación marcada en el sistema) no se tocan.
// Cargar, renovar o vincular enlaces: Más → «GPS de los vehículos».
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import type { GpsPinMapa } from './VenezuelaMap';
import { consultarPosicion, enTandas, haceCuanto, frescura, diasParaVencer, nombreVehiculo, urlParaAbrir, GPS_TANDA, GPS_AVISO_DIAS, type ResultadoGps } from '../lib/gps';
import { listarEnlacesGps, type EnlaceGps } from '../lib/gpsDb';

type Consulta = ResultadoGps & { cuando: number };

/** «6:26 p. m.» si es de hoy; «09/11 6:26 p. m.» si no. */
function horaDe(ms: number | null): string {
  if (!ms) return 'sin dato';
  const d = new Date(ms);
  const hora = d.toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hora : `${d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

export function GpsPanelMapa({ onPuntos, onFoco }: { onPuntos: (p: GpsPinMapa[]) => void; onFoco: (id: string) => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [enlaces, setEnlaces] = useState<EnlaceGps[] | null>(null);
  const [faltaSql, setFaltaSql] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consultas, setConsultas] = useState<Record<string, Consulta>>({});
  const [pidiendo, setPidiendo] = useState<Set<string>>(new Set());
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [ahora, setAhora] = useState(Date.now());

  // La lista de enlaces: una sola lectura, al abrir el panel por primera vez.
  useEffect(() => {
    if (!abierto || enlaces) return;
    let vivo = true;
    void listarEnlacesGps().then((r) => { if (!vivo) return; setEnlaces(r.enlaces); setFaltaSql(r.faltaSql); setError(r.error); });
    return () => { vivo = false; };
  }, [abierto, enlaces]);
  // Solo reescribe «hace X min»: NO consulta nada.
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);

  // Lo consultado → la capa 📡 del mapa.
  const puntos = useMemo<GpsPinMapa[]>(() => (enlaces ?? []).flatMap((e) => {
    const c = consultas[e.id];
    if (!c || !c.ok) return [];
    // Con la hora de la CONSULTA (no el reloj): la capa no cambia sola cada minuto.
    const fr = frescura(c.reporte, c.cuando);
    return [{
      id: e.id, nombre: nombreVehiculo(e), lat: c.lat, lng: c.lng, viejo: fr === 'viejo', enMarcha: c.enMarcha, url: urlParaAbrir(e),
      lineas: [
        ...(e.equipo?.empresa ? [`🏢 ${e.equipo.empresa}`] : []),
        `Último reporte: ${horaDe(c.reporte)}${fr === 'viejo' ? ' (fuera de línea)' : ''}`,
        c.enMarcha ? `🟢 En marcha · ${Math.round(c.velocidad)} km/h` : '⏸️ Detenido',
        ...(c.estadoTexto ? [c.estadoTexto] : []),
      ],
    }];
  }), [enlaces, consultas]);
  useEffect(() => { onPuntos(puntos); }, [puntos, onPuntos]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    const l = enlaces ?? [];
    return q ? l.filter((e) => [e.nombre, e.deviceId, e.equipo?.code, e.equipo?.plate, e.equipo?.empresa, e.equipo?.clasificacion].some((v) => String(v ?? '').toLowerCase().includes(q))) : l;
  }, [enlaces, query]);

  /** 📡 Lo único que sale a internet: directo a iTrackSafeX, de 5 en 5. */
  const actualizar = async (lista: EnlaceGps[]) => {
    if (!lista.length) { toast.info('Marca al menos una máquina.'); return; }
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
    onFoco(lista.length === 1 ? lista[0].id : '*');
    if (bien < lista.length) toast.warn(`${bien} de ${lista.length} con ubicación. Revisa en la lista por qué no.`);
    else toast.success(lista.length === 1 ? 'Ubicación GPS actualizada.' : `${bien} máquinas actualizadas por GPS.`);
  };

  const pill = (on: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface });
  const lista = enlaces ?? [];
  const porVencer = lista.filter((e) => { const c = consultas[e.id]; const d = diasParaVencer((c?.vence ?? null) || (e.vence ? Date.parse(e.vence) : null), ahora); return d !== null && d < GPS_AVISO_DIAS; });

  return (
    <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: '#7C3AED', backgroundColor: colors.surface }}>
      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '900', flex: 1 }}>{abierto ? '▾' : '▸'} 📡 GPS de las máquinas (iTrackSafeX){enlaces ? ` · ${lista.length}` : ''}</Text>
        {puntos.length ? <Text style={{ color: '#7C3AED', fontWeight: '900' }}>{puntos.length} en el mapa</Text> : null}
      </TouchableOpacity>
      {abierto ? (
        <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            La posición sale de iTrackSafeX SOLO cuando tocas 📡 y se pinta en el mapa con el ícono 📡 (🟢 en marcha · 🟣 detenido · gris: más de 1 hora sin reportar). No se guarda y no se actualiza sola.
          </Text>
          {faltaSql ? <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12 }}>⚠️ Falta crear la tabla del GPS en la base.</Text> : null}
          {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>⚠️ {error}</Text> : null}
          {!enlaces ? <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text> : null}
          {enlaces && !lista.length && !faltaSql ? <Text style={{ color: colors.muted, fontSize: 12 }}>Ninguna máquina tiene GPS todavía. Se cargan en Más → «GPS de los vehículos».</Text> : null}
          {porVencer.length ? <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700' }}>⏰ Enlaces por vencer: {porVencer.map((e) => nombreVehiculo(e)).join(', ')}. Renuévalos en Más → «GPS de los vehículos».</Text> : null}
          {lista.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <TouchableOpacity disabled={pidiendo.size > 0} onPress={() => actualizar(lista)} style={pill(true)}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 13 }}>📡 Actualizar todas ({lista.length})</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={pidiendo.size > 0 || !marcados.size} onPress={() => actualizar(lista.filter((e) => marcados.has(e.id)))} style={[pill(false), { opacity: marcados.size ? 1 : 0.5 }]}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>📡 Actualizar marcadas{marcados.size ? ` (${marcados.size})` : ''}</Text>
              </TouchableOpacity>
              {puntos.length ? (
                <TouchableOpacity onPress={() => onFoco('*')} style={pill(false)}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>🗺️ Ver todas en el mapa</Text></TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {pidiendo.size ? <Text style={{ color: colors.muted, fontSize: 12 }}>Preguntando a iTrackSafeX… faltan {pidiendo.size}.</Text> : null}
          {lista.length > 6 ? <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar: código, placa, empresa…" placeholderTextColor={colors.muted} autoCorrect={false}
            style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text }} /> : null}
          {filtrados.map((e) => {
            const c = consultas[e.id];
            const on = marcados.has(e.id);
            const fr = c?.ok ? frescura(c.reporte, ahora) : null;
            return (
              <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => setMarcados((p) => { const n = new Set(p); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{on ? '☑️' : '⬜'} {nombreVehiculo(e)}</Text>
                  {e.equipo?.empresa || e.equipo?.clasificacion ? <Text style={{ color: colors.muted, fontSize: 11 }}>{[e.equipo?.empresa, e.equipo?.clasificacion].filter(Boolean).join(' · ')}</Text> : null}
                  {c ? (c.ok
                    ? <Text style={{ color: fr === 'viejo' ? colors.muted : colors.text, fontSize: 11 }}>{fr === 'en_linea' ? '🟢' : fr === 'reciente' ? '🟡' : '⚪'} {haceCuanto(c.reporte, ahora)} · {c.enMarcha ? `${Math.round(c.velocidad)} km/h` : 'detenida'}{c.estadoTexto ? ` · ${c.estadoTexto}` : ''}</Text>
                    : <Text style={{ color: colors.danger, fontSize: 11 }}>⚠️ {c.mensaje}</Text>) : null}
                </TouchableOpacity>
                {c?.ok ? <TouchableOpacity onPress={() => onFoco(e.id)} style={pill(false)}><Text style={{ fontSize: 13 }}>🗺️</Text></TouchableOpacity> : null}
                <TouchableOpacity disabled={pidiendo.has(e.id)} onPress={() => actualizar([e])} style={pill(false)}>
                  <Text style={{ fontSize: 13 }}>{pidiendo.has(e.id) ? '⏳' : '📡'}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export default GpsPanelMapa;
