// OBRAS / UBICACIONES y a qué obra está asignado cada listero (12-sep-2026).
//
// Vive dentro del panel de la jefa de «Registro de viajes (camiones)». Hace dos
// cosas que van juntas y por eso comparten tarjeta:
//   1) El CATÁLOGO de obras: crear, renombrar, desactivar y borrar.
//   2) A QUÉ OBRA está cada listero, y moverlo a otra.
//
// ⚠️ MOVER A UN LISTERO NO CAMBIA SUS VIAJES YA REGISTRADOS. Cada viaje se llevó
//    su obra puesta al grabarse (`camion_viajes.ubicacion_nombre`, una foto,
//    igual que `listero_name`). Si el reporte leyera la obra que el listero
//    tiene HOY, moverlo cambiaría sus viajes de agosto de sitio y un informe ya
//    entregado dejaría de cuadrar con el que se saque mañana del mismo rango.
//
// ⚠️ Y TIENE QUE FUNCIONAR ANTES DE QUE SE CORRA EL SQL. El código se despliega
//    y `viajes_ubicaciones.sql` se corre a mano, después. En ese hueco la tabla
//    no existe: la tarjeta lo DICE, con el nombre del archivo que hay que
//    correr, en vez de enseñar una lista vacía que se lee como «todavía no han
//    creado ninguna obra».
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { supabase } from '../lib/supabase';
import { asignarObraAListero } from '../lib/camionViajes';
import { nombreLimpio, validarNombre, type UbicacionObra } from '../lib/ubicacionesObra';

type Listero = { id: string; full_name: string; ubicacion_id: string | null };

type Props = {
  obras: UbicacionObra[];
  listeros: Listero[];
  /** true cuando la tabla todavía no existe (falta correr el .sql). */
  faltaSql: boolean;
  /** Solo con nivel `full` se puede tocar el catálogo. */
  canFull: boolean;
  onCambioObras: () => void;
  onCambioListeros: () => void;
};

