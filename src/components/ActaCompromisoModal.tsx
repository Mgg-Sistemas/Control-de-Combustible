// MODAL DE ACTA DE COMPROMISO Y ENTREGA DE HERRAMIENTAS / IMPLEMENTOS (04-nov-2026)
//
// Permite durante la entrevista / ingreso del empleado o desde su ficha en Empleados:
// 1. Registrar las herramientas, equipos y EPP entregados (con chips rápidos + filas manuales).
// 2. Revisar las 4 cláusulas obligatorias (uso adecuado, cuidado/custodia, aceptación de
//    responsabilidad y autorización expresa de deducción salarial por daño o extravío).
// 3. Firmar digitalmente en pantalla (trabajador y responsable) o adjuntar foto con
//    📷 Cámara / 🖼️ Galería.
// 4. Guardar el acta en el expediente (`employee_commitment_acts` en Supabase) e imprimir
//    el PDF con membrete, o imprimir planilla en blanco para llenado manual.
// 5. Consultar, reimprimir, reusar/editar o anular (`anulado = true`, nunca DELETE)
//    las actas anteriores del trabajador.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, Image } from 'react-native';
import { Employee, Company, CommitmentToolItem, EmployeeCommitmentAct } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { fullName } from '../lib/carnet';
import { MEMBRETES_CONSTANCIA, MEMBRETE_POR_DEFECTO } from '../lib/constancia';
import {
  HERRAMIENTAS_SUGERIDAS,
  actaCompromisoHtml,
  generarCodigoActaCompromiso,
  limpiarItemsActa,
  totalValorReposicionUsd,
} from '../lib/actaCompromiso';
import {
  listarActasCompromisoEmpleado,
  guardarActaCompromiso,
  anularActaCompromiso,
} from '../lib/actasCompromisoDb';
import { leerNumero } from '../lib/numeros';
import { exportPdf } from '../lib/pdf';
import { takePhotoAndUpload, pickPhotoAndUpload } from '../lib/photo';
import { SignaturePadModal } from './SignaturePadModal';

type EditableItem = {
  descripcion: string;
  cantidad: string;
  serial: string;
  estado: 'NUEVO' | 'BUENO' | 'USADO' | 'REPARADO';
  valor_reposicion_usd: string;
  observacion: string;
};

