import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography } from '../theme';

export type Field =
  | { key: string; label: string; type: 'text' | 'number' | 'date'; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'select'; options: { label: string; value: string }[]; required?: boolean }
  | { key: string; label: string; type: 'lookup'; table: string; labelCol: string; required?: boolean };

type Option = { label: string; value: string };

function todayISO() {
  // Evita Date.now(); usa la fecha local del dispositivo a través del input.
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function RecordForm({
  visible,
  title,
  table,
  fields,
  autoUserField,
  record,
  allowDelete = false,
  onClose,
  onSaved,
}: {
  visible: boolean;
  title: string;
  table: string;
  fields: Field[];
  /** Columna que debe rellenarse con el id del usuario autenticado (p. ej. requested_by). */
  autoUserField?: string;
  /** Si se pasa un registro existente, el formulario edita (UPDATE) en vez de crear (INSERT). */
  record?: (Record<string, any> & { id: string }) | null;
  /** Muestra el botón "Eliminar" cuando se está editando un registro. */
  allowDelete?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!record;
  const [values, setValues] = useState<Record<string, string>>({});
  const [lookups, setLookups] = useState<Record<string, Option[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dateDefaults = useMemo(() => {
    const o: Record<string, string> = {};
    fields.forEach((f) => {
      if (f.type === 'date') o[f.key] = todayISO();
    });
    return o;
  }, [fields]);

  useEffect(() => {
    if (!visible) return;
    if (record) {
      // Modo edición: pre-rellenar con los valores existentes (como texto).
      const pre: Record<string, string> = {};
      fields.forEach((f) => {
        const v = record[f.key];
        if (v !== null && v !== undefined) pre[f.key] = String(v);
      });
      setValues(pre);
    } else {
      setValues({ ...dateDefaults });
    }
    setError(null);
    setConfirmDelete(false);
    // Cargar opciones de los campos lookup
    fields.forEach(async (f) => {
      if (f.type === 'lookup') {
        const { data } = await supabase.from(f.table).select(`id, ${f.labelCol}`);
        setLookups((prev) => ({
          ...prev,
          [f.key]: (data ?? []).map((r: any) => ({ label: String(r[f.labelCol]), value: r.id })),
        }));
      }
    });
  }, [visible, record]);

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setError(null);
    // Validación de requeridos
    for (const f of fields) {
      if (f.required && !values[f.key]) {
        setError(`El campo "${f.label}" es obligatorio.`);
        return;
      }
    }
    const payload: Record<string, any> = {};
    fields.forEach((f) => {
      const raw = values[f.key];
      if (raw === undefined || raw === '') return;
      payload[f.key] = f.type === 'number' ? Number(raw) : raw;
    });

    if (autoUserField && !isEdit) {
      const { data } = await supabase.auth.getUser();
      if (data.user) payload[autoUserField] = data.user.id;
    }

    setSaving(true);
    const { error } = isEdit
      ? await supabase.from(table).update(payload).eq('id', record!.id)
      : await supabase.from(table).insert(payload);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!record) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setError(null);
    setDeleting(true);
    const { error } = await supabase.from(table).delete().eq('id', record.id);
    setDeleting(false);
    if (error) {
      const fk = error.code === '23503' || error.message.toLowerCase().includes('foreign key');
      setError(
        fk
          ? 'No se puede eliminar: tiene movimientos o registros asociados (ingresos, consumos o traslados).'
          : error.message
      );
      setConfirmDelete(false);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={[typography.title, { marginBottom: spacing.md }]}>{title}</Text>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.sm }}>
            {fields.map((f) => (
              <View key={f.key} style={{ gap: 4 }}>
                <Text style={typography.muted}>
                  {f.label}
                  {f.required ? ' *' : ''}
                </Text>
                {f.type === 'select' || f.type === 'lookup' ? (
                  <ChipSelect
                    options={f.type === 'select' ? f.options : lookups[f.key] ?? []}
                    value={values[f.key]}
                    onChange={(v) => set(f.key, v)}
                  />
                ) : (
                  <TextInput
                    style={styles.input}
                    value={values[f.key] ?? ''}
                    onChangeText={(t) => set(f.key, t)}
                    placeholder={('placeholder' in f && f.placeholder) || (f.type === 'date' ? 'AAAA-MM-DD' : '')}
                    placeholderTextColor={colors.muted}
                    keyboardType={f.type === 'number' ? 'numeric' : 'default'}
                    autoCapitalize="none"
                  />
                )}
              </View>
            ))}
          </ScrollView>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={submit} disabled={saving}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Text>
            </TouchableOpacity>
          </View>

          {isEdit && allowDelete ? (
            <TouchableOpacity style={styles.btnDelete} onPress={remove} disabled={deleting}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>
                {deleting
                  ? 'Eliminando…'
                  : confirmDelete
                  ? '¿Confirmar eliminación? Toca de nuevo'
                  : 'Eliminar'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function ChipSelect({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value?: string;
  onChange: (v: string) => void;
}) {
  if (options.length === 0) {
    return <Text style={typography.muted}>Sin opciones disponibles</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 13 }}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: colors.text,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  error: { color: colors.danger, marginTop: spacing.sm },
  btn: { flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
  btnGhost: { backgroundColor: colors.surfaceAlt },
  btnPrimary: { backgroundColor: colors.primary },
  btnDelete: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
  },
});
