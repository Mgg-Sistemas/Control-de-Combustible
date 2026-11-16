// 🪨 MATERIALES DE VIAJE (16-nov-2026) — catálogo organizable por permiso `full`.
//
// Vive dentro del panel de administración de «Registro de viajes (camiones)».
// Permite crear, renombrar, activar/desactivar y organizar el orden (▲ / ▼)
// de los materiales (Material triturado, Escombro, etc.) que salen en el
// registro del listero, en el ticket y en Cargar a mano.
//
// ⚠️ Cero pérdida de datos: desactivar un material solo lo oculta de los
//    selectores nuevos; cada viaje ya registrado congela `material_nombre`.
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import {
  actualizarMaterialViaje,
  crearMaterialViaje,
  reordenarMaterialesViaje,
  type MaterialViaje,
} from '../lib/camionViajes';

type Props = {
  materiales: MaterialViaje[];
  faltaSql: boolean;
  canFull: boolean;
  onCambio: () => void;
};

export function ViajesMaterialesBox({ materiales, faltaSql, canFull, onCambio }: Props) {
  const { colors } = useTheme();
  const toast = useToast();

  const [abierto, setAbierto] = useState(false);
  const [nuevo, setNuevo] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [guardando, setGuardando] = useState(false);

  if (!canFull) return null;

  const activos = materiales.filter((m) => m.active).length;
  const input = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
  } as const;

  const crear = async () => {
    const clean = nuevo.trim();
    if (!clean) { toast.error('Escribe el nombre del material.'); return; }
    if (materiales.some((m) => m.nombre.toLowerCase() === clean.toLowerCase())) {
      toast.error('Ya existe un material con ese nombre.');
      return;
    }
    setGuardando(true);
    const maxOrden = materiales.reduce((mx, m) => Math.max(mx, m.orden), 0);
    const res = await crearMaterialViaje(clean, maxOrden + 1);
    setGuardando(false);
    if (res.error) { toast.error(res.error); return; }
    setNuevo('');
    toast.success('Material agregado.');
    onCambio();
  };

  const renombrar = async (m: MaterialViaje) => {
    const clean = editNombre.trim();
    if (!clean) { toast.error('El nombre no puede quedar vacío.'); return; }
    setGuardando(true);
    const res = await actualizarMaterialViaje(m.id, { nombre: clean });
    setGuardando(false);
    if (res.error) { toast.error(res.error); return; }
    setEditId(null);
    toast.success('Material actualizado.');
    onCambio();
  };

  const toggleActivo = async (m: MaterialViaje) => {
    setGuardando(true);
    const res = await actualizarMaterialViaje(m.id, { active: !m.active });
    setGuardando(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success(m.active ? `${m.nombre} desactivado.` : `${m.nombre} activado.`);
    onCambio();
  };

  const mover = async (idx: number, dir: -1 | 1) => {
    const dest = idx + dir;
    if (dest < 0 || dest >= materiales.length) return;
    const ids = materiales.map((m) => m.id);
    const tmp = ids[idx];
    ids[idx] = ids[dest];
    ids[dest] = tmp;
    setGuardando(true);
    const res = await reordenarMaterialesViaje(ids);
    setGuardando(false);
    if (res.error) { toast.error(res.error); return; }
    onCambio();
  };

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <TouchableOpacity
        onPress={() => setAbierto((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
            🪨 Materiales de viaje ({activos} activos)
          </Text>
          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
            Organiza el orden y la lista que sale en el registro y en el ticket (triturado, escombro…).
          </Text>
        </View>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>{abierto ? '▲ Ocultar' : '▼ Abrir'}</Text>
      </TouchableOpacity>

      {abierto ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {faltaSql ? (
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>
              ⚠️ Falta crear la tabla «viajes_materiales» en Supabase. Corre el SQL aditivo para activar esta lista.
            </Text>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                <TextInput
                  value={nuevo}
                  onChangeText={setNuevo}
                  placeholder="Nuevo material (ej. Granzón, Arena, Piedra…)"
                  placeholderTextColor={colors.muted}
                  style={[input, { flex: 1 }]}
                />
                <TouchableOpacity
                  onPress={crear}
                  disabled={guardando}
                  style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, opacity: guardando ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12.5 }}>+ Agregar</Text>
                </TouchableOpacity>
              </View>

              {materiales.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>Todavía no hay materiales cargados.</Text>
              ) : materiales.map((m, i) => (
                <View
                  key={m.id}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: spacing.sm,
                    backgroundColor: m.active ? colors.surfaceAlt : colors.surface,
                    opacity: m.active ? 1 : 0.65,
                    gap: spacing.xs,
                  }}
                >
                  {editId === m.id ? (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                      <TextInput
                        value={editNombre}
                        onChangeText={setEditNombre}
                        style={[input, { flex: 1 }]}
                      />
                      <TouchableOpacity
                        onPress={() => renombrar(m)}
                        disabled={guardando}
                        style={{ backgroundColor: colors.success, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md }}
                      >
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Guardar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setEditId(null)}
                        style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                        {i + 1}. 🪨 {m.nombre} {!m.active ? '(Inactivo)' : ''}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        <TouchableOpacity
                          onPress={() => mover(i, -1)}
                          disabled={guardando || i === 0}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, opacity: i === 0 ? 0.35 : 1 }}
                        >
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11.5 }}>▲</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => mover(i, 1)}
                          disabled={guardando || i === materiales.length - 1}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, opacity: i === materiales.length - 1 ? 0.35 : 1 }}
                        >
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11.5 }}>▼</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => { setEditId(m.id); setEditNombre(m.nombre); }}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
                        >
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11.5 }}>✏️ Renombrar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => toggleActivo(m)}
                          disabled={guardando}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: m.active ? colors.danger : colors.success }}
                        >
                          <Text style={{ color: m.active ? colors.danger : colors.success, fontWeight: '700', fontSize: 11.5 }}>
                            {m.active ? 'Desactivar' : 'Activar'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              ))}
            </>
          )}
        </View>
      ) : null}
    </Card>
  );
}
