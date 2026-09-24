// 👥 EL SELECTOR DE A QUIÉN SE LE FACTURA — cliente, proveedor o empresa.
//
// Sale de 💰 Ventas y de 🧰 Ventas de servicio. Es UN SOLO componente a propósito:
// dos selectores parecidos se desincronizan —a uno le agregan las empresas y al
// otro no— y el mismo cliente termina escrito de dos maneras distintas.
//
// Trae:
//   · Las pastillas 📇 Todos / 👤 Clientes / 🏭 Proveedores sobre UNA sola lista
//     (cliente y proveedor son dos marcas del mismo contacto).
//   · 🏢 Las empresas del catálogo con su ENCARGADO, que al elegirlas resuelven a
//     qué contacto corresponden en vez de crear una ficha nueva cada vez.
//   · ＋ Agregar, sin abandonar lo que se estaba haciendo.
//
// ⚠️ COMPONENTE DE NIVEL DE MÓDULO. Declararlo dentro de otro lo remonta en cada
//    tecla y el buscador pierde el foco letra por letra.
import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen, SectionTitle } from './ui';
import { ContactoForm } from './ContactoForm';
import { supabase } from '../lib/supabase';
import { useToast } from './ToastProvider';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { Contacto, Company, Machinery } from '../types/database';
import {
  RolContacto, buscarContactos, conteoContactos, docCanonico, docTipoLabel,
  filtrarContactos, rolesDe,
} from '../lib/contactos';
import { EmpresaParaVenta, contactoParaEmpresa, empresasParaVenta } from '../lib/contactoMaquinas';

/**
 * Lo que se está mirando: los contactos filtrados por rol, o las EMPRESAS DEL
 * CATÁLOGO con su encargado — que no son contactos, por eso no es un `RolContacto`.
 */
type FiltroVenta = RolContacto | 'empresas';

type Props = {
  visible: boolean;
  contactos: Contacto[];
  /** El catálogo de empresas, para poder facturarle a una directamente. */
  empresas?: Company[];
  /** El catálogo de equipos, SOLO para leerle el encargado a cada empresa. */
  machinery?: Machinery[];
  canWrite: boolean;
  usuarioId?: string | null;
  titulo?: string;
  onCerrar: () => void;
  onElegir: (contactoId: string) => void;
  /** Se creó o se enlazó un contacto: hay que releer la lista. */
  onCambio: () => Promise<void> | void;
};

