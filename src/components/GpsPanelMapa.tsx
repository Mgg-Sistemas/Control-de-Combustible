// 📡 PANEL GPS DENTRO DEL 🗺️ MAPA DE LA MAQUINARIA (Detektor, 12-nov-2026).
//   · Solo aparece con el permiso «GPS».
//   · Lee la lista de vehículos vinculados UNA vez (al abrir el panel).
//   · «📡 Actualizar» hace UNA consulta al puente `gps-detektor` (para todas las marcadas a la vez):
//     sus detenciones de las últimas 36 h → la ÚLTIMA de cada una es su ubicación («detenida aquí
//     desde…» o «en movimiento: su última parada fue…»). Nada se guarda ni se actualiza solo.
//   · Lo consultado va al mapa como la CAPA 📡, sin recargarlo: los pines de siempre no se tocan.
// Vincular placas con máquinas y ver la actividad diaria: Más → «GPS de los vehículos».
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import type { GpsPinMapa } from './VenezuelaMap';
import { leerDetenciones, ultimaUbicacion, lineasUbicacion, ubicacionVieja, haceCuanto, nombreVehiculo, leerResumenDiario, lecturaDelDia, fechaDetektor, esDelVehiculo, type UbicacionGps } from '../lib/gps';
import { listarVehiculosGps, consultarDetektor, type VehiculoGps } from '../lib/gpsDb';

type Consulta = { u: UbicacionGps | null; cuando: number; error: string | null; actividadTexto?: string | null };

