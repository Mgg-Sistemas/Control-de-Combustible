// ============================================================================
// 💼 MODAL DE CREACIÓN / EDICIÓN DE PRESUPUESTO DE MAQUINARIA
// ============================================================================
import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle } from './ui';
import { useToast } from './ToastProvider';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useBcvRate } from '../lib/bcv';
import { exportPdf } from '../lib/pdf';
import { Company, Contacto, Machinery } from '../types/database';
import {
  Presupuesto, PresupuestoItem, CondicionesAlquiler,
  UNIDADES_ALQUILER, PresupuestoEstado
} from '../types/presupuesto';
import {
  guardarPresupuesto, siguienteCorrelativoPresupuesto, condicionesPorDefecto
} from '../lib/presupuestosStorage';
import { presupuestoDocumentoHtml } from '../lib/presupuestoDocumento';

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

interface Props {
  visible: boolean;
  presupuesto?: Presupuesto | null;
  empresas: Company[];
  contactos: Contacto[];
  maquinaria: Machinery[];
  userName?: string | null;
  onClose: () => void;
  onGuardado: (p: Presupuesto) => void;
}

export function PresupuestoFormModal({
  visible,
  presupuesto,
  empresas,
  contactos,
  maquinaria,
  userName,
  onClose,
  onGuardado,
}: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const { rate } = useBcvRate();

  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState('PRES-0001');
  const [companyId, setCompanyId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientDoc, setClientDoc] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientContactPerson, setClientContactPerson] = useState('');
  const [projectName, setProjectName] = useState('');
  const [date, setDate] = useState(todayISO());
  const [validDays, setValidDays] = useState('7');
  const [status, setStatus] = useState<PresupuestoEstado>('emitido');
  const [statusNote, setStatusNote] = useState('');

  // Ítems y moneda
  const [items, setItems] = useState<PresupuestoItem[]>([]);
  const [conIva, setConIva] = useState(false);
  const [ivaPct, setIvaPct] = useState('16');

  // Condiciones de alquiler
  const [cond, setCond] = useState<CondicionesAlquiler>(condicionesPorDefecto());

  // Pickers modales
  const [showCliPicker, setShowCliPicker] = useState(false);
  const [searchCli, setSearchCli] = useState('');
  const [showMaqPickerIdx, setShowMaqPickerIdx] = useState<number | null>(null);
  const [searchMaq, setSearchMaq] = useState('');

  // Cargar datos al abrir o editar
  useEffect(() => {
    if (!visible) return;

    if (presupuesto) {
      setCode(presupuesto.code);
      setCompanyId(presupuesto.company_id || (empresas[0]?.id ?? ''));
      setClientId(presupuesto.client_id || '');
      setClientName(presupuesto.client_name || '');
      setClientDoc(presupuesto.client_doc || '');
      setClientPhone(presupuesto.client_phone || '');
      setClientEmail(presupuesto.client_email || '');
      setClientAddress(presupuesto.client_address || '');
      setClientContactPerson(presupuesto.client_contact_person || '');
      setProjectName(presupuesto.project_name || '');
      setDate(presupuesto.date || todayISO());
      setValidDays(String(presupuesto.conditions?.vigencia_dias || 7));
      setStatus(presupuesto.status || 'emitido');
      setStatusNote(presupuesto.status_note || '');
      setItems(presupuesto.items || []);
      setConIva(presupuesto.con_iva || false);
      setIvaPct(String(presupuesto.iva_pct || 16));
      setCond(presupuesto.conditions || condicionesPorDefecto());
    } else {
      // Nuevo presupuesto
      siguienteCorrelativoPresupuesto().then(setCode);
      setCompanyId(empresas[0]?.id || '');
      setClientId('');
      setClientName('');
      setClientDoc('');
      setClientPhone('');
      setClientEmail('');
      setClientAddress('');
      setClientContactPerson('');
      setProjectName('');
      setDate(todayISO());
      setValidDays('7');
      setStatus('emitido');
      setStatusNote('');
      setItems([]);
      setConIva(false);
      setIvaPct('16');
      setCond(condicionesPorDefecto());
    }
  }, [visible, presupuesto, empresas]);

  // Si elige cliente de contactos, autocompletar
  const handleSelectContacto = (c: Contacto) => {
    setClientId(c.id);
    setClientName(c.name);
    setClientDoc(c.doc_letter && c.doc_number ? `${c.doc_letter}-${c.doc_number}` : '');
    setClientPhone(c.phone || '');
    setClientEmail(c.email || '');
    setClientAddress(c.address || '');
    setShowCliPicker(false);
  };

  // Agregar nuevo renglón de maquinaria
  const handleAddItem = () => {
    const newItem: PresupuestoItem = {
      id: `it_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      machine_id: null,
      machine_code: null,
      description: '',
      unit: 'hora',
      qty: 1,
      unit_price: 0,
      subtotal: 0,
    };
    setItems((prev) => [...prev, newItem]);
  };

  const handleUpdateItem = (id: string, patch: Partial<PresupuestoItem>) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const updated = { ...it, ...patch };
        const q = Number(updated.qty) || 0;
        const p = Number(updated.unit_price) || 0;
        updated.subtotal = Math.round(q * p * 100) / 100;
        return updated;
      })
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  // Seleccionar máquina del catálogo para un renglón
  const handleSelectMachine = (maq: Machinery, itemIdx: number) => {
    const it = items[itemIdx];
    if (!it) return;

    const desc = `${maq.code}${maq.marca ? ` · ${maq.marca}` : ''}${maq.modelo ? ` ${maq.modelo}` : ''}${maq.clasificacion ? ` (${maq.clasificacion})` : ''}`;
    const suggestedPrice = (maq as any).price_per_hour ? Number((maq as any).price_per_hour) : it.unit_price;

    handleUpdateItem(it.id, {
      machine_id: maq.id,
      machine_code: maq.code,
      description: desc,
      unit_price: suggestedPrice > 0 ? suggestedPrice : it.unit_price,
    });
    setShowMaqPickerIdx(null);
  };

  // Totales
  const subtotal = useMemo(() => {
    return items.reduce((acc, it) => acc + (Number(it.subtotal) || 0), 0);
  }, [items]);

  const numIvaPct = Number(ivaPct) || 16;
  const ivaMonto = conIva ? Math.round(subtotal * (numIvaPct / 100) * 100) / 100 : 0;
  const total = Math.round((subtotal + ivaMonto) * 100) / 100;
  const rateBs = rate || 0;
  const totalBs = Math.round(total * rateBs * 100) / 100;

  const validUntil = useMemo(() => {
    const days = parseInt(validDays, 10) || 7;
    return addDaysISO(days);
  }, [validDays]);

  const empresaSeleccionada = empresas.find((e) => e.id === companyId) || empresas[0] || null;

  // Construir objeto Presupuesto completo
  const buildPresupuesto = (): Presupuesto => {
    return {
      id: presupuesto?.id || `pres_${Date.now()}`,
      code: code.trim() || 'PRES-0001',
      company_id: empresaSeleccionada?.id || '',
      company_name: empresaSeleccionada?.name || 'EMPRESA ARRENDADORA',
      company_rif: (empresaSeleccionada as any)?.rif || null,
      client_id: clientId || null,
      client_name: clientName.trim() || 'Cliente No Especificado',
      client_doc: clientDoc.trim() || null,
      client_phone: clientPhone.trim() || null,
      client_email: clientEmail.trim() || null,
      client_address: clientAddress.trim() || null,
      client_contact_person: clientContactPerson.trim() || null,
      project_name: projectName.trim() || null,
      date,
      valid_until: validUntil,
      items,
      subtotal,
      con_iva: conIva,
      iva_pct: numIvaPct,
      iva_monto: ivaMonto,
      total,
      rate_bs: rateBs,
      total_bs: totalBs,
      conditions: {
        ...cond,
        vigencia_dias: parseInt(validDays, 10) || 7,
      },
      status,
      status_note: statusNote.trim() || null,
      created_by: presupuesto?.created_by || null,
      created_by_name: presupuesto?.created_by_name || userName || null,
      created_at: presupuesto?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  const handleSave = async () => {
    if (!clientName.trim()) {
      toast.error('Indica el nombre o razón social del cliente.');
      return;
    }
    if (items.length === 0) {
      toast.error('Agrega al menos un equipo o servicio al presupuesto.');
      return;
    }
    setSaving(true);
    try {
      const p = buildPresupuesto();
      await guardarPresupuesto(p);
      toast.success(`Presupuesto ${p.code} guardado.`);
      onGuardado(p);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar el presupuesto.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportPreview = async () => {
    if (!clientName.trim()) {
      toast.error('Indica el cliente para generar la vista previa.');
      return;
    }
    const p = buildPresupuesto();
    const html = presupuestoDocumentoHtml(p);
    await exportPdf(html, `Presupuesto ${p.code} - ${p.client_name}`);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen bg={colors.background}>
        {/* Cabecera */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
          <View>
            <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>
              {presupuesto ? `Editar Presupuesto ${presupuesto.code}` : `Nuevo Presupuesto (${code})`}
            </Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>
              Cotización comercial de alquiler de maquinaria pesada
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity onPress={handleExportPreview} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>📄 PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted }}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
          {/* 1. Empresa emisora y correlativo */}
          <Card>
            <SectionTitle>1. Empresa Emisora y Correlativo</SectionTitle>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>Empresa del grupo que emite la oferta:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                {empresas.map((emp) => {
                  const sel = emp.id === companyId;
                  return (
                    <TouchableOpacity
                      key={emp.id}
                      onPress={() => setCompanyId(emp.id)}
                      style={{
                        paddingHorizontal: spacing.md,
                        paddingVertical: 7,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: sel ? colors.brand : colors.border,
                        backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '800', color: sel ? colors.brandContrast : colors.text }}>
                        {emp.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>N° de Presupuesto:</Text>
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="PRES-0001"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: 13, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Estado:</Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                    {(['borrador', 'emitido', 'aceptado', 'rechazado'] as PresupuestoEstado[]).map((st) => {
                      const on = st === status;
                      return (
                        <TouchableOpacity
                          key={st}
                          onPress={() => setStatus(st)}
                          style={{
                            flex: 1,
                            paddingVertical: 7,
                            borderRadius: radius.sm,
                            backgroundColor: on ? (st === 'aceptado' ? '#16A34A' : st === 'rechazado' ? '#DC2626' : colors.brand) : colors.surfaceAlt,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ fontSize: 10.5, fontWeight: '800', color: on ? '#fff' : colors.text, textTransform: 'capitalize' }}>
                            {st}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>
            </View>
          </Card>

          {/* 2. Datos del cliente y proyecto */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <SectionTitle>2. Datos del Cliente / Arrendatario</SectionTitle>
              <TouchableOpacity
                onPress={() => setShowCliPicker(true)}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.brand }}
              >
                <Text style={{ fontSize: 11, fontWeight: '800', color: colors.brandContrast }}>🔍 Buscar en Contactos</Text>
              </TouchableOpacity>
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 2 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Cliente / Razón Social *:</Text>
                  <TextInput
                    value={clientName}
                    onChangeText={setClientName}
                    placeholder="Ej. Consorcio Vial Minero C.A."
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: 13, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>RIF / C.I.:</Text>
                  <TextInput
                    value={clientDoc}
                    onChangeText={setClientDoc}
                    placeholder="J-12345678-9"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: 13, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Persona de Contacto / Atención:</Text>
                  <TextInput
                    value={clientContactPerson}
                    onChangeText={setClientContactPerson}
                    placeholder="Ej. Ing. Carlos Mendoza"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: 12, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Teléfono:</Text>
                  <TextInput
                    value={clientPhone}
                    onChangeText={setClientPhone}
                    placeholder="+58 414 1234567"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: 12, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Correo Electrónico:</Text>
                  <TextInput
                    value={clientEmail}
                    onChangeText={setClientEmail}
                    placeholder="contacto@cliente.com"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: 12, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Obra / Proyecto Destino:</Text>
                  <TextInput
                    value={projectName}
                    onChangeText={setProjectName}
                    placeholder="Ej. Sector Mina Sur / Terraplén"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: 12, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                  />
                </View>
              </View>
            </View>
          </Card>

          {/* 3. Renglones de Maquinaria y Equipos */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <SectionTitle>3. Equipos y Servicios Cotizados</SectionTitle>
              <TouchableOpacity
                onPress={handleAddItem}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.sm, backgroundColor: '#16A34A' }}
              >
                <Text style={{ fontSize: 11.5, fontWeight: '800', color: '#fff' }}>+ Agregar Equipo</Text>
              </TouchableOpacity>
            </View>

            {items.length === 0 ? (
              <View style={{ padding: spacing.md, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Aún no hay equipos en el presupuesto. Toca "+ Agregar Equipo".
                </Text>
              </View>
            ) : (
              <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
                {items.map((it, idx) => (
                  <View key={it.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, gap: spacing.xs }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: colors.brand }}>
                        Renglón #{idx + 1}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => setShowMaqPickerIdx(idx)}
                          style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                        >
                          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.text }}>🚜 Catálogo</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleRemoveItem(it.id)}
                          style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#FEE2E2' }}
                        >
                          <Text style={{ fontSize: 10, fontWeight: '800', color: '#DC2626' }}>✕ Quitar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Descripción */}
                    <TextInput
                      value={it.description}
                      onChangeText={(val) => handleUpdateItem(it.id, { description: val })}
                      placeholder="Descripción del equipo o servicio (ej. Excavadora CAT 320D)"
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 12, color: colors.text, backgroundColor: colors.surface }}
                    />

                    {/* Modalidad / Unidad (todas las opciones para cambiar libremente) */}
                    <View>
                      <Text style={{ fontSize: 10.5, fontWeight: '700', color: colors.muted, marginBottom: 3 }}>
                        Modalidad de Cobro / Unidad:
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
                        {UNIDADES_ALQUILER.map((u) => {
                          const isSel = it.unit === u.key;
                          return (
                            <TouchableOpacity
                              key={u.key}
                              onPress={() => handleUpdateItem(it.id, { unit: u.key })}
                              style={{
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: radius.pill,
                                borderWidth: 1,
                                borderColor: isSel ? colors.brand : colors.border,
                                backgroundColor: isSel ? colors.brand : colors.surface,
                              }}
                            >
                              <Text style={{ fontSize: 10.5, fontWeight: '700', color: isSel ? colors.brandContrast : colors.text }}>
                                {u.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                      {it.unit === 'personalizado' && (
                        <TextInput
                          value={it.unit_label || ''}
                          onChangeText={(val) => handleUpdateItem(it.id, { unit_label: val })}
                          placeholder="Especificar unidad personalizada (ej. Quincena, 100 horas...)"
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 11, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                        />
                      )}
                    </View>

                    {/* Cantidad y Tarifa */}
                    <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: colors.muted }}>Cant.:</Text>
                        <TextInput
                          value={String(it.qty)}
                          keyboardType="numeric"
                          onChangeText={(val) => handleUpdateItem(it.id, { qty: Number(val.replace(',', '.')) || 0 })}
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 12, color: colors.text, backgroundColor: colors.surface, textAlign: 'center' }}
                        />
                      </View>
                      <View style={{ flex: 1.5 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: colors.muted }}>Tarifa Unit. ($):</Text>
                        <TextInput
                          value={String(it.unit_price)}
                          keyboardType="numeric"
                          onChangeText={(val) => handleUpdateItem(it.id, { unit_price: Number(val.replace(',', '.')) || 0 })}
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 12, color: colors.text, backgroundColor: colors.surface, textAlign: 'right' }}
                        />
                      </View>
                      <View style={{ flex: 1.5, alignItems: 'flex-end', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 10, color: colors.muted }}>Subtotal:</Text>
                        <Text style={{ fontSize: 13, fontWeight: '900', color: colors.brand }}>
                          $ {it.subtotal.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Totales y Moneda */}
            <View style={{ marginTop: spacing.md, padding: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Subtotal Equipos:</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>$ {subtotal.toFixed(2)}</Text>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <TouchableOpacity onPress={() => setConIva(!conIva)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 14 }}>{conIva ? '☑️' : '⬜'}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>Incluir IVA (16%):</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 12, color: colors.muted }}>$ {ivaMonto.toFixed(2)}</Text>
              </View>

              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 2 }} />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '900', color: colors.text }}>TOTAL PRESUPUESTO:</Text>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#16A34A' }}>$ {total.toFixed(2)}</Text>
              </View>

              {rateBs > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Equivalente en Bs. (Tasa {rateBs.toFixed(2)}):</Text>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>Bs. {totalBs.toFixed(2)}</Text>
                </View>
              )}
            </View>
          </Card>

          {/* 4. Condiciones Comerciales y Operativas */}
          <Card>
            <SectionTitle>4. Términos y Condiciones del Alquiler</SectionTitle>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {/* Combustible */}
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>⛽ Suministro de Combustible:</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity
                      onPress={() => setCond({ ...cond, incluye_combustible: false })}
                      style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: !cond.incluye_combustible ? '#DC2626' : colors.surface }}
                    >
                      <Text style={{ fontSize: 10.5, fontWeight: '800', color: !cond.incluye_combustible ? '#fff' : colors.text }}>Por Cuenta del Cliente</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setCond({ ...cond, incluye_combustible: true })}
                      style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: cond.incluye_combustible ? '#16A34A' : colors.surface }}
                    >
                      <Text style={{ fontSize: 10.5, fontWeight: '800', color: cond.incluye_combustible ? '#fff' : colors.text }}>Incluido en Tarifa</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <TextInput
                  value={cond.detalle_combustible || ''}
                  onChangeText={(val) => setCond({ ...cond, detalle_combustible: val })}
                  placeholder="Detalle de suministro de combustible..."
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 11, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                />
              </View>

              {/* Operador */}
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>👷 Operador del Equipo:</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity
                      onPress={() => setCond({ ...cond, incluye_operador: true })}
                      style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: cond.incluye_operador ? '#16A34A' : colors.surface }}
                    >
                      <Text style={{ fontSize: 10.5, fontWeight: '800', color: cond.incluye_operador ? '#fff' : colors.text }}>Operador Incluido</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setCond({ ...cond, incluye_operador: false })}
                      style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: !cond.incluye_operador ? '#DC2626' : colors.surface }}
                    >
                      <Text style={{ fontSize: 10.5, fontWeight: '800', color: !cond.incluye_operador ? '#fff' : colors.text }}>Sin Operador (Seco)</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <TextInput
                  value={cond.detalle_operador || ''}
                  onChangeText={(val) => setCond({ ...cond, detalle_operador: val })}
                  placeholder="Detalle sobre operador, hospedaje o viáticos..."
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 11, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                />
              </View>

              {/* Mínimo garantizado y flete */}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Mín. Horas/Día:</Text>
                  <TextInput
                    value={cond.horas_minimas_dia != null ? String(cond.horas_minimas_dia) : ''}
                    keyboardType="numeric"
                    onChangeText={(val) => setCond({ ...cond, horas_minimas_dia: val ? Number(val) : null })}
                    placeholder="Ej. 8"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 12, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Vigencia Oferta (días):</Text>
                  <TextInput
                    value={validDays}
                    keyboardType="numeric"
                    onChangeText={setValidDays}
                    placeholder="7"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 12, color: colors.text, backgroundColor: colors.surface, marginTop: 4 }}
                  />
                </View>
              </View>

              {/* Mantenimiento y Forma de Pago */}
              <View>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Mantenimiento y Asistencia Técnica:</Text>
                <TextInput
                  value={cond.mantenimiento || ''}
                  onChangeText={(val) => setCond({ ...cond, mantenimiento: val })}
                  multiline
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, backgroundColor: colors.surface, marginTop: 4, minHeight: 45 }}
                />
              </View>

              <View>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Condición y Forma de Pago:</Text>
                <TextInput
                  value={cond.forma_pago || ''}
                  onChangeText={(val) => setCond({ ...cond, forma_pago: val })}
                  multiline
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, backgroundColor: colors.surface, marginTop: 4, minHeight: 45 }}
                />
              </View>

              <View>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Observaciones Adicionales:</Text>
                <TextInput
                  value={cond.observaciones_generales || ''}
                  onChangeText={(val) => setCond({ ...cond, observaciones_generales: val })}
                  placeholder="Cualquier aclaratoria especial para el cliente..."
                  multiline
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, backgroundColor: colors.surface, marginTop: 4, minHeight: 40 }}
                />
              </View>
            </View>
          </Card>

          {/* Botones de acción final */}
          <View style={{ flexDirection: 'row', gap: spacing.md, paddingBottom: spacing.xl }}>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={{
                flex: 2,
                backgroundColor: colors.brand,
                paddingVertical: 12,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '900', color: colors.brandContrast }}>
                {saving ? 'Guardando...' : '💾 Guardar Presupuesto'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleExportPreview}
              style={{
                flex: 1,
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
                paddingVertical: 12,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>📄 Ver PDF</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Screen>

      {/* Modal buscador de clientes */}
      <Modal visible={showCliPicker} animationType="slide" onRequestClose={() => setShowCliPicker(false)}>
        <Screen bg={colors.background}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>Seleccionar Cliente de Contactos</Text>
            <TouchableOpacity onPress={() => setShowCliPicker(false)}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.muted }}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>
          <View style={{ padding: spacing.sm }}>
            <TextInput
              value={searchCli}
              onChangeText={setSearchCli}
              placeholder="Buscar por nombre o número de documento..."
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: 13, color: colors.text, backgroundColor: colors.surface }}
            />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.sm, gap: spacing.xs }}>
            {contactos
              .filter((c) => {
                if (!searchCli) return true;
                const q = searchCli.toLowerCase();
                return (
                  c.name?.toLowerCase().includes(q) ||
                  c.doc_number?.includes(q)
                );
              })
              .map((c) => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => handleSelectContacto(c)}
                  style={{ padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>{c.name}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {c.doc_letter && c.doc_number ? `${c.doc_letter}-${c.doc_number}` : 'Sin documento'}
                    {c.phone ? ` · Tel: ${c.phone}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
        </Screen>
      </Modal>

      {/* Modal selector de maquinaria del catálogo */}
      <Modal visible={showMaqPickerIdx !== null} animationType="slide" onRequestClose={() => setShowMaqPickerIdx(null)}>
        <Screen bg={colors.background}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>Seleccionar Equipo del Catálogo</Text>
            <TouchableOpacity onPress={() => setShowMaqPickerIdx(null)}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.muted }}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>
          <View style={{ padding: spacing.sm }}>
            <TextInput
              value={searchMaq}
              onChangeText={setSearchMaq}
              placeholder="Buscar por código, marca o clasificación..."
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: 13, color: colors.text, backgroundColor: colors.surface }}
            />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.sm, gap: spacing.xs }}>
            {maquinaria
              .filter((m) => {
                if (!searchMaq) return true;
                const q = searchMaq.toLowerCase();
                return (
                  m.code?.toLowerCase().includes(q) ||
                  m.marca?.toLowerCase().includes(q) ||
                  m.modelo?.toLowerCase().includes(q) ||
                  m.clasificacion?.toLowerCase().includes(q)
                );
              })
              .map((m) => (
                <TouchableOpacity
                  key={m.id}
                  onPress={() => {
                    if (showMaqPickerIdx !== null) {
                      handleSelectMachine(m, showMaqPickerIdx);
                    }
                  }}
                  style={{ padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: colors.brand }}>{m.code}</Text>
                    {(m as any).price_per_hour ? (
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#16A34A' }}>${(m as any).price_per_hour}/h</Text>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {m.marca || ''} {m.modelo || ''} {m.clasificacion ? `· ${m.clasificacion}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
        </Screen>
      </Modal>
    </Modal>
  );
}
