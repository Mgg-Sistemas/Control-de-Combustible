import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard, AccordionGroup } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { norm, onlyDecimal } from '../lib/text';
import { InventoryItem, InventoryLevel, InventoryMovement, Company, Machinery, Employee, InventoryRequirement, RequirementLine, InventoryTransfer } from '../types/database';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { notaEntregaHtml, NotaItem } from '../lib/notaEntrega';
import { notaTrasladoHtml, TrasladoItem } from '../lib/notaTraslado';
import { buildXlsx, readXlsx } from '../lib/xlsx';
import { requerimientoHtml } from '../lib/requerimiento';
import { useBcvRate, bsFromUsd, usdFromBs, fmtBs } from '../lib/bcv';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
function parseNum(t: string): number { const n = Number(String(t ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
/** Siguiente SKU incremental "INV-0001" a partir de los SKU existentes. */
function nextSkuFrom(skus: (string | null | undefined)[]): string {
  let max = 0;
  skus.forEach((s) => { const m = String(s ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
  return 'INV-' + String(max + 1).padStart(4, '0');
}
const nowISO = () => new Date().toISOString();
function fmtDate(iso: string) { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; }

// Estado FÍSICO del material (manual) y DISPONIBILIDAD (automática por cantidad).
const ESTADOS = ['Nuevo', 'Bueno', 'Regular', 'Dañado'];
const dispoOf = (stock: number, min: number) => (stock <= 0 ? 'Agotado' : min > 0 && stock <= min ? 'Bajo mínimo' : 'Disponible');
const dispoColor = (d: string) => (d === 'Agotado' ? '#DC2626' : d === 'Bajo mínimo' ? '#F59E0B' : '#16A34A');

// ── Carga por lote (Excel/CSV) ───────────────────────────────────────────────
// Columnas de la plantilla (en este orden). Se llena en Excel y se sube como CSV
// o se copia/pega directo desde Excel (separado por tabulaciones).
const LOTE_COLS = ['nombre', 'unidad', 'costo_unitario', 'cantidad_inicial', 'categoria', 'stock_minimo'];
// Plantilla en Excel: SOLO el encabezado (sin filas de ejemplo, vacía para llenar).
const LOTE_ROWS: (string | number)[][] = [LOTE_COLS];

/** Descarga bytes como archivo en web. */
function downloadBytes(filename: string, data: Uint8Array | string, mime: string) {
  if (Platform.OS !== 'web') return;
  const g: any = globalThis as any;
  const parts = typeof data === 'string' ? ['﻿' + data] : [data];
  const blob = new g.Blob(parts, { type: mime });
  const url = g.URL.createObjectURL(blob);
  const a = g.document.createElement('a');
  a.href = url; a.download = filename;
  g.document.body.appendChild(a); a.click(); a.remove();
  g.URL.revokeObjectURL(url);
}

/** Abre el selector de archivos (web) y devuelve las FILAS del Excel (.xlsx) o CSV
 *  elegido, ya como texto separado por tabulaciones (listo para analizar). */
function pickBatchFileWeb(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (Platform.OS !== 'web') { resolve(null); return; }
    const g: any = globalThis as any;
    const input = g.document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.csv,.txt';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      try {
        if (/\.xlsx$/i.test(file.name)) {
          const buf = await file.arrayBuffer();
          const rows = await readXlsx(new Uint8Array(buf));
          resolve(rows.map((r) => r.join('\t')).join('\n'));
        } else {
          resolve(await file.text());
        }
      } catch (e) { reject(e); }
    };
    input.click();
  });
}

/** Parsea texto CSV o pegado desde Excel (tab). Respeta comillas y comas dentro. */
function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim().length) || '';
  const delim = first.includes('\t') ? '\t' : ',';
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { fields.push(cur); cur = ''; }
      else cur += c;
    }
    fields.push(cur);
    rows.push(fields.map((f) => f.trim()));
  }
  return rows;
}

type LoteRow = { rowNo: number; name: string; unit: string; cost: number; qty: number; min: number; category: string; status: 'ok' | 'dup' | 'bad'; problems: string[] };

// Categorías (misma taxonomía que Compras).
const CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: 'repuestos', label: 'Repuestos / Maquinaria', icon: '🔧' },
  { key: 'oficina', label: 'Oficina / Administrativo', icon: '🏢' },
  { key: 'limpieza', label: 'Limpieza / Aseo', icon: '🧹' },
  { key: 'herramientas', label: 'Herramientas', icon: '🛠️' },
  { key: 'servicios', label: 'Servicios', icon: '⚡' },
  { key: 'otros', label: 'Otros', icon: '📦' },
];
const catInfo = (key: string | null) => CATEGORIES.find((c) => c.key === key) || { key: key || 'otros', label: key ? key.toUpperCase() : 'Sin categoría', icon: '📦' };

