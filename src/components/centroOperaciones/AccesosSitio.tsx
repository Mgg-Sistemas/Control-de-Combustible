// 🔐 QUIÉN ENTRA A ESTE CENTRO (03-nov-2026). Solo para administradores, dentro de
// ⚙️ Ajustes. A quien se le da acceso entra al Centro de Operaciones con CONTROL TOTAL,
// pero SOLO a los centros donde aparece aquí (la base lo exige con cop_nivel). Quitar
// el acceso no borra nada: la fila queda inactiva y lo que esa persona cargó se queda.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Card } from '../ui';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { norm } from '../../lib/text';
import type { Sitio } from '../../lib/centroOperaciones';
import {
  AccesoSitio, PersonaParaAcceso, cargarAccesosSitio, cargarPersonasParaAcceso, darAccesoSitio, quitarAccesoSitio,
} from '../../lib/centroOperacionesDb';

export default function AccesosSitio({ sitio }: { sitio: Sitio }) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const [accesos, setAccesos] = useState<AccesoSitio[]>([]);
  const [personas, setPersonas] = useState<PersonaParaAcceso[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([cargarAccesosSitio(sitio.id), cargarPersonasParaAcceso()]);
      setAccesos(a); setPersonas(p); setError(null);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los accesos.');
    }
  }, [sitio]);
  useEffect(() => { cargar(); }, [cargar]);

  const activos = accesos.filter((a) => a.activo);
  const conAcceso = useMemo(() => new Set(activos.map((a) => a.userId)), [activos]);
  const resultados = useMemo(() => {
    const t = norm(q);
    if (!t) return [];
    return personas.filter((p) => !conAcceso.has(p.id) && norm(`${p.nombre} ${p.rol}`).includes(t)).slice(0, 12);
  }, [personas, conAcceso, q]);

  const dar = async (p: PersonaParaAcceso) => {
    setOcupado(p.id);
    try {
      await darAccesoSitio(sitio.id, p.id);
      toast.success(`🔐 ${p.nombre} ya entra a «${sitio.nombre}» con control total.`);
      setQ('');
      await cargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se dio el acceso.');
    } finally { setOcupado(null); }
  };

  const quitar = async (a: AccesoSitio) => {
    const ok = await confirm({
      title: 'Quitar acceso',
      message: `${a.nombre} dejará de entrar a «${sitio.nombre}». Lo que ya cargó se queda.`,
      confirmText: 'Quitar acceso',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    setOcupado(a.id);
    try {
      await quitarAccesoSitio(a.id);
      toast.success(`${a.nombre} ya no entra a «${sitio.nombre}».`);
      await cargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se quitó el acceso.');
    } finally { setOcupado(null); }
  };

  return (
    <Card>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🔐 Quién entra a «{sitio.nombre}»</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
        Solo los administradores ven esto. La persona que agregues aquí entra al Centro de Operaciones con CONTROL TOTAL,
        pero SOLO a este centro (y a los otros donde también la agregues): no ve los demás ni crea centros nuevos. No hace
        falta darle el permiso del módulo en Usuarios. Quitar el acceso no borra nada de lo que cargó.
      </Text>
      {error ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginTop: spacing.xs }}>⚠️ {error}</Text> : null}

      {activos.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nadie tiene acceso solo a este centro todavía.</Text>
      ) : activos.map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>👤 {a.nombre} · ✅ control total</Text>
            {a.dadoPor ? <Text style={{ color: colors.muted, fontSize: 11 }}>Lo dio {a.dadoPor}{a.actualizado ? ` · ${String(a.actualizado).slice(0, 10).split('-').reverse().join('/')}` : ''}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => quitar(a)} disabled={!!ocupado} style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4, opacity: ocupado ? 0.5 : 1 }}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Quitar</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, marginTop: spacing.md }}>➕ DAR ACCESO A ESTE CENTRO</Text>
      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Busca a la persona por su nombre" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: 4 }} />
      {q.trim() && resultados.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>No hay nadie con ese nombre (o ya tiene acceso).</Text> : null}
      {resultados.map((p) => (
        <TouchableOpacity key={p.id} onPress={() => dar(p)} disabled={!!ocupado}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: ocupado ? 0.5 : 1 }}>
          <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>👤 {p.nombre}{p.rol ? <Text style={{ color: colors.muted, fontSize: 11 }}>  · {p.rol}</Text> : null}</Text>
          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{ocupado === p.id ? '…' : '＋ Dar control total'}</Text>
        </TouchableOpacity>
      ))}
    </Card>
  );
}
