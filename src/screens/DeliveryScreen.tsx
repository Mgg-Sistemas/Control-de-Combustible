// 🛵 DELIVERY · Fase 1 (09-nov-2026). La pantalla del motorizado (y de quien supervisa).
// Calcado del flujo de MGG / Golden Touch: Por buscar → Tomar → Recogido (fotos) → Entregado
// en almacén (fotos) · o Cancelar con motivo. Pensada para el TELÉFONO: botones grandes,
// llamar / mapa / WhatsApp del proveedor a un toque, y el mensaje de cada paso listo para
// mandar por WhatsApp. La lógica vive en lib/delivery.ts; la base decide quién ve qué.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Linking, Image, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { useAuth } from '../context/AuthContext';
import { captureAndUploadPhoto, pickPhotoFromGalleryAndUpload } from '../lib/photo';
import {
  ESTADO_DELIVERY, MAX_FOTOS_DELIVERY, MOTIVOS_CANCELACION, enlaceLlamar, enlaceMapa, enlaceWhatsApp, esUrgente, fechaHoraVE,
  lineasItems, mensajeCancelado, mensajeEntregado, mensajeRecogido, mensajeTomado, montoTxt, minutosEntre, resumenPorDelivery,
  revisarCancelacion, revisarEntrega, separar,
} from '../lib/delivery';
import type { ListadoDelivery, PedidoDelivery } from '../lib/delivery';
import { cargarDelivery, guardarConfigDelivery, moverPedido, tomarPedido } from '../lib/deliveryDb';

type Pestana = 'buscar' | 'curso' | 'hechos';
/** El formulario abierto sobre una tarjeta. */
type Accion = { req: string; tipo: 'recogido' | 'entregado' | 'cancelar'; fotos: string[]; almacen: string; nota: string; motivo: string; detalle: string };

