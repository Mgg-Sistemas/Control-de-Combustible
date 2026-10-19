// 👤 CHOFERES POR CAMIÓN (19-oct-2026) — pedido del cliente: «que yo pueda
// modificar o colocar los choferes».
//
// Vive en «Viajes de camiones → ⚙️ Configuración» (solo full). NO inventa una
// tabla nueva: escribe en `machine_operators` (la asignación planeada
// operador↔máquina POR TURNO que ya administra el Coordinador de Operadores),
// con las MISMAS funciones (`assignOperator`/`unassignOperator`). Es la tabla
// de la que cada viaje CONGELA su `chofer_name` al registrarse
// (`resolveChoferActual`): por eso la columna «Chofer» de los reportes salía
// vacía — a los camiones nadie les había asignado chofer.
//
// REGLAS:
//  · Un chofer por camión y turno (☀️ día / 🌙 noche); asignar REEMPLAZA.
//  · Cambiarlo afecta los viajes que se registren DESPUÉS; los ya registrados
//    conservan su chofer congelado (ese se corrige viaje por viaje en ✏️ Editar).
//  · La lista sale de Empleados activos con cargo de operador/chofer/obrero/
//    servicios generales (misma regla del Coordinador), y también se puede
//    escribir un nombre a mano (queda sin empleado enlazado).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { supabase } from '../lib/supabase';
import { isOperatorCargo } from '../lib/jornada';
import {
  assignOperator, unassignOperator, listOperatorAssignments, shiftIcon, shiftLabel, type Shift,
} from '../lib/machineOperators';

export type CamionParaChofer = {
  id: string; code: string; plate: string | null; serial: string | null; companyName?: string | null;
};

type Empleado = { id: string; name: string; cedula: string | null };