type Props = {
  visible: boolean;
  emp: Employee | null;
  companies: Company[];
  allEmployees?: Employee[];
  currentUserId?: string | null;
  currentUserName?: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

const ESTADOS_ITEM: Array<'NUEVO' | 'BUENO' | 'USADO' | 'REPARADO'> = ['NUEVO', 'BUENO', 'USADO', 'REPARADO'];

function emptyEditableItem(): EditableItem {
  return {
    descripcion: '',
    cantidad: '1',
    serial: '',
    estado: 'NUEVO',
    valor_reposicion_usd: '',
    observacion: '',
  };
}

export function ActaCompromisoModal({
  visible,
  emp,
  companies,
  allEmployees = [],
  currentUserId,
  currentUserName,
  onClose,
  onSaved,
}: Props) {
  const { colors: c } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();

  const [actasGuardadas, setActasGuardadas] = useState<EmployeeCommitmentAct[]>([]);
  const [loadingActas, setLoadingActas] = useState(false);
  const [saving, setSaving] = useState(false);

  // Estado del formulario actual
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actCode, setActCode] = useState('');
  const [actDate, setActDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lugar, setLugar] = useState('CAMURI CHICO, EDO. LA GUAIRA');
  const [membreteKey, setMembreteKey] = useState<string>(MEMBRETE_POR_DEFECTO.key);
  const [entregadoPorNombre, setEntregadoPorNombre] = useState('');
  const [entregadoPorCargo, setEntregadoPorCargo] = useState('ALMACÉN / SEGURIDAD INDUSTRIAL / RRHH');
  const [buscarEntregador, setBuscarEntregador] = useState('');
  const [items, setItems] = useState<EditableItem[]>([emptyEditableItem()]);
  const [clausulasAdicionales, setClausulasAdicionales] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [employeeSignatureUrl, setEmployeeSignatureUrl] = useState<string>('');
  const [delivererSignatureUrl, setDelivererSignatureUrl] = useState<string>('');
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Modal de firma digital
  const [sigTarget, setSigTarget] = useState<'worker' | 'deliverer' | null>(null);

  const cargarExpediente = async (employeeId: string) => {
    setLoadingActas(true);
    try {
      const rows = await listarActasCompromisoEmpleado(employeeId);
      setActasGuardadas(rows);
      return rows;
    } catch (e: any) {
      toast.error('Error cargando actas: ' + (e?.message || 'Error'));
      return [];
    } finally {
      setLoadingActas(false);
    }
  };

  const resetForm = (correlativo = 1) => {
    setEditingId(null);
    const hoy = new Date().toISOString().slice(0, 10);
    setActDate(hoy);
    setActCode(generarCodigoActaCompromiso(hoy, emp?.ficha, correlativo));
    setLugar('CAMURI CHICO, EDO. LA GUAIRA');
    setEntregadoPorNombre(currentUserName || '');
    setEntregadoPorCargo('ALMACÉN / SEGURIDAD INDUSTRIAL / RRHH');
    setItems([emptyEditableItem()]);
    setClausulasAdicionales('');
    setObservaciones('');
    setEmployeeSignatureUrl('');
    setDelivererSignatureUrl('');
    setPhotoUrl('');
  };

  useEffect(() => {
    if (visible && emp?.id) {
      cargarExpediente(emp.id).then((rows) => {
        resetForm((rows?.length || 0) + 1);
      });
    }
  }, [visible, emp?.id]);

  if (!visible || !emp) return null;

  const membrete = MEMBRETES_CONSTANCIA.find((m) => m.key === membreteKey) || MEMBRETE_POR_DEFECTO;
  const companyObj = companies.find((co) => co.id === emp.company_id) || null;

  const convertirItems = (): CommitmentToolItem[] => {
    const raw: CommitmentToolItem[] = items.map((it) => {
      const cant = leerNumero(it.cantidad);
      const val = leerNumero(it.valor_reposicion_usd);
      return {
        descripcion: it.descripcion,
        cantidad: cant !== null && cant > 0 ? cant : 1,
        serial: it.serial,
        estado: it.estado,
        valor_reposicion_usd: val !== null && val >= 0 ? val : null,
        observacion: it.observacion,
      };
    });
    return limpiarItemsActa(raw);
  };

  const totalReposicion = totalValorReposicionUsd(convertirItems());

  const agregarSugerido = (sug: CommitmentToolItem) => {
    setItems((prev) => {
      const limpias = prev.filter((p) => p.descripcion.trim() !== '');
      return [
        ...limpias,
        {
          descripcion: sug.descripcion,
          cantidad: String(sug.cantidad || 1),
          serial: sug.serial || '',
          estado: sug.estado || 'NUEVO',
          valor_reposicion_usd: sug.valor_reposicion_usd != null ? String(sug.valor_reposicion_usd) : '',
          observacion: sug.observacion || '',
        },
      ];
    });
  };

  const actualizarItem = (idx: number, patch: Partial<EditableItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const quitarItem = (idx: number) => {
    setItems((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length > 0 ? next : [emptyEditableItem()];
    });
  };

  const construirHtml = (blankTemplate = false) => {
    const cleanItems = blankTemplate ? [] : convertirItems();
    return actaCompromisoHtml(emp, companyObj, {
      act_code: actCode,
      act_date: actDate,
      lugar,
      entregado_por_nombre: entregadoPorNombre,
      entregado_por_cargo: entregadoPorCargo,
      items: cleanItems,
      clausulas_adicionales: clausulasAdicionales,
      observaciones,
      employee_signature_url: blankTemplate ? null : employeeSignatureUrl || null,
      deliverer_signature_url: blankTemplate ? null : delivererSignatureUrl || null,
       signed_at: employeeSignatureUrl ? new Date().toISOString() : null,
      membrete,
      blank_rows: 8,
    });
  };

  const handleGuardar = async (imprimirDespues: boolean) => {
    const cleanItems = convertirItems();
    if (cleanItems.length === 0) {
      toast.warn('Agrega al menos 1 herramienta o implemento entregado antes de guardar en el expediente (o usa «Imprimir planilla en blanco»).');
      return;
    }
    setSaving(true);
    try {
      const saved = await guardarActaCompromiso({
        id: editingId || undefined,
        employee_id: emp.id,
        company_id: emp.company_id || null,
        act_code: actCode || generarCodigoActaCompromiso(actDate, emp.ficha, actasGuardadas.length + 1),
        act_date: actDate || new Date().toISOString().slice(0, 10),
        lugar,
        entregado_por_nombre: entregadoPorNombre,
        entregado_por_cargo: entregadoPorCargo,
        items: cleanItems,
        clausulas_adicionales: clausulasAdicionales,
        autoriza_deduccion: true,
        employee_signature_url: employeeSignatureUrl || null,
        deliverer_signature_url: delivererSignatureUrl || null,
        photo_url: photoUrl || null,
        signed_at: employeeSignatureUrl ? new Date().toISOString() : null,
        status: employeeSignatureUrl ? 'firmada' : 'emitida',
        observaciones,
        created_by: currentUserId || null,
      });
      toast.ok(editingId ? 'Acta actualizada en el expediente' : 'Acta guardada en el expediente del trabajador');
      const rows = await cargarExpediente(emp.id);
      onSaved?.();
      if (imprimirDespues) {
        const html = actaCompromisoHtml(emp, companyObj, {
          act_code: saved.act_code,
          act_date: saved.act_date,
          lugar: saved.lugar,
          entregado_por_nombre: saved.entregado_por_nombre,
          entregado_por_cargo: saved.entregado_por_cargo,
          items: saved.items,
          clausulas_adicionales: saved.clausulas_adicionales,
          observaciones: saved.observaciones,
          employee_signature_url: saved.employee_signature_url,
          deliverer_signature_url: saved.deliverer_signature_url,
          signed_at: saved.signed_at,
          membrete,
        });
        await exportPdf(html, `Acta_Compromiso_${fullName(emp).replace(/\s+/g, '_')}`);
      }
      resetForm((rows?.length || 0) + 1);
    } catch (e: any) {
      toast.error('No se pudo guardar el acta: ' + (e?.message || 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const handleImprimirActaGuardada = async (acta: EmployeeCommitmentAct) => {
    const html = actaCompromisoHtml(emp, companyObj, {
      act_code: acta.act_code,
      act_date: acta.act_date,
      lugar: acta.lugar,
      entregado_por_nombre: acta.entregado_por_nombre,
      entregado_por_cargo: acta.entregado_por_cargo,
      items: acta.items || [],
      clausulas_adicionales: acta.clausulas_adicionales,
      observaciones: acta.observaciones,
      employee_signature_url: acta.employee_signature_url,
      deliverer_signature_url: acta.deliverer_signature_url,
      signed_at: acta.signed_at,
      membrete,
    });
    await exportPdf(html, `Acta_Compromiso_${acta.act_code || fullName(emp).replace(/\s+/g, '_')}`);
  };

  const handleCargarParaEditar = (acta: EmployeeCommitmentAct, comoNuevaCopia = false) => {
    setEditingId(comoNuevaCopia ? null : acta.id);
    const hoy = new Date().toISOString().slice(0, 10);
    setActDate(comoNuevaCopia ? hoy : acta.act_date || hoy);
    setActCode(
      comoNuevaCopia
        ? generarCodigoActaCompromiso(hoy, emp.ficha, actasGuardadas.length + 1)
        : acta.act_code || generarCodigoActaCompromiso(acta.act_date, emp.ficha, 1),
    );
    setLugar(acta.lugar || 'CAMURI CHICO, EDO. LA GUAIRA');
    setEntregadoPorNombre(acta.entregado_por_nombre || '');
    setEntregadoPorCargo(acta.entregado_por_cargo || 'ALMACÉN / SEGURIDAD INDUSTRIAL / RRHH');
    const loadedItems: EditableItem[] = (acta.items || []).map((it) => ({
      descripcion: it.descripcion || '',
      cantidad: String(it.cantidad || 1),
      serial: it.serial || '',
      estado: it.estado || 'NUEVO',
      valor_reposicion_usd: it.valor_reposicion_usd != null ? String(it.valor_reposicion_usd) : '',
      observacion: it.observacion || '',
    }));
    setItems(loadedItems.length > 0 ? loadedItems : [emptyEditableItem()]);
    setClausulasAdicionales(acta.clausulas_adicionales || '');
    setObservaciones(acta.observaciones || '');
    setEmployeeSignatureUrl(comoNuevaCopia ? '' : acta.employee_signature_url || '');
    setDelivererSignatureUrl(comoNuevaCopia ? '' : acta.deliverer_signature_url || '');
    setPhotoUrl(comoNuevaCopia ? '' : acta.photo_url || '');
    toast.ok(comoNuevaCopia ? 'Acta cargada como plantilla nueva' : `Editando acta ${acta.act_code || ''}`);
  };

  const handleAnular = async (acta: EmployeeCommitmentAct) => {
    const ok = await confirm({
      title: 'Anular acta de compromiso',
      message: `¿Anular el acta ${acta.act_code || ''} del ${acta.act_date}? Quedará oculta del expediente activo (no se borra de la base de datos).`,
      confirmLabel: 'Sí, anular',
      danger: true,
    });
    if (!ok) return;
    try {
      await anularActaCompromiso(acta.id, 'Anulada por usuario');
      toast.ok('Acta anulada');
      await cargarExpediente(emp.id);
      onSaved?.();
    } catch (e: any) {
      toast.error('No se pudo anular: ' + (e?.message || 'Error'));
    }
  };

  const handleEvidenciaFoto = async (source: 'camera' | 'gallery') => {
    setUploadingPhoto(true);
    try {
      const fn = source === 'camera' ? takePhotoAndUpload : pickPhotoAndUpload;
      const url = await fn(`actas_evidencia/${emp.id}_${Date.now()}`);
      if (url) {
        setPhotoUrl(url);
        toast.ok('Foto de soporte adjuntada');
      }
    } catch (e: any) {
      toast.error('Error subiendo foto: ' + (e?.message || 'Error'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const empleadosCoincidentes = buscarEntregador.trim()
    ? allEmployees
        .filter((e) => {
          const q = buscarEntregador.trim().toLowerCase();
          return (
            fullName(e).toLowerCase().includes(q) ||
            (e.cedula || '').toLowerCase().includes(q) ||
            (e.cargo || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 6)
    : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.75)',
          justifyContent: 'center',
          padding: spacing.md,
        }}
      >
        <View
          style={{
            backgroundColor: c.bgCard,
            borderRadius: radius.lg,
            padding: spacing.md,
            borderWidth: 1,
            borderColor: c.border,
            maxWidth: 820,
            width: '100%',
            alignSelf: 'center',
            maxHeight: '94%',
          }}
        >
          {/* CABECERA */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.primary, fontSize: 16, fontWeight: '900' }}>
                🤝 ACTA DE COMPROMISO Y ENTREGA DE HERRAMIENTAS / IMPLEMENTOS
              </Text>
              <Text style={{ color: c.text, fontSize: 13, fontWeight: '800', marginTop: 2 }}>
                {fullName(emp)} · C.I. {emp.cedula || '—'} · Ficha #{emp.ficha || '—'} · {(emp.cargo || 'SIN CARGO').toUpperCase()}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <Text style={{ color: c.textMuted, fontWeight: '800', fontSize: 12 }}>✕ CERRAR</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 620 }} showsVerticalScrollIndicator>
            {/* SECCIÓN 1: EXPEDIENTE DE ACTAS GUARDADAS DEL TRABAJADOR */}
            <View
              style={{
                backgroundColor: c.bgInput,
                borderRadius: radius.md,
                padding: 10,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 12,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>
                  📁 EXPEDIENTE DE ACTAS DEL TRABAJADOR ({actasGuardadas.length})
                </Text>
                {editingId ? (
                  <TouchableOpacity
                    onPress={() => resetForm(actasGuardadas.length + 1)}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: radius.sm,
                      backgroundColor: c.primary + '22',
                      borderWidth: 1,
                      borderColor: c.primary,
                    }}
                  >
                    <Text style={{ color: c.primary, fontSize: 10, fontWeight: '900' }}>+ NUEVA ACTA EN LIMPIO</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {loadingActas ? (
                <Text style={{ color: c.textMuted, fontSize: 11 }}>Cargando actas del expediente...</Text>
              ) : actasGuardadas.length === 0 ? (
                <Text style={{ color: c.textMuted, fontSize: 11 }}>
                  Este trabajador aún no tiene actas de compromiso registradas en su expediente.
                </Text>
              ) : (
                <View style={{ gap: 6 }}>
                  {actasGuardadas.map((a) => {
                    const cantItems = (a.items || []).reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);
                    const totalUsd = totalValorReposicionUsd(a.items || []);
                    return (
                      <View
                        key={a.id}
                        style={{
                          backgroundColor: c.bgCard,
                          borderRadius: radius.sm,
                          padding: 8,
                          borderWidth: 1,
                          borderColor: editingId === a.id ? c.primary : c.border,
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 200 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={{ color: c.text, fontWeight: '900', fontSize: 12 }}>
                              {a.act_code || 'ACTA'} · {a.act_date}
                            </Text>
                            <View
                              style={{
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 4,
                                backgroundColor: a.employee_signature_url ? '#16a34a22' : '#d9770622',
                              }}
                            >
                              <Text
                                style={{
                                  color: a.employee_signature_url ? '#16a34a' : '#d97706',
                                  fontSize: 9,
                                  fontWeight: '900',
                                }}
                              >
                                {a.employee_signature_url ? '✍️ FIRMADA DIGITAL' : '📄 EMITIDA'}
                              </Text>
                            </View>
                          </View>
                          <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 2 }}>
                            { (a.items || []).length } renglón(es) ({cantItems} und.)
                            {totalUsd > 0 ? ` · Valor reposición: $${totalUsd.toFixed(2)}` : ''}
                            {a.entregado_por_nombre ? ` · Entregó: ${a.entregado_por_nombre}` : ''}
                          </Text>
                          <Text style={{ color: c.text, fontSize: 10, marginTop: 2 }} numberOfLines={2}>
                            {(a.items || []).map((it) => `${it.cantidad}x ${it.descripcion}`).join(' · ')}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          <TouchableOpacity
                            onPress={() => handleImprimirActaGuardada(a)}
                            style={{
                              paddingHorizontal: 9,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              backgroundColor: c.primary,
                            }}
                          >
                            <Text style={{ color: '#081826', fontSize: 10, fontWeight: '900' }}>🖨️ PDF / REIMPRIMIR</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleCargarParaEditar(a, false)}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              backgroundColor: c.bgInput,
                              borderWidth: 1,
                              borderColor: c.border,
                            }}
                          >
                            <Text style={{ color: c.text, fontSize: 10, fontWeight: '800' }}>✎ EDITAR</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleCargarParaEditar(a, true)}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              backgroundColor: c.bgInput,
                              borderWidth: 1,
                              borderColor: c.border,
                            }}
                          >
                            <Text style={{ color: c.primary, fontSize: 10, fontWeight: '800' }}>📋 REUSAR</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleAnular(a)}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              backgroundColor: c.danger + '18',
                              borderWidth: 1,
                              borderColor: c.danger,
                            }}
                          >
                            <Text style={{ color: c.danger, fontSize: 10, fontWeight: '800' }}>🚫 ANULAR</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* SECCIÓN 2: DATOS DEL ENCABEZADO Y MEMBRETE */}
            <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>
              {editingId ? '✏️ EDITANDO ACTA SELECCIONADA' : '➕ NUEVA ACTA DE COMPROMISO Y ENTREGA'}
            </Text>

            <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '800', marginBottom: 4 }}>
              MEMBRETE DEL DOCUMENTO
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {MEMBRETES_CONSTANCIA.map((m) => {
                const active = membreteKey === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => setMembreteKey(m.key)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: active ? c.primary : c.border,
                      backgroundColor: active ? c.primary : c.bgInput,
                    }}
                  >
                    <Text style={{ color: active ? '#081826' : c.text, fontWeight: '800', fontSize: 11 }}>
                      {m.shortLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <View style={{ flex: 1, minWidth: 160 }}>
                <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '800', marginBottom: 3 }}>CÓDIGO DE ACTA</Text>
                <TextInput
                  value={actCode}
                  onChangeText={setActCode}
                  placeholder="ACTA-20261104-..."
                  placeholderTextColor={c.textMuted}
                  style={{
                    color: c.text,
                    backgroundColor: c.bgInput,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.md,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '800', marginBottom: 3 }}>FECHA DE ENTREGA</Text>
                <TextInput
                  value={actDate}
                  onChangeText={setActDate}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={c.textMuted}
                  style={{
                    color: c.text,
                    backgroundColor: c.bgInput,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.md,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    fontSize: 12,
                  }}
                />
              </View>
              <View style={{ flex: 1.5, minWidth: 200 }}>
                <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '800', marginBottom: 3 }}>LUGAR / OBRA</Text>
                <TextInput
                  value={lugar}
                  onChangeText={setLugar}
                  placeholder="CAMURI CHICO, EDO. LA GUAIRA"
                  placeholderTextColor={c.textMuted}
                  style={{
                    color: c.text,
                    backgroundColor: c.bgInput,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.md,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    fontSize: 12,
                  }}
                />
              </View>
            </View>

            {/* RESPONSABLE QUE ENTREGA */}
            <View
              style={{
                backgroundColor: c.bgInput,
                borderRadius: radius.md,
                padding: 8,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 10,
              }}
            >
              <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '800', marginBottom: 4 }}>
                👤 RESPONSABLE DE LA ENTREGA (ALMACÉN / RRHH / SUPERVISOR)
              </Text>
              {allEmployees.length > 0 ? (
                <View style={{ marginBottom: 6 }}>
                  <TextInput
                    value={buscarEntregador}
                    onChangeText={setBuscarEntregador}
                    placeholder="🔍 Buscar en el personal para autocompletar quién entrega..."
                    placeholderTextColor={c.textMuted}
                    style={{
                      color: c.text,
                      backgroundColor: c.bgCard,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 5,
                      fontSize: 11,
                    }}
                  />
                  {empleadosCoincidentes.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {empleadosCoincidentes.map((e) => (
                        <TouchableOpacity
                          key={e.id}
                          onPress={() => {
                            setEntregadoPorNombre(fullName(e).toUpperCase());
                            setEntregadoPorCargo((e.cargo || 'SUPERVISOR / ALMACÉN').toUpperCase());
                            setBuscarEntregador('');
                          }}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: radius.sm,
                            backgroundColor: c.primary + '22',
                            borderWidth: 1,
                            borderColor: c.primary,
                          }}
                        >
                          <Text style={{ color: c.primary, fontSize: 10, fontWeight: '800' }}>
                            + {fullName(e)} ({e.cargo || 'Sin cargo'})
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <TextInput
                  value={entregadoPorNombre}
                  onChangeText={setEntregadoPorNombre}
                  placeholder="Nombre y Apellido de quien entrega"
                  placeholderTextColor={c.textMuted}
                  style={{
                    flex: 1,
                    minWidth: 180,
                    color: c.text,
                    backgroundColor: c.bgCard,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.sm,
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    fontSize: 12,
                  }}
                />
                <TextInput
                  value={entregadoPorCargo}
                  onChangeText={setEntregadoPorCargo}
                  placeholder="Cargo (ej. Jefe de Almacén, RRHH)"
                  placeholderTextColor={c.textMuted}
                  style={{
                    flex: 1,
                    minWidth: 180,
                    color: c.text,
                    backgroundColor: c.bgCard,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.sm,
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    fontSize: 12,
                  }}
                />
              </View>
            </View>

            {/* SECCIÓN 3: HERRAMIENTAS / IMPLEMENTOS ENTREGADOS */}
            <View
              style={{
                backgroundColor: c.bgInput,
                borderRadius: radius.md,
                padding: 10,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 10,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900' }}>
                  🛠️ HERRAMIENTAS, EQUIPOS E IMPLEMENTOS ENTREGADOS
                </Text>
                {totalReposicion > 0 ? (
                  <Text style={{ color: c.text, fontSize: 11, fontWeight: '900' }}>
                    Total reposición: <Text style={{ color: c.primary }}>${totalReposicion.toFixed(2)} USD</Text>
                  </Text>
                ) : null}
              </View>

              <Text style={{ color: c.textMuted, fontSize: 10, marginBottom: 4 }}>
                Toca un implemento frecuente para agregarlo rápido o escríbelo abajo:
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {HERRAMIENTAS_SUGERIDAS.map((sug, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => agregarSugerido(sug)}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: radius.sm,
                      backgroundColor: c.bgCard,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text style={{ color: c.text, fontSize: 10, fontWeight: '700' }}>+ {sug.descripcion}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {items.map((it, idx) => (
                <View
                  key={idx}
                  style={{
                    backgroundColor: c.bgCard,
                    borderRadius: radius.sm,
                    padding: 8,
                    borderWidth: 1,
                    borderColor: c.border,
                    marginBottom: 6,
                  }}
                >
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Text style={{ color: c.primary, fontWeight: '900', fontSize: 11, width: 20 }}>{idx + 1}.</Text>
                    <TextInput
                      value={it.descripcion}
                      onChangeText={(v) => actualizarItem(idx, { descripcion: v })}
                      placeholder="Descripción de herramienta / equipo / EPP"
                      placeholderTextColor={c.textMuted}
                      style={{
                        flex: 2,
                        minWidth: 180,
                        color: c.text,
                        backgroundColor: c.bgInput,
                        borderWidth: 1,
                        borderColor: c.border,
                        borderRadius: radius.sm,
                        paddingHorizontal: 8,
                        paddingVertical: 5,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    />
                    <TextInput
                      value={it.cantidad}
                      onChangeText={(v) => actualizarItem(idx, { cantidad: v })}
                      placeholder="Cant."
                      keyboardType="decimal-pad"
                      placeholderTextColor={c.textMuted}
                      style={{
                        width: 58,
                        color: c.text,
                        backgroundColor: c.bgInput,
                        borderWidth: 1,
                        borderColor: c.border,
                        borderRadius: radius.sm,
                        paddingHorizontal: 6,
                        paddingVertical: 5,
                        fontSize: 12,
                        textAlign: 'center',
                      }}
                    />
                    <TextInput
                      value={it.serial}
                      onChangeText={(v) => actualizarItem(idx, { serial: v })}
                      placeholder="Serial / Marca / Talla"
                      placeholderTextColor={c.textMuted}
                      style={{
                        flex: 1,
                        minWidth: 120,
                        color: c.text,
                        backgroundColor: c.bgInput,
                        borderWidth: 1,
                        borderColor: c.border,
                        borderRadius: radius.sm,
                        paddingHorizontal: 8,
                        paddingVertical: 5,
                        fontSize: 11,
                      }}
                    />
                    <TextInput
                      value={it.valor_reposicion_usd}
                      onChangeText={(v) => actualizarItem(idx, { valor_reposicion_usd: v })}
                      placeholder="Valor $ (opc.)"
                      keyboardType="decimal-pad"
                      placeholderTextColor={c.textMuted}
                      style={{
                        width: 95,
                        color: c.text,
                        backgroundColor: c.bgInput,
                        borderWidth: 1,
                        borderColor: c.border,
                        borderRadius: radius.sm,
                        paddingHorizontal: 6,
                        paddingVertical: 5,
                        fontSize: 11,
                      }}
                    />
                    <TouchableOpacity
                      onPress={() => quitarItem(idx)}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 5,
                        borderRadius: radius.sm,
                        backgroundColor: c.danger + '18',
                      }}
                    >
                      <Text style={{ color: c.danger, fontSize: 11, fontWeight: '900' }}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '800' }}>Estado:</Text>
                    {ESTADOS_ITEM.map((est) => {
                      const act = it.estado === est;
                      return (
                        <TouchableOpacity
                          key={est}
                          onPress={() => actualizarItem(idx, { estado: est })}
                          style={{
                            paddingHorizontal: 7,
                            paddingVertical: 3,
                            borderRadius: 4,
                            backgroundColor: act ? c.primary : c.bgInput,
                            borderWidth: 1,
                            borderColor: act ? c.primary : c.border,
                          }}
                        >
                          <Text style={{ color: act ? '#081826' : c.textMuted, fontSize: 9, fontWeight: '900' }}>
                            {est}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    <TextInput
                      value={it.observacion}
                      onChangeText={(v) => actualizarItem(idx, { observacion: v })}
                      placeholder="Observación del ítem (opcional)"
                      placeholderTextColor={c.textMuted}
                      style={{
                        flex: 1,
                        minWidth: 150,
                        color: c.text,
                        backgroundColor: c.bgInput,
                        borderWidth: 1,
                        borderColor: c.border,
                        borderRadius: radius.sm,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        fontSize: 11,
                      }}
                    />
                  </View>
                </View>
              ))}

              <TouchableOpacity
                onPress={() => setItems((prev) => [...prev, emptyEditableItem()])}
                style={{
                  alignSelf: 'flex-start',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: radius.sm,
                  backgroundColor: c.primary + '22',
                  borderWidth: 1,
                  borderColor: c.primary,
                  marginTop: 2,
                }}
              >
                <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900' }}>+ AGREGAR OTRO RENGLÓN</Text>
              </TouchableOpacity>
            </View>

            {/* RESUMEN DE CLÁUSULAS INCLUIDAS EN EL DOCUMENTO */}
            <View
              style={{
                backgroundColor: c.bgInput,
                borderRadius: radius.md,
                padding: 10,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 10,
              }}
            >
              <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900', marginBottom: 4 }}>
                ⚖️ CLÁUSULAS LEGALES INCLUIDAS EN EL ACTA IMPRESA / DIGITAL
              </Text>
              <Text style={{ color: c.textMuted, fontSize: 10, lineHeight: 15 }}>
                • <Text style={{ color: c.text, fontWeight: '800' }}>PRIMERA (Uso adecuado):</Text> Uso exclusivo para labores asignadas, prohibido préstamo a terceros.{'\n'}
                • <Text style={{ color: c.text, fontWeight: '800' }}>SEGUNDA (Cuidado y custodia):</Text> Guarda segura y notificación inmediata de fallas al supervisor/almacén.{'\n'}
                • <Text style={{ color: c.text, fontWeight: '800' }}>TERCERA (Aceptación de responsabilidad):</Text> Devolución obligatoria al requerimiento o al finalizar relación laboral.{'\n'}
                • <Text style={{ color: c.text, fontWeight: '800' }}>CUARTA (Autorización de deducción salarial):</Text> Autorización expresa para descontar de salario, bonificaciones o liquidación el valor de reposición en caso de daño intencional, negligencia o extravío atribuible al trabajador.
              </Text>

              <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '800', marginTop: 8, marginBottom: 3 }}>
                CONDICIONES / CLÁUSULAS PARTICULARES ADICIONALES (OPCIONAL)
              </Text>
              <TextInput
                value={clausulasAdicionales}
                onChangeText={setClausulasAdicionales}
                multiline
                placeholder="Ej. El equipo de radio debe entregarse diariamente al finalizar el turno en garita..."
                placeholderTextColor={c.textMuted}
                style={{
                  color: c.text,
                  backgroundColor: c.bgCard,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: radius.sm,
                  padding: 8,
                  minHeight: 46,
                  textAlignVertical: 'top',
                  fontSize: 11,
                }}
              />

              <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '800', marginTop: 8, marginBottom: 3 }}>
                OBSERVACIONES GENERALES DE LA ENTREGA (OPCIONAL)
              </Text>
              <TextInput
                value={observaciones}
                onChangeText={setObservaciones}
                multiline
                placeholder="Observaciones adicionales..."
                placeholderTextColor={c.textMuted}
                style={{
                  color: c.text,
                  backgroundColor: c.bgCard,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: radius.sm,
                  padding: 8,
                  minHeight: 42,
                  textAlignVertical: 'top',
                  fontSize: 11,
                }}
              />
            </View>

            {/* SECCIÓN 4: FIRMAS DIGITALES Y FOTO DE SOPORTE (CÁMARA + GALERÍA) */}
            <View
              style={{
                backgroundColor: c.bgInput,
                borderRadius: radius.md,
                padding: 10,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 10,
              }}
            >
              <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>
                ✍️ FIRMA DIGITAL EN PANTALLA Y FOTO DE SOPORTE
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                {/* Firma del trabajador */}
                <View
                  style={{
                    flex: 1,
                    minWidth: 210,
                    backgroundColor: c.bgCard,
                    borderRadius: radius.sm,
                    padding: 8,
                    borderWidth: 1,
                    borderColor: employeeSignatureUrl ? '#16a34a' : c.border,
                  }}
                >
                  <Text style={{ color: c.text, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
                    Firma del Trabajador ({fullName(emp)})
                  </Text>
                  {employeeSignatureUrl ? (
                    <View style={{ alignItems: 'center', marginBottom: 6 }}>
                      <Image
                        source={{ uri: employeeSignatureUrl }}
                        style={{ width: 180, height: 65, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 4 }}
                      />
                    </View>
                  ) : (
                    <Text style={{ color: c.textMuted, fontSize: 10, marginBottom: 6 }}>
                      Sin firma digital registrada (puede firmar en pantalla o imprimir para firma en físico).
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => setSigTarget('worker')}
                      style={{
                        flex: 1,
                        paddingVertical: 6,
                        borderRadius: radius.sm,
                        backgroundColor: c.primary,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: '#081826', fontSize: 10, fontWeight: '900' }}>
                        ✍️ {employeeSignatureUrl ? 'CAMBIAR FIRMA' : 'FIRMAR EN PANTALLA'}
                      </Text>
                    </TouchableOpacity>
                    {employeeSignatureUrl ? (
                      <TouchableOpacity
                        onPress={() => setEmployeeSignatureUrl('')}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          borderRadius: radius.sm,
                          backgroundColor: c.danger + '22',
                        }}
                      >
                        <Text style={{ color: c.danger, fontSize: 10, fontWeight: '900' }}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                {/* Firma de quien entrega */}
                <View
                  style={{
                    flex: 1,
                    minWidth: 210,
                    backgroundColor: c.bgCard,
                    borderRadius: radius.sm,
                    padding: 8,
                    borderWidth: 1,
                    borderColor: delivererSignatureUrl ? '#16a34a' : c.border,
                  }}
                >
                  <Text style={{ color: c.text, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
                    Firma de Quien Entrega ({entregadoPorNombre || 'Responsable'})
                  </Text>
                  {delivererSignatureUrl ? (
                    <View style={{ alignItems: 'center', marginBottom: 6 }}>
                      <Image
                        source={{ uri: delivererSignatureUrl }}
                        style={{ width: 180, height: 65, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 4 }}
                      />
                    </View>
                  ) : (
                    <Text style={{ color: c.textMuted, fontSize: 10, marginBottom: 6 }}>
                      Sin firma digital registrada.
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => setSigTarget('deliverer')}
                      style={{
                        flex: 1,
                        paddingVertical: 6,
                        borderRadius: radius.sm,
                        backgroundColor: c.bgInput,
                        borderWidth: 1,
                        borderColor: c.primary,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: c.primary, fontSize: 10, fontWeight: '900' }}>
                        ✍️ {delivererSignatureUrl ? 'CAMBIAR FIRMA' : 'FIRMAR ENTREGA'}
                      </Text>
                    </TouchableOpacity>
                    {delivererSignatureUrl ? (
                      <TouchableOpacity
                        onPress={() => setDelivererSignatureUrl('')}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          borderRadius: radius.sm,
                          backgroundColor: c.danger + '22',
                        }}
                      >
                        <Text style={{ color: c.danger, fontSize: 10, fontWeight: '900' }}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>

              {/* Foto de evidencia (Cámara + Galería obligatorios) */}
              <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
                <Text style={{ color: c.textMuted, fontSize: 10, fontWeight: '800', marginBottom: 4 }}>
                  📸 FOTO DE EVIDENCIA (ENTREGA DE IMPLEMENTOS O ACTA FIRMADA EN FÍSICO):
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TouchableOpacity
                    disabled={uploadingPhoto}
                    onPress={() => handleEvidenciaFoto('camera')}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.sm,
                      backgroundColor: c.bgCard,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text style={{ color: c.text, fontSize: 11, fontWeight: '800' }}>📷 Cámara</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={uploadingPhoto}
                    onPress={() => handleEvidenciaFoto('gallery')}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.sm,
                      backgroundColor: c.bgCard,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text style={{ color: c.text, fontSize: 11, fontWeight: '800' }}>🖼️ Galería</Text>
                  </TouchableOpacity>
                  {photoUrl ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Image source={{ uri: photoUrl }} style={{ width: 42, height: 42, borderRadius: 4 }} />
                      <TouchableOpacity onPress={() => setPhotoUrl('')}>
                        <Text style={{ color: c.danger, fontSize: 11, fontWeight: '800' }}>Quitar foto</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </ScrollView>

          {/* BOTONES DE ACCIÓN INFERIORES */}
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              marginTop: 10,
              paddingTop: 10,
              borderTopWidth: 1,
              borderTopColor: c.border,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            <TouchableOpacity
              onPress={async () => {
                const html = construirHtml(true);
                await exportPdf(html, `Planilla_Acta_Compromiso_${fullName(emp).replace(/\s+/g, '_')}`);
              }}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: radius.md,
                backgroundColor: c.bgInput,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <Text style={{ color: c.textMuted, fontWeight: '800', fontSize: 11 }}>
                📄 IMPRIMIR PLANILLA EN BLANCO
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={saving}
              onPress={() => handleGuardar(false)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: radius.md,
                backgroundColor: c.bgInput,
                borderWidth: 1,
                borderColor: c.primary,
              }}
            >
              <Text style={{ color: c.primary, fontWeight: '900', fontSize: 11 }}>
                💾 {saving ? 'GUARDANDO...' : editingId ? 'GUARDAR CAMBIOS' : 'SOLO GUARDAR EN EXPEDIENTE'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={saving}
              onPress={() => handleGuardar(true)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: radius.md,
                backgroundColor: c.primary,
              }}
            >
              <Text style={{ color: '#081826', fontWeight: '900', fontSize: 11 }}>
                🖨️ {saving ? 'GUARDANDO...' : 'GUARDAR EN EXPEDIENTE E IMPRIMIR PDF'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* PIZARRA DE FIRMA DIGITAL */}
        <SignaturePadModal
          visible={sigTarget !== null}
          title={
            sigTarget === 'worker'
              ? `FIRMA DEL TRABAJADOR: ${fullName(emp).toUpperCase()}`
              : `FIRMA DE QUIEN ENTREGA: ${(entregadoPorNombre || 'RESPONSABLE').toUpperCase()}`
          }
          subtitle="Al firmar declara haber recibido los implementos y aceptar las cláusulas de uso, custodia y deducción por daño o extravío."
          folderKey={`actas_firmas/${emp.id}_${sigTarget || 'sig'}`}
          onClose={() => setSigTarget(null)}
          onSaveSignature={(uri) => {
            if (sigTarget === 'worker') setEmployeeSignatureUrl(uri);
            else if (sigTarget === 'deliverer') setDelivererSignatureUrl(uri);
          }}
        />
      </View>
    </Modal>
  );
}
