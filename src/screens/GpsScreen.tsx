// 📡 GPS DE LOS VEHÍCULOS (Detektor) — 12-nov-2026.
//   1) 🔍 Buscar los vehículos de la cuenta Detektor y VINCULAR cada placa/alias con su máquina del
//      Catálogo (se propone la que tiene esa placa; una máquina, un GPS). Pide escritura.
//   2) Los vinculados: cambiar la máquina o quitar el vínculo.
//   3) 📊 Actividad diaria (resumen de Detektor por día): primer encendido, último apagado, horas
//      efectivas, horas detenida con el motor encendido (ralentí) y km. Con PDF.
// La UBICACIÓN se ve en el 🗺️ Mapa de la maquinaria (panel «📡 GPS de las máquinas»).
// Todo lo de Detektor pasa por el puente `gps-detektor`: aquí nunca hay usuario ni clave.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { DateField } from '../components/DateField';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { levelMeets } from '../lib/permissions';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { caracasBusinessToday } from '../lib/caracasDay';
import { vehiculosDeLaCuenta, sugerirEquipo, nombreVehiculo, normalizarPlaca, leerResumenDiario, type EquipoCatalogo, type ActividadDia } from '../lib/gps';
import { listarVehiculosGps, catalogoParaGps, vincularVehiculoGps, quitarVehiculoGps, consultarDetektor, type VehiculoGps } from '../lib/gpsDb';