export function GpsPanelMapa({ onPuntos, onFoco }: { onPuntos: (p: GpsPinMapa[]) => void; onFoco: (id: string) => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [vehiculos, setVehiculos] = useState<VehiculoGps[] | null>(null);
  const [faltaSql, setFaltaSql] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consultas, setConsultas] = useState<Record<string, Consulta>>({});
  const [pidiendo, setPidiendo] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [ahora, setAhora] = useState(Date.now());

  useEffect(() => {
    if (!abierto || vehiculos) return;
    let vivo = true;
    void listarVehiculosGps().then((r) => { if (!vivo) return; setVehiculos(r.vehiculos); setFaltaSql(r.faltaSql); setError(r.error); });
    return () => { vivo = false; };
  }, [abierto, vehiculos]);
  // Solo reescribe «hace X min»: NO consulta nada.
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);

  // Lo consultado → la capa 📡 del mapa (con la hora de la CONSULTA: no cambia sola cada minuto).
  const puntos = useMemo<GpsPinMapa[]>(() => (vehiculos ?? []).flatMap((v) => {
    const c = consultas[v.id];
    if (!c?.u) return [];
    return [{
      id: v.id, nombre: nombreVehiculo(v), lat: c.u.lat, lng: c.u.lng, viejo: ubicacionVieja(c.u, c.cuando), enMarcha: !c.u.detenida, url: null,
      lineas: [...(v.equipo?.empresa ? [`🏢 ${v.equipo.empresa}`] : []), ...lineasUbicacion(c.u, c.cuando), `GPS: ${v.placaAlias}`],
    }];
  }), [vehiculos, consultas]);
  useEffect(() => { onPuntos(puntos); }, [puntos, onPuntos]);

  const lista = vehiculos ?? [];
  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? lista.filter((v) => [v.placaAlias, v.equipo?.code, v.equipo?.plate, v.equipo?.empresa, v.equipo?.clasificacion].some((x) => String(x ?? '').toLowerCase().includes(q))) : lista;
  }, [lista, query]);

  /** 📡 UNA consulta al puente para todas las pedidas. */
  const actualizar = async (pedidos: VehiculoGps[]) => {
    if (!pedidos.length) { toast.info('Marca al menos una máquina.'); return; }
    setPidiendo(true);
    const r = await consultarDetektor({ accion: 'ubicacion', placas: pedidos.map((v) => v.placaAlias) });
    const cuando = Date.now();
    setPidiendo(false);
    setAhora(cuando);
    if (r.error) { toast.error(r.error); return; }
    const dets = leerDetenciones(r.filas);
    const acts = leerResumenDiario(r.resumen ?? []);
    const hoyISO = fechaDetektor(cuando).slice(0, 10);
    setConsultas((c) => {
      const n = { ...c };
      for (const v of pedidos) {
        const u = ultimaUbicacion(dets, v.placaAlias, cuando);
        const suyasAct = acts.filter((a) => esDelVehiculo(a, v.placaAlias));
        const ultAct = suyasAct.length ? suyasAct[suyasAct.length - 1] : null;
        const lec = ultAct ? lecturaDelDia(ultAct, hoyISO) : null;
        const kmTxt = ultAct?.km != null ? ` · ${ultAct.km.toLocaleString('es-VE', { maximumFractionDigits: 1 })} km` : '';
        const actividadTexto = lec ? `${lec.icono} ${lec.texto} (${ultAct!.fecha.split('-').reverse().join('/')})${kmTxt}` : null;
        n[v.id] = {
          u,
          cuando,
          actividadTexto,
          error: u ? null : (r.aviso || 'Sin coordenadas reportadas en las últimas 36 h por el servicio de ubicación de Detektor.'),
        };
      }
      return n;
    });
    onFoco(pedidos.length === 1 ? pedidos[0].id : '*');
    const sin = pedidos.filter((v) => !ultimaUbicacion(dets, v.placaAlias, cuando)).length;
    if (sin) toast.warn(r.aviso ? `${pedidos.length - sin} de ${pedidos.length} con coordenadas en mapa · ${r.aviso}` : `${pedidos.length - sin} de ${pedidos.length} con ubicación en mapa.`);
    else toast.success(pedidos.length === 1 ? 'Ubicación GPS actualizada.' : `${pedidos.length} máquinas actualizadas por GPS.`);
  };

  const pill = (on: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface });

  return (
    <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: '#7C3AED', backgroundColor: colors.surface }}>
      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '900', flex: 1, flexShrink: 1 }}>{abierto ? '▾' : '▸'} 📡 GPS de las máquinas (Detektor){vehiculos ? ` · ${lista.length}` : ''}</Text>
        {puntos.length ? <Text style={{ color: '#7C3AED', fontWeight: '900' }}>{puntos.length} en el mapa</Text> : null}
      </TouchableOpacity>
      {abierto ? (
        <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            La ubicación sale de Detektor SOLO cuando tocas 📡 y se pinta con el ícono 📡: 🟣 detenida (dónde y desde cuándo) · 🟢 en movimiento (su última parada o posición) · gris: más de 6 h sin noticias. No se guarda y no se actualiza sola.
          </Text>
          {faltaSql ? <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12 }}>⚠️ Falta crear la tabla del GPS en la base.</Text> : null}
          {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>⚠️ {error}</Text> : null}
          {!vehiculos ? <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text> : null}
          {vehiculos && !lista.length && !faltaSql ? <Text style={{ color: colors.muted, fontSize: 12 }}>Ninguna máquina tiene GPS vinculado todavía. Se vinculan en Más → «GPS de los vehículos».</Text> : null}
          {lista.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <TouchableOpacity disabled={pidiendo} onPress={() => actualizar(lista)} style={pill(true)}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 13 }}>{pidiendo ? '⏳ Preguntando a Detektor…' : `📡 Actualizar todas (${lista.length})`}</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={pidiendo || !marcados.size} onPress={() => actualizar(lista.filter((v) => marcados.has(v.id)))} style={[pill(false), { opacity: marcados.size ? 1 : 0.5 }]}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>📡 Actualizar marcadas{marcados.size ? ` (${marcados.size})` : ''}</Text>
              </TouchableOpacity>
              {puntos.length ? <TouchableOpacity onPress={() => onFoco('*')} style={pill(false)}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>🗺️ Ver todas en el mapa</Text></TouchableOpacity> : null}
            </View>
          ) : null}
          {lista.length > 0 ? <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar: código, placa, empresa…" placeholderTextColor={colors.muted} autoCorrect={false}
            style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text }} /> : null}
          {filtrados.map((v) => {
            const c = consultas[v.id];
            const on = marcados.has(v.id);
            return (
              <View key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => setMarcados((p) => { const n = new Set(p); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; })}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{on ? '☑️' : '⬜'} {nombreVehiculo(v)}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{[v.equipo?.empresa, v.equipo?.clasificacion, `GPS ${v.placaAlias}`].filter(Boolean).join(' · ')}</Text>
                  {c ? (c.u
                    ? <Text style={{ color: ubicacionVieja(c.u, ahora) ? colors.muted : colors.text, fontSize: 11 }}>
                        {c.u.detenida ? `⏸️ detenida ${haceCuanto(c.u.desdeMs, ahora).replace('hace ', 'desde hace ')}` : `🚚 en movimiento${c.u.velocidad && c.u.velocidad > 1 ? ` (${Math.round(c.u.velocidad)} km/h)` : ''} · última señal ${haceCuanto(c.u.hastaMs, ahora)}`}
                        {c.u.motorEncendido ? ' · 🟢 motor encendido' : ' · ⚫ motor apagado'}
                        {c.u.lugar ? ` · ${c.u.lugar}` : ''}
                      </Text>
                    : (
                      <View style={{ marginTop: 2 }}>
                        {c.actividadTexto ? <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>📊 {c.actividadTexto}</Text> : null}
                        <Text style={{ color: colors.warning, fontSize: 11 }}>ℹ️ {c.error}</Text>
                      </View>
                    )) : null}
                </TouchableOpacity>
                {c?.u ? <TouchableOpacity onPress={() => onFoco(v.id)} style={pill(false)}><Text style={{ fontSize: 13 }}>🗺️</Text></TouchableOpacity> : null}
                <TouchableOpacity disabled={pidiendo} onPress={() => actualizar([v])} style={pill(false)}><Text style={{ fontSize: 13 }}>📡</Text></TouchableOpacity>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export default GpsPanelMapa;
