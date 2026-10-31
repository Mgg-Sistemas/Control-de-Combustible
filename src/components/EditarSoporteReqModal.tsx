// ✏️ EDITAR FACTURA / COMPROBANTE DE UN REQUERIMIENTO (31-oct-2026)
// Desde la tarjeta del requerimiento se corrige lo que ya se subió: quitar la foto
// equivocada, agregar una o varias (cámara o galería/PDF) y corregir N°/fecha/nota.
// Guarda en el requerimiento (etiqueta de observaciones) y en la cuenta por pagar
// atada, SIN tocar estado ni monto. Quitar una foto solo la desvincula: el archivo
// sigue en el Storage.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, TextInput, Image } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { captureAndUploadPhoto, pickAndUploadDocFiles } from '../lib/photo';
import {
  extraerFactura,
  inyectarFacturaEnObservaciones,
  extraerReciboPago,
  inyectarReciboPagoEnObservaciones,
  type ArchivoSoporte,
} from '../lib/requerimientoExpediente';
import {
  extraerFacturaCuenta,
  inyectarFacturaEnCuentaNota,
  extraerReciboPagoCuenta,
  inyectarReciboPagoEnNota,
} from '../lib/cuentasPago';
import { anexarEventoHistorial } from '../lib/comprasHistorico';
import type { InventoryRequirement } from '../types/database';

export type TipoSoporteReq = 'factura' | 'comprobante';