export function ObrasListeros({ obras, listeros, faltaSql, canFull, onCambioObras, onCambioListeros }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();

  const [abierto, setAbierto] = useState(false);
  const [nueva, setNueva] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [guardando, setGuardando] = useState(false);
  /** A qué listero se le está eligiendo obra. Null = ninguno abierto. */
  const [moviendo, setMoviendo] = useState<string | null>(null);

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text } as const;
  const obraPorId = useMemo(() => new Map(obras.map((o) => [o.id, o])), [obras]);
  const sinObra = useMemo(() => listeros.filter((l) => !l.ubicacion_id).length, [listeros]);

  const crear = async () => {
    const motivo = validarNombre(nueva, obras);
    if (motivo) { toast.error(motivo); return; }
    setGuardando(true);
    const { error } = await supabase.from('ubicaciones_obra').insert({ nombre: nombreLimpio(nueva) });
    setGuardando(false);
    if (error) { toast.error(`No se pudo crear la obra: ${error.message}`); return; }
    setNueva('');
    toast.success('Obra creada.');
    onCambioObras();
  };

  const renombrar = async (o: UbicacionObra) => {
    const motivo = validarNombre(editNombre, obras, o.id);
    if (motivo) { toast.error(motivo); return; }
    setGuardando(true);
    const { error } = await supabase.from('ubicaciones_obra').update({ nombre: nombreLimpio(editNombre) }).eq('id', o.id);
    setGuardando(false);
    if (error) { toast.error(`No se pudo renombrar: ${error.message}`); return; }
    setEditId(null);
    // Se dice lo que NO cambia: quien renombra una obra suele temer haberle
    // movido los viajes de sitio.
    toast.success('Obra renombrada. Los viajes ya registrados conservan el nombre que tenían.');
    onCambioObras();
  };

  const alternarActiva = async (o: UbicacionObra) => {
    const { error } = await supabase.from('ubicaciones_obra').update({ active: !o.active }).eq('id', o.id);
    if (error) { toast.error(`No se pudo cambiar: ${error.message}`); return; }
    toast.success(o.active ? 'Obra desactivada: deja de ofrecerse, pero sus viajes siguen.' : 'Obra activada.');
    onCambioObras();
  };

  const borrar = async (o: UbicacionObra) => {
    const asignados = listeros.filter((l) => l.ubicacion_id === o.id).length;
    const ok = await confirm(
      `¿Borrar la obra "${o.nombre}"?\n\n` +
      `Los viajes ya registrados NO se borran y siguen diciendo que fueron en "${o.nombre}".\n` +
      (asignados ? `${asignados} listero(s) quedan sin obra asignada.\n` : '') +
      '\nSi solo quieres que deje de ofrecerse, mejor DESACTÍVALA.',
    );
    if (!ok) return;
    const { error } = await supabase.from('ubicaciones_obra').delete().eq('id', o.id);
    if (error) { toast.error(`No se pudo borrar: ${error.message}`); return; }
    toast.success('Obra borrada. Los viajes conservan su nombre.');
    onCambioObras();
    onCambioListeros();
  };

  const mover = async (l: Listero, obraId: string | null) => {
    setMoviendo(null);
    const { error, falta } = await asignarObraAListero(l.id, obraId);
    if (falta) { toast.error('Falta correr el SQL de obras en la base de datos.'); return; }
    if (error) { toast.error(`No se pudo asignar: ${error}`); return; }
    const destino = obraId ? (obraPorId.get(obraId)?.nombre ?? 'la obra') : 'sin obra';
    toast.success(`${l.full_name} → ${destino}. Sus viajes anteriores no se mueven.`);
    onCambioListeros();
  };

  if (!canFull) return null;

  return (
    <Card>
      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
          🏗️ Obras y ubicaciones{obras.length ? ` · ${obras.length}` : ''}
          {sinObra > 0 ? ` · ${sinObra} listero(s) sin obra` : ''}
        </Text>
        <Text style={{ color: colors.brandText, fontWeight: '800' }}>{abierto ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {abierto ? (
        <View style={{ marginTop: spacing.sm }}>
          {faltaSql ? (
            <View style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, padding: spacing.sm }}>
              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>Falta correr el SQL de obras</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                La tabla de obras todavía no existe en la base de datos. Hasta que se corra
                `viajes_ubicaciones.sql`, los viajes se registran igual pero SIN obra, y el
                reporte por obra sale vacío. No se pierde ningún viaje.
              </Text>
            </View>
          ) : (
            <>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
                Mover a un listero de obra NO cambia sus viajes ya registrados: cada viaje se
                guardó con la obra que tenía ese día.
              </Text>

              {/* ── CREAR ─────────────────────────────────────────────── */}
              <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                <TextInput
                  value={nueva}
                  onChangeText={setNueva}
                  placeholder="Nombre de la obra (ej. CDT Parque del Agua)"
                  placeholderTextColor={colors.muted}
                  style={{ ...input, flex: 1 }}
                />
                <TouchableOpacity
                  onPress={crear}
                  disabled={guardando || !nombreLimpio(nueva)}
                  style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, opacity: guardando || !nombreLimpio(nueva) ? 0.5 : 1 }}
                >
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>+ Crear</Text>
                </TouchableOpacity>
              </View>

              {/* ── EL CATÁLOGO ───────────────────────────────────────── */}
              {obras.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
                  Todavía no hay ninguna obra. Crea la primera arriba.
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 260, marginTop: spacing.sm }} nestedScrollEnabled>
                  {obras.map((o) => {
                    const editando = editId === o.id;
                    const cuantos = listeros.filter((l) => l.ubicacion_id === o.id).length;
                    return (
                      <View key={o.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.xs }}>
                        {editando ? (
                          <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                            <TextInput value={editNombre} onChangeText={setEditNombre} style={{ ...input, flex: 1 }} />
                            <TouchableOpacity onPress={() => renombrar(o)} disabled={guardando}>
                              <Text style={{ color: colors.success, fontWeight: '800', fontSize: 12 }}>Guardar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setEditId(null)}>
                              <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: o.active ? colors.text : colors.muted, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                                {o.nombre}{o.active ? '' : '  ·  DESACTIVADA'}
                              </Text>
                              <Text style={{ color: colors.muted, fontSize: 11 }}>{cuantos} listero(s)</Text>
                            </View>
                            <TouchableOpacity onPress={() => { setEditId(o.id); setEditNombre(o.nombre); }}>
                              <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✏️</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => alternarActiva(o)}>
                              <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>{o.active ? '🚫' : '✓'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => borrar(o)}>
                              <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              )}

              {/* ── QUIÉN ESTÁ DÓNDE ──────────────────────────────────── */}
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md }}>LISTEROS Y SU OBRA</Text>
              {listeros.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>No hay listeros con acceso al módulo.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 280, marginTop: 4 }} nestedScrollEnabled>
                  {listeros.map((l) => {
                    const o = l.ubicacion_id ? obraPorId.get(l.ubicacion_id) : undefined;
                    const eligiendo = moviendo === l.id;
                    return (
                      <View key={l.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.xs }}>
                        <TouchableOpacity onPress={() => setMoviendo(eligiendo ? null : l.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>👤 {l.full_name}</Text>
                            <Text style={{ color: o ? colors.brandText : colors.warning, fontSize: 11 }} numberOfLines={1}>
                              {o ? `🏗️ ${o.nombre}` : '⚠️ Sin obra asignada — sus viajes salen sin obra'}
                            </Text>
                          </View>
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{eligiendo ? '▲' : 'Cambiar ▼'}</Text>
                        </TouchableOpacity>
                        {eligiendo ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.xs }}>
                            {obras.filter((x) => x.active || x.id === l.ubicacion_id).map((x) => {
                              const on = l.ubicacion_id === x.id;
                              return (
                                <TouchableOpacity
                                  key={x.id}
                                  onPress={() => mover(l, x.id)}
                                  style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
                                >
                                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>🏗️ {x.nombre}</Text>
                                </TouchableOpacity>
                              );
                            })}
                            {l.ubicacion_id ? (
                              <TouchableOpacity
                                onPress={() => mover(l, null)}
                                style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
                              >
                                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Quitarle la obra</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}
        </View>
      ) : null}
    </Card>
  );
}
