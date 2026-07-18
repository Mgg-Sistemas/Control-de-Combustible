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
import { InventoryItem, InventoryLevel, InventoryMovement, Company, Machinery, Employee } from '../types/database';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { notaEntregaHtml, NotaItem } from '../lib/notaEntrega';
import { notaTrasladoHtml, TrasladoItem } from '../lib/notaTraslado';
import { buildXlsx, readXlsx } from '../lib/xlsx';
import { cotizacionHtml, CotizItem } from '../lib/cotizacion';
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
  const { session } = useAuth();
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
    // Costo unitario (PMP) prellenado, editable.
    setInitCost(it.avg_cost != null ? String(it.avg_cost) : '');
    setOpen(true);
  };

  const crear = async () => {
    if (!name.trim()) return Alert.alert('Aviso', 'Escribe el nombre del material.');
    const cleanName = name.trim().toUpperCase();
    // Evita duplicados por nombre (excluyendo el que se está editando).
    if (levels.some((it) => norm(it.name) === norm(cleanName) && it.id !== editingId)) return Alert.alert('Aviso', 'Ya existe un material con ese nombre.');
    // ── EDICIÓN ──
    if (editingId) {
      setBusy(true);
      const patch: any = { name: cleanName, category, unit: unit.trim().toUpperCase() || null, min_stock: parseNum(minStock), estado: estado || null };
      // Costo unitario (PMP): si se indicó, se actualiza directo en el producto.
      if (initCost.trim() !== '') patch.avg_cost = parseNum(initCost);
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
        item_id: ins.id, kind: 'entrada', qty: qi, unit_cost: parseNum(initCost) || 0,
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
    setName(''); setCategory('repuestos'); setUnit(''); setMinStock(''); setInitStock(''); setInitCost(''); setEstado(''); setEditQty('');
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
                      </View>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>SKU</Text>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{(it as any).sku || '—'}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>VALOR EN STOCK</Text>
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{usd((Number(it.stock) || 0) * (Number(it.avg_cost) || 0))}</Text>
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
            <Text style={{ color: colors.muted, fontSize: 11 }}>📦 Inventario GENERAL. La máquina y los empleados se eligen al dar salida (Nota de entrega).</Text>
            {editingId ? (
              <Card>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cantidad (existencia)</Text>
                    <TextInput value={editQty} onChangeText={(t) => setEditQty(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Costo unitario (PMP)</Text>
                    <TextInput value={initCost} onChangeText={(t) => setInitCost(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
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
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Costo unitario</Text>
                  <TextInput value={initCost} onChangeText={(t) => setInitCost(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
              </View>
              {parseNum(initStock) > 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Valor inicial: {usd(parseNum(initStock) * parseNum(initCost))}</Text> : null}
            </Card>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => { setOpen(false); setEditingId(null); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{busy ? 'Guardando…' : (editingId ? 'Guardar cambios' : 'Guardar')}</Text></TouchableOpacity>
            </View>
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

// ── Salidas de material ──────────────────────────────────────────────────────
function SalidasTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: 'inventory_movements' });

  const [q, setQ] = useState('');
  const [sel, setSel] = useState<InventoryLevel | null>(null);
  const [kind, setKind] = useState<'salida' | 'consumo'>('consumo');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const nq = norm(q);
  const filtered = useMemo(() => levels.filter((it) => Number(it.stock) > 0 && (!nq || norm(it.name).includes(nq))), [levels, nq]);

  const registrar = async () => {
    if (!sel) return;
    const n = parseNum(qty);
    if (n <= 0) return Alert.alert('Aviso', 'Indica la cantidad a sacar.');
    if (n > Number(sel.stock)) return Alert.alert('Aviso', `No hay suficiente stock. Disponible: ${qtyFmt(sel.stock)} ${sel.unit || ''}.`);
    const ok = await confirm({ title: kind === 'consumo' ? 'Registrar consumo' : 'Registrar salida', message: `${kind === 'consumo' ? 'Consumir' : 'Sacar'} ${qtyFmt(n)} ${sel.unit || ''} de ${sel.name}?`, confirmText: 'Confirmar' });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('inventory_movements').insert({
      item_id: sel.id, kind, qty: n, unit_cost: Number(sel.avg_cost) || null,
      reason: reason.trim().toUpperCase() || null, company_id: sel.company_id ?? null, created_by: session?.user?.id ?? null,
    });
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    setSel(null); setQty(''); setReason(''); setKind('consumo');
    refetch();
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Salidas de material</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Elige un producto para registrar una salida o consumo. Se valoriza al PMP actual.</Text>
      <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto con stock…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }} />

      {filtered.length === 0 ? (
        <EmptyState title="Sin stock disponible" subtitle="No hay productos con existencia para dar salida." />
      ) : filtered.map((it) => (
        <Card key={it.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text }}>{it.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Stock: {qtyFmt(it.stock)} {it.unit || ''} · PMP {usd(it.avg_cost)}</Text>
            </View>
            {canWrite ? (
              <TouchableOpacity onPress={() => { setSel(it); setKind('consumo'); setQty(''); setReason(''); }} style={{ backgroundColor: '#EA580C', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Dar salida</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Card>
      ))}

      <Modal visible={!!sel} animationType="slide" onRequestClose={() => setSel(null)}>
        <Screen>
          <ScrollView>
            <SectionTitle>Salida de material</SectionTitle>
            {sel ? (
              <>
                <Card>
                  <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text }}>{sel.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>Disponible: {qtyFmt(sel.stock)} {sel.unit || ''} · PMP {usd(sel.avg_cost)}</Text>
                </Card>
                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Tipo</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                    {([['consumo', '🔥 Consumo'], ['salida', '📤 Salida']] as const).map(([k, lbl]) => {
                      const on = kind === k;
                      return (
                        <TouchableOpacity key={k} onPress={() => setKind(k)} style={{ flex: 1, alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingVertical: spacing.xs }}>
                          <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cantidad ({sel.unit || 'und'})</Text>
                  <TextInput value={qty} onChangeText={(t) => setQty(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Motivo / destino (opcional)</Text>
                  <TextInput value={reason} onChangeText={(t) => setReason(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. MÁQUINA 010, MANTENIMIENTO…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Valor de la salida: {usd(parseNum(qty) * (Number(sel.avg_cost) || 0))}</Text>
                </Card>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <TouchableOpacity onPress={() => setSel(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
                  <TouchableOpacity onPress={registrar} disabled={busy} style={{ flex: 1, backgroundColor: '#EA580C', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? 'Guardando…' : 'Registrar'}</Text></TouchableOpacity>
                </View>
              </>
            ) : null}
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ── Nota de salida / entrega ─────────────────────────────────────────────────
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
      }), `Nota de entrega - ${todayDMY()}`);
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
        reason: `NOTA DE ENTREGA${destino.trim().toUpperCase() ? ` · ${destino.trim().toUpperCase()}` : ''}${detalleMaq}`,
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
      <SectionTitle>Nota de salida / entrega</SectionTitle>
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
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>👷 Entregado a: <Text style={{ color: empSel.length ? colors.primary : colors.muted }}>{empSel.length ? `${empSel.length} empleado(s)` : 'elegir…'}</Text></Text>
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
            <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Generando…' : '🧾 Generar nota (PDF)'}</Text>
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

// ── Cotización ───────────────────────────────────────────────────────────────
type CotizRow = { key: string; codigo: string; referencia: string; descripcion: string; cant: string; precio: string };
function CotizacionTab() {
  const { colors } = useTheme();
  const { data: levels } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name' });

  const [cliente, setCliente] = useState('');
  const [rif, setRif] = useState('');
  const [dir, setDir] = useState('');
  const [numero, setNumero] = useState('');
  const [condPago, setCondPago] = useState('CONTADO');
  const [moneda, setMoneda] = useState('Dólares');
  const [iva, setIva] = useState('0'); // MONTO del IVA (lo coloca el usuario)
  const [rows, setRows] = useState<CotizRow[]>([]);
  const [q, setQ] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  let seq = 0;
  const newKey = () => `${Date.now()}-${seq++}-${rows.length}`;
  const addBlank = () => setRows((r) => [...r, { key: newKey(), codigo: '', referencia: '', descripcion: '', cant: '1', precio: '0' }]);
  const addFromProduct = (it: InventoryLevel) => {
    setRows((r) => [...r, { key: newKey(), codigo: it.sku || '', referencia: '', descripcion: it.name, cant: '1', precio: String(Number(it.avg_cost) || 0) }]);
    setPickOpen(false); setQ('');
  };
  const upd = (key: string, field: keyof CotizRow, val: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, [field]: val } : x)));
  const rm = (key: string) => setRows((r) => r.filter((x) => x.key !== key));

  const base = rows.reduce((s, x) => s + (parseNum(x.cant) * parseNum(x.precio)), 0);
  const ivaN = parseNum(iva); // monto del IVA (lo coloca el usuario)
  const total = base + ivaN;

  const nq = norm(q);
  const productos = levels.filter((it) => !nq || norm(it.name).includes(nq) || norm(it.sku ?? '').includes(nq)).slice(0, 25);

  const todayDMY = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

  const generar = async () => {
    if (!cliente.trim()) return Alert.alert('Aviso', 'Escribe el nombre del cliente.');
    const items: CotizItem[] = rows.filter((x) => x.descripcion.trim()).map((x) => ({ codigo: x.codigo.trim() || null, referencia: x.referencia.trim() || null, descripcion: x.descripcion.trim(), cant: parseNum(x.cant), precio: parseNum(x.precio) }));
    if (items.length === 0) return Alert.alert('Aviso', 'Agrega al menos un ítem con descripción.');
    setBusy(true);
    try {
      await exportPdf(cotizacionHtml({ numero: numero.trim() || null, fecha: todayDMY(), cliente: cliente.trim(), clienteRif: rif.trim() || null, clienteDir: dir.trim() || null, condicionPago: condPago.trim() || null, moneda: moneda.trim() || null, ivaMonto: parseNum(iva), items }), `Cotizacion ${numero.trim() || todayDMY()}`);
    } catch (e: any) { setBusy(false); return Alert.alert('Aviso', 'No se pudo generar el PDF: ' + (e?.message ?? e)); }
    setBusy(false);
  };

  const inp = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Cotización</SectionTitle>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cliente</Text>
        <TextInput value={cliente} onChangeText={(t) => setCliente(t.toUpperCase())} autoCapitalize="characters" placeholder="NOMBRE DEL CLIENTE" placeholderTextColor={colors.muted} style={inp} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>R.I.F</Text><TextInput value={rif} onChangeText={(t) => setRif(t.toUpperCase())} placeholder="J-..." placeholderTextColor={colors.muted} style={inp} /></View>
          <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>N° cotización</Text><TextInput value={numero} onChangeText={setNumero} placeholder="Opcional" placeholderTextColor={colors.muted} style={inp} /></View>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Dirección (opcional)</Text>
        <TextInput value={dir} onChangeText={setDir} placeholder="Dirección del cliente" placeholderTextColor={colors.muted} style={inp} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Condición de pago</Text><TextInput value={condPago} onChangeText={(t) => setCondPago(t.toUpperCase())} style={inp} /></View>
          <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Moneda</Text><TextInput value={moneda} onChangeText={setMoneda} style={inp} /></View>
          <View style={{ width: 100 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>IVA (monto)</Text><TextInput value={iva} onChangeText={(t) => setIva(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={inp} /></View>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TouchableOpacity onPress={() => setPickOpen((v) => !v)} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>📦 Traer del inventario</Text></TouchableOpacity>
        <TouchableOpacity onPress={addBlank} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>＋ Línea libre</Text></TouchableOpacity>
      </View>

      {pickOpen ? (
        <Card>
          <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto por nombre o SKU…" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />
          <View style={{ maxHeight: 200 }}>
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {productos.map((it) => (
                <TouchableOpacity key={it.id} onPress={() => addFromProduct(it)} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{it.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{it.sku ? `${it.sku} · ` : ''}PMP {usd(it.avg_cost)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Card>
      ) : null}

      {rows.map((x) => (
        <Card key={x.key}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Ítem</Text>
            <TouchableOpacity onPress={() => rm(x.key)}><Text style={{ color: colors.danger, fontWeight: '800' }}>🗑 Quitar</Text></TouchableOpacity>
          </View>
          <TextInput value={x.descripcion} onChangeText={(t) => upd(x.key, 'descripcion', t)} placeholder="Descripción" placeholderTextColor={colors.muted} style={inp} />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6 }}>
            <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Código</Text><TextInput value={x.codigo} onChangeText={(t) => upd(x.key, 'codigo', t)} style={inp} /></View>
            <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Referencia</Text><TextInput value={x.referencia} onChangeText={(t) => upd(x.key, 'referencia', t)} style={inp} /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6, alignItems: 'flex-end' }}>
            <View style={{ width: 70 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cant</Text><TextInput value={x.cant} onChangeText={(t) => upd(x.key, 'cant', onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'center' }]} /></View>
            <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Precio unit.</Text><TextInput value={x.precio} onChangeText={(t) => upd(x.key, 'precio', onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'right' }]} /></View>
            <View style={{ alignItems: 'flex-end', minWidth: 80 }}><Text style={{ color: colors.muted, fontSize: 11 }}>Total</Text><Text style={{ color: colors.text, fontWeight: '800' }}>{usd(parseNum(x.cant) * parseNum(x.precio))}</Text></View>
          </View>
        </Card>
      ))}

      {rows.length ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.muted }}>Base imponible</Text><Text style={{ color: colors.text, fontWeight: '700' }}>{usd(base)}</Text></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.muted }}>I.V.A.</Text><Text style={{ color: colors.text, fontWeight: '700' }}>{usd(ivaN)}</Text></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 }}><Text style={{ color: colors.text, fontWeight: '900' }}>TOTAL</Text><Text style={{ color: colors.primary, fontWeight: '900', fontSize: 16 }}>{usd(total)}</Text></View>
        </Card>
      ) : (
        <EmptyState title="Sin ítems" subtitle="Trae productos del inventario o agrega líneas libres." />
      )}

      <TouchableOpacity onPress={generar} disabled={busy} style={{ backgroundColor: '#16324F', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.lg, opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Generando…' : '🧾 Generar cotización (PDF)'}</Text>
      </TouchableOpacity>
    </Screen>
  );
}

// ── Nota de traslado (entre máquinas: origen → destino) ──────────────────────
// Elige materiales del inventario y los TRASLADA de una máquina/empleado (origen)
// a otra máquina/empleado (destino). Al confirmar: genera el PDF, descuenta el
// stock (salida) y guarda el registro en inventory_transfers (casado con máquina
// y empleado de cada lado).
function TrasladoTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: 'inventory_movements' });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'first_name' });

  const [q, setQ] = useState('');
  const [cart, setCart] = useState<{ id: string; name: string; unit: string; qty: number; avg_cost: number; stock: number; company_id: string | null }[]>([]);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

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
      items: cart.map((c) => ({ item_id: c.id, name: c.name, qty: c.qty, unit: c.unit })),
      descontado: true, created_by: session?.user?.id ?? null,
    });
    if (tErr) { setBusy(false); return Alert.alert('Aviso', tErr.message); }
    setBusy(false);
    setCart([]); setMotivo(''); setFromMachId(''); setFromEmpId(''); setToMachId(''); setToEmpId('');
    refetch();
    Alert.alert('Listo', 'Traslado registrado. La salida se descontó del inventario.');
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Nota de traslado</SectionTitle>
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
          <Selector id="fromMach" icon="🚜" label="Máquina" valueId={fromMachId} valueText={machName(fromMachId)} onPick={setFromMachId} options={machOptions} />
          <Selector id="fromEmp" icon="👷" label="Responsable" valueId={fromEmpId} valueText={empNameById(fromEmpId)} onPick={setFromEmpId} options={empOptions} />

          {/* DESTINO */}
          <Text style={{ color: '#0d6b3f', fontWeight: '800', fontSize: 12, marginTop: spacing.md, letterSpacing: 0.5 }}>DESTINO (a dónde va)</Text>
          <Selector id="toMach" icon="🚜" label="Máquina" valueId={toMachId} valueText={machName(toMachId)} onPick={setToMachId} options={machOptions} />
          <Selector id="toEmp" icon="👷" label="Responsable" valueId={toEmpId} valueText={empNameById(toEmpId)} onPick={setToEmpId} options={empOptions} />

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
    { key: 'salidas', label: 'Salidas', icon: '📤' },
    { key: 'nota', label: 'Nota de entrega', icon: '🧾' },
    { key: 'traslado', label: 'Nota de traslado', icon: '🔁' },
    { key: 'cotizacion', label: 'Cotización', icon: '📄' },
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
        {active === 'existencias' ? <ExistenciasTab canWrite={canWrite} /> : active === 'salidas' ? <SalidasTab canWrite={canWrite} /> : active === 'nota' ? <NotaTab canWrite={canWrite} /> : active === 'traslado' ? <TrasladoTab canWrite={canWrite} /> : active === 'cotizacion' ? <CotizacionTab /> : <MovimientosTab />}
      </View>
    </View>
  );
}
