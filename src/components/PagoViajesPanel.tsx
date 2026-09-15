// PAGO DE VIAJES · configuración (15-sep-2026).
//
// Se abre desde la tarjeta «💰 Pago de viajes» de Viajes de camiones. Dos cosas:
//   1) TARIFAS por zona (Este / Oeste): general desde una fecha, o blindada a un rango
//      de fechas que manda sobre la general. Nunca se borran: se anulan.
//   2) CAMIONES: qué camión entra al pago por viaje, desde qué fecha. Es historial:
//      cambiarlo agrega una fila, no reescribe lo anterior. No toca jornadas.
//
// Las reglas (qué tarifa rige, qué modo rige) viven en src/lib/pagoViajes.ts.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen, SectionTitle, Card } from './ui';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { isVolteoVolqueta } from '../lib/equipos';
import { cmpText, onlyDecimal } from '../lib/text';
import {
  filaModoEn,
  indexarModos,
  jornadaDeInstante,
  tarifaViajeEn,
  validarTarifa,
  ModoPago,
  ModoPagoFila,
  TarifaViaje,
  ZonaPagoViaje,
} from '../lib/pagoViajes';
import {
  anularTarifaViaje,
  asignarModoPago,
  cargarMaquinasActivas,
  cargarModosPago,
  cargarTarifasViaje,
  crearTarifaViaje,
  CamionCatalogo,
} from '../lib/pagoViajesDb';

type Props = {
  visible: boolean;
  onClose: () => void;
  canEdit: boolean;
  usuarioId: string | null;
  /** Se llama después de guardar algo, para que el resumen de pago recalcule. */
  onChanged: () => void;
};

const ZONAS: { key: ZonaPagoViaje; label: string }[] = [
  { key: 'este', label: 'Este' },
  { key: 'oeste', label: 'Oeste' },
];