export default function DeliveryScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { fullName, moduleLevel } = useAuth();
  const yo = String(fullName ?? '').trim() || 'Delivery';
  const esAdminDelivery = moduleLevel('delivery') === 'full';

  const [datos, setDatos] = useState<ListadoDelivery | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('buscar');
  const [accion, setAccion] = useState<Accion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const enVuelo = useRef(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [ultimoMensaje, setUltimoMensaje] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try { setDatos(await cargarDelivery(7)); } catch (e: any) { setError(e?.message || 'No se pudieron cargar los pedidos.'); }
    finally { setCargando(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    cargar();
    const t = setInterval(cargar, 120_000); // se refresca solo cada 2 minutos mientras está abierta
    return () => clearInterval(t);
  }, [cargar]));

  const listas = useMemo(() => separar(datos?.pedidos ?? []), [datos]);
  // Al abrir: si tengo algo en curso, arranco ahí.
  useEffect(() => { if (listas.enCurso.some((p) => p.es_mio)) setPestana((x) => (x === 'buscar' ? 'curso' : x)); }, [listas.enCurso.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const abrirEnlace = (url: string | null) => { if (url) Linking.openURL(url).catch(() => toast.error('No se pudo abrir el enlace en este equipo.')); };

  // ── Acciones ──
  const tomar = async (p: PedidoDelivery) => {
    if (enVuelo.current) return;
    const ok = await confirm({ title: 'Tomar pedido', message: `¿Vas a buscar ${p.codigo ?? 'este pedido'} donde ${p.proveedor_nombre ?? 'el proveedor'}? Mientras lo tengas, nadie más lo puede tomar.`, confirmText: 'Tomar' });
    if (!ok) return;
    enVuelo.current = true; setOcupado(true);
    try {
      await tomarPedido(p.requerimiento_id);
      toast.success('Pedido tomado. ¡Buen viaje!');
      setUltimoMensaje(mensajeTomado(p, yo));
      setPestana('curso');
    } catch (e: any) { toast.error(e?.message || 'No se pudo tomar el pedido.'); }
    finally { enVuelo.current = false; setOcupado(false); cargar(); }
  };

  const abrirAccion = (p: PedidoDelivery, tipo: Accion['tipo']) => setAccion({ req: p.requerimiento_id, tipo, fotos: [], almacen: '', nota: '', motivo: '', detalle: '' });

  const agregarFoto = async (p: PedidoDelivery, via: 'camara' | 'galeria') => {
    if (!accion || accion.fotos.length >= MAX_FOTOS_DELIVERY) return;
    setSubiendoFoto(true);
    const r = via === 'camara' ? await captureAndUploadPhoto(p.requerimiento_id, 'delivery') : await pickPhotoFromGalleryAndUpload(p.requerimiento_id, 'delivery');
    setSubiendoFoto(false);
    if (r.ok && r.url) setAccion((a) => (a ? { ...a, fotos: [...a.fotos, r.url!] } : a));
    else if (r.error) toast.error(r.error);
  };

  const confirmarAccion = async (p: PedidoDelivery) => {
    if (!accion || !p.pedido_id || enVuelo.current) return;
    if (accion.tipo === 'entregado') { const e = revisarEntrega(accion.almacen); if (e) { toast.error(e); return; } }
    if (accion.tipo === 'cancelar') { const e = revisarCancelacion(accion.motivo, accion.detalle); if (e) { toast.error(e); return; } }
    enVuelo.current = true; setOcupado(true);
    try {
      await moverPedido(p.pedido_id, accion.tipo, { fotos: accion.fotos.length ? accion.fotos : undefined, almacen: accion.almacen, nota: accion.nota, motivo: accion.motivo, detalle: accion.detalle });
      const msg = accion.tipo === 'recogido' ? mensajeRecogido(p, p.repartidor_nombre ?? yo, accion.fotos.length)
        : accion.tipo === 'entregado' ? mensajeEntregado(p, p.repartidor_nombre ?? yo, accion.almacen.trim(), accion.nota, accion.fotos.length)
          : mensajeCancelado(p, p.repartidor_nombre ?? yo, accion.motivo, accion.detalle);
      setUltimoMensaje(msg);
      toast.success(accion.tipo === 'recogido' ? 'Listo: va al almacén.' : accion.tipo === 'entregado' ? 'Entregado en almacén. ¡Gracias!' : 'Pedido cancelado: queda libre para otro.');
      setAccion(null);
      if (accion.tipo !== 'recogido') setPestana('hechos');
    } catch (e: any) { toast.error(e?.message || 'No se guardó el paso.'); }
    finally { enVuelo.current = false; setOcupado(false); cargar(); }
  };

  const cambiarConfig = async (activo: boolean, verMonto: boolean) => {
    try { await guardarConfigDelivery(activo, verMonto); toast.success('Configuración guardada.'); } catch (e: any) { toast.error(e?.message || 'No se guardó.'); }
    cargar();
  };

  // ── Estilos ──
  const boton = (color: string, lleno = true) => ({ backgroundColor: lleno ? color : colors.surface, borderWidth: 1, borderColor: color, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: spacing.md, alignItems: 'center' as const, flexGrow: 1, opacity: ocupado ? 0.6 : 1 });
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 16, marginTop: 4 } as const;
  const chip = (on: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface });

  const tarjeta = (p: PedidoDelivery) => {
    const est = ESTADO_DELIVERY[p.estado];
    const items = lineasItems(p);
    const abierta = accion?.req === p.requerimiento_id ? accion : null;
    const puedoMover = p.es_mio || (datos?.supervisa && accion?.tipo === 'cancelar');
    return (
      <Card key={p.requerimiento_id}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flexShrink: 1 }}>{p.codigo ?? 'REQ'}</Text>
          {esUrgente(p) ? <Text style={{ color: '#fff', backgroundColor: colors.danger, borderRadius: 6, paddingHorizontal: 6, fontWeight: '900', fontSize: 11 }}>🚨 URGENTE</Text> : null}
          <Text style={{ marginLeft: 'auto', color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{est.emoji} {est.label}</Text>
        </View>
        {p.titulo ? <Text style={{ color: colors.text, fontSize: 13 }}>{p.titulo}</Text> : null}

        <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.text, fontWeight: '900' }}>🏭 {p.proveedor_nombre ?? 'Proveedor sin nombre'}</Text>
          {p.proveedor_direccion ? <Text style={{ color: colors.text, fontSize: 13 }}>📍 {p.proveedor_direccion}</Text> : <Text style={{ color: colors.warning, fontSize: 12 }}>⚠️ El proveedor no tiene dirección cargada en Compras.</Text>}
          {p.proveedor_telefono ? <Text style={{ color: colors.muted, fontSize: 12 }}>📞 {p.proveedor_telefono}</Text> : null}
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
            {enlaceLlamar(p.proveedor_telefono) ? <TouchableOpacity onPress={() => abrirEnlace(enlaceLlamar(p.proveedor_telefono))} style={boton(colors.success, false)}><Text style={{ color: colors.success, fontWeight: '900' }}>📞 Llamar</Text></TouchableOpacity> : null}
            {enlaceMapa(p.proveedor_direccion, p.proveedor_nombre) ? <TouchableOpacity onPress={() => abrirEnlace(enlaceMapa(p.proveedor_direccion, p.proveedor_nombre))} style={boton(colors.primary, false)}><Text style={{ color: colors.primary, fontWeight: '900' }}>🗺️ Mapa</Text></TouchableOpacity> : null}
            {p.proveedor_telefono ? <TouchableOpacity onPress={() => abrirEnlace(enlaceWhatsApp(p.proveedor_telefono))} style={boton('#25D366', false)}><Text style={{ color: '#128C7E', fontWeight: '900' }}>💬 WhatsApp</Text></TouchableOpacity> : null}
          </View>
        </View>

        {items.length ? (
          <View style={{ marginTop: spacing.sm }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>📦 QUÉ HAY QUE BUSCAR ({items.length})</Text>
            {items.map((l, i) => <Text key={i} style={{ color: colors.text, fontSize: 13 }}>{l}</Text>)}
          </View>
        ) : null}
        {p.monto != null ? <Text style={{ color: colors.text, fontWeight: '800', marginTop: 4 }}>💵 Monto: {montoTxt(p.monto)}</Text> : null}
        {p.nota ? <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic', marginTop: 2 }}>📝 {p.nota}</Text> : null}
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
          {[p.solicitante ? `Pidió: ${p.solicitante}` : '', p.area ? `Área: ${p.area}` : '', p.asignado_nombre && p.estado === 'por_tomar' ? `Asignado a: ${p.asignado_nombre}` : ''].filter(Boolean).join(' · ')}
        </Text>
        {p.estado === 'por_tomar' && p.ultimo_cancelado?.motivo ? <Text style={{ color: colors.warning, fontSize: 11 }}>⛔ Lo canceló {p.ultimo_cancelado.por ?? 'otro delivery'}: {p.ultimo_cancelado.motivo}</Text> : null}
        {p.repartidor_nombre && p.estado !== 'por_tomar' ? (
          <Text style={{ color: colors.muted, fontSize: 11 }}>🛵 {p.repartidor_nombre} · tomó {fechaHoraVE(p.aceptado_en)}{p.en_ruta_en ? ` · recogió ${fechaHoraVE(p.en_ruta_en)}` : ''}{p.entregado_en ? ` · entregó ${fechaHoraVE(p.entregado_en)} (${minutosEntre(p.aceptado_en, p.entregado_en) ?? '—'} min)` : ''}</Text>
        ) : null}
        {p.estado === 'entregado' ? <Text style={{ color: colors.success, fontSize: 12, fontWeight: '800' }}>🏬 {p.almacen_entrega}{p.nota_entrega ? ` · ${p.nota_entrega}` : ''} · El almacén confirma la recepción en Inventario.</Text> : null}
        {p.estado === 'cancelado' ? <Text style={{ color: colors.danger, fontSize: 12 }}>⛔ {p.motivo_cancel}{p.detalle_cancel ? ` · ${p.detalle_cancel}` : ''}</Text> : null}
        {[...p.fotos_recibo, ...p.fotos_entrega].length ? (
          <ScrollView horizontal style={{ marginTop: 4 }}>
            {[...p.fotos_recibo, ...p.fotos_entrega].map((u) => (
              <TouchableOpacity key={u} onPress={() => abrirEnlace(u)}><Image source={{ uri: u }} style={{ width: 56, height: 56, borderRadius: 6, marginRight: 4 }} /></TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {/* Botones según el paso */}
        {!abierta ? (
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
            {p.estado === 'por_tomar' && datos?.motorizado && datos.activo ? (
              <TouchableOpacity disabled={ocupado} onPress={() => tomar(p)} style={boton(colors.primary)}><Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 15 }}>🛵 Tomar pedido</Text></TouchableOpacity>
            ) : null}
            {p.es_mio && p.estado === 'aceptado' ? (
              <TouchableOpacity disabled={ocupado} onPress={() => abrirAccion(p, 'recogido')} style={boton(colors.primary)}><Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 15 }}>📦 Ya lo recogí</Text></TouchableOpacity>
            ) : null}
            {p.es_mio && (p.estado === 'aceptado' || p.estado === 'en_ruta') ? (
              <TouchableOpacity disabled={ocupado} onPress={() => abrirAccion(p, 'entregado')} style={boton(colors.success)}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>✅ Entregado en almacén</Text></TouchableOpacity>
            ) : null}
            {(p.es_mio || datos?.supervisa) && (p.estado === 'aceptado' || p.estado === 'en_ruta') ? (
              <TouchableOpacity disabled={ocupado} onPress={() => abrirAccion(p, 'cancelar')} style={boton(colors.danger, false)}><Text style={{ color: colors.danger, fontWeight: '900' }}>⛔ No puedo buscarlo</Text></TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* Formulario del paso */}
        {abierta && puedoMover !== false ? (
          <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md }}>
            <Text style={{ color: colors.text, fontWeight: '900' }}>
              {abierta.tipo === 'recogido' ? '📦 Recogido donde el proveedor' : abierta.tipo === 'entregado' ? '✅ Entregado en almacén' : '⛔ No puedo buscarlo'}
            </Text>
            {abierta.tipo !== 'cancelar' ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>📷 Fotos (opcional, hasta {MAX_FOTOS_DELIVERY}): {abierta.fotos.length}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                  <TouchableOpacity disabled={subiendoFoto || abierta.fotos.length >= MAX_FOTOS_DELIVERY} onPress={() => agregarFoto(p, 'camara')} style={boton(colors.primary, false)}><Text style={{ color: colors.primary, fontWeight: '900' }}>{subiendoFoto ? 'Subiendo…' : '📷 Cámara'}</Text></TouchableOpacity>
                  <TouchableOpacity disabled={subiendoFoto || abierta.fotos.length >= MAX_FOTOS_DELIVERY} onPress={() => agregarFoto(p, 'galeria')} style={boton(colors.primary, false)}><Text style={{ color: colors.primary, fontWeight: '900' }}>🖼️ Galería</Text></TouchableOpacity>
                </View>
                {abierta.fotos.length ? (
                  <ScrollView horizontal style={{ marginTop: 4 }}>
                    {abierta.fotos.map((u, i) => (
                      <TouchableOpacity key={u} onPress={() => setAccion((a) => (a ? { ...a, fotos: a.fotos.filter((_, j) => j !== i) } : a))}>
                        <Image source={{ uri: u }} style={{ width: 56, height: 56, borderRadius: 6, marginRight: 4 }} />
                        <Text style={{ color: colors.danger, fontSize: 10, textAlign: 'center' }}>✕ quitar</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : null}
              </>
            ) : null}
            {abierta.tipo === 'entregado' ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm }}>¿EN QUÉ ALMACÉN LO ENTREGASTE? *</Text>
                <TextInput value={abierta.almacen} onChangeText={(t) => setAccion((a) => (a ? { ...a, almacen: t } : a))} placeholder="Ej.: Almacén principal" placeholderTextColor={colors.muted} style={input} />
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm }}>NOTA (OPCIONAL)</Text>
                <TextInput value={abierta.nota} onChangeText={(t) => setAccion((a) => (a ? { ...a, nota: t } : a))} placeholder="Ej.: lo recibió Pedro" placeholderTextColor={colors.muted} style={input} />
              </>
            ) : null}
            {abierta.tipo === 'cancelar' ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm }}>¿POR QUÉ? *</Text>
                <View style={{ gap: 4, marginTop: 4 }}>
                  {MOTIVOS_CANCELACION.map((m) => (
                    <TouchableOpacity key={m} onPress={() => setAccion((a) => (a ? { ...a, motivo: m } : a))} style={chip(abierta.motivo === m)}>
                      <Text style={{ color: abierta.motivo === m ? colors.primaryContrast : colors.text, fontWeight: '700' }}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput value={abierta.detalle} onChangeText={(t) => setAccion((a) => (a ? { ...a, detalle: t } : a))} placeholder={abierta.motivo === 'Otro motivo' ? 'Escribe el motivo *' : 'Detalle (opcional)'} placeholderTextColor={colors.muted} style={input} />
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>El pedido queda libre para que otro delivery lo tome.</Text>
              </>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
              <TouchableOpacity disabled={ocupado || subiendoFoto} onPress={() => confirmarAccion(p)} style={boton(abierta.tipo === 'cancelar' ? colors.danger : colors.success)}>
                <Text style={{ color: '#fff', fontWeight: '900' }}>{ocupado ? 'Guardando…' : 'Confirmar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={ocupado} onPress={() => setAccion(null)} style={boton(colors.border, false)}><Text style={{ color: colors.text, fontWeight: '800' }}>Volver</Text></TouchableOpacity>
            </View>
          </View>
        ) : null}
      </Card>
    );
  };

  if (cargando && !datos) return <Loading />;
  const lista = pestana === 'buscar' ? listas.porBuscar : pestana === 'curso' ? listas.enCurso : listas.cerrados;
  const resumen = datos?.supervisa ? resumenPorDelivery(datos.pedidos) : [];

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} />}>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 20 }}>🛵 Delivery de compras</Text>
      {error ? (
        <Card>
          <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠️ {error}</Text>
          <TouchableOpacity onPress={cargar} style={{ marginTop: 4 }}><Text style={{ color: colors.danger, fontWeight: '800' }}>🔄 Reintentar</Text></TouchableOpacity>
        </Card>
      ) : null}
      {datos && !datos.activo ? (
        <Card><Text style={{ color: colors.warning, fontWeight: '800' }}>⏸️ El Delivery está APAGADO: los motorizados todavía no ven pedidos por buscar.{esAdminDelivery ? ' Actívalo abajo cuando estén listos.' : ' Lo activa el administrador.'}</Text></Card>
      ) : null}

      {/* El mensaje del último paso, listo para WhatsApp */}
      {ultimoMensaje ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800' }}>💬 Avísale a Compras por WhatsApp</Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }} numberOfLines={4}>{ultimoMensaje}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
            <TouchableOpacity onPress={() => { abrirEnlace(enlaceWhatsApp(null, ultimoMensaje)); setUltimoMensaje(null); }} style={boton('#25D366')}><Text style={{ color: '#fff', fontWeight: '900' }}>💬 Enviar por WhatsApp</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setUltimoMensaje(null)} style={boton(colors.border, false)}><Text style={{ color: colors.text, fontWeight: '800' }}>Ahora no</Text></TouchableOpacity>
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        {([['buscar', `💰 Por buscar (${listas.porBuscar.length})`], ['curso', `🛵 En curso (${listas.enCurso.length})`], ['hechos', `✅ Hechos (${listas.cerrados.length})`]] as const).map(([k, label]) => (
          <TouchableOpacity key={k} onPress={() => { setPestana(k); setAccion(null); }} style={[chip(pestana === k), { flex: 1, alignItems: 'center' }]}>
            <Text style={{ color: pestana === k ? colors.primaryContrast : colors.text, fontWeight: '900', fontSize: 12, textAlign: 'center' }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {pestana === 'hechos' ? <Text style={{ color: colors.muted, fontSize: 11 }}>Los entregados y cancelados de los últimos 7 días.</Text> : null}

      {lista.length === 0 ? (
        <EmptyState title={pestana === 'buscar' ? 'Nada por buscar' : pestana === 'curso' ? 'Nada en curso' : 'Sin pedidos cerrados'} subtitle={pestana === 'buscar' ? 'Aquí salen los requerimientos aprobados y ya PAGADOS que el almacén todavía no recibe.' : ''} />
      ) : lista.map(tarjeta)}

      {/* Quien supervisa: cuántos lleva cada delivery */}
      {datos?.supervisa && resumen.length ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900', marginBottom: 4 }}>📊 Por delivery (últimos 7 días)</Text>
          {resumen.map((r) => (
            <Text key={r.repartidor} style={{ color: colors.text, fontSize: 12 }}>🛵 {r.repartidor}: ✅ {r.entregados} · 🛵 {r.enCurso} · ⛔ {r.cancelados}{r.minutosPromedio != null ? ` · ⏳ ${r.minutosPromedio} min promedio` : ''}</Text>
          ))}
        </Card>
      ) : null}

      {/* Configuración (solo quien administra el Delivery) */}
      {esAdminDelivery && datos ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900' }}>⚙️ Configuración del Delivery</Text>
          <TouchableOpacity onPress={() => cambiarConfig(!datos.activo, datos.ver_monto)} style={[chip(datos.activo), { marginTop: spacing.xs }]}>
            <Text style={{ color: datos.activo ? colors.primaryContrast : colors.text, fontWeight: '800' }}>{datos.activo ? '✅ Activo: los motorizados ven los pedidos' : '⏸️ Apagado: toca para activarlo'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => cambiarConfig(datos.activo, !datos.ver_monto)} style={[chip(datos.ver_monto), { marginTop: spacing.xs }]}>
            <Text style={{ color: datos.ver_monto ? colors.primaryContrast : colors.text, fontWeight: '800' }}>{datos.ver_monto ? '💵 Los motorizados VEN el monto de la compra' : '🙈 Los motorizados NO ven el monto (toca para mostrarlo)'}</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Quien tiene Compras siempre ve el monto. Los motorizados se habilitan en Usuarios → permiso «Delivery (motorizados)».</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}
