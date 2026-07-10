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
  Image,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { DateField } from './DateField';

/** Predicado opcional: el campo solo se muestra si devuelve true. */
type ShowIf = (values: Record<string, string>) => boolean;

export type Field =
  | { key: string; label: string; type: 'text' | 'number' | 'date'; required?: boolean; placeholder?: string; showIf?: ShowIf; defaultValue?: string }
  | { key: string; label: string; type: 'select'; options: { label: string; value: string }[]; required?: boolean; showIf?: ShowIf }
  | {
      key: string;
      label: string;
      type: 'suggest';
      /** Tabla y columna de TEXTO de donde se leen los valores ya usados (para el desplegable). */
      table: string;
      column: string;
      required?: boolean;
      placeholder?: string;
      showIf?: ShowIf;
    }
  | {
      key: string;
      label: string;
      type: 'lookup';
      table: string;
      labelCol: string;
      required?: boolean;
      /** Si se define, el selector es buscable y permite crear una opción nueva
       *  escribiendo su valor (se guarda en `createColumn` de la tabla). */
      createColumn?: string;
      /** Filtro de igualdad opcional para acotar las opciones (p. ej. { role: 'operador' }). */
      filter?: Record<string, string | number | boolean>;
      showIf?: ShowIf;
    };

type Option = { label: string; value: string };

/** Etiqueta corta para botones: si el nombre trae siglas entre paréntesis
 *  (p. ej. "Ferreconstruccion 3-G (F3G)") muestra sólo las siglas ("F3G").
 *  El valor guardado no cambia (se guarda el id del registro). */