const fmtH = (h: number | null) => (h == null ? '—' : `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);
const fmtKm = (k: number | null) => (k == null ? '—' : k.toLocaleString('es-VE', { maximumFractionDigits: 1 }));
const dmy = (iso: string) => { const [a, m, d] = iso.split('-'); return d && m && a ? `${d}/${m}/${a}` : iso; };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const menosDias = (iso: string, n: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };

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
  const [vehiculos, setVehiculos] = useState<VehiculoGps[]>([]);
  const [faltaSql, setFaltaSql] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [catalogo, setCatalogo] = useState<EquipoCatalogo[] | null>(null);
  const [cuenta, setCuenta] = useState<{ placa: string; alias: string }[] | null>(null);
  const [buscandoCuenta, setBuscandoCuenta] = useState(false);
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [buscaEquipo, setBuscaEquipo] = useState('');
  const hoy = caracasBusinessToday();
  const [desde, setDesde] = useState(menosDias(hoy, 6));
  const [hasta, setHasta] = useState(hoy);
  const [actividad, setActividad] = useState<ActividadDia[] | null>(null);
  const [consultando, setConsultando] = useState(false);

  useEffect(() => {
    if (!puedeVer) { setCargando(false); return; }
    let vivo = true;
    (async () => {
      setCargando(true);
      const r = await listarVehiculosGps();
      if (!vivo) return;
      setVehiculos(r.vehiculos); setFaltaSql(r.faltaSql); setError(r.error); setCargando(false);
    })();
    return () => { vivo = false; };
  }, [puedeVer, recarga]);

  const cargarCatalogo = useCallback(async () => {
    if (catalogo) return catalogo;
    try { const c = await catalogoParaGps(); setCatalogo(c); return c; }
    catch (e: any) { toast.error(`No se pudo leer el catálogo: ${e?.message ?? e}`); return [] as EquipoCatalogo[]; }
  }, [catalogo, toast]);

  const vinculadoDe = (placaAlias: string) => vehiculos.find((v) => !!placaAlias && normalizarPlaca(v.placaAlias) === normalizarPlaca(placaAlias)) ?? null;

  const buscarCuenta = async () => {
    setBuscandoCuenta(true);
    void cargarCatalogo();
    const r = await consultarDetektor({ accion: 'vehiculos' });
    setBuscandoCuenta(false);
    if (r.error) { toast.error(r.error); return; }
    const vs = vehiculosDeLaCuenta(r.filas);
    setCuenta(vs);
    if (!vs.length) toast.info('Detektor no devolvió vehículos de ayer ni de hoy para esta cuenta.');
  };

  const vincular = async (placaAlias: string, machineryId: string) => {
    const r = await vincularVehiculoGps(placaAlias, machineryId, uid);
    if (r.error) { toast.error(r.error); return; }
    toast.success(`GPS ${placaAlias} vinculado.`);
    setRecarga((n) => n + 1);
  };

  const quitar = async (v: VehiculoGps) => {
    const ok = await confirm({ title: 'Quitar el GPS', message: `¿Quitar el GPS ${v.placaAlias} de «${nombreVehiculo(v)}»? En Detektor no cambia nada; aquí deja de verse.`, confirmText: 'Quitar', cancelText: 'Cancelar' });
    if (!ok) return;
    const r = await quitarVehiculoGps(v.id);
    if (r.error) { toast.error(r.error); return; }
    toast.success('GPS quitado.');
    setRecarga((n) => n + 1);
  };

  const consultarActividad = async () => {
    if (!vehiculos.length) { toast.info('Primero vincula al menos un GPS.'); return; }
    if (hasta < desde) { toast.warn('La fecha «hasta» es anterior a «desde».'); return; }
    setConsultando(true);
    const r = await consultarDetektor({ accion: 'resumen', placas: vehiculos.map((v) => v.placaAlias), desde, hasta });
    setConsultando(false);
    if (r.error) { toast.error(r.error); return; }
    setActividad(leerResumenDiario(r.filas));
  };

  const nombreDePlaca = (placa: string, alias: string) => {
    const v = vinculadoDe(placa) ?? vinculadoDe(alias);
    return v ? nombreVehiculo(v) : `${placa}${alias ? ` (${alias})` : ''}`;
  };

  const pdfActividad = async () => {
    if (!actividad?.length) return;
    const filas = actividad.map((a) => `<tr><td>${esc(dmy(a.fecha))}</td><td>${esc(nombreDePlaca(a.placa, a.alias))}</td><td>${esc(a.primerEncendido ?? '—')}</td><td>${esc(a.ultimoApagado ?? '—')}</td><td>${fmtH(a.horasEfectivas)}</td><td>${fmtH(a.horasDetenidoEncendido)}</td><td>${fmtH(a.horasEncendidoApagado)}</td><td>${fmtKm(a.km)}</td></tr>`).join('');
    const body = `<table class="gpst"><thead><tr><th>Fecha</th><th>Máquina</th><th>Primer encendido</th><th>Último apagado</th><th>Horas efectivas</th><th>Detenida encendida</th><th>Encendido → apagado</th><th>Km</th></tr></thead><tbody>${filas}</tbody></table>`;
    const html = pdfDocument({ title: 'Actividad diaria por GPS', subtitle: `Del ${dmy(desde)} al ${dmy(hasta)} · fuente: Detektor`, body, extraCss: '.gpst{width:100%;border-collapse:collapse;font-size:9.5pt}.gpst th{background:#1E3A5F;color:#fff;padding:6px;text-align:left}.gpst td{border-bottom:1px solid #E2E8F0;padding:5px}', marcaTexto: false });
    try { await exportPdf(html, `Actividad GPS ${desde} a ${hasta}`); } catch (e: any) { toast.error(e?.message || 'No se pudo generar el PDF.'); }
  };

  const pill = (on: boolean, color?: string) => ({ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? (color ?? colors.primary) : colors.border, backgroundColor: on ? (color ?? colors.primary) : colors.surface });
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 15 } as const;

  const listaEquipos = useMemo(() => (catalogo ?? []).filter((c) => {
    const q = buscaEquipo.trim().toLowerCase();
    return !q || [c.code, c.plate, c.marca, c.modelo, c.clasificacion, c.empresa].some((v) => String(v ?? '').toLowerCase().includes(q));
  }).slice(0, 60), [catalogo, buscaEquipo]);

  if (!puedeVer) {
    return <Screen><Card><Text style={{ color: colors.text, fontWeight: '800' }}>📡 GPS de los vehículos</Text><Text style={{ color: colors.muted, marginTop: 4 }}>No tienes el permiso «GPS». Pídeselo a un administrador en 👥 Usuarios.</Text></Card></Screen>;
  }
  if (cargando) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>📡 GPS de los vehículos (Detektor)</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>
        La ubicación se ve en el 🗺️ Mapa de la maquinaria (panel «📡 GPS de las máquinas»). Aquí se vinculan las placas de Detektor con las máquinas del Catálogo y se ve la actividad diaria. Todo se consulta solo cuando lo pides.
      </Text>
      {faltaSql ? <Card><Text style={{ color: colors.warning, fontWeight: '800' }}>⚠️ Falta crear la tabla del GPS en la base (gps_vehiculos).</Text></Card> : null}
      {error ? <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠️ {error}</Text> : null}

      {puedeEditar && !faltaSql ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900' }}>🔍 Vehículos de la cuenta Detektor</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Trae las placas que Detektor tiene en la cuenta (las que reportaron ayer u hoy) y propone su máquina del Catálogo por la placa.</Text>
          <TouchableOpacity disabled={buscandoCuenta} onPress={buscarCuenta} style={[pill(true), { alignSelf: 'flex-start' }]}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{buscandoCuenta ? 'Preguntando a Detektor…' : '🔍 Buscar vehículos en Detektor'}</Text>
          </TouchableOpacity>
          {cuenta ? cuenta.map((c) => {
            const ya = vinculadoDe(c.placa) ?? vinculadoDe(c.alias);
            const sug = !ya && catalogo ? sugerirEquipo(c, catalogo) : null;
            const placaAlias = c.placa || c.alias;
            return (
              <View key={placaAlias} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>🛰️ {c.placa}{c.alias && c.alias !== c.placa ? ` · ${c.alias}` : ''}</Text>
                {ya ? <Text style={{ color: '#15803D', fontSize: 12 }}>✅ Vinculado a {nombreVehiculo(ya)}</Text> : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                    {sug ? (
                      <TouchableOpacity onPress={() => vincular(placaAlias, sug.id)} style={pill(true, '#15803D')}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>🔗 Vincular a {sug.code}{sug.plate ? ` · ${sug.plate}` : ''}</Text>
                      </TouchableOpacity>
                    ) : <Text style={{ color: colors.muted, fontSize: 12 }}>No hay una máquina con esa placa en el Catálogo.</Text>}
                    <TouchableOpacity onPress={() => { setEligiendo(placaAlias); void cargarCatalogo(); }} style={pill(false)}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>🚛 Elegir otra máquina…</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }) : null}
        </Card>
      ) : null}

      <Card>
        <Text style={{ color: colors.text, fontWeight: '900' }}>🔗 GPS vinculados ({vehiculos.length})</Text>
        {!vehiculos.length && !faltaSql ? <Text style={{ color: colors.muted, fontSize: 12 }}>Todavía no hay ninguno. {puedeEditar ? 'Usa «🔍 Buscar vehículos en Detektor».' : ''}</Text> : null}
        {vehiculos.map((v) => (
          <View key={v.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>{nombreVehiculo(v)}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{[`GPS ${v.placaAlias}`, v.equipo?.empresa, v.equipo?.clasificacion].filter(Boolean).join(' · ')}</Text>
            {puedeEditar ? (
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: 2 }}>
                <TouchableOpacity onPress={() => { setEligiendo(v.placaAlias); void cargarCatalogo(); }}><Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>🚛 Cambiar máquina</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => quitar(v)}><Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>🗑️ Quitar</Text></TouchableOpacity>
              </View>
            ) : null}
          </View>
        ))}
      </Card>

      <Card>
        <Text style={{ color: colors.text, fontWeight: '900' }}>📊 Actividad diaria (Detektor)</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Por día y máquina: primer encendido, último apagado, horas efectivas (en movimiento), horas detenida con el motor encendido y km. Hasta 31 días.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <View style={{ flexGrow: 1, flexBasis: 150 }}><Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>DESDE</Text><DateField value={desde} onChange={setDesde} maxISO={hoy} /></View>
          <View style={{ flexGrow: 1, flexBasis: 150 }}><Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>HASTA</Text><DateField value={hasta} onChange={setHasta} maxISO={hoy} /></View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
          <TouchableOpacity disabled={consultando || !vehiculos.length} onPress={consultarActividad} style={[pill(true), { opacity: vehiculos.length ? 1 : 0.5 }]}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{consultando ? 'Preguntando a Detektor…' : '📊 Consultar'}</Text>
          </TouchableOpacity>
          {actividad?.length ? <TouchableOpacity onPress={pdfActividad} style={pill(false)}><Text style={{ color: colors.text, fontWeight: '800' }}>📄 PDF</Text></TouchableOpacity> : null}
        </View>
        {actividad ? (actividad.length ? (
          <ScrollView horizontal style={{ marginTop: spacing.sm }}>
            <View>
              <View style={{ flexDirection: 'row', backgroundColor: '#1E3A5F' }}>
                {['Fecha', 'Máquina', 'Encendió', 'Apagó', 'Efectivas', 'Det. encendida', 'Km'].map((h, i) => <Text key={h} style={{ color: '#fff', fontWeight: '800', fontSize: 12, padding: 6, width: i === 1 ? 190 : 92 }}>{h}</Text>)}
              </View>
              {actividad.map((a) => (
                <View key={`${a.placa}-${a.fecha}`} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  {[dmy(a.fecha), nombreDePlaca(a.placa, a.alias), a.primerEncendido ?? '—', a.ultimoApagado ?? '—', fmtH(a.horasEfectivas), fmtH(a.horasDetenidoEncendido), fmtKm(a.km)].map((t, i) => (
                    <Text key={i} style={{ color: colors.text, fontSize: 12, padding: 6, width: i === 1 ? 190 : 92 }}>{t}</Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        ) : <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Detektor no devolvió actividad en esas fechas.</Text>) : null}
      </Card>

      {eligiendo ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setEligiendo(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.md, zIndex: 9999 }}>
            <View style={{ backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md, maxWidth: 560, width: '100%', maxHeight: '90%', alignSelf: 'center', gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>🚛 ¿Qué máquina del Catálogo es el GPS {eligiendo}?</Text>
              <TextInput value={buscaEquipo} onChangeText={setBuscaEquipo} placeholder="🔎 Código, placa, marca, modelo, empresa…" placeholderTextColor={colors.muted} style={input} autoCorrect={false} />
              <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: 6 }}>
                {catalogo === null ? <Loading /> : null}
                {listaEquipos.map((c) => (
                  <TouchableOpacity key={c.id} onPress={async () => { const p = eligiendo; setEligiendo(null); setBuscaEquipo(''); if (p) await vincular(p, c.id); }}
                    style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{c.code ?? '—'}{c.plate ? ` · ${c.plate}` : ''}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{[c.empresa, c.clasificacion, c.marca, c.modelo].filter(Boolean).join(' · ')}</Text>
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
