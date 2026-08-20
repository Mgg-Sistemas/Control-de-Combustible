// ── Requerimiento de compra ──────────────────────────────────────────────────
// Lista de productos (del inventario o NUEVOS) que se pasa al jefe para que
// APRUEBE o RECHACE la compra. Vive en el módulo COMPRAS (antes en Inventario).
// Si se aprueba con proveedor → genera orden + cuenta por pagar (trigger de BD
// `req_sync_compra`). Si se compra, se RECIBE en el inventario (genera entradas
// con el precio real). La recepción de stock sigue necesitando permiso de
// inventario. Solo los administradores aprueban/rechazan.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Platform, Image, Linking } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, ExpandableCard, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { norm, onlyDecimal } from '../lib/text';
import { InventoryRequirement, RequirementLine, InventoryLevel, Company, Supplier } from '../types/database';
import { exportPdf } from '../lib/pdf';
import { pickAndUploadRequirementFile } from '../lib/photo';
import { requerimientoHtml, requerimientosBulkHtml, requerimientosResumenHtml, ReqPdfData } from '../lib/requerimiento';
import { useBcvRate, bsFromUsd, usdFromBs, fmtBs } from '../lib/bcv';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
function parseNum(t: string): number { const n = Number(String(t ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
const nowISO = () => new Date().toISOString();

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

type ReqRow = { key: string; product_id: string | null; name: string; unit: string; qty: string; price: string; currency: 'USD' | 'VES'; note: string };
const REQ_STATUS: Record<string, { label: string; color: string; short: string }> = {
  pendiente: { label: '⏳ Pendiente por aprobación del Gerente General', color: '#D97706', short: 'Pendiente' },
  aprobado: { label: '✅ Aprobado', color: '#2563EB', short: 'Aprobado' },
  rechazado: { label: '❌ Rechazado', color: '#DC2626', short: 'Rechazado' },
  recibido: { label: '📦 Recibido', color: '#16A34A', short: 'Recibido' },
};
function nextReqCode(codes: (string | null | undefined)[], bump = 0): string {
  let max = 0;
  codes.forEach((c) => { const m = String(c ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
  return 'REQ-' + String(max + 1 + bump).padStart(4, '0');
}
const dmyOf = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

export function RequerimientoTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session, role, moduleLevel } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const isAdmin = role === 'admin';
  // Full control de Inventario (no solo admin) también puede marcar "Recibido" —
  // pedido directo del cliente (04/08/2026): que el permiso "todos los permisos de
  // inventario" alcance para cambiar ese estado, sin depender del rol.
  const canReceive = isAdmin || levelMeets(moduleLevel('inventario'), 'full');
  const uid = session?.user?.id ?? null;
  const { rate } = useBcvRate();
  const { data: reqs, loading, refetch } = useTable<InventoryRequirement>('inventory_requirements', { orderBy: 'created_at', ascending: false });
  // Filtro por estatus del requerimiento (+ "sin precio" para ubicar los que faltan cargar precio).
  const [filterStatus, setFilterStatus] = useState<'todos' | 'pendiente' | 'aprobado' | 'rechazado' | 'recibido' | 'sin_precio'>('todos');
  const faltaPrecioDe = (r: InventoryRequirement) => r.items.some((it) => !(Number(it.est_price) > 0));
  // Búsqueda libre (código, título, nota, solicitante, empresa, nombre de los ítems) +
  // rango de fecha (por created_at, ISO AAAA-MM-DD) — se combinan con el filtro de estatus.
  const [listQuery, setListQuery] = useState('');
  const [reqDateFrom, setReqDateFrom] = useState('');
  const [reqDateTo, setReqDateTo] = useState('');
  // Selección manual (checkbox) para descargar en UN SOLO PDF a los elegidos; si no hay
  // ninguno seleccionado, el PDF por lote toma a TODOS los que quedaron filtrados.
  const [reqSelIds, setReqSelIds] = useState<Set<string>>(new Set());
  const toggleReqSel = (id: string) => setReqSelIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const { data: levels } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name', ascending: true });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? null : null);
  // Proveedores del catálogo (para asignar al requerimiento — opcional).
  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });

  // Crear / editar requerimiento (editId != null → estamos editando ese requerimiento)
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null); // empresa del requerimiento
  const [supplierId, setSupplierId] = useState<string | null>(null); // proveedor (opcional) → orden + cuenta por pagar
  const [rows, setRows] = useState<ReqRow[]>([]);
  const [q, setQ] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [supQ, setSupQ] = useState('');       // búsqueda de proveedor
  const [supOpen, setSupOpen] = useState(false); // desplegable de proveedor abierto
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);                    // error visible DENTRO del Modal (el toast queda tapado)
  const [subiendoId, setSubiendoId] = useState<string | null>(null);              // formato subiendo
  const [previewReq, setPreviewReq] = useState<InventoryRequirement | null>(null); // vista previa del formato
  // Formato (imagen/PDF) adjuntado AL CREAR/EDITAR el requerimiento (antes de guardar).
  const [formato, setFormato] = useState<{ url: string; kind: 'image' | 'pdf'; name: string } | null>(null);
  const [subiendoNuevo, setSubiendoNuevo] = useState(false);

  // Recibir en inventario
  const [recvFor, setRecvFor] = useState<InventoryRequirement | null>(null);
  const [recvRows, setRecvRows] = useState<{ product_id: string | null; name: string; unit: string | null; qty: string; price: string; currency: 'USD' | 'VES' }[]>([]);
  const [recvBusy, setRecvBusy] = useState(false);

  const inp = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  let seq = 0;
  const newKey = () => `${Date.now()}-${seq++}-${rows.length}`;
  const addBlank = () => setRows((r) => [...r, { key: newKey(), product_id: null, name: '', unit: '', qty: '1', price: '0', currency: 'USD', note: '' }]);
  const addFromProduct = (it: InventoryLevel) => {
    setRows((r) => [...r, { key: newKey(), product_id: it.id, name: it.name, unit: it.unit || '', qty: '1', price: String(Number(it.avg_cost) || 0), currency: 'USD', note: '' }]);
    setPickOpen(false); setQ('');
  };
  const upd = (key: string, field: keyof ReqRow, val: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, [field]: val } : x)));
  const rm = (key: string) => setRows((r) => r.filter((x) => x.key !== key));

  const nq = norm(q);
  const productos = levels.filter((it) => !nq || norm(it.name).includes(nq) || norm(it.sku ?? '').includes(nq)).slice(0, 25);

  const perfilNombre = async (): Promise<string | null> => {
    if (!uid) return null;
    const { data } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
    return (data as any)?.full_name ?? null;
  };

  // Adjunta el formato (imagen/PDF) AL CREAR/EDITAR: sube el archivo y lo deja en
  // memoria (`formato`); se guarda junto con el requerimiento al enviar.
  const adjuntarFormatoNuevo = async () => {
    setSubiendoNuevo(true);
    try {
      const folder = editId || `nuevo-${Date.now()}`;
      const res = await pickAndUploadRequirementFile(folder);
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      setFormato({ url: res.url!, kind: res.kind!, name: res.name ?? 'formato' });
    } finally {
      setSubiendoNuevo(false);
    }
  };

  const crear = async () => {
    setFormErr(null);
    const items: RequirementLine[] = rows.filter((x) => x.name.trim()).map((x) => ({
      product_id: x.product_id, name: x.name.trim().toUpperCase(), unit: x.unit.trim().toUpperCase() || null,
      qty: parseNum(x.qty), est_price: parseNum(x.price), currency: x.currency, note: x.note.trim() || null,
    }));
    if (items.length === 0) { const m = 'Agrega al menos un producto (del inventario o nuevo) antes de guardar.'; setFormErr(m); return toast.error(m); }
    setBusy(true);
    // EDITAR: actualiza el requerimiento existente (conserva su código y estado).
    if (editId) {
      const adj = formato ? { attachment_url: formato.url, attachment_type: formato.kind, attachment_name: formato.name } : {};
      const { error } = await supabase.from('inventory_requirements')
        .update({ title: title.trim() || null, note: note.trim() || null, company_id: companyId, supplier_id: supplierId, items, ...adj })
        .eq('id', editId);
      setBusy(false);
      if (error) { setFormErr(error.message); return toast.error(error.message); }
      setCreateOpen(false); setEditId(null); setTitle(''); setNote(''); setCompanyId(null); setSupplierId(null); setRows([]); setFormato(null);
      refetch();
      toast.success('Requerimiento actualizado.');
      return;
    }
    // CREAR: código correlativo (REQ-000N). Se lee el máximo actual; si la lectura
    // FALLA, se ABORTA (NUNCA se reinicia a 0001 con una lectura vacía). El índice
    // único en `code` impide duplicados; si dos requerimientos chocan en el mismo
    // código, se reintenta con el siguiente número.
    const reqName = await perfilNombre();
    const adj = formato ? { attachment_url: formato.url, attachment_type: formato.kind, attachment_name: formato.name } : {};
    let code = '';
    let saved = false;
    for (let intento = 0; intento < 6 && !saved; intento++) {
      const { data: codeRows, error: readErr } = await supabase.from('inventory_requirements').select('code');
      if (readErr || !codeRows) {
        setBusy(false);
        const m = 'No se pudo leer el número de requerimiento (correlativo). Revisa tu conexión e inténtalo de nuevo.';
        setFormErr(m); return toast.error(m);
      }
      code = nextReqCode(codeRows.map((r: any) => r.code), intento);
      // La BASE reasigna el código con un trigger (correlativo a prueba de fallos);
      // leemos el código REAL que quedó para mostrarlo.
      const { data: inserted, error } = await supabase.from('inventory_requirements').insert({
        code, title: title.trim() || null, note: note.trim() || null, company_id: companyId, supplier_id: supplierId, status: 'pendiente', items,
        requested_by: uid, requested_by_name: reqName, ...adj,
      }).select('code').single();
      if (!error) { if ((inserted as any)?.code) code = (inserted as any).code; saved = true; break; }
      // Código ya usado (índice único): reintenta con el siguiente número.
      if (/duplicate key|already exists|unique|_code_key|23505/i.test(error.message)) continue;
      setBusy(false);
      setFormErr(error.message); return toast.error(error.message);
    }
    setBusy(false);
    if (!saved) { const m = 'No se pudo asignar un número único al requerimiento. Inténtalo de nuevo.'; setFormErr(m); return toast.error(m); }
    setCreateOpen(false); setTitle(''); setNote(''); setCompanyId(null); setSupplierId(null); setRows([]); setFormato(null);
    refetch();
    toast.success(`Requerimiento ${code} enviado. El jefe podrá aprobarlo o rechazarlo.`);
  };

  // Abrir el formulario para EDITAR: precarga título, nota e ítems del requerimiento.
  const abrirEditar = (r: InventoryRequirement) => {
    setEditId(r.id);
    setTitle(r.title ?? '');
    setNote(r.note ?? '');
    setCompanyId(r.company_id ?? null);
    setSupplierId(r.supplier_id ?? null);
    setFormato(r.attachment_url ? { url: r.attachment_url, kind: (r.attachment_type as 'image' | 'pdf') || 'image', name: r.attachment_name || 'formato' } : null);
    let s = 0;
    setRows(r.items.map((it) => ({
      key: `${Date.now()}-${s++}`, product_id: it.product_id, name: it.name, unit: it.unit ?? '',
      qty: String(it.qty), price: String(it.est_price ?? 0), currency: (it.currency as 'USD' | 'VES') || 'USD', note: it.note ?? '',
    })));
    setFormErr(null);
    setCreateOpen(true);
  };

  // Eliminar TODO el requerimiento (con confirmación). No revierte movimientos de
  // inventario ya registrados si estaba "recibido"; solo borra el documento.
  const eliminar = async (r: InventoryRequirement) => {
    const recibido = r.status === 'recibido';
    const ok = await confirm({
      title: 'Eliminar requerimiento',
      message: `¿Eliminar el requerimiento ${r.code ?? ''}? Esta acción no se puede deshacer.` +
        (recibido ? '\n\nNota: ya fue recibido en inventario; sus entradas de stock NO se revierten.' : ''),
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('inventory_requirements').delete().eq('id', r.id);
    if (error) return toast.error(error.message);
    refetch();
  };

  const decidir = async (r: InventoryRequirement, status: 'aprobado' | 'rechazado') => {
    const decName = await perfilNombre();
    const { error } = await supabase.from('inventory_requirements').update({
      status, decided_by: uid, decided_by_name: decName, decided_at: nowISO(),
    }).eq('id', r.id);
    if (error) return toast.error(error.message);
    refetch();
    // Al APROBAR, si trae formato adjunto, se abre la vista previa para ver y descargar.
    if (status === 'aprobado' && r.attachment_url) setPreviewReq({ ...r, status });
  };

  // ANULAR un requerimiento YA APROBADO: el mismo gerente lo rechaza. Pasa a
  // RECHAZADO y el trigger de la BD (req_sync_compra) anula automáticamente la
  // orden de compra y la cuenta por pagar que se hubieran generado. No revierte
  // stock ya recibido (para eso está "recibido", que no permite anular acá).
  const anularAprobado = async (r: InventoryRequirement) => {
    const ok = await confirm({
      title: 'Anular requerimiento aprobado',
      message: `¿Anular (rechazar) el requerimiento ${r.code ?? ''} que ya estaba APROBADO?\n\n` +
        'Quedará RECHAZADO y, si generó orden de compra y cuenta por pagar, se anulan automáticamente. No revierte stock ya recibido.',
      confirmText: 'Anular / Rechazar', cancelText: 'Cancelar', danger: true,
    });
    if (!ok) return;
    await decidir(r, 'rechazado');
  };

  // Sube un FORMATO (imagen o PDF) al requerimiento y lo guarda en la fila.
  const subirFormato = async (r: InventoryRequirement) => {
    setSubiendoId(r.id);
    try {
      const res = await pickAndUploadRequirementFile(r.id);
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      const { data, error } = await supabase.from('inventory_requirements')
        .update({ attachment_url: res.url, attachment_type: res.kind, attachment_name: res.name ?? null })
        .eq('id', r.id).select('id');
      if (error) {
        if (/attachment|column/i.test(error.message)) { toast.error('Corre "requerimientos_adjunto.sql" en Supabase para guardar el formato.'); return; }
        toast.error(error.message); return;
      }
      if (!data || data.length === 0) { toast.error('No tienes permiso de escritura en inventario.'); return; }
      await refetch();
      toast.success('El formato quedó guardado en el requerimiento.');
    } finally {
      setSubiendoId(null);
    }
  };

  // Descarga (o abre) el formato adjunto.
  const descargarFormato = (r: InventoryRequirement) => {
    if (!r.attachment_url) return;
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = r.attachment_url; a.download = r.attachment_name || 'formato'; a.target = '_blank'; a.rel = 'noopener';
      a.click();
    } else {
      Linking.openURL(r.attachment_url);
    }
  };

  // Revierte un requerimiento RECHAZADO de vuelta a PENDIENTE (p. ej. si el rechazo
  // fue un error de dedo). Limpia la decisión y NOTIFICA a los admin (el trigger de
  // la BD solo notifica al crear; al revertir insertamos la notificación a mano).
  const revertirRechazo = async (r: InventoryRequirement) => {
    const ok = await confirm({
      title: 'Volver a pendiente',
      message: `¿Devolver el requerimiento ${r.code ?? ''} a estado PENDIENTE? Se notificará a los administradores.`,
      confirmText: 'Volver a pendiente', cancelText: 'Cancelar',
    });
    if (!ok) return;
    const { data, error } = await supabase.from('inventory_requirements')
      .update({ status: 'pendiente', decided_by: null, decided_by_name: null, decided_at: null })
      .eq('id', r.id).select();
    if (error) { await confirm({ title: 'No se pudo', message: error.message, confirmText: 'OK', cancelText: '' }); return; }
    if (!data || data.length === 0) { await confirm({ title: 'No se pudo', message: 'No tienes permiso o el requerimiento ya no existe.', confirmText: 'OK', cancelText: '' }); return; }
    // Notifica a los admin que el requerimiento volvió a PENDIENTE.
    try {
      await supabase.from('notifications').insert({
        type: 'requerimiento',
        title: 'Requerimiento de vuelta a pendiente',
        body: [r.code, r.title].filter(Boolean).join(' · '),
        target_role: 'admin', entity_type: 'inventory_requirement', entity_id: String(r.id),
        created_by: uid, meta: { code: r.code, status: 'pendiente' },
      });
    } catch {}
    refetch();
  };

  // Cambio de estado MANUAL (corrección administrativa): a diferencia de "Recibir
  // en inventario" (que crea las entradas de stock), esto SOLO cambia la etiqueta
  // del documento — pedido directo del cliente (04/08/2026) para poder corregir un
  // estado sin tener que rehacer todo el flujo. Solo para quien tenga `canReceive`.
  const [statusPickerId, setStatusPickerId] = useState<string | null>(null);
  const cambiarEstadoManual = async (r: InventoryRequirement, status: 'pendiente' | 'aprobado' | 'rechazado' | 'recibido') => {
    const ok = await confirm({
      title: 'Cambiar estado manualmente',
      message: `¿Cambiar ${r.code ?? ''} a "${REQ_STATUS[status].short}"? Esto SOLO cambia la etiqueta del documento — no crea ni revierte entradas de stock en el inventario.` +
        (status === 'recibido' ? '\n\nSi todavía no se recibió físicamente, usa "📥 Recibir en inventario" en su lugar para que el stock quede registrado.' : ''),
      confirmText: 'Cambiar', cancelText: 'Cancelar',
    });
    if (!ok) return;
    const patch: Record<string, any> = { status };
    if (status === 'recibido' && !r.received_at) patch.received_at = nowISO();
    const { error } = await supabase.from('inventory_requirements').update(patch).eq('id', r.id);
    if (error) return toast.error(error.message);
    setStatusPickerId(null);
    refetch();
    toast.success('Estado actualizado.');
  };

  // Abrir "Recibir": precarga los ítems con su precio estimado (para editarlo al real).
  const abrirRecibir = (r: InventoryRequirement) => {
    setRecvFor(r);
    setRecvRows(r.items.map((it) => ({ product_id: it.product_id, name: it.name, unit: it.unit, qty: String(it.qty), price: String(it.est_price || 0), currency: it.currency || 'USD' })));
  };

  const recibir = async () => {
    if (!recvFor) return;
    for (const it of recvRows) { if (parseNum(it.qty) <= 0) return toast.error(`Indica la cantidad recibida de "${it.name}".`); }
    setRecvBusy(true);
    // SKU incremental para los productos NUEVOS.
    const { data: skuRows } = await supabase.from('inventory_items').select('sku');
    let maxN = 0;
    (skuRows ?? []).forEach((r: any) => { const m = String(r.sku ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > maxN) maxN = n; } });
    const pad = (n: number) => 'INV-' + String(n).padStart(4, '0');
    try {
      for (const it of recvRows) {
        let itemId = it.product_id;
        if (!itemId) { // producto NUEVO: se crea a raíz del requerimiento
          maxN += 1;
          const { data: ins, error } = await supabase.from('inventory_items')
            .insert({ name: it.name.toUpperCase(), unit: it.unit || null, sku: pad(maxN), category: 'otros', min_stock: 0, machinery_id: null, company_id: null })
            .select('id').single();
          if (error) throw error;
          itemId = ins.id;
        }
        const priceUsd = it.currency === 'USD' ? parseNum(it.price) : usdFromBs(parseNum(it.price), rate || 0);
        const { error: mErr } = await supabase.from('inventory_movements').insert({
          item_id: itemId, kind: 'entrada', qty: parseNum(it.qty), unit_cost: Math.round((priceUsd || 0) * 10000) / 10000,
          reason: `RECIBIDO DE REQUERIMIENTO ${recvFor.code ?? ''}`.trim(), company_id: null, created_by: uid,
        });
        if (mErr) throw mErr;
      }
      const items2 = recvFor.items.map((it) => ({ ...it, received: true }));
      const { error: uErr } = await supabase.from('inventory_requirements').update({ status: 'recibido', received_at: nowISO(), items: items2 }).eq('id', recvFor.id);
      if (uErr) throw uErr;
      setRecvBusy(false); setRecvFor(null); setRecvRows([]);
      refetch();
      toast.success('Recibido en el inventario. Las entradas quedaron registradas con su precio.');
    } catch (e: any) {
      setRecvBusy(false);
      toast.error(e?.message ?? 'No se pudo recibir en inventario.');
    }
  };

  const totalUsdDe = (r: InventoryRequirement) => r.items.reduce((s, it) => s + (it.currency === 'USD' ? Number(it.est_price) || 0 : usdFromBs(Number(it.est_price) || 0, rate || 0)) * (Number(it.qty) || 0), 0);

  const pdf = async (r: InventoryRequirement) => {
    try {
      await exportPdf(requerimientoHtml({
        code: r.code, fecha: dmyOf(r.created_at), title: r.title, note: r.note,
        company: companyName(r.company_id), requestedBy: r.requested_by_name, statusLabel: REQ_STATUS[r.status]?.short ?? r.status, rate,
        approved: r.status === 'aprobado', decidedBy: r.decided_by_name,
        items: r.items.map((it) => ({ name: it.name, unit: it.unit, qty: it.qty, est_price: it.est_price, currency: it.currency, isNew: !it.product_id })),
      }), `Requerimiento ${r.code ?? dmyOf(r.created_at)}`);
    } catch (e: any) { toast.error('No se pudo generar el PDF: ' + (e?.message ?? e)); }
  };

  const createTotalUsd = rows.reduce((s, x) => s + (x.currency === 'USD' ? parseNum(x.price) : usdFromBs(parseNum(x.price), rate || 0)) * parseNum(x.qty), 0);

  if (loading) return <Screen><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Requerimientos</SectionTitle>
        {canWrite ? (
          <TouchableOpacity onPress={() => { setEditId(null); setTitle(''); setNote(''); setCompanyId(null); setSupplierId(null); setSupOpen(false); setSupQ(''); setRows([]); setFormato(null); setFormErr(null); setCreateOpen(true); }} style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>➕ Nuevo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Pide productos del inventario o nuevos para que el jefe apruebe la compra. Si se compra, se recibe en el inventario con su precio. {rate ? `Tasa hoy: ${fmtBs(rate)}/US$.` : ''}
      </Text>

      {/* Filtro por estatus */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {([
          { k: 'todos', label: 'Todos', color: colors.brandText },
          { k: 'pendiente', label: '⏳ Pendientes', color: '#D97706' },
          { k: 'sin_precio', label: '❗ Sin precio', color: '#DC2626' },
          { k: 'aprobado', label: '✅ Aprobados', color: '#2563EB' },
          { k: 'rechazado', label: '❌ Rechazados', color: '#DC2626' },
          { k: 'recibido', label: '📦 Recibidos', color: '#16A34A' },
        ] as const).map((f) => {
          const on = filterStatus === f.k;
          const n = f.k === 'todos' ? reqs.length : f.k === 'sin_precio' ? reqs.filter(faltaPrecioDe).length : reqs.filter((r) => r.status === f.k).length;
          return (
            <TouchableOpacity key={f.k} onPress={() => setFilterStatus(f.k)} style={{ borderWidth: 1.5, borderColor: f.color, backgroundColor: on ? f.color : 'transparent', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
              <Text style={{ color: on ? '#fff' : f.color, fontWeight: '800', fontSize: 12 }}>{f.label} ({n})</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Búsqueda libre (código, título, nota, solicitante, empresa, ítems) + rango de fecha. */}
      <TextInput
        value={listQuery}
        onChangeText={setListQuery}
        placeholder="🔎 Buscar: código, título, nota, solicitante, empresa, producto…"
        placeholderTextColor={colors.muted}
        style={{ ...inp, marginBottom: spacing.xs }}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
          <DateField value={reqDateFrom} onChange={setReqDateFrom} placeholder="Cualquiera" maxISO={reqDateTo || undefined} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
          <DateField value={reqDateTo} onChange={setReqDateTo} placeholder="Cualquiera" minISO={reqDateFrom || undefined} />
        </View>
        {reqDateFrom || reqDateTo ? (
          <TouchableOpacity onPress={() => { setReqDateFrom(''); setReqDateTo(''); }} style={{ alignSelf: 'flex-end', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Limpiar</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {(() => {
        const nq = norm(listQuery);
        const filteredReqs = reqs
          .filter((r) => filterStatus === 'todos' ? true : filterStatus === 'sin_precio' ? faltaPrecioDe(r) : r.status === filterStatus)
          .filter((r) => !reqDateFrom || r.created_at.slice(0, 10) >= reqDateFrom)
          .filter((r) => !reqDateTo || r.created_at.slice(0, 10) <= reqDateTo)
          .filter((r) => {
            if (!nq) return true;
            const haystack = [r.code, r.title, r.note, r.requested_by_name, r.decided_by_name, companyName(r.company_id), ...r.items.map((it) => it.name)]
              .filter(Boolean).join(' ');
            return norm(haystack).includes(nq);
          });
        const allSel = filteredReqs.length > 0 && filteredReqs.every((r) => reqSelIds.has(r.id));
        const selectedOrFiltered = () => reqSelIds.size ? filteredReqs.filter((r) => reqSelIds.has(r.id)) : filteredReqs;
        const toReqPdfData = (r: (typeof filteredReqs)[number]): ReqPdfData => ({
          code: r.code, fecha: dmyOf(r.created_at), title: r.title, note: r.note,
          company: companyName(r.company_id), requestedBy: r.requested_by_name, statusLabel: REQ_STATUS[r.status]?.short ?? r.status, rate,
          approved: r.status === 'aprobado', decidedBy: r.decided_by_name,
          items: r.items.map((it) => ({ name: it.name, unit: it.unit, qty: it.qty, est_price: it.est_price, currency: it.currency, isNew: !it.product_id })),
        });
        const pdfMultiple = async () => {
          const base = selectedOrFiltered();
          if (base.length === 0) return;
          try {
            await exportPdf(requerimientosBulkHtml(base.map(toReqPdfData)), `Requerimientos ${dmyOf(new Date().toISOString())}`);
          } catch (e: any) { toast.error('No se pudo generar el PDF: ' + (e?.message ?? e)); }
        };
        const pdfResumen = async () => {
          const base = selectedOrFiltered();
          if (base.length === 0) return;
          try {
            await exportPdf(requerimientosResumenHtml(base.map(toReqPdfData)), `Resumen requerimientos ${dmyOf(new Date().toISOString())}`);
          } catch (e: any) { toast.error('No se pudo generar el resumen: ' + (e?.message ?? e)); }
        };
        return filteredReqs.length === 0 ? (
        <EmptyState title="Sin requerimientos" subtitle={filterStatus === 'todos' && !listQuery && !reqDateFrom && !reqDateTo ? 'Crea uno con ➕ Nuevo para pasárselo al jefe.' : 'Ningún requerimiento coincide con el filtro/búsqueda.'} />
      ) : (
        <>
          {/* Selección para el PDF por lote: "Seleccionar todos" marca los VISIBLES (ya
              filtrados/buscados); el botón exporta solo los marcados, o todos los
              filtrados si no hay ninguno marcado. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm, flexWrap: 'wrap', gap: spacing.xs }}>
            <TouchableOpacity onPress={() => setReqSelIds(allSel ? new Set() : new Set(filteredReqs.map((r) => r.id)))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: allSel ? colors.brand : colors.border, backgroundColor: allSel ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {allSel ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
              </View>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Seleccionar todos ({filteredReqs.length})</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <TouchableOpacity onPress={pdfResumen} style={{ backgroundColor: colors.surfaceAlt ?? colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>📄 Resumen{reqSelIds.size ? ` (${reqSelIds.size})` : ` (${filteredReqs.length})`}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={pdfMultiple} style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>📥 PDF{reqSelIds.size ? ` (${reqSelIds.size})` : ` (${filteredReqs.length})`}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {filteredReqs.map((r) => {
            const rSel = reqSelIds.has(r.id);
            return (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs }}>
              <TouchableOpacity onPress={() => toggleReqSel(r.id)} style={{ paddingTop: spacing.md }}>
                <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: rSel ? colors.brand : colors.border, backgroundColor: rSel ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {rSel ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
                </View>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
              {(() => {
        const st = REQ_STATUS[r.status] ?? REQ_STATUS.pendiente;
        const tUsd = totalUsdDe(r);
        const faltaPrecio = faltaPrecioDe(r);
        return (
          <ExpandableCard
            key={r.id}
            summary={
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{r.code ?? 'REQ'} · {r.title || `${r.items.length} ítem(s)`}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{dmyOf(r.created_at)}{companyName(r.company_id) ? ` · 🏢 ${companyName(r.company_id)}` : ''}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: 170 }}>
                    {canReceive ? (
                      <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setStatusPickerId((id) => (id === r.id ? null : r.id)); }}>
                        <Pill label={`${st.label} ${statusPickerId === r.id ? '▴' : '▾'}`} color={st.color} />
                      </TouchableOpacity>
                    ) : (
                      <Pill label={st.label} color={st.color} />
                    )}
                    {faltaPrecio ? <Pill label="❗ Pendiente por cargar precio" color={colors.danger} /> : null}
                  </View>
                </View>
                {/* Cambiar estado A MANO, tocando el badge de arriba — no crea ni revierte
                    stock, solo corrige la etiqueta. Aparte del pill "sin precio". */}
                {canReceive && statusPickerId === r.id ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: spacing.xs, justifyContent: 'flex-end' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Cambiar a:</Text>
                    {(['pendiente', 'aprobado', 'rechazado', 'recibido'] as const).filter((s) => s !== r.status).map((s) => (
                      <TouchableOpacity key={s} onPress={(e) => { e.stopPropagation?.(); cambiarEstadoManual(r, s); }} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>{REQ_STATUS[s].short}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            }
            detail={
              <View>
                {r.items.map((it, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{it.name} {it.product_id ? '' : <Text style={{ color: colors.success, fontSize: 11 }}>· NUEVO</Text>}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{qtyFmt(it.qty)} {it.unit || ''} · {it.currency === 'USD' ? usd(it.est_price) : fmtBs(it.est_price)} c/u</Text>
                    </View>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '900' }}>TOTAL ESTIMADO</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '900' }}>{usd(tUsd)}{rate ? ` · ${fmtBs(bsFromUsd(tUsd, rate))}` : ''}</Text>
                </View>
                {r.status === 'aprobado' && r.decided_by_name ? <Text style={{ color: colors.infoSoftText, fontSize: 11, marginTop: 2 }}>Aprobado por {r.decided_by_name}</Text> : null}
                {r.status === 'rechazado' && r.decided_by_name ? <Text style={{ color: colors.danger, fontSize: 11, marginTop: 2 }}>Rechazado por {r.decided_by_name}</Text> : null}
                {r.status === 'recibido' ? <Text style={{ color: colors.success, fontSize: 11, marginTop: 2 }}>Recibido en inventario{r.received_at ? ` · ${dmyOf(r.received_at)}` : ''}</Text> : null}
                {r.attachment_url ? <Text style={{ color: colors.brandText, fontSize: 11, marginTop: 2, fontWeight: '700' }}>📎 Formato adjunto{r.attachment_type === 'pdf' ? ' (PDF)' : ' (imagen)'}</Text> : null}

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  <TouchableOpacity onPress={() => pdf(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🧾 PDF</Text>
                  </TouchableOpacity>
                  {/* Subir formato (imagen o PDF) al requerimiento. */}
                  {canWrite ? (
                    <TouchableOpacity onPress={() => subirFormato(r)} disabled={subiendoId === r.id} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: subiendoId === r.id ? 0.6 : 1 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>{subiendoId === r.id ? '⏳ Subiendo…' : r.attachment_url ? '📎 Cambiar formato' : '📎 Subir formato'}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Ver formato adjunto (vista previa + descarga). */}
                  {r.attachment_url ? (
                    <TouchableOpacity onPress={() => setPreviewReq(r)} style={{ backgroundColor: colors.infoSoftBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>👁️ Ver formato</Text>
                    </TouchableOpacity>
                  ) : null}
                  {isAdmin && r.status === 'pendiente' ? (
                    <>
                      <TouchableOpacity onPress={() => decidir(r, 'aprobado')} style={{ backgroundColor: colors.infoSoftBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>✅ Aprobar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => decidir(r, 'rechazado')} style={{ backgroundColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>❌ Rechazar</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                  {canReceive && r.status === 'aprobado' ? (
                    <TouchableOpacity onPress={() => abrirRecibir(r)} style={{ backgroundColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>📥 Recibir en inventario</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Anular un requerimiento YA APROBADO: el mismo gerente lo rechaza y la
                      BD anula la orden de compra + cuenta por pagar generadas. */}
                  {isAdmin && r.status === 'aprobado' ? (
                    <TouchableOpacity onPress={() => anularAprobado(r)} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>⛔ Anular (rechazar)</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Revertir un rechazo (error de dedo) → vuelve a PENDIENTE y notifica. */}
                  {isAdmin && r.status === 'rechazado' ? (
                    <TouchableOpacity onPress={() => revertirRechazo(r)} style={{ backgroundColor: colors.warning, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>↩ Volver a pendiente</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Editar todo el requerimiento (no si ya se recibió en inventario). */}
                  {canWrite && r.status !== 'recibido' ? (
                    <TouchableOpacity onPress={() => abrirEditar(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>✏️ Editar</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Eliminar todo el requerimiento. */}
                  {canWrite ? (
                    <TouchableOpacity onPress={() => eliminar(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️ Eliminar</Text>
                    </TouchableOpacity>
                  ) : null}
                  {!isAdmin && r.status === 'pendiente' ? <Text style={{ color: colors.muted, fontSize: 11, alignSelf: 'center' }}>Esperando aprobación del jefe…</Text> : null}
                </View>
              </View>
            }
          />
        );
      })()}
              </View>
            </View>
            );
          })}
        </>
      );
      })()}

      {/* ── Crear requerimiento ── */}
      <Modal visible={createOpen} animationType="slide" onRequestClose={() => { setCreateOpen(false); setEditId(null); }}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>{editId ? 'Editar requerimiento' : 'Nuevo requerimiento'}</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Título (opcional)</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="EJ. REPUESTOS EXCAVADORA 320" placeholderTextColor={colors.muted} style={inp} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Nota / justificación (opcional)</Text>
              <TextInput value={note} onChangeText={setNote} placeholder="Para qué se necesita…" placeholderTextColor={colors.muted} multiline style={[inp, { minHeight: 60, textAlignVertical: 'top' }]} />

              {/* Empresa para la que se hace el requerimiento (opcional). */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Empresa (opcional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingRight: spacing.md }}>
                {[{ id: null as string | null, name: 'Sin empresa' }, ...companies].map((c) => {
                  const on = companyId === c.id;
                  return (
                    <TouchableOpacity key={c.id ?? '__none__'} onPress={() => setCompanyId(c.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Proveedor (opcional): al asignarlo y APROBAR, la orden pasa a
                  "aprobada" y se genera la CUENTA POR PAGAR (trigger req_sync_compra).
                  Sin proveedor la orden queda en BORRADOR. Los proveedores se crean
                  en la pestaña "Proveedores" de Compras. */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Proveedor (opcional)</Text>
              {/* Selector buscable: muestra el proveedor elegido; al tocarlo abre
                  un buscador con la lista filtrada (hay muchos proveedores). */}
              <TouchableOpacity onPress={() => setSupOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: supplierId ? colors.brand : colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                <Text style={{ color: supplierId ? colors.text : colors.muted, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                  {supplierId ? (suppliers.find((s) => s.id === supplierId)?.name ?? '—') : 'Sin proveedor'}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{supOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {supOpen ? (
                <View style={{ marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
                  <TextInput value={supQ} onChangeText={setSupQ} placeholder="Buscar proveedor…" placeholderTextColor={colors.muted} style={[inp, { margin: 6 }]} />
                  <View style={{ maxHeight: 200 }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                      {[{ id: null as string | null, name: 'Sin proveedor' }, ...suppliers.filter((s) => !supQ.trim() || norm(s.name).includes(norm(supQ)))].map((s) => {
                        const on = supplierId === s.id;
                        return (
                          <TouchableOpacity key={s.id ?? '__none__'} onPress={() => { setSupplierId(s.id); setSupOpen(false); setSupQ(''); }} style={{ paddingVertical: 9, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: on ? colors.brand : 'transparent' }}>
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{s.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {suppliers.filter((s) => !supQ.trim() || norm(s.name).includes(norm(supQ))).length === 0 ? (
                        <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.md }}>Sin coincidencias.</Text>
                      ) : null}
                    </ScrollView>
                  </View>
                </View>
              ) : null}
              <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>Al asignar proveedor y aprobar, se generan la orden de compra y la cuenta por pagar automáticamente.</Text>
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={() => setPickOpen((v) => !v)} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>📦 Del inventario</Text></TouchableOpacity>
              <TouchableOpacity onPress={addBlank} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>＋ Producto nuevo</Text></TouchableOpacity>
            </View>

            {pickOpen ? (
              <Card>
                <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto por nombre o SKU…" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />
                <View style={{ maxHeight: 200 }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {productos.map((it) => (
                      <TouchableOpacity key={it.id} onPress={() => addFromProduct(it)} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{it.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{it.sku ? `${it.sku} · ` : ''}Stock {qtyFmt(it.stock)} · PMP {usd(it.avg_cost)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </Card>
            ) : null}

            {rows.map((x) => {
              const otra = x.currency === 'USD' ? fmtBs(bsFromUsd(parseNum(x.price), rate || 0)) : usd(usdFromBs(parseNum(x.price), rate || 0));
              return (
                <Card key={x.key}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <Text style={{ color: x.product_id ? colors.muted : colors.success, fontSize: 11, fontWeight: '700' }}>{x.product_id ? 'Del inventario' : 'Producto NUEVO'}</Text>
                    <TouchableOpacity onPress={() => rm(x.key)}><Text style={{ color: colors.danger, fontWeight: '800' }}>🗑 Quitar</Text></TouchableOpacity>
                  </View>
                  <TextInput value={x.name} onChangeText={(t) => upd(x.key, 'name', t)} editable={!x.product_id} placeholder="Nombre del producto" placeholderTextColor={colors.muted} style={[inp, x.product_id ? { color: colors.muted } : null]} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6, alignItems: 'flex-end' }}>
                    <View style={{ width: 64 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cant</Text><TextInput value={x.qty} onChangeText={(t) => upd(x.key, 'qty', onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'center' }]} /></View>
                    <View style={{ width: 70 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Unidad</Text><TextInput value={x.unit} onChangeText={(t) => upd(x.key, 'unit', t.toUpperCase())} placeholder="UND" placeholderTextColor={colors.muted} style={inp} /></View>
                    <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Precio est.</Text><TextInput value={x.price} onChangeText={(t) => upd(x.key, 'price', onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'right' }]} /></View>
                    <TouchableOpacity onPress={() => upd(x.key, 'currency', x.currency === 'USD' ? 'VES' : 'USD')} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{x.currency === 'USD' ? '$' : 'Bs'}</Text>
                    </TouchableOpacity>
                  </View>
                  {parseNum(x.price) > 0 && rate ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'right' }}>≈ {otra} c/u</Text> : null}
                </Card>
              );
            })}

            {rows.length ? (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.text, fontWeight: '900' }}>TOTAL ESTIMADO</Text><Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 16 }}>{usd(createTotalUsd)}</Text></View>
                {rate ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'right' }}>{fmtBs(bsFromUsd(createTotalUsd, rate))}</Text> : null}
              </Card>
            ) : <EmptyState title="Sin productos" subtitle="Agrega productos del inventario o nuevos." />}

            {/* Adjuntar FORMATO (imagen o PDF): cotización, foto del repuesto, planilla… */}
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: 2 }}>📎 Formato (opcional)</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Adjunta una imagen o un PDF (cotización, foto del repuesto, planilla…). El jefe lo verá al aprobar.</Text>
              {formato ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
                  {formato.kind === 'image' ? <Image source={{ uri: formato.url }} style={{ width: 46, height: 46, borderRadius: radius.sm }} /> : <Text style={{ fontSize: 30 }}>📄</Text>}
                  <Text style={{ color: colors.text, fontSize: 12, flex: 1 }} numberOfLines={1}>{formato.name}{formato.kind === 'pdf' ? ' (PDF)' : ''}</Text>
                  <TouchableOpacity onPress={() => setFormato(null)}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Quitar</Text></TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity onPress={adjuntarFormatoNuevo} disabled={subiendoNuevo} style={{ borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: subiendoNuevo ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>{subiendoNuevo ? '⏳ Subiendo…' : formato ? '📎 Cambiar formato' : '📎 Adjuntar imagen o PDF'}</Text>
              </TouchableOpacity>
            </Card>

            {formErr ? (
              <View style={{ marginTop: spacing.sm, backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: colors.dangerSoftText, fontWeight: '700', fontSize: 13 }}>⚠️ {formErr}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => { setCreateOpen(false); setEditId(null); setFormato(null); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : (editId ? '💾 Guardar cambios' : '📤 Enviar al jefe')}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Vista previa del FORMATO adjunto (imagen o PDF) + descarga ── */}
      <Modal visible={!!previewReq} animationType="fade" transparent onRequestClose={() => setPreviewReq(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '90%', overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>📎 {previewReq?.attachment_name || 'Formato'}</Text>
              <TouchableOpacity onPress={() => setPreviewReq(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: spacing.md }}>
              {previewReq?.attachment_url ? (
                previewReq.attachment_type === 'pdf' ? (
                  Platform.OS === 'web'
                    ? React.createElement('iframe', { src: previewReq.attachment_url, style: { width: '100%', height: '65vh', border: 'none', borderRadius: 8 } })
                    : <Text style={{ color: colors.muted, fontSize: 13 }}>Toca "⬇️ Descargar / Abrir" para ver el PDF.</Text>
                ) : (
                  <Image source={{ uri: previewReq.attachment_url }} style={{ width: '100%', height: 420, borderRadius: radius.md }} resizeMode="contain" />
                )
              ) : null}
            </ScrollView>
            <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
              <TouchableOpacity onPress={() => previewReq && descargarFormato(previewReq)} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>⬇️ Descargar / Abrir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Recibir en inventario ── */}
      <Modal visible={!!recvFor} animationType="slide" onRequestClose={() => setRecvFor(null)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Recibir en inventario</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Confirma la cantidad y el PRECIO REAL de compra de cada producto. Se registrará como ENTRADA (los nuevos se crean solos). {recvFor?.code ?? ''}</Text>
            {recvRows.map((it, idx) => {
              const otra = it.currency === 'USD' ? fmtBs(bsFromUsd(parseNum(it.price), rate || 0)) : usd(usdFromBs(parseNum(it.price), rate || 0));
              return (
                <Card key={idx}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{it.name} {it.product_id ? '' : <Text style={{ color: colors.success, fontSize: 11 }}>· NUEVO</Text>}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6, alignItems: 'flex-end' }}>
                    <View style={{ width: 70 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cantidad</Text><TextInput value={it.qty} onChangeText={(t) => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, qty: onlyDecimal(t) } : r))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'center' }]} /></View>
                    <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Precio real (unit.)</Text><TextInput value={it.price} onChangeText={(t) => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, price: onlyDecimal(t) } : r))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'right' }]} /></View>
                    <TouchableOpacity onPress={() => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, currency: r.currency === 'USD' ? 'VES' : 'USD' } : r))} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{it.currency === 'USD' ? '$' : 'Bs'}</Text>
                    </TouchableOpacity>
                  </View>
                  {parseNum(it.price) > 0 && rate ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'right' }}>≈ {otra} c/u</Text> : null}
                </Card>
              );
            })}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setRecvFor(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={recibir} disabled={recvBusy} style={{ flex: 2, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: recvBusy ? 0.6 : 1 }}><Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{recvBusy ? 'Recibiendo…' : '📥 Confirmar entrada'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}
