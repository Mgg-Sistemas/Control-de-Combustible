import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Platform, Image, Linking } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard, AccordionGroup, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { norm, onlyDecimal, cmpText } from '../lib/text';
import { InventoryItem, InventoryLevel, InventoryMovement, Company, Machinery, Employee, InventoryRequirement, RequirementLine, InventoryTransfer, UniformDelivery } from '../types/database';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { notaEntregaHtml, NotaItem } from '../lib/notaEntrega';
import { notaTrasladoHtml, TrasladoItem } from '../lib/notaTraslado';
import { buildXlsx, readXlsx } from '../lib/xlsx';
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
// Carga de la bombona (vacía / en uso / llena) — para tildar, filtrar y reportar.
const CARGA_OPTS = ['vacía', 'en uso', 'llena'];
// Palabras que identifican un envase de gas (por TIPO o por NOMBRE), para que también
// los "tanques"/"cilindros" de oxígeno, propano, etc. cuenten como bombona (carga/filtro/reporte).
const BOMBONA_HINTS = ['bombona', 'tanque', 'cilindro', 'botellon', 'oxigeno', 'propano', 'acetileno', 'argon'];
const cargaColor = (c: string | null | undefined) => { const v = (c || '').toLowerCase(); return v === 'llena' ? '#16A34A' : v === 'en uso' ? '#F59E0B' : v === 'vacía' ? '#DC2626' : '#6B7280'; };
const cargaIcon = (c: string | null | undefined) => { const v = (c || '').toLowerCase(); return v === 'llena' ? '🟢' : v === 'en uso' ? '🟡' : v === 'vacía' ? '🔴' : '⚪'; };
// Estado físico (condición) → color e ícono para verlo de un vistazo en la tarjeta.
const estadoColor = (e: string | null | undefined) => { const v = norm(e || ''); return v === 'nuevo' ? '#2563EB' : v === 'bueno' ? '#16A34A' : v === 'regular' ? '#F59E0B' : v === 'danado' ? '#DC2626' : '#6B7280'; };
const estadoIcon = (e: string | null | undefined) => { const v = norm(e || ''); return v === 'nuevo' ? '🔵' : v === 'bueno' ? '🟢' : v === 'regular' ? '🟡' : v === 'danado' ? '🔴' : '⚪'; };
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
  return [...m.values()].sort((a, b) => cmpText(a.name, b.name));
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
      <Text style={{ color, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

function CategoryPicker({ value, onChange, colors }: { value: string; onChange: (k: string) => void; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {CATEGORIES.map((c) => {
        const on = value === c.key;
        return (
          <TouchableOpacity key={c.key} onPress={() => onChange(c.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <Text style={{ fontSize: 13 }}>{c.icon}</Text>
            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.label}</Text>
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
  const toast = useToast();
  const isAdmin = role === 'admin';
  const { rate, date: rateDate, source: rateSource, loading: rateLoading, refresh: refreshRate, setManual: setRateManual } = useBcvRate();
  const [rateEdit, setRateEdit] = useState('');       // input de tasa manual
  const [rateBusy, setRateBusy] = useState(false);
  const [initCostCur, setInitCostCur] = useState<'USD' | 'VES'>('USD'); // moneda del costo al crear/editar
  // Realtime desde AMBAS tablas: el stock cambia por inventory_movements y la carga/estado
  // se guardan en inventory_items → sin esta última, tildar carga/estado no llegaba a los otros equipos.
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: ['inventory_movements', 'inventory_items'] });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });

  const [q, setQ] = useState('');
  const [tipoFilter, setTipoFilter] = useState('__all__'); // filtro por tipo de producto
  const [cargaFilter, setCargaFilter] = useState('__all__'); // filtro por carga de bombona
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
  const [tipo, setTipo] = useState('');            // tipo de producto (bombona, silla, mecate…)
  const [carga, setCarga] = useState('');          // carga de la bombona (vacía/en uso/llena)
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
  // Tipos de producto presentes (bombona, silla, mecate…), con su conteo, para el filtro.
  const tipoOptions = useMemo(() => {
    const m = new Map<string, number>();
    levels.forEach((it) => { const t = (it.tipo || '').trim(); if (t) m.set(t, (m.get(t) ?? 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => cmpText(a[0], b[0]));
  }, [levels]);
  // ¿El producto es una BOMBONA? (por tipo o por nombre) — para carga/filtro/reporte.
  const isBombona = (it: InventoryLevel) => { const s = norm(`${it.tipo || ''} ${it.name}`); return BOMBONA_HINTS.some((w) => s.includes(w)); };
  const bombonas = useMemo(() => levels.filter(isBombona), [levels]);
  // Bombonas por carga: SUMA LAS CANTIDADES (stock) de cada bombona, no cuenta las
  // filas de producto. Así "total llenas / vacías / en uso" refleja cuántas bombonas
  // hay de verdad (un producto puede tener varias unidades en existencia).
  // Cada bombona registrada cuenta como 1 aunque su existencia esté en 0 (es un envase
  // físico que existe); si tiene cantidad mayor, se suma la cantidad. `stock || 1`.
  const cargaCounts = useMemo(() => {
    const m: Record<string, number> = { 'vacía': 0, 'en uso': 0, 'llena': 0, 'sin definir': 0 };
    bombonas.forEach((it) => { const c = (it.carga || '').toLowerCase(); m[CARGA_OPTS.includes(c) ? c : 'sin definir'] += Number(it.stock) || 1; });
    return m;
  }, [bombonas]);
  // Total de bombonas para el reporte (misma regla: cada bombona ≥ 1).
  const totalBombonas = useMemo(() => bombonas.reduce((s, it) => s + (Number(it.stock) || 1), 0), [bombonas]);
  const filtered = useMemo(() => levels.filter((it) => {
    if (tipoFilter === '__none__') { if ((it.tipo || '').trim()) return false; }
    else if (tipoFilter !== '__all__' && norm(it.tipo || '') !== norm(tipoFilter)) return false;
    if (cargaFilter !== '__all__') {
      const c = (it.carga || '').toLowerCase();
      if (cargaFilter === '__sin__') { if (CARGA_OPTS.includes(c)) return false; } else if (c !== cargaFilter) return false;
    }
    // Búsqueda por CUALQUIER característica: nombre, categoría (clave + etiqueta),
    // SKU, unidad, estado, tipo y carga. Antes solo miraba nombre/categoría/tipo, así
    // que un producto no salía al buscar por su SKU/unidad/estado (bug reportado al
    // cargar la plantilla de Excel: los productos ingresados no se filtraban por nombre
    // porque el término no calzaba con esos 3 campos).
    if (!nq) return true;
    const hay = norm([it.name, it.category, catInfo(it.category).label, it.sku, it.unit, it.estado, it.tipo, it.carga]
      .filter(Boolean).join(' '));
    return hay.includes(nq);
  }).sort((a, b) => cmpText(a.name, b.name)), [levels, nq, tipoFilter, cargaFilter]);
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
    setTipo((it as any).tipo || '');
    setCarga((it as any).carga || '');
    setOpen(true);
  };

  // Tildar rápido la CARGA de una bombona (vacía/en uso/llena) sin abrir el editor.
  const [cargaBusy, setCargaBusy] = useState<string | null>(null);
  const quickCarga = async (it: InventoryLevel, value: string) => {
    if (!canWrite) return;
    setCargaBusy(it.id);
    const next = (it.carga || '').toLowerCase() === value ? null : value; // volver a tocar = quitar
    const { error } = await supabase.from('inventory_items').update({ carga: next }).eq('id', it.id);
    setCargaBusy(null);
    if (error) toast.error(error.message); else refetch();
  };

  // Tildar rápido el ESTADO (condición) del producto: Nuevo/Bueno/Regular/Dañado.
  const [estadoBusy, setEstadoBusy] = useState<string | null>(null);
  const quickEstado = async (it: InventoryLevel, value: string) => {
    if (!canWrite) return;
    setEstadoBusy(it.id);
    const next = norm(it.estado || '') === norm(value) ? null : value; // volver a tocar = quitar
    const { error } = await supabase.from('inventory_items').update({ estado: next }).eq('id', it.id);
    setEstadoBusy(null);
    if (error) toast.error(error.message); else refetch();
  };

  // Reporte PDF: cuántas bombonas hay por carga (vacía / en uso / llena).
  const reporteBombonas = async () => {
    if (bombonas.length === 0) return toast.error('No hay bombonas registradas.');
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const d = new Date(); const dmy = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const order = ['llena', 'en uso', 'vacía', 'sin definir'];
    const resumen = order.map((k) => `<tr><td>${esc(k.toUpperCase())}</td><td class="c b">${qtyFmt(cargaCounts[k] ?? 0)}</td></tr>`).join('') +
      `<tr><td class="b">TOTAL</td><td class="c b">${qtyFmt(totalBombonas)}</td></tr>`;
    const sorted = [...bombonas].sort((a, b) => cmpText(a.name, b.name));
    const rows = sorted.map((it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="c b" style="color:${cargaColor(it.carga)}">${esc((it.carga || 'sin definir').toUpperCase())}</td>
      <td class="c">${qtyFmt(it.stock)} ${esc(it.unit || '')}</td>
    </tr>`).join('');
    const html = pdfDocument({
      title: 'Reporte de bombonas por carga',
      subtitle: `${qtyFmt(totalBombonas)} bombona(s) en ${bombonas.length} producto(s) · ${dmy}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left} th{background:#16324F;color:#fff}
        td.c{text-align:center} td.b{font-weight:800} tr:nth-child(even) td{background:#f4f7fb}
        h3{margin:14px 0 4px;font-size:13px}`,
      body: `
        <h3>Cantidad por carga</h3>
        <table><thead><tr><th>Carga</th><th class="c" style="width:120px">Bombonas</th></tr></thead><tbody>${resumen}</tbody></table>
        <h3>Detalle</h3>
        <table><thead><tr><th style="width:30px" class="c">#</th><th>Bombona</th><th class="c">Carga</th><th class="c">Existencia</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
    await exportPdf(html, 'bombonas-por-carga');
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
    if (error) return toast.error(error.message);
    setOpen(false); setEditingId(null); setName(''); setInitCost(''); setEstado(''); setEditQty('');
    refetch();
    toast.success('Producto eliminado del inventario.');
  };

  const crear = async () => {
    if (!name.trim()) return toast.error('Escribe el nombre del material.');
    const cleanName = name.trim().toUpperCase();
    // Costo unitario en US$ (base): si se ingresó en Bs, se convierte con la tasa del día.
    const costUsd = Math.round((initCostCur === 'USD' ? parseNum(initCost) : usdFromBs(parseNum(initCost), rate || 0)) * 10000) / 10000;
    // Evita duplicados por nombre (excluyendo el que se está editando).
    if (levels.some((it) => norm(it.name) === norm(cleanName) && it.id !== editingId)) return toast.error('Ya existe un material con ese nombre.');
    // ── EDICIÓN ──
    if (editingId) {
      setBusy(true);
      const patch: any = { name: cleanName, category, unit: unit.trim().toUpperCase() || null, min_stock: parseNum(minStock), estado: estado || null, tipo: tipo.trim() || null, carga: carga || null };
      // Costo unitario (PMP): si se indicó, se actualiza directo en el producto.
      if (initCost.trim() !== '') patch.avg_cost = costUsd;
      const { error } = await supabase.from('inventory_items').update(patch).eq('id', editingId);
      if (error) { setBusy(false); return toast.error(error.message); }
      // Cantidad: si cambió, se ajusta con un movimiento de AJUSTE (delta = nueva − actual).
      const nuevaQty = parseNum(editQty);
      const delta = Math.round((nuevaQty - editStock0) * 100) / 100;
      if (delta !== 0) {
        const { error: mErr } = await supabase.from('inventory_movements').insert({
          item_id: editingId, kind: 'ajuste', qty: delta, unit_cost: null,
          reason: 'AJUSTE DE INVENTARIO', company_id: null, created_by: session?.user?.id ?? null,
        });
        if (mErr) { setBusy(false); return toast.error(mErr.message); }
      }
      setBusy(false);
      setOpen(false); setEditingId(null); setName(''); setCategory('repuestos'); setUnit(''); setSku(''); setMinStock(''); setInitCost(''); setEstado(''); setTipo(''); setCarga(''); setEditQty('');
      refetch();
      return;
    }
    setBusy(true);
    // SKU incremental: se recalcula al vuelo (con los SKU actuales) para no chocar.
    const { data: skuRows } = await supabase.from('inventory_items').select('sku');
    const autoSku = nextSkuFrom((skuRows ?? []).map((r: any) => r.sku));
    // Inventario GENERAL: no se vincula a empresa ni equipo al crear.
    const { data: ins, error } = await supabase.from('inventory_items')
      .insert({ name: cleanName, category, unit: unit.trim().toUpperCase() || null, sku: autoSku, min_stock: parseNum(minStock), estado: estado || null, tipo: tipo.trim() || null, carga: carga || null, machinery_id: null, company_id: null })
      .select('id').single();
    if (error) { setBusy(false); return toast.error(error.message); }
    // Stock inicial (opcional): registra una entrada que fija existencia y PMP de arranque.
    const qi = parseNum(initStock);
    if (qi > 0) {
      const { error: mErr } = await supabase.from('inventory_movements').insert({
        item_id: ins.id, kind: 'entrada', qty: qi, unit_cost: costUsd || 0,
        reason: 'INVENTARIO INICIAL', company_id: null, created_by: session?.user?.id ?? null,
      });
      if (mErr) { setBusy(false); return toast.error(mErr.message); }
    }
    setBusy(false);
    setOpen(false); setName(''); setCategory('repuestos'); setUnit(''); setSku(''); setMinStock(''); setMachineryId(''); setMachineQuery(''); setInitStock(''); setInitCost(''); setTipo('');
    refetch();
  };

  // Abre el modal calculando el próximo SKU incremental para mostrarlo.
  const openCreate = async () => {
    setEditingId(null);
    setName(''); setCategory('repuestos'); setUnit(''); setMinStock(''); setInitStock(''); setInitCost(''); setInitCostCur('USD'); setEstado(''); setTipo(''); setCarga(''); setEditQty('');
    const { data } = await supabase.from('inventory_items').select('sku');
    setSku(nextSkuFrom((data ?? []).map((r: any) => r.sku)));
    setOpen(true);
  };

  // ── Reporte de TODOS los productos (cantidad, disponibilidad y estado) ──────
  const reporteProductos = async () => {
    if (levels.length === 0) return toast.error('No hay productos para el reporte.');
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const d = new Date(); const dmy = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const sorted = [...levels].sort((a, b) => cmpText(a.name, b.name));
    const rows = sorted.map((it, i) => {
      const disp = dispoOf(Number(it.stock), Number(it.min_stock));
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.name)}</td>
        <td>${esc(it.tipo || '—')}</td>
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
          <thead><tr><th style="width:30px" class="c">#</th><th>Producto</th><th>Tipo</th><th>Categoría</th>
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
      toast.error(e?.message ?? 'No se pudo leer el archivo.');
    }
  };

  // Carga solo las filas OK: crea el producto con SKU incremental + su entrada.
  const cargarLote = async () => {
    const ok = (loteRows ?? []).filter((r) => r.status === 'ok');
    if (ok.length === 0) return toast.error('No hay filas válidas para cargar. Corrige las repetidas o mal cargadas.');
    setLoteBusy(true);
    const { data: skuRows } = await supabase.from('inventory_items').select('sku');
    let maxN = 0;
    (skuRows ?? []).forEach((r: any) => { const m = String(r.sku ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > maxN) maxN = n; } });
    const pad = (n: number) => 'INV-' + String(n).padStart(4, '0');
    const toInsert = ok.map((r, i) => ({ name: r.name, unit: r.unit, sku: pad(maxN + i + 1), category: r.category, min_stock: r.min, machinery_id: null, company_id: null }));
    const { data: inserted, error } = await supabase.from('inventory_items').insert(toInsert).select('id, sku');
    if (error) { setLoteBusy(false); return toast.error(error.message); }
    const idBySku = new Map((inserted ?? []).map((r: any) => [r.sku, r.id]));
    const movs = ok
      .map((r, i) => ({ item_id: idBySku.get(pad(maxN + i + 1)), kind: 'entrada' as const, qty: r.qty, unit_cost: r.cost || 0, reason: 'CARGA POR LOTE', company_id: null, created_by: session?.user?.id ?? null }))
      .filter((m) => m.item_id && m.qty > 0);
    if (movs.length) {
      const { error: mErr } = await supabase.from('inventory_movements').insert(movs);
      if (mErr) { setLoteBusy(false); return toast.error('Productos creados, pero falló el stock inicial: ' + mErr.message); }
    }
    setLoteBusy(false);
    setLoteOpen(false); setLoteText(''); setLoteRows(null);
    refetch();
    toast.success(`Se cargaron ${ok.length} producto(s).`);
  };

  if (loading) return <Screen><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <View style={{ flex: 1.3, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.brand }}>
          <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>VALOR INVENTARIO</Text>
          <Text style={{ color: colors.brandContrast, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] as any, marginTop: 2 }}>{usd(totalValor)}</Text>
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>PRODUCTOS</Text>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{levels.length}</Text>
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderColor: bajoMin ? colors.warningSoftBorder : colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: bajoMin ? colors.warningSoftBg : colors.surface }}>
          <Text style={{ color: bajoMin ? colors.warningSoftText : colors.muted, fontSize: 11, fontWeight: '700' }}>BAJO MÍN.</Text>
          <Text style={{ color: bajoMin ? colors.warningSoftText : colors.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{bajoMin}</Text>
        </View>
      </View>

      {/* Tasa BCV del día (Bs/US$). Precios del inventario visibles en $ y Bs. */}
      <View style={{ borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.infoSoftBg, marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.infoSoftText, opacity: 0.9, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>💵 TASA BCV DEL DÍA</Text>
            <Text style={{ color: colors.infoSoftText, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>
              {rateLoading ? 'Cargando…' : rate ? `${fmtBs(rate)} / US$` : 'Sin tasa'}
              {rate ? <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '600' }}>  ({rateSource === 'manual' ? 'manual' : 'BCV'})</Text> : null}
            </Text>
          </View>
          <TouchableOpacity onPress={async () => { setRateBusy(true); try { await refreshRate(); } catch { toast.error('No se pudo actualizar la tasa del BCV. Puedes fijarla a mano.'); } setRateBusy(false); }} disabled={rateBusy} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{rateBusy ? '…' : '🔄 Actualizar'}</Text>
          </TouchableOpacity>
        </View>
        {isAdmin ? (
          <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center', marginTop: spacing.xs }}>
            <TextInput value={rateEdit} onChangeText={(t) => setRateEdit(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="Fijar tasa a mano (Bs/$)" placeholderTextColor={colors.muted} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text }} />
            <TouchableOpacity onPress={async () => { const v = parseNum(rateEdit); if (v <= 0) return toast.error('Escribe una tasa válida.'); await setRateManual(v); setRateEdit(''); }} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
              <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>Fijar</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
        <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar: nombre, SKU, categoría, unidad, tipo, estado…" placeholderTextColor={colors.muted} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
        {canWrite ? (
          <TouchableOpacity onPress={openCreate} style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>+ Producto</Text>
          </TouchableOpacity>
        ) : null}
        {canWrite ? (
          <TouchableOpacity onPress={() => { setLoteText(''); setLoteRows(null); setLoteOpen(true); }} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>📋 Lote</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity onPress={reporteProductos} style={{ marginTop: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
        <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 13 }}>📄 Reporte de productos (cantidad y estado)</Text>
      </TouchableOpacity>

      {/* Bombonas: reporte por carga (vacía/en uso/llena) — solo si hay bombonas. */}
      {bombonas.length ? (
        <TouchableOpacity onPress={reporteBombonas} style={{ marginTop: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>🛢️ Reporte de bombonas por carga · 🟢 {cargaCounts['llena']} · 🟡 {cargaCounts['en uso']} · 🔴 {cargaCounts['vacía']}</Text>
        </TouchableOpacity>
      ) : null}

      {/* Filtro por CARGA de bombona (vacía / en uso / llena). */}
      {bombonas.length ? (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Filtrar por carga (bombonas)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingRight: spacing.md }}>
            {([['__all__', 'Todas', totalBombonas], ['llena', '🟢 Llena', cargaCounts['llena']], ['en uso', '🟡 En uso', cargaCounts['en uso']], ['vacía', '🔴 Vacía', cargaCounts['vacía']], ['__sin__', '⚪ Sin definir', cargaCounts['sin definir']]] as [string, string, number][]).map(([val, label, n]) => {
              const on = cargaFilter === val;
              return (
                <TouchableOpacity key={val} onPress={() => setCargaFilter(val)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
                  <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({n})</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

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
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{catInfo(it.category).icon} {catInfo(it.category).label}{it.tipo ? ` · 🏷️ ${it.tipo}` : ''}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900' }}>{qtyFmt(it.stock)} {it.unit || ''}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, alignItems: 'center', marginTop: 1 }}>
                        {isBombona(it) ? <Text style={{ color: cargaColor(it.carga), fontSize: 11, fontWeight: '800' }}>{cargaIcon(it.carga)} {(it.carga || 'sin carga').toUpperCase()}</Text> : null}
                        {/* Condición del producto: siempre visible (cómo se encuentra). */}
                        <Text style={{ color: estadoColor(it.estado), fontSize: 11, fontWeight: '800' }}>{estadoIcon(it.estado)} {(it.estado || 'sin estado').toUpperCase()}</Text>
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
                        {rate ? <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700' }}>{fmtBs(bsFromUsd(Number(it.avg_cost) || 0, rate))}</Text> : null}
                      </View>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>SKU</Text>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{(it as any).sku || '—'}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>VALOR EN STOCK</Text>
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{usd((Number(it.stock) || 0) * (Number(it.avg_cost) || 0))}</Text>
                        {rate ? <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700' }}>{fmtBs(bsFromUsd((Number(it.stock) || 0) * (Number(it.avg_cost) || 0), rate))}</Text> : null}
                      </View>
                    </View>
                    {/* Estado (condición) rápido para TODOS los productos: cómo se encuentra. */}
                    <View style={{ marginTop: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>¿Cómo se encuentra? {estadoBusy === it.id ? '· guardando…' : ''}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                        {ESTADOS.map((v) => {
                          const on = norm(it.estado || '') === norm(v);
                          return (
                            <TouchableOpacity key={v} disabled={!canWrite || estadoBusy === it.id} onPress={() => quickEstado(it, v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? estadoColor(v) : colors.border, backgroundColor: on ? estadoColor(v) : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: canWrite ? 1 : 0.5 }}>
                              <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>{estadoIcon(v)} {v}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                    {/* Bombonas: tildar carga rápido (vacía / en uso / llena). */}
                    {isBombona(it) ? (
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Carga de la bombona {cargaBusy === it.id ? '· guardando…' : ''}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                          {CARGA_OPTS.map((v) => {
                            const on = (it.carga || '').toLowerCase() === v;
                            return (
                              <TouchableOpacity key={v} disabled={!canWrite || cargaBusy === it.id} onPress={() => quickCarga(it, v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? cargaColor(v) : colors.border, backgroundColor: on ? cargaColor(v) : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: canWrite ? 1 : 0.5 }}>
                                <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>{cargaIcon(v)} {v}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    ) : null}
                    {canWrite ? (
                      <TouchableOpacity onPress={() => openEdit(it)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>✏️ Editar producto</Text>
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
                    <TouchableOpacity key={e} onPress={() => setEstado(on ? '' : e)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{e}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Tipo de producto (libre, con sugerencias): bombona, silla, mecate… */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Tipo de producto (para filtrar)</Text>
              <TextInput value={tipo} onChangeText={(t) => setTipo(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. BOMBONA, SILLA, MECATE…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
              {/* Sugerencias BUSCABLES: al escribir arriba se filtran los tipos ya usados
                  (antes salían TODOS de golpe, una pared de chips). Tope 30 para no saturar. */}
              {(() => {
                const sugeridos = tipoOptions
                  .filter(([t]) => !norm(tipo) || norm(t).includes(norm(tipo)))
                  .slice(0, 30);
                if (!sugeridos.length) return null;
                return (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                    {sugeridos.map(([t]) => (
                      <TouchableOpacity key={t} onPress={() => setTipo(norm(tipo) === norm(t) ? '' : t)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: norm(tipo) === norm(t) ? colors.brand : colors.border, backgroundColor: norm(tipo) === norm(t) ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: norm(tipo) === norm(t) ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })()}

              {/* Carga (para bombonas): vacía / en uso / llena. */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Carga de la bombona (opcional)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {CARGA_OPTS.map((v) => {
                  const on = norm(carga) === norm(v);
                  return (
                    <TouchableOpacity key={v} onPress={() => setCarga(on ? '' : v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? cargaColor(v) : colors.border, backgroundColor: on ? cargaColor(v) : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>{cargaIcon(v)} {v}</Text>
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
                      <TouchableOpacity onPress={() => setInitCostCur(initCostCur === 'USD' ? 'VES' : 'USD')} style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 }}>
                        <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 11 }}>{initCostCur === 'USD' ? '$→Bs' : 'Bs→$'}</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput value={initCost} onChangeText={(t) => setInitCost(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                    {parseNum(initCost) > 0 && rate ? <Text style={{ color: colors.success, fontSize: 11, marginTop: 2 }}>≈ {initCostCur === 'USD' ? fmtBs(bsFromUsd(parseNum(initCost), rate)) : usd(usdFromBs(parseNum(initCost), rate))}</Text> : null}
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
                    <TouchableOpacity onPress={() => setInitCostCur(initCostCur === 'USD' ? 'VES' : 'USD')} style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 11 }}>{initCostCur === 'USD' ? '$→Bs' : 'Bs→$'}</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput value={initCost} onChangeText={(t) => setInitCost(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  {parseNum(initCost) > 0 && rate ? <Text style={{ color: colors.success, fontSize: 11, marginTop: 2 }}>≈ {initCostCur === 'USD' ? fmtBs(bsFromUsd(parseNum(initCost), rate)) : usd(usdFromBs(parseNum(initCost), rate))}</Text> : null}
                </View>
              </View>
              {parseNum(initStock) > 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Valor inicial: {usd(parseNum(initStock) * (initCostCur === 'USD' ? parseNum(initCost) : usdFromBs(parseNum(initCost), rate || 0)))}</Text> : null}
            </Card>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => { setOpen(false); setEditingId(null); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : (editingId ? 'Guardar cambios' : 'Guardar')}</Text></TouchableOpacity>
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
                {/* Descargar/Subir Excel solo en WEB: en el teléfono el navegador embebido
                    no descarga archivos (el botón antes no hacía nada). */}
                {Platform.OS === 'web' ? (
                  <>
                    <TouchableOpacity onPress={descargarPlantilla} style={{ backgroundColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>⬇️ Descargar plantilla (Excel)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={subirArchivo} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>📁 Subir Excel</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>La plantilla Excel (descargar/subir) está disponible en la versión web.</Text>
                )}
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
                    <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ color: colors.success, fontSize: 18, fontWeight: '900' }}>{okN}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>Válidas</Text></View>
                    <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ color: colors.warning, fontSize: 18, fontWeight: '900' }}>{dupN}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>Repetidas</Text></View>
                    <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ color: colors.danger, fontSize: 18, fontWeight: '900' }}>{badN}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>Mal cargadas</Text></View>
                  </View>
                  {bad.length ? (
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12, marginBottom: 4 }}>Filas a revisar (no se cargan):</Text>
                      {bad.map((r) => (
                        <Text key={r.rowNo} style={{ color: r.status === 'dup' ? colors.warning : colors.danger, fontSize: 12 }}>
                          • Fila {r.rowNo}{r.name ? ` (${r.name})` : ''}: {r.problems.join(', ')}
                        </Text>
                      ))}
                    </View>
                  ) : <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700' }}>✓ Todas las filas están correctas.</Text>}
                  <TouchableOpacity onPress={cargarLote} disabled={loteBusy || okN === 0} style={{ marginTop: spacing.sm, backgroundColor: okN ? colors.accent : colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: loteBusy ? 0.6 : 1 }}>
                    <Text style={{ color: okN ? colors.accentContrast : colors.muted, fontWeight: '800' }}>{loteBusy ? 'Cargando…' : `Cargar ${okN} producto(s)`}</Text>
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
  const confirm = useConfirm();
  const toast = useToast();
  const { data: movs, loading, refetch } = useTable<InventoryMovement>('inventory_movements', { orderBy: 'created_at', ascending: false, realtimeFrom: 'inventory_movements' });
  const { data: items } = useTable<InventoryItem>('inventory_items', { orderBy: 'name' });
  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? 'Producto';
  const itemUnit = (id: string) => items.find((i) => i.id === id)?.unit ?? '';

  // Revertir una SALIDA: devuelve la cantidad al inventario. El stock es DERIVADO de los
  // movimientos (vista inventory_levels), así que al borrar la salida el stock sube solo,
  // sin tocar el costo (PMP). Borrado no autorizado por RLS quita 0 filas SIN error → se
  // detecta con .select().
  const revertirSalida = async (m: InventoryMovement) => {
    const ok = await confirm({
      title: 'Revertir al inventario',
      message: `Se devolverán ${qtyFmt(m.qty)} ${itemUnit(m.item_id)} de "${itemName(m.item_id)}" al inventario y se eliminará esta salida. ¿Continuar?`,
      confirmText: 'Sí, revertir',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    const { data, error } = await supabase.from('inventory_movements').delete().eq('id', m.id).select('id');
    if (error) { toast.error(error.message); return; }
    if (!data || data.length === 0) { toast.error('El servidor no autorizó eliminar el movimiento (permiso del módulo de inventario).'); return; }
    await refetch();
    toast.success('La salida se devolvió al inventario. El stock ya refleja el cambio.');
  };

  const [filter, setFilter] = useState('');
  const [qFree, setQFree] = useState('');          // búsqueda libre (producto / motivo / tipo)
  const [fFrom, setFFrom] = useState('');          // rango de fechas (desde) por created_at
  const [fTo, setFTo] = useState('');              // rango de fechas (hasta)
  const nqf = norm(qFree.trim());
  const shown = useMemo(() => movs.filter((m) => {
    if (filter && m.kind !== filter) return false;
    if (nqf && !norm([itemName(m.item_id), m.reason, m.kind].filter(Boolean).join(' ')).includes(nqf)) return false;
    const d = String(m.created_at).slice(0, 10); // AAAA-MM-DD del movimiento
    if (fFrom && d < fFrom) return false;
    if (fTo && d > fTo) return false;
    return true;
  }), [movs, items, filter, nqf, fFrom, fTo]);
  const hayFiltro = !!(qFree || fFrom || fTo);

  // Escapa texto para HTML del PDF.
  const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const hoyDmy = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

  // ── Reporte PDF de UN movimiento (ficha con todos sus detalles) ─────────────
  const reporteMovimiento = async (m: InventoryMovement) => {
    const k = MOV_KIND[m.kind] ?? MOV_KIND.ajuste;
    const valor = m.unit_cost != null ? Number(m.unit_cost) * Number(m.qty) : null;
    const filas: [string, string][] = [
      ['Tipo de movimiento', k.label],
      ['Producto', itemName(m.item_id)],
      ['Cantidad', `${k.sign}${qtyFmt(m.qty)} ${itemUnit(m.item_id)}`.trim()],
      ['Costo unitario', m.unit_cost != null ? usd(m.unit_cost) : '—'],
      ['Valor', valor != null ? usd(valor) : '—'],
      ['Motivo / nota', m.reason || '—'],
      ['Origen', m.order_id ? 'Desde orden de compra' : '—'],
      ['Fecha', fmtDate(m.created_at)],
    ];
    const body = `<table class="kv"><tbody>${filas.map(([kk, vv]) => `<tr><td class="k">${esc(kk)}</td><td>${esc(vv)}</td></tr>`).join('')}</tbody></table>`;
    const html = pdfDocument({
      title: 'Movimiento de inventario',
      subtitle: `${esc(itemName(m.item_id))} · ${esc(k.label)} · ${esc(hoyDmy())}`,
      extraCss: `table.kv{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
        table.kv td{border:1px solid #c9d2dc;padding:8px 10px;vertical-align:top}
        table.kv td.k{background:#16324F;color:#fff;font-weight:700;width:190px}
        table.kv tr:nth-child(even) td:not(.k){background:#f4f7fb}`,
      body,
    });
    await exportPdf(html, `Movimiento - ${itemName(m.item_id)} - ${hoyDmy()}`);
  };

  // ── Reporte PDF de TODOS los movimientos mostrados (respeta el filtro) ──────
  const reporteMovimientos = async () => {
    if (shown.length === 0) return toast.error('No hay movimientos para el reporte.');
    // Orden natural por fecha (del más antiguo al más reciente) para el reporte.
    const sorted = [...shown].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const rows = sorted.map((m, i) => {
      const k = MOV_KIND[m.kind] ?? MOV_KIND.ajuste;
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(fmtDate(m.created_at))}</td>
        <td>${esc(itemName(m.item_id))}</td>
        <td class="c" style="color:${k.color};font-weight:800">${esc(k.label)}</td>
        <td class="c b">${k.sign}${qtyFmt(m.qty)} ${esc(itemUnit(m.item_id))}</td>
        <td class="r">${m.unit_cost != null ? usd(m.unit_cost) : '—'}</td>
        <td>${esc(m.reason || '—')}</td>
      </tr>`;
    }).join('');
    const cont = { entrada: 0, salida: 0, consumo: 0, ajuste: 0 } as Record<string, number>;
    let totEntradas = 0, totSalidas = 0;
    sorted.forEach((m) => {
      cont[m.kind] = (cont[m.kind] ?? 0) + 1;
      if (m.kind === 'entrada') totEntradas += Number(m.qty) || 0;
      else if (m.kind === 'salida' || m.kind === 'consumo') totSalidas += Number(m.qty) || 0;
    });
    const kindLabel = filter ? (MOV_KIND[filter]?.label ?? filter) : 'Todos los tipos';
    const rango = fFrom || fTo ? ` · ${fFrom || '…'} a ${fTo || '…'}` : '';
    const busq = qFree ? ` · "${qFree.trim()}"` : '';
    const resumen = `
        <tr><td class="k">📥 Entradas</td><td class="c">${cont.entrada}</td><td class="r b">${qtyFmt(totEntradas)}</td></tr>
        <tr><td class="k">📤 Salidas</td><td class="c">${cont.salida}</td><td class="r b">${qtyFmt(totSalidas)}</td></tr>
        <tr><td class="k">🔥 Consumo</td><td class="c">${cont.consumo}</td><td class="r">—</td></tr>
        <tr><td class="k">🔧 Ajustes</td><td class="c">${cont.ajuste}</td><td class="r">—</td></tr>`;
    const html = pdfDocument({
      title: 'Reporte de movimientos',
      subtitle: `${shown.length} movimiento(s) · ${esc(kindLabel)}${esc(busq)}${esc(rango)} · ${esc(hoyDmy())}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left} th{background:#16324F;color:#fff}
        td.c{text-align:center} td.r{text-align:right} td.b{font-weight:800} tr:nth-child(even) td{background:#f4f7fb}
        table.tot{width:auto;min-width:280px} table.tot td.k{background:#16324F;color:#fff;font-weight:700}
        h3{margin:16px 0 0;font-size:13px;color:#16324F}`,
      body: `
        <h3>Resumen</h3>
        <table class="tot"><thead><tr><th>Tipo</th><th class="c" style="width:90px">Cantidad</th><th class="r" style="width:120px">Total (unid.)</th></tr></thead><tbody>${resumen}</tbody></table>
        <h3>Detalle</h3>
        <table>
          <thead><tr><th style="width:30px" class="c">#</th><th style="width:120px">Fecha</th><th>Producto</th>
            <th class="c">Tipo</th><th class="c">Cantidad</th><th class="r">Costo unit.</th><th>Motivo</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`,
    });
    await exportPdf(html, `Reporte de movimientos - ${hoyDmy()}`);
  };

  if (loading) return <Screen><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
      <ConfigBanner />
      <SectionTitle>Movimientos (traza)</SectionTitle>

      {/* Búsqueda libre + rango de fechas */}
      <TextInput
        value={qFree} onChangeText={setQFree}
        placeholder="🔎 Buscar por producto o motivo…" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.xs }}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
          <DateField value={fFrom} onChange={(v) => setFFrom(v || '')} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
          <DateField value={fTo} onChange={(v) => setFTo(v || '')} />
        </View>
        {hayFiltro ? (
          <TouchableOpacity onPress={() => { setQFree(''); setFFrom(''); setFTo(''); }} style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Limpiar</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {[{ k: '', l: 'Todos' }, { k: 'entrada', l: '📥 Entradas' }, { k: 'salida', l: '📤 Salidas' }, { k: 'consumo', l: '🔥 Consumo' }, { k: 'ajuste', l: '🔧 Ajustes' }].map((f) => {
          const on = filter === f.k;
          return (
            <TouchableOpacity key={f.k || 'all'} onPress={() => setFilter(f.k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {shown.length ? (
        <TouchableOpacity onPress={reporteMovimientos} style={{ marginBottom: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 13 }}>📄 Reporte de movimientos ({shown.length})</Text>
        </TouchableOpacity>
      ) : null}

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
                  {/* Precio en el resumen (no solo al expandir): costo unitario y total del
                      movimiento. Aplica a ENTRADAS y SALIDAS (la salida trae su costo
                      promedio) y a las CARGAS POR LOTE, que se marcan con 📋 para distinguirlas. */}
                  {m.unit_cost != null ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      💵 {usd(m.unit_cost)} c/u{Number(m.qty) ? ` · ${usd(Number(m.unit_cost) * Number(m.qty))}` : ''}{m.reason === 'CARGA POR LOTE' ? ' · 📋 Lote' : ''}
                    </Text>
                  ) : m.reason === 'CARGA POR LOTE' ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>📋 Lote · sin precio</Text>
                  ) : null}
                </View>
                <Pill label={k.label} color={k.color} />
              </View>
            }
            detail={
              <>
                {m.unit_cost != null ? <Text style={{ color: colors.muted, fontSize: 13 }}>Costo unitario: {usd(m.unit_cost)}{Number(m.qty) ? ` · Total: ${usd(Number(m.unit_cost) * Number(m.qty))}` : ''}</Text> : null}
                {m.reason ? <Text style={{ color: colors.text, fontSize: 13 }}>{m.reason}</Text> : null}
                {m.order_id ? <Text style={{ color: colors.success, fontSize: 13, fontWeight: '700' }}>🧾 Desde orden de compra</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDate(m.created_at)}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  <TouchableOpacity
                    onPress={() => reporteMovimiento(m)}
                    style={{ alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                  >
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>🧾 Reporte</Text>
                  </TouchableOpacity>
                  {m.kind === 'salida' ? (
                    <TouchableOpacity
                      onPress={() => revertirSalida(m)}
                      style={{ alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                    >
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>↩️ Revertir al inventario</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
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
  const toast = useToast();
  // Realtime desde AMBAS tablas: el stock cambia por inventory_movements y la carga/estado
  // se guardan en inventory_items → sin esta última, tildar carga/estado no llegaba a los otros equipos.
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: ['inventory_movements', 'inventory_items'] });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const companyNameById = (id: string | null) => (id ? (companies.find((c) => c.id === id)?.name ?? '') : '');

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
  // Empresa / persona NO registradas (texto libre): solo van en la nota y el registro,
  // NO se crean como empresa ni empleado, así que NO entran en la nómina.
  const [empresaLibre, setEmpresaLibre] = useState('');
  const [personaLibre, setPersonaLibre] = useState('');
  // Empresa REGISTRADA a la que se carga la salida (se guarda en el movimiento).
  const [salidaCompanyId, setSalidaCompanyId] = useState<string | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [companyQuery, setCompanyQuery] = useState('');

  const nq = norm(q);
  const filtered = useMemo(() => levels.filter((it) => Number(it.stock) > 0 && (!nq || norm(it.name).includes(nq))), [levels, nq]);
  const inCart = (id: string) => cart.find((c) => c.id === id);
  const machineLabel = (m: Machinery) => [m.code, companyNameById(m.company_id) || null, m.plate ? `Placa ${m.plate}` : (m.serial ? `Serial ${m.serial}` : null)].filter(Boolean).join(' · ');
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
    if (cart.length === 0) return toast.error('Agrega al menos un producto a la nota.');
    // Validación de cantidades y stock (la salida descuenta del inventario SOLO al confirmar).
    for (const c of cart) {
      if (c.qty <= 0) return toast.error(`Indica la cantidad de "${c.name}".`);
      if (c.qty > c.stock) return toast.error(`No hay suficiente stock de "${c.name}". Disponible: ${qtyFmt(c.stock)} ${c.unit}.`);
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
        empresa: (companyNameById(salidaCompanyId) || empresaLibre.trim()) || null,
        maquina: machineryId ? machineName(machineryId) : null,
        empleados: [...empSel.map((e) => e.name), ...(personaLibre.trim() ? [personaLibre.trim()] : [])],
        // Snapshot con cédula/cargo de cada empleado REGISTRADO seleccionado (no aplica a personaLibre).
        empleadosDetalle: empSel.length ? empSel.map((e) => {
          const emp = employees.find((x: any) => x.id === e.id);
          return { name: e.name, cedula: (emp as any)?.cedula ?? null, cargo: (emp as any)?.cargo ?? null };
        }) : undefined,
        items,
      }), `Nota de salida - ${todayDMY()}`);
    } catch (e: any) {
      setBusy(false);
      return toast.error('No se pudo generar el PDF: ' + (e?.message ?? e));
    }
    if (!confirmado) {
      // Canceló la vista previa: no se descuenta y se conserva la selección.
      setBusy(false);
      return;
    }
    // 2) CONFIRMADO: registra la salida de cada producto (descuenta del inventario).
    {
      const detalleMaq = machineryId ? ` · ${machineName(machineryId)}` : '';
      const empresaRegName = companyNameById(salidaCompanyId);
      const empresaTxt = empresaRegName || empresaLibre.trim();
      const detalleEmp = empresaTxt ? ` · EMPRESA: ${empresaTxt.toUpperCase()}` : '';
      const detallePers = personaLibre.trim() ? ` · RECIBE: ${personaLibre.trim().toUpperCase()}` : '';
      const rows = cart.map((c) => ({
        item_id: c.id, kind: 'salida' as const, qty: c.qty, unit_cost: c.avg_cost || null,
        reason: `NOTA DE SALIDA${destino.trim().toUpperCase() ? ` · ${destino.trim().toUpperCase()}` : ''}${detalleMaq}${detalleEmp}${detallePers}`,
        // Empresa REGISTRADA elegida para la salida; si no, la del producto.
        company_id: salidaCompanyId ?? c.company_id, created_by: session?.user?.id ?? null,
        // Equipo destino: para el reporte de gasto por equipo (Mantenimiento).
        machinery_id: machineryId || null,
        // Empleados que reciben (para el historial de dotación por trabajador).
        employee_ids: empSel.map((e) => e.id),
        employees_detail: empSel.map((e) => {
          const emp = employees.find((x: any) => x.id === e.id);
          return { id: e.id, name: e.name, cedula: (emp as any)?.cedula ?? null, cargo: (emp as any)?.cargo ?? null };
        }),
      }));
      let { error } = await supabase.from('inventory_movements').insert(rows);
      // Si aún no se corrió la migración de machinery_id en movimientos, reintenta sin esa columna.
      if (error && /machinery_id|column/i.test(error.message)) {
        const rowsBasic = rows.map(({ machinery_id, ...r }) => r);
        ({ error } = await supabase.from('inventory_movements').insert(rowsBasic));
        // Si tampoco existe employee_ids/employees_detail (migración pendiente), reintenta sin esas columnas.
        if (error && /employee_ids|employees_detail|column/i.test(error.message)) {
          const rowsSinEmpleados = rowsBasic.map(({ employee_ids, employees_detail, ...r }) => r);
          ({ error } = await supabase.from('inventory_movements').insert(rowsSinEmpleados));
        }
      }
      if (error) { setBusy(false); return toast.error(error.message); }
    }
    setBusy(false);
    setCart([]); setDestino(''); setMachineryId(''); setMachineQuery(''); setEmpSel([]); setEmpQuery(''); setEmpresaLibre(''); setPersonaLibre(''); setSalidaCompanyId(null); setCompanyOpen(false); setCompanyQuery('');
    refetch();
    toast.success('Nota generada. La salida se descontó del inventario.');
  };

  if (loading) return <Screen><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
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
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>🚜 Máquina: <Text style={{ color: machineryId ? colors.brandText : colors.muted }}>{machineryId ? machineName(machineryId) : 'elegir…'}</Text></Text>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>{machOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {machOpen ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm }}>
              <TextInput value={machineQuery} onChangeText={setMachineQuery} placeholder="Filtrar por código, empresa, serial, placa, modelo…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 6 }} />
              {machineryId ? (
                <TouchableOpacity onPress={() => setMachineryId('')} style={{ paddingVertical: 6 }}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Quitar selección</Text></TouchableOpacity>
              ) : null}
              <View style={{ maxHeight: 200 }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {machines.filter((m) => { const s = norm(machineQuery); return !s || norm([m.code, m.serial, m.plate, m.tipo, companyNameById(m.company_id)].filter(Boolean).join(' ')).includes(s); }).map((m) => {
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
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>👷 Recibe: <Text style={{ color: empSel.length ? colors.brandText : colors.muted }}>{empSel.length ? `${empSel.length} empleado(s)` : 'elegir…'}</Text></Text>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>{empOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {empSel.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {empSel.map((e) => (
                <TouchableOpacity key={e.id} onPress={() => setEmpSel((prev) => prev.filter((x) => x.id !== e.id))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                  <Text style={{ color: colors.brandContrast, fontSize: 12, fontWeight: '700' }}>{e.name}</Text>
                  <Text style={{ color: colors.brandContrast, fontSize: 12 }}>✕</Text>
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

          {/* Empresa REGISTRADA: se guarda en el movimiento de salida (company_id). */}
          <TouchableOpacity onPress={() => setCompanyOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>🏢 Empresa: <Text style={{ color: salidaCompanyId ? colors.brandText : colors.muted }}>{salidaCompanyId ? companyNameById(salidaCompanyId) : 'elegir…'}</Text></Text>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>{companyOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {companyOpen ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm }}>
              <TextInput value={companyQuery} onChangeText={setCompanyQuery} placeholder="Filtrar empresa…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 6 }} />
              {salidaCompanyId ? (
                <TouchableOpacity onPress={() => setSalidaCompanyId(null)} style={{ paddingVertical: 6 }}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Quitar selección</Text></TouchableOpacity>
              ) : null}
              <View style={{ maxHeight: 200 }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {companies.filter((c) => { const s = norm(companyQuery); return !s || norm(c.name).includes(s); }).map((c) => {
                    const on = salidaCompanyId === c.id;
                    return (
                      <TouchableOpacity key={c.id} onPress={() => { setSalidaCompanyId(c.id); setCompanyOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 15 }}>{on ? '🔘' : '⚪'}</Text>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{c.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          ) : null}

          {/* Empresa / persona NO registradas (texto libre). NO entran en la nómina. */}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>🏢 Empresa NO registrada (opcional)</Text>
          <TextInput value={empresaLibre} onChangeText={(t) => setEmpresaLibre(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. CONSTRUCTORA EXTERNA…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>🧑 Persona que recibe NO registrada (opcional)</Text>
          <TextInput value={personaLibre} onChangeText={setPersonaLibre} placeholder="Nombre de quien recibe (no es empleado)" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>La empresa/persona no registrada solo salen en la nota; NO se agregan a la nómina.</Text>

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Destino / motivo (opcional)</Text>
          <TextInput value={destino} onChangeText={(t) => setDestino(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. OBRA CARABALLEDA, MANTENIMIENTO…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <TouchableOpacity onPress={generar} disabled={busy} style={{ marginTop: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Generando…' : '🧾 Generar nota de salida (PDF)'}</Text>
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
                <TouchableOpacity onPress={() => addToCart(it)} disabled={added} style={{ backgroundColor: added ? colors.surfaceAlt : colors.brand, borderWidth: added ? 1 : 0, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                  <Text style={{ color: added ? colors.muted : colors.brandContrast, fontWeight: '700', fontSize: 13 }}>{added ? '✓ Agregado' : '+ Agregar'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}


// ── Nota de traslado (entre máquinas: origen → destino) ──────────────────────
// Elige materiales del inventario y los TRASLADA de una máquina/empleado (origen)
// a otra máquina/empleado (destino). Al confirmar: genera el PDF, descuenta el
// stock (salida) y guarda el registro en inventory_transfers (casado con máquina
// y empleado de cada lado).
// Condición del material en el traslado / retorno.
const COND_MATERIAL = ['nuevo', 'usado', 'lleno', 'vacío', 'dañado'];

function TrasladoTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const toast = useToast();
  const uid = session?.user?.id ?? null;
  // Realtime desde AMBAS tablas: el stock cambia por inventory_movements y la carga/estado
  // se guardan en inventory_items → sin esta última, tildar carga/estado no llegaba a los otros equipos.
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: ['inventory_movements', 'inventory_items'] });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: transfers, refetch: refetchTr } = useTable<InventoryTransfer>('inventory_transfers', { orderBy: 'created_at', ascending: false });

  const [view, setView] = useState<'nuevo' | 'lista'>('nuevo'); // crear traslado | traslados realizados
  // Filtro de la lista: todos | retornados al inventario | sin retornar (aún en destino).
  const [trFilter, setTrFilter] = useState<'all' | 'returned' | 'pending'>('all');
  const transfersShown = useMemo(
    () => (trFilter === 'all' ? transfers : transfers.filter((t) => (trFilter === 'returned' ? !!t.returned : !t.returned))),
    [transfers, trFilter],
  );
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
  // Destino NO registrado (texto libre): empresa y/o persona que no están en el sistema.
  // NO se crean como empresa ni empleado, así que NO entran en la nómina.
  const [toEmpresaLibre, setToEmpresaLibre] = useState('');
  const [toPersonaLibre, setToPersonaLibre] = useState('');
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
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{icon} {label}: <Text style={{ color: valueId ? colors.brandText : colors.muted }}>{valueId ? valueText : 'elegir…'}</Text></Text>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>{isOpen ? '▲' : '▼'}</Text>
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
  // Snapshot con cédula/cargo del empleado REGISTRADO de cada lado (no aplica a toPersonaLibre).
  const empDetalleById = (id: string): { name: string; cedula: string | null; cargo: string | null } | null => {
    const e = employees.find((x) => (x as any).id === id);
    if (!e) return null;
    return { name: empName(e), cedula: (e as any)?.cedula ?? null, cargo: (e as any)?.cargo ?? null };
  };

  const generar = async () => {
    if (cart.length === 0) return toast.error('Agrega al menos un material al traslado.');
    if (!fromMachId && !fromEmpId) return toast.error('Indica el origen (máquina o empleado).');
    if (!toMachId && !toEmpId && !toEmpresaLibre.trim() && !toPersonaLibre.trim())
      return toast.error('Indica el destino: máquina, empleado, o una empresa/persona no registrada.');
    for (const c of cart) {
      if (c.qty <= 0) return toast.error(`Indica la cantidad de "${c.name}".`);
      if (c.qty > c.stock) return toast.error(`No hay suficiente stock de "${c.name}". Disponible: ${qtyFmt(c.stock)} ${c.unit}.`);
    }
    setBusy(true);
    // 1) VISTA PREVIA primero. Solo si el usuario imprime/guarda se descuenta y se registra.
    const items: TrasladoItem[] = cart.map((c) => ({ name: c.name, qty: c.qty, unit: c.unit }));
    let confirmado = false;
    try {
      confirmado = await exportPdf(notaTrasladoHtml({
        fecha: todayDMY(),
        empresa: toEmpresaLibre.trim() || null,
        fromMaquina: fromMachId ? machName(fromMachId) : null,
        fromEmpleado: fromEmpId ? empNameById(fromEmpId) : null,
        toMaquina: toMachId ? machName(toMachId) : null,
        toEmpleado: toEmpId ? empNameById(toEmpId) : (toPersonaLibre.trim() || null),
        fromEmpleadoDetalle: fromEmpId ? empDetalleById(fromEmpId) : undefined,
        toEmpleadoDetalle: toEmpId ? empDetalleById(toEmpId) : undefined,
        motivo: motivo.trim() || null,
        items,
      }), `Nota de traslado - ${todayDMY()}`);
    } catch (e: any) {
      setBusy(false);
      return toast.error('No se pudo generar el PDF: ' + (e?.message ?? e));
    }
    if (!confirmado) { setBusy(false); return; }
    // 2) CONFIRMADO: descuenta stock (salida) y guarda el encabezado del traslado.
    const destinoTxt = toMachId ? machName(toMachId) : toEmpId ? empNameById(toEmpId) : [toPersonaLibre.trim(), toEmpresaLibre.trim() ? `(${toEmpresaLibre.trim()})` : ''].filter(Boolean).join(' ') || '—';
    const detalle = `${fromMachId ? machName(fromMachId) : (fromEmpId ? empNameById(fromEmpId) : '—')} → ${destinoTxt}`;
    const rows = cart.map((c) => ({
      item_id: c.id, kind: 'salida' as const, qty: c.qty, unit_cost: c.avg_cost || null,
      reason: `NOTA DE TRASLADO · ${detalle}${motivo.trim().toUpperCase() ? ` · ${motivo.trim().toUpperCase()}` : ''}`,
      company_id: c.company_id, created_by: session?.user?.id ?? null,
    }));
    const { error: mErr } = await supabase.from('inventory_movements').insert(rows);
    if (mErr) { setBusy(false); return toast.error(mErr.message); }
    const transferPayload: Record<string, any> = {
      company_id: cart[0]?.company_id ?? null,
      from_machinery_id: fromMachId || null, from_machinery_label: fromMachId ? machName(fromMachId) : null,
      from_employee_id: fromEmpId || null, from_employee_name: fromEmpId ? empNameById(fromEmpId) : null,
      to_machinery_id: toMachId || null, to_machinery_label: toMachId ? machName(toMachId) : null,
      to_employee_id: toEmpId || null, to_employee_name: toEmpId ? empNameById(toEmpId) : (toPersonaLibre.trim() || null),
      motivo: motivo.trim() || null,
      lugar: lugar.trim().toUpperCase() || null,
      estado: estadoMat || null,
      items: cart.map((c) => ({ item_id: c.id, name: c.name, qty: c.qty, unit: c.unit })),
      descontado: true, created_by: session?.user?.id ?? null,
    };
    // Solo se manda to_company_name si hay empresa libre (así los traslados normales
    // no fallan si aún no corriste la migración de esa columna).
    if (toEmpresaLibre.trim()) transferPayload.to_company_name = toEmpresaLibre.trim();
    const { error: tErr } = await supabase.from('inventory_transfers').insert(transferPayload);
    if (tErr) { setBusy(false); return toast.error(tErr.message); }
    setBusy(false);
    setCart([]); setMotivo(''); setLugar(''); setEstadoMat(''); setFromMachId(''); setFromEmpId(''); setToMachId(''); setToEmpId(''); setToEmpresaLibre(''); setToPersonaLibre('');
    refetch(); refetchTr();
    toast.success('Traslado registrado. La salida se descontó del inventario.');
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
    if (rows.length === 0) return toast.error('Indica cuánto retorna al inventario (al menos un producto).');
    setReturnBusy(true);
    // Entradas de vuelta al stock (sin costo: no altera el PMP).
    const movs = rows.map((r) => ({
      item_id: r.item_id, kind: 'entrada' as const, qty: parseNum(r.qty), unit_cost: null,
      reason: `RETORNO DE TRASLADO${returnEstado ? ` · ${returnEstado.toUpperCase()}` : ''}`,
      company_id: returnFor.company_id, created_by: uid,
    }));
    const { error: mErr } = await supabase.from('inventory_movements').insert(movs);
    if (mErr) { setReturnBusy(false); return toast.error(mErr.message); }
    const resumen = `${returnEstado ? returnEstado.toUpperCase() + ' · ' : ''}` + rows.map((r) => `${r.name}: ${qtyFmt(parseNum(r.qty))} ${r.unit || ''}`).join(' · ');
    const { error: uErr } = await supabase.from('inventory_transfers').update({
      returned: true, returned_at: nowISO(), return_note: resumen, estado: returnEstado || returnFor.estado,
    }).eq('id', returnFor.id);
    if (uErr) { setReturnBusy(false); return toast.error(uErr.message); }
    setReturnBusy(false); setReturnFor(null); setReturnRows([]); setReturnEstado('');
    refetch(); refetchTr();
    toast.success('Retornado al inventario. Las entradas quedaron registradas.');
  };

  const trasladoLabel = (t: InventoryTransfer) => {
    const from = t.from_machinery_label || t.from_employee_name || '—';
    const to = t.to_machinery_label || t.to_employee_name || (t as any).to_company_name || '—';
    const empresa = (t as any).to_company_name && (t.to_machinery_label || t.to_employee_name) ? ` (${(t as any).to_company_name})` : '';
    return `${from} → ${to}${empresa}`;
  };

  // Reporte PDF de TODOS los traslados (con lugar, estado, ítems y si se retornaron).
  const reporteTraslados = async () => {
    if (transfers.length === 0) return toast.error('No hay traslados para el reporte.');
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
    const resumen = Array.from(byEstado.entries()).sort((a, b) => cmpText(a[0], b[0])).map(([est, g]) => `<tr>
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

  if (loading) return <Screen><SkeletonList /></Screen>;

  const recargar = () => { refetch(); refetchTr(); };

  return (
    <Screen onRefresh={recargar} refreshing={loading}>
      <ConfigBanner />
      <SectionTitle>Nota de traslado</SectionTitle>

      {/* Sub-vista: crear traslado | traslados realizados (para retornar). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
        {([['nuevo', '🔁 Trasladar'], ['lista', `📋 Realizados (${transfers.length})`]] as [typeof view, string][]).map(([k, l]) => {
          const on = view === k;
          return (
            <TouchableOpacity key={k} onPress={() => setView(k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{l}</Text>
            </TouchableOpacity>
          );
        })}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={reporteTraslados} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
          <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>📄 Reporte</Text>
        </TouchableOpacity>
      </View>

      {view === 'lista' ? (
        <>
        {/* Filtro: retornados / sin retornar al inventario */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          {([['all', `Todos (${transfers.length})`], ['pending', `📦 Sin retornar (${transfers.filter((t) => !t.returned).length})`], ['returned', `↩️ Retornados (${transfers.filter((t) => !!t.returned).length})`]] as [typeof trFilter, string][]).map(([k, l]) => {
            const on = trFilter === k;
            return (
              <TouchableOpacity key={k} onPress={() => setTrFilter(k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{l}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {transfersShown.length === 0 ? (
          <EmptyState title="Sin traslados" subtitle={trFilter === 'all' ? 'Los traslados que registres aparecerán aquí para poder retornarlos.' : 'No hay traslados en este filtro.'} />
        ) : transfersShown.map((t) => (
          <ExpandableCard
            key={t.id}
            summary={
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 13, color: colors.text }} numberOfLines={1}>{trasladoLabel(t)}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{fmtDate(t.created_at)}{t.lugar ? ` · 📍 ${t.lugar}` : ''}{t.estado ? ` · ${t.estado.toUpperCase()}` : ''}</Text>
                </View>
                <Pill label={t.returned ? '↩️ Retornado' : '📦 En destino'} color={t.returned ? colors.success : colors.warning} />
              </View>
            }
            detail={
              <View>
                {(t.items ?? []).map((it, i) => (
                  <Text key={i} style={{ color: colors.text, fontSize: 13 }}>• {it.name}: {qtyFmt(it.qty)} {it.unit || ''}</Text>
                ))}
                {t.motivo ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Motivo: {t.motivo}</Text> : null}
                {t.returned ? (
                  <Text style={{ color: colors.success, fontSize: 12, marginTop: spacing.xs }}>Retornado{t.returned_at ? ` · ${fmtDate(t.returned_at)}` : ''}{t.return_note ? ` · ${t.return_note}` : ''}</Text>
                ) : canWrite ? (
                  <TouchableOpacity onPress={() => abrirRetorno(t)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>↩️ Retornar al inventario</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            }
          />
        ))}
        </>
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
          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12, marginTop: spacing.md, letterSpacing: 0.5 }}>ORIGEN (de dónde sale)</Text>
          <Selector id="fromMach" icon="🚜" label="Máquina origen" valueId={fromMachId} valueText={machName(fromMachId)} onPick={setFromMachId} options={machOptions} />
          <Selector id="fromEmp" icon="👷" label="Responsable origen" valueId={fromEmpId} valueText={empNameById(fromEmpId)} onPick={setFromEmpId} options={empOptions} />

          {/* DESTINO */}
          <Text style={{ color: colors.success, fontWeight: '800', fontSize: 12, marginTop: spacing.md, letterSpacing: 0.5 }}>DESTINO (a dónde va)</Text>
          <Selector id="toMach" icon="🚜" label="Máquina destino" valueId={toMachId} valueText={machName(toMachId)} onPick={setToMachId} options={machOptions} />
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>➕ Agregar responsable destino (opcional): la persona que RECIBE en el destino.</Text>
          <Selector id="toEmp" icon="👷" label="Responsable destino" valueId={toEmpId} valueText={empNameById(toEmpId)} onPick={setToEmpId} options={empOptions} />

          {/* Destino NO registrado (texto libre): empresa/persona fuera del sistema. NO entra en nómina. */}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>🏢 Empresa destino NO registrada (opcional)</Text>
          <TextInput value={toEmpresaLibre} onChangeText={(t) => setToEmpresaLibre(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. CONSTRUCTORA EXTERNA…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>🧑 Persona que recibe NO registrada (opcional)</Text>
          <TextInput value={toPersonaLibre} onChangeText={setToPersonaLibre} placeholder="Nombre de quien recibe (no es empleado)" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>La empresa/persona no registrada solo salen en la nota y el registro; NO se agregan a la nómina.</Text>

          {/* LUGAR y ESTADO del material trasladado */}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md, marginBottom: 4 }}>Lugar / obra a donde se hace el traslado (opcional)</Text>
          <TextInput value={lugar} onChangeText={(t) => setLugar(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. OBRA GUAIRA, TALLER CENTRAL…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Estado del material</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {COND_MATERIAL.map((e) => {
              const on = estadoMat === e;
              return (
                <TouchableOpacity key={e} onPress={() => setEstadoMat(on ? '' : e)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }}>{e}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md, marginBottom: 4 }}>Motivo (opcional)</Text>
          <TextInput value={motivo} onChangeText={(t) => setMotivo(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. REASIGNACIÓN, PRÉSTAMO DE HERRAMIENTA…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <TouchableOpacity onPress={generar} disabled={busy} style={{ marginTop: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Generando…' : '🔁 Generar traslado (PDF)'}</Text>
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
                <TouchableOpacity onPress={() => addToCart(it)} disabled={added} style={{ backgroundColor: added ? colors.surfaceAlt : colors.brand, borderWidth: added ? 1 : 0, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                  <Text style={{ color: added ? colors.muted : colors.brandContrast, fontWeight: '700', fontSize: 13 }}>{added ? '✓ Agregado' : '+ Agregar'}</Text>
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
                    <TouchableOpacity key={e} onPress={() => setReturnEstado(on ? '' : e)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }}>{e}</Text>
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
              <TouchableOpacity onPress={retornar} disabled={returnBusy} style={{ flex: 2, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: returnBusy ? 0.6 : 1 }}><Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{returnBusy ? 'Retornando…' : '↩️ Confirmar retorno'}</Text></TouchableOpacity>
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
  const toast = useToast();
  const { data: movs, loading, refetch } = useTable<InventoryMovement>('inventory_movements', { orderBy: 'created_at', ascending: false, realtimeFrom: 'inventory_movements' });
  const { data: items, refetch: refetchItems } = useTable<InventoryItem>('inventory_items', { orderBy: 'name' });

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
    return [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => cmpText(a.key, b.key));
  }, [movs, items, periodo]);

  const periodoLabel = PERIODOS.find((p) => p.key === periodo)?.label ?? 'Todo';

  const reporte = async () => {
    if (gastos.length === 0) return toast.error('No hay gastos en el período seleccionado.');
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

  if (loading) return <Screen><SkeletonList /></Screen>;

  const recargar = () => { refetch(); refetchItems(); };

  return (
    <Screen onRefresh={recargar} refreshing={loading}>
      <ConfigBanner />
      <SectionTitle>Gastos de inventario</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Cada material que sale del almacén (nota de salida o traslado) es un gasto, valorizado al PMP.</Text>

      {/* Período */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {PERIODOS.map((p) => {
          const on = periodo === p.key;
          return (
            <TouchableOpacity key={p.key} onPress={() => setPeriodo(p.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Total gastado */}
      <View style={{ borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.dangerSoftBg, marginBottom: spacing.sm }}>
        <Text style={{ color: colors.dangerSoftText, opacity: 0.9, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>TOTAL GASTADO · {periodoLabel.toUpperCase()}</Text>
        <Text style={{ color: colors.dangerSoftText, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(total)}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{gastos.length} salida(s) de material</Text>
      </View>

      <TouchableOpacity onPress={reporte} style={{ marginBottom: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
        <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 13 }}>📄 Reporte de gastos (PDF)</Text>
      </TouchableOpacity>

      {/* Resumen por categoría */}
      {porCategoria.length ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>Por categoría</Text>
          {porCategoria.map((c) => {
            const on = cat === c.key;
            return (
              <TouchableOpacity key={c.key} onPress={() => setCat(on ? '' : c.key)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: on ? colors.brandText : colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{catInfo(c.key).icon} {catInfo(c.key).label}{on ? ' ✓' : ''}</Text>
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
                <Text style={{ color: colors.danger, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(valorDe(m))}</Text>
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

// ── Dotación: historial de entregas por empleado (equipos, herramientas, calzado,
//    franelas, uniforme y demás artículos), combinando salidas de inventario con
//    empleado(s) asignados y las entregas de uniforme (camisas/pantalones/zapatos). ──
type DotacionRow = {
  key: string;
  date: string;               // fecha/hora ISO del movimiento o la entrega
  employeeId: string;
  employeeName: string;
  employeeCedula: string | null;
  employeeCargo: string | null;
  tipo: string;                // clave de categoría del producto, o 'uniforme'
  tipoLabel: string;
  tipoIcon: string;
  detalle: string;
  origen: 'inventario' | 'uniforme';
};

function DotacionTab() {
  const { colors } = useTheme();
  const toast = useToast();
  const { data: movs, loading: loadingMovs, refetch: refetchMovs } = useTable<InventoryMovement>('inventory_movements', { orderBy: 'created_at', ascending: false, realtimeFrom: 'inventory_movements' });
  const { data: items } = useTable<InventoryItem>('inventory_items', { orderBy: 'name' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: uniformes, loading: loadingUni, refetch: refetchUni } = useTable<UniformDelivery>('uniform_deliveries', { orderBy: 'delivered_at', ascending: false, realtimeFrom: 'uniform_deliveries' });
  const loading = loadingMovs || loadingUni;

  const empName = (e: Employee) => `${(e as any).first_name ?? ''} ${(e as any).last_name ?? ''}`.trim() || 'Sin nombre';
  const employeeById = useMemo(() => { const m = new Map<string, Employee>(); employees.forEach((e) => m.set((e as any).id, e)); return m; }, [employees]);
  const itemById = useMemo(() => { const m = new Map<string, InventoryItem>(); items.forEach((it) => m.set(it.id, it)); return m; }, [items]);

  // Combina AMBAS fuentes en un solo historial normalizado. Una salida grupal (varios
  // employee_ids en un mismo movimiento) genera UNA fila POR CADA empleado, así el
  // filtro "por empleado" funciona bien (no una fila con varios nombres pegados).
  const rows: DotacionRow[] = useMemo(() => {
    const out: DotacionRow[] = [];
    movs.forEach((m) => {
      if (m.kind !== 'salida') return;
      const ids = m.employee_ids ?? [];
      if (!ids.length) return;
      const it = itemById.get(m.item_id);
      const info = catInfo(it?.category ?? null);
      const detalle = `${it?.name ?? 'Producto'} · ${qtyFmt(m.qty)} ${it?.unit ?? ''}`.trim();
      ids.forEach((empId) => {
        // Preferimos el snapshot guardado en el movimiento (nombre/cédula/cargo AL
        // MOMENTO de la salida); si viene vacío (movimientos anteriores a esta
        // migración), caemos a los datos ACTUALES del empleado.
        const snap = (m.employees_detail ?? []).find((e) => e.id === empId);
        const emp = employeeById.get(empId);
        out.push({
          key: `inv-${m.id}-${empId}`,
          date: m.created_at,
          employeeId: empId,
          employeeName: snap?.name || (emp ? empName(emp) : 'Empleado'),
          employeeCedula: (snap?.cedula ?? (emp as any)?.cedula) ?? null,
          employeeCargo: (snap?.cargo ?? (emp as any)?.cargo) ?? null,
          tipo: info.key,
          tipoLabel: info.label,
          tipoIcon: info.icon,
          detalle,
          origen: 'inventario',
        });
      });
    });
    uniformes.forEach((u) => {
      const camisas = Number(u.camisas) || 0, pantalones = Number(u.pantalones) || 0, zapatos = Number(u.zapatos) || 0;
      if (camisas <= 0 && pantalones <= 0 && zapatos <= 0) return;
      const emp = employeeById.get(u.employee_id);
      const partes: string[] = [];
      if (camisas > 0) partes.push(`${qtyFmt(camisas)} camisa(s)`);
      if (pantalones > 0) partes.push(`${qtyFmt(pantalones)} pantalón(es)`);
      if (zapatos > 0) partes.push(`${qtyFmt(zapatos)} par(es) de zapatos`);
      out.push({
        key: `uni-${u.id}`,
        date: u.delivered_at,
        employeeId: u.employee_id,
        employeeName: emp ? empName(emp) : 'Empleado',
        employeeCedula: (emp as any)?.cedula ?? null,
        employeeCargo: (emp as any)?.cargo ?? null,
        tipo: 'uniforme',
        tipoLabel: 'Uniforme',
        tipoIcon: '🦺',
        detalle: partes.join(' · ') || '—',
        origen: 'uniforme',
      });
    });
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [movs, items, employeeById, itemById, uniformes]);

  // Opciones de tipo/categoría presentes en los datos combinados (+ "Uniforme", ya fijo).
  const tipoOptions = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; icon: string }>();
    rows.forEach((r) => { if (!seen.has(r.tipo)) seen.set(r.tipo, { key: r.tipo, label: r.tipoLabel, icon: r.tipoIcon }); });
    return Array.from(seen.values());
  }, [rows]);

  // ── Filtros ────────────────────────────────────────────────────────────────
  const [empFilterId, setEmpFilterId] = useState('');
  const [empOpen, setEmpOpen] = useState(false);
  const [empQuery, setEmpQuery] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [tipoFilter, setTipoFilter] = useState('');
  const [origenFilter, setOrigenFilter] = useState<'' | 'inventario' | 'uniforme'>('');

  const empFilterName = empFilterId ? (employeeById.get(empFilterId) ? empName(employeeById.get(empFilterId)!) : '') : '';

  const shown = useMemo(() => rows.filter((r) => {
    if (empFilterId && r.employeeId !== empFilterId) return false;
    const d = String(r.date).slice(0, 10); // AAAA-MM-DD
    if (fFrom && d < fFrom) return false;
    if (fTo && d > fTo) return false;
    if (tipoFilter && r.tipo !== tipoFilter) return false;
    if (origenFilter && r.origen !== origenFilter) return false;
    return true;
  }), [rows, empFilterId, fFrom, fTo, tipoFilter, origenFilter]);
  const hayFiltro = !!(empFilterId || fFrom || fTo || tipoFilter || origenFilter);

  const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const hoyDmy = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

  // ── Reporte PDF de las entregas mostradas (respeta los filtros activos) ─────
  const reporteDotacion = async () => {
    if (shown.length === 0) return toast.error('No hay entregas para el reporte.');
    const sorted = [...shown].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const rowsHtml = sorted.map((r, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(fmtDate(r.date))}</td>
        <td>${esc(r.employeeName)}</td>
        <td>${esc(r.employeeCedula || '—')}</td>
        <td>${esc(r.employeeCargo || '—')}</td>
        <td>${esc(r.tipoIcon)} ${esc(r.tipoLabel)}</td>
        <td>${esc(r.detalle)}</td>
      </tr>`).join('');
    const html = pdfDocument({
      title: 'Reporte de dotación',
      subtitle: `${shown.length} entrega(s) · ${esc(hoyDmy())}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left} th{background:#16324F;color:#fff}
        td.c{text-align:center} tr:nth-child(even) td{background:#f4f7fb}`,
      body: `
        <table>
          <thead><tr><th style="width:30px" class="c">#</th><th style="width:120px">Fecha</th><th>Empleado</th><th>Cédula</th><th>Cargo</th><th>Tipo</th><th>Detalle</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`,
    });
    await exportPdf(html, `Reporte de dotación - ${hoyDmy()}`);
  };

  if (loading) return <Screen><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={() => { refetchMovs(); refetchUni(); }} refreshing={loading}>
      <ConfigBanner />
      <SectionTitle>Dotación (historial de entregas)</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
        Historial de equipos, herramientas, calzado, franelas y demás artículos entregados a cada trabajador (salidas de inventario con empleado asignado + entregas de uniforme).
      </Text>

      {/* Empleado: selector ÚNICO (para filtrar), filtrable por nombre. */}
      <TouchableOpacity onPress={() => setEmpOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>👷 Empleado: <Text style={{ color: empFilterId ? colors.primary : colors.muted }}>{empFilterId ? (empFilterName || 'Empleado') : 'Todos'}</Text></Text>
        <Text style={{ color: colors.primary, fontWeight: '800' }}>{empOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {empOpen ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <TextInput value={empQuery} onChangeText={setEmpQuery} placeholder="Filtrar por nombre…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 6 }} />
          <TouchableOpacity onPress={() => { setEmpFilterId(''); setEmpOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 15 }}>{!empFilterId ? '🔘' : '⚪'}</Text>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>Todos</Text>
          </TouchableOpacity>
          <View style={{ maxHeight: 220 }}>
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {employees.filter((e) => { const s = norm(empQuery); return !s || norm(empName(e)).includes(s); }).map((e) => {
                const on = empFilterId === (e as any).id;
                return (
                  <TouchableOpacity key={(e as any).id} onPress={() => { setEmpFilterId((e as any).id); setEmpOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ fontSize: 15 }}>{on ? '🔘' : '⚪'}</Text>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{empName(e)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {/* Fecha: rango Desde/Hasta */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
          <DateField value={fFrom} onChange={(v) => setFFrom(v || '')} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
          <DateField value={fTo} onChange={(v) => setFTo(v || '')} />
        </View>
        {hayFiltro ? (
          <TouchableOpacity onPress={() => { setEmpFilterId(''); setEmpQuery(''); setFFrom(''); setFTo(''); setTipoFilter(''); setOrigenFilter(''); }} style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>✕ Limpiar</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Tipo / categoría del producto (o "Uniforme") */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {[{ key: '', label: 'Todos', icon: '' }, ...tipoOptions].map((t) => {
          const on = tipoFilter === t.key;
          return (
            <TouchableOpacity key={t.key || 'all'} onPress={() => setTipoFilter(t.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{t.icon ? `${t.icon} ` : ''}{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* "Estatus" de la entrega: estas son salidas YA CONFIRMADAS (el stock/uniforme ya
          se descontó/registró al generarse), no existe un estado pendiente/aprobado como en
          los requerimientos de compra — por eso el filtro de estatus se mapea al ORIGEN. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {[{ k: '' as const, l: 'Todos' }, { k: 'inventario' as const, l: '📦 Inventario' }, { k: 'uniforme' as const, l: '🦺 Dotación/Uniforme' }].map((f) => {
          const on = origenFilter === f.k;
          return (
            <TouchableOpacity key={f.k || 'all'} onPress={() => setOrigenFilter(f.k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {shown.length ? (
        <TouchableOpacity onPress={reporteDotacion} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>🧾 Reporte de dotación ({shown.length})</Text>
        </TouchableOpacity>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState title="Sin entregas" subtitle="Las entregas de equipos, herramientas, calzado, franelas y uniformes aparecerán aquí." />
      ) : shown.map((r) => (
        <ExpandableCard
          key={r.key}
          summary={
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{r.employeeName}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDate(r.date)}</Text>
                <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={2}>{r.tipoIcon} {r.tipoLabel} · {r.detalle}</Text>
              </View>
              <Pill label={r.origen === 'uniforme' ? '🦺 Uniforme' : '📦 Inventario'} color={r.origen === 'uniforme' ? '#EA580C' : '#2563EB'} />
            </View>
          }
          detail={
            <>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Cédula: {r.employeeCedula || '—'}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Cargo: {r.employeeCargo || '—'}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Origen: {r.origen === 'uniforme' ? 'Dotación / uniforme' : 'Inventario'}</Text>
            </>
          }
        />
      ))}
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
    { key: 'movimientos', label: 'Movimientos', icon: '🔄' },
    { key: 'dotacion', label: 'Dotación', icon: '👷' },
  ];
  const [active, setActive] = useState('existencias');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm }}>
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <TouchableOpacity key={t.key} onPress={() => setActive(t.key)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}>
                <Text style={{ fontSize: 15 }}>{t.icon}</Text>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>
        {active === 'existencias' ? <ExistenciasTab canWrite={canWrite} /> : active === 'nota' ? <NotaTab canWrite={canWrite} /> : active === 'traslado' ? <TrasladoTab canWrite={canWrite} /> : active === 'gastos' ? <GastosTab /> : active === 'movimientos' ? <MovimientosTab /> : <DotacionTab />}
      </View>
    </View>
  );
}
