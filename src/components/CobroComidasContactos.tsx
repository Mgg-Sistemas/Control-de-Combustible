// COBRO DE COMIDAS · pestaña «📇 Contactos» de «💲 Precios y cuentas» (21-sep-2026).
//
// Pedido del cliente: «hay personas que vienen nuevas y piden n cantidad de comidas
// […] es como crear un contacto, ese contacto sería solo para cocina», y «que cuente
// con un buscador para poder localizar más rápido el registro».
//
// Acá la oficina administra la agenda: busca, corrige, decide a quién se le cobra lo
// que pida y quita de la lista al que ya no viene. Crear también se puede desde la
// pantalla de Cocina, con el mismo formulario.
//
// ⚠️ NUNCA SE BORRA UN CONTACTO. Se quita de la lista (`activo = false`). Sus entregas
//    viejas tienen que seguir teniendo dueño, o la factura de ese mes cambiaría sola.
//    La base tampoco deja borrarlo: la llave de `food_distributions` lo impide.
//
// Las reglas viven en src/lib/comidaContactos.ts; lo que escribe, en comidaContactosDb.ts.
import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import {
  ContactoCocina,
  buscarContactos, cobrarAEfectivo, contactoActivo, contarSinCedula, formatearCedula,
  limpiarTexto, nombreDeContacto, ordenarContactos, sinCedula,
} from '../lib/comidaContactos';
import { cambiarCobrarA, cambiarListaContacto } from '../lib/comidaContactosDb';
import { ContactoCocinaForm } from './ContactoCocinaForm';

type Props = {
  canEdit: boolean;
  contactos: ContactoCocina[];
  empresas: { id: string; name: string }[];
  cargando: boolean;
  /** Falta correr el SQL: se dice y no se ofrece crear nada. */
  sinTabla: boolean;
  quien?: { id?: string | null; nombre?: string | null };
  /** Vuelve a leer la agenda (y avisa al cobro para que recalcule). */
  onCambio: () => Promise<void> | void;
};