function shortLabel(label: string): string {
  const m = label.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : label;
}

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
  fixedValues,
  uniqueField,
  record,
  allowDelete = false,
  headerImageUrl,
  onClose,
  onSaved,
}: {
  visible: boolean;
  title: string;
  table: string;
  fields: Field[];
  /** Columna que debe rellenarse con el id del usuario autenticado (p. ej. requested_by). */
  autoUserField?: string;
  /** Valores fijos que se guardan siempre (aunque no haya campo visible). P. ej. machinery_type. */
  fixedValues?: Record<string, any>;
  /** Evita duplicados en una o varias columnas (p. ej. serial y placa); muestra "YA EXISTE …". */
  uniqueField?: { key: string; labelCol: string; labelName?: string } | { key: string; labelCol: string; labelName?: string }[];
  /** Si se pasa un registro existente, el formulario edita (UPDATE) en vez de crear (INSERT). */
  record?: (Record<string, any> & { id: string }) | null;
  /** Muestra el botón "Eliminar" cuando se está editando un registro. */
  allowDelete?: boolean;
  /** URL de una foto (p. ej. de la máquina) que se muestra arriba del formulario. */
  headerImageUrl?: string | null;
  onClose: () => void;
  /** Se llama tras guardar. Recibe el id del registro guardado (para resaltarlo sin saltar al inicio). */
  onSaved: (savedId?: string) => void;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isEdit = !!record;
  const [values, setValues] = useState<Record<string, string>>({});
  const [lookups, setLookups] = useState<Record<string, Option[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [askDelete, setAskDelete] = useState(false);

  const fieldDefaults = useMemo(() => {
    const o: Record<string, string> = {};
    fields.forEach((f) => {
      if (f.type === 'date') o[f.key] = todayISO();
      if ('defaultValue' in f && f.defaultValue) o[f.key] = f.defaultValue;
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
      setValues({ ...fieldDefaults });
    }
    setError(null);
    setAskDelete(false);
    // Cargar opciones de los campos lookup y las sugerencias de los campos "suggest".
    fields.forEach(async (f) => {
      if (f.type === 'lookup') {
        let qb: any = supabase.from(f.table).select(`id, ${f.labelCol}`);
        if (f.filter) Object.entries(f.filter).forEach(([col, val]) => { qb = qb.eq(col, val); });
        const { data } = await qb;
        setLookups((prev) => ({
          ...prev,
          [f.key]: (data ?? []).map((r: any) => ({ label: String(r[f.labelCol]), value: r.id })),
        }));
      } else if (f.type === 'suggest') {
        const { data } = await supabase.from(f.table).select(f.column);
        // Valores distintos (MAYÚS, sin espacios extra), ordenados alfabéticamente.
        const set = new Map<string, string>();
        (data ?? []).forEach((r: any) => {
          const v = String(r[f.column] ?? '').trim();
          if (v) set.set(v.toUpperCase(), v.toUpperCase());
        });
        const opts = Array.from(set.values()).sort((a, b) => a.localeCompare(b)).map((v) => ({ label: v, value: v }));
        setLookups((prev) => ({ ...prev, [f.key]: opts }));
      }
    });
  }, [visible, record]);

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));

  // Campos visibles según el estado actual (p. ej. vehículo vs maquinaria).
  const visibleFields = fields.filter((f) => !f.showIf || f.showIf(values));

  const submit = async () => {
    setError(null);
    // Validación de requeridos (solo campos visibles)
    for (const f of visibleFields) {
      if (f.required && !values[f.key]) {
        setError(`El campo "${f.label}" es obligatorio.`);
        return;
      }
    }
    const payload: Record<string, any> = {};
    visibleFields.forEach((f) => {
      const raw = values[f.key];
      if (raw === undefined) return;
      if (raw === '') {
        // Al editar, un campo que se deja en blanco debe vaciarse (null),
        // no conservar el valor anterior. Al crear, simplemente se omite.
        if (isEdit) payload[f.key] = null;
        return;
      }
      payload[f.key] = f.type === 'number' ? Number(raw) : raw;
    });

    if (fixedValues) Object.assign(payload, fixedValues);

    // Validar unicidad (p. ej. serial y placa): "YA EXISTE …".
    const uniqueChecks = Array.isArray(uniqueField) ? uniqueField : uniqueField ? [uniqueField] : [];
    for (const uf of uniqueChecks) {
      if (payload[uf.key] == null || String(payload[uf.key]).trim() === '') continue;
      let q = supabase
        .from(table)
        .select(`id, ${uf.labelCol}`)
        .ilike(uf.key, String(payload[uf.key]).trim());
      if (isEdit) q = q.neq('id', record!.id);
      const { data: dup } = await q.limit(1);
      if (dup && dup.length > 0) {
        const nombre = uf.labelName ?? uf.key;
        setError(`YA EXISTE: "${(dup[0] as any)[uf.labelCol]}" con ese ${nombre}.`);
        return;
      }
    }

    if (autoUserField && !isEdit) {
      const { data } = await supabase.auth.getUser();
      if (data.user) payload[autoUserField] = data.user.id;
    }

    setSaving(true);
    let savedId: string | undefined = isEdit ? record!.id : undefined;
    let error;
    if (isEdit) {
      ({ error } = await supabase.from(table).update(payload).eq('id', record!.id));
    } else {
      const res = await supabase.from(table).insert(payload).select('id').single();
      error = res.error;
      savedId = (res.data as any)?.id;
    }
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved(savedId);
    onClose();
  };

  const remove = async () => {
    if (!record) return;
    setAskDelete(false);
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
          {isEdit && headerImageUrl ? (
            <Image
              source={{ uri: headerImageUrl }}
              style={{ width: '100%', height: 180, borderRadius: radius.md, marginBottom: spacing.md, backgroundColor: colors.surfaceAlt }}
              resizeMode="cover"
            />
          ) : null}
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.sm }}>
            {visibleFields.map((f) => (
              <View key={f.key} style={{ gap: 4 }}>
                <Text style={typography.muted}>
                  {f.label}
                  {f.required ? ' *' : ''}
                </Text>
                {f.type === 'select' ? (
                  <ChipSelect options={f.options} value={values[f.key]} onChange={(v) => set(f.key, v)} />
                ) : f.type === 'suggest' ? (
                  <SuggestSelect options={lookups[f.key] ?? []} value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} placeholder={f.placeholder} />
                ) : f.type === 'date' ? (
                  <DateField value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} />
                ) : f.type === 'lookup' ? (
                  <SearchSelect
                    options={lookups[f.key] ?? []}
                    value={values[f.key]}
                    onChange={(v) => set(f.key, v)}
                    table={f.table}
                    createColumn={f.createColumn}
                    onCreated={(opt) =>
                      setLookups((prev) => ({ ...prev, [f.key]: [...(prev[f.key] ?? []), opt] }))
                    }
                  />
                ) : (
                  <TextInput
                    style={styles.input}
                    value={values[f.key] ?? ''}
                    onChangeText={(t) => set(f.key, t)}
                    placeholder={('placeholder' in f && f.placeholder) || ''}
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
            <TouchableOpacity style={styles.btnDelete} onPress={() => setAskDelete(true)} disabled={deleting}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>
                {deleting ? 'Eliminando…' : '🗑️ Eliminar'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {askDelete ? (
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmBox}>
                <Text style={[typography.title, { marginBottom: spacing.sm, textAlign: 'center' }]}>
                  Eliminar
                </Text>
                <Text style={{ color: colors.text, textAlign: 'center', marginBottom: spacing.md }}>
                  ¿Desea eliminar este registro? Esta acción no se puede deshacer.
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGhost]}
                    onPress={() => setAskDelete(false)}
                    disabled={deleting}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: colors.danger }]}
                    onPress={remove}
                    disabled={deleting}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>
                      {deleting ? 'Eliminando…' : 'Aceptar'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** Selector buscable con opción de crear una entrada nueva en el catálogo. */
function SearchSelect({
  options,
  value,
  onChange,
  table,
  createColumn,
  onCreated,
}: {
  options: Option[];
  value?: string;
  onChange: (v: string) => void;
  table: string;
  createColumn?: string;
  onCreated: (opt: Option) => void;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const exactExists = options.some((o) => o.label.toLowerCase() === q);
  // El buscador solo aparece si hay muchas opciones o si se pueden crear nuevas.
  const showSearch = !!createColumn || options.length > 8;

  const create = async () => {
    if (!createColumn || !query.trim()) return;
    setCreating(true);
    const { data, error } = await supabase
      .from(table)
      .insert({ [createColumn]: query.trim() } as any)
      .select()
      .single();
    setCreating(false);
    if (error || !data) return;
    const opt = { label: query.trim(), value: (data as any).id };
    onCreated(opt);
    onChange(opt.value);
    setQuery('');
  };

  return (
    <View style={{ gap: spacing.xs }}>
      {showSearch ? (
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar…"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
        />
      ) : null}
      <View style={styles.grid}>
        {filtered.slice(0, 30).map((o) => {
          const active = o.value === value;
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => onChange(o.value)}
              style={[styles.gridBtn, active && styles.gridBtnActive]}
            >
              <Text
                numberOfLines={2}
                style={{
                  color: active ? colors.primaryContrast : colors.text,
                  fontSize: 15,
                  fontWeight: '600',
                  textAlign: 'center',
                }}
              >
                {shortLabel(o.label)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {createColumn && query.trim() && !exactExists ? (
        <TouchableOpacity onPress={create} disabled={creating} style={styles.createBtn}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>
            {creating ? 'Agregando…' : `+ Agregar "${query.trim()}"`}
          </Text>
        </TouchableOpacity>
      ) : null}
      {!options.length ? <Text style={typography.muted}>Escribe para crear el primero.</Text> : null}
    </View>
  );
}

/** Campo de texto con desplegable de valores ya usados (reutilizables) y opción de escribir uno nuevo.
 *  El valor guardado es el TEXTO (no un id), pensado para columnas de texto como `clasificacion`. */
function SuggestSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const q = (value ?? '').trim().toLowerCase();
  // Al escribir, filtra las sugerencias; si el campo está vacío las muestra todas.
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const exactExists = options.some((o) => o.label.toLowerCase() === q);
  return (
    <View style={{ gap: spacing.xs }}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={(t) => onChange(t.toUpperCase())}
        placeholder={placeholder || 'Escribe o elige una…'}
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
      />
      {filtered.length > 0 ? (
        <View style={styles.grid}>
          {filtered.slice(0, 30).map((o) => {
            const active = o.label.toLowerCase() === q;
            return (
              <TouchableOpacity key={o.value} onPress={() => onChange(o.label)} style={[styles.gridBtn, active && styles.gridBtnActive]}>
                <Text numberOfLines={2} style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' }}>
                  {o.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
      {q && !exactExists ? (
        <Text style={[typography.muted, { fontSize: 12 }]}>Se guardará como nueva: “{value.trim()}”.</Text>
      ) : null}
    </View>
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
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (options.length === 0) {
    return <Text style={typography.muted}>Sin opciones disponibles</Text>;
  }
  return (
    <View style={styles.grid}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.gridBtn, active && styles.gridBtnActive]}
          >
            <Text
              style={{
                color: active ? colors.primaryContrast : colors.text,
                fontSize: 15,
                fontWeight: '600',
                textAlign: 'center',
              }}
            >
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
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
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  optionRowActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  gridBtn: {
    flexGrow: 1,
    flexBasis: 90,
    minWidth: 90,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  gridBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  selectedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  createBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
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
  confirmOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  confirmBox: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
});
