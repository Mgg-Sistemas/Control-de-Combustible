// ============================================================================
// 📇 CONTACTOS (COMPRAS, VENTAS) — el catálogo único, 23-sep-2026.
//
// Pedido del cliente, textual: «esa lista de personas y proveedores desde ventas,
// la vas a volver un catálogo en un módulo aparte que diga CONTACTOS (COMPRAS,
// VENTAS) […] lo mismo harás con compras, lo que se tiene registrado, que se
// refleje allá, y vas a permitir poder editar, deshabilitar, y agregar un nuevo
// contacto ya sea persona o proveedor, con los datos básicos que sería nombre,
// apellido, razón social, cédula, rif. Y además no permitas agregar si ya existe
// esa cédula o RIF».
//
// ⭐ ES UNA SOLA LISTA. Cliente y proveedor son dos MARCAS del mismo contacto: a
//    mucha gente se le vende Y se le compra, y tenerla dos veces es tener su
//    cuenta partida en dos.
//
// ⭐ LO DE COMPRAS ESTÁ AQUÍ. Los proveedores que ya existían se importaron y
//    quedaron ESPEJADOS con su ficha de Compras: se edite donde se edite, el
//    nombre y el RIF terminan iguales en los dos sitios (trigger, contactos.sql).
//
// ⚠️ NO SE BORRA A NADIE: se DESHABILITA. Un contacto borrado se lleva por delante
//    el nombre de sus ventas, sus compras y sus cuentas.
//
// La regla vive en src/lib/contactos.ts (sin React ni Supabase) y el formulario en
// components/ContactoForm.tsx, el MISMO que sale dentro de una venta.
// Requiere correr `supabase/contactos.sql`.
// ============================================================================
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { ContactoForm } from '../components/ContactoForm';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { Contacto } from '../types/database';
import {
  RolContacto, buscarContactos, conteoContactos, docCanonico, docTipoLabel,
  filtrarContactos, rolesDe, sinDocumento,
} from '../lib/contactos';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const PASTILLAS: { key: RolContacto; label: string }[] = [
  { key: 'todos', label: '📇 Todos' },
  { key: 'clientes', label: '👤 Clientes' },
  { key: 'proveedores', label: '🏭 Proveedores' },
  { key: 'sin_documento', label: '⚠️ Sin cédula/RIF' },
  { key: 'deshabilitados', label: '🚫 Deshabilitados' },
];

