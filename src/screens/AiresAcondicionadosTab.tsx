// ============================================================================
// ❄️ AIRES ACONDICIONADOS — Control Riguroso y Preventivo (Base, Carbozulia y Flota/Maquinaria)
// ============================================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image, Platform, Linking } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { useTable } from '../hooks/useTable';
import { Company, Supplier, ServicioRecord, ServicioItem, Machinery, Vehicle, Cuenta } from '../types/database';
import { generalCompanies } from '../lib/companies';
import { pickAndUploadDocFile, pickAndUploadDocFiles, takeAndUploadDocPhoto } from '../lib/photo';
import { exportPdf } from '../lib/pdf';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { norm, onlyDecimal } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import { useBcvRate } from '../lib/bcv';
import {
  CONDICIONES_PAGO_CHIPS,
  detectarDiasCreditoChip,
  toggleChipCondicionPago,
  inyectarCondicionesPagoEnNota,
  extraerCondicionesPago,
  extraerIvaCuenta,
  inyectarIvaEnCuentaNota,
  extraerAprobacionCxp,
} from '../lib/cuentasPago';
import { inyectarEmpresaEnNota } from '../lib/cuentasEmpresa';
import {
  FormatoAdjunto,
  empaquetarFormatosEnObservaciones as inyectarFormatosEnNota,
} from '../lib/formatosAdjuntos';
import {
  AC_MASTER_CODE,
  AC_CATEGORIA_SERVICIO,
  AC_AREAS_SUGERIDAS,
  AC_BTU_OPCIONES,
  AC_CAPACIDAD_MAQUINARIA_OPCIONES,
  AC_TIPOS_EQUIPO,
  AC_FRECUENCIAS_DIAS,
  AC_FRECUENCIAS_PREVENTIVO_DIAS,
  AC_RESPONSABLES_PREVENTIVO,
  AC_TIPOS_INTERVENCION,
  AC_CHECKLIST_RIGUROSO,
  AcUnit,
  AcUnitCalc,
  AcSemaforo,
  AcTipoEquipo,
  AcEstadoOperativo,
  AcModoIva,
  AcMaintHistoryEntry,
  AcPresupuestoAdjunto,
  esEquipoMovilAc,
  extraerCatalogoAiresDeServicios,
  serializarCatalogoAiresParaServicios,
  calcularSemaforoAires,
  extraerPresupuestosDeServicioAc,
  separarDetalleLibreDeChecklist,
  limpiarNotaInterna,
  hoyAcISO,
  sumarDiasAc,
  fmtFechaAc,
  reporteAiresHtml,
  aplicarFichaUnidadAc,
  cuentaEsDelServicioAc,
  urlAdjuntoAcSegura,
} from '../lib/airesAcondicionados';

// 31-oct-2026: host del Storage del proyecto; solo se abren adjuntos de ahí.
const SUPABASE_URL_AC = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

const usd = (n: number) =>
  `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const ves = (n: number) =>
  `Bs ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

type Inv = { id: string; name: string; unit: string | null };

const NOMBRES_REFERENCIA_SUGERIDOS = [
  'CARBOZULIA',
  'CAMIÓN ROQUERO',
  'PALA LIEBHERR',
  'CAMIONETA / FLOTA',
  'COCINA Y CONTENEDOR',
  'OFICINA GERENCIA',
  'CONSOLA PRINCIPAL',
] as const;

