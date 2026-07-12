import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { RecordForm, Field } from '../components/RecordForm';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm } from '../lib/text';
import { captureAndUploadPhoto } from '../lib/photo';
import { qrSvg, employeeQrUrl } from '../lib/qr';
import { carnetHtml, fullName } from '../lib/carnet';
import { exportPdf } from '../lib/pdf';
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
  { key: 'company_id', label: 'Empresa', type: 'lookup', table: 'companies', labelCol: 'name' },
  { key: 'cargo', label: 'Cargo', type: 'suggest', table: 'employees', column: 'cargo' },
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
  { key: 'bank_name', label: 'Banco', type: 'select', options: BANCOS_VE },
  { key: 'bank_account', label: 'N° de cuenta', type: 'text' },
  { key: 'bank_cedula', label: 'Cédula del titular', type: 'text' },
  { key: 'notes', label: 'Notas', type: 'text' },
];

export default function EmpleadosScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { data: employees, loading, refetch } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');

  const q = norm(query.trim());
  const shown = useMemo(
    () => employees.filter((e) =>
      !q ||
      norm(fullName(e)).includes(q) ||
      norm(e.cedula).includes(q) ||
      norm(e.ficha_number).includes(q) ||
      norm(e.cargo).includes(q) ||
      norm(companyName(e.company_id)).includes(q)
    ),
    [employees, q, companies]
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
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [shown, companies]);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (e: Employee) => { setEditing(e); setFormOpen(true); };

  const subirFoto = async (e: Employee) => {
    setBusy(e.id + '-photo');
    const r = await captureAndUploadPhoto(e.id, 'empleados');
    if (r.ok && r.url) {
      const { error } = await supabase.from('employees').update({ photo_url: r.url }).eq('id', e.id);
      if (error) Alert.alert('Aviso', error.message); else refetch();
    } else if (r.error) {
      Alert.alert('Aviso', r.error);
    }
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

      {loading && employees.length === 0 ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title={q ? 'Sin resultados' : 'Sin empleados'} subtitle={q ? 'Prueba con otra búsqueda.' : 'Toca "+ Nuevo" para registrar el primero.'} />
      ) : (
        byCompany.map((g) => {
          const open = expanded[g.key] ?? !!q;
          return (
            <View key={g.key} style={{ marginBottom: spacing.xs }}>
              <TouchableOpacity
                onPress={() => setExpanded((p) => ({ ...p, [g.key]: !open }))}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.primary : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.sm }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                  <Text style={{ color: open ? colors.primaryContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                  <Text style={{ color: open ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {g.name}</Text>
                </View>
                <View style={{ backgroundColor: open ? colors.primaryContrast : colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                  <Text style={{ color: open ? colors.primary : colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{g.items.length}</Text>
                </View>
              </TouchableOpacity>
              {open ? g.items.map((e) => (
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
                          🏦 {[e.bank_name, e.bank_account ? `Cta. ${e.bank_account}` : '', e.bank_cedula ? `C.I ${e.bank_cedula}` : ''].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                        <Btn label="✎ Editar" color="#475569" onPress={() => openEdit(e)} />
                        <Btn label="🪪 Ficha" color="#2563EB" onPress={() => navigation.navigate('EmployeeCard', { employeeId: e.id })} />
                        <Btn label={busy === e.id + '-photo' ? 'Subiendo…' : '📷 Foto'} color="#059669" disabled={busy === e.id + '-photo'} onPress={() => subirFoto(e)} />
                      </View>
                    </>
                  }
                />
              )) : null}
            </View>
          );
        })
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