/** Agrupa una lista por equipo (machinery_id) para el acordeón. */
function groupByMachine<T extends { machinery_id: string | null }>(items: T[], nameOf: (id: string | null) => string) {
  const m = new Map<string, { key: string; name: string; items: T[] }>();
  items.forEach((it) => {
    const k = it.machinery_id ?? '__none__';
    const g = m.get(k) ?? { key: k, name: nameOf(it.machinery_id), items: [] };
    g.items.push(it);
    m.set(k, g);
  });
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const MOV_KIND: Record<string, { label: string; color: string; sign: string }> = {
  entrada: { label: '📥 Entrada', color: '#16A34A', sign: '+' },
  salida: { label: '📤 Salida', color: '#DC2626', sign: '−' },
  consumo: { label: '🔥 Consumo', color: '#EA580C', sign: '−' },
  ajuste: { label: '🔧 Ajuste', color: '#2563EB', sign: '' },
};

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function CategoryPicker({ value, onChange, colors }: { value: string; onChange: (k: string) => void; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {CATEGORIES.map((c) => {
        const on = value === c.key;
        return (
          <TouchableOpacity key={c.key} onPress={() => onChange(c.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <Text style={{ fontSize: 13 }}>{c.icon}</Text>
            <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Existencias ──────────────────────────────────────────────────────────────
function ExistenciasTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session, role } = useAuth();
  const confirm = useConfirm();
  const isAdmin = role === 'admin';
  const { rate, date: rateDate, source: rateSource, loading: rateLoading, refresh: refreshRate, setManual: setRateManual } = useBcvRate();
  const [rateEdit, setRateEdit] = useState('');       // input de tasa manual
  const [rateBusy, setRateBusy] = useState(false);
  const [initCostCur, setInitCostCur] = useState<'USD' | 'VES'>('USD'); // moneda del costo al crear/editar
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: 'inventory_movements' });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('repuestos');
  const [unit, setUnit] = useState('');
  const [sku, setSku] = useState('');
  const [minStock, setMinStock] = useState('');
  const [machineryId, setMachineryId] = useState('');
  const [machineQuery, setMachineQuery] = useState('');
  const [initStock, setInitStock] = useState('');
  const [initCost, setInitCost] = useState('');
  const [estado, setEstado] = useState('');       // estado físico (Nuevo/Bueno/Regular/Dañado)
  const [editQty, setEditQty] = useState('');      // cantidad al editar (se ajusta con un movimiento)
  const [editStock0, setEditStock0] = useState(0); // stock actual al abrir edición (para el delta)
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = crear; id = editar
  // Carga por lote (Excel/CSV).
  const [loteOpen, setLoteOpen] = useState(false);
  const [loteText, setLoteText] = useState('');
  const [loteRows, setLoteRows] = useState<LoteRow[] | null>(null);
  const [loteBusy, setLoteBusy] = useState(false);

  const machineLabel = (m: Machinery) => `${m.code}${m.serial ? ` · ${m.serial}` : ''}`;
  const machineName = (id: string | null) => { if (!id) return 'Sin equipo'; const m = machines.find((x) => x.id === id); return m ? machineLabel(m) : 'Equipo'; };
  const machineCompany = (id: string | null) => (id ? machines.find((x) => x.id === id)?.company_id ?? null : null);
  const nq = norm(q);
  const filtered = useMemo(() => levels.filter((it) => !nq || norm(it.name).includes(nq) || norm(it.category).includes(nq)), [levels, nq]);
  const totalValor = useMemo(() => levels.reduce((s, it) => s + (Number(it.stock) || 0) * (Number(it.avg_cost) || 0), 0), [levels]);
  const bajoMin = useMemo(() => levels.filter((it) => Number(it.stock) <= Number(it.min_stock) && Number(it.min_stock) > 0).length, [levels]);

  // Editar un producto existente (nombre, categoría, unidad, stock mínimo). El
  // stock y el PMP NO se editan a mano (derivan de los movimientos).
  const openEdit = (it: InventoryLevel) => {
    setEditingId(it.id);
    setName(it.name || '');
    setCategory(it.category || 'otros');
    setUnit(it.unit || '');
    setSku((it as any).sku || '');
    setMinStock(it.min_stock != null ? String(it.min_stock) : '');
    setInitStock('');
    setEstado(it.estado || '');
    setEditStock0(Number(it.stock) || 0);
    setEditQty(String(Number(it.stock) || 0)); // cantidad actual (editable)
    // Costo unitario (PMP) prellenado, editable (en US$, la moneda base).
    setInitCost(it.avg_cost != null ? String(it.avg_cost) : '');
    setInitCostCur('USD');
    setOpen(true);
  };

  // Elimina un producto y TODO su historial de movimientos (on delete cascade).
  const eliminar = async () => {
    if (!editingId) return;
    const ok = await confirm({
      title: 'Eliminar producto',
      message: `¿Seguro que quieres ELIMINAR "${name}"?\n\nSe borrará el producto y todo su historial de movimientos (entradas, salidas, ajustes). Esta acción no se puede deshacer.`,
      confirmText: 'Sí, eliminar', cancelText: 'Cancelar', danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('inventory_items').delete().eq('id', editingId);
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    setOpen(false); setEditingId(null); setName(''); setInitCost(''); setEstado(''); setEditQty('');
    refetch();
    Alert.alert('Listo', 'Producto eliminado del inventario.');
  };

  const crear = async () => {
    if (!name.trim()) return Alert.alert('Aviso', 'Escribe el nombre del material.');
    const cleanName = name.trim().toUpperCase();
    // Costo unitario en US$ (base): si se ingresó en Bs, se convierte con la tasa del día.
    const costUsd = Math.round((initCostCur === 'USD' ? parseNum(initCost) : usdFromBs(parseNum(initCost), rate || 0)) * 10000) / 10000;
    // Evita duplicados por nombre (excluyendo el que se está editando).
    if (levels.some((it) => norm(it.name) === norm(cleanName) && it.id !== editingId)) return Alert.alert('Aviso', 'Ya existe un material con ese nombre.');
    // ── EDICIÓN ──
    if (editingId) {
      setBusy(true);
      const patch: any = { name: cleanName, category, unit: unit.trim().toUpperCase() || null, min_stock: parseNum(minStock), estado: estado || null };
      // Costo unitario (PMP): si se indicó, se actualiza directo en el producto.
      if (initCost.trim() !== '') patch.avg_cost = costUsd;
      const { error } = await supabase.from('inventory_items').update(patch).eq('id', editingId);
      if (error) { setBusy(false); return Alert.alert('Aviso', error.message); }
      // Cantidad: si cambió, se ajusta con un movimiento de AJUSTE (delta = nueva − actual).
      const nuevaQty = parseNum(editQty);
      const delta = Math.round((nuevaQty - editStock0) * 100) / 100;
      if (delta !== 0) {
        const { error: mErr } = await supabase.from('inventory_movements').insert({
          item_id: editingId, kind: 'ajuste', qty: delta, unit_cost: null,
          reason: 'AJUSTE DE INVENTARIO', company_id: null, created_by: session?.user?.id ?? null,
        });
        if (mErr) { setBusy(false); return Alert.alert('Aviso', mErr.message); }
      }
      setBusy(false);
      setOpen(false); setEditingId(null); setName(''); setCategory('repuestos'); setUnit(''); setSku(''); setMinStock(''); setInitCost(''); setEstado(''); setEditQty('');
      refetch();
      return;
    }
    setBusy(true);
    // SKU incremental: se recalcula al vuelo (con los SKU actuales) para no chocar.
    const { data: skuRows } = await supabase.from('inventory_items').select('sku');
    const autoSku = nextSkuFrom((skuRows ?? []).map((r: any) => r.sku));
    // Inventario GENERAL: no se vincula a empresa ni equipo al crear.
    const { data: ins, error } = await supabase.from('inventory_items')
      .insert({ name: cleanName, category, unit: unit.trim().toUpperCase() || null, sku: autoSku, min_stock: parseNum(minStock), estado: estado || null, machinery_id: null, company_id: null })
      .select('id').single();
    if (error) { setBusy(false); return Alert.alert('Aviso', error.message); }
    // Stock inicial (opcional): registra una entrada que fija existencia y PMP de arranque.
    const qi = parseNum(initStock);
    if (qi > 0) {
      const { error: mErr } = await supabase.from('inventory_movements').insert({
        item_id: ins.id, kind: 'entrada', qty: qi, unit_cost: costUsd || 0,
        reason: 'INVENTARIO INICIAL', company_id: null, created_by: session?.user?.id ?? null,
      });
      if (mErr) { setBusy(false); return Alert.alert('Aviso', mErr.message); }
    }
    setBusy(false);
    setOpen(false); setName(''); setCategory('repuestos'); setUnit(''); setSku(''); setMinStock(''); setMachineryId(''); setMachineQuery(''); setInitStock(''); setInitCost('');
    refetch();
  };

  // Abre el modal calculando el próximo SKU incremental para mostrarlo.
  const openCreate = async () => {
    setEditingId(null);
    setName(''); setCategory('repuestos'); setUnit(''); setMinStock(''); setInitStock(''); setInitCost(''); setInitCostCur('USD'); setEstado(''); setEditQty('');
    const { data } = await supabase.from('inventory_items').select('sku');
    setSku(nextSkuFrom((data ?? []).map((r: any) => r.sku)));
    setOpen(true);
  };

  // ── Reporte de TODOS los productos (cantidad, disponibilidad y estado) ──────
  const reporteProductos = async () => {
    if (levels.length === 0) return Alert.alert('Aviso', 'No hay productos para el reporte.');
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const d = new Date(); const dmy = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const sorted = [...levels].sort((a, b) => norm(a.name).localeCompare(norm(b.name), 'es'));
    const rows = sorted.map((it, i) => {
      const disp = dispoOf(Number(it.stock), Number(it.min_stock));
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.name)}</td>
        <td>${esc(catInfo(it.category).label)}</td>
        <td class="c b">${qtyFmt(it.stock)} ${esc(it.unit || '')}</td>
        <td class="c" style="color:${dispoColor(disp)};font-weight:800">${disp}</td>
        <td class="c">${esc(it.estado || '—')}</td>
      </tr>`;
    }).join('');
    const agotados = sorted.filter((it) => Number(it.stock) <= 0).length;
    const html = pdfDocument({
      title: 'Reporte de inventario',
      subtitle: `Todos los productos (${levels.length}) · ${bajoMin} bajo mínimo · ${agotados} agotado(s) · ${dmy}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left} th{background:#16324F;color:#fff}
        td.c{text-align:center} td.b{font-weight:800} tr:nth-child(even) td{background:#f4f7fb}`,
      body: `
        <table>
          <thead><tr><th style="width:30px" class="c">#</th><th>Producto</th><th>Categoría</th>
            <th class="c">Cantidad</th><th class="c">Disponibilidad</th><th class="c">Estado</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`,
    });
    await exportPdf(html, `Reporte de inventario - ${dmy}`);
  };

  // ── Carga por lote (Excel/CSV) ─────────────────────────────────────────────
  const descargarPlantilla = () => downloadBytes(
    'Plantilla inventario.xlsx',
    buildXlsx(LOTE_ROWS, 'Plantilla'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );

  // Analiza el texto (CSV o pegado de Excel) y marca cada fila: ok / repetida / mala.
  const analizarLote = (text: string) => {
    const rows = parseDelimited(text);
    if (rows.length === 0) { setLoteRows([]); return; }
    // Si la primera fila es el encabezado de la plantilla, se salta.
    const start = norm(rows[0][0] || '') === 'nombre' ? 1 : 0;
    const existing = new Set(levels.map((l) => norm(l.name)));
    const seen = new Set<string>();
    const out: LoteRow[] = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const name = (r[0] || '').trim().toUpperCase();
      const unit = (r[1] || '').trim().toUpperCase() || 'UND';
      const costRaw = (r[2] || '').trim();
      const qtyRaw = (r[3] || '').trim();
      const catRaw = (r[4] || '').trim().toLowerCase();
      const minRaw = (r[5] || '').trim();
      const problems: string[] = [];
      if (!name) problems.push('falta el nombre');
      const cost = costRaw === '' ? 0 : Number(costRaw.replace(',', '.'));
      if (costRaw !== '' && !isFinite(cost)) problems.push('costo unitario inválido');
      const qty = qtyRaw === '' ? 0 : Number(qtyRaw.replace(',', '.'));
      if (qtyRaw !== '' && !isFinite(qty)) problems.push('cantidad inválida');
      const min = minRaw === '' ? 0 : Number(minRaw.replace(',', '.'));
      if (minRaw !== '' && !isFinite(min)) problems.push('stock mínimo inválido');
      const category = CATEGORIES.some((c) => c.key === catRaw) ? catRaw : 'otros';
      let status: LoteRow['status'] = 'ok';
      if (problems.length) status = 'bad';
      else if (seen.has(norm(name))) { status = 'dup'; problems.push('repetido en el archivo'); }
      else if (existing.has(norm(name))) { status = 'dup'; problems.push('ya existe en el inventario'); }
      if (name) seen.add(norm(name));
      out.push({ rowNo: i + 1, name, unit, cost: isFinite(cost) ? cost : 0, qty: isFinite(qty) ? qty : 0, min: isFinite(min) ? min : 0, category, status, problems });
    }
    setLoteRows(out);
  };

  const subirArchivo = async () => {
    try {
      const text = await pickBatchFileWeb();
      if (text == null) return;
      setLoteText(text);
      analizarLote(text);
    } catch (e: any) {
      Alert.alert('Aviso', e?.message ?? 'No se pudo leer el archivo.');
    }
  };

  // Carga solo las filas OK: crea el producto con SKU incremental + su entrada.
  const cargarLote = async () => {
    const ok = (loteRows ?? []).filter((r) => r.status === 'ok');
    if (ok.length === 0) return Alert.alert('Aviso', 'No hay filas válidas para cargar. Corrige las repetidas o mal cargadas.');
    setLoteBusy(true);
    const { data: skuRows } = await supabase.from('inventory_items').select('sku');
    let maxN = 0;
    (skuRows ?? []).forEach((r: any) => { const m = String(r.sku ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > maxN) maxN = n; } });
    const pad = (n: number) => 'INV-' + String(n).padStart(4, '0');
    const toInsert = ok.map((r, i) => ({ name: r.name, unit: r.unit, sku: pad(maxN + i + 1), category: r.category, min_stock: r.min, machinery_id: null, company_id: null }));
    const { data: inserted, error } = await supabase.from('inventory_items').insert(toInsert).select('id, sku');
    if (error) { setLoteBusy(false); return Alert.alert('Aviso', error.message); }
    const idBySku = new Map((inserted ?? []).map((r: any) => [r.sku, r.id]));
    const movs = ok
      .map((r, i) => ({ item_id: idBySku.get(pad(maxN + i + 1)), kind: 'entrada' as const, qty: r.qty, unit_cost: r.cost || 0, reason: 'CARGA POR LOTE', company_id: null, created_by: session?.user?.id ?? null }))
      .filter((m) => m.item_id && m.qty > 0);
    if (movs.length) {
      const { error: mErr } = await supabase.from('inventory_movements').insert(movs);
      if (mErr) { setLoteBusy(false); return Alert.alert('Aviso', 'Productos creados, pero falló el stock inicial: ' + mErr.message); }
    }
    setLoteBusy(false);
    setLoteOpen(false); setLoteText(''); setLoteRows(null);
    refetch();
    Alert.alert('Listo', `Se cargaron ${ok.length} producto(s).`);
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>VALORIZACIÓN</Text>
          <Text style={{ color: '#16A34A', fontSize: 16, fontWeight: '800' }}>{usd(totalValor)}</Text>
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>PRODUCTOS</Text>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{levels.length}</Text>
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>BAJO MÍN.</Text>
          <Text style={{ color: bajoMin ? '#DC2626' : colors.text, fontSize: 16, fontWeight: '800' }}>{bajoMin}</Text>
        </View>
      </View>

      {/* Tasa BCV del día (Bs/US$). Precios del inventario visibles en $ y Bs. */}
      <View style={{ borderWidth: 1, borderColor: '#0F766E', borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>💵 TASA BCV DEL DÍA</Text>
            <Text style={{ color: '#0F766E', fontSize: 16, fontWeight: '900' }}>
              {rateLoading ? 'Cargando…' : rate ? `${fmtBs(rate)} / US$` : 'Sin tasa'}
              {rate ? <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '600' }}>  ({rateSource === 'manual' ? 'manual' : 'BCV'})</Text> : null}
            </Text>
          </View>
          <TouchableOpacity onPress={async () => { setRateBusy(true); try { await refreshRate(); } catch { Alert.alert('Aviso', 'No se pudo actualizar la tasa del BCV. Puedes fijarla a mano.'); } setRateBusy(false); }} disabled={rateBusy} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{rateBusy ? '…' : '🔄 Actualizar'}</Text>
          </TouchableOpacity>
        </View>
        {isAdmin ? (
          <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center', marginTop: spacing.xs }}>
            <TextInput value={rateEdit} onChangeText={(t) => setRateEdit(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="Fijar tasa a mano (Bs/$)" placeholderTextColor={colors.muted} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text }} />
            <TouchableOpacity onPress={async () => { const v = parseNum(rateEdit); if (v <= 0) return Alert.alert('Aviso', 'Escribe una tasa válida.'); await setRateManual(v); setRateEdit(''); }} style={{ backgroundColor: '#0F766E', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Fijar</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto…" placeholderTextColor={colors.muted} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
        {canWrite ? (
          <TouchableOpacity onPress={openCreate} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Producto</Text>
          </TouchableOpacity>
        ) : null}
        {canWrite ? (
          <TouchableOpacity onPress={() => { setLoteText(''); setLoteRows(null); setLoteOpen(true); }} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>📋 Lote</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity onPress={reporteProductos} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📄 Reporte de productos (cantidad y estado)</Text>
      </TouchableOpacity>

      {filtered.length === 0 ? (
        <EmptyState title="Sin productos" subtitle="Agrega productos o recíbelos desde una orden de compra." />
      ) : filtered.map((it) => {
            return (
              <ExpandableCard
                key={it.id}
                summary={
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{it.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{catInfo(it.category).icon} {catInfo(it.category).label}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900' }}>{qtyFmt(it.stock)} {it.unit || ''}</Text>
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 1 }}>
                        {it.estado ? <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>{it.estado}</Text> : null}
                        <Text style={{ color: dispoColor(dispoOf(Number(it.stock), Number(it.min_stock))), fontSize: 11, fontWeight: '800' }}>{dispoOf(Number(it.stock), Number(it.min_stock))}</Text>
                      </View>
                    </View>
                  </View>
                }
                detail={
                  <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <View>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>PMP (costo promedio)</Text>
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{usd(it.avg_cost)}</Text>
                        {rate ? <Text style={{ color: '#0F766E', fontSize: 12, fontWeight: '700' }}>{fmtBs(bsFromUsd(Number(it.avg_cost) || 0, rate))}</Text> : null}
                      </View>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>SKU</Text>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{(it as any).sku || '—'}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>VALOR EN STOCK</Text>
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{usd((Number(it.stock) || 0) * (Number(it.avg_cost) || 0))}</Text>
                        {rate ? <Text style={{ color: '#0F766E', fontSize: 12, fontWeight: '700' }}>{fmtBs(bsFromUsd((Number(it.stock) || 0) * (Number(it.avg_cost) || 0), rate))}</Text> : null}
                      </View>
                    </View>
                    {canWrite ? (
                      <TouchableOpacity onPress={() => openEdit(it)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>✏️ Editar producto</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                }
              />
            );
      })}

      <Modal visible={open} animationType="slide" onRequestClose={() => { setOpen(false); setEditingId(null); }}>
        <Screen>
          <ScrollView>
            <SectionTitle>{editingId ? 'Editar producto' : 'Nuevo producto'}</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Nombre</Text>
              <TextInput value={name} onChangeText={(t) => setName(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. BOMBILLO AMARILLO" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Categoría</Text>
              <CategoryPicker value={category} onChange={setCategory} colors={colors} />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Unidad</Text>
                  <TextInput value={unit} onChangeText={(t) => setUnit(t.toUpperCase())} autoCapitalize="characters" placeholder="UND, LT, KG…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>SKU {editingId ? '' : '(automático)'}</Text>
                  <View style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, justifyContent: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{sku || 'INV-…'}</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Stock mínimo</Text>
                  <TextInput value={minStock} onChangeText={(t) => setMinStock(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Estado del producto</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {ESTADOS.map((e) => {
                  const on = estado === e;
                  return (
                    <TouchableOpacity key={e} onPress={() => setEstado(on ? '' : e)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{e}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Card>
            <Text style={{ color: colors.muted, fontSize: 11 }}>📦 Inventario GENERAL. La máquina y los empleados se eligen al dar salida (pestaña Salida).</Text>
            {editingId ? (
              <Card>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cantidad (existencia)</Text>
                    <TextInput value={editQty} onChangeText={(t) => setEditQty(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Costo unit. ({initCostCur === 'USD' ? 'US$' : 'Bs'})</Text>
                      <TouchableOpacity onPress={() => setInitCostCur(initCostCur === 'USD' ? 'VES' : 'USD')} style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 }}>
                        <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>{initCostCur === 'USD' ? '$→Bs' : 'Bs→$'}</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput value={initCost} onChangeText={(t) => setInitCost(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                    {parseNum(initCost) > 0 && rate ? <Text style={{ color: '#0F766E', fontSize: 11, marginTop: 2 }}>≈ {initCostCur === 'USD' ? fmtBs(bsFromUsd(parseNum(initCost), rate)) : usd(usdFromBs(parseNum(initCost), rate))}</Text> : null}
                  </View>
                </View>
                {parseNum(editQty) !== editStock0 ? (
                  <Text style={{ color: colors.warning, fontSize: 11, marginTop: spacing.xs }}>Se ajustará de {qtyFmt(editStock0)} a {qtyFmt(parseNum(editQty))} (queda registrado como AJUSTE DE INVENTARIO).</Text>
                ) : (
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Cambia la cantidad para corregir la existencia; se registra como un ajuste en Movimientos.</Text>
                )}
              </Card>
            ) : (
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Existencia inicial (opcional)</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Si ya tienes este material a mano, carga la cantidad y su costo unitario. Se registra como INVENTARIO INICIAL y fija el PMP de arranque.</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cantidad</Text>
                  <TextInput value={initStock} onChangeText={(t) => setInitStock(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Costo unit. ({initCostCur === 'USD' ? 'US$' : 'Bs'})</Text>
                    <TouchableOpacity onPress={() => setInitCostCur(initCostCur === 'USD' ? 'VES' : 'USD')} style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>{initCostCur === 'USD' ? '$→Bs' : 'Bs→$'}</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput value={initCost} onChangeText={(t) => setInitCost(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  {parseNum(initCost) > 0 && rate ? <Text style={{ color: '#0F766E', fontSize: 11, marginTop: 2 }}>≈ {initCostCur === 'USD' ? fmtBs(bsFromUsd(parseNum(initCost), rate)) : usd(usdFromBs(parseNum(initCost), rate))}</Text> : null}
                </View>
              </View>
              {parseNum(initStock) > 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Valor inicial: {usd(parseNum(initStock) * (initCostCur === 'USD' ? parseNum(initCost) : usdFromBs(parseNum(initCost), rate || 0)))}</Text> : null}
            </Card>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => { setOpen(false); setEditingId(null); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{busy ? 'Guardando…' : (editingId ? 'Guardar cambios' : 'Guardar')}</Text></TouchableOpacity>
            </View>
            {editingId && canWrite ? (
              <TouchableOpacity onPress={eliminar} disabled={busy} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.danger, fontWeight: '800' }}>🗑 Eliminar producto</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── CARGA POR LOTE (Excel/CSV) ── */}
      <Modal visible={loteOpen} animationType="slide" onRequestClose={() => setLoteOpen(false)}>
        <Screen>
          <ScrollView>
            <SectionTitle>📋 Cargar productos por lote</SectionTitle>
            <Card>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Pasos</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                1) Descarga la plantilla en Excel (.xlsx) y ábrela.{'\n'}
                2) Llena una fila por producto: nombre, unidad, costo unitario, cantidad inicial, categoría y stock mínimo.{'\n'}
                3) Guárdala y súbela con "📁 Subir Excel"; o copia las filas desde Excel y pégalas abajo.{'\n'}
                4) El sistema marca las filas repetidas o mal cargadas antes de guardar. El SKU se asigna solo (INV-####).
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Categorías válidas: {CATEGORIES.map((c) => c.key).join(', ')}.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                <TouchableOpacity onPress={descargarPlantilla} style={{ backgroundColor: '#0F766E', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>⬇️ Descargar plantilla (Excel)</Text>
                </TouchableOpacity>
                {Platform.OS === 'web' ? (
                  <TouchableOpacity onPress={subirArchivo} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>📁 Subir Excel</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>O pega aquí las filas (copiadas desde Excel)</Text>
              <TextInput
                value={loteText}
                onChangeText={setLoteText}
                placeholder={LOTE_COLS.join('\t')}
                placeholderTextColor={colors.muted}
                multiline
                style={{ minHeight: 120, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, textAlignVertical: 'top' }}
              />
              <TouchableOpacity onPress={() => analizarLote(loteText)} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>🔎 Analizar filas</Text>
              </TouchableOpacity>
            </Card>

            {loteRows ? (() => {
              const okN = loteRows.filter((r) => r.status === 'ok').length;
              const dupN = loteRows.filter((r) => r.status === 'dup').length;
              const badN = loteRows.filter((r) => r.status === 'bad').length;
              const bad = loteRows.filter((r) => r.status !== 'ok');
              return (
                <Card>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                    <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ color: '#16A34A', fontSize: 18, fontWeight: '900' }}>{okN}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>Válidas</Text></View>
                    <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ color: '#D97706', fontSize: 18, fontWeight: '900' }}>{dupN}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>Repetidas</Text></View>
                    <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ color: '#DC2626', fontSize: 18, fontWeight: '900' }}>{badN}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>Mal cargadas</Text></View>
                  </View>
                  {bad.length ? (
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12, marginBottom: 4 }}>Filas a revisar (no se cargan):</Text>
                      {bad.map((r) => (
                        <Text key={r.rowNo} style={{ color: r.status === 'dup' ? '#D97706' : '#DC2626', fontSize: 12 }}>
                          • Fila {r.rowNo}{r.name ? ` (${r.name})` : ''}: {r.problems.join(', ')}
                        </Text>
                      ))}
                    </View>
                  ) : <Text style={{ color: '#16A34A', fontSize: 12, fontWeight: '700' }}>✓ Todas las filas están correctas.</Text>}
                  <TouchableOpacity onPress={cargarLote} disabled={loteBusy || okN === 0} style={{ marginTop: spacing.sm, backgroundColor: okN ? colors.primary : colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: loteBusy ? 0.6 : 1 }}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{loteBusy ? 'Cargando…' : `Cargar ${okN} producto(s)`}</Text>
                  </TouchableOpacity>
                </Card>
              );
            })() : null}

            <TouchableOpacity onPress={() => setLoteOpen(false)} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
            <View style={{ height: spacing.xl }} />
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ── Movimientos (trazabilidad) ───────────────────────────────────────────────
function MovimientosTab() {
  const { colors } = useTheme();
  const { data: movs, loading } = useTable<InventoryMovement>('inventory_movements', { orderBy: 'created_at', ascending: false });
  const { data: items } = useTable<InventoryItem>('inventory_items', { orderBy: 'name' });
  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? 'Producto';
  const itemUnit = (id: string) => items.find((i) => i.id === id)?.unit ?? '';

  const [filter, setFilter] = useState('');
  const shown = filter ? movs.filter((m) => m.kind === filter) : movs;

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Movimientos (traza)</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {[{ k: '', l: 'Todos' }, { k: 'entrada', l: '📥 Entradas' }, { k: 'salida', l: '📤 Salidas' }, { k: 'consumo', l: '🔥 Consumo' }, { k: 'ajuste', l: '🔧 Ajustes' }].map((f) => {
          const on = filter === f.k;
          return (
            <TouchableOpacity key={f.k || 'all'} onPress={() => setFilter(f.k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {shown.length === 0 ? (
        <EmptyState title="Sin movimientos" subtitle="Las entradas, salidas y consumos aparecerán aquí." />
      ) : shown.map((m) => {
        const k = MOV_KIND[m.kind] ?? MOV_KIND.ajuste;
        return (
          <ExpandableCard
            key={m.id}
            summary={
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{itemName(m.item_id)}</Text>
                  <Text style={{ color: k.color, fontSize: 13, fontWeight: '800' }}>{k.sign}{qtyFmt(m.qty)} {itemUnit(m.item_id)}</Text>
                </View>
                <Pill label={k.label} color={k.color} />
              </View>
            }
            detail={
              <>
                {m.unit_cost != null ? <Text style={{ color: colors.muted, fontSize: 13 }}>Costo unitario: {usd(m.unit_cost)}</Text> : null}
                {m.reason ? <Text style={{ color: colors.text, fontSize: 13 }}>{m.reason}</Text> : null}
                {m.order_id ? <Text style={{ color: '#16A34A', fontSize: 13, fontWeight: '700' }}>🧾 Desde orden de compra</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDate(m.created_at)}</Text>
              </>
            }
          />
        );
      })}
    </Screen>
  );
}

// ── Nota de SALIDA ───────────────────────────────────────────────────────────
function NotaTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: 'inventory_movements' });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'first_name' });

  const [q, setQ] = useState('');
  const [cart, setCart] = useState<{ id: string; name: string; unit: string; qty: number; avg_cost: number; stock: number; company_id: string | null }[]>([]);
  const [destino, setDestino] = useState('');
  const [descontar, setDescontar] = useState(true); // registra la salida (descuenta stock)
  const [busy, setBusy] = useState(false);
  // Equipo y empleados que reciben (para la nota).
  const [machineryId, setMachineryId] = useState('');
  const [machineQuery, setMachineQuery] = useState('');
  const [machOpen, setMachOpen] = useState(false);
  const [empQuery, setEmpQuery] = useState('');
  const [empSel, setEmpSel] = useState<{ id: string; name: string }[]>([]);
  const [empOpen, setEmpOpen] = useState(false);

  const nq = norm(q);
  const filtered = useMemo(() => levels.filter((it) => Number(it.stock) > 0 && (!nq || norm(it.name).includes(nq))), [levels, nq]);
  const inCart = (id: string) => cart.find((c) => c.id === id);
  const machineLabel = (m: Machinery) => `${m.code}${m.serial ? ` · ${m.serial}` : ''}`;
  const machineName = (id: string) => { const m = machines.find((x) => x.id === id); return m ? machineLabel(m) : ''; };
  const empName = (e: Employee) => `${(e as any).first_name ?? ''} ${(e as any).last_name ?? ''}`.trim() || 'Sin nombre';
  const toggleEmp = (e: Employee) => setEmpSel((prev) => prev.some((x) => x.id === (e as any).id) ? prev.filter((x) => x.id !== (e as any).id) : [...prev, { id: (e as any).id, name: empName(e) }]);

  const addToCart = (it: InventoryLevel) => {
    if (inCart(it.id)) return;
    setCart((prev) => [...prev, { id: it.id, name: it.name, unit: it.unit || '', qty: 1, avg_cost: Number(it.avg_cost) || 0, stock: Number(it.stock) || 0, company_id: it.company_id ?? null }]);
  };
  const setQty = (id: string, t: string) => {
    const n = parseNum(onlyDecimal(t));
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty: n } : c)));
  };
  const removeFromCart = (id: string) => setCart((prev) => prev.filter((c) => c.id !== id));

  const todayDMY = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

  const generar = async () => {
    if (cart.length === 0) return Alert.alert('Aviso', 'Agrega al menos un producto a la nota.');
    // Validación de cantidades y stock (la salida descuenta del inventario SOLO al confirmar).
    for (const c of cart) {
      if (c.qty <= 0) return Alert.alert('Aviso', `Indica la cantidad de "${c.name}".`);
      if (c.qty > c.stock) return Alert.alert('Aviso', `No hay suficiente stock de "${c.name}". Disponible: ${qtyFmt(c.stock)} ${c.unit}.`);
    }
    setBusy(true);
    // 1) VISTA PREVIA PRIMERO. Solo si el usuario imprime/guarda (confirma) se
    //    descuenta del inventario. Si CANCELA, no se descuenta nada y NO se pierde
    //    lo seleccionado (el carrito queda tal cual para seguir editándolo).
    const items: NotaItem[] = cart.map((c) => ({ name: c.name, qty: c.qty, unit: c.unit }));
    let confirmado = false;
    try {
      confirmado = await exportPdf(notaEntregaHtml({
        fecha: todayDMY(),
        destino: destino.trim() || null,
        maquina: machineryId ? machineName(machineryId) : null,
        empleados: empSel.map((e) => e.name),
        items,
      }), `Nota de salida - ${todayDMY()}`);
    } catch (e: any) {
      setBusy(false);
      return Alert.alert('Aviso', 'No se pudo generar el PDF: ' + (e?.message ?? e));
    }
    if (!confirmado) {
      // Canceló la vista previa: no se descuenta y se conserva la selección.
      setBusy(false);
      return;
    }
    // 2) CONFIRMADO: registra la salida de cada producto (descuenta del inventario).
    {
      const detalleMaq = machineryId ? ` · ${machineName(machineryId)}` : '';
      const rows = cart.map((c) => ({
        item_id: c.id, kind: 'salida' as const, qty: c.qty, unit_cost: c.avg_cost || null,
        reason: `NOTA DE SALIDA${destino.trim().toUpperCase() ? ` · ${destino.trim().toUpperCase()}` : ''}${detalleMaq}`,
        company_id: c.company_id, created_by: session?.user?.id ?? null,
      }));
      const { error } = await supabase.from('inventory_movements').insert(rows);
      if (error) { setBusy(false); return Alert.alert('Aviso', error.message); }
    }
    setBusy(false);
    setCart([]); setDestino(''); setMachineryId(''); setMachineQuery(''); setEmpSel([]); setEmpQuery('');
    refetch();
    Alert.alert('Listo', 'Nota generada. La salida se descontó del inventario.');
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Nota de salida</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
        Agrega los productos que salen, indica la cantidad y genera el documento con logo, fecha y línea de firma autorizado.
      </Text>

      {/* Productos en la nota (carrito) */}
      {cart.length > 0 ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>🧾 Productos en la nota ({cart.length})</Text>
          {cart.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{c.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>Stock: {qtyFmt(c.stock)} {c.unit}</Text>
              </View>
              <TextInput value={String(c.qty)} onChangeText={(t) => setQty(c.id, t)} keyboardType="numeric" inputMode="decimal" style={{ width: 66, textAlign: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: (descontar && c.qty > c.stock) ? colors.danger : colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text }} />
              <Text style={{ color: colors.muted, fontSize: 12, width: 34 }}>{c.unit}</Text>
              <TouchableOpacity onPress={() => removeFromCart(c.id)}><Text style={{ color: colors.danger, fontWeight: '800' }}>🗑</Text></TouchableOpacity>
            </View>
          ))}
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>Al generar, la salida se descuenta del inventario automáticamente.</Text>
          {/* Máquina: lista desplegable/colapsable de TODAS las máquinas, filtrable. */}
          <TouchableOpacity onPress={() => setMachOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>🚜 Máquina: <Text style={{ color: machineryId ? colors.primary : colors.muted }}>{machineryId ? machineName(machineryId) : 'elegir…'}</Text></Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{machOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {machOpen ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm }}>
              <TextInput value={machineQuery} onChangeText={setMachineQuery} placeholder="Filtrar por código o serial…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 6 }} />
              {machineryId ? (
                <TouchableOpacity onPress={() => setMachineryId('')} style={{ paddingVertical: 6 }}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Quitar selección</Text></TouchableOpacity>
              ) : null}
              <View style={{ maxHeight: 200 }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {machines.filter((m) => { const s = norm(machineQuery); return !s || norm(`${m.code} ${m.serial ?? ''}`).includes(s); }).map((m) => {
                    const on = machineryId === m.id;
                    return (
                      <TouchableOpacity key={m.id} onPress={() => { setMachineryId(m.id); setMachOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 15 }}>{on ? '🔘' : '⚪'}</Text>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{machineLabel(m)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          ) : null}

          {/* Empleados: lista desplegable/colapsable de TODA la nómina, filtrable, multi. */}
          <TouchableOpacity onPress={() => setEmpOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>👷 Recibe: <Text style={{ color: empSel.length ? colors.primary : colors.muted }}>{empSel.length ? `${empSel.length} empleado(s)` : 'elegir…'}</Text></Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{empOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {empSel.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {empSel.map((e) => (
                <TouchableOpacity key={e.id} onPress={() => setEmpSel((prev) => prev.filter((x) => x.id !== e.id))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                  <Text style={{ color: colors.primaryContrast, fontSize: 12, fontWeight: '700' }}>{e.name}</Text>
                  <Text style={{ color: colors.primaryContrast, fontSize: 12 }}>✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {empOpen ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm, marginTop: 2 }}>
              <TextInput value={empQuery} onChangeText={setEmpQuery} placeholder="Filtrar por nombre…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 6 }} />
              <View style={{ maxHeight: 220 }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {employees.filter((e) => { const s = norm(empQuery); return !s || norm(empName(e)).includes(s); }).map((e) => {
                    const on = empSel.some((x) => x.id === (e as any).id);
                    return (
                      <TouchableOpacity key={(e as any).id} onPress={() => toggleEmp(e)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 16 }}>{on ? '☑️' : '⬜'}</Text>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{empName(e)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          ) : null}

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Destino / motivo (opcional)</Text>
          <TextInput value={destino} onChangeText={(t) => setDestino(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. OBRA CARABALLEDA, MANTENIMIENTO…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <TouchableOpacity onPress={generar} disabled={busy} style={{ marginTop: spacing.sm, backgroundColor: '#16324F', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Generando…' : '🧾 Generar nota de salida (PDF)'}</Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto con stock…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.sm }} />

      {filtered.length === 0 ? (
        <EmptyState title="Sin stock disponible" subtitle="No hay productos con existencia para la nota." />
      ) : filtered.map((it) => {
        const added = !!inCart(it.id);
        return (
          <Card key={it.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text }}>{it.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Stock: {qtyFmt(it.stock)} {it.unit || ''}</Text>
              </View>
              {canWrite ? (
                <TouchableOpacity onPress={() => addToCart(it)} disabled={added} style={{ backgroundColor: added ? colors.surfaceAlt : colors.primary, borderWidth: added ? 1 : 0, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                  <Text style={{ color: added ? colors.muted : colors.primaryContrast, fontWeight: '700', fontSize: 13 }}>{added ? '✓ Agregado' : '+ Agregar'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

// ── Requerimiento de compra ──────────────────────────────────────────────────
// Lista de productos (del inventario o NUEVOS) que se pasa al jefe para que
// APRUEBE o RECHACE la compra. Si se compra, se RECIBE en el inventario (genera
// entradas con el precio real). Solo los administradores aprueban/rechazan/reciben.
type ReqRow = { key: string; product_id: string | null; name: string; unit: string; qty: string; price: string; currency: 'USD' | 'VES'; note: string };
const REQ_STATUS: Record<string, { label: string; color: string; short: string }> = {
  pendiente: { label: '⏳ Pendiente', color: '#D97706', short: 'Pendiente' },
  aprobado: { label: '✅ Aprobado', color: '#2563EB', short: 'Aprobado' },
  rechazado: { label: '❌ Rechazado', color: '#DC2626', short: 'Rechazado' },
  recibido: { label: '📦 Recibido', color: '#16A34A', short: 'Recibido' },
};
function nextReqCode(codes: (string | null | undefined)[]): string {
  let max = 0;
  codes.forEach((c) => { const m = String(c ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
  return 'REQ-' + String(max + 1).padStart(4, '0');
}
const dmyOf = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

function RequerimientoTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session, role } = useAuth();
  const isAdmin = role === 'admin';
  const uid = session?.user?.id ?? null;
  const { rate } = useBcvRate();
  const { data: reqs, loading, refetch } = useTable<InventoryRequirement>('inventory_requirements', { orderBy: 'created_at', ascending: false });
  const { data: levels } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name' });

  // Crear requerimiento
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<ReqRow[]>([]);
  const [q, setQ] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const crear = async () => {
    const items: RequirementLine[] = rows.filter((x) => x.name.trim()).map((x) => ({
      product_id: x.product_id, name: x.name.trim().toUpperCase(), unit: x.unit.trim().toUpperCase() || null,
      qty: parseNum(x.qty), est_price: parseNum(x.price), currency: x.currency, note: x.note.trim() || null,
    }));
    if (items.length === 0) return Alert.alert('Aviso', 'Agrega al menos un producto (del inventario o nuevo).');
    setBusy(true);
    const { data: codeRows } = await supabase.from('inventory_requirements').select('code');
    const code = nextReqCode((codeRows ?? []).map((r: any) => r.code));
    const reqName = await perfilNombre();
    const { error } = await supabase.from('inventory_requirements').insert({
      code, title: title.trim() || null, note: note.trim() || null, status: 'pendiente', items,
      requested_by: uid, requested_by_name: reqName,
    });
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    setCreateOpen(false); setTitle(''); setNote(''); setRows([]);
    refetch();
    Alert.alert('Listo', `Requerimiento ${code} enviado. El jefe podrá aprobarlo o rechazarlo.`);
  };

  const decidir = async (r: InventoryRequirement, status: 'aprobado' | 'rechazado') => {
    const decName = await perfilNombre();
    const { error } = await supabase.from('inventory_requirements').update({
      status, decided_by: uid, decided_by_name: decName, decided_at: nowISO(),
    }).eq('id', r.id);
    if (error) return Alert.alert('Aviso', error.message);
    refetch();
  };

  // Abrir "Recibir": precarga los ítems con su precio estimado (para editarlo al real).
  const abrirRecibir = (r: InventoryRequirement) => {
    setRecvFor(r);
    setRecvRows(r.items.map((it) => ({ product_id: it.product_id, name: it.name, unit: it.unit, qty: String(it.qty), price: String(it.est_price || 0), currency: it.currency || 'USD' })));
  };

  const recibir = async () => {
    if (!recvFor) return;
    for (const it of recvRows) { if (parseNum(it.qty) <= 0) return Alert.alert('Aviso', `Indica la cantidad recibida de "${it.name}".`); }
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
      Alert.alert('Listo', 'Recibido en el inventario. Las entradas quedaron registradas con su precio.');
    } catch (e: any) {
      setRecvBusy(false);
      Alert.alert('Aviso', e?.message ?? 'No se pudo recibir en inventario.');
    }
  };

  const totalUsdDe = (r: InventoryRequirement) => r.items.reduce((s, it) => s + (it.currency === 'USD' ? Number(it.est_price) || 0 : usdFromBs(Number(it.est_price) || 0, rate || 0)) * (Number(it.qty) || 0), 0);

  const pdf = async (r: InventoryRequirement) => {
    try {
      await exportPdf(requerimientoHtml({
        code: r.code, fecha: dmyOf(r.created_at), title: r.title, note: r.note,
        requestedBy: r.requested_by_name, statusLabel: REQ_STATUS[r.status]?.short ?? r.status, rate,
        items: r.items.map((it) => ({ name: it.name, unit: it.unit, qty: it.qty, est_price: it.est_price, currency: it.currency, isNew: !it.product_id })),
      }), `Requerimiento ${r.code ?? dmyOf(r.created_at)}`);
    } catch (e: any) { Alert.alert('Aviso', 'No se pudo generar el PDF: ' + (e?.message ?? e)); }
  };

  const createTotalUsd = rows.reduce((s, x) => s + (x.currency === 'USD' ? parseNum(x.price) : usdFromBs(parseNum(x.price), rate || 0)) * parseNum(x.qty), 0);

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Requerimientos</SectionTitle>
        {canWrite ? (
          <TouchableOpacity onPress={() => { setTitle(''); setNote(''); setRows([]); setCreateOpen(true); }} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>➕ Nuevo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Pide productos del inventario o nuevos para que el jefe apruebe la compra. Si se compra, se recibe en el inventario con su precio. {rate ? `Tasa hoy: ${fmtBs(rate)}/US$.` : ''}
      </Text>

      {reqs.length === 0 ? (
        <EmptyState title="Sin requerimientos" subtitle="Crea uno con ➕ Nuevo para pasárselo al jefe." />
      ) : reqs.map((r) => {
        const st = REQ_STATUS[r.status] ?? REQ_STATUS.pendiente;
        const tUsd = totalUsdDe(r);
        return (
          <ExpandableCard
            key={r.id}
            summary={
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{r.code ?? 'REQ'} · {r.title || `${r.items.length} ítem(s)`}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{dmyOf(r.created_at)}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}</Text>
                </View>
                <Pill label={st.label} color={st.color} />
              </View>
            }
            detail={
              <View>
                {r.items.map((it, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{it.name} {it.product_id ? '' : <Text style={{ color: '#0F766E', fontSize: 11 }}>· NUEVO</Text>}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{qtyFmt(it.qty)} {it.unit || ''} · {it.currency === 'USD' ? usd(it.est_price) : fmtBs(it.est_price)} c/u</Text>
                    </View>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '900' }}>TOTAL ESTIMADO</Text>
                  <Text style={{ color: colors.primary, fontWeight: '900' }}>{usd(tUsd)}{rate ? ` · ${fmtBs(bsFromUsd(tUsd, rate))}` : ''}</Text>
                </View>
                {r.status === 'aprobado' && r.decided_by_name ? <Text style={{ color: '#2563EB', fontSize: 11, marginTop: 2 }}>Aprobado por {r.decided_by_name}</Text> : null}
                {r.status === 'rechazado' && r.decided_by_name ? <Text style={{ color: '#DC2626', fontSize: 11, marginTop: 2 }}>Rechazado por {r.decided_by_name}</Text> : null}
                {r.status === 'recibido' ? <Text style={{ color: '#16A34A', fontSize: 11, marginTop: 2 }}>Recibido en inventario{r.received_at ? ` · ${dmyOf(r.received_at)}` : ''}</Text> : null}

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  <TouchableOpacity onPress={() => pdf(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🧾 PDF</Text>
                  </TouchableOpacity>
                  {isAdmin && r.status === 'pendiente' ? (
                    <>
                      <TouchableOpacity onPress={() => decidir(r, 'aprobado')} style={{ backgroundColor: '#2563EB', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✅ Aprobar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => decidir(r, 'rechazado')} style={{ backgroundColor: '#DC2626', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>❌ Rechazar</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                  {isAdmin && r.status === 'aprobado' ? (
                    <TouchableOpacity onPress={() => abrirRecibir(r)} style={{ backgroundColor: '#16A34A', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>📥 Recibir en inventario</Text>
                    </TouchableOpacity>
                  ) : null}
                  {!isAdmin && r.status === 'pendiente' ? <Text style={{ color: colors.muted, fontSize: 11, alignSelf: 'center' }}>Esperando aprobación del jefe…</Text> : null}
                </View>
              </View>
            }
          />
        );
      })}

      {/* ── Crear requerimiento ── */}
      <Modal visible={createOpen} animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Nuevo requerimiento</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Título (opcional)</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="EJ. REPUESTOS EXCAVADORA 320" placeholderTextColor={colors.muted} style={inp} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Nota / justificación (opcional)</Text>
              <TextInput value={note} onChangeText={setNote} placeholder="Para qué se necesita…" placeholderTextColor={colors.muted} multiline style={[inp, { minHeight: 60, textAlignVertical: 'top' }]} />
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
                    <Text style={{ color: x.product_id ? colors.muted : '#0F766E', fontSize: 11, fontWeight: '700' }}>{x.product_id ? 'Del inventario' : 'Producto NUEVO'}</Text>
                    <TouchableOpacity onPress={() => rm(x.key)}><Text style={{ color: colors.danger, fontWeight: '800' }}>🗑 Quitar</Text></TouchableOpacity>
                  </View>
                  <TextInput value={x.name} onChangeText={(t) => upd(x.key, 'name', t)} editable={!x.product_id} placeholder="Nombre del producto" placeholderTextColor={colors.muted} style={[inp, x.product_id ? { color: colors.muted } : null]} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6, alignItems: 'flex-end' }}>
                    <View style={{ width: 64 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cant</Text><TextInput value={x.qty} onChangeText={(t) => upd(x.key, 'qty', onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'center' }]} /></View>
                    <View style={{ width: 70 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Unidad</Text><TextInput value={x.unit} onChangeText={(t) => upd(x.key, 'unit', t.toUpperCase())} placeholder="UND" placeholderTextColor={colors.muted} style={inp} /></View>
                    <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Precio est.</Text><TextInput value={x.price} onChangeText={(t) => upd(x.key, 'price', onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'right' }]} /></View>
                    <TouchableOpacity onPress={() => upd(x.key, 'currency', x.currency === 'USD' ? 'VES' : 'USD')} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{x.currency === 'USD' ? '$' : 'Bs'}</Text>
                    </TouchableOpacity>
                  </View>
                  {parseNum(x.price) > 0 && rate ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'right' }}>≈ {otra} c/u</Text> : null}
                </Card>
              );
            })}

            {rows.length ? (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.text, fontWeight: '900' }}>TOTAL ESTIMADO</Text><Text style={{ color: colors.primary, fontWeight: '900', fontSize: 16 }}>{usd(createTotalUsd)}</Text></View>
                {rate ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'right' }}>{fmtBs(bsFromUsd(createTotalUsd, rate))}</Text> : null}
              </Card>
            ) : <EmptyState title="Sin productos" subtitle="Agrega productos del inventario o nuevos." />}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setCreateOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 2, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{busy ? 'Enviando…' : '📤 Enviar al jefe'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
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
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{it.name} {it.product_id ? '' : <Text style={{ color: '#0F766E', fontSize: 11 }}>· NUEVO</Text>}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6, alignItems: 'flex-end' }}>
                    <View style={{ width: 70 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cantidad</Text><TextInput value={it.qty} onChangeText={(t) => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, qty: onlyDecimal(t) } : r))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'center' }]} /></View>
                    <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Precio real (unit.)</Text><TextInput value={it.price} onChangeText={(t) => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, price: onlyDecimal(t) } : r))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'right' }]} /></View>
                    <TouchableOpacity onPress={() => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, currency: r.currency === 'USD' ? 'VES' : 'USD' } : r))} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{it.currency === 'USD' ? '$' : 'Bs'}</Text>
                    </TouchableOpacity>
                  </View>
                  {parseNum(it.price) > 0 && rate ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'right' }}>≈ {otra} c/u</Text> : null}
                </Card>
              );
            })}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setRecvFor(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={recibir} disabled={recvBusy} style={{ flex: 2, backgroundColor: '#16A34A', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: recvBusy ? 0.6 : 1 }}><Text style={{ color: '#fff', fontWeight: '800' }}>{recvBusy ? 'Recibiendo…' : '📥 Confirmar entrada'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ── Nota de traslado (entre máquinas: origen → destino) ──────────────────────
// Elige materiales del inventario y los TRASLADA de una máquina/empleado (origen)
// a otra máquina/empleado (destino). Al confirmar: genera el PDF, descuenta el
// stock (salida) y guarda el registro en inventory_transfers (casado con máquina
// y empleado de cada lado).
// Condición del material en el traslado / retorno.
const COND_MATERIAL = ['usado', 'lleno', 'vacío', 'dañado'];

function TrasladoTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: 'inventory_movements' });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: transfers, refetch: refetchTr } = useTable<InventoryTransfer>('inventory_transfers', { orderBy: 'created_at', ascending: false });

  const [view, setView] = useState<'nuevo' | 'lista'>('nuevo'); // crear traslado | traslados realizados
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<{ id: string; name: string; unit: string; qty: number; avg_cost: number; stock: number; company_id: string | null }[]>([]);
  const [motivo, setMotivo] = useState('');
  const [lugar, setLugar] = useState('');                          // lugar/obra a donde va
  const [estadoMat, setEstadoMat] = useState('');                  // condición al trasladar (usado/lleno/dañado)
  const [busy, setBusy] = useState(false);

  // Retorno al inventario
  const [returnFor, setReturnFor] = useState<InventoryTransfer | null>(null);
  const [returnRows, setReturnRows] = useState<{ item_id: string; name: string; unit: string | null; qty: string }[]>([]);
  const [returnEstado, setReturnEstado] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);

  // Origen y destino (máquina + empleado responsable de cada lado).
  const [fromMachId, setFromMachId] = useState('');
  const [fromEmpId, setFromEmpId] = useState('');
  const [toMachId, setToMachId] = useState('');
  const [toEmpId, setToEmpId] = useState('');
  const [open, setOpen] = useState<string | null>(null); // 'fromMach' | 'fromEmp' | 'toMach' | 'toEmp'
  const [pick, setPick] = useState('');

  const nq = norm(q);
  const filtered = useMemo(() => levels.filter((it) => Number(it.stock) > 0 && (!nq || norm(it.name).includes(nq))), [levels, nq]);
  const inCart = (id: string) => cart.find((c) => c.id === id);
  const machineLabel = (m: Machinery) => `${m.code}${m.serial ? ` · ${m.serial}` : ''}`;
  const machName = (id: string) => { const m = machines.find((x) => x.id === id); return m ? machineLabel(m) : ''; };
  const empName = (e: Employee) => `${(e as any).first_name ?? ''} ${(e as any).last_name ?? ''}`.trim() || 'Sin nombre';
  const empNameById = (id: string) => { const e = employees.find((x) => (x as any).id === id); return e ? empName(e) : ''; };

  const addToCart = (it: InventoryLevel) => {
    if (inCart(it.id)) return;
    setCart((prev) => [...prev, { id: it.id, name: it.name, unit: it.unit || '', qty: 1, avg_cost: Number(it.avg_cost) || 0, stock: Number(it.stock) || 0, company_id: it.company_id ?? null }]);
  };
  const setQty = (id: string, t: string) => { const n = parseNum(onlyDecimal(t)); setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty: n } : c))); };
  const removeFromCart = (id: string) => setCart((prev) => prev.filter((c) => c.id !== id));

  const todayDMY = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

  // Selector desplegable reutilizable (máquina o empleado).
  const Selector = ({ id, icon, label, valueId, valueText, onPick, options }: {
    id: string; icon: string; label: string; valueId: string; valueText: string;
    onPick: (v: string) => void; options: { id: string; text: string }[];
  }) => {
    const isOpen = open === id;
    return (
      <View style={{ marginTop: spacing.sm }}>
        <TouchableOpacity onPress={() => { setOpen(isOpen ? null : id); setPick(''); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{icon} {label}: <Text style={{ color: valueId ? colors.primary : colors.muted }}>{valueId ? valueText : 'elegir…'}</Text></Text>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>{isOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {isOpen ? (
          <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm }}>
            <TextInput value={pick} onChangeText={setPick} placeholder="Filtrar…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 6 }} />
            {valueId ? <TouchableOpacity onPress={() => { onPick(''); }} style={{ paddingVertical: 6 }}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Quitar selección</Text></TouchableOpacity> : null}
            <View style={{ maxHeight: 200 }}>
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {options.filter((o) => { const s = norm(pick); return !s || norm(o.text).includes(s); }).map((o) => {
                  const on = valueId === o.id;
                  return (
                    <TouchableOpacity key={o.id} onPress={() => { onPick(o.id); setOpen(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 15 }}>{on ? '🔘' : '⚪'}</Text>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{o.text}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const machOptions = useMemo(() => machines.map((m) => ({ id: m.id, text: machineLabel(m) })), [machines]);
  const empOptions = useMemo(() => employees.map((e) => ({ id: (e as any).id as string, text: empName(e) })), [employees]);

  const generar = async () => {
    if (cart.length === 0) return Alert.alert('Aviso', 'Agrega al menos un material al traslado.');
    if (!fromMachId && !fromEmpId) return Alert.alert('Aviso', 'Indica el origen (máquina o empleado).');
    if (!toMachId && !toEmpId) return Alert.alert('Aviso', 'Indica el destino (máquina o empleado).');
    for (const c of cart) {
      if (c.qty <= 0) return Alert.alert('Aviso', `Indica la cantidad de "${c.name}".`);
      if (c.qty > c.stock) return Alert.alert('Aviso', `No hay suficiente stock de "${c.name}". Disponible: ${qtyFmt(c.stock)} ${c.unit}.`);
    }
    setBusy(true);
    // 1) VISTA PREVIA primero. Solo si el usuario imprime/guarda se descuenta y se registra.
    const items: TrasladoItem[] = cart.map((c) => ({ name: c.name, qty: c.qty, unit: c.unit }));
    let confirmado = false;
    try {
      confirmado = await exportPdf(notaTrasladoHtml({
        fecha: todayDMY(),
        fromMaquina: fromMachId ? machName(fromMachId) : null,
        fromEmpleado: fromEmpId ? empNameById(fromEmpId) : null,
        toMaquina: toMachId ? machName(toMachId) : null,
        toEmpleado: toEmpId ? empNameById(toEmpId) : null,
        motivo: motivo.trim() || null,
        items,
      }), `Nota de traslado - ${todayDMY()}`);
    } catch (e: any) {
      setBusy(false);
      return Alert.alert('Aviso', 'No se pudo generar el PDF: ' + (e?.message ?? e));
    }
    if (!confirmado) { setBusy(false); return; }
    // 2) CONFIRMADO: descuenta stock (salida) y guarda el encabezado del traslado.
    const detalle = `${fromMachId ? machName(fromMachId) : (fromEmpId ? empNameById(fromEmpId) : '—')} → ${toMachId ? machName(toMachId) : (toEmpId ? empNameById(toEmpId) : '—')}`;
    const rows = cart.map((c) => ({
      item_id: c.id, kind: 'salida' as const, qty: c.qty, unit_cost: c.avg_cost || null,
      reason: `NOTA DE TRASLADO · ${detalle}${motivo.trim().toUpperCase() ? ` · ${motivo.trim().toUpperCase()}` : ''}`,
      company_id: c.company_id, created_by: session?.user?.id ?? null,
    }));
    const { error: mErr } = await supabase.from('inventory_movements').insert(rows);
    if (mErr) { setBusy(false); return Alert.alert('Aviso', mErr.message); }
    const { error: tErr } = await supabase.from('inventory_transfers').insert({
      company_id: cart[0]?.company_id ?? null,
      from_machinery_id: fromMachId || null, from_machinery_label: fromMachId ? machName(fromMachId) : null,
      from_employee_id: fromEmpId || null, from_employee_name: fromEmpId ? empNameById(fromEmpId) : null,
      to_machinery_id: toMachId || null, to_machinery_label: toMachId ? machName(toMachId) : null,
      to_employee_id: toEmpId || null, to_employee_name: toEmpId ? empNameById(toEmpId) : null,
      motivo: motivo.trim() || null,
      lugar: lugar.trim().toUpperCase() || null,
      estado: estadoMat || null,
      items: cart.map((c) => ({ item_id: c.id, name: c.name, qty: c.qty, unit: c.unit })),
      descontado: true, created_by: session?.user?.id ?? null,
    });
    if (tErr) { setBusy(false); return Alert.alert('Aviso', tErr.message); }
    setBusy(false);
    setCart([]); setMotivo(''); setLugar(''); setEstadoMat(''); setFromMachId(''); setFromEmpId(''); setToMachId(''); setToEmpId('');
    refetch(); refetchTr();
    Alert.alert('Listo', 'Traslado registrado. La salida se descontó del inventario.');
  };

  // ── Retornar al inventario un traslado ────────────────────────────────────
  const abrirRetorno = (t: InventoryTransfer) => {
    setReturnFor(t);
    setReturnRows((t.items ?? []).map((it) => ({ item_id: it.item_id, name: it.name, unit: it.unit, qty: String(it.qty) })));
    setReturnEstado(t.estado || '');
  };
  const retornar = async () => {
    if (!returnFor) return;
    const rows = returnRows.filter((r) => parseNum(r.qty) > 0);
    if (rows.length === 0) return Alert.alert('Aviso', 'Indica cuánto retorna al inventario (al menos un producto).');
    setReturnBusy(true);
    // Entradas de vuelta al stock (sin costo: no altera el PMP).
    const movs = rows.map((r) => ({
      item_id: r.item_id, kind: 'entrada' as const, qty: parseNum(r.qty), unit_cost: null,
      reason: `RETORNO DE TRASLADO${returnEstado ? ` · ${returnEstado.toUpperCase()}` : ''}`,
      company_id: returnFor.company_id, created_by: uid,
    }));
    const { error: mErr } = await supabase.from('inventory_movements').insert(movs);
    if (mErr) { setReturnBusy(false); return Alert.alert('Aviso', mErr.message); }
    const resumen = `${returnEstado ? returnEstado.toUpperCase() + ' · ' : ''}` + rows.map((r) => `${r.name}: ${qtyFmt(parseNum(r.qty))} ${r.unit || ''}`).join(' · ');
    const { error: uErr } = await supabase.from('inventory_transfers').update({
      returned: true, returned_at: nowISO(), return_note: resumen, estado: returnEstado || returnFor.estado,
    }).eq('id', returnFor.id);
    if (uErr) { setReturnBusy(false); return Alert.alert('Aviso', uErr.message); }
    setReturnBusy(false); setReturnFor(null); setReturnRows([]); setReturnEstado('');
    refetch(); refetchTr();
    Alert.alert('Listo', 'Retornado al inventario. Las entradas quedaron registradas.');
  };

  const trasladoLabel = (t: InventoryTransfer) => {
    const from = t.from_machinery_label || t.from_employee_name || '—';
    const to = t.to_machinery_label || t.to_employee_name || '—';
    return `${from} → ${to}`;
  };

  // Reporte PDF de TODOS los traslados (con lugar, estado, ítems y si se retornaron).
  const reporteTraslados = async () => {
    if (transfers.length === 0) return Alert.alert('Aviso', 'No hay traslados para el reporte.');
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const d = new Date(); const dmy = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const retornados = transfers.filter((t) => t.returned).length;
    // Resumen por ESTADO: cuántos traslados y qué cantidad de materiales (bombonas) hay en
    // cada estado (vacío / lleno / usado / dañado). Solo cuenta los que NO se han retornado.
    const byEstado = new Map<string, { count: number; qty: number }>();
    transfers.filter((t) => !t.returned).forEach((t) => {
      const est = t.estado ? t.estado : 'sin estado';
      const g = byEstado.get(est) ?? { count: 0, qty: 0 };
      g.count += 1;
      g.qty += (t.items ?? []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
      byEstado.set(est, g);
    });
    const resumen = Array.from(byEstado.entries()).sort((a, b) => b[1].qty - a[1].qty).map(([est, g]) => `<tr>
      <td style="text-transform:capitalize;font-weight:700">${esc(est)}</td>
      <td class="c">${g.count}</td>
      <td class="c b">${qtyFmt(g.qty)}</td>
    </tr>`).join('');
    const rows = transfers.map((t, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(fmtDate(t.created_at))}</td>
      <td>${esc(trasladoLabel(t))}</td>
      <td>${esc(t.lugar || '—')}</td>
      <td class="c">${esc(t.estado ? t.estado.toUpperCase() : '—')}</td>
      <td>${(t.items ?? []).map((it) => `${esc(it.name)} (${qtyFmt(it.qty)} ${esc(it.unit || '')})`).join('<br/>') || '—'}</td>
      <td class="c" style="font-weight:800;color:${t.returned ? '#16A34A' : '#D97706'}">${t.returned ? 'Retornado' : 'En destino'}</td>
    </tr>`).join('');
    const html = pdfDocument({
      title: 'Reporte de traslados',
      subtitle: `${transfers.length} traslado(s) · ${retornados} retornado(s) · ${dmy}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left;vertical-align:top} th{background:#16324F;color:#fff}
        td.c{text-align:center} td.b{font-weight:800} tr:nth-child(even) td{background:#f4f7fb}
        h3{margin:14px 0 2px;font-size:13px;color:#16324F}`,
      body: `
        <h3>Cantidad por estado (en destino)</h3>
        <table><thead><tr><th>Estado</th><th class="c">Traslados</th><th class="c">Cantidad</th></tr></thead>
          <tbody>${resumen || '<tr><td colspan="3" class="c">Sin traslados en destino</td></tr>'}</tbody></table>
        <h3>Detalle de traslados</h3>
        <table>
        <thead><tr><th style="width:26px" class="c">#</th><th>Fecha</th><th>Origen → Destino</th><th>Lugar</th>
          <th class="c">Estado</th><th>Materiales</th><th class="c">Situación</th></tr></thead>
        <tbody>${rows}</tbody></table>`,
    });
    await exportPdf(html, `Traslados - ${dmy}`);
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Nota de traslado</SectionTitle>

      {/* Sub-vista: crear traslado | traslados realizados (para retornar). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
        {([['nuevo', '🔁 Trasladar'], ['lista', `📋 Realizados (${transfers.length})`]] as [typeof view, string][]).map(([k, l]) => {
          const on = view === k;
          return (
            <TouchableOpacity key={k} onPress={() => setView(k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{l}</Text>
            </TouchableOpacity>
          );
        })}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={reporteTraslados} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: '#111827', backgroundColor: '#111827', paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>📄 Reporte</Text>
        </TouchableOpacity>
      </View>

      {view === 'lista' ? (
        transfers.length === 0 ? (
          <EmptyState title="Sin traslados" subtitle="Los traslados que registres aparecerán aquí para poder retornarlos." />
        ) : transfers.map((t) => (
          <ExpandableCard
            key={t.id}
            summary={
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 13, color: colors.text }} numberOfLines={1}>{trasladoLabel(t)}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{fmtDate(t.created_at)}{t.lugar ? ` · 📍 ${t.lugar}` : ''}{t.estado ? ` · ${t.estado.toUpperCase()}` : ''}</Text>
                </View>
                <Pill label={t.returned ? '↩️ Retornado' : '📦 En destino'} color={t.returned ? '#16A34A' : '#D97706'} />
              </View>
            }
            detail={
              <View>
                {(t.items ?? []).map((it, i) => (
                  <Text key={i} style={{ color: colors.text, fontSize: 13 }}>• {it.name}: {qtyFmt(it.qty)} {it.unit || ''}</Text>
                ))}
                {t.motivo ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Motivo: {t.motivo}</Text> : null}
                {t.returned ? (
                  <Text style={{ color: '#16A34A', fontSize: 12, marginTop: spacing.xs }}>Retornado{t.returned_at ? ` · ${fmtDate(t.returned_at)}` : ''}{t.return_note ? ` · ${t.return_note}` : ''}</Text>
                ) : canWrite ? (
                  <TouchableOpacity onPress={() => abrirRetorno(t)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: '#0F766E', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>↩️ Retornar al inventario</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            }
          />
        ))
      ) : (
      <>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
        Traslada materiales de una máquina/empleado (origen) a otra (destino). Al generar, descuenta del inventario y guarda el registro.
      </Text>

      {cart.length > 0 ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>🔁 Materiales a trasladar ({cart.length})</Text>
          {cart.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{c.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>Stock: {qtyFmt(c.stock)} {c.unit}</Text>
              </View>
              <TextInput value={String(c.qty)} onChangeText={(t) => setQty(c.id, t)} keyboardType="numeric" inputMode="decimal" style={{ width: 66, textAlign: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: (c.qty > c.stock) ? colors.danger : colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text }} />
              <Text style={{ color: colors.muted, fontSize: 12, width: 34 }}>{c.unit}</Text>
              <TouchableOpacity onPress={() => removeFromCart(c.id)}><Text style={{ color: colors.danger, fontWeight: '800' }}>🗑</Text></TouchableOpacity>
            </View>
          ))}

          {/* ORIGEN */}
          <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12, marginTop: spacing.md, letterSpacing: 0.5 }}>ORIGEN (de dónde sale)</Text>
          <Selector id="fromMach" icon="🚜" label="Máquina origen" valueId={fromMachId} valueText={machName(fromMachId)} onPick={setFromMachId} options={machOptions} />
          <Selector id="fromEmp" icon="👷" label="Responsable origen" valueId={fromEmpId} valueText={empNameById(fromEmpId)} onPick={setFromEmpId} options={empOptions} />

          {/* DESTINO */}
          <Text style={{ color: '#0d6b3f', fontWeight: '800', fontSize: 12, marginTop: spacing.md, letterSpacing: 0.5 }}>DESTINO (a dónde va)</Text>
          <Selector id="toMach" icon="🚜" label="Máquina destino" valueId={toMachId} valueText={machName(toMachId)} onPick={setToMachId} options={machOptions} />
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>➕ Agregar responsable destino (opcional): la persona que RECIBE en el destino.</Text>
          <Selector id="toEmp" icon="👷" label="Responsable destino" valueId={toEmpId} valueText={empNameById(toEmpId)} onPick={setToEmpId} options={empOptions} />

          {/* LUGAR y ESTADO del material trasladado */}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md, marginBottom: 4 }}>Lugar / obra a donde se hace el traslado (opcional)</Text>
          <TextInput value={lugar} onChangeText={(t) => setLugar(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. OBRA GUAIRA, TALLER CENTRAL…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Estado del material</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {COND_MATERIAL.map((e) => {
              const on = estadoMat === e;
              return (
                <TouchableOpacity key={e} onPress={() => setEstadoMat(on ? '' : e)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }}>{e}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md, marginBottom: 4 }}>Motivo (opcional)</Text>
          <TextInput value={motivo} onChangeText={(t) => setMotivo(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. REASIGNACIÓN, PRÉSTAMO DE HERRAMIENTA…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <TouchableOpacity onPress={generar} disabled={busy} style={{ marginTop: spacing.sm, backgroundColor: '#16324F', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Generando…' : '🔁 Generar traslado (PDF)'}</Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      <TextInput value={q} onChangeText={setQ} placeholder="Buscar material con stock…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.sm }} />

      {filtered.length === 0 ? (
        <EmptyState title="Sin stock disponible" subtitle="No hay materiales con existencia para trasladar." />
      ) : filtered.map((it) => {
        const added = !!inCart(it.id);
        return (
          <Card key={it.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text }}>{it.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Stock: {qtyFmt(it.stock)} {it.unit || ''}</Text>
              </View>
              {canWrite ? (
                <TouchableOpacity onPress={() => addToCart(it)} disabled={added} style={{ backgroundColor: added ? colors.surfaceAlt : colors.primary, borderWidth: added ? 1 : 0, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                  <Text style={{ color: added ? colors.muted : colors.primaryContrast, fontWeight: '700', fontSize: 13 }}>{added ? '✓ Agregado' : '+ Agregar'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>
        );
      })}
      </>
      )}

      {/* ── Retornar al inventario ── */}
      <Modal visible={!!returnFor} animationType="slide" onRequestClose={() => setReturnFor(null)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Retornar al inventario</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              {returnFor ? trasladoLabel(returnFor) : ''}. Indica el estado del material y cuánto queda disponible para reingresar al almacén.
            </Text>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Estado del material que retorna</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {COND_MATERIAL.map((e) => {
                  const on = returnEstado === e;
                  return (
                    <TouchableOpacity key={e} onPress={() => setReturnEstado(on ? '' : e)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }}>{e}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Card>

            {returnRows.map((r, idx) => (
              <Card key={idx}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{r.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Trasladado: {qtyFmt(parseNum(r.qty))} {r.unit || ''}</Text>
                  </View>
                  <View style={{ width: 90 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Retorna</Text>
                    <TextInput value={r.qty} onChangeText={(t) => setReturnRows((p) => p.map((x, i) => i === idx ? { ...x, qty: onlyDecimal(t) } : x))} keyboardType="numeric" inputMode="decimal" style={{ textAlign: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text }} />
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, width: 34 }}>{r.unit || ''}</Text>
                </View>
              </Card>
            ))}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setReturnFor(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={retornar} disabled={returnBusy} style={{ flex: 2, backgroundColor: '#0F766E', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: returnBusy ? 0.6 : 1 }}><Text style={{ color: '#fff', fontWeight: '800' }}>{returnBusy ? 'Retornando…' : '↩️ Confirmar retorno'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ── Gastos (material que sale del almacén) ───────────────────────────────────
// Cada salida/consumo del inventario = un gasto, valorizado al PMP guardado en el
// movimiento (qty × unit_cost). Incluye salidas manuales, consumos, notas de
// entrega y traslados (todo lo que descuenta del almacén). No cuenta entradas ni
// ajustes.
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const PERIODOS: { key: string; label: string }[] = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Esta semana' },
  { key: 'mes', label: 'Este mes' },
  { key: 'todo', label: 'Todo' },
];
/** Fecha desde (inclusive) para cada período; null = sin límite (todo). */
function periodoDesde(key: string): Date | null {
  const now = new Date();
  if (key === 'hoy') return startOfDay(now);
  if (key === 'semana') { const d = startOfDay(now); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d; } // lunes
  if (key === 'mes') return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

function GastosTab() {
  const { colors } = useTheme();
  const { data: movs, loading } = useTable<InventoryMovement>('inventory_movements', { orderBy: 'created_at', ascending: false, realtimeFrom: 'inventory_movements' });
  const { data: items } = useTable<InventoryItem>('inventory_items', { orderBy: 'name' });

  const [periodo, setPeriodo] = useState('mes');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  const itemOf = (id: string) => items.find((i) => i.id === id);
  const valorDe = (m: InventoryMovement) => (Number(m.qty) || 0) * (Number(m.unit_cost) || 0);

  // Gastos = salidas + consumos (todo lo que sale del almacén), en el período.
  const gastos = useMemo(() => {
    const desde = periodoDesde(periodo);
    const nq = norm(q);
    return movs
      .filter((m) => m.kind === 'salida' || m.kind === 'consumo')
      .filter((m) => !desde || new Date(m.created_at) >= desde)
      .filter((m) => {
        const it = itemOf(m.item_id);
        if (cat && (it?.category || 'otros') !== cat) return false;
        if (!nq) return true;
        return norm(it?.name || '').includes(nq) || norm(m.reason || '').includes(nq);
      });
  }, [movs, items, periodo, q, cat]);

  const total = useMemo(() => gastos.reduce((s, m) => s + valorDe(m), 0), [gastos]);
  // Resumen por categoría (solo dentro del período; ignora el filtro de categoría/búsqueda).
  const porCategoria = useMemo(() => {
    const desde = periodoDesde(periodo);
    const map = new Map<string, { total: number; count: number }>();
    movs
      .filter((m) => m.kind === 'salida' || m.kind === 'consumo')
      .filter((m) => !desde || new Date(m.created_at) >= desde)
      .forEach((m) => {
        const key = itemOf(m.item_id)?.category || 'otros';
        const g = map.get(key) ?? { total: 0, count: 0 };
        g.total += valorDe(m); g.count += 1; map.set(key, g);
      });
    return [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.total - a.total);
  }, [movs, items, periodo]);

  const periodoLabel = PERIODOS.find((p) => p.key === periodo)?.label ?? 'Todo';

  const reporte = async () => {
    if (gastos.length === 0) return Alert.alert('Aviso', 'No hay gastos en el período seleccionado.');
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const d = new Date(); const dmy = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const rows = gastos.map((m, i) => {
      const it = itemOf(m.item_id);
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(fmtDate(m.created_at))}</td>
        <td>${esc(it?.name || 'Producto')}</td>
        <td>${esc(catInfo(it?.category || null).label)}</td>
        <td class="c">${m.kind === 'consumo' ? 'Consumo' : 'Salida'}</td>
        <td class="c">${qtyFmt(m.qty)} ${esc(it?.unit || '')}</td>
        <td class="r">${usd(m.unit_cost || 0)}</td>
        <td class="r b">${usd(valorDe(m))}</td>
      </tr>`;
    }).join('');
    const resumen = porCategoria.map((c) => `<tr>
        <td>${esc(catInfo(c.key).label)}</td>
        <td class="c">${c.count}</td>
        <td class="r b">${usd(c.total)}</td>
      </tr>`).join('');
    const html = pdfDocument({
      title: 'Reporte de gastos de inventario',
      subtitle: `${periodoLabel} · ${gastos.length} salida(s) · Total ${usd(total)} · ${dmy}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left} th{background:#16324F;color:#fff}
        td.c{text-align:center} td.r{text-align:right} td.b{font-weight:800}
        tr:nth-child(even) td{background:#f4f7fb}
        h3{margin:16px 0 0;font-size:13px;color:#16324F}
        .tot{margin-top:10px;font-size:14px;font-weight:800;text-align:right}`,
      body: `
        <h3>Resumen por categoría</h3>
        <table><thead><tr><th>Categoría</th><th class="c">Salidas</th><th class="r">Total gastado</th></tr></thead>
          <tbody>${resumen}</tbody></table>
        <h3>Detalle de salidas</h3>
        <table>
          <thead><tr><th style="width:26px" class="c">#</th><th>Fecha</th><th>Producto</th><th>Categoría</th>
            <th class="c">Tipo</th><th class="c">Cantidad</th><th class="r">Costo unit.</th><th class="r">Gasto</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="tot">TOTAL GASTADO: ${usd(total)}</div>`,
    });
    await exportPdf(html, `Gastos de inventario ${periodoLabel} - ${dmy}`);
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Gastos de inventario</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Cada material que sale del almacén (nota de salida o traslado) es un gasto, valorizado al PMP.</Text>

      {/* Período */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {PERIODOS.map((p) => {
          const on = periodo === p.key;
          return (
            <TouchableOpacity key={p.key} onPress={() => setPeriodo(p.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Total gastado */}
      <View style={{ borderWidth: 1, borderColor: '#DC2626', borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surfaceAlt, marginBottom: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>TOTAL GASTADO · {periodoLabel.toUpperCase()}</Text>
        <Text style={{ color: '#DC2626', fontSize: 26, fontWeight: '900' }}>{usd(total)}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{gastos.length} salida(s) de material</Text>
      </View>

      <TouchableOpacity onPress={reporte} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📄 Reporte de gastos (PDF)</Text>
      </TouchableOpacity>

      {/* Resumen por categoría */}
      {porCategoria.length ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>Por categoría</Text>
          {porCategoria.map((c) => {
            const on = cat === c.key;
            return (
              <TouchableOpacity key={c.key} onPress={() => setCat(on ? '' : c.key)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: on ? colors.primary : colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{catInfo(c.key).icon} {catInfo(c.key).label}{on ? ' ✓' : ''}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginRight: spacing.sm }}>{c.count}</Text>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{usd(c.total)}</Text>
              </TouchableOpacity>
            );
          })}
          {cat ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Filtrando por {catInfo(cat).label}. Toca de nuevo para quitar el filtro.</Text> : null}
        </Card>
      ) : null}

      <TextInput value={q} onChangeText={setQ} placeholder="Buscar por producto o motivo…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }} />

      {gastos.length === 0 ? (
        <EmptyState title="Sin gastos" subtitle="No hay salidas de material en el período seleccionado." />
      ) : gastos.map((m) => {
        const it = itemOf(m.item_id);
        return (
          <ExpandableCard
            key={m.id}
            summary={
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{it?.name || 'Producto'}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{m.kind === 'consumo' ? '🔥 Consumo' : '📤 Salida'} · {qtyFmt(m.qty)} {it?.unit || ''} · {fmtDate(m.created_at)}</Text>
                </View>
                <Text style={{ color: '#DC2626', fontSize: 15, fontWeight: '900' }}>{usd(valorDe(m))}</Text>
              </View>
            }
            detail={
              <>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Categoría: {catInfo(it?.category || null).label}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Costo unitario (PMP): {usd(m.unit_cost || 0)}</Text>
                {m.reason ? <Text style={{ color: colors.text, fontSize: 13 }}>{m.reason}</Text> : null}
              </>
            }
          />
        );
      })}
    </Screen>
  );
}

// ── Contenedor con sub-pestañas ──────────────────────────────────────────────
export default function InventarioScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const canWrite = levelMeets(moduleLevel('inventario'), 'escritura');
  const TABS = [
    { key: 'existencias', label: 'Existencias', icon: '📦' },
    { key: 'nota', label: 'Salida', icon: '📤' },
    { key: 'traslado', label: 'Nota de traslado', icon: '🔁' },
    { key: 'gastos', label: 'Gastos', icon: '💸' },
    { key: 'requerimiento', label: 'Requerimiento', icon: '📝' },
    { key: 'movimientos', label: 'Movimientos', icon: '🔄' },
  ];
  const [active, setActive] = useState('existencias');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm }}>
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <TouchableOpacity key={t.key} onPress={() => setActive(t.key)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}>
                <Text style={{ fontSize: 15 }}>{t.icon}</Text>
                <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>
        {active === 'existencias' ? <ExistenciasTab canWrite={canWrite} /> : active === 'nota' ? <NotaTab canWrite={canWrite} /> : active === 'traslado' ? <TrasladoTab canWrite={canWrite} /> : active === 'gastos' ? <GastosTab /> : active === 'requerimiento' ? <RequerimientoTab canWrite={canWrite} /> : <MovimientosTab />}
      </View>
    </View>
  );
}
