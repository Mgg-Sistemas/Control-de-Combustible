// ============================================================================
// EDICIÓN MASIVA DE USUARIOS.
//
// Pedido del cliente (21-ago-2026): «dame una opción para editar masivamente a
// varios usuarios, además de poder agrupar por roles o buscar por cualquier
// característica del usuario». El caso que lo originó: quitarle el permiso de
// escritura del Catálogo a toda la plantilla menos a los admin y a una persona,
// sin tener que entrar y salir de "Editar" sesenta veces.
//
// Cómo se usa: se filtra (chips de rol + buscador), se marcan los usuarios, se
// elige MÓDULO + NIVEL y se aplica de un golpe. Antes de guardar dice a cuántos
// les va a quedar de verdad y a cuántos no — ver `nivelEfectivo` en
// `src/lib/usuariosBulk.ts`. El permiso de la persona LE GANA al rol (para
// arriba y para abajo); la única excepción son los ADMIN, que siempre quedan en
// full control.
//
// La lógica (agrupar, buscar, nivel real) vive en `src/lib/usuariosBulk.ts` y la
// amarra `scripts/test-usuarios-bulk.mjs`. Acá solo está la pantalla.
// ============================================================================
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { supabase } from '../lib/supabase';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { MODULES, LEVELS, PermLevel, roleLabel } from '../lib/permissions';
import {
  UsuarioBulk, RolApp, ClaveRol, gruposPorRol, filtrarUsuarios, claveRolDe,
  repartirPorEfecto, motivoNoAplica,
} from '../lib/usuariosBulk';

