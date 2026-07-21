import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { RecordForm, Field } from '../components/RecordForm';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { captureAndUploadEmployeePhoto, removePhoto } from '../lib/photo';
import { useConfirm } from '../components/ConfirmProvider';
import { qrSvg, employeeQrUrl } from '../lib/qr';
import { carnetHtml, fullName } from '../lib/carnet';
import { constanciaCarnetHtml } from '../lib/constancia';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { Employee, Company } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const BLOOD = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((v) => ({ label: v, value: v }));
const GENDER = [{ label: 'Masculino', value: 'Masculino' }, { label: 'Femenino', value: 'Femenino' }, { label: 'Otro', value: 'Otro' }];
const MARITAL = ['Soltero/a', 'Casado/a', 'Divorciado/a', 'Viudo/a', 'Unión libre'].map((v) => ({ label: v, value: v }));
const STATUS_OPTS = [{ label: 'Activo', value: 'activo' }, { label: 'Inactivo', value: 'inactivo' }, { label: 'Suspendido', value: 'suspendido' }];
const STATUS_COLOR: Record<string, string> = { activo: '#16A34A', inactivo: '#DC2626', suspendido: '#F59E0B' };

// Bancos de Venezuela (código · nombre). El valor guardado es "código - NOMBRE".
const BANCOS_VE = [
  '0102 - BANCO DE VENEZUELA', '0104 - VENEZOLANO DE CRÉDITO', '0105 - MERCANTIL', '0108 - BBVA PROVINCIAL',
  '0114 - BANCARIBE', '0115 - BANCO EXTERIOR', '0128 - BANCO CARONÍ', '0134 - BANESCO', '0137 - SOFITASA',
  '0138 - BANCO PLAZA', '0146 - BANGENTE', '0151 - BFC BANCO FONDO COMÚN', '0156 - 100% BANCO', '0157 - DELSUR',
  '0163 - BANCO DEL TESORO', '0166 - BANCO AGRÍCOLA DE VENEZUELA', '0168 - BANCRECER', '0169 - MI BANCO',
  '0171 - BANCO ACTIVO', '0172 - BANCAMIGA', '0173 - BANCO INTERNACIONAL DE DESARROLLO', '0174 - BANPLUS',
  '0175 - BANCO BICENTENARIO', '0177 - BANFANB', '0178 - N58 BANCO DIGITAL', '0191 - BANCO NACIONAL DE CRÉDITO (BNC)',
].map((v) => ({ label: v, value: v }));

// Todos los campos de la ficha del trabajador.
const FIELDS: Field[] = [
  // El N° de ficha es AUTOMÁTICO (correlativo de 4 dígitos que asigna la BD al crear).
  { key: 'first_name', label: 'Nombre', type: 'text', required: true },
  { key: 'last_name', label: 'Apellido', type: 'text', required: true },
  { key: 'cedula', label: 'Cédula', type: 'text' },
  { key: 'company_id', label: 'Empresa', type: 'lookup', table: 'companies', labelCol: 'name', dropdown: true, filter: { hidden: false, food_only: false } },
  { key: 'cargo', label: 'Cargo', type: 'suggest', table: 'employees', column: 'cargo', dropdown: true, placeholder: 'Elegir cargo…' },
  { key: 'department', label: 'Departamento', type: 'suggest', table: 'employees', column: 'department' },
  { key: 'grupo', label: 'Grupo / zona', type: 'suggest', table: 'employees', column: 'grupo' },
  { key: 'blood_type', label: 'Grupo sanguíneo', type: 'select', options: BLOOD },
  { key: 'birth_date', label: 'Fecha de nacimiento', type: 'date' },
  { key: 'gender', label: 'Género', type: 'select', options: GENDER },
  { key: 'nationality', label: 'Nacionalidad', type: 'text', defaultValue: 'Venezolana' },
  { key: 'marital_status', label: 'Estado civil', type: 'select', options: MARITAL },
  { key: 'phone', label: 'Teléfono', type: 'text' },
  { key: 'email', label: 'Correo', type: 'text' },
  { key: 'address', label: 'Dirección (dónde vive)', type: 'text' },
  { key: 'city', label: 'Ciudad', type: 'text' },
  { key: 'state', label: 'Estado', type: 'text' },
  { key: 'emergency_contact_name', label: 'Emergencia · Nombre', type: 'text' },
  { key: 'emergency_contact_phone', label: 'Emergencia · Teléfono', type: 'text' },
  { key: 'emergency_contact_relation', label: 'Emergencia · Parentesco', type: 'text' },
  { key: 'hire_date', label: 'Fecha de ingreso', type: 'date' },
  { key: 'status', label: 'Estado', type: 'select', options: STATUS_OPTS },
  { key: 'base_salary', label: 'Salario base', type: 'number' },
  // Datos bancarios (para pagos).
  { key: '__sec_banco', label: '🏦 Datos bancarios', type: 'section' },
  { key: 'bank_name', label: 'Banco', type: 'select', options: BANCOS_VE, dropdown: true, placeholder: 'Elegir banco…' },
  { key: 'bank_account', label: 'N° de cuenta', type: 'text' },
  { key: 'bank_holder', label: 'Titular (nombre y apellido)', type: 'text' },
  { key: 'bank_cedula', label: 'Cédula del titular', type: 'text' },
  { key: 'notes', label: 'Notas', type: 'text' },
];

