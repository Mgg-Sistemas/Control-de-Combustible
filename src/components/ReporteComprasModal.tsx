// 📊 MODAL DE GENERACIÓN DE REPORTE DE COMPRAS ESTILO GOLDEN TOUCH
// Permite filtrar por fechas, ámbito, tasa BCV y ocultar secciones en el PDF.
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
  Platform,
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
  fmtUsd,
} from '../lib/reporteComprasGoldenTouch';

interface Props {
  visible: boolean;
  onClose: () => void;
  fechaInicioDefecto?: string;
  fechaFinDefecto?: string;
}

export function ReporteComprasModal({ visible, onClose, fechaInicioDefecto, fechaFinDefecto }: Props) {
  const { colors } = useTheme();
  const bcv = useBcvRate();

  // Estados de Filtros
  const [periodoAtajo, setPeriodoAtajo] = useState<'hoy' | 'semana' | 'mes' | 'libre'>('mes');
  const [desde, setDesde] = useState<string>(fechaInicioDefecto || '');
  const [hasta, setHasta] = useState<string>(fechaFinDefecto || '');
  const [ambito, setAmbito] = useState<'todo' | 'requerimientos' | 'directas'>('todo');
  const [tasaManual, setTasaManual] = useState<string>('');
  const [logoSel, setLogoSel] = useState<LogoReporteCompras>('golden');

  // Pastillas "¿Qué se oculta?"
  const [sinKpis, setSinKpis] = useState(false);
  const [sinDistribucionDept, setSinDistribucionDept] = useState(false);
  const [sinRankingDept, setSinRankingDept] = useState(false);
  const [sinTopCategorias, setSinTopCategorias] = useState(false);
  const [sinPendientes, setSinPendientes] = useState(false);
  const [sinTrazabilidad, setSinTrazabilidad] = useState(false);

  // Estados de Carga
  const [cargando, setCargando] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [comprasCargadas, setComprasCargadas] = useState<CompraParaReporte[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inicializar fechas al abrir
  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    const hoyStr = now.toISOString().slice(0, 10);
    const primerDiaMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    if (periodoAtajo === 'hoy') {
      setDesde(hoyStr);
      setHasta(hoyStr);
    } else if (periodoAtajo === 'semana') {
      const d = new Date(now);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // lunes
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

  // Carga de datos desde Supabase
  useEffect(() => {
    if (!visible) return;
    let cancelado = false;

    async function cargarDatos() {
      setCargando(true);
      setErrorMsg(null);
      try {
        // 1. Cargar requerimientos
        let reqQuery = supabase
          .from('inventory_requirements')
          .select('id, code, title, note, status, items, company_id, supplier_id, requested_by_name, solicitante_nombre, decided_by_name, area, observaciones, created_at, iva_alicuota, despacho_estado, prioridad');

        if (desde) reqQuery = reqQuery.gte('created_at', `${desde}T00:00:00`);
        if (hasta) reqQuery = reqQuery.lte('created_at', `${hasta}T23:59:59`);

        // 2. Cargar compras directas
        let dirQuery = supabase
          .from('direct_purchases')
          .select('id, code, created_at, company_id, supplier_id, category, items, total, alicuota_iva, note');

        if (desde) dirQuery = dirQuery.gte('created_at', `${desde}T00:00:00`);
        if (hasta) dirQuery = dirQuery.lte('created_at', `${hasta}T23:59:59`);

        // 3. Tablas de apoyo
        const [reqRes, dirRes, supRes, machRes, cuenRes] = await Promise.all([
          ambito !== 'directas' ? reqQuery : Promise.resolve({ data: [] }),
          ambito !== 'requerimientos' ? dirQuery : Promise.resolve({ data: [] }),
          supabase.from('suppliers').select('id, name, rif'),
          supabase.from('machinery').select('id, code, plate, name'),
          supabase.from('cuentas').select('id, inventory_requirement_id, monto, estado, tipo').eq('tipo', 'por_pagar'),
        ]);

        if (cancelado) return;

        const suppliers = (supRes.data || []) as Array<{ id: string; name: string; rif?: string }>;
        const machinery = (machRes.data || []) as Array<{ id: string; code?: string; plate?: string; name?: string }>;
        const cuentas = (cuenRes.data || []) as Array<{ id: string; inventory_requirement_id?: string; monto: number; estado: string }>;

        const supMap = new Map(suppliers.map((s) => [s.id, s]));
        const cuentasMap = new Map(cuentas.map((c) => [c.inventory_requirement_id || '', c]));

        const resultado: CompraParaReporte[] = [];

        // Procesar Requerimientos
        for (const r of (reqRes.data || []) as any[]) {
          const sup = r.supplier_id ? supMap.get(r.supplier_id) : null;
          const cuenta = cuentasMap.get(r.id);

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

          // Extraer maquinaria y enriquecer con placa
          const matchMaq = (r.observaciones || '').match(/\[DESTINO_MAQUINA:\s*([^\]]+)\]/i);
          const destino = matchMaq ? matchMaq[1].trim() : (r.area || 'General');
          const destinoConPlaca = enriquecerMaquinariaConPlaca(destino, machinery);

          resultado.push({
            id: r.id,
            tipo: 'requerimiento',
            codigo: r.code || 'REQ-S/C',
            fecha: (r.created_at || '').slice(0, 10),
            departamento: (r.area || 'Operaciones').toUpperCase(),
            destinoMaquinaria: destinoConPlaca,
            proveedorNombre: sup?.name || 'Sin proveedor asignado',
            proveedorRif: sup?.rif || null,
            analistaNombre: r.decided_by_name || r.requested_by_name || '—',
            solicitanteNombre: r.solicitante_nombre || r.requested_by_name || '—',
            prioridad: r.prioridad || 'media',
            status: r.status || 'pendiente',
            statusLabel: r.status === 'recibido' ? 'Recibida' : r.status === 'aprobado' ? 'Confirmada pagar' : 'Pendiente por aprobar',
            items,
            totalUsd: totalUsd > 0 ? totalUsd : (cuenta ? Number(cuenta.monto) : 0),
            montoPagadoUsd: cuenta?.estado === 'pagada' ? (cuenta.monto || totalUsd) : 0,
            saldoPendienteUsd: cuenta?.estado === 'pagada' ? 0 : totalUsd,
            observacion: r.note || r.title || null,
          });
        }

        // Procesar Compras Directas
        for (const cd of (dirRes.data || []) as any[]) {
          const sup = cd.supplier_id ? supMap.get(cd.supplier_id) : null;
          const items: CompraItemLinea[] = (Array.isArray(cd.items) ? cd.items : []).map((it: any) => ({
            name: it.name || it.description || 'Ítem',
            category: cd.category || it.category || 'Insumos',
            quantity: Number(it.qty) || 1,
            unit: it.unit || 'u.',
            unitPrice: Number(it.price) || 0,
            total: (Number(it.qty) || 1) * (Number(it.price) || 0),
            exento: Boolean(it.exento),
          }));

          resultado.push({
            id: cd.id,
            tipo: 'directa',
            codigo: cd.code || 'CD-S/C',
            fecha: (cd.created_at || '').slice(0, 10),
            departamento: (cd.category || 'Compras Directas').toUpperCase(),
            proveedorNombre: sup?.name || 'Proveedor directo',
            proveedorRif: sup?.rif || null,
            analistaNombre: 'Caja Chica / Directa',
            status: 'recibida',
            statusLabel: 'Recibida / Contado',
            items,
            totalUsd: Number(cd.total) || 0,
            montoPagadoUsd: Number(cd.total) || 0,
            saldoPendienteUsd: 0,
            observacion: cd.note || 'Compra directa con factura',
          });
        }

        setComprasCargadas(resultado);
      } catch (err: any) {
        if (!cancelado) setErrorMsg(err?.message || 'Error al consultar compras en la base.');
      } finally {
        if (!cancelado) setCargando(false);
      }
    }

    cargarDatos();
    return () => { cancelado = true; };
  }, [visible, desde, hasta, ambito]);

  // Totales en memoria para vista rápida
  const resumenRapido = useMemo(() => {
    const total = comprasCargadas.reduce((acc, c) => acc + c.totalUsd, 0);
    return { count: comprasCargadas.length, total };
  }, [comprasCargadas]);

  // Generar y Exportar PDF
  const handleExportar = async () => {
    if (comprasCargadas.length === 0) return;
    setGenerandoPdf(true);
    try {
      const tasaNum = Number(tasaManual) || bcv.rate || 0;
      const periodoTexto = desde && hasta ? `${desde} al ${hasta}` : 'Período completo';

      const config: OpcionesReporteCompras = {
        periodoLabel: periodoTexto,
        fechaDesde: desde,
        fechaHasta: hasta,
        ambitoLabel: ambito === 'todo' ? 'ÓRDENES Y COMPRAS DIRECTAS' : ambito === 'requerimientos' ? 'ÓRDENES DE COMPRA' : 'COMPRAS DIRECTAS',
        agrupacionLabel: 'DEPARTAMENTO',
        tasaBcv: tasaNum,
        logo: logoSel,
        sinKpis,
        sinDistribucionDept,
        sinRankingDept,
        sinTopCategorias,
        sinPendientes,
        sinTrazabilidad,
      };

      const transformado = transformarDatosReporteCompras(comprasCargadas, config);
      const html = generarReporteComprasHtml(transformado, config);
      const nombreArchivo = `Reporte-Compras-GoldenTouch-${desde || 'inicio'}-${hasta || 'hoy'}.pdf`;

      await exportPdf(html, nombreArchivo);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Error al generar el PDF.');
    } finally {
      setGenerandoPdf(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: spacing.sm }}>
        <View style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          width: '100%',
          maxWidth: 680,
          maxHeight: '92%',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
        }}>

          {/* Cabecera */}
          <View style={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.surfaceAlt,
            borderBottomWidth: 1,
            borderColor: colors.border,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <View>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>📊 Reporte de Compras (Golden Touch)</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Formato ejecutivo bimonetario con KPIs, ranking y trazabilidad</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: spacing.xs }}>
              <Text style={{ fontSize: 20, color: colors.muted }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Contenido scrolleable */}
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>

            {/* Atajos de Período */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>PERÍODO</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {([['hoy', '📅 Hoy'], ['semana', '🗓️ Esta semana'], ['mes', '📆 Este mes'], ['libre', '✨ Rango libre']] as const).map(([k, lbl]) => {
                  const on = periodoAtajo === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setPeriodoAtajo(k)}
                      style={{
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 6,
                        borderRadius: radius.pill,
                        backgroundColor: on ? colors.brand : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: on ? colors.brand : colors.border,
                      }}
                    >
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{lbl}</Text>
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
                      placeholder="2026-11-01"
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
                      placeholder="2026-11-13"
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

            {/* Ámbito */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>ÁMBITO DE COMPRAS</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {([['todo', '📑 Todas'], ['requerimientos', '🧾 Solo Órdenes/Reqs'], ['directas', '🛒 Solo Directas']] as const).map(([k, lbl]) => {
                  const on = ambito === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setAmbito(k)}
                      style={{
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 6,
                        borderRadius: radius.pill,
                        backgroundColor: on ? colors.brand : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: on ? colors.brand : colors.border,
                      }}
                    >
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Tasa BCV */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>TASA OFICIAL BCV (BS/$)</Text>
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

            {/* Selector de Logotipo */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>MEMBRETE Y LOGO</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {([['golden', '✨ Golden Touch'], ['sos', '🌴 SOS La Guaira'], ['bcv', '🏛️ BCV'], ['renace', '🇻🇪 Renace'], ['jhenzaen', '🏢 Jhenzaen']] as const).map(([k, lbl]) => {
                  const on = logoSel === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setLogoSel(k)}
                      style={{
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 5,
                        borderRadius: radius.pill,
                        backgroundColor: on ? colors.accent : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: on ? colors.accent : colors.border,
                      }}
                    >
                      <Text style={{ color: on ? colors.accentContrast : colors.text, fontSize: 11, fontWeight: '700' }}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Pastillas ¿Qué se oculta? */}
            <View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>¿QUÉ SE OCULTA DEL REPORTE?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {[
                  { state: sinKpis, toggle: () => setSinKpis(!sinKpis), label: '🚫 Resumen KPIs' },
                  { state: sinDistribucionDept, toggle: () => setSinDistribucionDept(!sinDistribucionDept), label: '🚫 Top Gasto Dpto' },
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

            {/* Aviso de error si hubo */}
            {errorMsg ? (
              <View style={{ backgroundColor: '#fee2e2', borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: '#fca5a5' }}>
                <Text style={{ color: '#b91c1c', fontSize: 12 }}>⚠️ {errorMsg}</Text>
              </View>
            ) : null}

            {/* Resumen de carga */}
            <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: colors.muted, fontSize: 11 }}>COMPRAS ENCONTRADAS</Text>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>
                  {cargando ? 'Consultando base...' : `${resumenRapido.count} compras`}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: colors.muted, fontSize: 11 }}>MONTO TOTAL</Text>
                <Text style={{ color: colors.brandText, fontSize: 16, fontWeight: '900' }}>
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
              disabled={cargando || generandoPdf || comprasCargadas.length === 0}
              style={{
                flex: 2,
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.accent,
                alignItems: 'center',
                opacity: (cargando || generandoPdf || comprasCargadas.length === 0) ? 0.6 : 1,
                flexDirection: 'row',
                justifyContent: 'center',
                gap: spacing.xs,
              }}
            >
              {generandoPdf ? (
                <>
                  <ActivityIndicator color={colors.accentContrast} size="small" />
                  <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>Generando PDF...</Text>
                </>
              ) : (
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>📄 DESCARGAR PDF</Text>
              )}
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}
