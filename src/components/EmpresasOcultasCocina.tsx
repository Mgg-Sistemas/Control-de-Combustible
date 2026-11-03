// 🙈 Qué empresas se ofrecen en cocina (03-nov-2026). Solo para quien tiene
// permiso completo de comida. Ocultar NO borra nada ni toca la empresa en el
// resto del sistema: solo deja de ofrecerse para entregas nuevas en cocina. Sus
// comidas viejas siguen en reportes, cobro y facturas. «👁️ Mostrar» la devuelve.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { Plegable } from './Plegable';
import { FilaEmpresaOculta } from '../lib/comidaEmpresasOcultas';
import { ponerEmpresaOculta } from '../lib/comidaEmpresasOcultasDb';
import { norm } from '../lib/text';

export function EmpresasOcultasCocina({ empresas, ocultas, filas, sinTabla, onCambio }: {
  empresas: { id: string; name: string }[];
  ocultas: Set<string>;
  filas: FilaEmpresaOculta[];
  sinTabla: boolean;
  onCambio: () => void;
}) {
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [verOcultas, setVerOcultas] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const porId = useMemo(() => new Map(filas.map((f) => [String(f.company_id), f])), [filas]);
  const nOcultas = empresas.filter((e) => ocultas.has(e.id)).length;
  const lista = useMemo(() => {
    const t = norm(q);
    return empresas
      .filter((e) => (verOcultas ? ocultas.has(e.id) : !ocultas.has(e.id)))
      .filter((e) => !t || norm(e.name).includes(t));
  }, [empresas, ocultas, verOcultas, q]);

  const cambiar = async (e: { id: string; name: string }, oculta: boolean) => {
    setGuardando(e.id);
    setAviso(null);
    const r = await ponerEmpresaOculta(e.id, oculta);
    setGuardando(null);
    if (!r.ok) { setAviso(`⚠️ ${r.error}`); return; }
    setAviso(oculta ? `🙈 ${e.name} ya no se ofrece en cocina. Sus comidas viejas siguen en los reportes.` : `👁️ ${e.name} vuelve a salir en cocina.`);
    onCambio();
  };

  return (
    <Plegable titulo="🙈 Empresas que se muestran en cocina" resumen={sinTabla ? '⚠️ falta el SQL' : `${empresas.length - nOcultas} visibles · ${nOcultas} ocultas`}>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Ocultar una empresa aquí solo la quita de cocina (QR por empresa, agregar comidas, contactos nuevos). No se borra nada y no
        cambia en maquinaria, nómina ni compras. Sus comidas ya registradas siguen en reportes, cobro y facturas. Si escanean su QR,
        se deja registrar con un aviso.
      </Text>
      {sinTabla ? (
        <Text style={{ color: colors.warning, fontWeight: '800', marginBottom: spacing.sm }}>⚠️ Falta crear la tabla de empresas ocultas (SQL pendiente). Mientras tanto se ven todas.</Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: spacing.sm }}>
        {[{ on: false, t: `👁️ Visibles (${empresas.length - nOcultas})` }, { on: true, t: `🙈 Ocultas (${nOcultas})` }].map((x) => {
          const act = verOcultas === x.on;
          return (
            <TouchableOpacity key={String(x.on)} onPress={() => setVerOcultas(x.on)} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: act ? colors.brand : colors.border, backgroundColor: act ? colors.brand : colors.surface }}>
              <Text style={{ color: act ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{x.t}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar empresa" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }} />
      {aviso ? <Text style={{ color: aviso.startsWith('⚠️') ? colors.danger : colors.success, fontWeight: '700', fontSize: 12, marginBottom: spacing.xs }}>{aviso}</Text> : null}
      {lista.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>{verOcultas ? 'No hay empresas ocultas.' : 'No hay empresas que coincidan.'}</Text>
      ) : lista.map((e) => {
        const f = porId.get(e.id);
        const oculta = ocultas.has(e.id);
        return (
          <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }} numberOfLines={2}>🏢 {e.name}</Text>
              {oculta && f?.updated_by_nombre ? <Text style={{ color: colors.muted, fontSize: 11 }}>Ocultada por {f.updated_by_nombre}{f.updated_at ? ` · ${String(f.updated_at).slice(0, 10).split('-').reverse().join('/')}` : ''}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => cambiar(e, !oculta)} disabled={guardando === e.id || sinTabla}
              style={{ borderWidth: 1, borderColor: oculta ? colors.success : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: guardando === e.id || sinTabla ? 0.5 : 1 }}>
              <Text style={{ color: oculta ? colors.success : colors.text, fontWeight: '800', fontSize: 12 }}>{guardando === e.id ? '…' : oculta ? '👁️ Mostrar' : '🙈 Ocultar'}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </Plegable>
  );
}
