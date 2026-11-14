// 📊 MODAL DE GENERACIÓN DE REPORTE DE COMPRAS · S.O.S LA GUAIRA
// Permite filtrar por fechas (incluyendo Histórico Completo), por empresa pagadora,
// por estado (lo efectivamente comprado / pagado o pendientes), ocultar secciones y columnas en el PDF.
// Compatible 100% con móviles (~360px) y escritorios Web.

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { supabase } from '../lib/supabase';
import { exportPdf } from '../lib/pdf';
import { useBcvRate } from '../lib/bcv';
import {
  transformarDatosReporteCompras,
  generarReporteComprasHtml,
  enriquecerMaquinariaConPlaca,
  type CompraParaReporte,
  type CompraItemLinea,
  type OpcionesReporteCompras,
  type LogoReporteCompras,
  type ColumnasVisiblesReporte,
  fmtUsd,
} from '../lib/reporteComprasSOS';
import { resolverEmpresaDeCuenta } from '../lib/cuentasEmpresa';
import { montosBsCuenta, tasaDeNotaCuenta } from '../lib/cuentasBs';
import type { Company, Supplier, Machinery, PurchaseOrder } from '../types/database';

interface Props {
  visible: boolean;
  onClose: () => void;
  fechaInicioDefecto?: string;
  fechaFinDefecto?: string;
  empresaDefectoId?: string;
}