export function BulkPermissionsModal({
  visible, users, roles, onClose, onSaved,
}: {
  visible: boolean;
  users: UsuarioBulk[];
  roles: RolApp[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [gruposSel, setGruposSel] = useState<Set<ClaveRol>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modulo, setModulo] = useState('equipos');
  const [nivel, setNivel] = useState<PermLevel>('lectura');
  const [modOpen, setModOpen] = useState(false);
  const [modQ, setModQ] = useState('');
  const [busy, setBusy] = useState(false);

  const grupos = useMemo(() => gruposPorRol(users, roles), [users, roles]);
  const visibles = useMemo(
    () => filtrarUsuarios(users, { q, roles: gruposSel, appRoles: roles }),
    [users, q, gruposSel, roles]
  );
  const seleccionados = useMemo(() => users.filter((u) => sel.has(u.id)), [users, sel]);
  const { aplican, noAplican } = useMemo(
    () => repartirPorEfecto(seleccionados, modulo, nivel, roles),
    [seleccionados, modulo, nivel, roles]
  );

  const moduloLabel = MODULES.find((m) => m.key === modulo)?.label ?? modulo;
  const nivelLabel = LEVELS.find((l) => l.value === nivel)?.label ?? nivel;
  const modulosFiltrados = useMemo(() => {
    const t = modQ.trim().toLowerCase();
    return t ? MODULES.filter((m) => m.label.toLowerCase().includes(t) || m.key.includes(t)) : MODULES;
  }, [modQ]);

  const toggleGrupo = (k: ClaveRol) =>
    setGruposSel((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleUser = (id: string) =>
    setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // "Marcar todos" SUMA los visibles a lo ya marcado, no lo pisa: así se puede
  // buscar "inspector", marcar todos, buscar "operador" y marcar todos también.
  const marcarVisibles = () => setSel((p) => { const n = new Set(p); visibles.forEach((u) => n.add(u.id)); return n; });
  const desmarcarVisibles = () => setSel((p) => { const n = new Set(p); visibles.forEach((u) => n.delete(u.id)); return n; });

  const cerrar = () => { setQ(''); setGruposSel(new Set()); setSel(new Set()); setModQ(''); setModOpen(false); onClose(); };

  const aplicar = async () => {
    if (sel.size === 0) return;
    const aviso = noAplican.length > 0
      ? `\n\n⚠️ A ${noAplican.length} no le va a quedar así: ${noAplican.slice(0, 3).map((x) => `${x.u.full_name ?? 'Usuario'} (${x.motivo})`).join('; ')}${noAplican.length > 3 ? '; y otros…' : ''}.`
      : '';
    const ok = await confirm({
      title: 'Aplicar a los marcados',
      message: `Se le va a poner "${nivelLabel}" en «${moduloLabel}» a ${sel.size} usuario(s).${aviso}`,
      confirmText: 'Aplicar',
      danger: nivel === 'none',
    });
    if (!ok) return;
    setBusy(true);
    // upsert: al que ya tenía una fila para ese módulo se le pisa el nivel; al que
    // no tenía, se le crea. La clave primaria es (user_id, module).
    const filas = seleccionados.map((u) => ({ user_id: u.id, module: modulo, level: nivel }));
    const { error } = await supabase.from('module_permissions').upsert(filas, { onConflict: 'user_id,module' });
    setBusy(false);
    if (error) { toast.show(`No se pudo: ${error.message}`); return; }
    toast.show(
      noAplican.length === 0
        ? `✅ Listo: ${aplican.length} usuario(s) con "${nivelLabel}" en ${moduloLabel}.`
        : `✅ Guardado en ${aplican.length}. A ${noAplican.length} no le aplica por ser admin.`
    );
    setSel(new Set());
    onSaved();
  };

  const chip = (label: string, on: boolean, onPress: () => void, extra?: string) => (
    <TouchableOpacity
      key={label + extra}
      onPress={onPress}
      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
      {extra ? <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 12 }}>{extra}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cerrar}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
          <TouchableOpacity onPress={cerrar} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 19 }}>✏️ Edición masiva de usuarios</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            Filtra, marca a varios y cámbiales el permiso de un módulo de un solo golpe.
          </Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.lg }}>
          {/* AGRUPAR POR ROL. Vacío = todos los roles. */}
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
            Agrupar por rol{gruposSel.size > 0 ? ` · ${gruposSel.size} marcado(s)` : ' (todos)'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
            {grupos.map((g) => chip(g.label, gruposSel.has(g.key), () => toggleGrupo(g.key), `(${g.count})`))}
            {gruposSel.size > 0 ? (
              <TouchableOpacity onPress={() => setGruposSel(new Set())} style={{ alignSelf: 'center', paddingHorizontal: spacing.xs }}>
                <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>✕ Limpiar</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* BUSCAR POR CUALQUIER CARACTERÍSTICA. */}
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="🔎 Nombre, usuario, cédula, rol, «bloqueado»…"
            placeholderTextColor={colors.muted}
            style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
          />

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>
              {visibles.length} usuario(s) a la vista · {sel.size} marcado(s)
            </Text>
            <TouchableOpacity onPress={marcarVisibles} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>☑️ Marcar los {visibles.length}</Text>
            </TouchableOpacity>
            {sel.size > 0 ? (
              <TouchableOpacity onPress={desmarcarVisibles} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>⬜ Desmarcar</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* LISTA. Cada renglón dice el rol con el que se agrupa y, si aplica, por
              qué el nivel elegido NO le va a quedar. */}
          {visibles.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: spacing.lg, textAlign: 'center' }}>
              Sin usuarios con ese filtro.
            </Text>
          ) : visibles.map((u) => {
            const on = sel.has(u.id);
            const rolTxt = u.app_role_id
              ? (roles.find((r) => r.id === u.app_role_id)?.name ?? 'Rol')
              : roleLabel(String(u.role ?? ''));
            const pega = on ? motivoNoAplica(u, modulo, nivel, roles) : null;
            return (
              <TouchableOpacity
                key={u.id}
                onPress={() => toggleUser(u.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.surfaceAlt : 'transparent', marginBottom: spacing.xs }}
              >
                <Text style={{ fontSize: 16 }}>{on ? '☑️' : '⬜'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{u.full_name ?? 'Sin nombre'}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {rolTxt.toUpperCase()}{u.username ? ` · 👤 ${u.username}` : ''}{u.cedula ? ` · C.I. ${u.cedula}` : ''}{u.locked ? ' · 🔒 BLOQUEADO' : ''}
                  </Text>
                  {pega ? (
                    <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '700' }}>⚠️ No le queda: {pega}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* BARRA DE ACCIÓN: módulo + nivel + aplicar. Fija abajo para que no haya
            que subir hasta arriba después de marcar cincuenta personas. */}
        <View style={{ borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setModOpen((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>📋 Módulo: {moduloLabel}</Text>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>{modOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {modOpen ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, maxHeight: 220 }}>
              <TextInput
                value={modQ}
                onChangeText={setModQ}
                placeholder="Buscar módulo…"
                placeholderTextColor={colors.muted}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, borderBottomWidth: 1, borderColor: colors.border }}
              />
              <ScrollView>
                {modulosFiltrados.map((m) => (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => { setModulo(m.key); setModOpen(false); setModQ(''); }}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: m.key === modulo ? colors.surfaceAlt : 'transparent' }}
                  >
                    <Text style={{ color: m.key === modulo ? colors.brandText : colors.text, fontWeight: m.key === modulo ? '800' : '600', fontSize: 13 }}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {LEVELS.map((l) => chip(l.label, nivel === l.value, () => setNivel(l.value)))}
          </View>

          {sel.size > 0 && noAplican.length > 0 ? (
            <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700' }}>
              ⚠️ {noAplican.length} de los {sel.size} marcados son ADMIN: siempre quedan en full control y «{nivelLabel}» no les aplica. A un admin se le cambia el ROL, no el permiso.
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={aplicar}
            disabled={sel.size === 0 || busy}
            style={{ backgroundColor: sel.size === 0 || busy ? colors.border : colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.sm }}
          >
            {busy ? <ActivityIndicator color={colors.brandContrast} /> : null}
            <Text style={{ color: sel.size === 0 || busy ? colors.muted : colors.brandContrast, fontWeight: '800', fontSize: 15 }}>
              {busy ? 'Guardando…' : sel.size === 0 ? 'Marca usuarios para aplicar' : `Poner "${nivelLabel}" a ${sel.size} usuario(s)`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