export function AiresAcondicionadosTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const hoy = hoyAcISO();
  const bcv = useBcvRate();

  const { data: serviciosRaw, loading, refetch } = useTable<ServicioRecord>('servicios', {
    orderBy: 'created_at',
    ascending: false,
    realtimeFrom: 'servicios',
  });
  const { data: cuentas, loading: loadingCuentas, refetch: refetchCuentas } = useTable<Cuenta>('cuentas', {
    orderBy: 'created_at',
    ascending: false,
    realtimeFrom: 'cuentas',
  });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: suppliers, loading: loadingSuppliers, refetch: refetchSuppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: invItems } = useTable<Inv>('inventory_items', { select: 'id, name, unit', orderBy: 'name' });
  const { data: machineryList } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: vehiclesList } = useTable<Vehicle>('vehicles', { orderBy: 'plate' });

  const companyName = (id: string | null) =>
    id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa';
  const supplierName = (id: string | null) =>
    id ? suppliers.find((s) => s.id === id)?.name ?? '—' : '—';

  // Catálogo de unidades extraído de Supabase
  const unidadesCatalogo = useMemo(
    () => extraerCatalogoAiresDeServicios(serviciosRaw),
    [serviciosRaw],
  );

  // Semáforo riguroso y preventivo calculado en tiempo real
  const unidadesCalc = useMemo(() => {
    const rawCalc = calcularSemaforoAires(unidadesCatalogo, serviciosRaw, hoy);
    // Si una unidad está vinculada a maquinaria o es de tipo móvil, asegurar que siempre resuelva su placa
    return rawCalc.map((u) => {
      if (u.placa) return u;
      if (u.machinery_id) {
        const m = machineryList.find((x) => x.id === u.machinery_id);
        if (m) return { ...u, placa: (m.plate || m.serial || 'SIN PLACA').toUpperCase() };
        const v = vehiclesList.find((x) => x.id === u.machinery_id);
        if (v) return { ...u, placa: (v.plate || v.serial || 'SIN PLACA').toUpperCase() };
      }
      return u;
    });
  }, [unidadesCatalogo, serviciosRaw, hoy, machineryList, vehiclesList]);

  // Filtros de pantalla
  const [filtroSemaforo, setFiltroSemaforo] = useState<'todos' | AcSemaforo | 'lavado_pendiente'>('todos');
  const [filtroArea, setFiltroArea] = useState<string>('TODAS');
  const [q, setQ] = useState('');
  const [selCodes, setSelCodes] = useState<Set<string>>(new Set());

  const toggleSelCode = (code: string) =>
    setSelCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  // KPIs del Semáforo Riguroso + Preventivo (Camión de Lavado)
  const kpis = useMemo(() => {
    let alDia = 0;
    let proximo = 0;
    let vencido = 0;
    let sinRegistro = 0;
    let lavadoPendiente = 0;
    let gastoTotal = 0;
    for (const u of unidadesCalc) {
      if (u.semaforo === 'al_dia') alDia++;
      else if (u.semaforo === 'proximo') proximo++;
      else if (u.semaforo === 'vencido') vencido++;
      else sinRegistro++;
      if (u.semaforoPrev === 'vencido' || u.semaforoPrev === 'proximo') {
        lavadoPendiente++;
      }
      gastoTotal += u.gastoAcumuladoUsd || 0;
    }
    return { total: unidadesCalc.length, alDia, proximo, vencido, sinRegistro, lavadoPendiente, gastoTotal };
  }, [unidadesCalc]);

  // Áreas disponibles con conteo
  const areasConConteo = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of unidadesCalc) {
      const a = (u.area || 'BASE GENERAL').trim().toUpperCase();
      m.set(a, (m.get(a) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [unidadesCalc]);

  // Lista filtrada
  const lista = useMemo(() => {
    const nq = norm(q);
    return unidadesCalc.filter((u) => {
      if (filtroSemaforo === 'lavado_pendiente') {
        if (u.semaforoPrev !== 'vencido' && u.semaforoPrev !== 'proximo') return false;
      } else if (filtroSemaforo !== 'todos' && u.semaforo !== filtroSemaforo) {
        return false;
      }
      if (filtroArea !== 'TODAS' && (u.area || 'BASE GENERAL').trim().toUpperCase() !== filtroArea) return false;
      if (nq) {
        const hay = norm(
          [
            u.code,
            u.name,
            u.area,
            u.tipo_equipo,
            u.btu,
            u.marca,
            u.serial,
            u.placa,
            u.prev_responsable,
            u.notes,
            companyName(u.company_id),
          ].join(' '),
        );
        if (!hay.includes(nq)) return false;
      }
      return true;
    });
  }, [unidadesCalc, filtroSemaforo, filtroArea, q, companies]);

  // ── Persistencia del Catálogo de Unidades en `public.servicios` ────────────
  const [savingCatalog, setSavingCatalog] = useState(false);

  // 31-oct-2026: recibe un CAMBIO (base → nueva lista) en vez de la lista ya armada.
  // El catálogo se lee fresco de la base justo antes de guardar: si otra persona
  // agregó un aire mientras esta pantalla estaba abierta, ya no se borra al guardar.
  // Si el cambio devuelve un texto, es un error y no se guarda nada.
  const guardarCatalogoEnSupabase = async (
    cambio: (base: AcUnit[]) => AcUnit[] | string,
    msgExito?: string,
  ) => {
    if (!canWrite) {
      toast.error('No tienes permiso de escritura en Compras.');
      return false;
    }
    setSavingCatalog(true);
    try {
      const { data: masterFresco, error: errLeer } = await supabase
        .from('servicios')
        .select('id, code, items')
        .eq('code', AC_MASTER_CODE)
        .maybeSingle();
      if (errLeer) {
        toast.error(errLeer.message);
        return false;
      }
      const masterExistente = masterFresco as { id: string; code: string; items: any[] } | null;
      const base = masterExistente ? extraerCatalogoAiresDeServicios([masterExistente as any]) : [];
      const nuevasUnidades = cambio(base);
      if (typeof nuevasUnidades === 'string') {
        toast.error(nuevasUnidades);
        return false;
      }
      const itemsJson = serializarCatalogoAiresParaServicios(nuevasUnidades);
      const payload = {
        code: AC_MASTER_CODE,
        company_id: generalCompanies(companies)[0]?.id ?? null,
        supplier_id: null,
        service_date: hoy,
        items: itemsJson,
        total: 0,
        note: 'CATÁLOGO MAESTRO DE UNIDADES DE AIRE ACONDICIONADO (BASE Y FLOTA)',
      };
      const { data: filas, error } = masterExistente
        ? await supabase
            .from('servicios')
            .update({ items: itemsJson, updated_at: new Date().toISOString() })
            .eq('id', masterExistente.id)
            .select('id')
        : await supabase
            .from('servicios')
            .insert({ ...payload, created_by: session?.user?.id ?? null })
            .select('id');
      if (error) {
        toast.error(error.message);
        return false;
      }
      // La RLS rechaza sin error y con 0 filas: eso NO es un guardado.
      if (!filas || filas.length === 0) {
        toast.error('No se guardó el catálogo de aires: la base no aceptó el cambio (revisa tu permiso en Compras).');
        return false;
      }
      await refetch();
      if (msgExito) toast.success(msgExito);
      return true;
    } finally {
      setSavingCatalog(false);
    }
  };

  // Registro rápido (1 toque) de lavado preventivo por Camión de Lavado
  const registrarLavadoPreventivoRapido = async (u: AcUnitCalc) => {
    const cambio = (base: AcUnit[]) => base.map((item) =>
      item.code === u.code
        ? {
            ...item,
            freq_prev_days: Number(item.freq_prev_days) > 0 ? Number(item.freq_prev_days) : 2,
            prev_responsable: item.prev_responsable || 'CAMIÓN DE LAVADO',
            last_prev_manual: hoy,
          }
        : item,
    );
    await guardarCatalogoEnSupabase(
      cambio,
      `🚿 Lavado preventivo (${u.prev_responsable || 'CAMIÓN DE LAVADO'}) de ${u.code} actualizado al día de hoy (${fmtFechaAc(hoy)}).`,
    );
  };

  // ── Modal de Edición de Ficha de 1 Unidad (o Lote de Unidades) ──────────────
  const [editUnitModal, setEditUnitModal] = useState(false);
  const [editBatchMode, setEditBatchMode] = useState(false);
  const [editCode, setEditCode] = useState('');
  // 31-oct-2026: código con el que se ABRIÓ la ficha; null = aire nuevo.
  const [editOriginalCode, setEditOriginalCode] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editArea, setEditArea] = useState('OFICINA PRINCIPAL');
  const [editTipo, setEditTipo] = useState<AcTipoEquipo>('SPLIT');
  const [editBtu, setEditBtu] = useState('18.000 BTU');
  const [editMarca, setEditMarca] = useState('');
  const [editSerial, setEditSerial] = useState('');
  const [editPlaca, setEditPlaca] = useState('');
  const [editMachineryId, setEditMachineryId] = useState<string | null>(null);
  const [editCompany, setEditCompany] = useState<string>('');
  const [editFreq, setEditFreq] = useState('30');
  const [editLastMaint, setEditLastMaint] = useState('');
  // Nuevos campos para Frecuencia de Mantenimiento Preventivo (Camión de Lavado)
  const [editFreqPrev, setEditFreqPrev] = useState('');
  const [editPrevResp, setEditPrevResp] = useState('CAMIÓN DE LAVADO');
  const [editLastPrev, setEditLastPrev] = useState('');
  const [editEstadoOp, setEditEstadoOp] = useState<AcEstadoOperativo>('operativo');
  const [editNotes, setEditNotes] = useState('');

  // Buscador de Maquinaria / Camión / Vehículo (con Placa obligatoria)
  const [machPickerOpen, setMachPickerOpen] = useState(false);
  const [machQ, setMachQ] = useState('');

  const catalogoFlotaUnificado = useMemo(() => {
    const items: {
      id: string;
      code: string;
      plate: string;
      description: string;
      tipoSugerido: AcTipoEquipo;
      companyId: string | null;
      origen: 'MAQUINARIA' | 'VEHÍCULO';
    }[] = [];

    for (const m of machineryList) {
      if (m.active === false) continue;
      const desc = `${m.machinery_type || ''} ${m.description || ''} ${m.code || ''}`.toUpperCase();
      let tipoSugerido: AcTipoEquipo = 'MAQUINARIA';
      if (desc.includes('ROQUERO') || desc.includes('ROCKERO') || desc.includes('CAMION') || desc.includes('CAMIÓN') || desc.includes('VOLQUETA') || desc.includes('CISTERNA')) {
        tipoSugerido = 'CAMIÓN / ROQUERO';
      } else if (desc.includes('PALA') || desc.includes('EXCAVADORA') || desc.includes('LIEBHERR') || desc.includes('JUMBO')) {
        tipoSugerido = 'PALA / EXCAVADORA';
      } else if (desc.includes('CHUTO') || desc.includes('GANDOLA') || desc.includes('BATEA')) {
        tipoSugerido = 'CHUTO / GANDOLA';
      }
      items.push({
        id: m.id,
        code: (m.code || 'MAQ').toUpperCase(),
        plate: (m.plate || m.serial || 'SIN PLACA').toUpperCase(),
        description: (m.description || m.machinery_type || 'MAQUINARIA').toUpperCase(),
        tipoSugerido,
        companyId: m.company_id || null,
        origen: 'MAQUINARIA',
      });
    }

    for (const v of vehiclesList) {
      if (v.active === false) continue;
      items.push({
        id: v.id,
        code: (v.name || v.plate || 'VEH').toUpperCase(),
        plate: (v.plate || v.serial || 'SIN PLACA').toUpperCase(),
        description: [v.brand, v.model, v.vehicle_type].filter(Boolean).join(' ').toUpperCase() || 'VEHÍCULO / CAMIONETA',
        tipoSugerido: 'CAMIONETA / VEHÍCULO',
        companyId: v.company_id || null,
        origen: 'VEHÍCULO',
      });
    }

    return items;
  }, [machineryList, vehiclesList]);

  const seleccionarEquipoDeFlota = (item: (typeof catalogoFlotaUnificado)[number]) => {
    // 31-oct-2026: el código se copia de la máquina; si ya lo usa OTRO aire, se
    // propone el siguiente libre (CÓDIGO-2, CÓDIGO-3…) para no reemplazar su ficha.
    const ocupado = (c: string) => unidadesCatalogo.some((u) => u.code === c && u.code !== editOriginalCode);
    let codigoLibre = item.code;
    for (let n = 2; ocupado(codigoLibre) && n < 100; n++) codigoLibre = `${item.code}-${n}`;
    setEditCode(codigoLibre);
    setEditName(`${item.description} · PLACA ${item.plate}`);
    setEditPlaca(item.plate);
    setEditMachineryId(item.id);
    setEditTipo(item.tipoSugerido);
    if (!editBtu || editBtu.includes('BTU')) {
      setEditBtu('COMPRESOR 508');
    }
    if (item.companyId) {
      setEditCompany(item.companyId);
    }
    if (!editFreq || editFreq === '30') {
      setEditFreq('45');
    }
    if (!editFreqPrev || editFreqPrev === '0') {
      setEditFreqPrev('2');
    }
    setEditPrevResp('CAMIÓN DE LAVADO');
    setMachPickerOpen(false);
    toast.success(`Vinculado: ${item.code} (Placa: ${item.plate})`);
  };

  const cambiarTipoEquipo = (tp: AcTipoEquipo) => {
    setEditTipo(tp);
    if (esEquipoMovilAc(tp)) {
      if (!editBtu || editBtu === '18.000 BTU') {
        setEditBtu('COMPRESOR 508');
      }
      if (!editFreqPrev || editFreqPrev === '0') {
        setEditFreqPrev('2');
      }
      if (editFreq === '30' && !editBatchMode) {
        setEditFreq('45');
      }
      if (!editPrevResp) {
        setEditPrevResp('CAMIÓN DE LAVADO');
      }
    }
  };

  const abrirEditarUnidad = (u: AcUnitCalc) => {
    setEditOriginalCode(u.code);
    setEditBatchMode(false);
    setEditCode(u.code);
    setEditName(u.name);
    setEditArea(u.area || 'BASE GENERAL');
    setEditTipo(u.tipo_equipo || 'SPLIT');
    setEditBtu(u.btu || '18.000 BTU');
    setEditMarca(u.marca || '');
    setEditSerial(u.serial || '');
    setEditPlaca(u.placa || '');
    setEditMachineryId(u.machinery_id || null);
    setEditCompany(u.company_id ?? '');
    setEditFreq(String(u.freq_days || 30));
    setEditLastMaint(u.last_maint_manual || '');
    setEditFreqPrev(u.freq_prev_days && u.freq_prev_days > 0 ? String(u.freq_prev_days) : '');
    setEditPrevResp(u.prev_responsable || 'CAMIÓN DE LAVADO');
    setEditLastPrev(u.last_prev_manual || '');
    setEditEstadoOp(u.estado_operativo || 'operativo');
    setEditNotes(u.notes || '');
    setEditUnitModal(true);
  };

  const abrirConfigurarLote = () => {
    if (selCodes.size === 0) {
      return toast.error('Marca primero (☑) las unidades que deseas configurar en lote.');
    }
    setEditBatchMode(true);
    setEditOriginalCode(null);
    setEditCode(`${selCodes.size} unidad(es)`);
    setEditName('');
    setEditArea('');
    setEditBtu('');
    setEditMarca('');
    setEditPlaca('');
    setEditMachineryId(null);
    setEditCompany('');
    setEditFreq('30');
    setEditLastMaint('');
    setEditFreqPrev('');
    setEditPrevResp('CAMIÓN DE LAVADO');
    setEditLastPrev('');
    setEditEstadoOp('operativo');
    setEditNotes('');
    setEditUnitModal(true);
  };

  const guardarFichaUnidad = async () => {
    const freqNum = Math.max(1, Math.round(leerNumero(editFreq) || 30));
    const freqPrevNumRaw = Math.round(leerNumero(editFreqPrev) || 0);
    const freqPrevNum = freqPrevNumRaw > 0 ? freqPrevNumRaw : null;

    if (editLastMaint.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(editLastMaint.trim())) {
      return toast.error('La fecha de último mantenimiento riguroso debe tener formato AAAA-MM-DD.');
    }
    if (editLastPrev.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(editLastPrev.trim())) {
      return toast.error('La fecha de último mantenimiento preventivo debe tener formato AAAA-MM-DD.');
    }

    if (editBatchMode) {
      const cambioLote = (base: AcUnit[]) => base.map((u) => {
        if (!selCodes.has(u.code)) return u;
        return {
          ...u,
          area: editArea.trim() ? editArea.trim().toUpperCase() : u.area,
          tipo_equipo: editTipo || u.tipo_equipo,
          btu: editBtu.trim() ? editBtu.trim().toUpperCase() : u.btu,
          marca: editMarca.trim() ? editMarca.trim().toUpperCase() : u.marca,
          company_id: editCompany ? editCompany : u.company_id,
          freq_days: freqNum,
          freq_prev_days: editFreqPrev.trim() !== '' ? freqPrevNum : u.freq_prev_days,
          prev_responsable: editPrevResp.trim() ? editPrevResp.trim().toUpperCase() : u.prev_responsable,
          estado_operativo: editEstadoOp,
          last_maint_manual: editLastMaint.trim() || u.last_maint_manual,
          last_prev_manual: editLastPrev.trim() || u.last_prev_manual,
        };
      });
      const ok = await guardarCatalogoEnSupabase(cambioLote, `${selCodes.size} unidad(es) actualizadas.`);
      if (ok) setEditUnitModal(false);
      return;
    }

    const codeClean = editCode.trim().toUpperCase();
    if (!codeClean) return toast.error('El código de la unidad es obligatorio.');
    const esMovil = esEquipoMovilAc(editTipo) || Boolean(editMachineryId);
    const placaFinal = editPlaca.trim().toUpperCase() || (esMovil ? 'SIN PLACA' : '');

    const unidadActualizada: AcUnit = {
      id: codeClean,
      code: codeClean,
      name: editName.trim().toUpperCase() || `UNIDAD ${codeClean}`,
      area: editArea.trim().toUpperCase() || 'BASE GENERAL',
      tipo_equipo: editTipo,
      btu: editBtu.trim().toUpperCase() || (esMovil ? 'COMPRESOR 508' : '18.000 BTU'),
      marca: editMarca.trim().toUpperCase(),
      serial: editSerial.trim().toUpperCase(),
      placa: placaFinal,
      machinery_id: editMachineryId || null,
      company_id: editCompany || null,
      freq_days: freqNum,
      freq_prev_days: freqPrevNum,
      prev_responsable: (editPrevResp.trim() || 'CAMIÓN DE LAVADO').toUpperCase(),
      estado_operativo: editEstadoOp,
      last_maint_manual: editLastMaint.trim() || null,
      last_prev_manual: editLastPrev.trim() || null,
      notes: editNotes.trim().toUpperCase(),
      active: true,
    };
    // 31-oct-2026: antes «si el código existe, reemplázalo»: crear un aire con un
    // código ya usado borraba la ficha del otro. Nuevo = agrega; editar = solo el abierto.
    const historialOriginal = editOriginalCode
      ? unidadesCalc.find((u) => u.code === editOriginalCode)?.mantenimientosCount || 0
      : 0;
    const previa = aplicarFichaUnidadAc(unidadesCatalogo, unidadActualizada, editOriginalCode, historialOriginal);
    if (!previa.ok) return toast.error(previa.error);
    const ok = await guardarCatalogoEnSupabase((base) => {
      const r = aplicarFichaUnidadAc(base, unidadActualizada, editOriginalCode, historialOriginal);
      return r.ok ? r.unidades : r.error;
    }, `Ficha de ${codeClean} guardada.`);
    if (ok) setEditUnitModal(false);
  };

  // 🗑️ Eliminar unidades del catálogo. Los mantenimientos ya registrados NO se tocan.
  const eliminarUnidades = async (codes: string[]) => {
    if (!canWrite) return toast.error('No tienes permiso de escritura en Compras.');
    const set = new Set(codes);
    const afectadas = unidadesCalc.filter((u) => set.has(u.code));
    if (afectadas.length === 0) return;
    const conHistorial = afectadas.filter((u) => u.mantenimientosCount > 0).length;
    const ok = await confirm({
      title: afectadas.length === 1 ? `Eliminar ${afectadas[0].code}` : `Eliminar ${afectadas.length} unidades`,
      message:
        (afectadas.length === 1
          ? `¿Eliminar el aire ${afectadas[0].code} (${afectadas[0].area}) de la lista?`
          : `¿Eliminar estas ${afectadas.length} unidades de la lista?\n${afectadas
              .slice(0, 12)
              .map((u) => u.code)
              .join(', ')}${afectadas.length > 12 ? '…' : ''}`) +
        (conHistorial > 0
          ? `\n\n${conHistorial} tiene(n) mantenimientos registrados: ese historial y sus cuentas por pagar se conservan.`
          : ''),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const guardado = await guardarCatalogoEnSupabase(
      (base) => base.filter((u) => !set.has(u.code)),
      afectadas.length === 1 ? `${afectadas[0].code} eliminado.` : `${afectadas.length} unidades eliminadas.`,
    );
    if (guardado) setSelCodes(new Set());
  };

  const abrirNuevaUnidadExtra = () => {
    const nextNum = unidadesCatalogo.reduce((max, u) => {
      const n = Number((u.code.match(/(\d+)\s*$/) || [])[1]);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0) + 1;
    const nextCode = `AA-${String(nextNum).padStart(2, '0')}`;
    setEditBatchMode(false);
    setEditOriginalCode(null);
    setEditCode(nextCode);
    setEditName(`UNIDAD ${nextCode}`);
    setEditArea('BASE GENERAL');
    setEditTipo('SPLIT');
    setEditBtu('18.000 BTU');
    setEditMarca('');
    setEditSerial('');
    setEditPlaca('');
    setEditMachineryId(null);
    setEditCompany(generalCompanies(companies)[0]?.id ?? '');
    setEditFreq('30');
    setEditLastMaint('');
    setEditFreqPrev('');
    setEditPrevResp('CAMIÓN DE LAVADO');
    setEditLastPrev('');
    setEditEstadoOp('operativo');
    setEditNotes('');
    setEditUnitModal(true);
  };

  // ── Modal de Registro / Edición de Mantenimiento (Riguroso o Preventivo) ────
  const [maintOpen, setMaintOpen] = useState(false);
  const [editingMaintId, setEditingMaintId] = useState<string | null>(null);
  const [editingMaintCode, setEditingMaintCode] = useState<string | null>(null);
  const [maintUnits, setMaintUnits] = useState<string[]>([]);
  const [maintUnitQ, setMaintUnitQ] = useState('');
  const [maintCompany, setMaintCompany] = useState('');
  const [maintSupplier, setMaintSupplier] = useState('');
  const [maintDate, setMaintDate] = useState(hoy);
  const [maintTipo, setMaintTipo] = useState<string>(AC_TIPOS_INTERVENCION[0]);
  const [maintChecklist, setMaintChecklist] = useState<string[]>([...AC_CHECKLIST_RIGUROSO.slice(0, 6)]);
  const [maintMoneda, setMaintMoneda] = useState<'USD' | 'VES'>('USD');
  const [modoPrecio, setModoPrecio] = useState<'unitario' | 'total'>('unitario');
  const [maintIvaModo, setMaintIvaModo] = useState<AcModoIva>('incluye_iva');
  const [precioTexto, setPrecioTexto] = useState('');
  const [usaInv, setUsaInv] = useState(false);
  const [invItemId, setInvItemId] = useState<string | null>(null);
  const [invItemName, setInvItemName] = useState('');
  const [invPickerOpen, setInvPickerOpen] = useState(false);
  const [invQ, setInvQ] = useState('');
  const [maintDetalle, setMaintDetalle] = useState('');
  const [maintCondicionesPago, setMaintCondicionesPago] = useState('');
  const [maintNota, setMaintNota] = useState('');
  const [maintEnviarCxp, setMaintEnviarCxp] = useState(true);
  const [maintVenceCxp, setMaintVenceCxp] = useState('');
  const [maintPresupuestos, setMaintPresupuestos] = useState<FormatoAdjunto[]>([]);
  const [subiendoFactura, setSubiendoFactura] = useState(false);
  const [subiendoHistId, setSubiendoHistId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; kind: 'image' | 'pdf'; name: string } | null>(null);
  // 31-oct-2026: la URL guardada no se pone directo en el <iframe> / window.open /
  // Linking: solo pasan las del Storage del proyecto (https). Si no, se avisa.
  const previewUrlSegura = previewDoc ? urlAdjuntoAcSegura(previewDoc.url, SUPABASE_URL_AC) : null;
  const abrirVistaPreviaAdjunto = (doc: { url: string; kind: 'image' | 'pdf'; name: string }) => {
    const segura = urlAdjuntoAcSegura(doc.url, SUPABASE_URL_AC);
    if (!segura) {
      toast.error('Ese adjunto tiene una dirección no permitida (no es del almacenamiento del sistema). No se abre.');
      return;
    }
    setPreviewDoc({ ...doc, url: segura });
  };
  const abrirAdjuntoFuera = () => {
    if (!previewUrlSegura) {
      toast.error('Ese adjunto tiene una dirección no permitida. No se abre.');
      return;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(previewUrlSegura, '_blank', 'noopener,noreferrer');
    } else {
      Linking.openURL(previewUrlSegura);
    }
  };
  const [savingMaint, setSavingMaint] = useState(false);
  const [provQ, setProvQ] = useState('');
  const [nuevoProv, setNuevoProv] = useState('');
  const [creandoProv, setCreandoProv] = useState(false);

  // Busca si ya existe una Cuenta por Pagar asociada al servicio (en cualquier estado: pendiente, pagada o anulada)
  const buscarCuentaPorServicio = (srvCode?: string | null): Cuenta | null => {
    const codeUpper = String(srvCode || '').trim().toUpperCase();
    if (!codeUpper) return null;
    // 31-oct-2026: el código debe estar completo (no basta con «contenerlo»).
    return cuentas.find((c) => cuentaEsDelServicioAc(c, codeUpper)) ?? null;
  };

  // Resuelve o crea un supplier_id válido (requerido por CHECK constraint `cuentas_contraparte_segun_tipo`)
  const resolverSupplierParaCxp = async (supplierId: string | null, companyId: string | null): Promise<string | null> => {
    if (supplierId) return supplierId;
    if (companyId) {
      const compName = companyName(companyId).trim().toUpperCase();
      const matchComp = suppliers.find((s) => s.name.trim().toUpperCase() === compName);
      if (matchComp) return matchComp.id;
    }
    const fallbackName = 'PROVEEDOR / TÉCNICO DE AIRES';
    const matchFallback = suppliers.find((s) => s.name.trim().toUpperCase() === fallbackName);
    if (matchFallback) return matchFallback.id;
    if (suppliers.length > 0) return suppliers[0].id;
    const { data } = await supabase.from('suppliers').insert({ name: fallbackName }).select('id').single();
    if (data?.id) {
      await refetchSuppliers();
      return data.id;
    }
    return null;
  };

  // 31-oct-2026: la RLS de `cuentas` niega sin error (0 filas): se avisa en vez de dar éxito.
  const SIN_PERMISO_CXP =
    'La cuenta por pagar no se guardó: tu usuario no tiene permiso de escritura en Cuentas por Pagar. Pide a quien lo tenga que pulse «💸 Enviar a Por Pagar».';

  // Sincroniza de forma idempotente un servicio de Aire Acondicionado con `public.cuentas` (`por_pagar`)
  const sincronizarServicioConCuentaPorPagar = async (
    srv: {
      id: string;
      code: string;
      company_id: string | null;
      supplier_id: string | null;
      service_date: string;
      items: any[];
      total: number;
      factura_url: string | null;
      factura_type?: 'image' | 'pdf' | null;
      factura_name?: string | null;
      note: string | null;
    },
    opts?: { vencimiento?: string | null; presupuestos?: FormatoAdjunto[]; alicuotaIva?: number | null },
  ): Promise<{ ok: boolean; error?: string; estadoCuenta?: string }> => {
    const montoTotal = Math.round((Number(srv.total) || 0) * 100) / 100;
    if (!(montoTotal > 0)) return { ok: true };

    const srvCode = String(srv.code || '').trim().toUpperCase();
    if (!srvCode || srvCode === AC_MASTER_CODE) return { ok: true };

    const supId = await resolverSupplierParaCxp(srv.supplier_id, srv.company_id);
    if (!supId) {
      return { ok: false, error: 'No se pudo determinar el proveedor para Cuentas por Pagar.' };
    }

    const itemsArr = Array.isArray(srv.items) ? srv.items : [];
    const primerItem = (itemsArr[0] || {}) as Record<string, any>;
    const tipoMaint = String(primerItem.tipo || 'MANTENIMIENTO DE AIRE ACONDICIONADO').trim().toUpperCase();

    const codigosConPlaca = itemsArr
      .map((it: any) => {
        const c = String(it?.ac_unit_code || it?.ac_unit_id || '').trim().toUpperCase();
        const p = String(it?.ac_unit_placa || '').trim().toUpperCase();
        if (c) return p ? `${c} (PLACA ${p})` : c;
        return String(it?.machine_label || 'AIRE').trim();
      })
      .filter(Boolean);
    const codigosUnicos = Array.from(new Set(codigosConPlaca));
    const codigosTxt =
      codigosUnicos.length === 0
        ? 'AIRE ACONDICIONADO'
        : codigosUnicos.length <= 5
          ? codigosUnicos.join(', ')
          : `${codigosUnicos.slice(0, 5).join(', ')} y ${codigosUnicos.length - 5} más`;

    const conceptoCxp = `MANTENIMIENTO AIRES (${codigosTxt}) · ${tipoMaint} · ${srvCode}`.slice(0, 220);

    // Verificar en memoria y directamente en Supabase para garantizar idempotencia total (0 duplicados)
    let cuentaExistente = buscarCuentaPorServicio(srvCode);
    if (!cuentaExistente) {
      const { data: rem } = await supabase
        .from('cuentas')
        .select('*')
        .eq('tipo', 'por_pagar')
        .eq('documento', srvCode)
        .limit(1);
      if (rem && rem.length > 0) {
        cuentaExistente = rem[0] as Cuenta;
      }
    }

    const condSrv = extraerCondicionesPago(srv.note);
    const ivaSrv = opts?.alicuotaIva != null ? opts.alicuotaIva : (extraerIvaCuenta(srv.note) ?? 16);
    const notaHumanaSrv = limpiarNotaInterna(srv.note);
    const presupuestosSrv: FormatoAdjunto[] =
      opts?.presupuestos && opts.presupuestos.length > 0
        ? opts.presupuestos
        : extraerPresupuestosDeServicioAc(srv as ServicioRecord, primerItem as any).map((p) => ({
            id: p.id,
            url: p.url,
            kind: p.kind,
            name: p.name,
          }));

    // Si existe cuenta previa, preservamos sus etiquetas de aprobación/recibo/historial y actualizamos las de AC
    let baseNota = cuentaExistente?.nota || '';
    const textoBaseHumana = notaHumanaSrv || `MANTENIMIENTO DE ${ Math.max(1, codigosUnicos.length) } UNIDAD(ES): ${codigosTxt}`;
    if (baseNota) {
      // Conservar tags administrativos existentes de Cuentas (APROBADO_CXP, RECIBO_PAGO, FACTURA_CUENTA, HISTORIAL_COMPRA)
      const tagsConservar: string[] = [];
      const rxList = [
        /\[APROBADO_CXP:[^\]]*\]/gi,
        /\[RECIBO_PAGO:[^\]]*\]/gi,
        /\[FACTURA_CUENTA:[^\]]*\]/gi,
        /\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/gi,
      ];
      for (const rx of rxList) {
        const m = baseNota.match(rx);
        if (m) tagsConservar.push(...m);
      }
      baseNota = [textoBaseHumana, ...tagsConservar].filter(Boolean).join('\n');
    } else {
      baseNota = textoBaseHumana;
    }

    let notaCxp = inyectarEmpresaEnNota(baseNota, srv.company_id, companyName(srv.company_id)) || baseNota;
    notaCxp = inyectarCondicionesPagoEnNota(notaCxp, condSrv || null) || notaCxp;
    notaCxp = inyectarIvaEnCuentaNota(notaCxp, ivaSrv) || notaCxp;
    notaCxp = inyectarFormatosEnNota(notaCxp, presupuestosSrv) || notaCxp;

    const facturaPrincipalUrl = presupuestosSrv[0]?.url || srv.factura_url || cuentaExistente?.factura_url || null;
    const venceFinal =
      opts?.vencimiento !== undefined
        ? opts.vencimiento || null
        : cuentaExistente?.fecha_vencimiento || null;

    if (cuentaExistente) {
      if (cuentaExistente.estado === 'pagada') {
        // Si ya fue pagada en tesorería, actualizamos solo metadatos/soportes sin alterar el monto liquidado
        const { data: filasPag, error } = await supabase
          .from('cuentas')
          .update({
            concepto: conceptoCxp,
            factura_url: facturaPrincipalUrl,
            nota: notaCxp || null,
          })
          .eq('id', cuentaExistente.id)
          .select('id');
        if (error) return { ok: false, error: error.message };
        if (!filasPag || filasPag.length === 0) return { ok: false, error: SIN_PERMISO_CXP };
        return { ok: true, estadoCuenta: 'pagada' };
      }

      const { data: filasUpd, error } = await supabase
        .from('cuentas')
        .update({
          supplier_id: supId,
          company_id: null,
          concepto: conceptoCxp,
          documento: srvCode,
          factura_url: facturaPrincipalUrl,
          monto: montoTotal,
          fecha_emision: srv.service_date || hoy,
          fecha_vencimiento: venceFinal,
          nota: notaCxp || null,
        })
        .eq('id', cuentaExistente.id)
        .select('id');
      if (error) return { ok: false, error: error.message };
      if (!filasUpd || filasUpd.length === 0) return { ok: false, error: SIN_PERMISO_CXP };
      return { ok: true, estadoCuenta: cuentaExistente.estado };
    }

    const { data: filasIns, error } = await supabase.from('cuentas').insert({
      tipo: 'por_pagar',
      supplier_id: supId,
      company_id: null,
      concepto: conceptoCxp,
      documento: srvCode,
      factura_url: facturaPrincipalUrl,
      monto: montoTotal,
      fecha_emision: srv.service_date || hoy,
      fecha_vencimiento: venceFinal,
      estado: 'pendiente',
      nota: notaCxp || null,
      created_by: session?.user?.id ?? null,
    }).select('id');
    if (error) return { ok: false, error: error.message };
    if (!filasIns || filasIns.length === 0) return { ok: false, error: SIN_PERMISO_CXP };
    return { ok: true, estadoCuenta: 'pendiente' };
  };

  // Auto-sincronización retroactiva e idempotente: asegura que mantenimientos de Aires como SRV-0029 ($69,60)
  // tengan siempre su cuenta en `💳 POR PAGAR` sin duplicar.
  const sincronizadosRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!canWrite || loading || loadingCuentas || loadingSuppliers) return;
    const serviciosAcConCosto = serviciosRaw.filter((s) => {
      if (!s || s.code === AC_MASTER_CODE) return false;
      if (!(Number(s.total) > 0)) return false;
      const items = Array.isArray(s.items) ? s.items : [];
      return items.some(
        (it: any) =>
          it &&
          (it.categoria === AC_CATEGORIA_SERVICIO ||
            Boolean(it.ac_unit_code) ||
            Boolean(it.ac_unit_id)),
      );
    });

    const faltantes = serviciosAcConCosto.filter((s) => {
      const code = String(s.code || '').trim().toUpperCase();
      if (!code || sincronizadosRef.current.has(code)) return false;
      const yaExiste = buscarCuentaPorServicio(code);
      if (yaExiste) {
        sincronizadosRef.current.add(code);
        return false;
      }
      return true;
    });

    if (faltantes.length === 0) return;

    let cancelado = false;
    (async () => {
      let creadas = 0;
      const fallidas: string[] = [];
      let primerError = '';
      for (const s of faltantes) {
        if (cancelado) break;
        const code = String(s.code || '').trim().toUpperCase();
        sincronizadosRef.current.add(code);
        const res = await sincronizarServicioConCuentaPorPagar({
          id: s.id,
          code: s.code,
          company_id: s.company_id,
          supplier_id: s.supplier_id,
          service_date: s.service_date,
          items: Array.isArray(s.items) ? s.items : [],
          total: Number(s.total) || 0,
          factura_url: s.factura_url,
          factura_type: s.factura_type,
          factura_name: s.factura_name,
          note: s.note,
        });
        if (res.ok) creadas++;
        else {
          fallidas.push(code);
          if (!primerError) primerError = res.error || '';
        }
      }
      if (creadas > 0 && !cancelado) {
        await refetchCuentas();
      }
      // 31-oct-2026: antes el fallo se tragaba y el mantenimiento quedaba sin cuenta.
      if (fallidas.length > 0 && !cancelado) {
        toast.error(
          `${fallidas.length} mantenimiento(s) de aires sin cuenta por pagar (${fallidas.slice(0, 4).join(', ')}${fallidas.length > 4 ? '…' : ''}): ${primerError}`,
        );
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [canWrite, loading, loadingCuentas, loadingSuppliers, serviciosRaw, cuentas, suppliers]);

  const abrirMantenimiento = (codesIniciales?: string[], tipoInicial?: string) => {
    const elegidos =
      codesIniciales && codesIniciales.length > 0
        ? codesIniciales
        : selCodes.size > 0
          ? Array.from(selCodes)
          : [];
    const primeraUnidad = elegidos.length === 1 ? unidadesCatalogo.find((u) => u.code === elegidos[0]) : null;
    setEditingMaintId(null);
    setEditingMaintCode(null);
    setMaintUnits(elegidos);
    setMaintUnitQ('');
    setMaintCompany(primeraUnidad?.company_id || generalCompanies(companies)[0]?.id || '');
    setMaintSupplier('');
    setMaintDate(hoy);
    setMaintTipo(tipoInicial || AC_TIPOS_INTERVENCION[0]);
    setMaintChecklist(
      tipoInicial && tipoInicial.includes('CAMIÓN DE LAVADO')
        ? [AC_CHECKLIST_RIGUROSO[0], AC_CHECKLIST_RIGUROSO[1]]
        : [...AC_CHECKLIST_RIGUROSO.slice(0, 6)],
    );
    setMaintMoneda('USD');
    setModoPrecio('unitario');
    setMaintIvaModo('incluye_iva');
    setPrecioTexto('');
    setUsaInv(false);
    setInvItemId(null);
    setInvItemName('');
    setMaintDetalle('');
    setMaintCondicionesPago('');
    setMaintNota('');
    setMaintEnviarCxp(true);
    setMaintVenceCxp('');
    setMaintPresupuestos([]);
    setMaintOpen(true);
  };

  // Abre el modal en modo EDICIÓN precargando todos los datos del mantenimiento registrado
  const abrirEditarMantenimiento = (h: AcMaintHistoryEntry, u: AcUnitCalc) => {
    const srv = serviciosRaw.find((s) => s.id === h.servicioId);
    const itemsArr = srv && Array.isArray(srv.items) ? (srv.items as (ServicioItem & Record<string, any>)[]) : [];
    const primerIt = itemsArr[0] || null;
    const codigos = itemsArr
      .map((it) => String(it.ac_unit_code || it.ac_unit_id || '').trim().toUpperCase())
      .filter(Boolean);
    const unidadesIntervenidas = codigos.length > 0 ? Array.from(new Set(codigos)) : [u.code];

    const checklistActual =
      primerIt && Array.isArray(primerIt.ac_checklist)
        ? primerIt.ac_checklist
        : Array.isArray(h.checklist)
          ? h.checklist
          : [];
    const detalleLibre =
      primerIt && typeof primerIt.ac_detalle_libre === 'string'
        ? primerIt.ac_detalle_libre
        : h.detalleLibre !== undefined
          ? h.detalleLibre
          : separarDetalleLibreDeChecklist(h.detalle, checklistActual);

    const ivaTag = extraerIvaCuenta(srv?.note);
    const ivaModoGuardado: AcModoIva =
      primerIt?.ac_iva_modo === 'mas_iva' || primerIt?.ac_iva_modo === 'exento' || primerIt?.ac_iva_modo === 'incluye_iva'
        ? primerIt.ac_iva_modo
        : ivaTag === 0
          ? 'exento'
          : 'incluye_iva';

    const modoPrecioGuardado: 'unitario' | 'total' =
      primerIt?.ac_modo_precio === 'total' ? 'total' : 'unitario';
    const totalSrvUsd = Number(srv?.total) || Number(h.costoUsd) * Math.max(1, unidadesIntervenidas.length);
    const unitarioUsd = Number(primerIt?.price) || Number(h.costoUsd) || 0;

    // Si se guardó como 'mas_iva', el valor base capturado era el subtotal sin IVA
    let montoMostrar = modoPrecioGuardado === 'total' ? totalSrvUsd : unitarioUsd;
    if (ivaModoGuardado === 'mas_iva') {
      montoMostrar = Math.round((montoMostrar / 1.16) * 100) / 100;
    }

    const presupuestosCargados: FormatoAdjunto[] = extraerPresupuestosDeServicioAc(srv || null, primerIt).map((p) => ({
      id: p.id,
      url: p.url,
      kind: p.kind,
      name: p.name,
    }));

    const cuentaVinc = buscarCuentaPorServicio(h.servicioCode);

    setEditingMaintId(h.servicioId);
    setEditingMaintCode(h.servicioCode);
    setMaintUnits(unidadesIntervenidas);
    setMaintUnitQ('');
    setMaintCompany(srv?.company_id || h.companyId || u.company_id || generalCompanies(companies)[0]?.id || '');
    setMaintSupplier(srv?.supplier_id || h.supplierId || cuentaVinc?.supplier_id || '');
    setMaintDate((srv?.service_date || h.fecha || hoy).slice(0, 10));
    setMaintTipo(primerIt?.tipo || h.tipo || AC_TIPOS_INTERVENCION[0]);
    setMaintChecklist(checklistActual);
    setMaintMoneda('USD');
    setModoPrecio(modoPrecioGuardado);
    setMaintIvaModo(ivaModoGuardado);
    setPrecioTexto(montoMostrar > 0 ? String(montoMostrar) : '');
    setUsaInv(Boolean(primerIt?.usa_inventario));
    setInvItemId(primerIt?.item_id || null);
    setInvItemName(primerIt?.item_name || '');
    setMaintDetalle(detalleLibre);
    setMaintCondicionesPago(extraerCondicionesPago(srv?.note) || h.condicionesPago || '');
    setMaintNota(limpiarNotaInterna(srv?.note) || h.notaServicio || '');
    setMaintEnviarCxp(true);
    setMaintVenceCxp(cuentaVinc?.fecha_vencimiento ? cuentaVinc.fecha_vencimiento.slice(0, 10) : '');
    setMaintPresupuestos(presupuestosCargados);
    setMaintOpen(true);
  };

  const toggleChecklistItem = (item: string) => {
    setMaintChecklist((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]));
  };

  const toggleMaintUnit = (code: string) => {
    setMaintUnits((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]));
  };

  const crearProveedorRapido = async () => {
    const nombre = nuevoProv.trim().toUpperCase();
    if (!nombre) return;
    setCreandoProv(true);
    const { data, error } = await supabase.from('suppliers').insert({ name: nombre }).select('id').single();
    setCreandoProv(false);
    if (error) return toast.error(error.message);
    setNuevoProv('');
    await refetchSuppliers();
    if (data?.id) setMaintSupplier(data.id);
    toast.success('Proveedor creado.');
  };

  const adjuntarPresupuestosMaint = async () => {
    setSubiendoFactura(true);
    try {
      const res = await pickAndUploadDocFiles('servicios', editingMaintId || `ac-${Date.now()}`);
      if (res.ok && res.files && res.files.length > 0) {
        const nuevos: FormatoAdjunto[] = res.files.map((f, i) => ({
          id: `ac-doc-${Date.now()}-${i}`,
          url: f.url,
          kind: f.kind,
          name: f.name || `Presupuesto_${i + 1}`,
        }));
        setMaintPresupuestos((prev) => [...prev, ...nuevos]);
        toast.success(
          nuevos.length === 1
            ? 'Presupuesto / soporte adjuntado.'
            : `${nuevos.length} archivos adjuntados.`,
        );
      } else if (res.error) {
        toast.error(res.error);
      }
    } finally {
      setSubiendoFactura(false);
    }
  };

  const tomarFotoPresupuestoMaint = async () => {
    setSubiendoFactura(true);
    try {
      const res = await takeAndUploadDocPhoto('servicios', editingMaintId || `ac-${Date.now()}`);
      if (res.ok && res.url) {
        setMaintPresupuestos((prev) => [
          ...prev,
          {
            id: `ac-cam-${Date.now()}`,
            url: res.url!,
            kind: 'image',
            name: res.name || `Foto_Presupuesto_${prev.length + 1}.jpg`,
          },
        ]);
        toast.success('Foto de presupuesto adjuntada.');
      } else if (res.error) {
        toast.error(res.error);
      }
    } finally {
      setSubiendoFactura(false);
    }
  };

  const quitarPresupuestoMaint = (idOrUrl: string) => {
    setMaintPresupuestos((prev) => prev.filter((p) => p.id !== idOrUrl && p.url !== idOrUrl));
  };

  // Subida rápida de presupuesto directamente desde una fila del Historial de Mantenimientos
  const subirPresupuestoRapidoHistorial = async (h: AcMaintHistoryEntry) => {
    if (!canWrite) return toast.error('No tienes permiso de escritura en Compras.');
    const srv = serviciosRaw.find((s) => s.id === h.servicioId);
    if (!srv) return toast.error('No se encontró el registro del servicio.');

    setSubiendoHistId(h.servicioId);
    try {
      const res = await pickAndUploadDocFiles('servicios', h.servicioId);
      if (!res.ok || !res.files || res.files.length === 0) {
        if (res.error) toast.error(res.error);
        return;
      }
      const existentes = extraerPresupuestosDeServicioAc(srv, Array.isArray(srv.items) ? (srv.items[0] as any) : null).map(
        (p) => ({
          id: p.id,
          url: p.url,
          kind: p.kind,
          name: p.name,
        }),
      );
      const nuevos: FormatoAdjunto[] = res.files.map((f, i) => ({
        id: `ac-doc-${Date.now()}-${i}`,
        url: f.url,
        kind: f.kind,
        name: f.name || `Presupuesto_${existentes.length + i + 1}`,
      }));
      const todos = [...existentes, ...nuevos];
      const nuevosItems = (Array.isArray(srv.items) ? srv.items : []).map((it: any) => ({
        ...it,
        ac_presupuestos: todos,
      }));
      const nuevaNota = inyectarFormatosEnNota(srv.note, todos);
      const primera = todos[0] || null;

      const { error } = await supabase
        .from('servicios')
        .update({
          items: nuevosItems,
          factura_url: primera?.url ?? srv.factura_url ?? null,
          factura_type: primera?.kind ?? srv.factura_type ?? null,
          factura_name: primera?.name ?? srv.factura_name ?? null,
          note: nuevaNota,
          updated_at: new Date().toISOString(),
        })
        .eq('id', srv.id);

      if (error) return toast.error(error.message);

      await sincronizarServicioConCuentaPorPagar(
        {
          ...srv,
          items: nuevosItems,
          factura_url: primera?.url ?? srv.factura_url ?? null,
          factura_type: primera?.kind ?? srv.factura_type ?? null,
          factura_name: primera?.name ?? srv.factura_name ?? null,
          note: nuevaNota,
        },
        { presupuestos: todos },
      );

      await Promise.all([refetch(), refetchCuentas()]);
      toast.success('Presupuesto adjuntado al mantenimiento y sincronizado con Cuentas por Pagar.');
    } finally {
      setSubiendoHistId(null);
    }
  };

  // ── Cálculos de Precio, Moneda ($ USD / Bs BCV) y Desglose de IVA (16%) ─────
  const tasaBcvActiva = bcv.rate && bcv.rate > 0 ? bcv.rate : 0;
  const montoDigitado = leerNumero(precioTexto);
  const montoBaseUsd =
    maintMoneda === 'VES'
      ? tasaBcvActiva > 0
        ? Math.round((montoDigitado / tasaBcvActiva) * 10000) / 10000
        : 0
      : montoDigitado;

  const cantUnidadesMaint = Math.max(1, maintUnits.length);
  const montoBrutoTotalUsd =
    modoPrecio === 'unitario'
      ? Math.round(montoBaseUsd * cantUnidadesMaint * 100) / 100
      : Math.round(montoBaseUsd * 100) / 100;

  const alicuotaIvaMaint = maintIvaModo === 'exento' ? 0 : 16;
  const subtotalMaintUsd =
    maintIvaModo === 'mas_iva'
      ? montoBrutoTotalUsd
      : maintIvaModo === 'incluye_iva'
        ? Math.round((montoBrutoTotalUsd / 1.16) * 100) / 100
        : montoBrutoTotalUsd;
  const ivaMaintUsd =
    maintIvaModo === 'mas_iva'
      ? Math.round(montoBrutoTotalUsd * 0.16 * 100) / 100
      : maintIvaModo === 'incluye_iva'
        ? Math.round(Math.max(0, montoBrutoTotalUsd - subtotalMaintUsd) * 100) / 100
        : 0;
  const totalMaintCalc =
    maintIvaModo === 'mas_iva'
      ? Math.round((subtotalMaintUsd + ivaMaintUsd) * 100) / 100
      : montoBrutoTotalUsd;
  const precioUnitarioCalc = Math.round((totalMaintCalc / cantUnidadesMaint) * 100) / 100;
  const subtotalUnitarioUsd = Math.round((subtotalMaintUsd / cantUnidadesMaint) * 100) / 100;
  const ivaUnitarioUsd = Math.round((ivaMaintUsd / cantUnidadesMaint) * 100) / 100;
  const equivalenteMaintVes = tasaBcvActiva > 0 ? Math.round(totalMaintCalc * tasaBcvActiva * 100) / 100 : 0;

  const guardarMantenimiento = async () => {
    if (!maintCompany) return toast.error('Elige la empresa.');
    if (maintUnits.length === 0) return toast.error('Selecciona al menos una unidad de aire acondicionado.');
    if (maintMoneda === 'VES' && !(tasaBcvActiva > 0)) {
      return toast.error('No hay tasa BCV disponible en este momento; ingresa el monto en dólares ($ USD).');
    }
    if (usaInv && !invItemId) return toast.error('Elige el repuesto del inventario o desmarca la casilla de repuesto.');
    if (maintEnviarCxp && totalMaintCalc > 0 && !maintSupplier) {
      return toast.error('Elige o crea el Proveedor para registrar la Cuenta por Pagar.');
    }

    const detalleLibreClean = separarDetalleLibreDeChecklist(maintDetalle, maintChecklist);
    const checklistResumen = maintChecklist.length > 0 ? `[${maintChecklist.join(', ')}]` : '';
    const detalleCombinado = [checklistResumen, detalleLibreClean].filter(Boolean).join(' · ');
    const esPreventivoLavado = maintTipo.toUpperCase().includes('CAMIÓN DE LAVADO');

    const renglones: (ServicioItem & Record<string, any>)[] = maintUnits.map((code, idx) => {
      const u = unidadesCalc.find((x) => x.code === code) || unidadesCatalogo.find((x) => x.code === code);
      const placaTxt = u?.placa ? ` [PLACA: ${u.placa}]` : '';
      const label = u ? `❄️ ${u.code}${placaTxt} · ${u.area} · ${u.tipo_equipo} ${u.btu}` : `❄️ ${code}`;
      const descuentaAqui = usaInv && idx === 0;
      return {
        categoria: AC_CATEGORIA_SERVICIO,
        tipo: maintTipo,
        machinery_id: u?.machinery_id || null,
        machine_label: label,
        qty: 1,
        price: precioUnitarioCalc,
        usa_inventario: descuentaAqui,
        item_id: descuentaAqui ? invItemId : null,
        item_name: descuentaAqui ? invItemName : '',
        detalle: detalleCombinado,
        ac_detalle_libre: detalleLibreClean,
        ac_unit_id: code,
        ac_unit_code: code,
        ac_unit_area: u?.area || 'BASE GENERAL',
        ac_unit_btu: u?.btu || '18.000 BTU',
        ac_unit_placa: u?.placa || '',
        ac_es_preventivo_lavado: esPreventivoLavado,
        ac_checklist: maintChecklist,
        ac_iva_modo: maintIvaModo,
        ac_alicuota_iva: alicuotaIvaMaint,
        ac_subtotal_usd: subtotalUnitarioUsd,
        ac_iva_usd: ivaUnitarioUsd,
        ac_moneda: maintMoneda,
        ac_tasa_bcv: tasaBcvActiva || null,
        ac_modo_precio: modoPrecio,
        ac_presupuestos: maintPresupuestos,
      };
    });

    let notaFinalSrv = inyectarCondicionesPagoEnNota(
      maintNota.trim().toUpperCase() || null,
      maintCondicionesPago.trim().toUpperCase() || null,
    );
    notaFinalSrv = inyectarIvaEnCuentaNota(notaFinalSrv, alicuotaIvaMaint);
    notaFinalSrv = inyectarFormatosEnNota(notaFinalSrv, maintPresupuestos);

    const primeraFactura = maintPresupuestos[0] || null;

    setSavingMaint(true);

    if (editingMaintId) {
      const { data: srvUpd, error: errUpd } = await supabase
        .from('servicios')
        .update({
          company_id: maintCompany,
          supplier_id: maintSupplier || null,
          service_date: maintDate || hoy,
          items: renglones,
          total: totalMaintCalc,
          factura_url: primeraFactura?.url ?? null,
          factura_type: primeraFactura?.kind ?? null,
          factura_name: primeraFactura?.name ?? null,
          note: notaFinalSrv,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingMaintId)
        .select('id, code')
        .single();

      if (errUpd) {
        setSavingMaint(false);
        return toast.error(errUpd.message);
      }

      const srvCode = srvUpd?.code || editingMaintCode || 'SRV-AC';
      if ((maintEnviarCxp || buscarCuentaPorServicio(srvCode)) && totalMaintCalc > 0) {
        const syncRes = await sincronizarServicioConCuentaPorPagar(
          {
            id: editingMaintId,
            code: srvCode,
            company_id: maintCompany,
            supplier_id: maintSupplier || null,
            service_date: maintDate || hoy,
            items: renglones,
            total: totalMaintCalc,
            factura_url: primeraFactura?.url ?? null,
            factura_type: primeraFactura?.kind ?? null,
            factura_name: primeraFactura?.name ?? null,
            note: notaFinalSrv,
          },
          {
            vencimiento: maintVenceCxp.trim() || null,
            presupuestos: maintPresupuestos,
            alicuotaIva: alicuotaIvaMaint,
          },
        );
        if (!syncRes.ok) {
          setSavingMaint(false);
          setMaintOpen(false);
          await Promise.all([refetch(), refetchCuentas()]);
          return toast.error(`Mantenimiento actualizado, pero falló sincronización con Por Pagar: ${syncRes.error}`);
        }
      }

      setSavingMaint(false);
      setMaintOpen(false);
      setEditingMaintId(null);
      setEditingMaintCode(null);
      await Promise.all([refetch(), refetchCuentas()]);
      toast.success(`Mantenimiento ${srvCode} actualizado y sincronizado con Cuentas por Pagar.`);
      return;
    }

    const { data: srvIns, error: errSrv } = await supabase
      .from('servicios')
      .insert({
        company_id: maintCompany,
        supplier_id: maintSupplier || null,
        service_date: maintDate || hoy,
        items: renglones,
        total: totalMaintCalc,
        factura_url: primeraFactura?.url ?? null,
        factura_type: primeraFactura?.kind ?? null,
        factura_name: primeraFactura?.name ?? null,
        note: notaFinalSrv,
        created_by: session?.user?.id ?? null,
      })
      .select('id, code')
      .single();

    if (errSrv) {
      setSavingMaint(false);
      return toast.error(errSrv.message);
    }

    const srvCode = srvIns?.code || 'SRV-AC';
    if (maintEnviarCxp && totalMaintCalc > 0) {
      sincronizadosRef.current.add(srvCode.toUpperCase());
      const syncRes = await sincronizarServicioConCuentaPorPagar(
        {
          id: srvIns?.id || '',
          code: srvCode,
          company_id: maintCompany,
          supplier_id: maintSupplier || null,
          service_date: maintDate || hoy,
          items: renglones,
          total: totalMaintCalc,
          factura_url: primeraFactura?.url ?? null,
          factura_type: primeraFactura?.kind ?? null,
          factura_name: primeraFactura?.name ?? null,
          note: notaFinalSrv,
        },
        {
          vencimiento: maintVenceCxp.trim() || null,
          presupuestos: maintPresupuestos,
          alicuotaIva: alicuotaIvaMaint,
        },
      );
      if (!syncRes.ok) {
        setSavingMaint(false);
        setMaintOpen(false);
        await Promise.all([refetch(), refetchCuentas()]);
        return toast.error(`Mantenimiento registrado, pero falló envío a Por Pagar: ${syncRes.error}`);
      }
    }

    setSavingMaint(false);
    setMaintOpen(false);
    setSelCodes(new Set());
    await Promise.all([refetch(), refetchCuentas()]);
    toast.success(
      maintEnviarCxp && totalMaintCalc > 0
        ? `Mantenimiento ${srvCode} registrado y enviado a Cuentas por Pagar.`
        : `Mantenimiento ${srvCode} registrado. Semáforo actualizado.`,
    );
  };

  // Exportar Reporte PDF
  const exportarReportePdf = async () => {
    try {
      const partesFiltro: string[] = [];
      if (filtroSemaforo !== 'todos') partesFiltro.push(filtroSemaforo.toUpperCase());
      if (filtroArea !== 'TODAS') partesFiltro.push(filtroArea);
      if (q.trim()) partesFiltro.push(`"${q.trim()}"`);
      const html = reporteAiresHtml({
        unidades: lista,
        hoyISO: hoy,
        filtroLabel: partesFiltro.join(' · '),
        supplierNameOf: supplierName,
        companyNameOf: companyName,
      });
      await exportPdf(html, `Control Aires Acondicionados ${fmtFechaAc(hoy).replace(/\//g, '-')}`);
    } catch (e: any) {
      toast.error('No se pudo generar el PDF: ' + (e?.message ?? e));
    }
  };

  const inputStyle = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    color: colors.text,
  } as const;

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      style={{
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: on ? colors.brand : colors.border,
        backgroundColor: on ? colors.brand : colors.surfaceAlt,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  const semaforoColors = (sem: AcSemaforo | 'no_aplica') => {
    switch (sem) {
      case 'al_dia':
        return { bg: colors.successSoftBg, border: colors.successSoftBorder, text: colors.successSoftText, bar: colors.success };
      case 'proximo':
        return { bg: colors.warningSoftBg, border: colors.warningSoftBorder, text: colors.warningSoftText, bar: colors.warning };
      case 'vencido':
        return { bg: colors.dangerSoftBg, border: colors.dangerSoftBorder, text: colors.dangerSoftText, bar: colors.danger };
      default:
        return { bg: colors.surfaceAlt, border: colors.border, text: colors.muted, bar: colors.muted };
    }
  };

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
      <ConfigBanner />

      {/* Encabezado y Acciones Principales */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
        <SectionTitle>❄️ Aires Acondicionados ({kpis.total})</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
          <TouchableOpacity
            onPress={exportarReportePdf}
            style={{
              backgroundColor: colors.surfaceAlt,
              borderWidth: 1,
              borderColor: colors.brand,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRadius: radius.pill,
            }}
          >
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>📄 Reporte PDF</Text>
          </TouchableOpacity>
          {canWrite ? (
            <>
              <TouchableOpacity
                onPress={abrirNuevaUnidadExtra}
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: radius.pill,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>+ Unidad / Maquinaria / Camión</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => abrirMantenimiento()}
                style={{
                  backgroundColor: colors.accent,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: radius.pill,
                }}
              >
                <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12 }}>
                  🛠️ Registrar mantenimiento{selCodes.size > 0 ? ` (${selCodes.size})` : ''}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      </View>

      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Control riguroso y preventivo (camión de lavado) de aires acondicionados de la base, Carbozulia, maquinarias, camiones roqueros, palas y camionetas.
      </Text>

      {/* Tarjetas KPI interactivas del Semáforo Riguroso y Preventivo */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {(
          [
            { key: 'todos', label: '❄️ TOTAL UNIDADES', val: kpis.total, color: colors.brandText, border: colors.brand },
            { key: 'al_dia', label: '🟢 AL DÍA', val: kpis.alDia, color: colors.successSoftText, border: colors.success },
            { key: 'proximo', label: '🟠 PRÓXIMOS', val: kpis.proximo, color: colors.warningSoftText, border: colors.warning },
            { key: 'vencido', label: '🔴 VENCIDOS / DAÑADOS', val: kpis.vencido, color: colors.dangerSoftText, border: colors.danger },
            { key: 'lavado_pendiente', label: '🚿 LAVADO PREVENTIVO HOY/VENC.', val: kpis.lavadoPendiente, color: colors.infoSoftText, border: colors.brand },
            { key: 'sin_registro', label: '⚪ SIN REGISTRO', val: kpis.sinRegistro, color: colors.muted, border: colors.border },
          ] as const
        ).map((k) => {
          const active = filtroSemaforo === k.key;
          return (
            <TouchableOpacity
              key={k.key}
              onPress={() => setFiltroSemaforo(active && k.key !== 'todos' ? 'todos' : k.key)}
              style={{
                flexGrow: 1,
                minWidth: 105,
                backgroundColor: active ? colors.surfaceAlt : colors.surface,
                borderWidth: active ? 2 : 1,
                borderColor: active ? k.border : colors.border,
                borderRadius: radius.md,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
              }}
            >
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>{k.label}</Text>
              <Text style={{ color: k.color, fontSize: 20, fontWeight: '900', marginTop: 2 }}>{k.val}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Filtro rápido por Área / Ubicación / Frente */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingBottom: spacing.xs }}
      >
        {chip(`Todas las áreas (${unidadesCalc.length})`, filtroArea === 'TODAS', () => setFiltroArea('TODAS'))}
        {areasConConteo.map(([areaName, count]) =>
          chip(`${areaName} (${count})`, filtroArea === areaName, () =>
            setFiltroArea(filtroArea === areaName ? 'TODAS' : areaName),
          ),
        )}
      </ScrollView>

      {/* Buscador */}
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar por código (AA-01, ROCKERO-18), placa, área (Carbozulia, Oficina), compresor 508, BTU o marca…"
        placeholderTextColor={colors.muted}
        style={[inputStyle, { marginBottom: spacing.xs }]}
      />

      {/* Barra de Selección Múltiple y Lote */}
      {canWrite ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
          <TouchableOpacity
            onPress={() => {
              const next = new Set(selCodes);
              lista.forEach((u) => next.add(u.code));
              setSelCodes(next);
            }}
            style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
          >
            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>☑ Marcar visibles ({lista.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              const urg = unidadesCalc
                .filter((u) => u.semaforo === 'vencido' || u.semaforo === 'proximo' || u.semaforoPrev === 'vencido' || u.semaforoPrev === 'proximo')
                .map((u) => u.code);
              setSelCodes(new Set(urg));
            }}
            style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
          >
            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>🔴🟠 Marcar vencidos y próximos</Text>
          </TouchableOpacity>
          {selCodes.size > 0 ? (
            <>
              <TouchableOpacity
                onPress={abrirConfigurarLote}
                style={{ backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
              >
                <Text style={{ color: colors.infoSoftText, fontSize: 11, fontWeight: '800' }}>
                  ⚙️ Configurar área/ciclos en lote ({selCodes.size})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => abrirMantenimiento(Array.from(selCodes))}
                style={{ backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
              >
                <Text style={{ color: colors.accentContrast, fontSize: 11, fontWeight: '800' }}>
                  🛠️ Hacer mantenimiento a los {selCodes.size} marcados
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setSelCodes(new Set())}
                style={{ paddingHorizontal: 6, paddingVertical: 4 }}
              >
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>✕ Quitar marca</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => eliminarUnidades(Array.from(selCodes))}
                disabled={savingCatalog}
                style={{ backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
              >
                <Text style={{ color: colors.dangerSoftText, fontSize: 11, fontWeight: '800' }}>🗑️ Eliminar los {selCodes.size} marcados</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      ) : null}

      {/* Listado de Unidades con Semáforo Riguroso y Preventivo */}
      {loading ? (
        <Loading />
      ) : lista.length === 0 ? (
        unidadesCatalogo.length === 0 ? (
          <EmptyState title="Sin aires cargados" subtitle="Usa «+ Unidad / Maquinaria / Camión» para cargar cada aire acondicionado." />
        ) : (
          <EmptyState title="Sin unidades en este filtro" subtitle="Cambia el filtro del semáforo o el texto de búsqueda." />
        )
      ) : (
        lista.map((u) => {
          const sc = semaforoColors(u.semaforo);
          const scPrev = semaforoColors(u.semaforoPrev);
          const checked = selCodes.has(u.code);
          const tienePrev = Boolean(u.freq_prev_days && u.freq_prev_days > 0);
          return (
            <ExpandableCard
              key={u.code}
              style={{ borderLeftWidth: 4, borderLeftColor: sc.bar }}
              summary={
                <View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {canWrite ? (
                      <TouchableOpacity
                        onPress={() => toggleSelCode(u.code)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={{ fontSize: 17, color: checked ? colors.brandText : colors.muted }}>
                          {checked ? '☑' : '☐'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    <View style={{ backgroundColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>
                        {esEquipoMovilAc(u.tipo_equipo) ? '🚜' : '❄️'} {u.code}
                      </Text>
                    </View>
                    {u.placa ? (
                      <View style={{ backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: colors.infoSoftText, fontWeight: '800', fontSize: 11 }}>
                          🏷️ PLACA: {u.placa}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }} numberOfLines={1}>
                      📍 {u.area}{u.name && u.name !== `UNIDAD ${u.code}` ? ` · ${u.name}` : ''}
                    </Text>
                    <View style={{ backgroundColor: sc.bg, borderWidth: 1, borderColor: sc.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: sc.text, fontWeight: '800', fontSize: 11 }}>{u.semaforoLabel}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 6 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {u.tipo_equipo} · {u.btu}{u.marca ? ` · ${u.marca}` : ''} · Riguroso: cada {u.freq_days}d
                    </Text>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                      Último rig.: {fmtFechaAc(u.ultimaFecha)} · Próximo: {fmtFechaAc(u.proximaFecha)}
                    </Text>
                  </View>

                  {tienePrev ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 5,
                        paddingTop: 4,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                        flexWrap: 'wrap',
                        gap: 6,
                      }}
                    >
                      <Text style={{ color: colors.brandText, fontSize: 11.5, fontWeight: '800' }}>
                        🚿 Preventivo ({u.prev_responsable || 'CAMIÓN DE LAVADO'}): cada {u.freq_prev_days} día(s) · Últ: {fmtFechaAc(u.ultimaFechaPrev)} → Próx: {fmtFechaAc(u.proximaFechaPrev)}
                      </Text>
                      <View style={{ backgroundColor: scPrev.bg, borderWidth: 1, borderColor: scPrev.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 }}>
                        <Text style={{ color: scPrev.text, fontWeight: '800', fontSize: 10.5 }}>{u.semaforoPrevLabel}</Text>
                      </View>
                    </View>
                  ) : null}
                </View>
              }
              detail={
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    🏢 Empresa: <Text style={{ color: colors.text, fontWeight: '700' }}>{companyName(u.company_id)}</Text>
                    {u.placa ? ` · 🏷️ Placa: ${u.placa}` : ''}
                    {u.serial ? ` · Serial: ${u.serial}` : ''}
                    {u.mantenimientosCount > 0 ? ` · ${u.mantenimientosCount} servicio(s) (${usd(u.gastoAcumuladoUsd)})` : ''}
                  </Text>
                  {u.notes ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>📝 Nota de la unidad: {u.notes}</Text>
                  ) : null}

                  {/* Historial de mantenimientos de esta unidad */}
                  {u.historial.length > 0 ? (
                    <View style={{ marginTop: 4, padding: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11.5 }}>
                        📜 Historial de mantenimientos ({u.historial.length})
                      </Text>
                      {u.historial.slice(0, 10).map((h, idx) => {
                        const cuentaVinc = buscarCuentaPorServicio(h.servicioCode);
                        const aprobInfo = cuentaVinc ? extraerAprobacionCxp(cuentaVinc.nota) : null;
                        const presupuestosHist = h.presupuestos || [];
                        const tieneIva = (h.alicuotaIva ?? 16) > 0 && h.costoUsd > 0;
                        const eqVesHist = tasaBcvActiva > 0 && h.costoUsd > 0 ? Math.round(h.costoUsd * tasaBcvActiva * 100) / 100 : 0;

                        return (
                          <View
                            key={`${h.servicioId}-${idx}`}
                            style={{
                              borderTopWidth: idx === 0 ? 0 : 1,
                              borderTopColor: colors.border,
                              paddingTop: idx === 0 ? 0 : 8,
                              gap: 3,
                            }}
                          >
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', flex: 1 }}>
                                • {fmtFechaAc(h.fecha)} · {h.servicioCode} · {h.tipo} — {usd(h.costoUsd)}
                              </Text>
                              {cuentaVinc ? (
                                <View
                                  style={{
                                    backgroundColor:
                                      cuentaVinc.estado === 'pagada'
                                        ? colors.successSoftBg
                                        : aprobInfo?.estado === 'aprobado'
                                          ? colors.infoSoftBg
                                          : colors.warningSoftBg,
                                    borderWidth: 1,
                                    borderColor:
                                      cuentaVinc.estado === 'pagada'
                                        ? colors.successSoftBorder
                                        : aprobInfo?.estado === 'aprobado'
                                          ? colors.infoSoftBorder
                                          : colors.warningSoftBorder,
                                    borderRadius: radius.pill,
                                    paddingHorizontal: 8,
                                    paddingVertical: 2,
                                  }}
                                >
                                  <Text
                                    style={{
                                      color:
                                        cuentaVinc.estado === 'pagada'
                                          ? colors.successSoftText
                                          : aprobInfo?.estado === 'aprobado'
                                            ? colors.infoSoftText
                                            : colors.warningSoftText,
                                      fontSize: 10.5,
                                      fontWeight: '800',
                                    }}
                                  >
                                    {cuentaVinc.estado === 'pagada'
                                      ? '✅ Pagada en Por Pagar'
                                      : aprobInfo?.estado === 'aprobado'
                                        ? '🟢 Aprobada en Por Pagar'
                                        : '⏳ En Por Pagar (Esperando aprobación)'}
                                  </Text>
                                </View>
                              ) : null}
                            </View>

                            {h.costoUsd > 0 ? (
                              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                                💵 {tieneIva
                                  ? `Base: ${usd(h.subtotalUsd ?? 0)} + IVA (${h.alicuotaIva ?? 16}%): ${usd(h.ivaUsd ?? 0)} = Total: ${usd(h.costoUsd)}`
                                  : `Exento de IVA · Total: ${usd(h.costoUsd)}`}
                                {eqVesHist > 0 ? ` · 🇻🇪 ≈ ${ves(eqVesHist)} (BCV)` : ''}
                              </Text>
                            ) : null}

                            <Text style={{ color: colors.muted, fontSize: 11 }}>
                              🏭 {supplierName(h.supplierId)}{h.detalle ? ` · ${h.detalle}` : ''}
                            </Text>

                            {h.condicionesPago ? (
                              <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>
                                💳 Condiciones: {h.condicionesPago}
                              </Text>
                            ) : null}

                            {h.notaServicio ? (
                              <Text style={{ color: colors.muted, fontSize: 11 }}>
                                📝 Nota: {h.notaServicio}
                              </Text>
                            ) : null}

                            {/* Presupuestos / Cotizaciones / Facturas adjuntas y botones de edición */}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
                              {presupuestosHist.map((doc, dIdx) => (
                                <TouchableOpacity
                                  key={`${doc.id}-${dIdx}`}
                                  onPress={() => abrirVistaPreviaAdjunto({ url: doc.url, kind: doc.kind, name: doc.name })}
                                  style={{
                                    backgroundColor: colors.infoSoftBg,
                                    borderWidth: 1,
                                    borderColor: colors.infoSoftBorder,
                                    borderRadius: radius.pill,
                                    paddingHorizontal: 9,
                                    paddingVertical: 4,
                                  }}
                                >
                                  <Text style={{ color: colors.infoSoftText, fontSize: 11, fontWeight: '800' }}>
                                    {doc.kind === 'pdf' ? '📄' : '🖼️'} Ver presupuesto{presupuestosHist.length > 1 ? ` ${dIdx + 1}` : ''}: {doc.name.slice(0, 24)}
                                  </Text>
                                </TouchableOpacity>
                              ))}

                              {canWrite ? (
                                <>
                                  <TouchableOpacity
                                    onPress={() => abrirEditarMantenimiento(h, u)}
                                    style={{
                                      backgroundColor: colors.surface,
                                      borderWidth: 1,
                                      borderColor: colors.brand,
                                      borderRadius: radius.pill,
                                      paddingHorizontal: 10,
                                      paddingVertical: 4,
                                    }}
                                  >
                                    <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>
                                      ✏️ Editar mantenimiento
                                    </Text>
                                  </TouchableOpacity>

                                  <TouchableOpacity
                                    onPress={() => subirPresupuestoRapidoHistorial(h)}
                                    disabled={subiendoHistId === h.servicioId}
                                    style={{
                                      backgroundColor: colors.surface,
                                      borderWidth: 1,
                                      borderColor: colors.border,
                                      borderRadius: radius.pill,
                                      paddingHorizontal: 10,
                                      paddingVertical: 4,
                                      opacity: subiendoHistId === h.servicioId ? 0.6 : 1,
                                    }}
                                  >
                                    <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                                      {subiendoHistId === h.servicioId
                                        ? '⏳ Subiendo…'
                                        : presupuestosHist.length > 0
                                          ? '📎 + Presupuesto'
                                          : '📎 Subir presupuesto'}
                                    </Text>
                                  </TouchableOpacity>

                                  {!cuentaVinc && h.costoUsd > 0 ? (
                                    <TouchableOpacity
                                      onPress={async () => {
                                        const srv = serviciosRaw.find((s) => s.id === h.servicioId);
                                        if (!srv) return;
                                        const res = await sincronizarServicioConCuentaPorPagar({
                                          id: srv.id,
                                          code: srv.code,
                                          company_id: srv.company_id,
                                          supplier_id: srv.supplier_id,
                                          service_date: srv.service_date,
                                          items: Array.isArray(srv.items) ? srv.items : [],
                                          total: Number(srv.total) || h.costoUsd,
                                          factura_url: srv.factura_url,
                                          factura_type: srv.factura_type,
                                          factura_name: srv.factura_name,
                                          note: srv.note,
                                        });
                                        if (res.ok) {
                                          await refetchCuentas();
                                          toast.success(`${h.servicioCode} enviado a Cuentas por Pagar.`);
                                        } else {
                                          toast.error(res.error || 'No se pudo enviar a Por Pagar.');
                                        }
                                      }}
                                      style={{
                                        backgroundColor: colors.accent,
                                        borderRadius: radius.pill,
                                        paddingHorizontal: 10,
                                        paddingVertical: 4,
                                      }}
                                    >
                                      <Text style={{ color: colors.accentContrast, fontSize: 11, fontWeight: '800' }}>
                                        💸 Enviar a Por Pagar
                                      </Text>
                                    </TouchableOpacity>
                                  ) : null}
                                </>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>
                      Aún no tiene mantenimientos registrados en el sistema.
                    </Text>
                  )}

                  {canWrite ? (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
                      {tienePrev || esEquipoMovilAc(u.tipo_equipo) ? (
                        <TouchableOpacity
                          onPress={() => registrarLavadoPreventivoRapido(u)}
                          disabled={savingCatalog}
                          style={{
                            flexGrow: 1,
                            backgroundColor: colors.infoSoftBg,
                            borderWidth: 1,
                            borderColor: colors.infoSoftBorder,
                            borderRadius: radius.md,
                            paddingVertical: spacing.sm,
                            paddingHorizontal: spacing.md,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: colors.infoSoftText, fontWeight: '800', fontSize: 12 }}>
                            🚿 Marcar lavado preventivo HOY ({u.prev_responsable || 'Camión de lavado'})
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        onPress={() => abrirMantenimiento([u.code])}
                        style={{
                          flexGrow: 1,
                          backgroundColor: colors.accent,
                          borderRadius: radius.md,
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.md,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12.5 }}>
                          🛠️ Registrar mantenimiento a {u.code}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => abrirEditarUnidad(u)}
                        style={{
                          flexGrow: 1,
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radius.md,
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.md,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>
                          ✏️ Editar ubicación / equipo / ciclos
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => eliminarUnidades([u.code])}
                        disabled={savingCatalog}
                        style={{
                          backgroundColor: colors.dangerSoftBg,
                          borderWidth: 1,
                          borderColor: colors.dangerSoftBorder,
                          borderRadius: radius.md,
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.md,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 12.5 }}>🗑️ Eliminar</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              }
            />
          );
        })
      )}

      {/* ── MODAL 1: Editar Ficha de Unidad (Individual o Lote) ── */}
      <Modal visible={editUnitModal} animationType="slide" onRequestClose={() => setEditUnitModal(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>
              {editBatchMode ? `⚙️ Configurar en lote (${editCode})` : `❄️ Configurar unidad ${editCode}`}
            </SectionTitle>

            {!editBatchMode ? (
              <Card>
                {/* Selector rápido de Maquinaria / Camión / Vehículo con Buscador y PLACA */}
                <View
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: spacing.sm,
                    marginBottom: spacing.sm,
                  }}
                >
                  <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800', marginBottom: 4 }}>
                    🚜 ¿Es el aire acondicionado de una Maquinaria, Camión, Pala o Camioneta?
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 8 }}>
                    Puedes vincularlo del catálogo (con su Placa) o escribir directamente abajo el código (ej. ROCKERO-18, PALA LIEBHERR) y su placa.
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => {
                        setMachQ('');
                        setMachPickerOpen(true);
                      }}
                      style={{
                        backgroundColor: colors.brand,
                        borderRadius: radius.md,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.xs,
                      }}
                    >
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                        🔎 Buscar Maquinaria / Camión / Vehículo (con Placa)
                      </Text>
                    </TouchableOpacity>
                    {editMachineryId ? (
                      <TouchableOpacity
                        onPress={() => setEditMachineryId(null)}
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radius.md,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: spacing.xs,
                        }}
                      >
                        <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 11 }}>✕ Quitar vínculo</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                  Código de la unidad (ej. AA-01, ROCKERO-18, PALA-LIEBHERR, CAMIONETA-01)
                </Text>
                <TextInput
                  value={editCode}
                  onChangeText={(t) => setEditCode(t.toUpperCase())}
                  placeholder="AA-01 o ROCKERO-18"
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                  🏷️ Placa de la Maquinaria / Camión / Camioneta (si aplica)
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <TextInput
                    value={editPlaca}
                    onChangeText={(t) => setEditPlaca(t.toUpperCase())}
                    placeholder="EJ. A12BC3D o SIN PLACA (dejar vacío si es aire de oficina)"
                    placeholderTextColor={colors.muted}
                    style={[inputStyle, { flex: 1 }]}
                  />
                  {chip('SIN PLACA', editPlaca === 'SIN PLACA', () =>
                    setEditPlaca(editPlaca === 'SIN PLACA' ? '' : 'SIN PLACA'),
                  )}
                </View>

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                  Nombre o referencia específica (ej. Carbozulia, Camión Roquero #18, Oficina Gerencia)
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {NOMBRES_REFERENCIA_SUGERIDOS.map((nom) =>
                    chip(nom, editName.toUpperCase() === nom, () => setEditName(nom)),
                  )}
                </View>
                <TextInput
                  value={editName}
                  onChangeText={(t) => setEditName(t.toUpperCase())}
                  placeholder="EJ. CARBOZULIA, CAMIÓN ROQUERO #18, OFICINA GERENCIA…"
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                />
              </Card>
            ) : null}

            <Card>
              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800', marginBottom: 4 }}>
                📍 Área / Ubicación / Frente de Trabajo (Base, Carbozulia, Flota…)
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {AC_AREAS_SUGERIDAS.map((ar) =>
                  chip(ar, editArea.toUpperCase() === ar, () => setEditArea(ar)),
                )}
              </View>
              <TextInput
                value={editArea}
                onChangeText={(t) => setEditArea(t.toUpperCase())}
                placeholder={
                  editBatchMode
                    ? 'Dejar vacío para no cambiar el área…'
                    : 'Escribe o elige el área / frente (ej. CARBOZULIA, PATIO, OFICINA)…'
                }
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </Card>

            <Card>
              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800', marginBottom: 4 }}>
                ❄️🚜 Tipo de equipo (Instalación de Base o Maquinaria / Camión / Vehículo)
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
                {AC_TIPOS_EQUIPO.map((tp) => chip(tp, editTipo === tp, () => cambiarTipoEquipo(tp)))}
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Capacidad (BTU / Toneladas) — Aires de instalación
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {AC_BTU_OPCIONES.map((b) => chip(b, editBtu === b, () => setEditBtu(b)))}
              </View>

              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
                🚜 Compresor / Sistema A/A — Maquinaria, Camiones y Camionetas
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {AC_CAPACIDAD_MAQUINARIA_OPCIONES.map((c) => chip(c, editBtu === c, () => setEditBtu(c)))}
              </View>

              <TextInput
                value={editBtu}
                onChangeText={(t) => setEditBtu(t.toUpperCase())}
                placeholder="EJ. 18.000 BTU o COMPRESOR 508"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                Marca (opcional)
              </Text>
              <TextInput
                value={editMarca}
                onChangeText={(t) => setEditMarca(t.toUpperCase())}
                placeholder="EJ. SANDEN, CATERPILLAR, LIEBHERR, LG, SAMSUNG, CARRIER…"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </Card>

            {/* Ciclo 1: Frecuencia de Mantenimiento Riguroso */}
            <Card>
              <Text style={{ color: colors.brandText, fontSize: 12.5, fontWeight: '800', marginBottom: 4 }}>
                ⏱️ Frecuencia de mantenimiento riguroso (cada cuántos días)
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 6 }}>
                Intervención técnica completa (desarme, lavado químico, revisión de gas PSI, electricidad y compresor).
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {AC_FRECUENCIAS_DIAS.map((d) =>
                  chip(`Cada ${d} días`, Number(editFreq) === d, () => setEditFreq(String(d))),
                )}
              </View>
              <TextInput
                value={editFreq}
                onChangeText={(t) => setEditFreq(onlyDecimal(t))}
                keyboardType="numeric"
                placeholder="45"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, marginBottom: 4 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Fecha de último mantenimiento riguroso previo (AAAA-MM-DD, opcional)
                </Text>
                <TouchableOpacity onPress={() => setEditLastMaint(hoy)}>
                  <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>📅 Hoy ({hoy})</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={editLastMaint}
                onChangeText={setEditLastMaint}
                placeholder={`Ej. ${hoy}`}
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </Card>

            {/* Ciclo 2: NUEVA Frecuencia de Mantenimiento Preventivo (Camión de Lavado) */}
            <Card>
              <Text style={{ color: colors.brandText, fontSize: 12.5, fontWeight: '800', marginBottom: 4 }}>
                🚿 Frecuencia de mantenimiento preventivo — Camión de lavado (cada cuántos días)
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 6 }}>
                Lavado preventivo frecuente del condensador / soplado de filtros (ej. cada 2 días por el camión de lavado en maquinaria, camiones roqueros y camionetas).
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {AC_FRECUENCIAS_PREVENTIVO_DIAS.map((d) =>
                  chip(
                    d === 0 ? 'No aplica' : d === 1 ? 'Cada 1 día (Diario)' : `Cada ${d} días`,
                    d === 0 ? !editFreqPrev || Number(editFreqPrev) === 0 : Number(editFreqPrev) === d,
                    () => setEditFreqPrev(d === 0 ? '' : String(d)),
                  ),
                )}
              </View>
              <TextInput
                value={editFreqPrev}
                onChangeText={(t) => setEditFreqPrev(onlyDecimal(t))}
                keyboardType="numeric"
                placeholder="Ej. 2 (para cada 2 días con el camión de lavado; vacío = no aplica)"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                Responsable del mantenimiento preventivo frecuente
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {AC_RESPONSABLES_PREVENTIVO.map((resp) =>
                  chip(`🚛 ${resp}`, editPrevResp.toUpperCase() === resp, () => setEditPrevResp(resp)),
                )}
              </View>
              <TextInput
                value={editPrevResp}
                onChangeText={(t) => setEditPrevResp(t.toUpperCase())}
                placeholder="CAMIÓN DE LAVADO"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, marginBottom: 4 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Fecha de último mantenimiento preventivo / lavado (AAAA-MM-DD, opcional)
                </Text>
                <TouchableOpacity onPress={() => setEditLastPrev(hoy)}>
                  <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>📅 Hoy ({hoy})</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={editLastPrev}
                onChangeText={setEditLastPrev}
                placeholder={`Ej. ${hoy}`}
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa asignada</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {chip('— Sin especificar', !editCompany, () => setEditCompany(''))}
                {generalCompanies(companies).map((c) =>
                  chip(c.name, editCompany === c.id, () => setEditCompany(c.id)),
                )}
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Estado operativo</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {chip('🟢 Operativo', editEstadoOp === 'operativo', () => setEditEstadoOp('operativo'))}
                {chip('🟡 En observación', editEstadoOp === 'observacion', () => setEditEstadoOp('observacion'))}
                {chip('🔴 Dañado / Fuera de servicio', editEstadoOp === 'dañado', () => setEditEstadoOp('dañado'))}
              </View>
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity
                onPress={() => setEditUnitModal(false)}
                style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={guardarFichaUnidad}
                disabled={savingCatalog}
                style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: savingCatalog ? 0.6 : 1 }}
              >
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>
                  {savingCatalog ? 'Guardando…' : 'Guardar configuración'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Sub-Modal: Buscador de Maquinaria / Camión / Vehículo con Placa */}
          <Modal visible={machPickerOpen} animationType="slide" onRequestClose={() => setMachPickerOpen(false)}>
            <Screen>
              <SectionTitle>🚜 Elegir Maquinaria, Camión o Vehículo</SectionTitle>
              <TextInput
                value={machQ}
                onChangeText={setMachQ}
                placeholder="🔎 Buscar por código, nombre, tipo o PLACA…"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
              <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
                {catalogoFlotaUnificado
                  .filter((it) => {
                    if (!machQ.trim()) return true;
                    return norm(`${it.code} ${it.plate} ${it.description} ${it.origen}`).includes(norm(machQ));
                  })
                  .map((it) => (
                    <TouchableOpacity
                      key={`${it.origen}-${it.id}`}
                      onPress={() => seleccionarEquipoDeFlota(it)}
                      style={{
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.xs,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13.5 }}>
                          {it.origen === 'MAQUINARIA' ? '🚜' : '🛻'} {it.code} · {it.description}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                          Tipo A/A sugerido: {it.tipoSugerido}
                          {it.companyId ? ` · 🏢 ${companyName(it.companyId)}` : ''}
                        </Text>
                      </View>
                      <View
                        style={{
                          backgroundColor: colors.infoSoftBg,
                          borderWidth: 1,
                          borderColor: colors.infoSoftBorder,
                          borderRadius: radius.sm,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                        }}
                      >
                        <Text style={{ color: colors.infoSoftText, fontWeight: '900', fontSize: 11.5 }}>
                          🏷️ PLACA: {it.plate}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
              <TouchableOpacity
                onPress={() => setMachPickerOpen(false)}
                style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
            </Screen>
          </Modal>
        </Screen>
      </Modal>

      {/* ── MODAL 2: Registrar / Editar Mantenimiento (1 o Varias Unidades) ── */}
      <Modal
        visible={maintOpen}
        animationType="slide"
        onRequestClose={() => {
          setMaintOpen(false);
          setEditingMaintId(null);
          setEditingMaintCode(null);
        }}
      >
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>
              {editingMaintId
                ? `✏️ Editar Mantenimiento ${editingMaintCode || ''}`
                : '🛠️ Registrar Mantenimiento de Aires'}
            </SectionTitle>

            {/* 1. Selección de unidades intervenidas (con Buscador y Placa obligatoria) */}
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>
                  1. Unidades atendidas ({maintUnits.length} seleccionada{maintUnits.length === 1 ? '' : 's'})
                </Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    onPress={() =>
                      setMaintUnits(
                        unidadesCalc
                          .filter((u) => u.semaforo === 'vencido' || u.semaforo === 'proximo')
                          .map((u) => u.code),
                      )
                    }
                  >
                    <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>+ Vencidos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setMaintUnits([])}>
                    <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Limpiar</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TextInput
                value={maintUnitQ}
                onChangeText={setMaintUnitQ}
                placeholder="🔎 Buscar unidad o maquinaria por código, área o PLACA…"
                placeholderTextColor={colors.muted}
                style={[inputStyle, { marginBottom: 8 }]}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {unidadesCalc
                  .filter((u) => {
                    if (!maintUnitQ.trim()) return true;
                    const hay = norm(`${u.code} ${u.name} ${u.area} ${u.placa || ''} ${u.tipo_equipo} ${u.btu}`);
                    return hay.includes(norm(maintUnitQ)) || maintUnits.includes(u.code);
                  })
                  .map((u) => {
                    const on = maintUnits.includes(u.code);
                    const esMovil = esEquipoMovilAc(u.tipo_equipo) || Boolean(u.machinery_id);
                    const placaLabel = u.placa ? ` [PLACA: ${u.placa}]` : esMovil ? ' [SIN PLACA]' : '';
                    return (
                      <TouchableOpacity
                        key={u.code}
                        onPress={() => toggleMaintUnit(u.code)}
                        style={{
                          borderRadius: radius.pill,
                          borderWidth: 1,
                          borderColor: on ? colors.brand : colors.border,
                          backgroundColor: on ? colors.brand : colors.surfaceAlt,
                          paddingHorizontal: 9,
                          paddingVertical: 4,
                        }}
                      >
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 11, fontWeight: '700' }}>
                          {on ? '✓ ' : ''}{u.code}{placaLabel} ({u.area})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>
            </Card>

            {/* 2. Tipo de intervención y Checklist Riguroso */}
            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: 4 }}>
                2. Tipo de intervención
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
                {AC_TIPOS_INTERVENCION.map((tp) => chip(tp, maintTipo === tp, () => setMaintTipo(tp)))}
              </View>

              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: 4 }}>
                ☑️ Checklist de mantenimiento realizado
              </Text>
              <View style={{ gap: 5 }}>
                {AC_CHECKLIST_RIGUROSO.map((item) => {
                  const on = maintChecklist.includes(item);
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => toggleChecklistItem(item)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingVertical: 5,
                        paddingHorizontal: 8,
                        borderRadius: radius.sm,
                        backgroundColor: on ? colors.infoSoftBg : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: on ? colors.infoSoftBorder : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 14 }}>{on ? '☑️' : '⬜'}</Text>
                      <Text style={{ color: colors.text, fontSize: 12, fontWeight: on ? '700' : '500', flex: 1 }}>{item}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                Observación técnica adicional (presión PSI, amperaje, repuesto cambiado…)
              </Text>
              <TextInput
                value={maintDetalle}
                onChangeText={setMaintDetalle}
                placeholder="Ej. Presión 65 PSI, compresor 508, se limpió serpentín y drenaje…"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </Card>

            {/* 3. Empresa, Proveedor, Fecha, Precio / IVA / BCV y Presupuestos */}
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
                {generalCompanies(companies).map((c) =>
                  chip(c.name, maintCompany === c.id, () => setMaintCompany(c.id)),
                )}
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Proveedor / Técnico de refrigeración
              </Text>
              <TextInput
                value={provQ}
                onChangeText={setProvQ}
                placeholder="🔎 Buscar proveedor…"
                placeholderTextColor={colors.muted}
                style={[inputStyle, { marginBottom: 6 }]}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {chip('— Ninguno / Interno (Camión de lavado)', !maintSupplier, () => setMaintSupplier(''))}
                {suppliers
                  .filter((s) => !provQ.trim() || s.name.toLowerCase().includes(provQ.trim().toLowerCase()) || maintSupplier === s.id)
                  .map((s) => chip(s.name, maintSupplier === s.id, () => setMaintSupplier(s.id)))}
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                <TextInput
                  value={nuevoProv}
                  onChangeText={setNuevoProv}
                  placeholder="Crear nuevo proveedor…"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  style={[inputStyle, { flex: 1 }]}
                />
                <TouchableOpacity
                  onPress={crearProveedorRapido}
                  disabled={creandoProv || !nuevoProv.trim()}
                  style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: creandoProv || !nuevoProv.trim() ? 0.5 : 1 }}
                >
                  <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{creandoProv ? '…' : '+ Crear'}</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, marginBottom: 4 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Fecha del mantenimiento (AAAA-MM-DD)
                </Text>
                <TouchableOpacity onPress={() => setMaintDate(hoy)}>
                  <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>📅 Hoy ({hoy})</Text>
                </TouchableOpacity>
              </View>
              <TextInput value={maintDate} onChangeText={setMaintDate} placeholder={hoy} placeholderTextColor={colors.muted} style={inputStyle} />

              {/* Bloque Homologado de Moneda, Modo de Precio e IVA (16%) */}
              <View
                style={{
                  marginTop: spacing.sm,
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: 6,
                }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12.5 }}>
                  💵 Costo del servicio, Moneda (USD / Bs BCV) y Desglose de IVA
                </Text>

                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>Moneda en que ingresas el monto:</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {chip('💵 Dólares ($ USD)', maintMoneda === 'USD', () => setMaintMoneda('USD'))}
                  {chip(
                    `🇻🇪 Bolívares (Bs BCV${tasaBcvActiva > 0 ? ` · Tasa ${tasaBcvActiva.toFixed(2)}` : ''})`,
                    maintMoneda === 'VES',
                    () => setMaintMoneda('VES'),
                  )}
                </View>

                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 2 }}>Modo de cálculo:</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {chip('🎯 Precio por unidad (c/u)', modoPrecio === 'unitario', () => setModoPrecio('unitario'))}
                  {chip('📦 Monto total global', modoPrecio === 'total', () => setModoPrecio('total'))}
                </View>

                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 2 }}>Tratamiento del IVA (16%):</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {chip('✅ Precio ya incluye IVA (16%)', maintIvaModo === 'incluye_iva', () => setMaintIvaModo('incluye_iva'))}
                  {chip('➕ Más IVA (+16%)', maintIvaModo === 'mas_iva', () => setMaintIvaModo('mas_iva'))}
                  {chip('⚪ Exento / Sin IVA (0%)', maintIvaModo === 'exento', () => setMaintIvaModo('exento'))}
                </View>

                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 2 }}>
                  Monto ({maintMoneda === 'VES' ? 'Bs' : '$ USD'}) — {modoPrecio === 'unitario' ? 'por cada aire' : 'total global'}:
                </Text>
                <TextInput
                  value={precioTexto}
                  onChangeText={(t) => setPrecioTexto(onlyDecimal(t))}
                  keyboardType="decimal-pad"
                  placeholder={maintMoneda === 'VES' ? '0.00 Bs' : '0.00 $'}
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                />

                {/* Tarjeta de Resumen Financiero en Vivo */}
                <View
                  style={{
                    marginTop: 4,
                    padding: 8,
                    borderRadius: radius.sm,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.brand,
                    gap: 3,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: '700' }}>
                      Base imponible (Subtotal sin IVA):
                    </Text>
                    <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>{usd(subtotalMaintUsd)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: '700' }}>
                      IVA ({alicuotaIvaMaint}%{maintIvaModo === 'exento' ? ' · Exento' : ''}):
                    </Text>
                    <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>{usd(ivaMaintUsd)}</Text>
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      paddingTop: 4,
                      marginTop: 2,
                    }}
                  >
                    <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '900' }}>
                      TOTAL A PAGAR ({maintUnits.length || 1} u.):
                    </Text>
                    <Text style={{ color: colors.brandText, fontSize: 13.5, fontWeight: '900' }}>
                      {usd(totalMaintCalc)} ({usd(precioUnitarioCalc)} c/u)
                    </Text>
                  </View>
                  {equivalenteMaintVes > 0 ? (
                    <Text style={{ color: colors.infoSoftText, fontSize: 11.5, fontWeight: '800', textAlign: 'right' }}>
                      🇻🇪 Equivalente a tasa BCV ({tasaBcvActiva.toFixed(2)} Bs/$): ≈ {ves(equivalenteMaintVes)}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* Repuesto del inventario opcional */}
              <TouchableOpacity
                onPress={() => setUsaInv((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm }}
              >
                <Text style={{ fontSize: 15 }}>{usaInv ? '☑️' : '⬜'}</Text>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
                  📦 Descontar repuesto del inventario (compresor, filtro, capacitor, gas…)
                </Text>
              </TouchableOpacity>
              {usaInv ? (
                <TouchableOpacity
                  onPress={() => { setInvQ(''); setInvPickerOpen(true); }}
                  style={[inputStyle, { marginTop: 6 }]}
                >
                  <Text style={{ color: invItemName ? colors.text : colors.muted, fontWeight: invItemName ? '700' : '400' }}>
                    📦 {invItemName || 'Toca para buscar repuesto del inventario…'}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {/* Presupuestos / Cotizaciones / Facturas adjuntas (múltiples PDFs o Fotos) */}
              <View
                style={{
                  marginTop: spacing.sm,
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: 6,
                }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12.5 }}>
                  📎 Presupuesto / Cotización / Factura ({maintPresupuestos.length})
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  Sube el presupuesto, cotización o factura en PDF o foto. Se verá tanto aquí en el historial del aire como en Cuentas por Pagar.
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <TouchableOpacity
                    onPress={adjuntarPresupuestosMaint}
                    disabled={subiendoFactura}
                    style={{
                      flexGrow: 1,
                      backgroundColor: colors.brand,
                      borderRadius: radius.md,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      alignItems: 'center',
                      opacity: subiendoFactura ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                      {subiendoFactura ? '⏳ Subiendo…' : '📄 Subir Presupuesto / PDF / Imagen'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={tomarFotoPresupuestoMaint}
                    disabled={subiendoFactura}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.brand,
                      borderRadius: radius.md,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      alignItems: 'center',
                      opacity: subiendoFactura ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                      📷 Tomar foto
                    </Text>
                  </TouchableOpacity>
                </View>

                {maintPresupuestos.length > 0 ? (
                  <View style={{ gap: 5, marginTop: 4 }}>
                    {maintPresupuestos.map((doc, idx) => (
                      <View
                        key={`${doc.id}-${idx}`}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radius.sm,
                          paddingHorizontal: 8,
                          paddingVertical: 5,
                          gap: 6,
                        }}
                      >
                        <TouchableOpacity
                          onPress={() => abrirVistaPreviaAdjunto({ url: doc.url, kind: doc.kind, name: doc.name })}
                          style={{ flex: 1 }}
                        >
                          <Text style={{ color: colors.brandText, fontSize: 11.5, fontWeight: '800' }} numberOfLines={1}>
                            {doc.kind === 'pdf' ? '📄 PDF' : '🖼️ Foto'} · {doc.name} (Toca para ver)
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => quitarPresupuestoMaint(doc.id || doc.url)}
                          style={{
                            backgroundColor: colors.dangerSoftBg,
                            borderWidth: 1,
                            borderColor: colors.dangerSoftBorder,
                            borderRadius: radius.pill,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                          }}
                        >
                          <Text style={{ color: colors.dangerSoftText, fontSize: 10.5, fontWeight: '800' }}>✕ Quitar</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </Card>

            {/* 4. Condiciones de Pago y Envío Directo a Cuentas por Pagar */}
            <Card>
              <Text style={{ color: colors.brandText, fontSize: 12.5, fontWeight: '800', marginBottom: 4 }}>
                💳 Condiciones de pago y Nota para Pagos
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {CONDICIONES_PAGO_CHIPS.map((chipLabel) => {
                  const activo = maintCondicionesPago.toUpperCase().includes(chipLabel.toUpperCase());
                  return (
                    <TouchableOpacity
                      key={chipLabel}
                      onPress={() => {
                        const next = toggleChipCondicionPago(maintCondicionesPago, chipLabel);
                        setMaintCondicionesPago(next);
                        const dias = detectarDiasCreditoChip(chipLabel);
                        if (dias !== null && !activo) {
                          setMaintVenceCxp(sumarDiasAc(maintDate || hoy, dias));
                        }
                      }}
                      style={{
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: activo ? colors.brand : colors.border,
                        backgroundColor: activo ? colors.brand : colors.surfaceAlt,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 5,
                      }}
                    >
                      <Text style={{ color: activo ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>
                        {activo ? `✓ ${chipLabel}` : chipLabel}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                value={maintCondicionesPago}
                onChangeText={(t) => setMaintCondicionesPago(t.toUpperCase())}
                placeholder="EJ. CONTADO, EL MONTO REFLEJADO YA INCLUYE EL IVA. PAGAR EN BOLIVARES A TASA DOLAR BCV…"
                placeholderTextColor={colors.muted}
                style={[inputStyle, { marginBottom: spacing.xs }]}
              />

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>📝 Nota / Instrucciones para Pagos (opcional)</Text>
              <TextInput
                value={maintNota}
                onChangeText={(t) => setMaintNota(t.toUpperCase())}
                placeholder="OBSERVACIÓN O INSTRUCCIÓN DE PAGO…"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />

              <TouchableOpacity
                onPress={() => setMaintEnviarCxp((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}
              >
                <Text style={{ fontSize: 16 }}>{maintEnviarCxp ? '☑️' : '⬜'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '800' }}>
                    💸 Enviar / Sincronizar con Cuentas por Pagar (con presupuesto, IVA y condiciones)
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    Registra o actualiza automáticamente la cuenta en «💳 Por pagar» (Esperando aprobación / Todas) sin duplicar.
                  </Text>
                </View>
              </TouchableOpacity>
              {maintEnviarCxp ? (
                <View style={{ marginTop: 6 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 3 }}>Fecha de vencimiento (AAAA-MM-DD, opcional)</Text>
                  <TextInput value={maintVenceCxp} onChangeText={setMaintVenceCxp} placeholder="Sin fecha = no vence" placeholderTextColor={colors.muted} style={inputStyle} />
                </View>
              ) : null}
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity
                onPress={() => {
                  setMaintOpen(false);
                  setEditingMaintId(null);
                  setEditingMaintCode(null);
                }}
                style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={guardarMantenimiento}
                disabled={savingMaint}
                style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: savingMaint ? 0.6 : 1 }}
              >
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>
                  {savingMaint
                    ? 'Guardando…'
                    : editingMaintId
                      ? 'Guardar cambios'
                      : 'Registrar mantenimiento'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Selector de repuesto del inventario */}
          <Modal visible={invPickerOpen} animationType="slide" onRequestClose={() => setInvPickerOpen(false)}>
            <Screen>
              <SectionTitle>Elegir repuesto del inventario</SectionTitle>
              <TextInput value={invQ} onChangeText={setInvQ} placeholder="Busca el repuesto…" placeholderTextColor={colors.muted} style={inputStyle} />
              <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
                {invItems
                  .filter((it) => !invQ.trim() || norm(it.name).includes(norm(invQ)))
                  .slice(0, 60)
                  .map((it) => (
                    <TouchableOpacity
                      key={it.id}
                      onPress={() => {
                        setInvItemId(it.id);
                        setInvItemName(it.name);
                        setInvPickerOpen(false);
                      }}
                      style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{it.name}</Text>
                      {it.unit ? <Text style={{ color: colors.muted, fontSize: 12 }}>{it.unit}</Text> : null}
                    </TouchableOpacity>
                  ))}
              </ScrollView>
              <TouchableOpacity
                onPress={() => setInvPickerOpen(false)}
                style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
            </Screen>
          </Modal>
        </Screen>
      </Modal>

      {/* ── MODAL 3: Visor de Presupuesto / Cotización / Factura (Imagen o PDF) ── */}
      <Modal visible={Boolean(previewDoc)} animationType="fade" onRequestClose={() => setPreviewDoc(null)}>
        <Screen>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, flexWrap: 'wrap', gap: 8 }}>
            <SectionTitle>
              {previewDoc?.kind === 'pdf' ? '📄 Presupuesto / Soporte PDF' : '🖼️ Presupuesto / Soporte'}
            </SectionTitle>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {previewUrlSegura ? (
                <TouchableOpacity
                  onPress={abrirAdjuntoFuera}
                  style={{
                    backgroundColor: colors.brand,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                  }}
                >
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                    ↗ Abrir / Descargar original
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => setPreviewDoc(null)}
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>✕ Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
            {previewDoc?.name}
          </Text>
          {previewDoc && !previewUrlSegura ? (
            <Card>
              <Text style={{ color: colors.text, fontSize: 13 }}>
                Este adjunto tiene una dirección no permitida (no es del almacenamiento del sistema) y no se muestra.
              </Text>
            </Card>
          ) : null}
          {previewDoc && previewUrlSegura ? (
            previewDoc.kind === 'pdf' ? (
              Platform.OS === 'web' ? (
                <View style={{ flex: 1, minHeight: 520, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
                  {React.createElement('iframe', {
                    src: previewUrlSegura,
                    style: { width: '100%', height: 560, border: 'none' },
                    title: previewDoc.name,
                  })}
                </View>
              ) : (
                <Card>
                  <Text style={{ color: colors.text, fontSize: 13, marginBottom: spacing.sm }}>
                    Este presupuesto está en formato PDF ({previewDoc.name}). Toca el botón para abrirlo en el visor de tu teléfono.
                  </Text>
                  <TouchableOpacity
                    onPress={abrirAdjuntoFuera}
                    style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}
                  >
                    <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>📄 Abrir PDF</Text>
                  </TouchableOpacity>
                </Card>
              )
            ) : (
              <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: spacing.xl }}>
                <Image
                  source={{ uri: previewUrlSegura }}
                  style={{ width: '100%', height: 520, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}
                  resizeMode="contain"
                />
              </ScrollView>
            )
          ) : null}
        </Screen>
      </Modal>
    </Screen>
  );
}
