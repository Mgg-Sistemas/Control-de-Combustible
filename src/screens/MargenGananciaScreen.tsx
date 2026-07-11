import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase, selectAllRows } from '../lib/supabase';
import { norm } from '../lib/text';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useAuth } from '../context/AuthContext';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// ── Máquina con sus valores de margen ─────────────────────────────────────────
type Mach = {
  id: string;
  code: string;
  serial: string | null;
  tipo: string | null;
  company: string;
  cost: number | null;   // costo inicial
  value: number | null;  // valor útil
};

// Dinero con 2 decimales (redondeo estándar).
const money = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** % de ganancia = (valor útil − costo inicial) ÷ costo inicial × 100. */
const pctOf = (cost: number | null, value: number | null): number | null =>
  cost != null && cost > 0 && value != null ? ((value - cost) / cost) * 100 : null;
const pctStr = (p: number | null) => (p == null ? '—' : `${(Math.round(p * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

/** Interpreta un texto como número aceptando formato es-VE (1.234,56) o simple. */
function parseNum(text: string): number | null {
  let s = (text || '').trim();
  if (!s) return null;
  s = s.replace(/[^0-9.,]/g, '');
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return isFinite(n) && n >= 0 ? n : null;
}

export default function MargenGananciaScreen() {
  const { colors } = useTheme();
  const { canSee } = useAuth();
  const [machines, setMachines] = useState<Mach[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({}); // "id:cost" | "id:value" → texto en edición

  const load = async () => {
    setLoading(true);
    const rows = await selectAllRows(
      'machinery',
      'id, code, serial, tipo, initial_cost, useful_value, company:company_id(id, name)'
    );
    const list: Mach[] = (rows ?? []).map((m: any) => ({
      id: m.id,
      code: m.code ?? '—',
      serial: m.serial ?? null,
      tipo: m.tipo ?? null,
      company: m.company?.name ?? 'Sin empresa',
      cost: m.initial_cost != null ? Number(m.initial_cost) : null,
      value: m.useful_value != null ? Number(m.useful_value) : null,
    }));
    list.sort((a, b) => a.company.localeCompare(b.company) || a.code.localeCompare(b.code));
    setMachines(list);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Guarda un campo (costo o valor) de una máquina.
  const saveField = async (m: Mach, field: 'initial_cost' | 'useful_value', text: string) => {
    const val = parseNum(text);
    const col = field === 'initial_cost' ? 'cost' : 'value';
    const { error } = await supabase.from('machinery').update({ [field]: val }).eq('id', m.id);
    if (error) return Alert.alert('Aviso', error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? { ...x, [col]: val } : x)));
    setEdits((prev) => { const n = { ...prev }; delete n[`${m.id}:${col}`]; return n; });
  };

  // Agrupa por empresa con totales y % general (solo máquinas con ambos datos).
  const groups = useMemo(() => {
    const q = norm(query.trim());
    const byCompany = new Map<string, Mach[]>();
    machines.forEach((m) => {
      if (q && !norm(m.company).includes(q) && !norm(m.code).includes(q)) return;
      const arr = byCompany.get(m.company) ?? [];
      arr.push(m);
      byCompany.set(m.company, arr);
    });
    return Array.from(byCompany.entries())
      .map(([company, ms]) => {
        const withData = ms.filter((m) => m.cost != null && m.cost > 0 && m.value != null);
        const totalCost = withData.reduce((s, m) => s + (m.cost || 0), 0);
        const totalValue = withData.reduce((s, m) => s + (m.value || 0), 0);
        const pct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null;
        return { company, machines: ms, count: ms.length, totalCost, totalValue, pct, conDatos: withData.length };
      })
      .sort((a, b) => (a.company === 'Sin empresa' ? 1 : b.company === 'Sin empresa' ? -1 : a.company.localeCompare(b.company)));
  }, [machines, query]);

  // Totales generales (todas las empresas).
  const grand = useMemo(() => {
    const withData = machines.filter((m) => m.cost != null && m.cost > 0 && m.value != null);
    const totalCost = withData.reduce((s, m) => s + (m.cost || 0), 0);
    const totalValue = withData.reduce((s, m) => s + (m.value || 0), 0);
    return { count: machines.length, totalCost, totalValue, pct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null };
  }, [machines]);

  const generateReport = async () => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sections = groups
      .map((g) => {
        const rows = g.machines
          .map((m) => {
            const p = pctOf(m.cost, m.value);
            return `<tr><td>${esc(m.code)}${m.serial ? `<br/><span style="color:#888;font-size:9px">${esc(m.serial)}</span>` : ''}</td>` +
              `<td>${esc(m.tipo || '—')}</td>` +
              `<td style="text-align:right">${m.cost != null ? '$' + money(m.cost) : '—'}</td>` +
              `<td style="text-align:right">${m.value != null ? '$' + money(m.value) : '—'}</td>` +
              `<td style="text-align:right;font-weight:700;color:${p == null ? '#888' : p >= 0 ? '#1E7A46' : '#B42318'}">${pctStr(p)}</td></tr>`;
          })
          .join('');
        return `<h3 class="emp">🏢 ${esc(g.company)} — ${g.count} máquina(s)</h3>
          <table class="mg"><thead><tr><th>Máquina</th><th>Tipo</th><th>Costo inicial</th><th>Valor útil</th><th>% Ganancia</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="2" style="text-align:right;font-weight:800">TOTAL ${esc(g.company)}</td>
            <td style="text-align:right;font-weight:800">$${money(g.totalCost)}</td>
            <td style="text-align:right;font-weight:800">$${money(g.totalValue)}</td>
            <td style="text-align:right;font-weight:800">${pctStr(g.pct)}</td></tr></tfoot></table>`;
      })
      .join('');
    const html = pdfDocument({
      title: 'Margen de ganancia por maquinaria',
      subtitle: `${grand.count} máquina(s) · ${groups.length} empresa(s)`,
      extraCss: `
        h3.emp{font-size:13px;font-weight:800;color:#1E3A5F;margin:16px 0 4px}
        table.mg{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px}
        table.mg th,table.mg td{border:1px solid #ccc;padding:5px 8px;text-align:left}
        table.mg th{background:#1E3A5F;color:#fff}
        table.mg tfoot td{background:#EEF2F7}
        .grand{margin-top:16px;padding:10px 14px;background:#1E3A5F;color:#fff;font-weight:800;font-size:13px;border-radius:6px}
        .muted{color:#666;font-size:11px;margin-top:8px}`,
      body: `
        ${sections || '<p class="muted">Sin máquinas.</p>'}
        <div class="grand">TOTAL GENERAL · Costo: $${money(grand.totalCost)} · Valor útil: $${money(grand.totalValue)} · Margen: ${pctStr(grand.pct)}</div>
        <p class="muted">% de ganancia = (Valor útil − Costo inicial) ÷ Costo inicial × 100. El % por empresa/general solo considera máquinas con ambos datos cargados.</p>`,
    });
    await exportPdf(html, 'Margen de Ganancia - Reporte');
  };

  if (!canSee('margen_ganancia')) {
    return (
      <Screen>
        <SectionTitle>Margen de ganancia</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }

  const inputStyle = {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.text,
    backgroundColor: colors.surface, fontSize: 14,
  } as const;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Margen de ganancia</SectionTitle>

      {/* Resumen general + botón de reporte */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Margen general (todas las empresas)</Text>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20, marginTop: 2 }}>{pctStr(grand.pct)}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
              {grand.count} máquina(s) · Costo ${money(grand.totalCost)} · Valor ${money(grand.totalValue)}
            </Text>
          </View>
          <TouchableOpacity onPress={generateReport} style={{ padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>📄 Reporte</Text>
          </TouchableOpacity>
        </View>
      </Card>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar empresa o máquina…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.sm }}
      />

      {loading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <EmptyState title="Sin datos" subtitle="No hay maquinaria registrada." />
      ) : (
        groups.map((g) => {
          const open = !!expanded[g.company];
          return (
            <View key={g.company}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded((p) => ({ ...p, [g.company]: !p[g.company] }))}>
                <Card style={{ backgroundColor: colors.surfaceAlt, marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {g.company}</Text>
                    <Text style={{ color: g.pct == null ? colors.muted : g.pct >= 0 ? colors.success : colors.warning, fontWeight: '800', fontSize: 15 }}>{pctStr(g.pct)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>🚜 {g.count} máquina(s) · Costo ${money(g.totalCost)} · Valor ${money(g.totalValue)}</Text>
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{open ? '▲ ocultar' : '▼ ver detalle'}</Text>
                  </View>
                </Card>
              </TouchableOpacity>

              {open ? g.machines.map((m) => {
                const p = pctOf(m.cost, m.value);
                const costKey = `${m.id}:cost`;
                const valKey = `${m.id}:value`;
                const costVal = edits[costKey] !== undefined ? edits[costKey] : (m.cost != null ? String(m.cost) : '');
                const valVal = edits[valKey] !== undefined ? edits[valKey] : (m.value != null ? String(m.value) : '');
                return (
                  <Card key={m.id}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, flex: 1 }}>
                        {m.code}{m.serial ? <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '400' }}>  ·  {m.serial}</Text> : null}
                      </Text>
                      <Text style={{ color: p == null ? colors.muted : p >= 0 ? colors.success : colors.warning, fontWeight: '800', fontSize: 15 }}>{pctStr(p)}</Text>
                    </View>
                    {m.tipo ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }}>{m.tipo}</Text> : null}
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Costo inicial</Text>
                        <TextInput
                          value={costVal}
                          onChangeText={(t) => setEdits((prev) => ({ ...prev, [costKey]: t }))}
                          onBlur={() => saveField(m, 'initial_cost', costVal)}
                          keyboardType="numeric"
                          placeholder="0,00"
                          placeholderTextColor={colors.muted}
                          style={inputStyle}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Valor útil</Text>
                        <TextInput
                          value={valVal}
                          onChangeText={(t) => setEdits((prev) => ({ ...prev, [valKey]: t }))}
                          onBlur={() => saveField(m, 'useful_value', valVal)}
                          keyboardType="numeric"
                          placeholder="0,00"
                          placeholderTextColor={colors.muted}
                          style={inputStyle}
                        />
                      </View>
                    </View>
                  </Card>
                );
              }) : null}
            </View>
          );
        })
      )}
    </Screen>
  );
}
