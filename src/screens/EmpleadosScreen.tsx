import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, ScrollView, Modal } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { RecordForm, Field } from '../components/RecordForm';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { canonicalCargo } from '../lib/cargos';
import { captureAndUploadEmployeePhoto, removePhoto } from '../lib/photo';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { qrSvg, employeeQrUrl } from '../lib/qr';
import { carnetHtml, fullName } from '../lib/carnet';
import { constanciaCarnetHtml, constanciaTrabajoHtml } from '../lib/constancia';
import { montoQuincenal, montoQuincenalTexto } from '../lib/montoQuincenal';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { Employee, Company } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { EMPLOYEE_STATUS_COLOR, employeeStatusTone } from '../lib/statusMeta';

const BLOOD = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((v) => ({ label: v, value: v }));
const GENDER = [{ label: 'Masculino', value: 'Masculino' }, { label: 'Femenino', value: 'Femenino' }, { label: 'Otro', value: 'Otro' }];
const MARITAL = ['Soltero/a', 'Casado/a', 'Divorciado/a', 'Viudo/a', 'Unión libre'].map((v) => ({ label: v, value: v }));
const STATUS_OPTS = [{ label: 'Activo', value: 'activo' }, { label: 'Inactivo', value: 'inactivo' }, { label: 'Suspendido', value: 'suspendido' }, { label: 'Otro', value: 'otro' }];
// "Otro" = no entra al control de pago (nómina). Se excluye de la precarga y del ledger.

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
  { key: 'company_id', label: 'Empresa', type: 'lookup', table: 'companies', labelCol: 'name', dropdown: true, filter: { hidden: false } },
  // EMPRESA FILTRO NÓMINA — lista PROPIA de Nómina (`payroll_companies`), aparte del
  // catálogo general. `createColumn` deja escribir una empresa nueva sin salir del
  // formulario, y esa empresa NO aparece en maquinaria, reportes, compras ni comidas:
  // el resto del sistema ni conoce esa tabla. Ver supabase/nomina_empresa_filtro.sql.
  { key: 'payroll_company_id', label: '🏢 Empresa filtro nómina (solo agrupa acá — escribe para crear una nueva)', type: 'lookup', table: 'payroll_companies', labelCol: 'name', createColumn: 'name', dropdown: true },
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

/** Clave de los empleados SIN contratista asignado: son de SOS LA GUAIRA. */
const SIN_EMPRESA = '__none__';