export function CobroComidasContactos({ canEdit, contactos, empresas, cargando, sinTabla, quien, onCambio }: Props) {
  const { colors } = useTheme();
  const [busqueda, setBusqueda] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [editando, setEditando] = useState<ContactoCocina | null>(null);
  // Segundo toque para quitar de la lista: es reversible, pero no debe pasar de un roce.
  const [confirmarQuitar, setConfirmarQuitar] = useState<string | null>(null);
  const [verQuitados, setVerQuitados] = useState(false);

  const nombreEmpresa = useMemo(
    () => new Map(empresas.map((e) => [e.id, e.name])),
    [empresas],
  );

  const lista = useMemo(() => {
    const filtrados = buscarContactos(contactos, busqueda);
    return ordenarContactos(filtrados).filter((c) => verQuitados || contactoActivo(c));
  }, [contactos, busqueda, verQuitados]);

  const enLista = contactos.filter(contactoActivo).length;
  const quitados = contactos.length - enLista;
  const faltanCedulas = contarSinCedula(contactos);

  const abrirNuevo = () => { setEditando(null); setFormAbierto(true); setAviso(null); };
  const abrirEditar = (c: ContactoCocina) => { setEditando(c); setFormAbierto(true); setAviso(null); };

  const guardado = async (c: ContactoCocina, creado: boolean) => {
    setFormAbierto(false);
    setAviso(`✅ ${nombreDeContacto(c)} ${creado ? 'quedó registrado' : 'quedó corregido'}.`);
    await onCambio();
  };

  const alternarCobro = async (c: ContactoCocina) => {
    setAviso(null);
    if (!c.company_id) {
      setAviso('ℹ️ Sin empresa no hay a quién pasarle la cuenta: paga él. Asígnale una empresa si quieres cobrarle a ella.');
      return;
    }
    const nuevo = cobrarAEfectivo(c) === 'empresa' ? 'independiente' : 'empresa';
    setTrabajando(c.id);
    const r = await cambiarCobrarA(c.id, nuevo);
    setTrabajando(null);
    if (r.error) { setAviso(`❌ ${r.error}`); return; }
    setAviso(nuevo === 'empresa'
      ? `✅ Lo que pida ${nombreDeContacto(c)} de ahora en adelante se le cobra a ${nombreEmpresa.get(c.company_id) ?? 'su empresa'}. Lo ya entregado no cambia.`
      : `✅ Lo que pida ${nombreDeContacto(c)} de ahora en adelante se le cobra a él. Lo ya entregado no cambia.`);
    await onCambio();
  };

  const alternarLista = async (c: ContactoCocina) => {
    setAviso(null);
    const activo = contactoActivo(c);
    if (activo && confirmarQuitar !== c.id) {
      setConfirmarQuitar(c.id);
      setAviso(`⚠️ ${nombreDeContacto(c)} deja de salir en la cocina, pero sus entregas y su cuenta se conservan. Toca «🚫 Quitar» de nuevo para confirmar.`);
      return;
    }
    setConfirmarQuitar(null);
    setTrabajando(c.id);
    const r = await cambiarListaContacto(c.id, !activo);
    setTrabajando(null);
    if (r.error) { setAviso(`❌ ${r.error}`); return; }
    setAviso(activo
      ? `✅ ${nombreDeContacto(c)} quitado de la lista. Se puede devolver cuando vuelva.`
      : `✅ ${nombreDeContacto(c)} está de vuelta en la lista.`);
    await onCambio();
  };

  const chip = (activo: boolean) => ({
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: activo ? colors.brand : colors.surfaceAlt,
    borderWidth: 1, borderColor: activo ? colors.brand : colors.border,
  });
  const chipTxt = (activo: boolean) => ({
    color: activo ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12,
  });

  if (sinTabla) {
    return (
      <Card>
        <Text style={{ color: colors.warning, fontWeight: '800', marginBottom: spacing.xs }}>
          ⚠️ La agenda de cocina todavía no existe en la base
        </Text>
        <Text style={{ color: colors.text, fontSize: 13 }}>
          Falta correr el SQL de contactos de cocina en Supabase
          (sql-comida-contactos-2026-09-21.sql). Mientras tanto, todo lo demás del módulo
          funciona igual que siempre.
        </Text>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>
          📇 Contactos de cocina ({enLista} en la lista{quitados ? ` · ${quitados} quitado(s)` : ''})
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Personas que compran comida y no son de nómina. Esta agenda solo la usa Comida: no entra en nómina,
          ni en asistencia, ni en carnets.
        </Text>

        <TextInput
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar por nombre, cédula o teléfono"
          placeholderTextColor={colors.muted}
          style={{
            borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
            paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
            color: colors.text, backgroundColor: colors.surface, marginBottom: spacing.xs,
          }}
        />
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
          Los puntos y la V no importan: escribiendo 12345678 aparece V-12.345.678.
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {canEdit ? (
            <TouchableOpacity onPress={abrirNuevo} style={chip(true)}>
              <Text style={chipTxt(true)}>➕ Persona nueva</Text>
            </TouchableOpacity>
          ) : null}
          {quitados ? (
            <TouchableOpacity onPress={() => setVerQuitados((v) => !v)} style={chip(verQuitados)}>
              <Text style={chipTxt(verQuitados)}>{verQuitados ? '👁️ Ocultar quitados' : `👁️ Ver quitados (${quitados})`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {faltanCedulas ? (
          <Text style={{ color: colors.warning, fontSize: 12, marginTop: spacing.sm }}>
            ⚠️ {faltanCedulas} contacto(s) sin cédula. Compleméntala cuando vuelvan: sin ella se pueden duplicar.
          </Text>
        ) : null}
      </Card>

      {aviso ? (
        <TouchableOpacity
          onPress={() => setAviso(null)}
          style={{
            backgroundColor: colors.surfaceAlt, borderLeftWidth: 4,
            borderLeftColor: aviso.startsWith('❌') ? colors.danger : aviso.startsWith('⚠️') ? colors.warning : colors.success,
            borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 13 }}>{aviso}</Text>
        </TouchableOpacity>
      ) : null}

      {cargando ? (
        <Card><Text style={{ color: colors.muted }}>Leyendo la agenda…</Text></Card>
      ) : lista.length === 0 ? (
        <Card>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {busqueda
              ? `Nadie coincide con «${limpiarTexto(busqueda)}».`
              : 'Todavía no hay contactos. El primero se crea con «➕ Persona nueva».'}
          </Text>
        </Card>
      ) : (
        lista.map((c) => {
          const activo = contactoActivo(c);
          const cobro = cobrarAEfectivo(c);
          const emp = c.company_id ? nombreEmpresa.get(c.company_id) ?? 'Empresa' : null;
          return (
            <Card key={c.id}>
              <Text style={{ color: activo ? colors.text : colors.muted, fontWeight: '800', fontSize: 15 }}>
                {nombreDeContacto(c)}{activo ? '' : ' · quitado de la lista'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {sinCedula(c) ? '⚠️ sin cédula' : formatearCedula(c.cedula)}
                {c.telefono1 ? ` · ${limpiarTexto(c.telefono1)}` : ''}
                {c.telefono2 ? ` · ${limpiarTexto(c.telefono2)}` : ''}
              </Text>
              <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }}>
                {emp ? `🏢 ${emp}` : '👤 Por su cuenta'}
                {' · se le cobra a '}
                <Text style={{ fontWeight: '800' }}>{cobro === 'empresa' ? (emp ?? 'su empresa') : 'él mismo'}</Text>
              </Text>
              {c.nota ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🗒️ {c.nota}</Text>
              ) : null}

              {canEdit ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  <TouchableOpacity onPress={() => abrirEditar(c)} disabled={trabajando === c.id} style={chip(false)}>
                    <Text style={chipTxt(false)}>✏️ Corregir</Text>
                  </TouchableOpacity>
                  {c.company_id ? (
                    <TouchableOpacity onPress={() => alternarCobro(c)} disabled={trabajando === c.id} style={chip(false)}>
                      <Text style={chipTxt(false)}>
                        {cobro === 'empresa' ? '👤 Que pague él' : `🏢 Cobrar a ${emp}`}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => alternarLista(c)}
                    disabled={trabajando === c.id}
                    style={chip(confirmarQuitar === c.id)}
                  >
                    <Text style={chipTxt(confirmarQuitar === c.id)}>
                      {activo ? (confirmarQuitar === c.id ? '🚫 Quitar · confirmar' : '🚫 Quitar') : '↩️ Devolver'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      <ContactoCocinaForm
        visible={formAbierto}
        onClose={() => setFormAbierto(false)}
        contacto={editando}
        contactos={contactos}
        empresas={empresas}
        canEdit={canEdit}
        quien={quien}
        onGuardado={guardado}
        onYaExiste={(c) => { setEditando(c); setBusqueda(c.cedula ?? nombreDeContacto(c)); setFormAbierto(false); }}
      />
    </>
  );
}