export default function ContactosScreen() {
  const { colors } = useTheme();
  const { session, moduleLevel } = useAuth();
  const toast = useToast();
  const canWrite = levelMeets(moduleLevel('contactos'), 'escritura');

  const { data: contactos, loading, refetch } =
    useTable<Contacto>('contactos', { orderBy: 'name', realtimeFrom: 'contactos' });

  const [q, setQ] = useState('');
  const [rol, setRol] = useState<RolContacto>('todos');
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<Contacto | null>(null);
  // Deshabilitar se confirma EN LÍNEA, no con confirm(): dentro de un Modal a
  // pantalla completa el confirm del navegador queda tapado y parece que se colgó.
  // Es una trampa que este proyecto ya documentó.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const conteo = useMemo(() => conteoContactos(contactos), [contactos]);
  const lista = useMemo(
    () => buscarContactos(filtrarContactos(contactos, rol), q),
    [contactos, rol, q],
  );

  const abrirNuevo = () => { setEditando(null); setOpen(true); };
  const abrirEditar = (c: Contacto) => { setEditando(c); setOpen(true); };

  /**
   * Deshabilitar / habilitar. NUNCA borrar: el contacto es el nombre que aparece
   * en ventas, compras y cuentas ya registradas.
   *
   * ⚠️ Deshabilitar a un PROVEEDOR también desactiva su ficha en Compras (lo hace
   *    un trigger). Se avisa, porque es lo que el usuario va a notar allá.
   */
  const cambiarEstado = async (c: Contacto, activo: boolean) => {
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from('contactos').update({ active: activo }).eq('id', c.id).select('id').single();
      if (error) return toast.error(error.message);
      if (!data) return toast.error('No se guardó: te falta permiso de escritura.');
      setConfirmando(null);
      await refetch();
      toast.success(activo
        ? `${c.name} vuelve a estar disponible.`
        : `${c.name} quedó deshabilitado${c.es_proveedor ? ' (también en Compras)' : ''}. No se borró nada.`);
    } finally {
      setBusy(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  return (
    <Screen>
      <ConfigBanner />

      <TextInput
        value={q} onChangeText={setQ}
        placeholder="🔎 Nombre, apellido, razón social, cédula, RIF, teléfono, rubro…"
        placeholderTextColor={colors.muted}
        style={[input, { marginBottom: spacing.sm }]}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {PASTILLAS.map((p) => {
            const on = rol === p.key;
            const n = conteo[p.key as keyof typeof conteo] ?? 0;
            return (
              <TouchableOpacity
                key={p.key} onPress={() => setRol(p.key)}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}
              >
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                  {p.label} {n}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {canWrite ? (
        <TouchableOpacity onPress={abrirNuevo} style={{ backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>＋ Agregar contacto</Text>
        </TouchableOpacity>
      ) : null}

      {/* ⚠️ Los que llegaron de Compras sin RIF cargado (o con uno repetido) no son
          un error del sistema: es lo que hay que completar a mano. Se dice cuántos
          son y se puede ir directo a ellos, en vez de que aparezcan como buenos. */}
      {rol !== 'sin_documento' && conteo.sin_documento > 0 ? (
        <TouchableOpacity
          onPress={() => setRol('sin_documento')}
          style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}
        >
          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 13 }}>
            ⚠️ {conteo.sin_documento} contacto(s) sin cédula ni RIF
          </Text>
          <Text style={{ color: colors.text, fontSize: 12, marginTop: 2 }}>
            Se usan igual, pero sin documento no se les puede facturar bien. Toca aquí para verlos.
          </Text>
        </TouchableOpacity>
      ) : null}

      {lista.length === 0 ? (
        <EmptyState
          title={q ? 'Sin resultados' : 'Sin contactos'}
          subtitle={q ? 'Prueba con otro dato.' : 'Registra a quién le vendes y a quién le compras.'}
        />
      ) : lista.map((c) => {
        const doc = docCanonico(c.doc_letter, c.doc_number);
        const confirma = confirmando === c.id;
        return (
          <Card key={c.id} style={c.active === false ? { opacity: 0.6 } : undefined}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                  {c.name}{c.active === false ? '  · 🚫 deshabilitado' : ''}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  {rolesDe(c)}
                  {doc ? ` · ${docTipoLabel(c.doc_letter)} ${doc}` : ''}
                  {c.phone ? ` · 📞 ${c.phone}` : ''}
                </Text>
                {sinDocumento(c) ? (
                  <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '700', marginTop: 2 }}>
                    ⚠️ Le falta la cédula o el RIF
                  </Text>
                ) : null}
                {c.tags?.length ? (
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>🏷️ {c.tags.join(' · ')}</Text>
                ) : null}
                {c.email ? <Text style={{ color: colors.muted, fontSize: 11 }}>✉️ {c.email}</Text> : null}
                {c.address ? <Text style={{ color: colors.muted, fontSize: 11 }}>📍 {c.address}</Text> : null}
              </View>
              {canWrite && !confirma ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TouchableOpacity onPress={() => abrirEditar(c)}><Text style={{ fontSize: 15 }}>✏️</Text></TouchableOpacity>
                  {c.active === false
                    ? <TouchableOpacity onPress={() => cambiarEstado(c, true)}><Text style={{ fontSize: 15 }}>↩️</Text></TouchableOpacity>
                    : <TouchableOpacity onPress={() => setConfirmando(c.id)}><Text style={{ fontSize: 15 }}>🚫</Text></TouchableOpacity>}
                </View>
              ) : null}
            </View>

            {confirma ? (
              <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                <Text style={{ color: colors.text, fontSize: 12 }}>
                  Deja de salir para elegirlo en ventas{c.es_proveedor ? ' y en compras' : ''}. <Text style={{ fontWeight: '800' }}>No se borra</Text>:
                  sus ventas, compras y cuentas siguen con su nombre, y lo puedes habilitar cuando quieras.
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                  <TouchableOpacity onPress={() => setConfirmando(null)} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={busy} onPress={() => cambiarEstado(c, false)} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger, opacity: busy ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>Sí, deshabilitar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </Card>
        );
      })}

      <View style={{ height: spacing.xl }} />

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>{editando ? 'Editar contacto' : 'Nuevo contacto'}</SectionTitle>
            <ContactoForm
              contacto={editando}
              contactos={contactos}
              usuarioId={session?.user?.id ?? null}
              textoBuscado={q}
              nacePara={rol === 'proveedores' ? 'proveedor' : 'cliente'}
              onCancelar={() => setOpen(false)}
              onGuardado={async (c) => {
                setOpen(false);
                await refetch();
                toast.success(editando ? `${c.name} actualizado.` : `${c.name} quedó registrado.`);
              }}
            />
            <View style={{ height: spacing.xl }} />
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}
