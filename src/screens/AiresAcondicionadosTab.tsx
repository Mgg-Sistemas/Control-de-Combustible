// ============================================================================
// ❄️ AIRES ACONDICIONADOS — Control Riguroso de las 37 Unidades de la Base
// ============================================================================
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Linking, Platform, Image } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { useTable } from '../hooks/useTable';
import { Company, Supplier, ServicioRecord, ServicioItem } from '../types/database';
import { generalCompanies } from '../lib/companies';
import { pickAndUploadDocFile } from '../lib/photo';
import { exportPdf } from '../lib/pdf';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { norm, onlyDecimal } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import {
  CONDICIONES_PAGO_CHIPS,
  detectarDiasCreditoChip,
  toggleChipCondicionPago,
  inyectarCondicionesPagoEnNota,
} from '../lib/cuentasPago';
import { inyectarEmpresaEnNota } from '../lib/cuentasEmpresa';
import {
  AC_MASTER_CODE,
  AC_CATEGORIA_SERVICIO,
  AC_AREAS_SUGERIDAS,
  AC_BTU_OPCIONES,
  AC_TIPOS_EQUIPO,
  AC_FRECUENCIAS_DIAS,
  AC_TIPOS_INTERVENCION,
  AC_CHECKLIST_RIGUROSO,
  AcUnit,
  AcUnitCalc,
  AcSemaforo,
  AcTipoEquipo,
  AcEstadoOperativo,
  extraerCatalogoAiresDeServicios,
  serializarCatalogoAiresParaServicios,
  calcularSemaforoAires,
  hoyAcISO,
  sumarDiasAc,
  fmtFechaAc,
  reporteAiresHtml,
} from '../lib/airesAcondicionados';