const dmy = (iso?: string | null) => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};
const usd = (n: unknown) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PagoViajesPanel({ visible, onClose, canEdit, usuarioId, onChanged }: Props) {
  const { colors } = useTheme();
  const hoy = jornadaDeInstante(new Date().toISOString());

  const [pestana, setPestana] = useState<'tarifas' | 'camiones'>('tarifas');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tarifas, setTarifas] = useState<TarifaViaje[]>([]);
  const [modos, setModos] = useState<ModoPagoFila[]>([]);
  const [maquinas, setMaquinas] = useState<CamionCatalogo[]>([]);

  // Formulario de tarifa
  const [zona, setZona] = useState<ZonaPagoViaje>('este');
  const [precio, setPrecio] = useState('');
  const [desde, setDesde] = useState(hoy);
  const [conHasta, setConHasta] = useState(false);
  const [hasta, setHasta] = useState(hoy);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [verAnuladas, setVerAnuladas] = useState(false);

  // Camiones
  const [fechaModo, setFechaModo] = useState(hoy);
  const [filtro, setFiltro] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [t, m, maq] = await Promise.all([cargarTarifasViaje(), cargarModosPago(), cargarMaquinasActivas()]);
      setTarifas(t);
      setModos(m);
      setMaquinas(maq);
    } catch (e: any) {
      setError(`No se pudo leer el pago de viajes (${e?.message ?? 'revisa la conexión'}).`);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (visible) { setAviso(null); cargar(); }
  }, [visible, cargar]);

  const idxModos = useMemo(() => indexarModos(modos), [modos]);

  const camiones = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return maquinas
      .filter((m) => isVolteoVolqueta(m.code))
      .filter((m) => !q || `${m.code} ${m.plate ?? ''} ${m.serial ?? ''} ${m.company}`.toLowerCase().includes(q))
      .sort((a, b) => cmpText(a.company, b.company) || cmpText(a.code, b.code));
  }, [maquinas, filtro]);

  const porEmpresa = useMemo(() => {
    const m = new Map<string, CamionCatalogo[]>();
    camiones.forEach((c) => { const a = m.get(c.company) ?? []; a.push(c); m.set(c.company, a); });
    return Array.from(m.entries());
  }, [camiones]);

  const tarifasOrdenadas = useMemo(
    () => tarifas
      .filter((t) => verAnuladas || !t.anulada_at)
      .slice()
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))),
    [tarifas, verAnuladas],
  );

  const guardarTarifa = async () => {
    setAviso(null);
    const motivo = validarTarifa({ zona, precio, desde, hasta: conHasta ? hasta : null });
    if (motivo) { setAviso(`❌ ${motivo}`); return; }
    setGuardando(true);
    const { error: err } = await crearTarifaViaje({
      zona,
      precio: Number(precio.replace(',', '.')),
      desde,
      hasta: conHasta ? hasta : null,
      nota,
    });
    setGuardando(false);
    if (err) { setAviso(`❌ ${err}`); return; }
    setAviso(conHasta
      ? `✅ Tarifa ${zona === 'este' ? 'Este' : 'Oeste'} ${usd(precio.replace(',', '.'))} blindada del ${dmy(desde)} al ${dmy(hasta)}. Fuera de ese rango no cambia nada.`
      : `✅ Tarifa ${zona === 'este' ? 'Este' : 'Oeste'} ${usd(precio.replace(',', '.'))} desde el ${dmy(desde)} en adelante. Los días anteriores conservan su tarifa.`);
    setPrecio(''); setNota('');
    await cargar();
    onChanged();
  };

  const confirmarAnular = async (t: TarifaViaje) => {
    const { error: err } = await anularTarifaViaje(t.id, motivoAnular, usuarioId);
    if (err) { setAviso(`❌ ${err}`); return; }
    setAnulando(null); setMotivoAnular('');
    setAviso('✅ Tarifa anulada. Los días que cubría vuelven a tomar la tarifa que corresponda.');
    await cargar();
    onChanged();
  };

  const cambiarModo = async (ids: string[], modo: ModoPago, etiqueta: string) => {
    setAviso(null);
    if (!ids.length) return;
    const { error: err, guardadas } = await asignarModoPago(ids, modo, fechaModo);
    if (err) { setAviso(`❌ ${err}${guardadas ? ` (se guardaron ${guardadas})` : ''}`); await cargar(); return; }
    setAviso(`✅ ${etiqueta}: ${modo === 'viaje' ? 'entra al pago por viaje' : 'queda fuera del pago por viaje'} desde el ${dmy(fechaModo)}. Lo anterior a esa fecha no cambia.`);
    await cargar();
    onChanged();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const chip = (activo: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: activo ? colors.brand : colors.border, backgroundColor: activo ? colors.brand : colors.surface });
  const chipTxt = (activo: boolean) => ({ color: activo ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: spacing.xs, marginBottom: spacing.xs }}>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>← Volver</Text>
        </TouchableOpacity>
        <SectionTitle>🚛 Pago de viajes</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Los camiones que entran al pago por viaje se le pagan a su empresa por cada viaje, con la tarifa de la
          zona del CDT. Esto no toca las jornadas. Todo cambio rige desde la fecha que elijas y no toca lo anterior.
        </Text>

        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
          <TouchableOpacity onPress={() => setPestana('tarifas')} style={chip(pestana === 'tarifas')}>
            <Text style={chipTxt(pestana === 'tarifas')}>💲 Tarifas</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPestana('camiones')} style={chip(pestana === 'camiones')}>
            <Text style={chipTxt(pestana === 'camiones')}>🚛 Camiones</Text>
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={{ borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠️ {error}</Text>
          </View>
        ) : null}
        {aviso ? (
          <TouchableOpacity onPress={() => setAviso(null)} style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: aviso.startsWith('❌') ? colors.danger : colors.success, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{aviso}</Text>
          </TouchableOpacity>
        ) : null}
        {!canEdit ? (
          <Text style={{ color: colors.warning, fontSize: 12, marginBottom: spacing.sm }}>Solo lectura: para cambiar tarifas o camiones hace falta permiso completo en Viajes de camiones.</Text>
        ) : null}

        {pestana === 'tarifas' ? (
          <ScrollView style={{ flex: 1 }}>
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>Tarifa vigente hoy ({dmy(hoy)})</Text>
              {ZONAS.map((z) => {
                const t = tarifaViajeEn(tarifas, z.key, hoy);
                return (
                  <Text key={z.key} style={{ color: colors.text, fontSize: 13 }}>
                    {z.label}: <Text style={{ fontWeight: '800' }}>{t ? usd(t.precio) : 'sin tarifa'}</Text>
                    {t ? <Text style={{ color: colors.muted }}>{t.hasta ? `  · blindada ${dmy(t.desde)} → ${dmy(t.hasta)}` : `  · desde ${dmy(t.desde)}`}</Text> : null}
                  </Text>
                );
              })}
            </Card>

            {canEdit ? (
              <Card>
                <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>➕ Nueva tarifa</Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                  {ZONAS.map((z) => (
                    <TouchableOpacity key={z.key} onPress={() => setZona(z.key)} style={chip(zona === z.key)}>
                      <Text style={chipTxt(zona === z.key)}>{z.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Precio por viaje ($)</Text>
                <TextInput value={precio} onChangeText={(v) => setPrecio(onlyDecimal(v))} keyboardType="numeric" inputMode="decimal" placeholder="0,00" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Desde</Text>
                <DateField value={desde} onChange={setDesde} />
                <TouchableOpacity onPress={() => setConHasta((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm }}>
                  <Text style={{ fontSize: 16 }}>{conHasta ? '☑️' : '⬜'}</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>🔒 Blindar a un rango de fechas</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                  {conHasta
                    ? 'Rige solo del «desde» al «hasta» y manda sobre la tarifa general en esas fechas.'
                    : 'Rige desde esa fecha en adelante, hasta que pongas otra.'}
                </Text>
                {conHasta ? (
                  <View style={{ marginTop: spacing.xs }}>
                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Hasta</Text>
                    <DateField value={hasta} onChange={setHasta} />
                  </View>
                ) : null}
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
                <TextInput value={nota} onChangeText={setNota} placeholder="Motivo del cambio…" placeholderTextColor={colors.muted} style={input} />
                <TouchableOpacity disabled={guardando} onPress={guardarTarifa} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: guardando ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{guardando ? 'Guardando…' : '💾 Guardar tarifa'}</Text>
                </TouchableOpacity>
              </Card>
            ) : null}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>Historial de tarifas</Text>
              <TouchableOpacity onPress={() => setVerAnuladas((v) => !v)}>
                <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>{verAnuladas ? 'Ocultar anuladas' : 'Ver anuladas'}</Text>
              </TouchableOpacity>
            </View>
            {cargando && !tarifas.length ? <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando…</Text> : null}
            {tarifasOrdenadas.map((t) => (
              <Card key={t.id} style={t.anulada_at ? { opacity: 0.55 } : undefined}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>
                    {t.zona === 'oeste' ? 'Oeste' : 'Este'} · {usd(t.precio)}
                  </Text>
                  <Text style={{ color: t.hasta ? colors.warning : colors.muted, fontSize: 12, fontWeight: '700' }}>
                    {t.hasta ? `🔒 ${dmy(t.desde)} → ${dmy(t.hasta)}` : `desde ${dmy(t.desde)}`}
                  </Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {t.created_by_nombre ? `${t.created_by_nombre} · ` : ''}{t.created_at ? new Date(t.created_at).toLocaleString('es-VE', { timeZone: 'America/Caracas' }) : ''}
                  {t.nota ? ` · ${t.nota}` : ''}
                </Text>
                {t.anulada_at ? (
                  <Text style={{ color: colors.danger, fontSize: 11 }}>Anulada{t.anulada_motivo ? `: ${t.anulada_motivo}` : ''}</Text>
                ) : canEdit ? (
                  anulando === t.id ? (
                    <View style={{ marginTop: spacing.xs }}>
                      <TextInput value={motivoAnular} onChangeText={setMotivoAnular} placeholder="Motivo de la anulación" placeholderTextColor={colors.muted} style={input} />
                      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                        <TouchableOpacity onPress={() => { setAnulando(null); setMotivoAnular(''); }} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                          <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => confirmarAnular(t)} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger }}>
                          <Text style={{ color: '#fff', fontWeight: '800' }}>Sí, anular</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => { setAnulando(t.id); setMotivoAnular(''); }} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🚫 Anular</Text>
                    </TouchableOpacity>
                  )
                ) : null}
              </Card>
            ))}
            <View style={{ height: spacing.lg }} />
          </ScrollView>
        ) : (
          <ScrollView style={{ flex: 1 }}>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Los cambios rigen desde</Text>
              <DateField value={fechaModo} onChange={setFechaModo} />
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                Lo que ves en cada camión es lo que rige en esa fecha. Un camión sin asignar no entra al pago por viaje.
              </Text>
              <TextInput value={filtro} onChangeText={setFiltro} placeholder="🔎 Buscar camión, placa o empresa…" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.sm }} />
            </Card>
            {cargando && !maquinas.length ? <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando…</Text> : null}
            {porEmpresa.map(([empresa, lista]) => {
              const enViaje = lista.filter((c) => filaModoEn(idxModos, c.id, fechaModo)?.modo === 'viaje');
              return (
                <Card key={empresa}>
                  <Text style={{ color: colors.text, fontWeight: '900' }}>🏢 {empresa}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{enViaje.length} de {lista.length} camión(es) por viaje el {dmy(fechaModo)}</Text>
                  {canEdit ? (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                      <TouchableOpacity onPress={() => cambiarModo(lista.map((c) => c.id), 'viaje', `${lista.length} camión(es) de ${empresa}`)} style={chip(false)}>
                        <Text style={chipTxt(false)}>🚛 Todos por viaje</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => cambiarModo(lista.map((c) => c.id), 'jornada', `${lista.length} camión(es) de ${empresa}`)} style={chip(false)}>
                        <Text style={chipTxt(false)}>⛔ Quitar todos</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  {lista.map((c) => {
                    const fila = filaModoEn(idxModos, c.id, fechaModo);
                    const porViaje = fila?.modo === 'viaje';
                    return (
                      <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 }}>
                        <View style={{ flex: 1, paddingRight: spacing.sm }}>
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{c.code}{c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}</Text>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>
                            {fila ? `${porViaje ? 'Por viaje' : 'No entra'} desde ${dmy(fila.desde)}${fila.created_by_nombre ? ` · ${fila.created_by_nombre}` : ''}` : 'Sin asignar · no entra'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          disabled={!canEdit}
                          onPress={() => cambiarModo([c.id], porViaje ? 'jornada' : 'viaje', c.code)}
                          style={{ ...chip(porViaje), opacity: canEdit ? 1 : 0.6 }}
                        >
                          <Text style={chipTxt(porViaje)}>{porViaje ? '🚛 Por viaje' : '⛔ No entra'}</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </Card>
              );
            })}
            <View style={{ height: spacing.lg }} />
          </ScrollView>
        )}
      </Screen>
    </Modal>
  );
}
