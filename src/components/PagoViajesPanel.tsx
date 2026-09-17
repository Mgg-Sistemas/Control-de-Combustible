// PAGO DE VIAJES · configuración (15-sep-2026).
//
// Se abre desde la tarjeta «💰 Pago de viajes» de Viajes de camiones. Dos cosas:
//   1) TARIFAS (PagoViajesTarifas): para todos, una empresa, un grupo de camiones o un
//      camión; por zona o ambas; desde una fecha o blindadas a un rango. Nunca se borran.
//   2) CAMIONES: qué camión entra al pago por viaje, desde qué fecha. Es historial:
//      cambiarlo agrega una fila, no reescribe lo anterior. No toca jornadas.
//
// Las reglas (qué tarifa rige, qué modo rige) viven en src/lib/pagoViajes.ts.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen, SectionTitle, Card } from './ui';
import { DateField } from './DateField';
import { PagoViajesTarifas } from './PagoViajesTarifas';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { esCamionDeViajes } from '../lib/equipos';
import { cmpText } from '../lib/text';
import { filaModoEn, indexarModos, jornadaDeInstante, ModoPago, ModoPagoFila, TarifaViaje } from '../lib/pagoViajes';
import { asignarModoPago, cargarMaquinasCatalogo, cargarModosPago, cargarTarifasViaje, CamionCatalogo } from '../lib/pagoViajesDb';
import { cargarAjustesListaViajes } from '../lib/viajesListaCamionesDb';

type Props = {
  visible: boolean;
  onClose: () => void;
  canEdit: boolean;
  usuarioId: string | null;
  /** Se llama después de guardar algo, para que el resumen de pago recalcule. */
  onChanged: () => void;
};

const dmy = (iso?: string | null) => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

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
  // Máquinas que el admin PUSO a mano en Viajes: también se pueden meter al pago.
  const [puestasEnViajes, setPuestasEnViajes] = useState<Set<string>>(new Set());

  // Camiones
  const [fechaModo, setFechaModo] = useState(hoy);
  const [filtro, setFiltro] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [t, m, maq, aj] = await Promise.all([cargarTarifasViaje(), cargarModosPago(), cargarMaquinasCatalogo(), cargarAjustesListaViajes()]);
      if (!aj.error) setPuestasEnViajes(new Set(aj.filas.filter((f) => f.visible).map((f) => f.machinery_id)));
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
      // Camiones del pago (incluye chutos), y las máquinas dadas de baja solo si ya
      // tienen historial: si no, no habría manera de sacarlas del pago.
      .filter((m) => (esCamionDeViajes(m.code) || puestasEnViajes.has(m.id)) && (m.activa || (idxModos.get(m.id)?.length ?? 0) > 0))
      .filter((m) => !q || `${m.code} ${m.plate ?? ''} ${m.serial ?? ''} ${m.company}`.toLowerCase().includes(q))
      .sort((a, b) => cmpText(a.company, b.company) || cmpText(a.code, b.code));
  }, [maquinas, filtro, idxModos, puestasEnViajes]);

  const porEmpresa = useMemo(() => {
    const m = new Map<string, CamionCatalogo[]>();
    camiones.forEach((c) => { const a = m.get(c.company) ?? []; a.push(c); m.set(c.company, a); });
    return Array.from(m.entries());
  }, [camiones]);

  const tarifasCambiaron = useCallback(async () => {
    await cargar();
    onChanged();
  }, [cargar, onChanged]);

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
          Los camiones que entran al pago por viaje se le pagan a su empresa por cada viaje, con la tarifa que les toque:
          la de todos según la zona del CDT, o una especial de su empresa, de un grupo o del camión. Esto no toca las
          jornadas. Todo cambio rige desde la fecha que elijas y no toca lo anterior.
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
        {!canEdit ? (
          <Text style={{ color: colors.warning, fontSize: 12, marginBottom: spacing.sm }}>Solo lectura: para cambiar tarifas o camiones hace falta permiso completo en Viajes de camiones.</Text>
        ) : null}

        {pestana === 'tarifas' ? (
          <PagoViajesTarifas
            tarifas={tarifas}
            maquinas={maquinas}
            puestasEnViajes={puestasEnViajes}
            cargando={cargando}
            canEdit={canEdit}
            usuarioId={usuarioId}
            hoy={hoy}
            onChanged={tarifasCambiaron}
          />
        ) : (
          <ScrollView style={{ flex: 1 }}>
            {aviso ? (
              <TouchableOpacity onPress={() => setAviso(null)} style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: aviso.startsWith('❌') ? colors.danger : colors.success, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{aviso}</Text>
              </TouchableOpacity>
            ) : null}
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
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{c.code}{c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}{c.activa ? '' : ' · 🚫 de baja'}</Text>
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