export function EditarSoporteReqModal({
  req,
  tipo,
  archivosIniciales,
  proveedorNombre,
  onClose,
  onSaved,
}: {
  req: InventoryRequirement | null;
  tipo: TipoSoporteReq;
  /** Lo que la tarjeta muestra hoy (incluye la factura que solo estaba en la cuenta). */
  archivosIniciales: ArchivoSoporte[];
  proveedorNombre?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [archivos, setArchivos] = useState<ArchivoSoporte[]>([]);
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState('');
  const [metodo, setMetodo] = useState('');
  const [nota, setNota] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const esFactura = tipo === 'factura';

  useEffect(() => {
    if (!req) return;
    setArchivos(archivosIniciales);
    if (esFactura) {
      const f = extraerFactura(req);
      setNumero(f?.numero && f.numero !== 'ADJ-FACT' && f.numero !== 'S/N' ? f.numero : '');
      setFecha(f?.fecha || '');
      setNota(f?.nota || '');
      setMetodo('');
    } else {
      const r = extraerReciboPago(req);
      setNumero(r?.referencia || '');
      setFecha(r?.fecha || '');
      setMetodo(r?.metodo || '');
      setNota(r?.nota || '');
    }
  }, [req?.id, tipo]);

  if (!req) return null;
  const carpeta = esFactura ? `facturas/${req.id}` : `recibos_pago/${req.id}`;

  const agregar = async (origen: 'camara' | 'archivo') => {
    setSubiendo(true);
    try {
      if (origen === 'camara') {
        const r = await captureAndUploadPhoto(carpeta);
        if (r.ok && r.url) {
          setArchivos((prev) => [...prev, { url: r.url!, tipo: 'image', nombre: `Foto ${esFactura ? 'Factura' : 'Comprobante'} #${prev.length + 1}.jpg` }]);
        } else if (r.error) toast.error(r.error);
      } else {
        const r = await pickAndUploadDocFiles(esFactura ? 'facturas' : 'recibos_pago', req.id);
        if (r.ok && r.files?.length) {
          setArchivos((prev) => [...prev, ...r.files!.map((f) => ({ url: f.url, tipo: f.kind === 'pdf' ? ('pdf' as const) : ('image' as const), nombre: f.name || null }))]);
        } else if (r.error) toast.error(r.error);
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo subir el archivo.');
    } finally {
      setSubiendo(false);
    }
  };

  const guardar = async () => {
    if (archivos.length === 0) {
      const ok = await confirm({
        title: 'Sin archivos',
        message: `${esFactura ? 'La factura' : 'El comprobante'} quedará sin fotos ni PDF. Los archivos quitados no se borran del sistema, solo se desvinculan. ¿Guardar así?`,
        confirmText: 'Guardar',
      });
      if (!ok) return;
    }
    setGuardando(true);
    try {
      const ahora = new Date().toISOString();
      const { data: perfil } = await supabase.from('profiles').select('full_name').eq('id', session?.user?.id ?? '').maybeSingle();
      const autor = (perfil as any)?.full_name || session?.user?.email || 'Compras';
      const primera = archivos[0] || null;

      // Se relee el requerimiento: así no se pisa nada que otra persona haya guardado mientras tanto.
      const { data: fresco, error: eLeer } = await supabase.from('inventory_requirements').select('*').eq('id', req.id).maybeSingle();
      if (eLeer || !fresco) throw new Error(eLeer?.message || 'No se encontró el requerimiento.');
      const r0 = fresco as InventoryRequirement;

      let obs: string;
      if (esFactura) {
        const prev = extraerFactura(r0);
        obs = inyectarFacturaEnObservaciones(r0.observaciones, {
          numero: numero.trim() || prev?.numero || (primera ? 'ADJ-FACT' : 'S/N'),
          empresa: prev?.empresa || proveedorNombre || '',
          fecha: fecha.trim() || prev?.fecha || ahora.slice(0, 10),
          url: primera?.url || null,
          tipo: primera?.tipo || 'image',
          nombre: primera?.nombre || null,
          archivos,
          nota: nota.trim() || null,
          subidaPor: autor,
          subidaAt: ahora,
        });
      } else {
        const prev = extraerReciboPago(r0);
        obs = inyectarReciboPagoEnObservaciones(r0.observaciones, {
          ...(prev || {}),
          url: primera?.url || null,
          tipo: primera?.tipo || 'image',
          nombre: primera?.nombre || 'Comprobante de pago',
          archivos,
          referencia: numero.trim() || null,
          fecha: fecha.trim() || prev?.fecha || ahora.slice(0, 10),
          metodo: metodo.trim() || null,
          nota: nota.trim() || null,
          monto: prev?.monto ?? null,
          subidoPor: autor,
          subidoAt: ahora,
        });
      }
      const evento = {
        at: ahora,
        by: autor,
        byId: session?.user?.id ?? null,
        modulo: 'Requerimientos' as const,
        tipo: esFactura ? ('factura_adjuntada' as const) : ('condicion_actualizada' as const),
        titulo: `${esFactura ? 'Factura' : 'Comprobante de pago'} editado por ${autor}`,
        detalle: `${archivos.length} archivo(s)${numero.trim() ? ` · ${esFactura ? 'N°' : 'Ref'} ${numero.trim()}` : ''}`,
        reqId: req.id,
        reqCode: req.code,
      };
      obs = anexarEventoHistorial(obs, evento);

      // Nada de éxito falso: si la base no devuelve la fila, no se guardó.
      const { data: okReq, error: eReq } = await supabase.from('inventory_requirements').update({ observaciones: obs }).eq('id', req.id).select('id');
      if (eReq) throw eReq;
      if (!okReq || okReq.length === 0) throw new Error('La base no aceptó el cambio (¿permiso de Compras?).');

      // Cuenta por pagar atada: mismos archivos; estado y monto NO se tocan.
      let avisoCuenta = '';
      const { data: ctas } = await supabase.from('cuentas').select('id, nota, documento, factura_url').eq('inventory_requirement_id', req.id).limit(1);
      const cta = (ctas as any[] | null)?.[0];
      if (cta) {
        let patch: Record<string, any>;
        if (esFactura) {
          const prevCta = extraerFacturaCuenta(cta);
          patch = {
            nota: anexarEventoHistorial(
              inyectarFacturaEnCuentaNota(cta.nota, {
                numero: numero.trim() || prevCta?.numero || cta.documento || '',
                empresa: prevCta?.empresa || proveedorNombre || '',
                fecha: fecha.trim() || prevCta?.fecha || ahora.slice(0, 10),
                url: primera?.url || null,
                tipo: primera?.tipo || 'image',
                nombre: primera?.nombre || null,
                archivos,
                nota: nota.trim() || null,
                subidaPor: autor,
                subidaAt: ahora,
              }),
              evento
            ),
            factura_url: primera?.url || null,
            ...(numero.trim() ? { documento: numero.trim() } : {}),
            updated_at: ahora,
          };
        } else {
          const prevCta = extraerReciboPagoCuenta(cta);
          patch = {
            nota: anexarEventoHistorial(
              inyectarReciboPagoEnNota(cta.nota, {
                ...(prevCta || {}),
                url: primera?.url || null,
                tipo: primera?.tipo || 'image',
                nombre: primera?.nombre || 'Comprobante de pago',
                archivos,
                referencia: numero.trim() || null,
                fecha: fecha.trim() || prevCta?.fecha || ahora.slice(0, 10),
                metodo: metodo.trim() || null,
                nota: nota.trim() || null,
                subidoPor: autor,
                subidoAt: ahora,
              }),
              evento
            ),
            updated_at: ahora,
          };
        }
        const { data: okCta, error: eCta } = await supabase.from('cuentas').update(patch).eq('id', cta.id).select('id');
        if (eCta || !okCta || okCta.length === 0) avisoCuenta = ' (en Por Pagar no se pudo actualizar: revísalo allá)';
      }

      toast.success(`${esFactura ? 'Factura' : 'Comprobante'} actualizado${avisoCuenta}.`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(`No se guardó: ${e?.message ?? e}`);
    } finally {
      setGuardando(false);
    }
  };

  const inp = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.xs } as const;
  const lbl = { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginBottom: 2 };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', zIndex: 9999 }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%', maxWidth: 720, alignSelf: 'center', maxHeight: '92%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, flex: 1 }} numberOfLines={1}>
              {esFactura ? '🧾 Editar factura' : '💳 Editar comprobante'} · {req.code}
            </Text>
            <TouchableOpacity onPress={onClose} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.md }}>
            <Text style={lbl}>FOTOS / PDF ({archivos.length})</Text>
            {archivos.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Sin archivos. Agrega una o varias fotos.</Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
              {archivos.map((a, i) => (
                <View key={`${a.url}-${i}`} style={{ width: 104, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface }}>
                  {a.tipo === 'pdf' ? (
                    <View style={{ height: 80, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 30 }}>📄</Text></View>
                  ) : (
                    <Image source={{ uri: a.url }} style={{ width: '100%', height: 80 }} resizeMode="cover" />
                  )}
                  <Text style={{ color: colors.text, fontSize: 10, paddingHorizontal: 4, paddingTop: 2 }} numberOfLines={1}>#{i + 1} {a.nombre || ''}</Text>
                  <TouchableOpacity onPress={() => setArchivos((prev) => prev.filter((_, j) => j !== i))} style={{ paddingVertical: 4, alignItems: 'center' }}>
                    <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Quitar</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginBottom: spacing.sm }}>
              <TouchableOpacity disabled={subiendo} onPress={() => agregar('camara')} style={{ flexGrow: 1, minWidth: 140, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: 9, alignItems: 'center', opacity: subiendo ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12.5 }}>{subiendo ? '⏳ Subiendo…' : '📷 Tomar foto'}</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={subiendo} onPress={() => agregar('archivo')} style={{ flexGrow: 1, minWidth: 140, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: 9, alignItems: 'center', opacity: subiendo ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12.5 }}>{subiendo ? '⏳ Subiendo…' : '🖼️ Galería / PDF (varias)'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={lbl}>{esFactura ? 'N° DE FACTURA / CONTROL' : 'REFERENCIA'}</Text>
            <TextInput value={numero} onChangeText={setNumero} placeholder={esFactura ? 'Ej: 00001234' : 'Ej: 11112222'} placeholderTextColor={colors.muted} style={inp} />
            <Text style={lbl}>FECHA (AAAA-MM-DD)</Text>
            <TextInput value={fecha} onChangeText={setFecha} placeholder="2026-10-31" placeholderTextColor={colors.muted} style={inp} />
            {!esFactura ? (
              <>
                <Text style={lbl}>MÉTODO</Text>
                <TextInput value={metodo} onChangeText={setMetodo} placeholder="Transferencia, Pago móvil…" placeholderTextColor={colors.muted} style={inp} />
              </>
            ) : null}
            <Text style={lbl}>NOTA</Text>
            <TextInput value={nota} onChangeText={setNota} multiline placeholderTextColor={colors.muted} style={[inp, { minHeight: 56, textAlignVertical: 'top' }]} />
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              Se actualiza también en Por Pagar. El estado y el monto no cambian.
            </Text>
          </ScrollView>
          <TouchableOpacity disabled={guardando || subiendo} onPress={guardar} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: guardando || subiendo ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{guardando ? 'Guardando…' : 'Guardar cambios'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