export function ContactoPicker({
  visible, contactos, empresas, machinery, canWrite, usuarioId,
  titulo, onCerrar, onElegir, onCambio,
}: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rol, setRol] = useState<FiltroVenta>('todos');
  const [nuevo, setNuevo] = useState(false);
  const [busy, setBusy] = useState(false);

  const lista = useMemo(
    // 'empresas' no filtra contactos: es otra lista.
    () => buscarContactos(filtrarContactos(contactos, rol === 'empresas' ? 'todos' : rol), q).slice(0, 80),
    [contactos, rol, q],
  );
  const conteo = useMemo(() => conteoContactos(contactos), [contactos]);
  const empFiltrado = useMemo(
    () => empresasParaVenta(empresas as any, machinery as any, contactos as any, q),
    [empresas, machinery, contactos, q],
  );

  const elegir = (id: string) => { onElegir(id); setQ(''); setRol('todos'); setNuevo(false); };

  /**
   * 🏢 Se eligió una EMPRESA DEL CATÁLOGO.
   *
   * ⚠️ Una empresa del catálogo no es un contacto. Acá se resuelve cuál contacto le
   *    corresponde (el que ya la representa, el del mismo RIF, el del mismo nombre)
   *    y SOLO si no hay ninguno se crea: crear uno cada vez sería la cuenta por
   *    cobrar de esa empresa partida en dos fichas.
   */
  const elegirEmpresa = async (x: EmpresaParaVenta) => {
    const d = contactoParaEmpresa(x.empresa, contactos as any);
    if (d.accion !== 'crear' && d.deshabilitado) {
      return toast.error(`${d.contacto.name} está deshabilitado. Habilítalo en 📇 Contactos para poder facturarle.`);
    }
    if (d.accion === 'usar') { elegir(d.contacto.id); return; }

    setBusy(true);
    try {
      // ⚠️ Siempre con .select(): con RLS, un «no tienes permiso» llega como 0 filas
      //    y SIN error, y la pantalla diría «listo» a algo que no se guardó.
      if (d.accion === 'enlazar') {
        const { data, error } = await supabase.from('contactos')
          .update({ company_id: x.empresa.id, es_cliente: true }).eq('id', d.contacto.id).select().single();
        if (error) return toast.error(error.message);
        if (!data) return toast.error('No se guardó: te falta permiso de escritura en Contactos.');
        await onCambio();
        elegir(d.contacto.id);
        toast.success(`${d.contacto.name} quedó enlazado con la empresa ${d.motivo === 'rif' ? '(mismo RIF)' : '(mismo nombre)'}.`);
        return;
      }
      if (!canWrite) return toast.error('Esa empresa todavía no está registrada como contacto y no tienes permiso para crearla.');
      const { data, error } = await supabase.from('contactos')
        .insert({ ...d.fila, created_by: usuarioId ?? null }).select().single();
      if (error) {
        return toast.error(/duplicate|unique/i.test(error.message)
          ? 'Ese RIF ya está registrado con otro nombre. Búscalo en la lista.'
          : error.message);
      }
      if (!data) return toast.error('No se guardó: te falta permiso de escritura en Contactos.');
      await onCambio();
      elegir((data as Contacto).id);
      toast.success(`${x.empresa.name} quedó registrada como cliente y elegida.`);
    } finally {
      setBusy(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { setNuevo(false); onCerrar(); }}>
      <Screen>
        {nuevo ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Nuevo cliente o proveedor</SectionTitle>
            <ContactoForm
              contactos={contactos as any}
              usuarioId={usuarioId ?? null}
              textoBuscado={q}
              compacto
              onCancelar={() => setNuevo(false)}
              onGuardado={async (c: any) => {
                // Queda elegido de una: crearlo era el paso para poder seguir con
                // ESTO, no una tarea aparte.
                await onCambio();
                elegir(c.id);
                toast.success(`${c.name} quedó registrado y elegido.`);
              }}
            />
          </ScrollView>
        ) : (
          <>
            <SectionTitle>{titulo || 'Elegir cliente o proveedor'}</SectionTitle>
            <TextInput
              value={q} onChangeText={setQ}
              placeholder={rol === 'empresas'
                ? 'Busca la empresa por nombre, RIF o encargado…'
                : 'Busca por nombre, apellido, cédula, RIF, teléfono, correo…'}
              placeholderTextColor={colors.muted} style={input}
            />

            {/* 👤/🏭 Una sola lista, filtrada. No son dos catálogos: a mucha gente se
                le vende Y se le compra, y tenerla dos veces es tener su cuenta
                partida en dos. 🏢 La cuarta pastilla NO filtra esta lista: son las
                EMPRESAS DEL CATÁLOGO con su encargado, que es otra cosa. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.xs }}>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {([
                  { key: 'todos' as FiltroVenta, label: `📇 Todos (${conteo.todos})` },
                  { key: 'clientes' as FiltroVenta, label: `👤 Clientes (${conteo.clientes})` },
                  { key: 'proveedores' as FiltroVenta, label: `🏭 Proveedores (${conteo.proveedores})` },
                  { key: 'empresas' as FiltroVenta, label: `🏢 Empresas del catálogo (${empFiltrado.length})` },
                ]).map((p) => {
                  const on = rol === p.key;
                  return (
                    <TouchableOpacity
                      key={p.key} onPress={() => setRol(p.key)}
                      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingVertical: 6, paddingHorizontal: spacing.md }}
                    >
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 11 }}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {canWrite && rol !== 'empresas' ? (
              <TouchableOpacity onPress={() => setNuevo(true)} style={{ backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>＋ Agregar persona o proveedor</Text>
              </TouchableOpacity>
            ) : null}

            <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
              {rol === 'empresas' ? (
                <>
                  {empFiltrado.map((x) => (
                    <TouchableOpacity
                      key={x.empresa.id} disabled={busy} onPress={() => elegirEmpresa(x)}
                      style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: busy ? 0.6 : 1 }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                        🏢 {x.empresa.name}{x.contacto ? ' · ✅ ya registrada' : ''}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {x.encargados.length
                          ? `👤 ${x.encargados.slice(0, 3).join(', ')}${x.encargados.length > 3 ? ` +${x.encargados.length - 3}` : ''}`
                          : '👤 sin encargado cargado'}
                        {x.empresa.rif ? ` · ${x.empresa.rif}` : ''}
                        {x.maquinas ? ` · ${x.maquinas} máquina${x.maquinas === 1 ? '' : 's'}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {empFiltrado.length === 0 ? (
                    <Text style={{ color: colors.muted, marginTop: spacing.md }}>
                      {q ? `Ninguna empresa con «${q}» (se busca por nombre, RIF y encargado).` : 'No hay empresas en el catálogo.'}
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  {lista.map((c) => (
                    <TouchableOpacity key={c.id} onPress={() => elegir(c.id)} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                        {c.name}{(c as any).company_id ? ' · 🏢' : ''}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {rolesDe(c as any)} · {docTipoLabel(c.doc_letter)} {docCanonico(c.doc_letter, c.doc_number)}{c.phone ? ` · ${c.phone}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {lista.length === 0 ? (
                    <Text style={{ color: colors.muted, marginTop: spacing.md }}>
                      {q
                        ? `Nadie con «${q}»${rol === 'todos' ? '' : ' entre los ' + (rol === 'clientes' ? 'clientes' : 'proveedores')}.`
                        : 'Todavía no hay nadie registrado.'}
                      {canWrite ? ' Tócale «＋ Agregar persona o proveedor» aquí arriba.' : ' Pídele a un encargado que lo registre.'}
                    </Text>
                  ) : null}
                </>
              )}
              <View style={{ height: spacing.xl }} />
            </ScrollView>

            <TouchableOpacity onPress={onCerrar} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </>
        )}
      </Screen>
    </Modal>
  );
}
