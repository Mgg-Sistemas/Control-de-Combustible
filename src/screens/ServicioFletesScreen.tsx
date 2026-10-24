import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { supabase, selectAllRows } from '../lib/supabase';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { DateField } from '../components/DateField';
import { onlyDecimal, onlyDigits, norm } from '../lib/text';
import { caracasParts } from '../lib/jornada';
import { exportarComprobanteFlete, exportarReporteConsolidadoFletes } from '../lib/fletePdf';
import { Machinery } from '../types/database';

interface FleteRow {
  id: string;
  company_id: string;
  machinery_id: string | null;
  code: string;
  flete_date: string;
  viajes: number;
  precio: number;
  note?: string | null;
  created_at?: string;
  company?: { id: string; name: string } | null;
  machinery?: { id: string; code: string; plate: string | null; tipo: string | null } | null;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export default function ServicioFletesScreen({ navigation }: any) {
  const { colors } = useTheme();
  const toast = useToast();
  const { role } = useAuth();

  const [loading, setLoading] = useState(true);
  const [fletes, setFletes] = useState<FleteRow[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [machinery, setMachinery] = useState<Machinery[]>([]);

  // Filtros
  const today = caracasParts(new Date()).iso;
  const thirtyDaysAgo = caracasParts(new Date(Date.now() - 30 * 86400000)).iso;

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('__all__');
  const [selectedMachineId, setSelectedMachineId] = useState<string>('__all__');
  const [searchQuery, setSearchQuery] = useState('');

  // Selector modal de máquina para filtro
  const [filterMachineModal, setFilterMachineModal] = useState(false);
  const [filterMachineQuery, setFilterMachineQuery] = useState('');

  // Modal Crear / Editar Flete
  const [modalVisible, setModalVisible] = useState(false);
  const [editingFleteId, setEditingFleteId] = useState<string | null>(null);
  const [formCompanyId, setFormCompanyId] = useState('');
  const [formMachineId, setFormMachineId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState(today);
  const [formViajes, setFormViajes] = useState('');
  const [formPrecio, setFormPrecio] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Selector modal de máquina en formulario
  const [formMachinePicker, setFormMachinePicker] = useState(false);
  const [formMachineQuery, setFormMachineQuery] = useState('');

  // Cargar datos
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [
        { data: fRows, error: fErr },
        { data: cRows, error: cErr },
        { data: mRows, error: mErr },
      ] = await Promise.all([
        supabase
          .from('fletes')
          .select('*, company:company_id(id, name), machinery:machinery_id(id, code, plate, tipo)')
          .order('flete_date', { ascending: false }),
        supabase.from('companies').select('id, name').order('name', { ascending: true }),
        supabase.from('machinery').select('*').order('code', { ascending: true }),
      ]);

      if (fErr) throw fErr;
      if (cErr) throw cErr;
      if (mErr) throw mErr;

      setFletes((fRows as any[]) || []);
      setCompanies((cRows as any[]) || []);
      setMachinery((mRows as any[]) || []);
    } catch (err: any) {
      toast.error('Error al cargar fletes: ' + (err?.message || err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lista de máquinas filtrables por empresa seleccionada
  const machinesForCompany = useMemo(() => {
    if (!formCompanyId) return machinery;
    return machinery.filter((m) => m.company_id === formCompanyId);
  }, [machinery, formCompanyId]);

  // Fletes filtrados
  const filteredFletes = useMemo(() => {
    const q = norm(searchQuery);
    return fletes.filter((f) => {
      // Rango de fechas
      if (dateFrom && f.flete_date < dateFrom) return false;
      if (dateTo && f.flete_date > dateTo) return false;

      // Filtro por empresa
      if (selectedCompanyId !== '__all__' && f.company_id !== selectedCompanyId) return false;

      // Filtro por camión
      if (selectedMachineId !== '__all__' && f.machinery_id !== selectedMachineId) return false;

      // Búsqueda de texto
      if (q) {
        const coName = norm(f.company?.name || '');
        const code = norm(f.code || f.machinery?.code || '');
        const plate = norm(f.machinery?.plate || '');
        const note = norm(f.note || '');
        const match = coName.includes(q) || code.includes(q) || plate.includes(q) || note.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [fletes, dateFrom, dateTo, selectedCompanyId, selectedMachineId, searchQuery]);

  // Totales de la selección actual
  const summary = useMemo(() => {
    const count = filteredFletes.length;
    const viajes = filteredFletes.reduce((s, f) => s + (Number(f.viajes) || 0), 0);
    const totalUSD = filteredFletes.reduce(
      (s, f) => s + (Number(f.viajes) || 0) * (Number(f.precio) || 0),
      0
    );
    return { count, viajes, totalUSD };
  }, [filteredFletes]);

  // Abrir modal de nuevo flete
  const openNewModal = () => {
    setEditingFleteId(null);
    setFormCompanyId(selectedCompanyId !== '__all__' ? selectedCompanyId : (companies[0]?.id || ''));
    setFormMachineId(selectedMachineId !== '__all__' ? selectedMachineId : null);
    setFormDate(today);
    setFormViajes('');
    setFormPrecio('');
    setFormNote('');
    setModalVisible(true);
  };

  // Abrir modal de edición
  const openEditModal = (f: FleteRow) => {
    setEditingFleteId(f.id);
    setFormCompanyId(f.company_id || '');
    setFormMachineId(f.machinery_id || null);
    setFormDate(f.flete_date || today);
    setFormViajes(f.viajes != null ? String(f.viajes) : '');
    setFormPrecio(f.precio != null ? String(f.precio) : '');
    setFormNote(f.note || '');
    setModalVisible(true);
  };

  // Guardar flete
  const saveFlete = async () => {
    const viajes = Math.max(0, Math.round(Number(formViajes.replace(',', '.')) || 0));
    const precio = Math.max(0, Number(formPrecio.replace(',', '.')) || 0);

    if (!formCompanyId) {
      toast.error('Selecciona la empresa contratista.');
      return;
    }
    if (viajes <= 0 || precio <= 0) {
      toast.error('Indica el nº de viajes y el precio por viaje.');
      return;
    }

    const selectedM = machinery.find((m) => m.id === formMachineId);
    const code = selectedM ? selectedM.code : 'General';

    setFormSaving(true);
    try {
      if (editingFleteId) {
        const { data, error } = await supabase
          .from('fletes')
          .update({
            company_id: formCompanyId,
            machinery_id: formMachineId,
            code,
            flete_date: formDate,
            viajes,
            precio,
            note: formNote.trim() || null,
          })
          .eq('id', editingFleteId)
          .select('*, company:company_id(id, name), machinery:machinery_id(id, code, plate, tipo)')
          .single();

        if (error) throw error;

        setFletes((prev) => prev.map((x) => (x.id === editingFleteId ? data : x)));
        toast.success('Flete actualizado exitosamente.');
      } else {
        const { data, error } = await supabase
          .from('fletes')
          .insert({
            company_id: formCompanyId,
            machinery_id: formMachineId,
            code,
            flete_date: formDate,
            viajes,
            precio,
            note: formNote.trim() || null,
          })
          .select('*, company:company_id(id, name), machinery:machinery_id(id, code, plate, tipo)')
          .single();

        if (error) throw error;

        setFletes((prev) => [data, ...prev]);
        toast.success('Flete registrado exitosamente.');
      }
      setModalVisible(false);
    } catch (err: any) {
      toast.error('Error al guardar: ' + (err?.message || err));
    } finally {
      setFormSaving(false);
    }
  };

  // Eliminar flete
  const deleteFlete = async (id: string) => {
    try {
      const { error } = await supabase.from('fletes').delete().eq('id', id);
      if (error) throw error;
      setFletes((prev) => prev.filter((x) => x.id !== id));
      setDeleteConfirmId(null);
      toast.success('Flete eliminado.');
    } catch (err: any) {
      toast.error('Error al eliminar: ' + (err?.message || err));
    }
  };

  // Exportar Comprobante Individual (Por flete directamente)
  const imprimirComprobante = async (f: FleteRow) => {
    setPdfBusy(true);
    try {
      const coName = f.company?.name || 'Empresa';
      const m = f.machinery || machinery.find((x) => x.id === f.machinery_id);
      await exportarComprobanteFlete({
        flete: {
          id: f.id,
          flete_date: f.flete_date,
          viajes: Number(f.viajes) || 0,
          precio: Number(f.precio) || 0,
          code: f.code || m?.code,
          plate: m?.plate,
          tipo: m?.tipo,
        },
        companyName: coName,
        machineCode: m?.code || (f.code !== 'General' ? f.code : undefined),
        machinePlate: m?.plate,
        machineTipo: m?.tipo,
      });
    } catch (err: any) {
      toast.error('Error al generar PDF: ' + (err?.message || err));
    } finally {
      setPdfBusy(false);
    }
  };

  // Exportar Reporte Consolidado (Por Empresa, Por Camión o General)
  const imprimirReporteConsolidado = async () => {
    if (filteredFletes.length === 0) {
      toast.error('No hay fletes en la selección para exportar.');
      return;
    }
    setPdfBusy(true);
    try {
      const comp = companies.find((c) => c.id === selectedCompanyId);
      const mach = machinery.find((m) => m.id === selectedMachineId);

      const coName = comp ? comp.name : (selectedMachineId !== '__all__' && mach?.company_id ? (companies.find((c) => c.id === mach.company_id)?.name || 'Varias empresas') : 'Todas las empresas');

      await exportarReporteConsolidadoFletes({
        companyName: coName,
        machineCode: mach?.code,
        machinePlate: mach?.plate,
        machineTipo: mach?.tipo,
        periodLabel: `${fmtDate(dateFrom)} al ${fmtDate(dateTo)}`,
        fletes: filteredFletes.map((f) => {
          const m = f.machinery || machinery.find((x) => x.id === f.machinery_id);
          return {
            id: f.id,
            flete_date: f.flete_date,
            viajes: Number(f.viajes) || 0,
            precio: Number(f.precio) || 0,
            code: m?.code || f.code,
            plate: m?.plate,
            tipo: m?.tipo,
          };
        }),
      });
    } catch (err: any) {
      toast.error('Error al generar reporte: ' + (err?.message || err));
    } finally {
      setPdfBusy(false);
    }
  };

  const selectedMachineObj = machinery.find((m) => m.id === selectedMachineId);

  return (
    <Screen>
      <Card>
        {/* Cabecera */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <SectionTitle>🚚 Servicio de Fletes y Viajes</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
              Control y liquidación de viajes por empresa contratista, por camión específico o individual con comprobantes en PDF.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            <TouchableOpacity
              onPress={imprimirReporteConsolidado}
              disabled={pdfBusy || filteredFletes.length === 0}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.brand,
                opacity: filteredFletes.length === 0 ? 0.5 : 1,
              }}
            >
              <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>
                📑 Reporte de Fletes (PDF)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={openNewModal}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.brand,
              }}
            >
              <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>
                ➕ Registrar Flete
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Panel de Métricas / KPIs */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.md,
            padding: spacing.md,
            marginTop: spacing.md,
            borderWidth: 1,
            borderColor: colors.border,
            flexWrap: 'wrap',
            gap: spacing.sm,
          }}
        >
          <View style={{ alignItems: 'flex-start' }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>Fletes Registrados</Text>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{summary.count}</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>Viajes Realizados</Text>
            <Text style={{ color: colors.brandText, fontSize: 18, fontWeight: '800' }}>{summary.viajes}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>Total Liquidado ($ USD)</Text>
            <Text style={{ color: colors.success, fontSize: 18, fontWeight: '800' }}>
              ${summary.totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>
        </View>

        {/* Filtros */}
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {/* Fechas */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>Desde</Text>
              <DateField value={dateFrom} onChange={(v) => v && setDateFrom(v)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>Hasta</Text>
              <DateField value={dateTo} onChange={(v) => v && setDateTo(v)} />
            </View>
            <TouchableOpacity
              onPress={() => { setDateFrom(thirtyDaysAgo); setDateTo(today); }}
              style={{ marginTop: 16, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>Últimos 30d</Text>
            </TouchableOpacity>
          </View>

          {/* Filtros por Empresa y por Camión */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {/* Empresa */}
            <View style={{ flex: 1, minWidth: 150 }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>Empresa Contratista</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => setSelectedCompanyId('__all__')}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: radius.md,
                    backgroundColor: selectedCompanyId === '__all__' ? colors.brand : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: selectedCompanyId === '__all__' ? colors.brand : colors.border,
                    marginRight: 6,
                  }}
                >
                  <Text style={{ color: selectedCompanyId === '__all__' ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>
                    🏢 Todas
                  </Text>
                </TouchableOpacity>
                {companies.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setSelectedCompanyId(c.id)}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: radius.md,
                      backgroundColor: selectedCompanyId === c.id ? colors.brand : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: selectedCompanyId === c.id ? colors.brand : colors.border,
                      marginRight: 6,
                    }}
                  >
                    <Text style={{ color: selectedCompanyId === c.id ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Selector de Camión con Placa */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => { setFilterMachineQuery(''); setFilterMachineModal(true); }}
              style={{
                flex: 1,
                padding: spacing.sm,
                borderRadius: radius.md,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: selectedMachineId !== '__all__' ? colors.brand : colors.border,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: selectedMachineId !== '__all__' ? colors.brandText : colors.text, fontSize: 13, fontWeight: '700' }}>
                🚜 Camión/Equipo: {selectedMachineObj ? `${selectedMachineObj.code}${selectedMachineObj.plate ? ` · Placa: ${selectedMachineObj.plate}` : ''}` : 'Todos los camiones'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>🔍 Cambiar</Text>
            </TouchableOpacity>

            {selectedMachineId !== '__all__' && (
              <TouchableOpacity
                onPress={() => setSelectedMachineId('__all__')}
                style={{ padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>Quitar filtro</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Buscador de texto libre */}
          <TextInput
            placeholder="🔎 Buscar por código, placa, empresa, nota..."
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              padding: spacing.sm,
              color: colors.text,
              fontSize: 13,
            }}
          />
        </View>

        {/* Lista de Fletes */}
        <View style={{ marginTop: spacing.lg }}>
          {loading ? (
            <Loading message="Cargando servicio de fletes..." />
          ) : filteredFletes.length === 0 ? (
            <EmptyState
              icon="🚚"
              title="No se encontraron fletes"
              description="No hay registros de fletes para el rango o los filtros seleccionados."
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {filteredFletes.map((f) => {
                const m = f.machinery || machinery.find((x) => x.id === f.machinery_id);
                const co = f.company || companies.find((c) => c.id === f.company_id);
                const subtotal = (Number(f.viajes) || 0) * (Number(f.precio) || 0);

                return (
                  <View
                    key={f.id}
                    style={{
                      backgroundColor: colors.surface,
                      borderRadius: radius.md,
                      padding: spacing.md,
                      borderWidth: 1,
                      borderColor: colors.border,
                      gap: 6,
                    }}
                  >
                    {/* Header de la tarjeta */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                          📅 {fmtDate(f.flete_date)}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>·</Text>
                        <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>
                          🏢 {co?.name || 'Empresa'}
                        </Text>
                      </View>
                      <Text style={{ color: colors.success, fontWeight: '800', fontSize: 15 }}>
                        ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </View>

                    {/* Camión / Maquinaria con Placa Obligatoria */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                          {m ? `🚜 ${m.code}${m.plate ? ` · Placa: ${m.plate}` : ''}` : `🚚 ${f.code || 'Flete General'}`}
                        </Text>
                        {m?.tipo ? (
                          <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                            🏷️ {m.tipo}
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                          {f.viajes} viaje(s) × ${Number(f.precio).toLocaleString()} c/u
                        </Text>
                      </View>
                    </View>

                    {/* Nota si existe */}
                    {f.note ? (
                      <View style={{ backgroundColor: colors.surfaceAlt, padding: 6, borderRadius: radius.sm, marginTop: 2 }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontStyle: 'italic' }}>
                          📝 {f.note}
                        </Text>
                      </View>
                    ) : null}

                    {/* Acciones */}
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs, marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <TouchableOpacity
                        disabled={pdfBusy}
                        onPress={() => imprimirComprobante(f)}
                        style={{
                          paddingVertical: 5,
                          paddingHorizontal: spacing.sm,
                          borderRadius: radius.sm,
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: colors.border,
                        }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                          📄 Comprobante (PDF)
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => openEditModal(f)}
                        style={{
                          paddingVertical: 5,
                          paddingHorizontal: spacing.sm,
                          borderRadius: radius.sm,
                          borderWidth: 1,
                          borderColor: colors.brand,
                        }}
                      >
                        <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>
                          ✏️ Editar
                        </Text>
                      </TouchableOpacity>

                      {deleteConfirmId === f.id ? (
                        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                          <TouchableOpacity
                            onPress={() => deleteFlete(f.id)}
                            style={{
                              paddingVertical: 5,
                              paddingHorizontal: spacing.sm,
                              borderRadius: radius.sm,
                              backgroundColor: colors.danger,
                            }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                              Sí, eliminar
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => setDeleteConfirmId(null)}
                            style={{
                              paddingVertical: 5,
                              paddingHorizontal: spacing.sm,
                              borderRadius: radius.sm,
                              borderWidth: 1,
                              borderColor: colors.border,
                            }}
                          >
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                              No
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => setDeleteConfirmId(f.id)}
                          style={{
                            paddingVertical: 5,
                            paddingHorizontal: spacing.sm,
                            borderRadius: radius.sm,
                            borderWidth: 1,
                            borderColor: colors.danger,
                          }}
                        >
                          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>
                            🗑 Eliminar
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </Card>

      {/* Modal: Filtro de Camión / Máquina */}
      <Modal visible={filterMachineModal} transparent animationType="fade" onRequestClose={() => setFilterMachineModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '80%', borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: spacing.sm }}>
              🚜 Seleccionar Camión o Maquinaria
            </Text>
            <TextInput
              placeholder="🔍 Buscar por código, placa, tipo..."
              placeholderTextColor={colors.muted}
              value={filterMachineQuery}
              onChangeText={setFilterMachineQuery}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.md,
                color: colors.text,
                fontSize: 14,
                marginBottom: spacing.sm,
              }}
            />
            <ScrollView>
              <TouchableOpacity
                onPress={() => { setSelectedMachineId('__all__'); setFilterMachineModal(false); }}
                style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '800' }}>Todos los camiones y equipos</Text>
              </TouchableOpacity>
              {machinery
                .filter((m) => {
                  const q = norm(filterMachineQuery);
                  if (!q) return true;
                  return (
                    norm(m.code || '').includes(q) ||
                    norm(m.plate || '').includes(q) ||
                    norm(m.tipo || '').includes(q)
                  );
                })
                .map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => { setSelectedMachineId(m.id); setFilterMachineModal(false); }}
                    style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                      🚜 {m.code} {m.plate ? `· Placa: ${m.plate}` : '· (Sin placa)'}
                    </Text>
                    {m.tipo && <Text style={{ color: colors.muted, fontSize: 11.5 }}>🏷️ {m.tipo}</Text>}
                  </TouchableOpacity>
                ))}
            </ScrollView>
            <TouchableOpacity
              onPress={() => setFilterMachineModal(false)}
              style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center' }}
            >
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: Registrar o Editar Flete */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '90%', borderWidth: 1, borderColor: colors.border }}>
            <ScrollView>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginBottom: 2 }}>
                {editingFleteId ? '✏️ Modificar Flete' : '➕ Registrar Flete / Viaje'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: spacing.md }}>
                Carga el flete indicando la empresa, camión, fecha, cantidad de viajes y precio.
              </Text>

              {/* Selector Empresa */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>🏢 Empresa Contratista (*)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                {companies.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => {
                      setFormCompanyId(c.id);
                      // Si la máquina actual no pertenece a esta empresa, resetear máquina
                      const curM = machinery.find((m) => m.id === formMachineId);
                      if (curM && curM.company_id !== c.id) {
                        setFormMachineId(null);
                      }
                    }}
                    style={{
                      paddingVertical: 7,
                      paddingHorizontal: 12,
                      borderRadius: radius.md,
                      backgroundColor: formCompanyId === c.id ? colors.brand : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: formCompanyId === c.id ? colors.brand : colors.border,
                      marginRight: 6,
                    }}
                  >
                    <Text style={{ color: formCompanyId === c.id ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Selector Camión con Placa */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>🚜 Camión / Maquinaria</Text>
              <TouchableOpacity
                onPress={() => { setFormMachineQuery(''); setFormMachinePicker(true); }}
                style={{
                  padding: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: formMachineId ? colors.brand : colors.border,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: spacing.sm,
                }}
              >
                {(() => {
                  const m = machinery.find((x) => x.id === formMachineId);
                  return (
                    <Text style={{ color: m ? colors.text : colors.muted, fontSize: 14, fontWeight: '700' }}>
                      {m ? `🚜 ${m.code}${m.plate ? ` · Placa: ${m.plate}` : ''}` : '🚚 Flete General (Sin camión específico)'}
                    </Text>
                  );
                })()}
                <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>Elegir</Text>
              </TouchableOpacity>

              {/* Fecha */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>📅 Fecha del Viaje</Text>
              <DateField value={formDate} onChange={(v) => v && setFormDate(v)} />

              {/* Viajes y Precio */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>Nº de Viajes</Text>
                  <TextInput
                    value={formViajes}
                    onChangeText={(t) => setFormViajes(onlyDigits(t))}
                    keyboardType="numeric"
                    inputMode="numeric"
                    placeholder="1"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      padding: spacing.md,
                      color: colors.text,
                      fontSize: 16,
                      marginTop: 4,
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>Precio por Viaje ($)</Text>
                  <TextInput
                    value={formPrecio}
                    onChangeText={(t) => setFormPrecio(onlyDecimal(t))}
                    keyboardType="numeric"
                    inputMode="decimal"
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      padding: spacing.md,
                      color: colors.text,
                      fontSize: 16,
                      marginTop: 4,
                    }}
                  />
                </View>
              </View>

              {/* Cálculo Total */}
              {(() => {
                const v = Number(formViajes.replace(',', '.')) || 0;
                const p = Number(formPrecio.replace(',', '.')) || 0;
                const tot = v * p;
                return (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>Total del Flete:</Text>
                    <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18 }}>
                      ${tot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </Text>
                  </View>
                );
              })()}

              {/* Nota / Ruta */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, marginBottom: 4 }}>
                📝 Detalle / Ruta / Observaciones (opcional)
              </Text>
              <TextInput
                value={formNote}
                onChangeText={setFormNote}
                placeholder="Ej. Traslado de agregados hacia Muelle Norte..."
                placeholderTextColor={colors.muted}
                multiline
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  color: colors.text,
                  fontSize: 13,
                  minHeight: 60,
                }}
              />

              {/* Botón Guardar */}
              <TouchableOpacity
                onPress={saveFlete}
                disabled={formSaving}
                style={{
                  marginTop: spacing.lg,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  backgroundColor: colors.brand,
                  opacity: formSaving ? 0.6 : 1,
                }}
              >
                <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 15 }}>
                  {formSaving ? 'Guardando…' : (editingFleteId ? '💾 Guardar Cambios' : '💾 Registrar Flete')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Selector modal de máquina en formulario */}
      <Modal visible={formMachinePicker} transparent animationType="fade" onRequestClose={() => setFormMachinePicker(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '80%', borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: spacing.sm }}>
              🚜 Asignar Camión / Maquinaria
            </Text>
            <TextInput
              placeholder="🔍 Buscar por código, placa, tipo..."
              placeholderTextColor={colors.muted}
              value={formMachineQuery}
              onChangeText={setFormMachineQuery}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.md,
                color: colors.text,
                fontSize: 14,
                marginBottom: spacing.sm,
              }}
            />
            <ScrollView>
              <TouchableOpacity
                onPress={() => { setFormMachineId(null); setFormMachinePicker(false); }}
                style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '800' }}>
                  🚚 Flete General (Sin camión específico)
                </Text>
              </TouchableOpacity>
              {machinesForCompany
                .filter((m) => {
                  const q = norm(formMachineQuery);
                  if (!q) return true;
                  return (
                    norm(m.code || '').includes(q) ||
                    norm(m.plate || '').includes(q) ||
                    norm(m.tipo || '').includes(q)
                  );
                })
                .map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => { setFormMachineId(m.id); setFormMachinePicker(false); }}
                    style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                      🚜 {m.code} {m.plate ? `· Placa: ${m.plate}` : '· (Sin placa)'}
                    </Text>
                    {m.tipo && <Text style={{ color: colors.muted, fontSize: 11.5 }}>🏷️ {m.tipo}</Text>}
                  </TouchableOpacity>
                ))}
            </ScrollView>
            <TouchableOpacity
              onPress={() => setFormMachinePicker(false)}
              style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center' }}
            >
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