export function ReporteComprasModal({ visible, onClose, fechaInicioDefecto, fechaFinDefecto, empresaDefectoId }: Props) {
  const { colors } = useTheme();
  const bcv = useBcvRate();

  // Estados de Filtros
  const [periodoAtajo, setPeriodoAtajo] = useState<'todas' | 'mes' | 'semana' | 'hoy' | 'libre'>('todas');
  const [desde, setDesde] = useState<string>(fechaInicioDefecto || '');
  const [hasta, setHasta] = useState<string>(fechaFinDefecto || '');
  const [empresaSelId, setEmpresaSelId] = useState<string>(empresaDefectoId || 'todas');
  const [estadoSel, setEstadoSel] = useState<'todas' | 'pagadas' | 'pendientes'>('todas');
  const [ambito, setAmbito] = useState<'todo' | 'cuentas' | 'requerimientos' | 'directas'>('todo');
  const [tasaManual, setTasaManual] = useState<string>('');
  const [logoSel, setLogoSel] = useState<LogoReporteCompras>('sos');

  // Pastillas "¿Qué se oculta?" (Secciones)
  const [sinKpis, setSinKpis] = useState(false);
  const [sinDistribucionDept, setSinDistribucionDept] = useState(false);
  const [sinResumenEmpresas, setSinResumenEmpresas] = useState(false);
  const [sinRankingDept, setSinRankingDept] = useState(false);
  const [sinTopCategorias, setSinTopCategorias] = useState(false);
  const [sinPendientes, setSinPendientes] = useState(false);
  const [sinTrazabilidad, setSinTrazabilidad] = useState(false);

  // Pastillas "Columnas Opcionales de la Tabla"
  const [colEmpresa, setColEmpresa] = useState(true);
  const [colProveedor, setColProveedor] = useState(true);
  const [colMaquinaria, setColMaquinaria] = useState(true);
  const [colMontoBs, setColMontoBs] = useState(true);
  const [colFecha, setColFecha] = useState(true);

  // Estados de Carga y Catálogos
  const [cargando, setCargando] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [comprasCargadas, setComprasCargadas] = useState<CompraParaReporte[]>([]);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<Company[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estados para filtro de empresas accesible (Mouse PC + Teléfono)
  const [busquedaEmpresa, setBusquedaEmpresa] = useState<string>('');
  const [mostrarTodasEmpresas, setMostrarTodasEmpresas] = useState<boolean>(false);

  // Manejo de atajos de fecha
  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    const hoyStr = now.toISOString().slice(0, 10);
    const primerDiaMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    if (periodoAtajo === 'todas') {
      setDesde('');
      setHasta('');
    } else if (periodoAtajo === 'hoy') {
      setDesde(hoyStr);
      setHasta(hoyStr);
    } else if (periodoAtajo === 'semana') {
      const d = new Date(now);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const lunes = new Date(d.setDate(diff)).toISOString().slice(0, 10);
      setDesde(lunes);
      setHasta(hoyStr);
    } else if (periodoAtajo === 'mes') {
      setDesde(primerDiaMes);
      setHasta(hoyStr);
    }
  }, [visible, periodoAtajo]);

  // Actualizar tasa inicial de BCV
  useEffect(() => {
    if (bcv.rate && !tasaManual) {
      setTasaManual(String(bcv.rate));
    }
  }, [bcv.rate, tasaManual]);

  // Carga unificada de datos desde Supabase
  useEffect(() => {
    if (!visible) return;
    let cancelado = false;

    async function cargarDatos() {
      setCargando(true);
      setErrorMsg(null);
      try {
        // Consultar tablas maestras en paralelo
        const [
          cuentasRes,
          abonosRes,
          reqRes,
          dirRes,
          supRes,
          compRes,
          machRes,
          ordRes,
        ] = await Promise.all([
          // 1. Cuentas por pagar (Fuente primaria de lo comprado y pagado en SOS)
          supabase
            .from('cuentas')
            .select('id, tipo, estado, concepto, documento, monto, moneda, company_id, supplier_id, order_id, inventory_requirement_id, fecha_emision, fecha_vencimiento, settled_at, settled_by, created_at, nota, alicuota_iva')
            .eq('tipo', 'por_pagar')
            .neq('estado', 'anulada'),

          // 2. Abonos de cuentas
          supabase
            .from('cuenta_abonos')
            .select('id, cuenta_id, monto, fecha'),

          // 3. Requerimientos de compras (solo vigentes: excluye anulados, rechazados y cancelados)
          supabase
            .from('inventory_requirements')
            .select('id, code, title, note, status, items, company_id, supplier_id, requested_by_name, solicitante_nombre, decided_by_name, area, observaciones, created_at, iva_alicuota, prioridad')
            .not('status', 'in', '("anulado","rechazado","cancelado")'),

          // 4. Compras directas (caja chica / contado)
          supabase
            .from('direct_purchases')
            .select('id, code, created_at, company_id, supplier_id, category, items, total, alicuota_iva, note'),

          // 5. Catálogo de Proveedores
          supabase.from('suppliers').select('id, name, rif'),

          // 6. Catálogo de Empresas
          supabase.from('companies').select('id, name, rif'),

          // 7. Catálogo de Maquinaria (para regla de oro: PLACA obligatoria)
          supabase.from('machinery').select('id, code, plate, name'),

          // 8. Órdenes de compra (para cruces de trazabilidad)
          supabase.from('purchase_orders').select('id, code, company_id, supplier_id, created_at'),
        ]);

        if (cancelado) return;

        const suppliers = (supRes.data || []) as unknown as Supplier[];
        const companies = (compRes.data || []) as unknown as Company[];
        const machinery = (machRes.data || []) as unknown as Machinery[];
        const orders = (ordRes.data || []) as unknown as PurchaseOrder[];
        const abonos = (abonosRes.data || []) as Array<{ id: string; cuenta_id: string; monto: number }>;
        const requerimientos = (reqRes.data || []) as any[];
        const cuentas = (cuentasRes.data || []) as any[];
        const directPurchases = (dirRes.data || []) as any[];

        setEmpresasCatalogo(companies);

        // Mapas auxiliares para resolución rápida
        const supMap = new Map(suppliers.map((s) => [s.id, s]));
        const reqMap = new Map(requerimientos.map((r) => [r.id, r]));
        const abonosMap = new Map<string, number>();
        for (const a of abonos) {
          abonosMap.set(a.cuenta_id, (abonosMap.get(a.cuenta_id) || 0) + (Number(a.monto) || 0));
        }

        const resultado: CompraParaReporte[] = [];
        const reqIdsProcesados = new Set<string>();

        // ── 1. Procesar Cuentas por Pagar (Compras oficiales de SOS) ────────
        if (ambito !== 'directas' && ambito !== 'requerimientos') {
          for (const c of cuentas) {
            const reqVinc = c.inventory_requirement_id ? reqMap.get(c.inventory_requirement_id) : null;
            // Si el requerimiento vinculado está rechazado o anulado, descartar esta cuenta del reporte
            if (reqVinc && (reqVinc.status === 'rechazado' || reqVinc.status === 'anulado' || reqVinc.status === 'cancelado')) {
              continue;
            }
            if (reqVinc) reqIdsProcesados.add(reqVinc.id);

            const sup = c.supplier_id ? supMap.get(c.supplier_id) : (reqVinc?.supplier_id ? supMap.get(reqVinc.supplier_id) : null);
            const empresaInfo = resolverEmpresaDeCuenta(c, { companies, requirements: requerimientos, orders });

            const totalAbonado = abonosMap.get(c.id) || 0;
            const montoNominal = Number(c.monto) || 0;
            const saldoPendiente = Math.max(0, Math.round((montoNominal - totalAbonado) * 100) / 100);

            // Estado de pago real
            const estadoNorm = String(c.estado || '').toLowerCase().trim();
            const estaPagada = estadoNorm === 'pagada' || Boolean(c.settled_at) || (saldoPendiente <= 0.01 && montoNominal > 0);

            // Fecha efectiva de la compra / liquidación
            const fechaStr = (c.settled_at || c.fecha_emision || c.created_at || '').slice(0, 10);

            // Cálculo financiero fiel de Bolívares a la tasa de la fecha de la compra/pago
            const tasaRef = bcv.rate || Number(tasaManual) || 0;
            const montosBs = montosBsCuenta(
              { monto: montoNominal, saldo: saldoPendiente, nota: c.nota, alicuota_iva: c.alicuota_iva },
              reqVinc,
              tasaRef,
              { actualizarATasaDelDia: false }
            );

            const montoBsEseDia = montosBs.montoBsEseDia ?? 0;
            const tasaEseDia = montosBs.tasaEseDia ?? 0;
            const totalBsHistorico = montosBs.tieneTasaEseDia && montoBsEseDia > 0
              ? montoBsEseDia
              : (tasaEseDia > 0
                  ? Math.round(montoNominal * tasaEseDia * 100) / 100
                  : (tasaRef > 0 ? Math.round(montoNominal * tasaRef * 100) / 100 : 0));

            // Ítems: si viene de requerimiento, tomar sus ítems; si no, concepto general
            let items: CompraItemLinea[] = [];
            if (reqVinc && Array.isArray(reqVinc.items) && reqVinc.items.length > 0) {
              items = reqVinc.items.map((it: any) => ({
                name: it.name || it.description || 'Ítem',
                category: it.category || null,
                quantity: Number(it.qty) || 1,
                unit: it.unit || 'u.',
                unitPrice: Number(it.price_usd || it.est_price) || 0,
                total: (Number(it.qty) || 1) * (Number(it.price_usd || it.est_price) || 0),
                exento: Boolean(it.exento),
              }));
            } else {
              items = [{
                name: c.concepto || 'Compra de insumos / repuestos',
                category: 'Insumos y Repuestos',
                quantity: 1,
                unit: 'u.',
                unitPrice: montoNominal,
                total: montoNominal,
              }];
            }

            // Destino Maquinaria con regla estricta de Placa obligatoria
            let textoMaq = reqVinc?.observaciones || c.nota || '';
            const matchMaq = textoMaq.match(/\[DESTINO_MAQUINA:\s*([^\]]+)\]/i);
            const maqDesc = matchMaq ? matchMaq[1].trim() : (reqVinc?.area || 'General');
            const maqConPlaca = enriquecerMaquinariaConPlaca(maqDesc, machinery);

            resultado.push({
              id: c.id,
              tipo: 'cuenta',
              codigo: reqVinc?.code || (c.order_id ? `OC-${c.order_id.slice(0, 8)}` : (c.documento ? `DOC-${c.documento}` : `CXP-${c.id.slice(0, 6)}`)),
              fecha: fechaStr || '—',
              empresaNombre: empresaInfo.name || 'S.O.S LA GUAIRA',
              empresaId: empresaInfo.id,
              departamento: (reqVinc?.area || 'OPERACIONES').toUpperCase(),
              destinoMaquinaria: maqConPlaca,
              proveedorNombre: sup?.name || 'Proveedor por pagar',
              proveedorRif: sup?.rif || null,
              analistaNombre: reqVinc?.decided_by_name || reqVinc?.requested_by_name || '—',
              solicitanteNombre: reqVinc?.solicitante_nombre || reqVinc?.requested_by_name || '—',
              prioridad: reqVinc?.prioridad || 'media',
              status: estaPagada ? 'pagada' : 'pendiente',
              statusLabel: estaPagada ? 'Pagada' : 'Pendiente por pagar',
              items,
              totalUsd: montoNominal,
              totalBs: totalBsHistorico,
              montoPagadoUsd: estaPagada ? montoNominal : totalAbonado,
              saldoPendienteUsd: estaPagada ? 0 : saldoPendiente,
              observacion: c.concepto || reqVinc?.note || null,
            });
          }
        }

        // ── 2. Procesar Requerimientos que aún no tengan cuenta generada ───
        if (ambito !== 'directas' && ambito !== 'cuentas') {
          for (const r of requerimientos) {
            if (reqIdsProcesados.has(r.id)) continue; // Evitar duplicar con la cuenta
            // Excluir estrictamente requerimientos no activos (rechazados, anulados, cancelados o borradores)
            if (r.status === 'rechazado' || r.status === 'anulado' || r.status === 'cancelado' || r.status === 'borrador') {
              continue;
            }

            const sup = r.supplier_id ? supMap.get(r.supplier_id) : null;
            const empresaMatched = companies.find((co) => co.id === r.company_id);

            const items: CompraItemLinea[] = (Array.isArray(r.items) ? r.items : []).map((it: any) => ({
              name: it.name || it.description || 'Ítem',
              category: it.category || null,
              quantity: Number(it.qty) || 1,
              unit: it.unit || 'u.',
              unitPrice: Number(it.price_usd || it.est_price) || 0,
              total: (Number(it.qty) || 1) * (Number(it.price_usd || it.est_price) || 0),
              exento: Boolean(it.exento),
            }));

            const subtotal = items.reduce((acc, it) => acc + it.total, 0);
            const ivaAlicuota = Number(r.iva_alicuota) || 0;
            const baseImponible = items.filter((it) => !it.exento).reduce((acc, it) => acc + it.total, 0);
            const totalUsd = Math.round((subtotal + (baseImponible * ivaAlicuota / 100)) * 100) / 100;

            const matchMaq = (r.observaciones || '').match(/\[DESTINO_MAQUINA:\s*([^\]]+)\]/i);
            const destino = matchMaq ? matchMaq[1].trim() : (r.area || 'General');
            const destinoConPlaca = enriquecerMaquinariaConPlaca(destino, machinery);

            const esAprobadoORecibido = r.status === 'recibido' || r.status === 'aprobado';

            resultado.push({
              id: r.id,
              tipo: 'requerimiento',
              codigo: r.code || 'REQ-S/C',
              fecha: (r.created_at || '').slice(0, 10),
              empresaNombre: empresaMatched?.name || 'S.O.S LA GUAIRA',
              empresaId: r.company_id,
              departamento: (r.area || 'OPERACIONES').toUpperCase(),
              destinoMaquinaria: destinoConPlaca,
              proveedorNombre: sup?.name || 'Sin proveedor asignado',
              proveedorRif: sup?.rif || null,
              analistaNombre: r.decided_by_name || r.requested_by_name || '—',
              solicitanteNombre: r.solicitante_nombre || r.requested_by_name || '—',
              prioridad: r.prioridad || 'media',
              status: esAprobadoORecibido ? 'pendiente' : (r.status || 'pendiente'),
              statusLabel: r.status === 'recibido' ? 'Recibida en almacén' : r.status === 'aprobado' ? 'Confirmada pagar' : 'Pendiente por aprobar',
              items,
              totalUsd,
              montoPagadoUsd: 0,
              saldoPendienteUsd: totalUsd,
              observacion: r.note || r.title || null,
            });
          }
        }

        // ── 3. Procesar Compras Directas (Caja Chica / Contado) ─────────────
        if (ambito !== 'cuentas' && ambito !== 'requerimientos') {
          for (const cd of directPurchases) {
            const sup = cd.supplier_id ? supMap.get(cd.supplier_id) : null;
            const empresaMatched = companies.find((co) => co.id === cd.company_id);

            const items: CompraItemLinea[] = (Array.isArray(cd.items) ? cd.items : []).map((it: any) => ({
              name: it.name || it.description || 'Ítem',
              category: cd.category || it.category || 'Insumos',
              quantity: Number(it.qty) || 1,
              unit: it.unit || 'u.',
              unitPrice: Number(it.price) || 0,
              total: (Number(it.qty) || 1) * (Number(it.price) || 0),
              exento: Boolean(it.exento),
            }));

            const tot = Number(cd.total) || 0;

            resultado.push({
              id: cd.id,
              tipo: 'directa',
              codigo: cd.code || 'CD-S/C',
              fecha: (cd.created_at || '').slice(0, 10),
              empresaNombre: empresaMatched?.name || 'S.O.S LA GUAIRA',
              empresaId: cd.company_id,
              departamento: (cd.category || 'COMPRAS DIRECTAS').toUpperCase(),
              destinoMaquinaria: 'Caja Chica [Sin placa]',
              proveedorNombre: sup?.name || 'Proveedor directo',
              proveedorRif: sup?.rif || null,
              analistaNombre: 'Caja Chica / Directa',
              status: 'pagada',
              statusLabel: 'Pagada (Contado)',
              items,
              totalUsd: tot,
              montoPagadoUsd: tot,
              saldoPendienteUsd: 0,
              observacion: cd.note || 'Compra directa',
            });
          }
        }

        // Ordenar cronológicamente descendente
        resultado.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

        setComprasCargadas(resultado);
      } catch (err: any) {
        if (!cancelado) setErrorMsg(err?.message || 'Error al consultar compras en la base.');
      } finally {
        if (!cancelado) setCargando(false);
      }
    }

    cargarDatos();
    return () => { cancelado = true; };
  }, [visible, ambito]);

  // Lista adaptativa de empresas para PC (mouse) y móvil
  const empresasAMostrar = useMemo(() => {
    let lista = empresasCatalogo;
    if (busquedaEmpresa.trim()) {
      const q = busquedaEmpresa.toLowerCase();
      lista = lista.filter((e) => (e.name || '').toLowerCase().includes(q));
    }
    if (mostrarTodasEmpresas || busquedaEmpresa.trim()) {
      return lista;
    }
    const primeros = lista.slice(0, 8);
    if (empresaSelId !== 'todas' && !primeros.some((e) => e.id === empresaSelId)) {
      const seleccionada = lista.find((e) => e.id === empresaSelId);
      if (seleccionada) return [seleccionada, ...primeros];
    }
    return primeros;
  }, [empresasCatalogo, busquedaEmpresa, mostrarTodasEmpresas, empresaSelId]);

  // Filtrado reactivo en memoria: Fecha, Empresa y Estado
  const comprasFiltradas = useMemo(() => {
    return comprasCargadas.filter((c) => {
      // 1. Filtro por Fecha
      if (desde && c.fecha && c.fecha < desde) return false;
      if (hasta && c.fecha && c.fecha > hasta) return false;

      // 2. Filtro por Empresa
      if (empresaSelId && empresaSelId !== 'todas') {
        const matchId = c.empresaId === empresaSelId;
        const compObj = empresasCatalogo.find((co) => co.id === empresaSelId);
        const matchNombre = compObj && c.empresaNombre && c.empresaNombre.toUpperCase().includes(compObj.name.toUpperCase());
        if (!matchId && !matchNombre) return false;
      }

      // 3. Filtro por Estado (Pagadas vs Pendientes)
      if (estadoSel === 'pagadas') {
        if (c.status !== 'pagada') return false;
      } else if (estadoSel === 'pendientes') {
        if (c.status === 'pagada') return false;
      }

      return true;
    });
  }, [comprasCargadas, desde, hasta, empresaSelId, estadoSel, empresasCatalogo]);

  // Totales en memoria para vista previa rápida
  const resumenRapido = useMemo(() => {
    const total = comprasFiltradas.reduce((acc, c) => acc + c.totalUsd, 0);
    return { count: comprasFiltradas.length, total };
  }, [comprasFiltradas]);

  // Generar y Exportar PDF
  const handleExportar = async () => {
    if (comprasFiltradas.length === 0) return;
    setGenerandoPdf(true);
    try {
      const tasaNum = Number(tasaManual) || bcv.rate || 0;
      const periodoTexto = desde && hasta ? `${desde} al ${hasta}` : (desde ? `Desde ${desde}` : 'Histórico completo');

      const empresaObj = empresasCatalogo.find((co) => co.id === empresaSelId);
      const empresaLabel = empresaSelId === 'todas' ? 'Todas las empresas' : (empresaObj?.name || 'Empresa seleccionada');

      const columnasConfig: ColumnasVisiblesReporte = {
        empresa: colEmpresa,
        proveedor: colProveedor,
        maquinaria: colMaquinaria,
        montoBs: colMontoBs,
        fecha: colFecha,
        estado: true,
      };

      const config: OpcionesReporteCompras = {
        periodoLabel: periodoTexto,
        fechaDesde: desde,
        fechaHasta: hasta,
        empresaFiltroLabel: empresaLabel,
        empresaFiltroId: empresaSelId !== 'todas' ? empresaSelId : null,
        estadoFiltro: estadoSel,
        ambitoLabel: ambito === 'todo' ? 'COMPRAS Y CUENTAS POR PAGAR' : ambito === 'cuentas' ? 'CUENTAS POR PAGAR' : ambito === 'requerimientos' ? 'REQUERIMIENTOS Y ÓRDENES' : 'COMPRAS DIRECTAS',
        agrupacionLabel: 'DEPARTAMENTO / ÁREA',
        tasaBcv: tasaNum,
        logo: logoSel,
        sinKpis,
        sinDistribucionDept,
        sinResumenEmpresas,
        sinRankingDept,
        sinTopCategorias,
        sinPendientes: estadoSel === 'pagadas' || sinPendientes,
        sinTrazabilidad,
        columnas: columnasConfig,
      };

      const datosTransformados = transformarDatosReporteCompras(comprasFiltradas, tasaNum);
      const html = generarReporteComprasHtml(datosTransformados, config);

      const fechaDoc = (desde || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
      const nombreArchivo = `reporte-compras-sos-${fechaDoc}.pdf`;

      await exportPdf(html, nombreArchivo);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al generar el PDF.');
    } finally {
      setGenerandoPdf(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(10, 37, 64, 0.75)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.sm,
      }}>
        <View style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '94%',
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 12,
          elevation: 8,
        }}>

          {/* Cabecera del Modal */}
          <View style={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            backgroundColor: '#0A2540',
            borderBottomWidth: 2,
            borderColor: '#0284C7',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 }}>
                📊 REPORTE DE COMPRAS · SOS LA GUAIRA
              </Text>
              <Text style={{ color: '#bae6fd', fontSize: 11.5, marginTop: 2 }}>
                Consolidado de compras, cuentas por pagar y órdenes con bimonetarismo (USD / Bs)
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 16, color: '#ffffff', fontWeight: 'bold' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Contenido scrolleable */}
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>

            {/* 1. Atajos de Período */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>
                1. PERÍODO DE FECHAS
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {([
                  ['todas', '♾️ Todas (Histórico)'],
                  ['mes', '📆 Este mes'],
                  ['semana', '🗓️ Esta semana'],
                  ['hoy', '📅 Hoy'],
                  ['libre', '✨ Rango libre'],
                ] as const).map(([k, lbl]) => {
                  const on = periodoAtajo === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setPeriodoAtajo(k)}
                      style={{
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 6,
                        borderRadius: radius.pill,
                        backgroundColor: on ? '#0284C7' : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: on ? '#0284C7' : colors.border,
                      }}
                    >
                      <Text style={{ color: on ? '#ffffff' : colors.text, fontSize: 12, fontWeight: '700' }}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {periodoAtajo === 'libre' ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Desde (AAAA-MM-DD)</Text>
                    <TextInput
                      value={desde}
                      onChangeText={setDesde}
                      placeholder="2026-01-01"
                      placeholderTextColor={colors.muted}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 6,
                        color: colors.text,
                        backgroundColor: colors.surfaceAlt,
                        fontSize: 13,
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Hasta (AAAA-MM-DD)</Text>
                    <TextInput
                      value={hasta}
                      onChangeText={setHasta}
                      placeholder="2026-12-31"
                      placeholderTextColor={colors.muted}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 6,
                        color: colors.text,
                        backgroundColor: colors.surfaceAlt,
                        fontSize: 13,
                      }}
                    />
                  </View>
                </View>
              ) : null}
            </View>

            {/* 2. Filtro por Empresa */}
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800' }}>
                  2. FILTRAR POR EMPRESA
                </Text>
                {empresasCatalogo.length > 8 && !busquedaEmpresa.trim() ? (
                  <TouchableOpacity
                    onPress={() => setMostrarTodasEmpresas(!mostrarTodasEmpresas)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      backgroundColor: 'rgba(2, 132, 199, 0.12)',
                    }}
                  >
                    <Text style={{ color: '#0284C7', fontSize: 11, fontWeight: '800' }}>
                      {mostrarTodasEmpresas ? '⬆️ Ver menos' : `⬇️ Ver todas (${empresasCatalogo.length})`}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Buscador rápido de empresa para PC y móvil */}
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.surfaceAlt,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: spacing.sm,
                marginBottom: spacing.xs,
              }}>
                <Text style={{ fontSize: 12, marginRight: 6 }}>🔎</Text>
                <TextInput
                  value={busquedaEmpresa}
                  onChangeText={setBusquedaEmpresa}
                  placeholder="Buscar empresa por nombre..."
                  placeholderTextColor={colors.muted}
                  style={{
                    flex: 1,
                    paddingVertical: 6,
                    fontSize: 12,
                    color: colors.text,
                  }}
                />
                {busquedaEmpresa ? (
                  <TouchableOpacity onPress={() => setBusquedaEmpresa('')} style={{ padding: 4 }}>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: 'bold' }}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Pastillas adaptadas con flexWrap y ScrollView contenido (cero desbordamiento / aglomeración) */}
              {mostrarTodasEmpresas || busquedaEmpresa.trim() ? (
                <ScrollView
                  style={{
                    maxHeight: 180,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: spacing.xs,
                    backgroundColor: colors.surface,
                  }}
                  contentContainerStyle={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: spacing.xs,
                    paddingBottom: 4,
                  }}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                  keyboardShouldPersistTaps="handled"
                >
                  <TouchableOpacity
                    onPress={() => setEmpresaSelId('todas')}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                      backgroundColor: empresaSelId === 'todas' ? '#0A2540' : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: empresaSelId === 'todas' ? '#0A2540' : colors.border,
                    }}
                  >
                    <Text style={{ color: empresaSelId === 'todas' ? '#ffffff' : colors.text, fontSize: 11.5, fontWeight: '700' }}>
                      {empresaSelId === 'todas' ? '✓ 🏢 Todas las empresas' : '🏢 Todas las empresas'}
                    </Text>
                  </TouchableOpacity>

                  {empresasAMostrar.map((emp) => {
                    const on = empresaSelId === emp.id;
                    return (
                      <TouchableOpacity
                        key={emp.id}
                        onPress={() => setEmpresaSelId(emp.id)}
                        style={{
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          backgroundColor: on ? '#0A2540' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: on ? '#0A2540' : colors.border,
                        }}
                      >
                        <Text style={{ color: on ? '#ffffff' : colors.text, fontSize: 11.5, fontWeight: '700' }}>
                          {on ? `✓ ${emp.name}` : emp.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : (
                <View style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: spacing.xs,
                }}>
                  <TouchableOpacity
                    onPress={() => setEmpresaSelId('todas')}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                      backgroundColor: empresaSelId === 'todas' ? '#0A2540' : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: empresaSelId === 'todas' ? '#0A2540' : colors.border,
                    }}
                  >
                    <Text style={{ color: empresaSelId === 'todas' ? '#ffffff' : colors.text, fontSize: 11.5, fontWeight: '700' }}>
                      {empresaSelId === 'todas' ? '✓ 🏢 Todas las empresas' : '🏢 Todas las empresas'}
                    </Text>
                  </TouchableOpacity>

                  {empresasAMostrar.map((emp) => {
                    const on = empresaSelId === emp.id;
                    return (
                      <TouchableOpacity
                        key={emp.id}
                        onPress={() => setEmpresaSelId(emp.id)}
                        style={{
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          backgroundColor: on ? '#0A2540' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: on ? '#0A2540' : colors.border,
                        }}
                      >
                        <Text style={{ color: on ? '#ffffff' : colors.text, fontSize: 11.5, fontWeight: '700' }}>
                          {on ? `✓ ${emp.name}` : emp.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            {/* 3. Filtro por Estado (Lo que se compró / pagó) */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>
                3. ESTADO DE COMPRA
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {([
                  ['todas', '📑 Todas (Pagadas y Pendientes)'],
                  ['pagadas', '✅ Solo Pagadas (Lo que se compró)'],
                  ['pendientes', '🕓 Solo Pendientes'],
                ] as const).map(([k, lbl]) => {
                  const on = estadoSel === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setEstadoSel(k)}
                      style={{
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 6,
                        borderRadius: radius.pill,
                        backgroundColor: on ? (k === 'pagadas' ? '#166534' : k === 'pendientes' ? '#b45309' : '#0284C7') : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: on ? 'transparent' : colors.border,
                      }}
                    >
                      <Text style={{ color: on ? '#ffffff' : colors.text, fontSize: 12, fontWeight: '700' }}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* 4. Tasa BCV */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: 4 }}>
                4. TASA OFICIAL BCV (BS/$)
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <TextInput
                  value={tasaManual}
                  onChangeText={setTasaManual}
                  keyboardType="numeric"
                  placeholder="901.62"
                  placeholderTextColor={colors.muted}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 6,
                    color: colors.text,
                    backgroundColor: colors.surfaceAlt,
                    fontSize: 14,
                    fontWeight: '700',
                  }}
                />
                <TouchableOpacity
                  onPress={() => bcv.refresh()}
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 8,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>🔄 Actualizar</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ color: colors.muted, fontSize: 10, marginTop: 3 }}>
                Tasa del día: {bcv.rate ? `Bs. ${bcv.rate}` : 'Cargando...'} · Puedes editarla para reportes con fecha histórica.
              </Text>
            </View>

            {/* 5. Selector de Logotipo */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>
                5. MEMBRETE Y LOGO INSTITUCIONAL
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {([
                  ['sos', '🌴 SOS La Guaira (Defecto)'],
                  ['golden', '✨ Golden Touch'],
                  ['bcv', '🏛️ BCV'],
                  ['renace', '🇻🇪 Renace'],
                  ['jhenzaen', '🏢 Jhenzaen'],
                  ['ninguno', '🚫 Sin logo'],
                ] as const).map(([k, lbl]) => {
                  const on = logoSel === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setLogoSel(k)}
                      style={{
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 5,
                        borderRadius: radius.pill,
                        backgroundColor: on ? '#0284C7' : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: on ? '#0284C7' : colors.border,
                      }}
                    >
                      <Text style={{ color: on ? '#ffffff' : colors.text, fontSize: 11, fontWeight: '700' }}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* 6. Pastillas ¿Qué se oculta? (Secciones) */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>
                6. ¿QUÉ SE OCULTA DEL REPORTE? (SECCIONES)
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {[
                  { state: sinKpis, toggle: () => setSinKpis(!sinKpis), label: '🚫 Resumen KPIs' },
                  { state: sinDistribucionDept, toggle: () => setSinDistribucionDept(!sinDistribucionDept), label: '🚫 Top Gasto Dpto' },
                  { state: sinResumenEmpresas, toggle: () => setSinResumenEmpresas(!sinResumenEmpresas), label: '🚫 Resumen Empresas' },
                  { state: sinRankingDept, toggle: () => setSinRankingDept(!sinRankingDept), label: '🚫 Ranking Dptos' },
                  { state: sinTopCategorias, toggle: () => setSinTopCategorias(!sinTopCategorias), label: '🚫 Top Categorías/Ítems' },
                  { state: sinPendientes, toggle: () => setSinPendientes(!sinPendientes), label: '🚫 Compras Pendientes' },
                  { state: sinTrazabilidad, toggle: () => setSinTrazabilidad(!sinTrazabilidad), label: '🚫 Trazabilidad/Notas' },
                ].map((p, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={p.toggle}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 5,
                      borderRadius: radius.pill,
                      backgroundColor: p.state ? '#fee2e2' : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: p.state ? '#ef4444' : colors.border,
                    }}
                  >
                    <Text style={{ color: p.state ? '#b91c1c' : colors.text, fontSize: 11, fontWeight: '700' }}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 7. Pastillas Columnas Visibles */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>
                7. COLUMNAS DE LA TABLA (TOCA PARA OCULTAR O MOSTRAR)
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {[
                  { state: colEmpresa, toggle: () => setColEmpresa(!colEmpresa), label: '🏢 Empresa' },
                  { state: colProveedor, toggle: () => setColProveedor(!colProveedor), label: '🚚 Proveedor / RIF' },
                  { state: colMaquinaria, toggle: () => setColMaquinaria(!colMaquinaria), label: '🚜 Máquina + Placa' },
                  { state: colMontoBs, toggle: () => setColMontoBs(!colMontoBs), label: '💵 Monto Bs (BCV)' },
                  { state: colFecha, toggle: () => setColFecha(!colFecha), label: '📅 Fecha' },
                ].map((col, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={col.toggle}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 5,
                      borderRadius: radius.pill,
                      backgroundColor: col.state ? '#e0f2fe' : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: col.state ? '#0284C7' : colors.border,
                    }}
                  >
                    <Text style={{ color: col.state ? '#0369a1' : colors.muted, fontSize: 11, fontWeight: '700' }}>
                      {col.state ? `✓ ${col.label}` : `✕ ${col.label}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Aviso de error si hubo */}
            {errorMsg ? (
              <View style={{ backgroundColor: '#fee2e2', borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: '#fca5a5' }}>
                <Text style={{ color: '#b91c1c', fontSize: 12 }}>⚠️ {errorMsg}</Text>
              </View>
            ) : null}

            {/* Resumen de carga en tiempo real */}
            <View style={{
              backgroundColor: '#f0f9ff',
              borderRadius: radius.md,
              padding: spacing.sm,
              borderWidth: 1,
              borderColor: '#bae6fd',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <View>
                <Text style={{ color: '#0369a1', fontSize: 11, fontWeight: '700' }}>COMPRAS ENCONTRADAS</Text>
                <Text style={{ color: '#0A2540', fontSize: 15, fontWeight: '900' }}>
                  {cargando ? 'Consultando base...' : `${resumenRapido.count} compras`}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: '#0369a1', fontSize: 11, fontWeight: '700' }}>MONTO TOTAL</Text>
                <Text style={{ color: '#0284C7', fontSize: 16, fontWeight: '900' }}>
                  {cargando ? '...' : fmtUsd(resumenRapido.total)}
                </Text>
              </View>
            </View>

          </ScrollView>

          {/* Pie / Botón de Acción Principal */}
          <View style={{
            padding: spacing.md,
            backgroundColor: colors.surfaceAlt,
            borderTopWidth: 1,
            borderColor: colors.border,
            flexDirection: 'row',
            gap: spacing.sm,
          }}>
            <TouchableOpacity
              onPress={onClose}
              style={{
                flex: 1,
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleExportar}
              disabled={cargando || generandoPdf || comprasFiltradas.length === 0}
              style={{
                flex: 2,
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                backgroundColor: '#0284C7',
                alignItems: 'center',
                opacity: (cargando || generandoPdf || comprasFiltradas.length === 0) ? 0.6 : 1,
                flexDirection: 'row',
                justifyContent: 'center',
                gap: spacing.xs,
              }}
            >
              {generandoPdf ? (
                <>
                  <ActivityIndicator color="#ffffff" size="small" />
                  <Text style={{ color: '#ffffff', fontWeight: '800' }}>Generando PDF...</Text>
                </>
              ) : (
                <Text style={{ color: '#ffffff', fontWeight: '800' }}>📄 DESCARGAR PDF</Text>
              )}
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}