const norm = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function ChoferesCamionesBox({ camiones, uid }: { camiones: CamionParaChofer[]; uid: string | null }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [busca, setBusca] = useState('');
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  /** machineryId|shift → nombre asignado hoy. */
  const [asignado, setAsignado] = useState<Map<string, string>>(new Map());
  const [faltaSql, setFaltaSql] = useState(false);
  /** El turno que se está editando: camión + día/noche. */
  const [editando, setEditando] = useState<{ camionId: string; shift: Shift } | null>(null);
  const [buscaChofer, setBuscaChofer] = useState('');
  const [nombreLibre, setNombreLibre] = useState('');
  const [guardando, setGuardando] = useState(false);

  const idsCamiones = useMemo(() => new Set(camiones.map((c) => c.id)), [camiones]);

  const cargar = useCallback(async () => {
    const [{ rows, missing }, { data: emps }] = await Promise.all([
      listOperatorAssignments(),
      supabase.from('employees').select('id, first_name, last_name, cedula, cargo').eq('status', 'activo'),
    ]);
    setFaltaSql(missing);
    const m = new Map<string, string>();
    rows.forEach((r) => { if (idsCamiones.has(r.machinery_id)) m.set(`${r.machinery_id}|${r.shift}`, r.operator_name); });
    setAsignado(m);
    setEmpleados(((emps ?? []) as any[])
      .filter((e) => isOperatorCargo(e.cargo))
      .map((e) => ({ id: e.id, name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Sin nombre', cedula: e.cedula ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')));
  }, [idsCamiones]);
  useEffect(() => { if (abierto) cargar(); }, [abierto, cargar]);

  const poner = async (camionId: string, shift: Shift, emp: Empleado | null, libre?: string) => {
    if (guardando) return;
    const nombre = emp ? emp.name : String(libre ?? '').trim();
    if (!nombre) { toast.error('Elige un chofer de la lista o escribe su nombre.'); return; }
    setGuardando(true);
    const r = await assignOperator(camionId, emp?.id ?? null, nombre, emp?.cedula ?? null, shift, uid);
    setGuardando(false);
    if (r.error) { toast.error(r.error); return; }
    setEditando(null); setBuscaChofer(''); setNombreLibre('');
    toast.success(`${shiftIcon(shift)} Chofer de ${shiftLabel(shift).toLowerCase()}: ${nombre}. Los viajes que se registren desde ahora lo llevan.`);
    cargar();
  };

  const quitar = async (camionId: string, shift: Shift) => {
    if (guardando) return;
    setGuardando(true);
    const r = await unassignOperator(camionId, shift);
    setGuardando(false);
    if (r.error) { toast.error(r.error); return; }
    setEditando(null);
    toast.success(`${shiftIcon(shift)} Chofer de ${shiftLabel(shift).toLowerCase()} quitado.`);
    cargar();
  };

  const q = norm(busca);
  const lista = useMemo(() => camiones
    .filter((c) => !q || norm(`${c.code} ${c.plate ?? ''} ${c.serial ?? ''} ${c.companyName ?? ''}`).includes(q))
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }) || String(a.plate ?? '').localeCompare(String(b.plate ?? ''), 'es')),
  [camiones, q]);

  const qc = norm(buscaChofer);
  const candidatos = useMemo(() => empleados.filter((e) => !qc || norm(`${e.name} ${e.cedula ?? ''}`).includes(qc)).slice(0, 8), [empleados, qc]);

  const conChofer = useMemo(() => {
    const ids = new Set<string>();
    asignado.forEach((_, k) => ids.add(k.split('|')[0]));
    return ids.size;
  }, [asignado]);

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>👤 Choferes por camión</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            {abierto ? `${conChofer} de ${camiones.length} camión(es) con chofer asignado` : 'Quién maneja cada camión, por turno. Cada viaje lo congela al registrarse.'}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{abierto ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {abierto ? (
        <View style={{ marginTop: spacing.xs }}>
          {faltaSql ? (
            <Text style={{ color: colors.danger, fontSize: 11, marginBottom: 4 }}>Falta correr el SQL de machine_operators en Supabase.</Text>
          ) : null}
          <TextInput
            value={busca}
            onChangeText={setBusca}
            placeholder="🔎 Buscar camión: placa, código, serial, empresa…"
            placeholderTextColor={colors.muted}
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.xs }}
            autoCorrect={false}
          />
          <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
            {lista.map((c) => (
              <View key={c.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 5 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>
                  🚛 {c.code}{c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}
                </Text>
                {(['day', 'night'] as Shift[]).map((s) => {
                  const nombre = asignado.get(`${c.id}|${s}`) ?? null;
                  const abiertoAqui = editando?.camionId === c.id && editando?.shift === s;
                  return (
                    <View key={`${c.id}-${s}`}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                        <Text style={{ color: colors.muted, fontSize: 11.5, flex: 1 }}>
                          {shiftIcon(s)} {shiftLabel(s)}: {nombre ? <Text style={{ color: colors.text, fontWeight: '700' }}>{nombre}</Text> : <Text>sin chofer</Text>}
                        </Text>
                        <TouchableOpacity onPress={() => { setEditando(abiertoAqui ? null : { camionId: c.id, shift: s }); setBuscaChofer(''); setNombreLibre(''); }}>
                          <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 11.5 }}>{abiertoAqui ? 'Cerrar' : nombre ? '✏️ Cambiar' : '➕ Colocar'}</Text>
                        </TouchableOpacity>
                        {nombre ? (
                          <TouchableOpacity onPress={() => quitar(c.id, s)} style={{ marginLeft: spacing.sm }}>
                            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11.5 }}>✕</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      {abiertoAqui ? (
                        <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.xs, marginTop: 2 }}>
                          <TextInput
                            value={buscaChofer}
                            onChangeText={setBuscaChofer}
                            placeholder="🔎 Buscar chofer por nombre o cédula…"
                            placeholderTextColor={colors.muted}
                            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text }}
                            autoCorrect={false}
                          />
                          {candidatos.map((e) => (
                            <TouchableOpacity key={e.id} disabled={guardando} onPress={() => poner(c.id, s, e)} style={{ paddingVertical: 4 }}>
                              <Text style={{ color: colors.text, fontSize: 12 }}>👤 {e.name}{e.cedula ? ` · ${e.cedula}` : ''}</Text>
                            </TouchableOpacity>
                          ))}
                          {candidatos.length === 0 ? (
                            <Text style={{ color: colors.muted, fontSize: 11, paddingVertical: 2 }}>Nadie coincide en Empleados (cargo operador/chofer/obrero/servicios generales).</Text>
                          ) : null}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 }}>
                            <TextInput
                              value={nombreLibre}
                              onChangeText={setNombreLibre}
                              placeholder="✏️ O escribe el nombre a mano…"
                              placeholderTextColor={colors.muted}
                              style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text }}
                              autoCorrect={false}
                            />
                            <TouchableOpacity disabled={guardando || !nombreLibre.trim()} onPress={() => poner(c.id, s, null, nombreLibre)}
                              style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, opacity: guardando || !nombreLibre.trim() ? 0.5 : 1 }}>
                              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11.5 }}>💾</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
            {lista.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Ningún camión coincide con la búsqueda.</Text> : null}
          </ScrollView>
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
            El chofer se CONGELA en cada viaje al registrarse: cambiarlo aquí afecta los viajes que se registren después (los ya registrados se corrigen uno por uno en ✏️ Editar). Es la misma asignación que ve el Coordinador de Operadores.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
