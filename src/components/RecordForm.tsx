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
import { norm, cmpText, onlyDigits, onlyDecimal, corregirTexto } from '../lib/text';
import { caracasParts } from '../lib/jornada';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { DateField } from './DateField';

/** Predicado opcional: el campo solo se muestra si devuelve true. */
type ShowIf = (values: Record<string, string>) => boolean;

export type Field =
  | { key: string; label: string; type: 'section'; showIf?: ShowIf } // encabezado de sección (no es un campo)
  | { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'date'; required?: boolean; placeholder?: string; showIf?: ShowIf; defaultValue?: string } // 'textarea' = texto multilínea
  | { key: string; label: string; type: 'switch'; required?: boolean; showIf?: ShowIf; defaultValue?: boolean } // check Sí/No (booleano)
  | { key: string; label: string; type: 'select'; options: { label: string; value: string }[]; required?: boolean; showIf?: ShowIf; dropdown?: boolean; placeholder?: string }
  | {
      key: string;
      label: string;
      type: 'suggest';
      /** Tabla y columna de TEXTO de donde se leen los valores ya usados (para el desplegable). */
      table: string;
      column: string;
      required?: boolean;
      placeholder?: string;
      /** Muestra los valores como lista DESPLEGABLE buscable (se abre y se cierra),
       *  permitiendo también escribir uno nuevo. */
      dropdown?: boolean;
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
      /** Columna booleana opcional (p. ej. 'operational') para señalar visualmente las
       *  opciones inactivas/de baja SIN ocultarlas de la lista (el historial que las
       *  referencia debe seguir siendo consultable). Si la fila tiene ese campo en
       *  false, se le agrega el sufijo " (Inactiva)" a la etiqueta mostrada. */
      activeCol?: string;
      /** Muestra el campo como lista DESPLEGABLE (se abre y se cierra) en vez de la
       *  rejilla de botones siempre visible. Ideal para pocas opciones (empresas). */
      dropdown?: boolean;
      placeholder?: string;
      showIf?: ShowIf;
      /** Valor inicial (id) al CREAR un registro nuevo — p. ej. preseleccionar el
       *  tanque del encargado logueado. Se aplica solo en creación (line ~130). */
      defaultValue?: string;
      /** Columnas extra para distinguir opciones homónimas: se agregan al label como
       *  " · valor" (p. ej. ['location','responsable'] para tanques con igual nombre). */
      subLabelCols?: string[];
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
  // Fecha de HOY según la hora de Caracas (no la zona horaria del dispositivo).
  return caracasParts(new Date()).iso;
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
  beforeSave,
  validate,
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
  /** Hook para AJUSTAR el payload justo antes de guardar (INSERT/UPDATE). Recibe el
   *  payload (mutable) y los valores del formulario. Úsalo para columnas DERIVADAS
   *  (p. ej. mantener `tipo` = marca + modelo sincronizada). */
  beforeSave?: (payload: Record<string, any>, values: Record<string, string>) => void;
  /** Validación EXTRA (p. ej. "placa O serial"): devuelve un mensaje de error para
   *  ABORTAR el guardado, o null/undefined si todo está bien. Corre tras los requeridos. */
  validate?: (values: Record<string, string>) => string | null | undefined;
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
      else if (f.type === 'switch') o[f.key] = f.defaultValue ? 'true' : 'false';
      else if ('defaultValue' in f && f.defaultValue) o[f.key] = f.defaultValue as string;
    });
    return o;
  }, [fields]);

  // Firma ESTABLE del conjunto de campos que cargan opciones (lookup/suggest). Sirve
  // para saber cuándo hay que RECARGAR las opciones: si el formulario cambia de campos
  // en caliente —p. ej. un vehículo pasa de básico a ficha completa cuando resuelve el
  // probe `vehFicha`, apareciendo "Empresa supervisora"— la firma cambia y el efecto de
  // abajo vuelve a consultar. Antes las opciones solo se cargaban al abrir (deps
  // [visible, record]) y esos campos nuevos quedaban con el desplegable VACÍO.
  const optionsSig = fields
    .filter((f) => f.type === 'lookup' || f.type === 'suggest')
    .map((f: any) => `${f.type}:${f.key}:${f.table}:${f.column ?? f.labelCol ?? ''}:${JSON.stringify(f.filter ?? '')}`)
    .join('|');

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
  }, [visible, record]);

  // Carga las opciones de los campos lookup y las sugerencias de los "suggest". En su
  // propio efecto y con `optionsSig` en las deps para que se RECARGUE cuando cambia el
  // conjunto de campos (ficha básica → completa), no solo al abrir el formulario.
  useEffect(() => {
    if (!visible) return;
    fields.forEach(async (f) => {
      if (f.type === 'lookup') {
        // Columnas extra para DISTINGUIR opciones con el mismo nombre (p. ej. dos tanques
        // "TANQUE DE COMBUSTIBLE"): se agregan al label como " · valor" (ubicación,
        // responsable…). Solo se muestran las que tengan valor.
        const subCols = f.subLabelCols ?? [];
        const extra = [f.activeCol, ...subCols].filter(Boolean).join(', ');
        let qb: any = supabase.from(f.table).select(`id, ${f.labelCol}${extra ? `, ${extra}` : ''}`);
        if (f.filter) Object.entries(f.filter).forEach(([col, val]) => { qb = qb.eq(col, val); });
        const { data } = await qb;
        const activeCol = f.activeCol;
        setLookups((prev) => ({
          ...prev,
          [f.key]: (data ?? [])
            .map((r: any) => {
              const sub = subCols.map((c) => String(r[c] ?? '').trim()).filter(Boolean).join(' · ');
              const base = String(r[f.labelCol]);
              const withSub = sub ? `${base} · ${sub}` : base;
              return {
                label: activeCol && r[activeCol] === false ? `${withSub} (Inactiva)` : withSub,
                value: r.id,
              };
            })
            .sort((a: any, b: any) => cmpText(a.label, b.label)),
        }));
      } else if (f.type === 'suggest') {
        const { data } = await supabase.from(f.table).select(f.column);
        // Valores distintos (MAYÚS, sin espacios extra), ordenados alfabéticamente.
        const set = new Map<string, string>();
        (data ?? []).forEach((r: any) => {
          const v = String(r[f.column] ?? '').trim();
          if (v) set.set(v.toUpperCase(), v.toUpperCase());
        });
        const opts = Array.from(set.values()).sort(cmpText).map((v) => ({ label: v, value: v }));
        setLookups((prev) => ({ ...prev, [f.key]: opts }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, optionsSig]);

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));

  // Campos visibles según el estado actual (p. ej. vehículo vs maquinaria).
  const visibleFields = fields.filter((f) => !f.showIf || f.showIf(values));

  const submit = async () => {
    setError(null);
    // Validación de requeridos (solo campos visibles)
    for (const f of visibleFields) {
      if (f.type === 'section') continue;
      if (f.required && !values[f.key]) {
        setError(`El campo "${f.label}" es obligatorio.`);
        return;
      }
    }
    // Validación EXTRA de grupo (p. ej. "placa O serial", "marca O modelo").
    if (validate) {
      const msg = validate(values);
      if (msg) { setError(msg); return; }
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
      // Corrección ortográfica interna del texto libre (referencia, sector,
      // parroquia, encargado…). NO se toca serial/placa/código/identificador ni
      // correos/URLs/cuentas (se dañarían); ahí se guarda tal cual.
      const noFix = /serial|plate|placa|code|identif|mail|correo|url|http|account|cuenta|cedula|cédula/i.test(f.key);
      const esTextoLibre = (f.type === 'text' || f.type === 'textarea' || f.type === 'suggest') && !noFix;
      payload[f.key] = f.type === 'number' ? Number(raw) : f.type === 'switch' ? raw === 'true' : esTextoLibre ? corregirTexto(raw) : raw;
    });

    // Campos que quedaron OCULTOS por `showIf` con el estado actual (p. ej.
    // `machinery_id` cuando `type` pasó de 'maquina' a 'area'): al editar, se
    // limpian a null en vez de conservar el valor anterior huérfano. Al crear,
    // simplemente no se envían (ya quedan fuera de `visibleFields`).
    if (isEdit) {
      fields.forEach((f) => {
        if (f.type === 'section') return;
        if (f.showIf && !f.showIf(values)) payload[f.key] = null;
      });
    }

    if (fixedValues) Object.assign(payload, fixedValues);

    // Hook de columnas DERIVADAS (p. ej. tipo = marca + modelo) justo antes de guardar.
    if (beforeSave) beforeSave(payload, values);

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
      // La BD rechazó un duplicado (índice único, p. ej. serial/placa). Mensaje claro.
      if ((error as any).code === '23505' || /duplicate key|unique/i.test(error.message)) {
        const campo = /serial/i.test(error.message) ? 'serial' : /plate|placa/i.test(error.message) ? 'placa' : 'serial o placa';
        setError(`YA EXISTE otra máquina con ese ${campo}. No se permiten duplicados.`);
      } else {
        setError(error.message);
      }
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
            // Foto de la máquina COMPLETA (sin recortar). En WEB, la RN Image con
            // aspectRatio recortaba la imagen; usamos <img> con object-fit: contain
            // y una altura fija para que siempre se vea entera (con letterbox si hace falta).
            Platform.OS === 'web' ? (
              React.createElement('img', {
                src: headerImageUrl,
                style: {
                  width: '100%', maxWidth: 420, height: 240, objectFit: 'contain',
                  alignSelf: 'center', display: 'block', margin: '0 auto',
                  borderRadius: radius.md, marginBottom: spacing.md, backgroundColor: colors.surfaceAlt,
                },
              })
            ) : (
              <Image
                source={{ uri: headerImageUrl }}
                style={{ width: '100%', maxWidth: 420, height: 240, alignSelf: 'center', borderRadius: radius.md, marginBottom: spacing.md, backgroundColor: colors.surfaceAlt }}
                resizeMode="contain"
              />
            )
          ) : null}
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.sm }}>
            {visibleFields.map((f) => (
              f.type === 'section' ? (
                <Text key={f.key} style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginTop: spacing.sm, marginBottom: 2 }}>
                  {f.label}
                </Text>
              ) : (
              <View key={f.key} style={{ gap: 4 }}>
                <Text style={typography.muted}>
                  {f.label}
                  {f.required ? ' *' : ''}
                </Text>
                {f.type === 'select' && f.dropdown ? (
                  <DropdownSelect options={f.options} value={values[f.key]} onChange={(v) => set(f.key, v)} placeholder={f.placeholder ?? 'Seleccionar…'} clearLabel="— Sin seleccionar" />
                ) : f.type === 'select' ? (
                  <ChipSelect options={f.options} value={values[f.key]} onChange={(v) => set(f.key, v)} />
                ) : f.type === 'suggest' && f.dropdown ? (
                  <DropdownSelect options={lookups[f.key] ?? []} value={values[f.key]} onChange={(v) => set(f.key, v)} placeholder={f.placeholder ?? 'Seleccionar…'} clearLabel="— Sin seleccionar" allowCustom />
                ) : f.type === 'suggest' ? (
                  <SuggestSelect options={lookups[f.key] ?? []} value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} placeholder={f.placeholder} />
                ) : f.type === 'date' ? (
                  <DateField value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} />
                ) : f.type === 'lookup' && f.dropdown ? (
                  <DropdownSelect
                    options={lookups[f.key] ?? []}
                    value={values[f.key]}
                    onChange={(v) => set(f.key, v)}
                    placeholder={f.placeholder ?? 'Seleccionar…'}
                    // Requerido → sin opción "vaciar" (obliga a elegir/crear uno).
                    clearLabel={f.required ? undefined : '— Sin empresa (general)'}
                    // Con `createColumn` el desplegable es BUSCABLE y permite AGREGAR uno
                    // nuevo (crea la fila en la tabla y usa su id) si no existe todavía.
                    allowCustom={!!f.createColumn}
                    onCreate={f.createColumn ? async (text: string) => {
                      const val = text.trim().toUpperCase(); // los nombres nuevos van en MAYÚSCULA
                      const { data, error } = await supabase
                        .from(f.table)
                        .insert({ [f.createColumn as string]: val } as any)
                        .select()
                        .single();
                      if (error || !data) return null;
                      const opt = { label: val, value: (data as any).id };
                      setLookups((prev) => ({ ...prev, [f.key]: [...(prev[f.key] ?? []), opt] }));
                      return opt;
                    } : undefined}
                  />
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
                ) : f.type === 'switch' ? (
                  <TouchableOpacity onPress={() => set(f.key, values[f.key] === 'true' ? 'false' : 'true')} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 }}>
                    <View style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: values[f.key] === 'true' ? colors.primary : colors.border, backgroundColor: values[f.key] === 'true' ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {values[f.key] === 'true' ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 15 }}>✓</Text> : null}
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{values[f.key] === 'true' ? 'Sí' : 'No'}</Text>
                  </TouchableOpacity>
                ) : (
                  <TextInput
                    style={f.type === 'textarea' ? [styles.input, styles.textarea] : styles.input}
                    value={values[f.key] ?? ''}
                    // Un 'textarea' es multilínea (varias líneas de texto libre, p. ej.
                    // la descripción del trabajo); el resto es de una sola línea.
                    multiline={f.type === 'textarea'}
                    numberOfLines={f.type === 'textarea' ? 4 : undefined}
                    textAlignVertical={f.type === 'textarea' ? 'top' : undefined}
                    // Los campos de cédula solo aceptan dígitos; los numéricos (dinero,
                    // horas, litros…) solo un decimal. El resto del texto se guarda en
                    // MAYÚSCULA, salvo correos/URLs que se dañarían si se transforman.
                    onChangeText={(t) => {
                      if (/cedula|cédula/i.test(f.key)) { set(f.key, onlyDigits(t)); return; }
                      if (f.type === 'number') { set(f.key, onlyDecimal(t)); return; }
                      // Texto → MAYÚSCULA, salvo correos/URLs y N° de cuenta (se dañarían).
                      const upper = (f.type === 'text' || f.type === 'textarea') && !/mail|correo|url|http|account|cuenta/i.test(f.key);
                      set(f.key, upper ? t.toUpperCase() : t);
                    }}
                    placeholder={('placeholder' in f && f.placeholder) || ''}
                    placeholderTextColor={colors.muted}
                    keyboardType={f.type === 'number' || /cedula|cédula/i.test(f.key) ? 'numeric' : 'default'}
                    inputMode={f.type === 'number' || /cedula|cédula/i.test(f.key) ? 'numeric' : undefined}
                    autoCapitalize={(f.type === 'text' || f.type === 'textarea') && !/cedula|cédula|mail|correo|url|http|account|cuenta/i.test(f.key) ? 'characters' : 'none'}
                  />
                )}
              </View>
              )
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

  const q = norm(query.trim());
  const filtered = q ? options.filter((o) => norm(o.label).includes(q)) : options;
  const exactExists = options.some((o) => norm(o.label) === q);
  // El buscador solo aparece si hay muchas opciones o si se pueden crear nuevas.
  const showSearch = !!createColumn || options.length > 8;

  const create = async () => {
    if (!createColumn || !query.trim()) return;
    setCreating(true);
    const val = query.trim().toUpperCase(); // los nombres nuevos se guardan en MAYÚSCULA
    const { data, error } = await supabase
      .from(table)
      .insert({ [createColumn]: val } as any)
      .select()
      .single();
    setCreating(false);
    if (error || !data) return;
    const opt = { label: val, value: (data as any).id };
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
      {filtered.length === 0 && q ? (
        <Text style={typography.muted}>Sin resultados para "{query.trim()}".</Text>
      ) : filtered.length === 0 ? null : filtered.length <= 4 ? (
        // Pocas opciones: se ven centradas/naturales, sin necesidad de scroll.
        <View style={styles.ssGridWrap}>
          {filtered.map((o) => (
            <SearchSelectChip
              key={o.value}
              option={o}
              active={o.value === value}
              colors={colors}
              styles={styles}
              onPress={onChange}
            />
          ))}
        </View>
      ) : (
        // Carrusel horizontal: tarjetas espaciadas, se recorren con scroll.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.ssGridScroll}
          contentContainerStyle={styles.ssGridScrollContent}
        >
          {filtered.slice(0, 30).map((o) => (
            <SearchSelectChip
              key={o.value}
              option={o}
              active={o.value === value}
              colors={colors}
              styles={styles}
              onPress={onChange}
            />
          ))}
        </ScrollView>
      )}
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

/** Tarjeta/chip individual de `SearchSelect`, compartida entre el modo
 *  "pocas opciones" (envuelve en fila) y el carrusel horizontal. */
function SearchSelectChip({
  option,
  active,
  colors,
  styles,
  onPress,
}: {
  option: Option;
  active: boolean;
  colors: AppColors;
  styles: ReturnType<typeof makeStyles>;
  onPress: (v: string) => void;
}) {
  return (
    <TouchableOpacity
      onPress={() => onPress(option.value)}
      style={[styles.ssChip, active && styles.ssChipActive]}
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
        {shortLabel(option.label)}
      </Text>
    </TouchableOpacity>
  );
}

/** Lista DESPLEGABLE (toggle) y BUSCABLE: muestra el valor elegido; al tocar se
 *  abre la lista (con buscador si hay muchas opciones) y al elegir una se cierra
 *  sola. Al tocar de nuevo se oculta. `clearLabel` agrega una opción para vaciar. */
function DropdownSelect({
  options,
  value,
  onChange,
  placeholder = 'Seleccionar…',
  clearLabel,
  allowCustom = false,
  onCreate,
}: {
  options: Option[];
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearLabel?: string;
  /** Permite escribir un valor NUEVO (no listado) desde el buscador. */
  allowCustom?: boolean;
  /** Si se define, "➕ Agregar" CREA la fila (p. ej. un proveedor nuevo) y devuelve su
   *  opción {label,value:id}; el valor elegido es ese id (no el texto). Para lookups. */
  onCreate?: (text: string) => Promise<Option | null>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  // Con allowCustom el valor puede no estar en la lista (texto libre): se muestra tal cual.
  const selected = options.find((o) => o.value === value) ?? (allowCustom && value ? { label: value, value } : undefined);
  const q = norm(query.trim());
  const filtered = q ? options.filter((o) => norm(o.label).includes(q)) : options;
  const showSearch = allowCustom || options.length > 6;
  // Valor nuevo SIEMPRE en MAYÚSCULA (unifica may/min). Solo se puede AGREGAR si no
  // existe ya uno igual (sin importar mayúsculas/acentos) → evita duplicados.
  const customValue = query.trim().toUpperCase();
  const exists = options.some((o) => norm(o.label) === q);
  const canAddCustom = allowCustom && query.trim().length > 0 && !exists;

  const close = () => { setOpen(false); setQuery(''); };

  return (
    <View>
      <TouchableOpacity
        onPress={() => (open ? close() : setOpen(true))}
        activeOpacity={0.8}
        style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
      >
        <Text style={{ color: selected ? colors.text : colors.muted, fontSize: 15, flex: 1 }} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={{ color: colors.primary, fontWeight: '800', marginLeft: spacing.sm }}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {open ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, maxHeight: 300, overflow: 'hidden' }}>
          {showSearch ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="🔎 Buscar…"
              placeholderTextColor={colors.muted}
              autoFocus
              style={{ padding: spacing.sm, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}
            />
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {clearLabel ? (
              <TouchableOpacity onPress={() => { onChange(''); close(); }} style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: colors.muted, fontSize: 14, fontStyle: 'italic' }}>{clearLabel}</Text>
              </TouchableOpacity>
            ) : null}
            {canAddCustom ? (
              <TouchableOpacity
                disabled={creating}
                onPress={async () => {
                  // Con onCreate (lookup): CREA la fila (proveedor) y usa su id. Sin él
                  // (suggest de texto): usa el texto tal cual.
                  if (onCreate) {
                    setCreating(true);
                    const opt = await onCreate(customValue);
                    setCreating(false);
                    if (opt) { onChange(opt.value); close(); }
                    return;
                  }
                  onChange(customValue); close();
                }}
                style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '800' }}>{creating ? 'Agregando…' : `➕ Agregar «${customValue}»`}</Text>
              </TouchableOpacity>
            ) : null}
            {allowCustom && query.trim().length > 0 && exists ? (
              <View style={{ paddingVertical: 8, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>Ese valor ya existe: elígelo de la lista (no se crea duplicado).</Text>
              </View>
            ) : null}
            {filtered.map((o) => {
              const active = o.value === value;
              return (
                <TouchableOpacity
                  key={o.value}
                  onPress={() => { onChange(o.value); close(); }}
                  style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: active ? colors.primary : 'transparent' }}
                >
                  <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 14, fontWeight: active ? '800' : '500' }}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
            {filtered.length === 0 ? <Text style={{ color: colors.muted, padding: spacing.md, fontSize: 13 }}>Sin resultados.</Text> : null}
          </ScrollView>
        </View>
      ) : null}
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
  const q = norm((value ?? '').trim());
  // Al escribir, filtra las sugerencias; si el campo está vacío las muestra todas.
  const filtered = q ? options.filter((o) => norm(o.label).includes(q)) : options;
  const exactExists = options.some((o) => norm(o.label) === q);
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
            const active = norm(o.label) === q;
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
  // Texto multilínea (type 'textarea'): más alto y el texto empieza arriba.
  textarea: {
    minHeight: 96,
    paddingTop: spacing.sm,
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
  // --- SearchSelect: carrusel de chips (ver componente SearchSelectChip) ---
  // Opciones pocas (<=4): fila que envuelve, centrada y sin forzar ancho de carrusel.
  ssGridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  // Carrusel horizontal (muchas opciones filtradas): se recorre con scroll.
  ssGridScroll: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  ssGridScrollContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  ssChip: {
    width: 104,
    minHeight: 56,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  ssChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
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
