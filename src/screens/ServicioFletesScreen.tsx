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
} from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { DateField } from '../components/DateField';
import { onlyDecimal, onlyDigits, norm } from '../lib/text';
import { caracasParts } from '../lib/jornada';
import {
  exportarComprobanteFlete,
  exportarReporteConsolidadoFletes,
  parseFleteNote,
  formatFleteNote,
  ParsedFleteNote,
} from '../lib/fletePdf';
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
  const [filterTipo, setFilterTipo] = useState<'todos' | 'pagar' | 'cobrar'>('todos');
  const [filterEstado, setFilterEstado] = useState<'todos' | 'pendiente' | 'completado'>('todos');
  const [searchQuery, setSearchQuery] = useState('');

  // Selector modal de máquina para filtro
  const [filterMachineModal, setFilterMachineModal] = useState(false);
  const [filterMachineQuery, setFilterMachineQuery] = useState('');

  // Modal Crear / Editar Flete
  const [modalVisible, setModalVisible] = useState(false);
  const [editingFleteId, setEditingFleteId] = useState<string | null>(null);
  const [formOperacionTipo, setFormOperacionTipo] = useState<'pagar' | 'cobrar'>('pagar');
  const [formOperacionEstado, setFormOperacionEstado] = useState<'pendiente' | 'completado'>('pendiente');
  const [formCliente, setFormCliente] = useState('');
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

  // Modal Importar desde Viajes de Camiones
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importDate, setImportDate] = useState(today);
  const [importMachineId, setImportMachineId] = useState<string | null>(null);
  const [importMachinePicker, setImportMachinePicker] = useState(false);
  const [importMachineQuery, setImportMachineQuery] = useState('');
  const [candidateViajes, setCandidateViajes] = useState<any[]>([]);
  const [loadingViajes, setLoadingViajes] = useState(false);
  const [selectedViajeIds, setSelectedViajeIds] = useState<string[]>([]);
  const [importPrecio, setImportPrecio] = useState('');
  const [importOperacionTipo, setImportOperacionTipo] = useState<'pagar' | 'cobrar'>('pagar');
  const [importCompanyId, setImportCompanyId] = useState('');
  const [importCliente, setImportCliente] = useState('');
  const [importNote, setImportNote] = useState('');
  const [importSaving, setImportSaving] = useState(false);

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

  // Set de todos los viajes que ya están asignados a algún flete
  const allAssignedViajeIds = useMemo(() => {
    const s = new Set<string>();
    fletes.forEach((f) => {
      const parsed = parseFleteNote(f.note);
      if (parsed.viajeIds && parsed.viajeIds.length > 0) {
        parsed.viajeIds.forEach((id) => s.add(id));
      }
    });
    return s;
  }, [fletes]);

  // Consultar viajes de camiones para la fecha y camión seleccionados
  const fetchCandidateViajes = useCallback(async (mId: string | null, dateStr: string) => {
    if (!mId) {
      setCandidateViajes([]);
      setSelectedViajeIds([]);
      return;
    }
    setLoadingViajes(true);
    try {
      const startIso = `${dateStr}T00:00:00-04:00`;
      const endIso = `${dateStr}T23:59:59-04:00`;

      let queryRes = await supabase
        .from('camion_viajes')
        .select('id, folio, registered_at, chofer_name, ubicacion_nombre, frente_nombre, peso_neto_kg, shift, note')
        .eq('machinery_id', mId)
        .gte('registered_at', startIso)
        .lte('registered_at', endIso)
        .order('registered_at', { ascending: true });

      if (queryRes.error && queryRes.error.code === '42703') {
        queryRes = await supabase
          .from('camion_viajes')
          .select('id, folio, registered_at, chofer_name, ubicacion_nombre, shift, note')
          .eq('machinery_id', mId)
          .gte('registered_at', startIso)
          .lte('registered_at', endIso)
          .order('registered_at', { ascending: true });
      }

      if (queryRes.error) throw queryRes.error;
      const list = queryRes.data || [];
      setCandidateViajes(list);
      // Preseleccionar los que no estén asignados
      const available = list.filter((v: any) => !allAssignedViajeIds.has(v.id)).map((v: any) => v.id);
      setSelectedViajeIds(available);
    } catch (err: any) {
      toast.error('Error al cargar viajes: ' + (err?.message || err));
      setCandidateViajes([]);
    } finally {
      setLoadingViajes(false);
    }
  }, [allAssignedViajeIds, toast]);

  // Abrir modal de importación
  const openImportModal = () => {
    const defMachine = (selectedMachineId !== '__all__' ? selectedMachineId : machinery[0]?.id) || null;
    const defComp = (defMachine ? machinery.find((m) => m.id === defMachine)?.company_id : companies[0]?.id) || companies[0]?.id || '';
    setImportDate(today);
    setImportMachineId(defMachine);
    setImportCompanyId(defComp);
    setImportPrecio('');
    setImportOperacionTipo('pagar');
    setImportCliente('');
    setImportNote('');
    setImportModalVisible(true);
    if (defMachine) {
      fetchCandidateViajes(defMachine, today);
    }
  };

  const handleSelectImportMachine = (mId: string) => {
    setImportMachineId(mId);
    const m = machinery.find((x) => x.id === mId);
    if (m?.company_id) {
      setImportCompanyId(m.company_id);
    }
    setImportMachinePicker(false);
    fetchCandidateViajes(mId, importDate);
  };

  const handleImportDateChange = (newDate: string) => {
    setImportDate(newDate);
    if (importMachineId) {
      fetchCandidateViajes(importMachineId, newDate);
    }
  };

  // Guardar flete importado desde viajes
  const saveImportedFlete = async () => {
    if (!importMachineId) {
      toast.error('Selecciona el camión de los viajes.');
      return;
    }
    if (!importCompanyId) {
      toast.error('Selecciona la empresa contratista.');
      return;
    }
    if (selectedViajeIds.length === 0) {
      toast.error('Debes seleccionar al menos un viaje para crear el flete.');
      return;
    }
    const precio = Math.max(0, Number(importPrecio.replace(',', '.')) || 0);
    if (precio <= 0) {
      toast.error('Indica un precio unitario válido por viaje.');
      return;
    }

    const selectedM = machinery.find((m) => m.id === importMachineId);
    const code = selectedM ? selectedM.code : 'General';

    const selectedObjs = candidateViajes.filter((v) => selectedViajeIds.includes(v.id));
    const tickets = selectedObjs.map((v) => v.folio || `ID-${v.id.slice(0, 6)}`);

    const fullNote = formatFleteNote({
      operacionTipo: importOperacionTipo,
      operacionEstado: 'pendiente',
      cliente: importCliente,
      detalle: importNote || `Flete importado desde ${selectedViajeIds.length} viaje(s) de camión`,
      viajeIds: selectedViajeIds,
      tickets,
    });

    setImportSaving(true);
    try {
      const { data, error } = await supabase
        .from('fletes')
        .insert({
          company_id: importCompanyId,
          machinery_id: importMachineId,
          code,
          flete_date: importDate,
          viajes: selectedViajeIds.length,
          precio,
          note: fullNote,
        })
        .select('*, company:company_id(id, name), machinery:machinery_id(id, code, plate, tipo)')
        .single();

      if (error) throw error;

      setFletes((prev) => [data, ...prev]);
      toast.success(`Flete registrado exitosamente con ${selectedViajeIds.length} viaje(s) vinculado(s).`);
      setImportModalVisible(false);
    } catch (err: any) {
      toast.error('Error al importar flete: ' + (err?.message || err));
    } finally {
      setImportSaving(false);
    }
  };

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

      // Metadata parseada (por pagar / por cobrar, estado, cliente)
      const parsed = parseFleteNote(f.note);

      // Filtro por tipo de operación (pagar o cobrar)
      if (filterTipo !== 'todos' && parsed.operacionTipo !== filterTipo) return false;

      // Filtro por estado (pendiente o completado)
      if (filterEstado !== 'todos' && parsed.operacionEstado !== filterEstado) return false;

      // Búsqueda de texto
      if (q) {
        const coName = norm(f.company?.name || '');
        const code = norm(f.code || f.machinery?.code || '');
        const plate = norm(f.machinery?.plate || '');
        const cli = norm(parsed.cliente || '');
        const note = norm(parsed.detalle || '');
        const match = coName.includes(q) || code.includes(q) || plate.includes(q) || cli.includes(q) || note.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [fletes, dateFrom, dateTo, selectedCompanyId, selectedMachineId, filterTipo, filterEstado, searchQuery]);

  // Totales de la selección actual
  const summary = useMemo(() => {
    const count = filteredFletes.length;
    const viajes = filteredFletes.reduce((s, f) => s + (Number(f.viajes) || 0), 0);

    let totalPagarUSD = 0;
    let totalCobrarUSD = 0;

    filteredFletes.forEach((f) => {
      const sub = (Number(f.viajes) || 0) * (Number(f.precio) || 0);
      const parsed = parseFleteNote(f.note);
      if (parsed.operacionTipo === 'cobrar') {
        totalCobrarUSD += sub;
      } else {
        totalPagarUSD += sub;
      }
    });

    return { count, viajes, totalPagarUSD, totalCobrarUSD };
  }, [filteredFletes]);

  // Abrir modal de nuevo flete
  const openNewModal = (defaultTipo?: 'pagar' | 'cobrar') => {
    setEditingFleteId(null);
    setFormOperacionTipo(defaultTipo || (filterTipo !== 'todos' ? filterTipo : 'pagar'));
    setFormOperacionEstado('pendiente');
    setFormCliente('');
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
    const parsed = parseFleteNote(f.note);
    setFormOperacionTipo(parsed.operacionTipo);
    setFormOperacionEstado(parsed.operacionEstado);
    setFormCliente(parsed.cliente || '');
    setFormCompanyId(f.company_id || '');
    setFormMachineId(f.machinery_id || null);
    setFormDate(f.flete_date || today);
    setFormViajes(f.viajes != null ? String(f.viajes) : '');
    setFormPrecio(f.precio != null ? String(f.precio) : '');
    setFormNote(parsed.detalle || '');
    setModalVisible(true);
  };

  // Alternar estado rápido (Pendiente <-> Completado/Pagado/Cobrado)
  const toggleEstadoFlete = async (f: FleteRow) => {
    const parsed = parseFleteNote(f.note);
    const nuevoEstado = parsed.operacionEstado === 'completado' ? 'pendiente' : 'completado';
    const nuevaNota = formatFleteNote({
      operacionTipo: parsed.operacionTipo,
      operacionEstado: nuevoEstado,
      cliente: parsed.cliente,
      detalle: parsed.detalle,
      viajeIds: parsed.viajeIds,
      tickets: parsed.tickets,
    });

    try {
      const { data, error } = await supabase
        .from('fletes')
        .update({ note: nuevaNota })
        .eq('id', f.id)
        .select('*, company:company_id(id, name), machinery:machinery_id(id, code, plate, tipo)')
        .single();

      if (error) throw error;
      setFletes((prev) => prev.map((x) => (x.id === f.id ? data : x)));
      toast.success(nuevoEstado === 'completado' ? 'Marcado como pagado/cobrado' : 'Marcado como pendiente');
    } catch (err: any) {
      toast.error('Error al cambiar estado: ' + (err?.message || err));
    }
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

    const origFlete = editingFleteId ? fletes.find((x) => x.id === editingFleteId) : null;
    const origParsed = origFlete ? parseFleteNote(origFlete.note) : null;

    const fullNote = formatFleteNote({
      operacionTipo: formOperacionTipo,
      operacionEstado: formOperacionEstado,
      cliente: formCliente,
      detalle: formNote,
      viajeIds: origParsed?.viajeIds,
      tickets: origParsed?.tickets,
    });

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
            note: fullNote,
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
            note: fullNote,
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
      const parsed = parseFleteNote(f.note);
      await exportarComprobanteFlete({
        flete: {
          id: f.id,
          flete_date: f.flete_date,
          viajes: Number(f.viajes) || 0,
          precio: Number(f.precio) || 0,
          code: f.code || m?.code,
          plate: m?.plate,
          tipo: m?.tipo,
          note: f.note,
          operacionTipo: parsed.operacionTipo,
          operacionEstado: parsed.operacionEstado,
          cliente: parsed.cliente,
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
        filterTipo,
        fletes: filteredFletes.map((f) => {
          const m = f.machinery || machinery.find((x) => x.id === f.machinery_id);
          const parsed = parseFleteNote(f.note);
          return {
            id: f.id,
            flete_date: f.flete_date,
            viajes: Number(f.viajes) || 0,
            precio: Number(f.precio) || 0,
            code: m?.code || f.code,
            plate: m?.plate,
            tipo: m?.tipo,
            note: f.note,
            operacionTipo: parsed.operacionTipo,
            operacionEstado: parsed.operacionEstado,
            cliente: parsed.cliente,
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
              Control integral de fletes por pagar (a fleteros/choferes) y por cobrar (a clientes/obras), por camión o flete individual en PDF.
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
                📑 Reporte Consolidado (PDF)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={openImportModal}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                backgroundColor: '#1E3A8A',
              }}
            >
              <Text style={{ color: '#ffffff', fontWeight: '800', fontSize: 13 }}>
                📥 Importar desde Viajes
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => openNewModal('pagar')}
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
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>Fletes Filtrados</Text>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{summary.count} ({summary.viajes} viajes)</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>💸 Total Por Pagar</Text>
            <Text style={{ color: '#1E3A8A', fontSize: 18, fontWeight: '800' }}>
              ${summary.totalPagarUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>💰 Total Por Cobrar</Text>
            <Text style={{ color: '#059669', fontSize: 18, fontWeight: '800' }}>
              ${summary.totalCobrarUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>
        </View>

        {/* Filtros */}
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {/* Selector de Tipo (Por Pagar vs Por Cobrar) */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity
              onPress={() => setFilterTipo('todos')}
              style={{
                flex: 1,
                paddingVertical: 7,
                alignItems: 'center',
                borderRadius: radius.md,
                backgroundColor: filterTipo === 'todos' ? colors.brand : colors.surfaceAlt,
                borderWidth: 1,
                borderColor: filterTipo === 'todos' ? colors.brand : colors.border,
              }}
            >
              <Text style={{ color: filterTipo === 'todos' ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                🔄 Todos los fletes
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setFilterTipo('pagar')}
              style={{
                flex: 1,
                paddingVertical: 7,
                alignItems: 'center',
                borderRadius: radius.md,
                backgroundColor: filterTipo === 'pagar' ? '#1E3A8A' : colors.surfaceAlt,
                borderWidth: 1,
                borderColor: filterTipo === 'pagar' ? '#1E3A8A' : colors.border,
              }}
            >
              <Text style={{ color: filterTipo === 'pagar' ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>
                💸 Por Pagar (Fleteros)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setFilterTipo('cobrar')}
              style={{
                flex: 1,
                paddingVertical: 7,
                alignItems: 'center',
                borderRadius: radius.md,
                backgroundColor: filterTipo === 'cobrar' ? '#059669' : colors.surfaceAlt,
                borderWidth: 1,
                borderColor: filterTipo === 'cobrar' ? '#059669' : colors.border,
              }}
            >
              <Text style={{ color: filterTipo === 'cobrar' ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>
                💰 Por Cobrar (Clientes)
              </Text>
            </TouchableOpacity>
          </View>

          {/* Selector de Estado */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity
              onPress={() => setFilterEstado('todos')}
              style={{
                flex: 1,
                paddingVertical: 6,
                alignItems: 'center',
                borderRadius: radius.md,
                backgroundColor: filterEstado === 'todos' ? colors.surfaceAlt : colors.surface,
                borderWidth: 1,
                borderColor: filterEstado === 'todos' ? colors.brand : colors.border,
              }}
            >
              <Text style={{ color: filterEstado === 'todos' ? colors.brandText : colors.muted, fontWeight: '700', fontSize: 11.5 }}>
                Todos los estados
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setFilterEstado('pendiente')}
              style={{
                flex: 1,
                paddingVertical: 6,
                alignItems: 'center',
                borderRadius: radius.md,
                backgroundColor: filterEstado === 'pendiente' ? '#FEF3C7' : colors.surface,
                borderWidth: 1,
                borderColor: filterEstado === 'pendiente' ? '#B45309' : colors.border,
              }}
            >
              <Text style={{ color: filterEstado === 'pendiente' ? '#92400E' : colors.muted, fontWeight: '700', fontSize: 11.5 }}>
                ⏳ Solo Pendientes
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setFilterEstado('completado')}
              style={{
                flex: 1,
                paddingVertical: 6,
                alignItems: 'center',
                borderRadius: radius.md,
                backgroundColor: filterEstado === 'completado' ? '#DCFCE7' : colors.surface,
                borderWidth: 1,
                borderColor: filterEstado === 'completado' ? '#166534' : colors.border,
              }}
            >
              <Text style={{ color: filterEstado === 'completado' ? '#166534' : colors.muted, fontWeight: '700', fontSize: 11.5 }}>
                ✅ Solo Pagados / Cobrados
              </Text>
            </TouchableOpacity>
          </View>

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
            placeholder="🔎 Buscar por código, placa, empresa, cliente, nota..."
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
            <Loading />
          ) : filteredFletes.length === 0 ? (
            <EmptyState
              title="No se encontraron fletes"
              subtitle="No hay registros de fletes para el rango o los filtros seleccionados."
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {filteredFletes.map((f) => {
                const m = f.machinery || machinery.find((x) => x.id === f.machinery_id);
                const co = f.company || companies.find((c) => c.id === f.company_id);
                const subtotal = (Number(f.viajes) || 0) * (Number(f.precio) || 0);
                const parsed = parseFleteNote(f.note);
                const esCobro = parsed.operacionTipo === 'cobrar';
                const esCompletado = parsed.operacionEstado === 'completado';

                return (
                  <View
                    key={f.id}
                    style={{
                      backgroundColor: colors.surface,
                      borderRadius: radius.md,
                      padding: spacing.md,
                      borderWidth: 1,
                      borderColor: esCobro ? '#A7F3D0' : '#BFDBFE',
                      gap: 6,
                    }}
                  >
                    {/* Header de la tarjeta */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <View style={{ backgroundColor: esCobro ? '#ECFDF5' : '#EFF6FF', paddingVertical: 2, paddingHorizontal: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: esCobro ? '#059669' : '#1E3A8A' }}>
                          <Text style={{ color: esCobro ? '#059669' : '#1E3A8A', fontWeight: '800', fontSize: 11 }}>
                            {esCobro ? '💰 POR COBRAR' : '💸 POR PAGAR'}
                          </Text>
                        </View>

                        <TouchableOpacity
                          onPress={() => toggleEstadoFlete(f)}
                          style={{
                            backgroundColor: esCompletado ? '#DCFCE7' : '#FEF3C7',
                            paddingVertical: 2,
                            paddingHorizontal: 6,
                            borderRadius: radius.sm,
                          }}
                        >
                          <Text style={{ color: esCompletado ? '#166534' : '#92400E', fontWeight: '800', fontSize: 11 }}>
                            {esCompletado ? `✅ ${esCobro ? 'COBRADO' : 'PAGADO'}` : '⏳ PENDIENTE'}
                          </Text>
                        </TouchableOpacity>

                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                          📅 {fmtDate(f.flete_date)}
                        </Text>
                      </View>

                      <Text style={{ color: esCobro ? '#059669' : '#1E3A8A', fontWeight: '800', fontSize: 16 }}>
                        ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </View>

                    {/* Camión / Maquinaria con Placa Obligatoria y Empresa */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                          {m ? `🚜 ${m.code}${m.plate ? ` · Placa: ${m.plate}` : ''}` : `🚚 ${f.code || 'Flete General'}`}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                          🏢 {co?.name || 'Empresa'} {m?.tipo ? `· 🏷️ ${m.tipo}` : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                          {f.viajes} viaje(s) × ${Number(f.precio).toLocaleString()} c/u
                        </Text>
                        {parsed.cliente ? (
                          <Text style={{ color: colors.brandText, fontSize: 11.5, fontWeight: '600' }}>
                            👤 Cliente: {parsed.cliente}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    {/* Nota si existe */}
                    {parsed.detalle ? (
                      <View style={{ backgroundColor: colors.surfaceAlt, padding: 6, borderRadius: radius.sm, marginTop: 2 }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontStyle: 'italic' }}>
                          📝 {parsed.detalle}
                        </Text>
                      </View>
                    ) : null}

                    {/* Badge de Viajes Vinculados si fue importado */}
                    {parsed.viajeIds && parsed.viajeIds.length > 0 && (
                      <View style={{ backgroundColor: '#F0FDF4', padding: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: '#86EFAC', marginTop: 4 }}>
                        <Text style={{ color: '#166534', fontSize: 12, fontWeight: '800' }}>
                          🚛 Vinculado a {parsed.viajeIds.length} viaje(s) de camión
                        </Text>
                        {parsed.tickets && parsed.tickets.length > 0 && (
                          <Text style={{ color: '#15803D', fontSize: 11.5, marginTop: 2 }}>
                            🎟️ Tickets: {parsed.tickets.join(', ')}
                          </Text>
                        )}
                      </View>
                    )}

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
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '92%', borderWidth: 1, borderColor: colors.border }}>
            <ScrollView>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginBottom: 2 }}>
                {editingFleteId ? '✏️ Modificar Flete' : '➕ Registrar Flete / Viaje'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: spacing.md }}>
                Define si el viaje es por pagar a un fletero o por cobrar a un cliente.
              </Text>

              {/* Selector Por Pagar vs Por Cobrar */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>Modalidad de Operación (*)</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.md }}>
                <TouchableOpacity
                  onPress={() => setFormOperacionTipo('pagar')}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    alignItems: 'center',
                    borderRadius: radius.md,
                    backgroundColor: formOperacionTipo === 'pagar' ? '#1E3A8A' : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: formOperacionTipo === 'pagar' ? '#1E3A8A' : colors.border,
                  }}
                >
                  <Text style={{ color: formOperacionTipo === 'pagar' ? '#fff' : colors.text, fontWeight: '800', fontSize: 12.5 }}>
                    💸 Por Pagar (A Fletero)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setFormOperacionTipo('cobrar')}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    alignItems: 'center',
                    borderRadius: radius.md,
                    backgroundColor: formOperacionTipo === 'cobrar' ? '#059669' : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: formOperacionTipo === 'cobrar' ? '#059669' : colors.border,
                  }}
                >
                  <Text style={{ color: formOperacionTipo === 'cobrar' ? '#fff' : colors.text, fontWeight: '800', fontSize: 12.5 }}>
                    💰 Por Cobrar (A Cliente)
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Estado de Pago / Cobro */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>Estado del Flete</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.md }}>
                <TouchableOpacity
                  onPress={() => setFormOperacionEstado('pendiente')}
                  style={{
                    flex: 1,
                    paddingVertical: 7,
                    alignItems: 'center',
                    borderRadius: radius.md,
                    backgroundColor: formOperacionEstado === 'pendiente' ? '#FEF3C7' : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: formOperacionEstado === 'pendiente' ? '#B45309' : colors.border,
                  }}
                >
                  <Text style={{ color: formOperacionEstado === 'pendiente' ? '#92400E' : colors.text, fontWeight: '700', fontSize: 12 }}>
                    ⏳ Pendiente
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setFormOperacionEstado('completado')}
                  style={{
                    flex: 1,
                    paddingVertical: 7,
                    alignItems: 'center',
                    borderRadius: radius.md,
                    backgroundColor: formOperacionEstado === 'completado' ? '#DCFCE7' : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: formOperacionEstado === 'completado' ? '#166534' : colors.border,
                  }}
                >
                  <Text style={{ color: formOperacionEstado === 'completado' ? '#166534' : colors.text, fontWeight: '700', fontSize: 12 }}>
                    ✅ {formOperacionTipo === 'cobrar' ? 'Cobrado' : 'Pagado'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Si es por cobrar, campo de cliente */}
              {formOperacionTipo === 'cobrar' ? (
                <View style={{ marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
                    👤 Cliente / Obra Facturable (opcional)
                  </Text>
                  <TextInput
                    value={formCliente}
                    onChangeText={setFormCliente}
                    placeholder="Ej. Inversiones El Carmen, C.A."
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      padding: spacing.md,
                      color: colors.text,
                      fontSize: 14,
                    }}
                  />
                </View>
              ) : null}

              {/* Selector Empresa */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
                🏢 Empresa Contratista / Proveedor (*)
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                {companies.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => {
                      setFormCompanyId(c.id);
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
                    <Text style={{ color: colors.text, fontWeight: '800' }}>
                      {formOperacionTipo === 'cobrar' ? 'Total a Cobrar:' : 'Total a Pagar:'}
                    </Text>
                    <Text style={{ color: formOperacionTipo === 'cobrar' ? '#059669' : '#1E3A8A', fontWeight: '800', fontSize: 18 }}>
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
                  backgroundColor: formOperacionTipo === 'cobrar' ? '#059669' : colors.brand,
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

      {/* Modal Importar Flete desde Viajes de Camiones */}
      <Modal visible={importModalVisible} transparent animationType="slide" onRequestClose={() => setImportModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '92%', borderWidth: 1, borderColor: colors.border }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginBottom: 2 }}>
                📥 Importar Flete desde Viajes de Camiones
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.md }}>
                Selecciona la fecha y el camión para vincular sus viajes registrados a un flete formal por pagar o por cobrar.
              </Text>

              {/* Selector de Fecha y Camión */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
                    📅 Fecha de los Viajes *
                  </Text>
                  <DateField value={importDate} onChange={handleImportDateChange} />
                </View>

                <View style={{ flex: 1.5, minWidth: 200 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
                    🚜 Camión / Volqueta *
                  </Text>
                  {(() => {
                    const selM = machinery.find((m) => m.id === importMachineId);
                    return (
                      <TouchableOpacity
                        onPress={() => { setImportMachineQuery(''); setImportMachinePicker(true); }}
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radius.md,
                          padding: spacing.md,
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: selM ? colors.text : colors.muted, fontSize: 13, fontWeight: '700' }}>
                          {selM ? `🚜 ${selM.code}${selM.plate ? ` · Placa: ${selM.plate}` : ' (Sin placa)'}` : 'Seleccionar camión...'}
                        </Text>
                        <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>🔍 Buscar</Text>
                      </TouchableOpacity>
                    );
                  })()}
                </View>
              </View>

              {/* Empresa Contratista */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, marginBottom: 4 }}>
                🏢 Empresa Contratista / Proveedora *
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                {companies.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setImportCompanyId(c.id)}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: radius.md,
                      backgroundColor: importCompanyId === c.id ? colors.brand : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: importCompanyId === c.id ? colors.brand : colors.border,
                      marginRight: 6,
                    }}
                  >
                    <Text style={{ color: importCompanyId === c.id ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Tipo de Operación (Por Pagar vs Por Cobrar) */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, marginBottom: 4 }}>
                🔄 Tipo de Operación Contable *
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => setImportOperacionTipo('pagar')}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: 'center',
                    borderRadius: radius.md,
                    backgroundColor: importOperacionTipo === 'pagar' ? '#1E3A8A' : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: importOperacionTipo === 'pagar' ? '#1E3A8A' : colors.border,
                  }}
                >
                  <Text style={{ color: importOperacionTipo === 'pagar' ? '#fff' : colors.text, fontWeight: '800', fontSize: 12 }}>
                    💸 Por Pagar (a Transportista)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setImportOperacionTipo('cobrar')}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: 'center',
                    borderRadius: radius.md,
                    backgroundColor: importOperacionTipo === 'cobrar' ? '#059669' : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: importOperacionTipo === 'cobrar' ? '#059669' : colors.border,
                  }}
                >
                  <Text style={{ color: importOperacionTipo === 'cobrar' ? '#fff' : colors.text, fontWeight: '800', fontSize: 12 }}>
                    💰 Por Cobrar (a Cliente / Obra)
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Cliente si es por cobrar */}
              {importOperacionTipo === 'cobrar' && (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
                    👤 Cliente / Obra / Destinatario *
                  </Text>
                  <TextInput
                    value={importCliente}
                    onChangeText={setImportCliente}
                    placeholder="Ej. Constructora ABC / Cantera Norte..."
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      padding: spacing.md,
                      color: colors.text,
                      fontSize: 14,
                    }}
                  />
                </View>
              )}

              {/* Lista de Viajes Candidatos */}
              <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                    📋 Viajes Registrados ({candidateViajes.length})
                  </Text>
                  {candidateViajes.length > 0 && (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => {
                          const avail = candidateViajes.filter((v) => !allAssignedViajeIds.has(v.id)).map((v) => v.id);
                          setSelectedViajeIds(avail);
                        }}
                        style={{ paddingVertical: 3, paddingHorizontal: 8, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>Todos</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setSelectedViajeIds([])}
                        style={{ paddingVertical: 3, paddingHorizontal: 8, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Ninguno</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {loadingViajes ? (
                  <View style={{ padding: spacing.md, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={colors.brand} />
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Buscando viajes del camión...</Text>
                  </View>
                ) : candidateViajes.length === 0 ? (
                  <View style={{ padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 12.5, textAlign: 'center' }}>
                      {importMachineId
                        ? 'No se encontraron viajes registrados para este camión en esta fecha.'
                        : 'Selecciona un camión para listar sus viajes.'}
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: 6, maxHeight: 220 }}>
                    <ScrollView nestedScrollEnabled>
                      {candidateViajes.map((v) => {
                        const isAssigned = allAssignedViajeIds.has(v.id);
                        const isSelected = selectedViajeIds.includes(v.id);
                        const hora = v.registered_at ? new Date(v.registered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                        const pesoTon = v.peso_neto_kg ? `${(Number(v.peso_neto_kg) / 1000).toFixed(2)} Ton` : null;

                        return (
                          <TouchableOpacity
                            key={v.id}
                            disabled={isAssigned}
                            onPress={() => {
                              if (isSelected) {
                                setSelectedViajeIds((prev) => prev.filter((id) => id !== v.id));
                              } else {
                                setSelectedViajeIds((prev) => [...prev, v.id]);
                              }
                            }}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: spacing.sm,
                              borderRadius: radius.md,
                              backgroundColor: isAssigned ? colors.surfaceAlt : isSelected ? '#EFF6FF' : colors.surface,
                              borderWidth: 1,
                              borderColor: isAssigned ? colors.border : isSelected ? colors.brand : colors.border,
                              marginBottom: 4,
                              opacity: isAssigned ? 0.6 : 1,
                            }}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                              <View
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 4,
                                  borderWidth: 1.5,
                                  borderColor: isAssigned ? colors.muted : isSelected ? colors.brand : colors.border,
                                  backgroundColor: isSelected ? colors.brand : 'transparent',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {isSelected && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>✓</Text>}
                              </View>
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                                    🎟️ {v.folio || `ID: ${v.id.slice(0, 6)}`}
                                  </Text>
                                  {v.shift && (
                                    <Text style={{ color: colors.muted, fontSize: 11 }}>({v.shift})</Text>
                                  )}
                                  <Text style={{ color: colors.muted, fontSize: 11 }}>⏰ {hora}</Text>
                                </View>
                                <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                                  👤 {v.chofer_name || 'Sin chofer'} · 📍 {v.frente_nombre || v.ubicacion_nombre || 'Destino general'}
                                  {pesoTon ? ` · ⚖️ ${pesoTon}` : ''}
                                </Text>
                              </View>
                            </View>

                            {isAssigned && (
                              <View style={{ backgroundColor: '#FEE2E2', paddingVertical: 2, paddingHorizontal: 6, borderRadius: radius.sm }}>
                                <Text style={{ color: '#DC2626', fontSize: 10.5, fontWeight: '800' }}>🔒 En Flete</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Configuración de Precio y Cálculo */}
              <View style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
                      Viajes Seleccionados:
                    </Text>
                    <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '900' }}>
                      {selectedViajeIds.length} viaje(s)
                    </Text>
                  </View>

                  <View style={{ flex: 1.2 }}>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', marginBottom: 2 }}>
                      Precio por Viaje ($) *
                    </Text>
                    <TextInput
                      value={importPrecio}
                      onChangeText={(t) => setImportPrecio(onlyDecimal(t))}
                      placeholder="0.00"
                      placeholderTextColor={colors.muted}
                      keyboardType="numeric"
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        padding: spacing.sm,
                        color: colors.text,
                        fontSize: 15,
                        fontWeight: '800',
                      }}
                    />
                  </View>
                </View>

                {/* Subtotal en tiempo real */}
                {(() => {
                  const p = Number(importPrecio.replace(',', '.')) || 0;
                  const total = selectedViajeIds.length * p;
                  return (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                        {importOperacionTipo === 'cobrar' ? 'Total a Cobrar:' : 'Total a Pagar:'}
                      </Text>
                      <Text style={{ color: importOperacionTipo === 'cobrar' ? '#059669' : '#1E3A8A', fontWeight: '900', fontSize: 18 }}>
                        ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                      </Text>
                    </View>
                  );
                })()}
              </View>

              {/* Observaciones opcionales */}
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, marginBottom: 4 }}>
                📝 Observaciones / Ruta (opcional)
              </Text>
              <TextInput
                value={importNote}
                onChangeText={setImportNote}
                placeholder="Ej. Flete correspondiente a viajes de agregados del día..."
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
                  minHeight: 50,
                }}
              />

              {/* Botón Guardar */}
              <TouchableOpacity
                onPress={saveImportedFlete}
                disabled={importSaving || selectedViajeIds.length === 0}
                style={{
                  marginTop: spacing.md,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  backgroundColor: importOperacionTipo === 'cobrar' ? '#059669' : colors.brand,
                  opacity: importSaving || selectedViajeIds.length === 0 ? 0.6 : 1,
                }}
              >
                <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 15 }}>
                  {importSaving ? 'Guardando Flete…' : `💾 Importar y Crear Flete (${selectedViajeIds.length} viajes)`}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setImportModalVisible(false)}
                style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Selector modal de máquina para Importación (con Placa y Buscador) */}
      <Modal visible={importMachinePicker} transparent animationType="fade" onRequestClose={() => setImportMachinePicker(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '80%', borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: spacing.sm }}>
              🚜 Seleccionar Camión para Importar Viajes
            </Text>
            <TextInput
              placeholder="🔍 Buscar por código, placa, tipo..."
              placeholderTextColor={colors.muted}
              value={importMachineQuery}
              onChangeText={setImportMachineQuery}
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
              {machinery
                .filter((m) => {
                  const q = norm(importMachineQuery);
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
                    onPress={() => handleSelectImportMachine(m.id)}
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
              onPress={() => setImportMachinePicker(false)}
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
