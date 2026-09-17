import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal } from 'react-native';
import { Screen, Card, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import QrScanner from '../components/QrScanner';
import { parseEmployeeId } from './ScanQrScreen';
import {
  COMPANY_MEALS, mealLabel, suggestedMeals, countCompanyMachines,
  listForCompanyDay, saveCompanyMeal, deleteCompanyMeal, isCookCargo,
  listForCompanyBetween, listExtraItems, saveExtraItem, FoodExtraItem,
} from '../lib/foodCompanyMeals';
import { FoodCompanyMeal, MealType } from '../types/database';
import { norm } from '../lib/text';
import { useBcvRate, fmtUsd, fmtBs, bsFromUsd } from '../lib/bcv';
import { exportPdf } from '../lib/pdf';
import { LOGO_DATA_URI } from '../lib/logoData';
import { COMPANY_NAME } from '../lib/company';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
function caracasNiceDate(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(iso + 'T12:00:00'));
}
const parseDec = (t: string) => Math.max(0, parseFloat(String(t ?? '').replace(',', '.')) || 0);

/**
 * Distribución de comida POR EMPRESA. Se abre al escanear el QR de una empresa
 * (?comida=<id>). El personal de COCINA se verifica con su carnet (cargo de
 * cocina/alimentación) y registra cuántos platos entregó en cada tiempo
 * (desayuno / almuerzo / lunch / cena / otros).
 *
 * 17-sep-2026: se puede registrar VARIAS veces por comida en el día (se SUMAN);
 * ya no hay tope por máquinas. Cada renglón lleva su COSTO POR PLATO en $, que se
 * muestra también en Bs a la tasa del BCV. "Otros" son platos extra con nombre.
 */