export default function EmpleadosScreen({ navigation }: any) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { data: employees, loading, refetch } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const [query, setQuery] = useState('');
  const [sortDir, setSortDir] = useState<'az' | 'za'>('az'); // orden alfabético por nombre
  const [statusFilter, setStatusFilter] = useState<'todos' | 'activo' | 'inactivo'>('todos'); // estado del empleado
  const [cargoSel, setCargoSel] = useState<Set<string>>(new Set()); // vacío = todos los cargos
  const [cargosOpen, setCargosOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');
  // Etiqueta del cargo, normalizada para agrupar (mayúsculas, sin espacios extra).
  const cargoLabel = (e: Employee) => (e.cargo || '').trim().toUpperCase() || 'SIN CARGO';

  const q = norm(query.trim());
  // ¿El empleado está activo? (todo lo que no sea "activo" cuenta como inactivo, incl. suspendido).
  const esActivo = (e: Employee) => (e.status || '').toLowerCase() === 'activo';
  // Empleados que pasan la BÚSQUEDA de texto + FILTRO de estado (base para contar por cargo).
  const baseFiltered = useMemo(
    () => employees.filter((e) =>
      (statusFilter === 'todos' || (statusFilter === 'activo' ? esActivo(e) : !esActivo(e))) &&
      (!q ||
        norm(fullName(e)).includes(q) ||
        norm(e.cedula).includes(q) ||
        norm(e.ficha_number).includes(q) ||
        norm(e.cargo).includes(q) ||
        norm(companyName(e.company_id)).includes(q))
    ),
    [employees, q, statusFilter, companies]
  );

  // Conteo total por estado (independiente del filtro, para las etiquetas de los chips).
  const statusCounts = useMemo(() => {
    let act = 0;
    employees.forEach((e) => { if (esActivo(e)) act++; });
    return { activo: act, inactivo: employees.length - act, todos: employees.length };
  }, [employees]);

  // Conteo por cargo (para los chips-filtro y el reporte): [cargo, cantidad], de mayor a menor.
  const cargoCounts = useMemo(() => {
    const map = new Map<string, number>();
    baseFiltered.forEach((e) => { const k = cargoLabel(e); map.set(k, (map.get(k) ?? 0) + 1); });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [baseFiltered]);

  const shown = useMemo(
    () => baseFiltered
      .filter((e) => cargoSel.size === 0 || cargoSel.has(cargoLabel(e)))
      .sort((a, b) => {
        const cmp = cmpText(fullName(a), fullName(b));
        return sortDir === 'az' ? cmp : -cmp;
      }),
    [baseFiltered, cargoSel, sortDir]
  );

  // Agrupa por empresa (acordeón).
  const byCompany = useMemo(() => {
    const map = new Map<string, { key: string; name: string; items: Employee[] }>();
    shown.forEach((e) => {
      const k = e.company_id ?? '__none__';
      const g = map.get(k) ?? { key: k, name: companyName(e.company_id), items: [] };
      g.items.push(e);
      map.set(k, g);
    });
    return Array.from(map.values()).sort((a, b) => a.name === 'Sin empresa' ? 1 : b.name === 'Sin empresa' ? -1 : cmpText(a.name, b.name));
  }, [shown, companies]);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (e: Employee) => { setEditing(e); setFormOpen(true); };

  const subirFoto = async (e: Employee) => {
    setBusy(e.id + '-photo');
    const r = await captureAndUploadEmployeePhoto(e.id, 'empleados');
    if (r.ok && r.url) {
      const { error } = await supabase.from('employees').update({ photo_url: r.url }).eq('id', e.id);
      if (error) Alert.alert('Aviso', error.message); else refetch();
    } else if (r.error) {
      Alert.alert('Aviso', r.error);
    }
    setBusy(null);
  };

  const borrarFoto = async (e: Employee) => {
    const ok = await confirm({ title: 'Quitar foto', message: `¿Quitar la foto de ${fullName(e)}?`, confirmText: 'Quitar', cancelText: 'Cancelar', danger: true });
    if (!ok) return;
    setBusy(e.id + '-photo');
    const r = await removePhoto('employees', e.id);
    if (!r.ok && r.error) Alert.alert('Aviso', r.error); else refetch();
    setBusy(null);
  };

  const imprimirCarnet = async (e: Employee) => {
    setBusy(e.id + '-carnet');
    let svg = '';
    try { svg = await qrSvg(employeeQrUrl(e.id), 220); } catch {}
    const html = carnetHtml(e, { companyName: companyName(e.company_id), qrSvg: svg });
    await exportPdf(html, `Carnet - ${fullName(e)}`);
    setBusy(null);
  };

  // Constancia de ENTREGA DE CARNET (trabajo a destajo) para imprimir y firmar.
  const imprimirConstancia = async (e: Employee) => {
    setBusy(e.id + '-const');
    const html = constanciaCarnetHtml({
      fullName: fullName(e),
      cedula: e.cedula,
      companyName: companyName(e.company_id),
      city: e.city,
      state: e.state,
    });
    await exportPdf(html, `Constancia entrega carnet - ${fullName(e)}`);
    setBusy(null);
  };

  // Reporte PDF de LO SELECCIONADO: lista las personas del filtro actual (estado +
  // cargos elegidos + búsqueda) con sus datos, más un resumen por cargo arriba.
  const reporteSeleccion = async () => {
    setBusy('reporte-cargo');
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const list = shown; // ya respeta estado + cargos + búsqueda, y viene ordenado
    const estadoTxt = statusFilter === 'todos' ? 'Todos' : statusFilter === 'activo' ? 'Activos' : 'Inactivos';
    const cargoTxt = cargoSel.size === 0 ? 'Todos los cargos' : Array.from(cargoSel).sort().join(', ');
    const busqTxt = q ? ` · Búsqueda: "${esc(query.trim())}"` : '';

    // Resumen por cargo DE LA SELECCIÓN.
    const selMap = new Map<string, number>();
    list.forEach((e) => { const k = cargoLabel(e); selMap.set(k, (selMap.get(k) ?? 0) + 1); });
    const selCounts = Array.from(selMap.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const rowsSum = selCounts.map(([c, n]) => `<tr><td>${esc(c)}</td><td class="r">${n}</td></tr>`).join('');

    // Listado de las personas seleccionadas.
    const rowsList = list.map((e, i) =>
      `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(fullName(e))}</td>
        <td class="c">${esc(e.cedula ?? '—')}</td>
        <td class="c">${esc(e.ficha_number ?? '—')}</td>
        <td>${esc(e.cargo ?? '—')}</td>
        <td>${esc(companyName(e.company_id))}</td>
        <td class="c">${esc(e.status ?? '—')}</td>
        <td>${esc(e.phone ?? '—')}</td>
      </tr>`).join('');

    const body = `
      <div class="meta">Estado: <b>${estadoTxt}</b> · Cargo: <b>${esc(cargoTxt)}</b>${busqTxt}</div>
      <h3 class="sec">Resumen por cargo</h3>
      <table class="sum">
        <thead><tr><th>Cargo</th><th class="r">Cantidad</th></tr></thead>
        <tbody>${rowsSum || '<tr><td colspan="2">Sin empleados</td></tr>'}</tbody>
        <tfoot><tr><td>TOTAL</td><td class="r">${list.length}</td></tr></tfoot>
      </table>
      <h3 class="sec">Listado (${list.length} persona(s))</h3>
      <table>
        <thead><tr>
          <th class="c" style="width:26px">#</th><th>Empleado</th><th class="c">Cédula</th><th class="c">Ficha</th>
          <th>Cargo</th><th>Empresa</th><th class="c">Estado</th><th>Teléfono</th>
        </tr></thead>
        <tbody>${rowsList || '<tr><td colspan="8">Sin empleados</td></tr>'}</tbody>
      </table>`;
    const extraCss = `
      .meta{margin:2px 0 8px;color:#333;font-size:11pt}
      .sec{margin:18px 0 6px;color:#1E3A5F;font-size:12.5pt;border-top:2px solid #1E3A5F;padding-top:10px}
      table{border-collapse:collapse;width:100%;font-size:10.5pt;margin-top:4px}
      th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left}
      th{background:#1E3A5F;color:#fff}
      td.c,th.c{text-align:center} td.r,th.r{text-align:right}
      table.sum{width:auto;min-width:280px}
      tbody tr:nth-child(even) td{background:#f4f7fb}
      tfoot td{font-weight:800;background:#eef2f7;border-top:2px solid #1E3A5F}`;
    const html = pdfDocument({
      title: 'Reporte de empleados',
      subtitle: `${list.length} empleado(s)${cargoSel.size ? ` · ${cargoSel.size} cargo(s) seleccionado(s)` : ` · ${selCounts.length} cargo(s)`}`,
      body,
      extraCss,
    });
    await exportPdf(html, `Reporte de empleados${cargoSel.size ? ' - ' + cargoTxt : ''}`);
    setBusy(null);
  };

  const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={{ flexGrow: 1, flexBasis: 90, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: color, opacity: disabled ? 0.6 : 1 }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Empleados</SectionTitle>
        <TouchableOpacity onPress={openNew} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nuevo</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar por nombre, cédula, ficha, cargo o empresa…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {/* Filtro por ESTADO (activos / inactivos) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm, flexWrap: 'wrap' }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginRight: spacing.xs }}>Estado:</Text>
        {([['todos', 'Todos', statusCounts.todos], ['activo', 'Activos', statusCounts.activo], ['inactivo', 'Inactivos', statusCounts.inactivo]] as const).map(([key, label, n]) => {
          const on = statusFilter === key;
          const tint = key === 'activo' ? '#16A34A' : key === 'inactivo' ? '#DC2626' : colors.primary;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setStatusFilter(key)}
              style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? tint : colors.border, backgroundColor: on ? tint : colors.surface }}
            >
              <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '800', fontSize: 12 }}>{label} · {n}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Orden alfabético por nombre */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginRight: spacing.xs }}>Orden:</Text>
        {([['az', 'A → Z'], ['za', 'Z → A']] as const).map(([key, label]) => {
          const on = sortDir === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setSortDir(key)}
              style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}
            >
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Filtro por CARGO (tipo) + reporte por cargo */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <TouchableOpacity onPress={() => setCargosOpen((v) => !v)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🏷️ Cargo: </Text>
            <Text style={{ color: cargoSel.size ? colors.primary : colors.muted, fontWeight: '800', fontSize: 14, flex: 1 }} numberOfLines={1}>
              {cargoSel.size === 0 ? 'Todos' : Array.from(cargoSel).sort().join(', ')}
            </Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{cargosOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={reporteSeleccion} disabled={busy === 'reporte-cargo'} style={{ backgroundColor: '#0F766E', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, opacity: busy === 'reporte-cargo' ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{busy === 'reporte-cargo' ? 'Generando…' : '📊 Reporte'}</Text>
          </TouchableOpacity>
        </View>
        {cargosOpen ? (
          <View style={{ marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <TouchableOpacity
                onPress={() => setCargoSel(new Set())}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: cargoSel.size === 0 ? colors.primary : colors.border, backgroundColor: cargoSel.size === 0 ? colors.primary : colors.surface }}
              >
                <Text style={{ color: cargoSel.size === 0 ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>Todos · {baseFiltered.length}</Text>
              </TouchableOpacity>
              {cargoCounts.map(([cargo, n]) => {
                const on = cargoSel.has(cargo);
                return (
                  <TouchableOpacity
                    key={cargo}
                    onPress={() => setCargoSel((prev) => { const s = new Set(prev); if (s.has(cargo)) s.delete(cargo); else s.add(cargo); return s; })}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}
                  >
                    <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{on ? '✓ ' : ''}{cargo} · {n}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
              Puedes marcar varios cargos (operadores, obreros…). El botón 📊 Reporte genera el listado de lo seleccionado + resumen por cargo.
            </Text>
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
            Toca para filtrar por uno o varios cargos. El 📊 Reporte genera el listado de las personas seleccionadas y un resumen por cargo.
          </Text>
        )}
      </Card>

      {loading && employees.length === 0 ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title={q ? 'Sin resultados' : 'Sin empleados'} subtitle={q ? 'Prueba con otra búsqueda.' : 'Toca "+ Nuevo" para registrar el primero.'} />
      ) : (
        shown.map((e) => (
                <ExpandableCard
                  key={e.id}
                  summary={
                    <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                      {e.photo_url ? (
                        <Image source={{ uri: e.photo_url }} style={{ width: 44, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }} resizeMode="cover" />
                      ) : (
                        <View style={{ width: 44, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 24 }}>👤</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>{fullName(e)}</Text>
                          <Text style={{ color: STATUS_COLOR[e.status] ?? colors.muted, fontWeight: '700', fontSize: 11 }}>● {e.status}</Text>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{[e.cargo, e.ficha_number ? `Ficha ${e.ficha_number}` : ''].filter(Boolean).join(' · ')}</Text>
                      </View>
                    </View>
                  }
                  detail={
                    <>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>
                        {[e.cedula ? `C.I ${e.cedula}` : '', e.blood_type ? `🩸 ${e.blood_type}` : '', e.phone || ''].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                      </Text>
                      {e.bank_name || e.bank_account ? (
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                          🏦 {[e.bank_name, e.bank_account ? `Cta. ${e.bank_account}` : '', e.bank_holder || '', e.bank_cedula ? `C.I ${e.bank_cedula}` : ''].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                        <Btn label="✎ Editar" color="#475569" onPress={() => openEdit(e)} />
                        <Btn label="🪪 Ficha" color="#2563EB" onPress={() => navigation.navigate('EmployeeCard', { employeeId: e.id })} />
                        <Btn label={busy === e.id + '-const' ? 'Generando…' : '📄 Constancia'} color="#0F766E" disabled={busy === e.id + '-const'} onPress={() => imprimirConstancia(e)} />
                        <Btn label={busy === e.id + '-photo' ? 'Subiendo…' : '📷 Foto'} color="#059669" disabled={busy === e.id + '-photo'} onPress={() => subirFoto(e)} />
                        {e.photo_url ? (
                          <Btn label="🗑️ Quitar foto" color="#B91C1C" disabled={busy === e.id + '-photo'} onPress={() => borrarFoto(e)} />
                        ) : null}
                      </View>
                    </>
                  }
                />
        ))
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? `Editar: ${fullName(editing)}` : 'Nuevo empleado'}
        table="employees"
        fields={FIELDS}
        record={editing as any}
        autoUserField="created_by"
        uniqueField={{ key: 'cedula', labelCol: 'cedula', labelName: 'cédula' }}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />
    </Screen>
  );
}
