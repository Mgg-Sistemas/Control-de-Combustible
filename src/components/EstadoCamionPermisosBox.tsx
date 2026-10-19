// 🚦 QUIÉN PUEDE CAMBIAR EL ESTADO DEL CAMIÓN (19-oct-2026).
//
// La caja del FULL en «Viajes de camiones → ⚙️ Configuración»: enciende o apaga,
// listero por listero, el permiso de poner 🟢 Operativo / 🔧 Averiado /
// 🟡 Parado desde su teléfono. La BASE exige full en viajes para otorgar o
// quitar (viajes_estado_permisos): esconder esta caja no es la única defensa.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { Toggle } from './CubicajeTab';
import { listarPermisosEstado, otorgarPermisoEstado, quitarPermisoEstado } from '../lib/estadoCamionListero';

export function EstadoCamionPermisosBox({ listeros, uid, nombre }: {
  listeros: { id: string; full_name: string }[];
  uid: string | null;
  nombre: string | null;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [faltaSql, setFaltaSql] = useState(false);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const r = await listarPermisosEstado();
    setIds(r.ids);
    setFaltaSql(r.missing);
  }, []);
  useEffect(() => { if (abierto) cargar(); }, [abierto, cargar]);

  const alternar = async (l: { id: string; full_name: string }) => {
    if (busy) return;
    setBusy(true);
    const tiene = ids.has(l.id);
    const r = tiene ? await quitarPermisoEstado(l.id) : await otorgarPermisoEstado(l.id, { id: uid, nombre });
    setBusy(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success(tiene ? `🚦 ${l.full_name} ya NO puede cambiar estados.` : `🚦 ${l.full_name} ya puede cambiar el estado de los camiones.`);
    cargar();
  };

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>🚦 Quién puede cambiar el estado del camión</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            {abierto ? `${ids.size} listero(s) con el permiso` : 'Permiso por listero para poner 🟢 Operativo · 🔧 Averiado · 🟡 Parado desde su teléfono.'}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{abierto ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {abierto ? (
        <View style={{ marginTop: spacing.xs }}>
          {faltaSql ? <Text style={{ color: colors.danger, fontSize: 11, marginBottom: 4 }}>Falta correr el SQL de viajes_estado_permisos en Supabase.</Text> : null}
          {listeros.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>No hay listeros con rol de listero.</Text>
          ) : listeros.map((l) => (
            <Toggle key={l.id} on={ids.has(l.id)} label={`👤 ${l.full_name}`} onPress={() => alternar(l)} />
          ))}
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
            Solo los 3 estados básicos. En espera, retirada y transferida siguen siendo de la oficina. Todo queda en Auditoría.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
