// 👤 Quién retira el material del almacén (02-nov-2026). El MISMO en Requerimientos
// y en Solicitudes de compra. Busca en nómina y en choferes/operadores (solo
// lectura); lo escrito a mano queda SOLO en este retiro — no crea empleados ni
// toca la nómina.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { PersonaRetiro, personasParaRetiro, buscarPersonasRetiro } from '../lib/personaRetiro';

export type DatosRetira = { nombre: string; cedula: string; cargo: string; employeeId: string | null };

export default function PersonaRetiroPicker({ valor, onChange, maquinas, onElegirMaquina, inputStyle }: {
  valor: DatosRetira;
  onChange: (v: DatosRetira) => void;
  /** Para mostrar el código de la máquina del chofer/operador. */
  maquinas?: readonly { id: string; code?: string | null; plate?: string | null }[];
  /** Si la persona es operador de una máquina, la ofrece como destino. */
  onElegirMaquina?: (machineryId: string) => void;
  inputStyle: any;
}) {
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [empleados, setEmpleados] = useState<any[]>([]);
  const [operadores, setOperadores] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      // Solo lectura y solo las columnas que hacen falta (nada de sueldos).
      // Si una lista falla, se sigue con la otra: el nombre siempre se puede escribir.
      const [emp, ope] = await Promise.all([
        supabase.from('employees').select('id, first_name, last_name, cedula, cargo, status')
          .then((r) => r.data ?? [], () => [] as any[]),
        supabase.from('machine_operators').select('machinery_id, employee_id, operator_name, cedula, active')
          .then((r) => r.data ?? [], () => [] as any[]),
      ]);
      if (!vivo) return;
      setEmpleados(emp as any[]);
      setOperadores(ope as any[]);
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, []);

  const codigoDe = useMemo(() => {
    const m = new Map((maquinas ?? []).map((x) => [String(x.id), [x.code, x.plate].filter(Boolean).join(' · ')]));
    return (id: string) => m.get(id) ?? '';
  }, [maquinas]);
  const lista = useMemo(() => personasParaRetiro(empleados, operadores, codigoDe), [empleados, operadores, codigoDe]);
  const resultados = useMemo(() => buscarPersonasRetiro(lista, q), [lista, q]);

  const elegir = (p: PersonaRetiro) => {
    onChange({ nombre: p.nombre, cedula: p.cedula, cargo: p.cargo, employeeId: p.employeeId });
    if (p.machineryId && onElegirMaquina) onElegirMaquina(p.machineryId);
    setQ('');
  };
  // Si se edita a mano el nombre de alguien elegido de nómina, deja de ser esa
  // ficha: se suelta el vínculo para no atarle el retiro a otra persona.
  const editar = (campo: 'nombre' | 'cedula' | 'cargo', texto: string) => {
    onChange({ ...valor, [campo]: texto, employeeId: campo === 'nombre' ? null : valor.employeeId });
  };

  return (
    <View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar en nómina o choferes (nombre, cédula, cargo, máquina)…"
        placeholderTextColor={colors.muted}
        style={[inputStyle, { marginBottom: 6, fontSize: 12 }]}
      />
      {q.trim().length > 0 ? (
        <View style={{ maxHeight: 200, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, marginBottom: 8, overflow: 'hidden' }}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {resultados.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 11.5, padding: 8 }}>
                {cargando ? 'Cargando nómina…' : 'No está en nómina ni en choferes. Escribe sus datos abajo: quedan solo en este retiro.'}
              </Text>
            ) : resultados.map((p) => (
              <TouchableOpacity key={p.clave} onPress={() => elegir(p)} style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                  {p.nombre}{!p.activo ? ' (inactivo)' : ''}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {p.fuente === 'nomina' ? '👥 Nómina' : '🚜 Chofer / operador'}
                  {p.cedula ? ` · CI: ${p.cedula}` : ''}
                  {p.fuente === 'nomina' && p.cargo ? ` · ${p.cargo}` : ''}
                  {p.maquina ? ` · ${p.maquina}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
        <Text style={{ color: colors.muted, fontSize: 11 }}>Nombre completo de quien retira</Text>
        {valor.nombre.trim() ? (
          valor.employeeId ? (
            <TouchableOpacity onPress={() => onChange({ ...valor, employeeId: null })}>
              <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>👥 De nómina · ✕ soltar</Text>
            </TouchableOpacity>
          ) : (
            <Text style={{ color: colors.muted, fontSize: 11 }}>✍️ Solo para este retiro</Text>
          )
        ) : null}
      </View>
      <TextInput
        value={valor.nombre}
        onChangeText={(t) => editar('nombre', t)}
        placeholder="Nombre y apellido"
        placeholderTextColor={colors.muted}
        style={[inputStyle, { marginBottom: 6 }]}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: 6 }}>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cédula</Text>
          <TextInput value={valor.cedula} onChangeText={(t) => editar('cedula', t)} placeholder="V-12345678" placeholderTextColor={colors.muted} style={inputStyle} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cargo / rol</Text>
          <TextInput value={valor.cargo} onChangeText={(t) => editar('cargo', t)} placeholder="Ej. Mecánico, Chofer" placeholderTextColor={colors.muted} style={inputStyle} />
        </View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 10.5 }}>
        Lo que escribas a mano se guarda solo en este retiro: no se crea ni se cambia ningún empleado de nómina.
      </Text>
    </View>
  );
}