export default function EmpleadosScreen({ navigation }: any) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: employees, loading, refetch } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  // Lista PROPIA de Nómina. Si todavía no se corrió supabase/nomina_empresa_filtro.sql
  // la consulta falla y `data` queda vacío: los chips caen a "Sin empresa de filtro"
  // y nada se rompe.
  const { data: payrollCompanies } = useTable<{ id: string; name: string }>('payroll_companies', { orderBy: 'name' });
  const [query, setQuery] = useState('');
  const [sortDir, setSortDir] = useState<'az' | 'za'>('az'); // orden alfabético por nombre
  const [statusFilter, setStatusFilter] = useState<'todos' | 'activo' | 'inactivo' | 'otro'>('todos'); // estado del empleado
  const [cargoSel, setCargoSel] = useState<Set<string>>(new Set()); // vacío = todos los cargos
  const [cargosOpen, setCargosOpen] = useState(false);
  const [cargoQ, setCargoQ] = useState(''); // buscador dentro de la lista de cargos
  // Filtro por EMPRESA (pedido del cliente 20-ago-2026). La clave es el `company_id`;
  // los que no tienen contratista van bajo SIN_EMPRESA = SOS LA GUAIRA (el empleador).
  const [empresaSel, setEmpresaSel] = useState<Set<string>>(new Set()); // vacío = todas
  const [empresasOpen, setEmpresasOpen] = useState(false);
  const [empresaQ, setEmpresaQ] = useState(''); // buscador dentro de la lista de empresas
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // El personal es de la organización dueña: SOS LA GUAIRA. Sin empresa-contratista
  // (company_id null) = SOS LA GUAIRA (el empleador). Si a alguien se le asigna un
  // contratista, se muestra ese, pero por defecto todos son SOS LA GUAIRA.
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'SOS LA GUAIRA');
  // Nombre de la EMPRESA FILTRO NÓMINA. Sin asignar se muestra aparte, para que se
  // vea a quién le falta: después de correr el SQL de arranque no debería quedar
  // nadie ahí. NO se le pone "SOS LA GUAIRA" por descarte como en `companyName`,
  // porque entonces se mezclaría con la empresa de filtro que SÍ se llama así y
  // saldrían dos grupos iguales partiendo a la plantilla en dos.
  const nominaName = (id: string | null) => (id ? payrollCompanies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa de filtro');
  // Etiqueta del cargo UNIFICADA y en MAYÚSCULA (junta variantes: plurales, typos…).
  const cargoLabel = (e: Employee) => canonicalCargo(e.cargo);

  const q = norm(query.trim());
  const estadoDe = (e: Employee) => (e.status || '').toLowerCase();
  const esActivo = (e: Employee) => estadoDe(e) === 'activo';
  const esOtro = (e: Employee) => estadoDe(e) === 'otro';
  // ¿El empleado pasa el filtro de estado elegido? "Inactivos" = ni activo ni "otro"
  // (inactivo/suspendido); "Otro" tiene su propio chip.
  const pasaEstado = (e: Employee) =>
    statusFilter === 'todos' ? true
    : statusFilter === 'activo' ? esActivo(e)
    : statusFilter === 'otro' ? esOtro(e)
    : (!esActivo(e) && !esOtro(e)); // inactivo
  // Clave de empresa de un empleado: su `company_id`, o SIN_EMPRESA si no tiene
  // contratista asignado (esos son de SOS LA GUAIRA, ver `companyName`).
  // Agrupa por la EMPRESA FILTRO NÓMINA, no por la empresa real: es exactamente el
  // punto del campo nuevo. La empresa real (`company_id`) sigue intacta y la usan
  // los períodos de nómina, comidas y el carnet.
  const empresaKey = (e: Employee) => (e as any).payroll_company_id ?? SIN_EMPRESA;

  // Empleados que pasan la BÚSQUEDA de texto + FILTRO de estado. Es la base para
  // contar por EMPRESA: los conteos se calculan ANTES de aplicar el filtro de
  // empresa, si no, al marcar una empresa las demás mostrarían 0 y no se podrían
  // sumar a la selección.
  const estadoFiltered = useMemo(
    () => employees.filter((e) =>
      pasaEstado(e) &&
      (!q ||
        norm(fullName(e)).includes(q) ||
        norm(e.cedula).includes(q) ||
        norm(e.ficha_number).includes(q) ||
        norm(e.cargo).includes(q) ||
        norm(companyName(e.company_id)).includes(q) ||
        norm(nominaName((e as any).payroll_company_id)).includes(q))
    ),
    [employees, q, statusFilter, companies, payrollCompanies]
  );

  // Conteo por empresa (para los chips-filtro): [clave, nombre, cantidad].
  const empresaCounts = useMemo(() => {
    const map = new Map<string, { key: string; name: string; n: number }>();
    estadoFiltered.forEach((e) => {
      const k = empresaKey(e);
      const g = map.get(k) ?? { key: k, name: nominaName((e as any).payroll_company_id), n: 0 };
      g.n += 1;
      map.set(k, g);
    });
    // SOS LA GUAIRA (el empleador) siempre de primera; el resto alfabético.
    return Array.from(map.values()).sort((a, b) =>
      a.key === SIN_EMPRESA ? -1 : b.key === SIN_EMPRESA ? 1 : cmpText(a.name, b.name));
  }, [estadoFiltered, companies, payrollCompanies]);

  // Base final para el listado y el reporte por cargo: ya con la empresa aplicada.
  const baseFiltered = useMemo(
    () => estadoFiltered.filter((e) => empresaSel.size === 0 || empresaSel.has(empresaKey(e))),
    [estadoFiltered, empresaSel]
  );

  // Conteo total por estado (independiente del filtro, para las etiquetas de los chips).
  const statusCounts = useMemo(() => {
    let act = 0, otr = 0;
    employees.forEach((e) => { if (esActivo(e)) act++; else if (esOtro(e)) otr++; });
    return { activo: act, otro: otr, inactivo: employees.length - act - otr, todos: employees.length };
  }, [employees]);

  // Conteo por cargo (para los chips-filtro y el reporte): [cargo, cantidad], de mayor a menor.
  const cargoCounts = useMemo(() => {
    const map = new Map<string, number>();
    baseFiltered.forEach((e) => { const k = cargoLabel(e); map.set(k, (map.get(k) ?? 0) + 1); });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || cmpText(a[0], b[0]));
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
      const k: string = (e as any).payroll_company_id ?? '__none__';
      const g = map.get(k) ?? { key: k, name: nominaName((e as any).payroll_company_id), items: [] as Employee[] };
      g.items.push(e);
      map.set(k, g);
    });
    return Array.from(map.values()).sort((a, b) => a.name === 'SOS LA GUAIRA' ? -1 : b.name === 'SOS LA GUAIRA' ? 1 : cmpText(a.name, b.name));
  }, [shown, companies, payrollCompanies]);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (e: Employee) => { setEditing(e); setFormOpen(true); };

  const subirFoto = async (e: Employee) => {
    setBusy(e.id + '-photo');
    const r = await captureAndUploadEmployeePhoto(e.id, 'empleados');
    if (r.ok && r.url) {
      const { error } = await supabase.from('employees').update({ photo_url: r.url }).eq('id', e.id);
      if (error) toast.error(error.message); else refetch();
    } else if (r.error) {
      toast.error(r.error);
    }
    setBusy(null);
  };

  const borrarFoto = async (e: Employee) => {
    const ok = await confirm({ title: 'Quitar foto', message: `¿Quitar la foto de ${fullName(e)}?`, confirmText: 'Quitar', cancelText: 'Cancelar', danger: true });
    if (!ok) return;
    setBusy(e.id + '-photo');
    const r = await removePhoto('employees', e.id);
    if (!r.ok && r.error) toast.error(r.error); else refetch();
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

  // CONSTANCIA DE TRABAJO (formato estándar, "A quien pueda interesar"): hace constar
  // cargo y fecha de ingreso; firma centrada de la Jefa de Administración.
  // A quién se le está haciendo la constancia (abre el cuadro con la casilla del
  // sueldo). null = cerrado. `conMonto` recuerda la casilla mientras está abierto.
  const [constanciaFor, setConstanciaFor] = useState<Employee | null>(null);
  const [constanciaConMonto, setConstanciaConMonto] = useState(false);

  const imprimirConstanciaTrabajo = async (e: Employee, conMonto: boolean) => {
    setBusy(e.id + '-const-trab');
    const html = constanciaTrabajoHtml({
      fullName: fullName(e),
      cedula: e.cedula,
      cargo: e.cargo ? canonicalCargo(e.cargo) : null,
      hireDate: e.hire_date,
      city: e.city,
      state: e.state,
      // Sin la casilla marcada va `null` y la constancia sale IDÉNTICA a la de
      // siempre, sin mencionar sueldo.
      montoQuincenal: conMonto ? montoQuincenalTexto(e as any) : null,
    });
    await exportPdf(html, `Constancia de trabajo - ${fullName(e)}`);
    setBusy(null);
    setConstanciaFor(null);
  };

  // Reporte PDF de LO SELECCIONADO: lista las personas del filtro actual (estado +
  // cargos elegidos + búsqueda) con sus datos, más un resumen por cargo arriba.
  const reporteSeleccion = async () => {
    setBusy('reporte-cargo');
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const list = shown; // ya respeta estado + cargos + búsqueda, y viene ordenado
    const estadoTxt = statusFilter === 'todos' ? 'Todos' : statusFilter === 'activo' ? 'Activos' : statusFilter === 'otro' ? 'Otro' : 'Inactivos';
    const cargoTxt = cargoSel.size === 0 ? 'Todos los cargos' : Array.from(cargoSel).sort().join(', ');
    const busqTxt = q ? ` · Búsqueda: "${esc(query.trim())}"` : '';

    // Resumen por cargo DE LA SELECCIÓN.
    const selMap = new Map<string, number>();
    list.forEach((e) => { const k = cargoLabel(e); selMap.set(k, (selMap.get(k) ?? 0) + 1); });
    const selCounts = Array.from(selMap.entries()).sort((a, b) => b[1] - a[1] || cmpText(a[0], b[0]));
    const rowsSum = selCounts.map(([c, n]) => `<tr><td>${esc(c)}</td><td class="r">${n}</td></tr>`).join('');

    // Listado de las personas seleccionadas.
    const rowsList = list.map((e, i) =>
      `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(fullName(e))}</td>
        <td class="c">${esc(e.cedula ?? '—')}</td>
        <td class="c">${esc(e.ficha_number ?? '—')}</td>
        <td>${esc(e.cargo ? canonicalCargo(e.cargo) : '—')}</td>
        <td>${esc(nominaName((e as any).payroll_company_id))}</td>
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
          <th>Cargo</th><th>Empresa filtro nómina</th><th class="c">Estado</th><th>Teléfono</th>
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
        <TouchableOpacity onPress={openNew} style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
          <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>+ Nuevo</Text>
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
        {([['todos', 'Todos', statusCounts.todos], ['activo', 'Activos', statusCounts.activo], ['inactivo', 'Inactivos', statusCounts.inactivo], ['otro', 'Otro', statusCounts.otro]] as const).map(([key, label, n]) => {
          const on = statusFilter === key;
          const tint = key === 'todos' ? colors.brand : EMPLOYEE_STATUS_COLOR[key] ?? colors.brand;
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

      {/* Filtro por EMPRESA (pedido del cliente 20-ago-2026). Va plegado y ocupa una
          línea, para no empujar el listado hacia abajo; se despliega al tocarlo.
          Mismo patrón que el filtro de CARGO de abajo (buscador + selección múltiple),
          porque la lista de contratistas es larga y no cabe en chips sueltos. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginRight: spacing.xs }}>Empresa:</Text>
        <TouchableOpacity
          onPress={() => setEmpresasOpen((v) => !v)}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: empresaSel.size ? colors.brand : colors.border, backgroundColor: colors.surface }}
        >
          <Text style={{ color: empresaSel.size ? colors.brandText : colors.text, fontWeight: '800', fontSize: 12, flex: 1 }} numberOfLines={1}>
            🏢 {empresaSel.size === 0
              ? `Todas · ${estadoFiltered.length}`
              : empresaCounts.filter((c) => empresaSel.has(c.key)).map((c) => c.name).join(', ')}
          </Text>
          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{empresasOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {empresaSel.size > 0 ? (
          <TouchableOpacity onPress={() => setEmpresaSel(new Set())} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {empresasOpen ? (
        <Card>
          <TextInput
            value={empresaQ}
            onChangeText={setEmpresaQ}
            placeholder="🔎 Buscar empresa…"
            placeholderTextColor={colors.muted}
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
          />
          <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <TouchableOpacity
                onPress={() => setEmpresaSel(new Set())}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: empresaSel.size === 0 ? colors.brand : colors.border, backgroundColor: empresaSel.size === 0 ? colors.brand : colors.surface }}
              >
                <Text style={{ color: empresaSel.size === 0 ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>Todas · {estadoFiltered.length}</Text>
              </TouchableOpacity>
              {empresaCounts.filter((c) => !empresaQ.trim() || norm(c.name).includes(norm(empresaQ))).map((c) => {
                const on = empresaSel.has(c.key);
                return (
                  <TouchableOpacity
                    key={c.key}
                    onPress={() => setEmpresaSel((prev) => { const s = new Set(prev); if (s.has(c.key)) s.delete(c.key); else s.add(c.key); return s; })}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}
                  >
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{on ? '✓ ' : ''}{c.name} · {c.n}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
            Marca una o varias empresas. El filtro se combina con el estado y el cargo, y el 📊 Reporte sale con lo seleccionado.
          </Text>
        </Card>
      ) : null}

      {/* Orden alfabético por nombre */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginRight: spacing.xs }}>Orden:</Text>
        {([['az', 'A → Z'], ['za', 'Z → A']] as const).map(([key, label]) => {
          const on = sortDir === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setSortDir(key)}
              style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}
            >
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Filtro por CARGO (tipo) + reporte por cargo */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <TouchableOpacity onPress={() => setCargosOpen((v) => !v)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🏷️ Cargo: </Text>
            <Text style={{ color: cargoSel.size ? colors.brandText : colors.muted, fontWeight: '800', fontSize: 14, flex: 1 }} numberOfLines={1}>
              {cargoSel.size === 0 ? 'Todos' : Array.from(cargoSel).sort().join(', ')}
            </Text>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>{cargosOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={reporteSeleccion} disabled={busy === 'reporte-cargo'} style={{ backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, opacity: busy === 'reporte-cargo' ? 0.6 : 1 }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12 }}>{busy === 'reporte-cargo' ? 'Generando…' : '📊 Reporte'}</Text>
          </TouchableOpacity>
        </View>
        {cargosOpen ? (
          <View style={{ marginTop: spacing.sm }}>
            <TextInput value={cargoQ} onChangeText={setCargoQ} placeholder="🔎 Buscar cargo…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }} />
            <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                <TouchableOpacity
                  onPress={() => setCargoSel(new Set())}
                  style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: cargoSel.size === 0 ? colors.brand : colors.border, backgroundColor: cargoSel.size === 0 ? colors.brand : colors.surface }}
                >
                  <Text style={{ color: cargoSel.size === 0 ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>Todos · {baseFiltered.length}</Text>
                </TouchableOpacity>
                {cargoCounts.filter(([cargo]) => !cargoQ.trim() || norm(cargo).includes(norm(cargoQ))).map(([cargo, n]) => {
                  const on = cargoSel.has(cargo);
                  return (
                    <TouchableOpacity
                      key={cargo}
                      onPress={() => setCargoSel((prev) => { const s = new Set(prev); if (s.has(cargo)) s.delete(cargo); else s.add(cargo); return s; })}
                      style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}
                    >
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{on ? '✓ ' : ''}{cargo} · {n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
              Busca y marca varios cargos (operadores, obreros…). El botón 📊 Reporte genera el listado de lo seleccionado + resumen por cargo.
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
                          <Badge label={e.status} tone={employeeStatusTone(e.status)} />
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{[e.cargo ? canonicalCargo(e.cargo) : '', e.ficha_number ? `Ficha ${e.ficha_number}` : ''].filter(Boolean).join(' · ')}</Text>
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
                        <Btn label={busy === e.id + '-const' ? 'Generando…' : '📄 Const. carnet'} color="#0F766E" disabled={busy === e.id + '-const'} onPress={() => imprimirConstancia(e)} />
                        <Btn label={busy === e.id + '-const-trab' ? 'Generando…' : '📃 Constancia de trabajo'} color="#1E3A5F" disabled={busy === e.id + '-const-trab'} onPress={() => { setConstanciaFor(e); setConstanciaConMonto(false); }} />
                        <Btn label={busy === e.id + '-photo' ? 'Subiendo…' : '📷 Foto'} color={colors.success} disabled={busy === e.id + '-photo'} onPress={() => subirFoto(e)} />
                        {e.photo_url ? (
                          <Btn label="🗑️ Quitar foto" color={colors.danger} disabled={busy === e.id + '-photo'} onPress={() => borrarFoto(e)} />
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

      {/* CONSTANCIA DE TRABAJO — ¿lleva el sueldo o no?
          Arranca SIN marcar: la constancia por defecto sigue siendo la de
          siempre, sin mencionar el monto. Se marca cuando el trámite lo pide
          (banco, crédito, alquiler). Ver `src/lib/montoQuincenal.ts`. */}
      <Modal visible={!!constanciaFor} transparent animationType="fade" onRequestClose={() => setConstanciaFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>📃 Constancia de trabajo</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2, marginBottom: spacing.md }}>
              {constanciaFor ? fullName(constanciaFor) : ''}
            </Text>

            {(() => {
              const m = constanciaFor ? montoQuincenal(constanciaFor as any) : null;
              const hay = !!m;
              return (
                <>
                  <TouchableOpacity
                    onPress={() => hay && setConstanciaConMonto((v) => !v)}
                    activeOpacity={hay ? 0.7 : 1}
                    style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, opacity: hay ? 1 : 0.55 }}
                  >
                    <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: constanciaConMonto && hay ? colors.primary : colors.border, backgroundColor: constanciaConMonto && hay ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                      {constanciaConMonto && hay ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 14 }}>✓</Text> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>💵 Incluir el monto quincenal</Text>
                      {hay ? (
                        <>
                          <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 18, marginTop: 2 }}>
                            {montoQuincenalTexto(constanciaFor as any)}
                          </Text>
                          {/* De dónde salió el número. Va SOLO en pantalla: el PDF
                              dice "remuneración quincenal" y nada más. */}
                          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{m!.detalle}</Text>
                        </>
                      ) : (
                        <Text style={{ color: colors.danger, fontSize: 12, marginTop: 2, fontWeight: '700' }}>
                          Esta persona no tiene sueldo cargado (ni quincenal, ni semanal, ni mensual), así que no hay monto que poner. Cárgaselo en su ficha y vuelve a intentarlo.
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                    <TouchableOpacity onPress={() => setConstanciaFor(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={!!busy}
                      onPress={() => constanciaFor && imprimirConstanciaTrabajo(constanciaFor, constanciaConMonto && hay)}
                      style={{ flex: 2, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: '#1E3A5F', opacity: busy ? 0.6 : 1 }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800' }}>
                        {busy ? 'Generando…' : constanciaConMonto && hay ? '📄 Generar CON monto' : '📄 Generar sin monto'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