export default function FoodCompanyScreen({ companyId, onExit }: { companyId: string; onExit?: () => void }) {
  const { colors } = useTheme();
  const { session, role } = useAuth();
  const uid = session?.user?.id ?? '';
  const canSeeReport = role === 'admin' || role === 'supervisor' || role === 'cocina';
  const isAnon = !!(session?.user as any)?.is_anonymous;
  const authorId = isAnon ? null : (uid || null);
  const today = caracasToday();
  const { rate, source: rateSource } = useBcvRate();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [machines, setMachines] = useState(0);
  const [meals, setMeals] = useState<FoodCompanyMeal[]>([]);
  const [extraItems, setExtraItems] = useState<FoodExtraItem[]>([]);
  const [cook, setCook] = useState<{ name: string; cargo: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [cookCedula, setCookCedula] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Modal de distribución
  const [mealFor, setMealFor] = useState<MealType | null>(null);
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // Reporte por empresa (PDF)
  const [pdfBusy, setPdfBusy] = useState(false);
  const [reportDays, setReportDays] = useState(30);

  const suggested = suggestedMeals(machines);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, cnt, todays, extras] = await Promise.all([
      supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
      countCompanyMachines(companyId),
      listForCompanyDay(companyId, today),
      listExtraItems(),
    ]);
    setCompanyName((c as any)?.name ?? 'Empresa');
    setMachines(cnt);
    setMeals(todays);
    setExtraItems(extras);
    setLoading(false);
  }, [companyId, today]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { try { await supabase.auth.signInAnonymously(); } catch {} }
      if (active) load();
    })();
    return () => { active = false; };
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  useRealtimeRefresh(['companies', 'machinery', 'food_company_meals'], () => { load(); });

  // ── Verificación del cocinero por su carnet/cédula ────────────────────────────
  const verifyByEmployee = (emp: any): boolean => {
    const cargo = emp?.cargo ?? '';
    const name = `${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim() || 'Sin nombre';
    if (!isCookCargo(cargo)) {
      setCook(null);
      setNotice(`❌ ${name}${cargo ? ` (${cargo})` : ''} no tiene cargo de cocina/alimentación: no puede ingresar cantidades.`);
      return false;
    }
    setCook({ name, cargo });
    setNotice(`✅ Verificado: ${name} — ${cargo}. Ya puedes registrar las comidas.`);
    return true;
  };
  const verifyCook = async (employeeId: string) => {
    setScanOpen(false); setVerifying(true); setNotice(null);
    const { data } = await supabase.from('employees').select('first_name, last_name, cargo').eq('id', employeeId).maybeSingle();
    setVerifying(false);
    if (!data) { setNotice('❌ Ese carnet no corresponde a una persona registrada.'); return; }
    verifyByEmployee(data);
  };
  const verifyCookByCedula = async () => {
    const ci = cookCedula.trim();
    if (ci.length < 5) { setNotice('❌ Escribe tu cédula completa.'); return; }
    setVerifying(true); setNotice(null);
    const { data } = await supabase.from('employees').select('first_name, last_name, cargo').eq('cedula', ci).limit(1);
    setVerifying(false);
    const emp = data && data[0];
    if (!emp) { setNotice('❌ No hay ninguna persona con esa cédula.'); return; }
    if (verifyByEmployee(emp)) setCookCedula('');
  };

  // ── Acumulado del día por comida ──────────────────────────────────────────────
  const rowsOf = (mt: MealType) => meals.filter((r) => r.meal_type === mt);
  const platosOf = (mt: MealType) => rowsOf(mt).reduce((a, r) => a + (Number(r.delivered) || 0), 0);
  const usdOf = (mt: MealType) => rowsOf(mt).reduce((a, r) => a + (Number(r.delivered) || 0) * (Number(r.unit_cost) || 0), 0);
  const totalPlatos = meals.reduce((a, r) => a + (Number(r.delivered) || 0), 0);
  const totalUsd = meals.reduce((a, r) => a + (Number(r.delivered) || 0) * (Number(r.unit_cost) || 0), 0);

  const openMeal = (mt: MealType) => {
    if (!cook) { setNotice('❌ Primero verifícate escaneando tu carnet de cocina.'); return; }
    // Reusa el último costo cargado de esa comida hoy (para no reescribirlo cada vez).
    const last = rowsOf(mt)[rowsOf(mt).length - 1];
    setMealFor(mt);
    setQty('');
    setUnitCost(last ? String(Number(last.unit_cost) || 0) : '');
    setItemLabel('');
    setNote('');
    setNotice(null);
  };

  const q = Math.max(0, parseInt(qty || '0', 10) || 0);
  const uc = parseDec(unitCost);
  const totUsd = q * uc;
  const totBs = bsFromUsd(totUsd, rate || 0);

  const registrar = async () => {
    if (!mealFor || !cook) return;
    if (q <= 0) { setNotice('❌ Escribe cuántos platos entregaste.'); return; }
    setSaving(true); setNotice(null);
    const { data, error } = await saveCompanyMeal({
      companyId, companyName, mealType: mealFor, mealDate: today,
      machines, suggested, delivered: q, unitCost: uc,
      itemLabel: mealFor === 'otros' ? itemLabel : null, note,
      createdBy: authorId, createdByName: cook.name, createdByCargo: cook.cargo,
    });
    setSaving(false);
    if (error || !data) { setNotice('❌ ' + (error ?? 'No se pudo registrar.')); if (error) load(); return; }
    // Guarda el nombre del plato OTROS en el catálogo (se elige de la lista luego).
    if (mealFor === 'otros' && itemLabel.trim()) {
      const yaEsta = extraItems.some((e) => norm(e.name) === norm(itemLabel));
      if (!yaEsta) { await saveExtraItem(itemLabel); listExtraItems().then(setExtraItems); }
    }
    setMeals((prev) => [...prev, data]);
    setMealFor(null);
    setNotice(`✅ ${mealLabel(mealFor)}${mealFor === 'otros' && itemLabel.trim() ? ` (${itemLabel.trim()})` : ''}: +${q} plato(s)${uc > 0 ? ` · ${fmtUsd(totUsd)}` : ''} para ${companyName}.`);
  };

  // Elegir un plato OTROS del catálogo: fija el nombre y reusa su último costo de hoy.
  const selectExtra = (name: string) => {
    setItemLabel(name);
    const last = [...meals].reverse().find((r) => r.meal_type === 'otros' && norm(r.item_label ?? '') === norm(name));
    if (last) setUnitCost(String(Number(last.unit_cost) || 0));
  };

  const borrar = async (id: string) => {
    const { error } = await deleteCompanyMeal(id);
    if (error) { setNotice('❌ ' + error); return; }
    setMeals((prev) => prev.filter((r) => r.id !== id));
    setNotice('✅ Entrega borrada.');
  };

  // ── Reporte PDF de las entregas de ESTA empresa (últimos N días) ──────────────
  const daysAgoISO = (iso: string, n: number) => {
    const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
  };
  const dmy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const verReporte = async () => {
    setPdfBusy(true); setNotice(null);
    try {
      const from = daysAgoISO(today, Math.max(0, reportDays - 1));
      const rows = await listForCompanyBetween(companyId, from, today);
      const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
      // Suma por día × comida (platos y $), porque ahora hay varias entregas por comida.
      const byDay = new Map<string, Map<MealType, { platos: number; usd: number }>>();
      rows.forEach((r) => {
        if (!byDay.has(r.meal_date)) byDay.set(r.meal_date, new Map());
        const m = byDay.get(r.meal_date)!;
        const cur = m.get(r.meal_type) || { platos: 0, usd: 0 };
        cur.platos += Number(r.delivered) || 0;
        cur.usd += (Number(r.delivered) || 0) * (Number(r.unit_cost) || 0);
        m.set(r.meal_type, cur);
      });
      const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a));
      const totals: Record<string, number> = Object.fromEntries(COMPANY_MEALS.map((m) => [m.key, 0]));
      let grandUsd = 0;
      const bodyRows = days.map((d) => {
        const g = byDay.get(d)!;
        let tot = 0; let usdDay = 0;
        COMPANY_MEALS.forEach((m) => { const v = g.get(m.key)?.platos || 0; tot += v; totals[m.key] += v; usdDay += g.get(m.key)?.usd || 0; });
        grandUsd += usdDay;
        return `<tr><td class="l">${esc(dmy(d))}</td>${COMPANY_MEALS.map((m) => `<td>${g.get(m.key)?.platos || '—'}</td>`).join('')}<td class="b">${tot}</td><td class="b">${esc(fmtUsd(usdDay))}</td></tr>`;
      }).join('');
      const grand = COMPANY_MEALS.reduce((a, m) => a + totals[m.key], 0);
      const bsLine = (rate && rate > 0) ? ` · ${esc(fmtBs(grandUsd * rate))}` : '';
      const totalRow = `<tr class="tot"><td class="l">TOTAL</td>${COMPANY_MEALS.map((m) => `<td>${totals[m.key]}</td>`).join('')}<td class="b">${grand}</td><td class="b">${esc(fmtUsd(grandUsd))}</td></tr>`;
      // Detalle de OTROS por NOMBRE de plato (bolsa de hielo, refresco…).
      const otrosMap = new Map<string, { platos: number; usd: number }>();
      rows.filter((r) => r.meal_type === 'otros').forEach((r) => {
        const k = (r.item_label && r.item_label.trim()) || 'Otros';
        const cur = otrosMap.get(k) || { platos: 0, usd: 0 };
        cur.platos += Number(r.delivered) || 0;
        cur.usd += (Number(r.delivered) || 0) * (Number(r.unit_cost) || 0);
        otrosMap.set(k, cur);
      });
      const otrosNames = [...otrosMap.keys()].sort((a, b) => a.localeCompare(b, 'es'));
      const otrosHtml = otrosNames.length ? `
        <div class="sect">🧾 Detalle de "Otros" por plato</div>
        <table>
          <thead><tr><th class="l">Plato</th><th>Platos</th><th>Costo $</th></tr></thead>
          <tbody>${otrosNames.map((n) => `<tr><td class="l">${esc(n)}</td><td>${otrosMap.get(n)!.platos}</td><td class="b">${esc(fmtUsd(otrosMap.get(n)!.usd))}</td></tr>`).join('')}</tbody>
        </table>` : '';
      const html = `
        <style>
          *{font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
          .head{display:flex;align-items:center;gap:12px;border-bottom:2px solid #16324F;padding-bottom:8px;margin-bottom:12px}
          .head img{height:52px;width:auto} h1{font-size:18px;margin:0} .sub{color:#555;font-size:12px;margin-top:2px}
          table{border-collapse:collapse;width:100%;font-size:12px}
          th,td{border:1px solid #ccc;padding:6px 8px;text-align:center}
          th{background:#16324F;color:#fff} td.l{text-align:left} td.b{font-weight:800}
          tr.tot td{background:#EAF1FB;font-weight:800}
          .sect{margin:16px 0 6px;font-size:13px;font-weight:800;color:#16324F}
          .money{margin-top:10px;font-size:13px;font-weight:800;color:#16324F}
          .foot{margin-top:16px;color:#9aa4b2;font-size:10px;text-align:center;border-top:1px solid #e5e7eb;padding-top:6px}
        </style>
        <div class="head"><img src="${LOGO_DATA_URI}"/><div><h1>🍽️ Reporte de comida por empresa</h1><div class="sub">${esc(companyName)} · ${esc(dmy(from))} a ${esc(dmy(today))} · ${days.length} día(s)</div></div></div>
        <table>
          <thead><tr><th class="l">Fecha</th>${COMPANY_MEALS.map((m) => `<th>${esc(m.label)}</th>`).join('')}<th>Platos</th><th>Costo $</th></tr></thead>
          <tbody>${bodyRows || `<tr><td colspan="${COMPANY_MEALS.length + 3}">Sin registros en el período.</td></tr>`}${days.length ? totalRow : ''}</tbody>
        </table>
        ${otrosHtml}
        <div class="money">Costo total del período: ${esc(fmtUsd(grandUsd))}${bsLine}${(rate && rate > 0) ? ` (tasa BCV Bs ${rate}/$)` : ''}</div>
        <div class="foot">${esc(COMPANY_NAME)} · Distribución de comida</div>`;
      await exportPdf(html, `Comida - ${companyName} (${from} a ${today})`);
    } catch (e: any) {
      setNotice('❌ No se pudo generar el reporte: ' + (e?.message ?? e));
    } finally {
      setPdfBusy(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  const modalMeal = COMPANY_MEALS.find((m) => m.key === mealFor);
  const todayEntries = [...meals].sort((a, b) => String(b.delivered_at ?? '').localeCompare(String(a.delivered_at ?? '')));

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>🍽️ Distribución de comida</Text>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '900' }}>🏢 {companyName}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, textTransform: 'capitalize' }}>{caracasNiceDate(today)}</Text>
        </View>
        {onExit ? (
          <TouchableOpacity onPress={onExit} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Salir</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Resumen del día: platos totales y costo (con conversión Bs) */}
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900' }}>{totalPlatos}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>Platos hoy</Text>
          </View>
          <View style={{ flex: 2, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: colors.border }}>
            <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '900' }}>{fmtUsd(totalUsd)}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>
              Costo hoy{rate && rate > 0 ? ` · ${fmtBs(bsFromUsd(totalUsd, rate))}` : ''}
            </Text>
          </View>
        </View>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs, textAlign: 'center' }}>
          {machines} máquina(s) · sugerido de referencia {suggested} · {rate && rate > 0 ? `tasa BCV Bs ${rate}/$ ${rateSource === 'manual' ? '(manual)' : ''}` : 'sin tasa BCV'}
        </Text>
      </Card>

      {!cook ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🔒 Verifícate para registrar</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            Solo el personal de cocina/alimentación puede ingresar cantidades. Escanea TU carnet.
          </Text>
          <TouchableOpacity onPress={() => setScanOpen(true)} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear mi carnet</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>¿No lee el carnet? Verifícate por cédula:</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
            <TextInput value={cookCedula} onChangeText={(t) => setCookCedula(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Tu cédula" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
            <TouchableOpacity onPress={verifyCookByCedula} disabled={verifying} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{verifying ? '…' : 'Verificar'}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.success, fontWeight: '800', fontSize: 14 }}>👨‍🍳 {cook.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>{cook.cargo} · autorizado para repartir</Text>
            </View>
            <TouchableOpacity onPress={() => { setCook(null); setNotice(null); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cambiar</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : notice.startsWith('ℹ️') ? colors.text : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {/* Botones por comida: desayuno / almuerzo / lunch / cena / otros.
          Se pueden tocar VARIAS veces al día: cada registro SUMA platos y costo. */}
      {COMPANY_MEALS.map((mt) => {
        const platos = platosOf(mt.key);
        const usd = usdOf(mt.key);
        const n = rowsOf(mt.key).length;
        return (
          <TouchableOpacity
            key={mt.key}
            activeOpacity={0.85}
            onPress={() => openMeal(mt.key)}
            style={{
              borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.xs,
              backgroundColor: mt.color, opacity: !cook ? 0.7 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 22 }}>{mt.icon} {mt.label}</Text>
              {platos > 0 ? (
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>{platos} plato(s){usd > 0 ? ` · ${fmtUsd(usd)}` : ''}</Text>
              ) : (
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{cook ? '+ Agregar ›' : '🔒'}</Text>
              )}
            </View>
            <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, opacity: 0.9 }}>
              {platos > 0 ? `${n} entrega(s) hoy · toca para sumar más` : (cook ? 'Toca para registrar los platos que surtiste' : 'Verifícate para registrar')}
            </Text>
          </TouchableOpacity>
        );
      })}

      {/* Entregas de hoy (con borrar por si se registró de más) */}
      {todayEntries.length > 0 ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>🧾 Entregas de hoy</Text>
          {todayEntries.map((r) => {
            const lineUsd = (Number(r.delivered) || 0) * (Number(r.unit_cost) || 0);
            return (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                    {mealLabel(r.meal_type)}{r.item_label ? ` · ${r.item_label}` : ''} · {r.delivered} plato(s)
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {lineUsd > 0 ? `${fmtUsd(lineUsd)}${rate && rate > 0 ? ` · ${fmtBs(bsFromUsd(lineUsd, rate))}` : ''} · ` : ''}{caracasClock(r.delivered_at)}{r.created_by_name ? ` · ${r.created_by_name}` : ''}
                  </Text>
                </View>
                {cook || canSeeReport ? (
                  <TouchableOpacity onPress={() => borrar(r.id)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                    <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>🗑️</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : null}

      {/* Reporte de la empresa (PDF): SOLO admin/supervisor/cocina. */}
      {canSeeReport ? (
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>📄 Reporte de entregas</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>
          Comidas y costo entregados a {companyName}, día por día. Elige el período y descarga el PDF.
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
          {[{ n: 7, l: '7 días' }, { n: 30, l: '30 días' }, { n: 90, l: '90 días' }].map((o) => (
            <TouchableOpacity
              key={o.n}
              onPress={() => setReportDays(o.n)}
              style={{ flex: 1, paddingVertical: spacing.xs, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: reportDays === o.n ? colors.primary : colors.border, backgroundColor: reportDays === o.n ? colors.primary : colors.surface }}
            >
              <Text style={{ color: reportDays === o.n ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{o.l}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={verReporte} disabled={pdfBusy} style={{ backgroundColor: '#B91C1C', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: pdfBusy ? 0.6 : 1 }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>{pdfBusy ? 'Generando…' : '📄 Ver / descargar reporte PDF'}</Text>
        </TouchableOpacity>
      </Card>
      ) : null}

      <View style={{ height: spacing.xl }} />

      {/* Modal de distribución */}
      <Modal visible={!!mealFor} transparent animationType="fade" onRequestClose={() => setMealFor(null)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>{modalMeal ? `${modalMeal.icon} ${modalMeal.label}` : ''} · {companyName}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
              Escribe los platos que surtiste. Se SUMA a lo ya registrado hoy{mealFor ? ` (${platosOf(mealFor)} hasta ahora)` : ''}.
            </Text>

            {mealFor === 'otros' ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md }}>Plato (elige de la lista o escribe uno nuevo)</Text>
                {extraItems.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 4 }}>
                    {extraItems.map((e) => {
                      const on = norm(e.name) === norm(itemLabel);
                      return (
                        <TouchableOpacity key={e.id} onPress={() => selectExtra(e.name)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                          <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{e.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
                <TextInput value={itemLabel} onChangeText={setItemLabel} placeholder="Ej. Bolsa de hielo, Refresco, Postre…" placeholderTextColor={colors.muted} style={input} />
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>El nombre se guarda para la próxima; luego solo cambias el costo.</Text>
              </>
            ) : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Platos</Text>
                <TextInput
                  value={qty}
                  onChangeText={(t) => setQty(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad" inputMode="numeric" placeholder="0" placeholderTextColor={colors.muted}
                  style={[input, { fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 4 }]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Costo por plato ($)</Text>
                <TextInput
                  value={unitCost}
                  onChangeText={(t) => setUnitCost(t.replace(/[^0-9.,]/g, ''))}
                  keyboardType="decimal-pad" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted}
                  style={[input, { fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 4 }]}
                />
              </View>
            </View>

            {/* Conversión en vivo: total $ y su equivalente en Bs al cambio */}
            <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, textAlign: 'center' }}>
                Total: {fmtUsd(totUsd)}{rate && rate > 0 ? `  ·  ${fmtBs(totBs)}` : ''}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 2 }}>
                {q} plato(s) × {fmtUsd(uc)}{rate && rate > 0 ? ` · tasa BCV Bs ${rate}/$` : ' · sin tasa BCV'}
              </Text>
            </View>

            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setMealFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={registrar} disabled={saving} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#1E9E4A', opacity: saving ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '900' }}>{saving ? 'Guardando…' : '🍽️ Sumar entrega'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Escáner del carnet del cocinero */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner
            onClose={() => setScanOpen(false)}
            onDetected={(text) => {
              const id = parseEmployeeId(text);
              if (id) verifyCook(id);
              else { setScanOpen(false); setNotice('❌ Ese QR no es un carnet de persona.'); }
            }}
          />
        </View>
      </Modal>
    </Screen>
  );
}