const usd = (n: number) =>
  `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

type Inv = { id: string; name: string; unit: string | null };

export function AiresAcondicionadosTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const hoy = hoyAcISO();

  const { data: serviciosRaw, loading, refetch } = useTable<ServicioRecord>('servicios', {
    orderBy: 'created_at',
    ascending: false,
    realtimeFrom: 'servicios',
  });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: suppliers, refetch: refetchSuppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: invItems } = useTable<Inv>('inventory_items', { select: 'id, name, unit', orderBy: 'name' });

  const companyName = (id: string | null) =>
    id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa';
  const supplierName = (id: string | null) =>
    id ? suppliers.find((s) => s.id === id)?.name ?? '—' : '—';

  // Catálogo de las 37 unidades extraído de Supabase (con fallback automático a las 37 unidades base)
  const unidadesCatalogo = useMemo(
    () => extraerCatalogoAiresDeServicios(serviciosRaw),
    [serviciosRaw],
  );

  // Semáforo riguroso calculado en tiempo real cruzando las 37 unidades con sus servicios
  const unidadesCalc = useMemo(
    () => calcularSemaforoAires(unidadesCatalogo, serviciosRaw, hoy),
    [unidadesCatalogo, serviciosRaw, hoy],
  );

  // Filtros de pantalla
  const [filtroSemaforo, setFiltroSemaforo] = useState<'todos' | AcSemaforo>('todos');
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

  // KPIs del Semáforo Riguroso
  const kpis = useMemo(() => {
    let alDia = 0;
    let proximo = 0;
    let vencido = 0;
    let sinRegistro = 0;
    let gastoTotal = 0;
    for (const u of unidadesCalc) {
      if (u.semaforo === 'al_dia') alDia++;
      else if (u.semaforo === 'proximo') proximo++;
      else if (u.semaforo === 'vencido') vencido++;
      else sinRegistro++;
      gastoTotal += u.gastoAcumuladoUsd || 0;
    }
    return { total: unidadesCalc.length, alDia, proximo, vencido, sinRegistro, gastoTotal };
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
      if (filtroSemaforo !== 'todos' && u.semaforo !== filtroSemaforo) return false;
      if (filtroArea !== 'TODAS' && (u.area || 'BASE GENERAL').trim().toUpperCase() !== filtroArea) return false;
      if (nq) {
        const hay = norm(
          [u.code, u.name, u.area, u.tipo_equipo, u.btu, u.marca, u.serial, u.notes, companyName(u.company_id)].join(' '),
        );
        if (!hay.includes(nq)) return false;
      }
      return true;
    });
  }, [unidadesCalc, filtroSemaforo, filtroArea, q, companies]);

  // ── Persistencia del Catálogo de las 37 Unidades en `public.servicios` ──────
  const [savingCatalog, setSavingCatalog] = useState(false);

  const guardarCatalogoEnSupabase = async (nuevasUnidades: AcUnit[], msgExito?: string) => {
    if (!canWrite) return toast.error('No tienes permiso de escritura en Compras.');
    setSavingCatalog(true);
    try {
      const masterExistente = serviciosRaw.find((s) => s.code === AC_MASTER_CODE);
      const itemsJson = serializarCatalogoAiresParaServicios(nuevasUnidades);
      const payload = {
        code: AC_MASTER_CODE,
        company_id: generalCompanies(companies)[0]?.id ?? null,
        supplier_id: null,
        service_date: hoy,
        items: itemsJson,
        total: 0,
        note: 'CATÁLOGO MAESTRO DE LAS 37 UNIDADES DE AIRE ACONDICIONADO',
      };
      const { error } = masterExistente
        ? await supabase
            .from('servicios')
            .update({ items: itemsJson, updated_at: new Date().toISOString() })
            .eq('id', masterExistente.id)
        : await supabase
            .from('servicios')
            .insert({ ...payload, created_by: session?.user?.id ?? null });
      if (error) {
        toast.error(error.message);
        return false;
      }
      await refetch();
      if (msgExito) toast.success(msgExito);
      return true;
    } finally {
      setSavingCatalog(false);
    }
  };

  // ── Modal de Edición de Ficha de 1 Unidad (o Lote de Unidades) ──────────────
  const [editUnitModal, setEditUnitModal] = useState(false);
  const [editBatchMode, setEditBatchMode] = useState(false);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editArea, setEditArea] = useState('OFICINA PRINCIPAL');
  const [editTipo, setEditTipo] = useState<AcTipoEquipo>('SPLIT');
  const [editBtu, setEditBtu] = useState('18.000 BTU');
  const [editMarca, setEditMarca] = useState('');
  const [editSerial, setEditSerial] = useState('');
  const [editCompany, setEditCompany] = useState<string>('');
  const [editFreq, setEditFreq] = useState('30');
  const [editEstadoOp, setEditEstadoOp] = useState<AcEstadoOperativo>('operativo');
  const [editLastMaint, setEditLastMaint] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const abrirEditarUnidad = (u: AcUnitCalc) => {
    setEditBatchMode(false);
    setEditCode(u.code);
    setEditName(u.name);
    setEditArea(u.area || 'BASE GENERAL');
    setEditTipo(u.tipo_equipo || 'SPLIT');
    setEditBtu(u.btu || '18.000 BTU');
    setEditMarca(u.marca || '');
    setEditSerial(u.serial || '');
    setEditCompany(u.company_id ?? '');
    setEditFreq(String(u.freq_days || 30));
    setEditEstadoOp(u.estado_operativo || 'operativo');
    setEditLastMaint(u.last_maint_manual || '');
    setEditNotes(u.notes || '');
    setEditUnitModal(true);
  };

  const abrirConfigurarLote = () => {
    if (selCodes.size === 0) {
      return toast.error('Marca primero (☑) las unidades que deseas configurar en lote.');
    }
    setEditBatchMode(true);
    setEditCode(`${selCodes.size} unidad(es)`);
    setEditName('');
    setEditArea('');
    setEditBtu('');
    setEditMarca('');
    setEditCompany('');
    setEditFreq('30');
    setEditEstadoOp('operativo');
    setEditLastMaint('');
    setEditNotes('');
    setEditUnitModal(true);
  };

  const guardarFichaUnidad = async () => {
    const freqNum = Math.max(1, Math.round(leerNumero(editFreq) || 30));
    if (editLastMaint.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(editLastMaint.trim())) {
      return toast.error('La fecha de último mantenimiento debe tener formato AAAA-MM-DD.');
    }
    if (editBatchMode) {
      const nuevas = unidadesCatalogo.map((u) => {
        if (!selCodes.has(u.code)) return u;
        return {
          ...u,
          area: editArea.trim() ? editArea.trim().toUpperCase() : u.area,
          tipo_equipo: editTipo || u.tipo_equipo,
          btu: editBtu.trim() ? editBtu.trim().toUpperCase() : u.btu,
          marca: editMarca.trim() ? editMarca.trim().toUpperCase() : u.marca,
          company_id: editCompany ? editCompany : u.company_id,
          freq_days: freqNum,
          estado_operativo: editEstadoOp,
          last_maint_manual: editLastMaint.trim() || u.last_maint_manual,
        };
      });
      const ok = await guardarCatalogoEnSupabase(nuevas, `${selCodes.size} unidad(es) actualizadas.`);
      if (ok) setEditUnitModal(false);
      return;
    }

    const codeClean = editCode.trim().toUpperCase();
    if (!codeClean) return toast.error('El código de la unidad es obligatorio.');
    const existe = unidadesCatalogo.some((u) => u.code === codeClean);
    const unidadActualizada: AcUnit = {
      id: codeClean,
      code: codeClean,
      name: editName.trim().toUpperCase() || `UNIDAD ${codeClean}`,
      area: editArea.trim().toUpperCase() || 'BASE GENERAL',
      tipo_equipo: editTipo,
      btu: editBtu.trim().toUpperCase() || '18.000 BTU',
      marca: editMarca.trim().toUpperCase(),
      serial: editSerial.trim().toUpperCase(),
      company_id: editCompany || null,
      freq_days: freqNum,
      estado_operativo: editEstadoOp,
      last_maint_manual: editLastMaint.trim() || null,
      notes: editNotes.trim().toUpperCase(),
      active: true,
    };
    const nuevas = existe
      ? unidadesCatalogo.map((u) => (u.code === codeClean ? unidadActualizada : u))
      : [...unidadesCatalogo, unidadActualizada];
    const ok = await guardarCatalogoEnSupabase(nuevas, `Ficha de ${codeClean} guardada.`);
    if (ok) setEditUnitModal(false);
  };

  const abrirNuevaUnidadExtra = () => {
    const nextNum = unidadesCatalogo.length + 1;
    const nextCode = `AA-${String(nextNum).padStart(2, '0')}`;
    setEditBatchMode(false);
    setEditCode(nextCode);
    setEditName(`UNIDAD ${nextCode}`);
    setEditArea('BASE GENERAL');
    setEditTipo('SPLIT');
    setEditBtu('18.000 BTU');
    setEditMarca('');
    setEditSerial('');
    setEditCompany(generalCompanies(companies)[0]?.id ?? '');
    setEditFreq('30');
    setEditEstadoOp('operativo');
    setEditLastMaint('');
    setEditNotes('');
    setEditUnitModal(true);
  };

  // ── Modal de Registro de Mantenimiento Riguroso (1 o Varias Unidades) ──────
  const [maintOpen, setMaintOpen] = useState(false);
  const [maintUnits, setMaintUnits] = useState<string[]>([]);
  const [maintCompany, setMaintCompany] = useState('');
  const [maintSupplier, setMaintSupplier] = useState('');
  const [maintDate, setMaintDate] = useState(hoy);
  const [maintTipo, setMaintTipo] = useState<string>(AC_TIPOS_INTERVENCION[0]);
  const [maintChecklist, setMaintChecklist] = useState<string[]>([...AC_CHECKLIST_RIGUROSO.slice(0, 6)]);
  const [modoPrecio, setModoPrecio] = useState<'unitario' | 'total'>('unitario');
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
  const [maintFactura, setMaintFactura] = useState<{ url: string; kind: 'image' | 'pdf'; name: string } | null>(null);
  const [subiendoFactura, setSubiendoFactura] = useState(false);
  const [savingMaint, setSavingMaint] = useState(false);
  const [provQ, setProvQ] = useState('');
  const [nuevoProv, setNuevoProv] = useState('');
  const [creandoProv, setCreandoProv] = useState(false);

  const abrirMantenimiento = (codesIniciales?: string[]) => {
    const elegidos =
      codesIniciales && codesIniciales.length > 0
        ? codesIniciales
        : selCodes.size > 0
          ? Array.from(selCodes)
          : [];
    const primeraUnidad = elegidos.length === 1 ? unidadesCatalogo.find((u) => u.code === elegidos[0]) : null;
    setMaintUnits(elegidos);
    setMaintCompany(primeraUnidad?.company_id || generalCompanies(companies)[0]?.id || '');
    setMaintSupplier('');
    setMaintDate(hoy);
    setMaintTipo(AC_TIPOS_INTERVENCION[0]);
    setMaintChecklist([...AC_CHECKLIST_RIGUROSO.slice(0, 6)]);
    setModoPrecio('unitario');
    setPrecioTexto('');
    setUsaInv(false);
    setInvItemId(null);
    setInvItemName('');
    setMaintDetalle('');
    setMaintCondicionesPago('');
    setMaintNota('');
    setMaintEnviarCxp(false);
    setMaintVenceCxp('');
    setMaintFactura(null);
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

  const adjuntarFacturaMaint = async () => {
    setSubiendoFactura(true);
    try {
      const res = await pickAndUploadDocFile('servicios', `ac-${Date.now()}`);
      if (res?.url) {
        setMaintFactura({ url: res.url, kind: (res.kind as any) ?? 'image', name: res.name ?? 'factura' });
        toast.success('Factura adjuntada.');
      }
    } finally {
      setSubiendoFactura(false);
    }
  };

  const montoNumerico = leerNumero(precioTexto);
  const cantUnidadesMaint = Math.max(1, maintUnits.length);
  const precioUnitarioCalc =
    modoPrecio === 'unitario'
      ? montoNumerico
      : Math.round((montoNumerico / cantUnidadesMaint) * 100) / 100;
  const totalMaintCalc =
    modoPrecio === 'unitario'
      ? Math.round(montoNumerico * maintUnits.length * 100) / 100
      : Math.round(montoNumerico * 100) / 100;

  const guardarMantenimiento = async () => {
    if (!maintCompany) return toast.error('Elige la empresa.');
    if (maintUnits.length === 0) return toast.error('Selecciona al menos una unidad de aire acondicionado (ej. AA-01).');
    if (usaInv && !invItemId) return toast.error('Elige el repuesto del inventario o desmarca la casilla de repuesto.');
    if (maintEnviarCxp && !maintSupplier) {
      return toast.error('Para enviar a Cuentas por Pagar debes elegir el Proveedor.');
    }
    if (maintEnviarCxp && !(totalMaintCalc > 0)) {
      return toast.error('Para enviar a Cuentas por Pagar coloca el monto del servicio.');
    }

    const checklistResumen = maintChecklist.length > 0 ? `[${maintChecklist.join(', ')}]` : '';
    const detalleCombinado = [checklistResumen, maintDetalle.trim()].filter(Boolean).join(' · ');

    const renglones: (ServicioItem & Record<string, any>)[] = maintUnits.map((code, idx) => {
      const u = unidadesCatalogo.find((x) => x.code === code);
      const label = u ? `❄️ ${u.code} · ${u.area} · ${u.tipo_equipo} ${u.btu}` : `❄️ ${code}`;
      // Solo descontar repuesto en el primer renglón o en cada uno según corresponda
      const descuentaAqui = usaInv && idx === 0;
      return {
        categoria: AC_CATEGORIA_SERVICIO,
        tipo: maintTipo,
        machinery_id: null,
        machine_label: label,
        qty: 1,
        price: precioUnitarioCalc,
        usa_inventario: descuentaAqui,
        item_id: descuentaAqui ? invItemId : null,
        item_name: descuentaAqui ? invItemName : '',
        detalle: detalleCombinado,
        ac_unit_id: code,
        ac_unit_code: code,
        ac_unit_area: u?.area || 'BASE GENERAL',
        ac_unit_btu: u?.btu || '18.000 BTU',
        ac_checklist: maintChecklist,
      };
    });

    const notaFinalSrv = inyectarCondicionesPagoEnNota(
      maintNota.trim().toUpperCase() || null,
      maintCondicionesPago.trim().toUpperCase() || null,
    );

    setSavingMaint(true);
    const { data: srvIns, error: errSrv } = await supabase
      .from('servicios')
      .insert({
        company_id: maintCompany,
        supplier_id: maintSupplier || null,
        service_date: maintDate || hoy,
        items: renglones,
        total: totalMaintCalc,
        factura_url: maintFactura?.url ?? null,
        factura_type: maintFactura?.kind ?? null,
        factura_name: maintFactura?.name ?? null,
        note: notaFinalSrv,
        created_by: session?.user?.id ?? null,
      })
      .select('id, code')
      .single();

    if (errSrv) {
      setSavingMaint(false);
      return toast.error(errSrv.message);
    }

    // Si marcó Enviar a Cuentas por Pagar, creamos la deuda con sus Condiciones de Pago y Nota
    if (maintEnviarCxp && maintSupplier && totalMaintCalc > 0) {
      const srvCode = srvIns?.code || 'SRV-AC';
      const codigosTxt =
        maintUnits.length <= 6
          ? maintUnits.join(', ')
          : `${maintUnits.slice(0, 6).join(', ')} y ${maintUnits.length - 6} más`;
      const conceptoCxp = `MANTENIMIENTO AIRES (${codigosTxt}) · ${maintTipo} · ${srvCode}`.slice(0, 220);
      let notaCxp = maintNota.trim().toUpperCase() || `MANTENIMIENTO DE ${maintUnits.length} UNIDAD(ES): ${codigosTxt}`;
      notaCxp = inyectarEmpresaEnNota(notaCxp, maintCompany, companyName(maintCompany)) || '';
      notaCxp = inyectarCondicionesPagoEnNota(notaCxp, maintCondicionesPago.trim().toUpperCase()) || '';

      const { error: errCxp } = await supabase.from('cuentas').insert({
        tipo: 'por_pagar',
        supplier_id: maintSupplier,
        company_id: null,
        concepto: conceptoCxp,
        documento: srvCode,
        factura_url: maintFactura?.url ?? null,
        monto: totalMaintCalc,
        fecha_emision: maintDate || hoy,
        fecha_vencimiento: maintVenceCxp.trim() || null,
        estado: 'pendiente',
        nota: notaCxp || null,
        created_by: session?.user?.id ?? null,
      });
      if (errCxp) {
        setSavingMaint(false);
        setMaintOpen(false);
        refetch();
        return toast.error(`Mantenimiento registrado, pero falló envío a Por Pagar: ${errCxp.message}`);
      }
    }

    setSavingMaint(false);
    setMaintOpen(false);
    setSelCodes(new Set());
    await refetch();
    toast.success(
      maintEnviarCxp
        ? `Mantenimiento de ${maintUnits.length} aire(s) registrado y enviado a Cuentas por Pagar.`
        : `Mantenimiento de ${maintUnits.length} aire(s) registrado. Semáforo actualizado.`,
    );
  };

  // Exportar Reporte PDF del Control Riguroso de Aires Acondicionados
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

  const semaforoColors = (sem: AcSemaforo) => {
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
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>+ Unidad</Text>
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
        Control riguroso de las {kpis.total} unidades de aire acondicionado en la base (AA-01 a AA-37): ubicación, BTU, ciclo de mantenimiento, checklist técnico y envío directo a Cuentas por Pagar.
      </Text>

      {/* Tarjetas KPI interactivas del Semáforo Riguroso (responsivas en móvil y PC) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {([
          { key: 'todos', label: '❄️ TOTAL BASE', val: kpis.total, color: colors.brandText, border: colors.brand },
          { key: 'al_dia', label: '🟢 AL DÍA', val: kpis.alDia, color: colors.successSoftText, border: colors.success },
          { key: 'proximo', label: '🟠 PRÓXIMOS', val: kpis.proximo, color: colors.warningSoftText, border: colors.warning },
          { key: 'vencido', label: '🔴 VENCIDOS / DAÑADOS', val: kpis.vencido, color: colors.dangerSoftText, border: colors.danger },
          { key: 'sin_registro', label: '⚪ SIN REGISTRO', val: kpis.sinRegistro, color: colors.muted, border: colors.border },
        ] as const).map((k) => {
          const active = filtroSemaforo === k.key;
          return (
            <TouchableOpacity
              key={k.key}
              onPress={() => setFiltroSemaforo(active && k.key !== 'todos' ? 'todos' : k.key)}
              style={{
                flexGrow: 1,
                minWidth: 100,
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

      {/* Filtro rápido por Área / Ubicación */}
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
        placeholder="🔎 Buscar por código (AA-01), área (Oficina, Carpa, Comedor), BTU o marca…"
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
              const urg = unidadesCalc.filter((u) => u.semaforo === 'vencido' || u.semaforo === 'proximo').map((u) => u.code);
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
                  ⚙️ Configurar área/BTU en lote ({selCodes.size})
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
            </>
          ) : null}
        </View>
      ) : null}

      {/* Listado de las 37 Unidades con Semáforo Riguroso */}
      {loading ? (
        <Loading />
      ) : lista.length === 0 ? (
        <EmptyState title="Sin unidades en este filtro" subtitle="Cambia el filtro del semáforo o el texto de búsqueda." />
      ) : (
        lista.map((u) => {
          const sc = semaforoColors(u.semaforo);
          const checked = selCodes.has(u.code);
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
                      <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>❄️ {u.code}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }} numberOfLines={1}>
                      📍 {u.area}{u.name && u.name !== `UNIDAD ${u.code}` ? ` · ${u.name}` : ''}
                    </Text>
                    <View style={{ backgroundColor: sc.bg, borderWidth: 1, borderColor: sc.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: sc.text, fontWeight: '800', fontSize: 11 }}>{u.semaforoLabel}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 6 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {u.tipo_equipo} · {u.btu}{u.marca ? ` · ${u.marca}` : ''} · Ciclo: cada {u.freq_days}d
                    </Text>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                      Último: {fmtFechaAc(u.ultimaFecha)} · Próximo: {fmtFechaAc(u.proximaFecha)}
                    </Text>
                  </View>
                </View>
              }
              detail={
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    🏢 Empresa: <Text style={{ color: colors.text, fontWeight: '700' }}>{companyName(u.company_id)}</Text>
                    {u.serial ? ` · Serial: ${u.serial}` : ''}
                    {u.mantenimientosCount > 0 ? ` · ${u.mantenimientosCount} servicio(s) (${usd(u.gastoAcumuladoUsd)})` : ''}
                  </Text>
                  {u.notes ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>📝 Nota de la unidad: {u.notes}</Text>
                  ) : null}

                  {/* Historial de mantenimientos de esta unidad */}
                  {u.historial.length > 0 ? (
                    <View style={{ marginTop: 4, padding: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11.5 }}>
                        📜 Historial de mantenimientos ({u.historial.length})
                      </Text>
                      {u.historial.slice(0, 5).map((h, idx) => (
                        <View key={`${h.servicioId}-${idx}`} style={{ borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: colors.border, paddingTop: idx === 0 ? 0 : 4 }}>
                          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                            • {fmtFechaAc(h.fecha)} · {h.servicioCode} · {h.tipo} — {usd(h.costoUsd)}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>
                            🏭 {supplierName(h.supplierId)}{h.detalle ? ` · ${h.detalle}` : ''}
                          </Text>
                          {h.condicionesPago ? (
                            <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>
                              💳 Condiciones: {h.condicionesPago}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>
                      Aún no tiene mantenimientos registrados en el sistema.
                    </Text>
                  )}

                  {canWrite ? (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
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
                          ✏️ Editar ubicación / BTU / ciclo
                        </Text>
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
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Código de la unidad</Text>
                <TextInput
                  value={editCode}
                  onChangeText={(t) => setEditCode(t.toUpperCase())}
                  placeholder="AA-01"
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                />
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                  Nombre o referencia específica (ej. Oficina Gerencia, Consola 1)
                </Text>
                <TextInput
                  value={editName}
                  onChangeText={(t) => setEditName(t.toUpperCase())}
                  placeholder="EJ. OFICINA GERENCIA"
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                />
              </Card>
            ) : null}

            <Card>
              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800', marginBottom: 4 }}>
                📍 Área / Ubicación en la base
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {AC_AREAS_SUGERIDAS.map((ar) =>
                  chip(ar, editArea.toUpperCase() === ar, () => setEditArea(ar)),
                )}
              </View>
              <TextInput
                value={editArea}
                onChangeText={(t) => setEditArea(t.toUpperCase())}
                placeholder={editBatchMode ? 'Dejar vacío para no cambiar el área…' : 'Escribe o elige el área (ej. CARPA NUEVA)…'}
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Tipo de equipo</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
                {AC_TIPOS_EQUIPO.map((tp) => chip(tp, editTipo === tp, () => setEditTipo(tp)))}
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Capacidad (BTU / Toneladas)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {AC_BTU_OPCIONES.map((b) => chip(b, editBtu === b, () => setEditBtu(b)))}
              </View>
              <TextInput
                value={editBtu}
                onChangeText={(t) => setEditBtu(t.toUpperCase())}
                placeholder="18.000 BTU"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Marca (opcional)</Text>
              <TextInput
                value={editMarca}
                onChangeText={(t) => setEditMarca(t.toUpperCase())}
                placeholder="EJ. LG, SAMSUNG, CARRIER, FRIGILUX…"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </Card>

            <Card>
              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800', marginBottom: 4 }}>
                ⏱️ Frecuencia de mantenimiento riguroso (cada cuántos días)
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
                placeholder="30"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                Fecha de último mantenimiento previo (AAAA-MM-DD, opcional)
              </Text>
              <TextInput
                value={editLastMaint}
                onChangeText={setEditLastMaint}
                placeholder="Ej. 2026-10-15"
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
        </Screen>
      </Modal>

      {/* ── MODAL 2: Registrar Mantenimiento Riguroso (1 o Varias Unidades) ── */}
      <Modal visible={maintOpen} animationType="slide" onRequestClose={() => setMaintOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>🛠️ Registrar Mantenimiento de Aires</SectionTitle>

            {/* 1. Selección de unidades intervenidas */}
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
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxHeight: 190 }}>
                {unidadesCalc.map((u) => {
                  const on = maintUnits.includes(u.code);
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
                        {on ? '✓ ' : ''}{u.code} ({u.area})
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
                ☑️ Checklist de mantenimiento riguroso realizado
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
                placeholder="Ej. Presión 65 PSI, amperaje 7.8A, se limpió serpentín y drenaje…"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </Card>

            {/* 3. Empresa, Proveedor, Fecha y Costo */}
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
                {chip('— Ninguno', !maintSupplier, () => setMaintSupplier(''))}
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

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                Fecha del mantenimiento (AAAA-MM-DD)
              </Text>
              <TextInput value={maintDate} onChangeText={setMaintDate} placeholder={hoy} placeholderTextColor={colors.muted} style={inputStyle} />

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                Costo del servicio ($ USD)
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                {chip('💵 Precio por unidad ($)', modoPrecio === 'unitario', () => setModoPrecio('unitario'))}
                {chip('📦 Monto total global ($)', modoPrecio === 'total', () => setModoPrecio('total'))}
              </View>
              <TextInput
                value={precioTexto}
                onChangeText={(t) => setPrecioTexto(onlyDecimal(t))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, textAlign: 'right', marginTop: 4 }}>
                Total por {maintUnits.length} unidad(es): {usd(totalMaintCalc)} ({usd(precioUnitarioCalc)} c/u)
              </Text>

              {/* Repuesto del inventario opcional */}
              <TouchableOpacity
                onPress={() => setUsaInv((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm }}
              >
                <Text style={{ fontSize: 15 }}>{usaInv ? '☑️' : '⬜'}</Text>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
                  📦 Descontar repuesto del inventario (capacitor, contactor, gas…)
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

              {/* Factura opcional */}
              <TouchableOpacity
                onPress={adjuntarFacturaMaint}
                disabled={subiendoFactura}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.sm }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12.5 }}>
                  {subiendoFactura ? '⏳ Subiendo…' : maintFactura ? `📎 ${maintFactura.name} · Cambiar` : '📎 Adjuntar factura / soporte (opcional)'}
                </Text>
              </TouchableOpacity>
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
                placeholder="EJ. 50% ADELANTO Y 50% AL ENTREGAR FACTURA…"
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
                    💸 Enviar también a Cuentas por Pagar (con estas condiciones y nota)
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    Registra automáticamente la cuenta en «Por pagar» para que la gente de pagos vea las condiciones de inmediato.
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
                onPress={() => setMaintOpen(false)}
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
                  {savingMaint ? 'Guardando…' : 'Registrar mantenimiento'}
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
    </Screen>
  );
}
