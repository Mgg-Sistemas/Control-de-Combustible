import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image, Platform, BackHandler } from 'react-native';
import { Screen, Card, SectionTitle, Loading, SkeletonList } from '../components/ui';
import { BiometricToggle } from '../components/BiometricToggle';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FoodDistribution, MealType } from '../types/database';
import { saveFoodDistribution, listForEmployeeDay, listForContactoDay, deleteFoodDistribution } from '../lib/foodDistributions';
import { levelMeets } from '../lib/permissions';
import {
  ContactoCocina, CobrarA,
  cobrarAEfectivo, contactoActivo, contactoConCedula, formatearCedula, nombreDeContacto,
  normalizarCedula, validarCantidadComidas,
} from '../lib/comidaContactos';
import { cargarContactos } from '../lib/comidaContactosDb';
import { PlatoCatalogo, ordenarPlatos, platoActivo, validarNombrePlato } from '../lib/comidaPlatos';
import { cargarPlatos, crearOReusarPlato } from '../lib/comidaPlatosDb';
import { ContactoCocinaForm } from '../components/ContactoCocinaForm';
import { MEALS, OTROS_MEAL, OTROS_TITULO, mealLabel } from '../lib/foodCompanyMeals';
import QrScanner from '../components/QrScanner';
import { parseEmployeeId, parseComidaId } from './ScanQrScreen';
import { mensajeBloqueo, mensajeDeErrorInactivo, puedeRecibirComida } from '../lib/empleadoEstado';
import { norm } from '../lib/text';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { ChangePasswordButton } from '../components/ChangePasswordButton';
import { useRealtimeRefresh } from '../hooks/useRealtime';

// Solo el personal de cocina/alimentación puede ingresar cantidades. Se valida por
// el CARGO en nómina (ayudante de cocina, alimentación, cocinero, cocina, …).
const COOK_KEYS = ['cocina', 'cociner', 'aliment'];
const isCookCargo = (cargo?: string | null): boolean => {
  const n = norm(cargo ?? '');
  return !!n && COOK_KEYS.some((k) => n.includes(k));
};

/** Abre la DISTRIBUCIÓN DE COMIDA de una empresa (QR de empresa ?comida=<id>).
 *  En web navega al deep-link, que enruta a la pantalla de la empresa. */
function openCompanyFood(companyId: string): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    const w: any = globalThis;
    w.history.replaceState({}, '', `${w.location.pathname}?comida=${companyId}`);
    w.location.reload();
    return true;
  } catch { return false; }
}

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
/** Comida sugerida según la hora de Caracas: desayuno < 11, almuerzo < 15, lunch < 18, cena. */
function servingByTime(): MealType {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: CARACAS_TZ, hour: '2-digit', hour12: false }).format(new Date())) % 24;
  return h < 11 ? 'desayuno' : h < 15 ? 'almuerzo' : h < 18 ? 'lunch' : 'cena';
}

// Una persona en el mostrador. Puede venir de la NÓMINA (por su carnet) o de la
// AGENDA DE COCINA (21-sep-2026). Es el mismo tipo a propósito: la pantalla la
// atiende igual; lo que cambia es a qué columna va su entrega y si paga.
type Person = {
  id: string;
  name: string;
  cedula: string | null;
  cargo: string | null;
  photo_url: string | null;
  companyName: string;
  /** Su estado en Nómina. Un «inactivo» o «suspendido» NO recibe comida
   *  (26-sep-2026). Los contactos de cocina no son de nómina: van sin estado. */
  status?: string | null;
  /** Con esto puesto, es un contacto de cocina y NO de nómina. */
  contactoId?: string | null;
  /** A quién se le cobra lo que pida. Se congela en cada entrega. */
  cobrarA?: CobrarA;
  /** Su empresa HOY. Se congela en la entrega junto con `cobrarA`. */
  companyId?: string | null;
};

/**
 * Vista de COCINA: reparte la comida. Escanea el carnet de la persona (o la
 * busca por cédula), ve sus datos y registra cuántas comidas se le entregaron y
 * a qué hora. Todo queda guardado en el módulo "Distribución de comida".
 */
export default function CocinaScreen({ initialEmployeeId, onConsumed, navigation }: { initialEmployeeId?: string; onConsumed?: () => void; navigation?: any } = {}) {
  const { colors } = useTheme();
  const { session, signOut, moduleLevel } = useAuth();
  const uid = session?.user?.id ?? '';
  // Crear contactos es de «escritura o full en Distribución de comida» (decisión del
  // cliente, 21-sep-2026). Verificarse con el carnet de cocina habilita a REPARTIR,
  // que es otra cosa: quien reparte no necesariamente da de alta gente nueva.
  const puedeCrearContactos = levelMeets(moduleLevel('comida'), 'escritura');
  const today = caracasToday();
  const consumedRef = React.useRef(false);

  const [myName, setMyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [todayList, setTodayList] = useState<FoodDistribution[]>([]);
  const [savingMeal, setSavingMeal] = useState<MealType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cedula, setCedula] = useState('');
  const [searching, setSearching] = useState(false);
  // Persona de cocina VERIFICADA (por su propio carnet) que habilita el registro.
  const [cook, setCook] = useState<{ name: string; cargo: string } | null>(null);
  const [scanMode, setScanMode] = useState<'cook' | 'person' | 'quick'>('quick');
  const [cookCedula, setCookCedula] = useState('');
  const [verifying, setVerifying] = useState(false);
  // Comida que se está sirviendo AHORA (torniquete): cada carnet escaneado registra
  // esa comida a la persona; solo puede pasar una vez por comida al día.
  const [serving, setServing] = useState<MealType>(servingByTime());
  const [served, setServed] = useState(0); // contador de esta sesión
  // Conteo del día por comida (TODAS las personas repartidas hoy), en vivo.
  const [dayCounts, setDayCounts] = useState<Record<string, number>>({});
  // ── AGENDA DE COCINA (21-sep-2026) ────────────────────────────────────────
  // Se lee entera y se guarda acá: es una tabla chica y así la búsqueda por cédula
  // no consulta la base en cada tecla. `sinTablaContactos` = falta correr el SQL;
  // en ese caso la pantalla sigue funcionando para todo lo de nómina.
  const [contactos, setContactos] = useState<ContactoCocina[]>([]);
  const [sinTablaContactos, setSinTablaContactos] = useState(false);
  const [empresas, setEmpresas] = useState<{ id: string; name: string }[]>([]);
  const [formAbierto, setFormAbierto] = useState(false);
  // La cédula que se buscó y no apareció en ningún lado: con ella se abre el alta.
  const [cedulaNoHallada, setCedulaNoHallada] = useState('');
  // Cuántas comidas pide el contacto de una. Los de nómina siguen siendo 1 por día.
  const [cantidad, setCantidad] = useState('1');
  // ── «OTROS» PARA CONTACTOS (22-sep-2026) ─────────────────────────────────
  // El catálogo de platos (bolsa de hielo, vasos…) de la pestaña «🧾 Platos». A un
  // contacto se le cobran por el precio del catálogo; a la nómina NO se le ofrecen.
  // ⚠️ Se guardan TODOS, también los quitados de la lista: `crearOReusarPlato`
  //    necesita verlos para devolver a la lista el que ya existía en vez de chocar
  //    contra el índice único. Lo que se PINTA son los activos (`platosEnLista`).
  const [platos, setPlatos] = useState<PlatoCatalogo[]>([]);
  const [platoGuardando, setPlatoGuardando] = useState<string | null>(null);
  // ➕ Agregar una opción sin salir de la cocina (23-sep-2026). Pedido del cliente:
  // «coloca un + para agregar otras opciones». La nueva nace SIN precio: se le pone
  // en «💲 Precios y cuentas → 🧾 Platos», y hasta entonces sale avisada en amarillo.
  const [nuevaOpcion, setNuevaOpcion] = useState(false);
  const [nombreOpcion, setNombreOpcion] = useState('');
  const [creandoOpcion, setCreandoOpcion] = useState(false);
  // Modo de entrega: torniquete (registra la comida fija de la sesión) o
  // "elegir por persona" (al escanear abre a la persona y el cocinero elige la
  // comida — p. ej. alguien que llega a almorzar a las 4pm).
  const [scanChoose, setScanChoose] = useState(false);

  const loadMyName = React.useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    const { data } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
    setMyName((data as any)?.full_name ?? '');
    setLoading(false);
  }, [uid]);
  React.useEffect(() => { loadMyName(); }, [loadMyName]);

  // La agenda y las empresas, una vez al entrar. Si falla, NO se deja la lista vacía
  // en silencio: una agenda vacía haría que alguien diera de alta otra vez a quien ya
  // está registrado, que es justo lo que esta agenda existe para evitar.
  const loadAgenda = React.useCallback(async () => {
    try {
      const [ag, comps, pl] = await Promise.all([
        cargarContactos(),
        supabase.from('companies').select('id, name, hidden').order('name', { ascending: true }),
        // Si el catálogo falla, la cocina sigue repartiendo: solo se esconde «Otros».
        cargarPlatos().catch(() => [] as PlatoCatalogo[]),
      ]);
      setContactos(ag.contactos);
      setSinTablaContactos(ag.sinTabla);
      setPlatos(ordenarPlatos(pl));
      setEmpresas(((comps.data ?? []) as any[]).filter((c) => !c.hidden).map((c) => ({ id: String(c.id), name: String(c.name ?? '') })));
    } catch {
      setSinTablaContactos(false);
      setNotice('⚠️ No se pudo leer la agenda de cocina. Busca por cédula igual, pero no des de alta a nadie hasta que vuelva: podrías duplicarlo.');
    }
  }, []);
  React.useEffect(() => { loadAgenda(); }, [loadAgenda]);

  /** Los activos: lo que se le ofrece a la cocina. Los quitados de la lista siguen en
   *  `platos` para que `crearOReusarPlato` los reconozca (ver el comentario del estado). */
  const platosEnLista = React.useMemo(() => platos.filter(platoActivo), [platos]);

  /**
   * ➕ Agrega una opción a la lista (hielo, agua, refresco…) desde el teléfono.
   *
   * ⚠️ NACE SIN PRECIO, a propósito. El precio manda sobre el costo y decide lo que
   *    se factura: ponerlo es de quien cobra, no de quien reparte. Mientras no lo
   *    tenga, la opción sale avisada en «🧾 Platos» y en la tarjeta de cobro, que es
   *    justo el recordatorio que hace falta. Por eso el aviso de acá lo dice.
   */
  const agregarOpcion = async () => {
    const m = validarNombrePlato(nombreOpcion, platos);
    if (m) { setNotice(`❌ ${m}`); return; }
    setCreandoOpcion(true); setNotice(null);
    try {
      const r = await crearOReusarPlato(nombreOpcion, platos);
      if (r.error || !r.plato) { setNotice(`❌ No se agregó: ${r.error ?? 'inténtalo de nuevo.'}`); return; }
      setPlatos(ordenarPlatos(await cargarPlatos().catch(() => platos)));
      setNombreOpcion(''); setNuevaOpcion(false);
      setNotice(r.yaExistia
        ? `✅ «${r.plato.name}» ya estaba y volvió a la lista.`
        : `✅ «${r.plato.name}» quedó en la lista. Ponle su precio en Distribución de comida → 💲 Precios y cuentas → 🧾 Platos, o no se podrá cobrar.`);
    } finally {
      setCreandoOpcion(false);
    }
  };

  // Conteo del día por comida: cuenta food_distributions de HOY agrupadas por tipo.
  // Se refresca al abrir y en tiempo real (ver useRealtimeRefresh más abajo), así
  // que al escanear un desayuno la tarjeta sube sola.
  const loadDayCounts = React.useCallback(async () => {
    const { data } = await supabase.from('food_distributions').select('meal_type').eq('distribution_date', today);
    const c: Record<string, number> = {};
    (data ?? []).forEach((r: any) => { if (r.meal_type) c[r.meal_type] = (c[r.meal_type] || 0) + 1; });
    setDayCounts(c);
  }, [today]);
  React.useEffect(() => { loadDayCounts(); }, [loadDayCounts]);

  // Botón/gesto "atrás" físico (Android): Cocina es la pantalla RAÍZ de su propio
  // Stack (no vive dentro de pestañas), así que sin este manejo, "atrás" no tenía
  // nada que deshacer y el sistema cerraba la app entera — sin forma de volver a
  // escanear (queja del cliente 12-ago-2026). Ahora, si hay algo abierto en pantalla
  // (el escáner o una persona ya escaneada), "atrás" lo cierra y deja lista la
  // pantalla para escanear de nuevo, en vez de salir de la aplicación. Sin efecto
  // en iOS (no tiene botón atrás) ni en web (BackHandler no existe ahí — por eso
  // se salta por completo, en vez de registrar un listener que no hace nada).
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (scanOpen) { setScanOpen(false); return true; }
      if (person) { setPerson(null); setNotice(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [scanOpen, person]);

  // Pull-to-refresh: solo recarga el nombre del perfil; no toca la persona/cocinero
  // ya abiertos en pantalla (evita perder el registro en curso).
  const onRefresh = async () => { setRefreshing(true); await loadMyName(); setRefreshing(false); };

  // TIEMPO REAL: al registrar/borrar una comida (este u otro dispositivo), suben
  // las tarjetas de conteo del día; y si tengo una persona abierta, su lista de hoy
  // también se actualiza sola.
  useRealtimeRefresh(['food_distributions'], () => {
    loadDayCounts();
    // ⚠️ Un contacto se busca por SU columna. Con `listForEmployeeDay` la lista del
    //    contacto abierto se vaciaba sola al llegar cualquier cambio de otro equipo,
    //    porque su id no es un `employee_id` y la consulta volvía sin nada.
    if (!person) return;
    const leer = person.contactoId
      ? listForContactoDay(person.contactoId, today)
      : listForEmployeeDay(person.id, today);
    leer.then(setTodayList);
  });

  const openPerson = async (employeeId: string) => {
    setScanOpen(false);
    setNotice(null);
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, cedula, cargo, photo_url, status, company:company_id(name)')
      .eq('id', employeeId)
      .maybeSingle();
    if (!data) { setNotice('❌ El carnet no corresponde a una persona registrada.'); return; }
    const p: Person = {
      id: (data as any).id,
      name: `${(data as any).first_name ?? ''} ${(data as any).last_name ?? ''}`.trim() || 'Sin nombre',
      cedula: (data as any).cedula ?? null,
      cargo: (data as any).cargo ?? null,
      photo_url: (data as any).photo_url ?? null,
      status: (data as any).status ?? null,
      companyName: (data as any).company?.name ?? 'Sin empresa',
    };
    // 🚫 DESHABILITADO EN NÓMINA: ni se le abre la ficha. Dejarla abierta con los
    //    botones puestos es invitar a que alguien le dé igual «Almuerzo» y se
    //    quede esperando un error que llega tres toques después.
    const bloqueo = mensajeBloqueo(p.name, p.status);
    if (bloqueo) { setPerson(null); setTodayList([]); setNotice(bloqueo); return; }
    setPerson(p);
    setTodayList(await listForEmployeeDay(p.id, today));
  };

  // Si llegó por el carnet físico (?empleado=) tras iniciar sesión como Cocina:
  // abre directo el registro de esa persona (una sola vez) y limpia la URL.
  React.useEffect(() => {
    if (consumedRef.current || !initialEmployeeId || loading) return;
    consumedRef.current = true;
    openPerson(initialEmployeeId);
    onConsumed?.();
  }, [initialEmployeeId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Abre a un CONTACTO de la agenda: mismo mostrador, otra columna. */
  const abrirContacto = async (c: ContactoCocina) => {
    setScanOpen(false);
    setNotice(null);
    setCedulaNoHallada('');
    setCantidad('1');
    const emp = c.company_id ? empresas.find((e) => e.id === c.company_id)?.name ?? 'Empresa' : null;
    const p: Person = {
      id: c.id,
      name: nombreDeContacto(c),
      cedula: c.cedula ? formatearCedula(c.cedula) : null,
      cargo: null,
      photo_url: null,
      companyName: emp ?? 'Por su cuenta',
      contactoId: c.id,
      cobrarA: cobrarAEfectivo(c),
      companyId: c.company_id ?? null,
    };
    setPerson(p);
    setTodayList(await listForContactoDay(c.id, today));
    if (!contactoActivo(c)) {
      setNotice(`⚠️ ${p.name} está quitado de la lista. Se le puede entregar igual, pero devuélvelo a la lista desde Distribución de comida.`);
    }
  };

  // ── BUSCAR POR CÉDULA: primero la nómina, después la agenda ───────────────
  //
  // ⚠️ EL ORDEN NO ES CAPRICHO. Quien está en la nómina se atiende por su carnet:
  //    su comida tiene que ir a la cuenta de su departamento o de su empresa, que es
  //    como se viene cobrando. Solo si NO está en nómina se mira la agenda de cocina.
  const buscarPorCedula = async () => {
    const ci = cedula.trim();
    if (ci.length < 5) { setNotice('❌ Escribe la cédula completa.'); return; }
    setSearching(true); setNotice(null); setCedulaNoHallada('');
    // `.eq` exacto para la nómina, como hasta hoy; si no cae, se prueba por los
    // dígitos, porque en `employees` la cédula está escrita de mil maneras.
    const { data } = await supabase.from('employees').select('id, cedula').eq('cedula', ci).limit(1);
    let emp: any = data && data[0];
    if (!emp) {
      const { data: parecidas } = await supabase
        .from('employees').select('id, cedula').ilike('cedula', `%${ci.slice(-7)}%`).limit(50);
      emp = (parecidas as any[] | null)?.find((e) => normalizarCedula(e?.cedula) === normalizarCedula(ci));
    }
    setSearching(false);
    if (emp) { setCedula(''); scanChoose ? openPerson(emp.id) : quickDeliver(emp.id); return; }
    const c = contactoConCedula(contactos, ci);
    if (c) { setCedula(''); abrirContacto(c); return; }
    // No está en ningún lado. Se ofrece darlo de alta con esa misma cédula ya puesta.
    setCedulaNoHallada(ci);
    setNotice(puedeCrearContactos
      ? `❌ No hay nadie con la cédula ${formatearCedula(ci)}. Si no es de nómina, regístralo como persona nueva.`
      : `❌ No hay nadie con la cédula ${formatearCedula(ci)}. Si no es de nómina, pídele a la oficina que lo registre en Distribución de comida.`);
  };

  // ── Entrega RÁPIDA (torniquete): al escanear el carnet, registra la comida que
  //    se está sirviendo. Cada persona solo puede pasar UNA vez por comida al día. ─
  const quickDeliver = async (employeeId: string) => {
    setScanOpen(false); setNotice(null);
    if (!cook) { setNotice('❌ Primero verifícate escaneando tu carnet de cocina.'); return; }
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, cedula, cargo, photo_url, status, company:company_id(name)')
      .eq('id', employeeId)
      .maybeSingle();
    if (!data) { setPerson(null); setNotice('❌ El carnet no corresponde a una persona registrada.'); return; }
    const p: Person = {
      id: (data as any).id,
      name: `${(data as any).first_name ?? ''} ${(data as any).last_name ?? ''}`.trim() || 'Sin nombre',
      cedula: (data as any).cedula ?? null,
      cargo: (data as any).cargo ?? null,
      photo_url: (data as any).photo_url ?? null,
      status: (data as any).status ?? null,
      companyName: (data as any).company?.name ?? 'Sin empresa',
    };
    // 🚫 DESHABILITADO EN NÓMINA: el torniquete no le registra nada. Se corta ACÁ,
    //    antes de guardar, para que el cartel salga apenas pasa el carnet.
    const bloqueo = mensajeBloqueo(p.name, p.status);
    if (bloqueo) { setPerson(null); setTodayList([]); setNotice(bloqueo); return; }
    setPerson(p);
    const list = await listForEmployeeDay(p.id, today);
    setTodayList(list);
    // ¿Ya pasó por esta comida hoy? No se registra de nuevo.
    const already = list.find((d) => d.meal_type === serving);
    if (already) {
      setNotice(`⚠️ ${p.name} YA pasó por ${mealLabel(serving).toUpperCase()} hoy (${caracasClock(already.delivered_at)}). No se registró de nuevo.`);
      return;
    }
    const { data: saved, error } = await saveFoodDistribution({
      employeeId: p.id, employeeName: p.name, cedula: p.cedula,
      meals: 1, mealType: serving, distributionDate: today, note: '',
      createdBy: uid || null, createdByName: cook?.name || myName || null,
    });
    // Si la base lo trancó (se dio de baja entre el escaneo y el guardado, o esta
    // pantalla está vieja), se muestra el MISMO cartel y no un error de Postgres.
    if (error || !saved) { setNotice(mensajeDeErrorInactivo(error) ?? ('❌ ' + (error ?? 'No se pudo registrar.'))); return; }
    setTodayList((prev) => [saved, ...prev]);
    setServed((s) => s + 1);
    setDayCounts((c) => ({ ...c, [serving]: (c[serving] || 0) + 1 }));
    setNotice(`✅ ${mealLabel(serving).toUpperCase()} entregado a ${p.name} · ${caracasClock(saved.delivered_at)}.`);
  };

  // ── Verificación del que reparte: escanea SU carnet (o busca por cédula). Solo
  //    si su cargo en nómina es de cocina/alimentación queda habilitado.
  const verifyCookByEmployee = (empData: any): boolean => {
    const cargo = empData?.cargo ?? '';
    const name = `${empData?.first_name ?? ''} ${empData?.last_name ?? ''}`.trim() || 'Sin nombre';
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
    setScanOpen(false);
    setVerifying(true); setNotice(null);
    const { data } = await supabase.from('employees').select('first_name, last_name, cargo').eq('id', employeeId).maybeSingle();
    setVerifying(false);
    if (!data) { setNotice('❌ Ese carnet no corresponde a una persona registrada.'); return; }
    verifyCookByEmployee(data);
  };

  const buscarCookPorCedula = async () => {
    const ci = cookCedula.trim();
    if (ci.length < 5) { setNotice('❌ Escribe tu cédula completa.'); return; }
    setVerifying(true); setNotice(null);
    const { data } = await supabase.from('employees').select('first_name, last_name, cargo').eq('cedula', ci).limit(1);
    setVerifying(false);
    const emp = data && data[0];
    if (!emp) { setNotice('❌ No hay ninguna persona con esa cédula.'); return; }
    if (verifyCookByEmployee(emp)) setCookCedula('');
  };

  const doneMeal = (mt: MealType) => todayList.find((d) => d.meal_type === mt) || null;

  const registrarMeal = async (mealType: MealType, plato?: string) => {
    if (!cook) { setNotice('❌ Primero verifícate escaneando tu carnet de cocina.'); return; }
    if (!person) return;
    const esContacto = !!person.contactoId;
    // 🚫 Defensa en profundidad: la ficha pudo haberse abierto ANTES de que lo
    //    dieran de baja, y esta pantalla vive abierta horas en el mostrador.
    if (!esContacto && !puedeRecibirComida(person.status)) {
      setNotice(mensajeBloqueo(person.name, person.status));
      setPerson(null); setTodayList([]);
      return;
    }
    // ⚠️ «OTROS» ES SOLO PARA CONTACTOS (decisión del cliente, 22-sep-2026): a la nómina
    //    no se le ofrece el botón, y aunque llegara acá, no se registra. La base también
    //    lo rechaza (check `food_distributions_otros_solo_contactos`).
    const nombrePlato = (plato ?? '').trim();
    if (mealType === 'otros' && (!esContacto || !nombrePlato)) { setNotice('❌ «Otros» solo se le registra a un contacto de cocina, y hay que elegir el plato.'); return; }
    // ⚠️ EL CANDADO DE «UNA POR DÍA» ES SOLO PARA LA NÓMINA. Un contacto paga lo que
    //    pide: puede llevarse 8 almuerzos y volver a mediodía por el suyo. Se le avisa
    //    que ya pasó, pero no se le tranca (decisión del cliente, 21-sep-2026).
    if (!esContacto && doneMeal(mealType)) { setNotice(`ℹ️ ${mealLabel(mealType)} ya se registró hoy para ${person.name}.`); return; }
    let cuantas = 1;
    if (esContacto) {
      const motivo = validarCantidadComidas(cantidad);
      if (motivo) { setNotice(`❌ ${motivo}`); return; }
      cuantas = Number(String(cantidad).replace(',', '.'));
    }
    setSavingMeal(mealType); setPlatoGuardando(mealType === 'otros' ? nombrePlato : null); setNotice(null);
    const { data, error } = await saveFoodDistribution({
      // O es de nómina, o es de la agenda: nunca las dos columnas a la vez.
      employeeId: esContacto ? null : person.id,
      contactoId: person.contactoId ?? null,
      cobrarA: esContacto ? (person.cobrarA ?? 'independiente') : null,
      contactoCompanyId: esContacto ? (person.companyId ?? null) : null,
      contactoCompanyNombre: esContacto && person.companyId ? person.companyName : null,
      employeeName: person.name,
      cedula: person.cedula,
      meals: cuantas,
      mealType,
      itemLabel: mealType === 'otros' ? nombrePlato : null,
      distributionDate: today,
      note: '',
      createdBy: uid || null,
      createdByName: cook?.name || myName || null,
    });
    setSavingMeal(null); setPlatoGuardando(null);
    if (error || !data) { setNotice(mensajeDeErrorInactivo(error) ?? ('❌ ' + (error ?? 'No se pudo registrar.'))); return; }
    setTodayList((prev) => [data, ...prev]);
    const puestas = Number(data.meals) || 1;
    setDayCounts((c) => ({ ...c, [mealType]: (c[mealType] || 0) + puestas }));
    const que = mealType === 'otros' ? nombrePlato : mealLabel(mealType);
    setNotice(puestas > 1
      ? `✅ ${puestas} ${que}(s) registrados para ${person.name} · ${caracasClock(data.delivered_at)}.`
      : `✅ ${que} registrado para ${person.name} · ${caracasClock(data.delivered_at)}.`);
  };

  const borrar = async (id: string) => {
    const { error } = await deleteFoodDistribution(id);
    if (error) { setNotice('❌ ' + error); return; }
    setTodayList((prev) => prev.filter((d) => d.id !== id));
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  const totalHoy = todayList.reduce((a, d) => a + (Number(d.meals) || 0), 0);

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Cocina</Text>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{myName || 'Distribución de comida'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <ChangePasswordButton />
          <TouchableOpacity onPress={signOut} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Salir</Text>
          </TouchableOpacity>
        </View>
      </View>

      {navigation ? (
        <TouchableOpacity onPress={() => navigation.navigate('Comida')} activeOpacity={0.8}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Text style={{ fontSize: 22 }}>📋</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: colors.text, fontSize: 14 }}>Distribución de comida</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>Ver lo repartido por día y por persona</Text>
              </View>
              <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>›</Text>
            </View>
          </Card>
        </TouchableOpacity>
      ) : null}

      {/* Tarjetas de conteo del día por comida (todas las personas). Suben en vivo. */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>🍽️ Repartidas hoy (personas)</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {MEALS.map((m) => (
            <View key={m.key} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
              <Text style={{ fontSize: 18 }}>{m.icon}</Text>
              <Text style={{ color: m.color, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{dayCounts[m.key] || 0}</Text>
              <Text style={{ color: colors.muted, fontSize: 10 }}>{m.label}</Text>
            </View>
          ))}
        </View>
      </Card>

      {!cook ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🔒 Verifícate para repartir</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            Solo el personal de cocina/alimentación puede ingresar cantidades. Escanea TU carnet para habilitar el registro.
          </Text>
          <TouchableOpacity onPress={() => { setScanMode('cook'); setScanOpen(true); }} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear mi carnet</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>¿No lee el carnet? Verifícate por cédula:</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
            <TextInput value={cookCedula} onChangeText={(t) => setCookCedula(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Tu cédula" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
            <TouchableOpacity onPress={buscarCookPorCedula} disabled={verifying} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
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
            <TouchableOpacity onPress={() => { setCook(null); setPerson(null); setNotice(null); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cambiar</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {cook ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🍽️ Entregar comida</Text>
          {/* Modo de entrega. */}
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            {[
              { on: false, icon: '⚡', label: 'Torniquete', hint: 'comida fija' },
              { on: true, icon: '🖐', label: 'Elegir por persona', hint: 'p. ej. almuerzo 4pm' },
            ].map((m) => {
              const active = scanChoose === m.on;
              return (
                <TouchableOpacity
                  key={String(m.on)}
                  onPress={() => setScanChoose(m.on)}
                  style={{ flex: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.md, alignItems: 'center', backgroundColor: active ? colors.primary : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}
                >
                  <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{m.icon} {m.label}</Text>
                  <Text style={{ color: active ? colors.primaryContrast : colors.muted, fontSize: 10, marginTop: 1 }}>{m.hint}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {scanChoose ? (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Al escanear se abre a la persona y tú eliges la comida (desayuno / almuerzo / cena). Ideal cuando alguien llega fuera de hora.</Text>
              <TouchableOpacity onPress={() => { setScanMode('quick'); setScanOpen(true); }} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear carnet — elegir comida</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Elige la comida que se está sirviendo. Cada carnet escaneado registra esa comida (solo puede pasar una vez por comida).</Text>
              {/* Selector de la comida que se está sirviendo ahora. */}
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                {MEALS.map((mt) => {
                  const active = serving === mt.key;
                  return (
                    <TouchableOpacity
                      key={mt.key}
                      onPress={() => setServing(mt.key)}
                      style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: active ? mt.color : colors.surface, borderWidth: 1, borderColor: active ? mt.color : colors.border }}
                    >
                      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '800', fontSize: 13 }}>{mt.icon} {mt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Sirviendo: <Text style={{ color: colors.text, fontWeight: '800' }}>{mealLabel(serving).toUpperCase()}</Text> · Entregadas en esta sesión: <Text style={{ color: colors.primary, fontWeight: '800' }}>{served}</Text></Text>
              <TouchableOpacity onPress={() => { setScanMode('quick'); setScanOpen(true); }} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear carnet — entregar {mealLabel(serving).toUpperCase()}</Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>💡 También puedes escanear el QR de una EMPRESA para registrar sus comidas.</Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>¿No lee el carnet? Busca por cédula:</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
            <TextInput value={cedula} onChangeText={(t) => setCedula(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Cédula" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
            <TouchableOpacity onPress={buscarPorCedula} disabled={searching} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{searching ? '…' : (scanChoose ? 'Abrir' : 'Entregar')}</Text>
            </TouchableOpacity>
          </View>

          {/* ── PERSONA NUEVA (21-sep-2026) ──────────────────────────────────
              Quien no es de nómina y viene a comprar comida se registra acá, en
              una agenda que solo usa Cocina. La cédula que se acaba de buscar sin
              éxito entra ya puesta en el formulario: nadie la va a escribir dos
              veces con la cola esperando. */}
          {sinTablaContactos ? (
            <Text style={{ color: colors.warning, fontSize: 11, marginTop: spacing.sm }}>
              ⚠️ La agenda de personas que compran comida todavía no está creada en la base. Avisa al administrador.
            </Text>
          ) : puedeCrearContactos ? (
            <TouchableOpacity
              onPress={() => { setNotice(null); setFormAbierto(true); }}
              style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
            >
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                ➕ Persona nueva{cedulaNoHallada ? ` · ${formatearCedula(cedulaNoHallada)}` : ''}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>
              ¿Alguien que no es de nómina viene a comprar comida? La oficina lo registra en Distribución de comida
              y después aparece acá por su cédula.
            </Text>
          )}
        </Card>
      ) : null}

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : notice.startsWith('⚠️') ? colors.warning : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {cook && person ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              {person.photo_url ? (
                <Image source={{ uri: person.photo_url }} style={{ width: 64, height: 74, borderRadius: 8, backgroundColor: colors.surfaceAlt }} resizeMode="cover" />
              ) : (
                <View style={{ width: 64, height: 74, borderRadius: 8, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 34 }}>👤</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 17 }}>{person.name}</Text>
                {person.cargo ? <Text style={{ color: colors.muted, fontSize: 12, textTransform: 'uppercase' }}>{person.cargo}</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 12 }}>{person.cedula ? `C.I ${person.cedula} · ` : ''}{person.companyName}</Text>
                {person.contactoId ? (
                  <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '800', marginTop: 2 }}>
                    📇 Contacto de cocina · se le cobra a {person.cobrarA === 'empresa' ? person.companyName : 'él mismo'}
                  </Text>
                ) : null}
              </View>
            </View>
          </Card>

          <Card>
            {person.contactoId ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                  ¿Cuántas comidas pide? Después toca cuál es:
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center', marginBottom: spacing.sm }}>
                  <TouchableOpacity
                    onPress={() => setCantidad((v) => String(Math.max(1, (Number(v) || 1) - 1)))}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>−</Text>
                  </TouchableOpacity>
                  <TextInput
                    value={cantidad}
                    onChangeText={(t) => setCantidad(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    style={[input, { flex: 1, textAlign: 'center', fontWeight: '900', fontSize: 18 }]}
                  />
                  <TouchableOpacity
                    onPress={() => setCantidad((v) => String((Number(v) || 0) + 1))}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>+</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Marca la comida que se le entrega (1 vez por día cada una):</Text>
            )}
            <View style={{ gap: spacing.sm }}>
              {MEALS.map((mt) => {
                const done = doneMeal(mt.key);
                const busy = savingMeal === mt.key;
                // Un contacto NUNCA se tranca: se le avisa que ya pasó y él decide.
                const trancado = !person.contactoId && !!done;
                return (
                  <TouchableOpacity
                    key={mt.key}
                    onPress={() => registrarMeal(mt.key)}
                    disabled={trancado || busy}
                    style={{ borderRadius: radius.md, padding: spacing.md, backgroundColor: trancado ? colors.surfaceAlt : mt.color, borderWidth: trancado ? 1 : 0, borderColor: colors.border, opacity: busy ? 0.6 : 1 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ color: trancado ? colors.text : '#fff', fontWeight: '900', fontSize: 18 }}>{mt.icon} {mt.label}</Text>
                      {trancado ? (
                        <Text style={{ color: colors.success, fontWeight: '900', fontSize: 13 }}>✅ {caracasClock(done!.delivered_at)}</Text>
                      ) : (
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                          {busy ? 'Guardando…' : person.contactoId ? `Entregar ${Number(cantidad) || 1} ›` : 'Marcar ›'}
                        </Text>
                      )}
                    </View>
                    {person.contactoId && done ? (
                      <Text style={{ color: '#fff', fontSize: 11, marginTop: 2, opacity: 0.9 }}>
                        Ya se llevó {mealLabel(mt.key)} hoy ({caracasClock(done.delivered_at)}). Se le puede entregar de nuevo.
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            {/* «OTROS» (22-sep-2026): hielo, agua, vasos… SOLO para contactos. El precio es el
                del catálogo de platos; por eso se ELIGE de la lista y no se escribe a mano.
                23-sep-2026: la lista nace con HIELO y AGUA, y el ➕ agrega las que hagan falta. */}
            {person.contactoId ? (
              <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{OTROS_MEAL.icon} {OTROS_TITULO} · elige la opción</Text>
                {platosEnLista.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                    La lista está vacía: deberían estar HIELO y AGUA. Agrégalas con el ➕ de abajo.
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                    {platosEnLista.map((pl) => {
                      const busy = savingMeal === 'otros' && platoGuardando === pl.name;
                      return (
                        <TouchableOpacity
                          key={pl.id}
                          onPress={() => registrarMeal('otros', pl.name)}
                          disabled={!!savingMeal}
                          style={{ borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: OTROS_MEAL.color, opacity: savingMeal ? 0.6 : 1 }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
                            {busy ? 'Guardando…' : `${pl.name} · Entregar ${Number(cantidad) || 1} ›`}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* ➕ AGREGAR OTRA OPCIÓN, sin salir de la cocina. El campo sale solo al
                    tocar el ➕: si estuviera siempre abierto se escribiría «yelo» con
                    HIELO en la lista, y serían dos opciones con dos precios. */}
                {nuevaOpcion ? (
                  <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                    <TextInput
                      value={nombreOpcion}
                      onChangeText={setNombreOpcion}
                      placeholder="Ej. Refresco, Postre, Vasos…"
                      placeholderTextColor={colors.muted}
                      autoCapitalize="characters"
                      style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
                    />
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      Queda en la lista para todos. Nace SIN precio: pónselo en Distribución de comida →
                      💲 Precios y cuentas → 🧾 Platos, o no se podrá cobrar.
                    </Text>
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <TouchableOpacity
                        onPress={() => { setNuevaOpcion(false); setNombreOpcion(''); }}
                        style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Cancelar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={creandoOpcion}
                        onPress={agregarOpcion}
                        style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: creandoOpcion ? 0.6 : 1 }}
                      >
                        <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>{creandoOpcion ? 'Agregando…' : '💾 Agregar a la lista'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => { setNuevaOpcion(true); setNombreOpcion(''); }}
                    style={{ marginTop: spacing.xs, alignSelf: 'flex-start', paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border }}
                  >
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>➕ Agregar otra opción</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </Card>

          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>Hoy a {person.name.split(' ')[0]}</Text>
              <Text style={{ color: colors.primary, fontWeight: '900' }}>{totalHoy} comida(s)</Text>
            </View>
            {todayList.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Aún no se le ha entregado comida hoy.</Text>
            ) : (
              todayList.map((d) => (
                <View key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{d.meal_type === 'otros' ? '🧾' : '🍽️'} {Number(d.meals) > 1 ? `${d.meals} × ` : ''}{d.meal_type === 'otros' ? (d.item_label || 'Otros') : d.meal_type ? mealLabel(d.meal_type) : `${d.meals} comida(s)`} · {caracasClock(d.delivered_at)}{d.note ? ` · ${d.note}` : ''}</Text>
                  <TouchableOpacity onPress={() => borrar(d.id)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑</Text></TouchableOpacity>
                </View>
              ))
            )}
          </Card>

          <TouchableOpacity onPress={() => { setPerson(null); setNotice(null); }} style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, marginBottom: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>← Escanear otra persona</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {/* Seguridad: iniciar sesión con huella (disponible para todos los usuarios). */}
      <SectionTitle>Seguridad</SectionTitle>
      <BiometricToggle />

      {/* El alta de una persona nueva. El MISMO formulario que usa la oficina en
          «📇 Contactos»: si fueran dos, uno pediría distinto que el otro. */}
      <ContactoCocinaForm
        visible={formAbierto}
        onClose={() => setFormAbierto(false)}
        contactos={contactos}
        empresas={empresas}
        cedulaInicial={cedulaNoHallada || cedula}
        canEdit={puedeCrearContactos}
        quien={{ id: uid || null, nombre: cook?.name || myName || null }}
        onGuardado={async (c) => {
          setFormAbierto(false);
          setCedula('');
          await loadAgenda();
          await abrirContacto(c);
          setNotice(`✅ ${nombreDeContacto(c)} quedó registrado. Ya se le puede entregar.`);
        }}
        onYaExiste={(c) => { setFormAbierto(false); setCedula(''); abrirContacto(c); }}
      />

      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner
            onClose={() => setScanOpen(false)}
            onDetected={(text) => {
              const id = parseEmployeeId(text);
              if (id) {
                if (scanMode === 'cook') verifyCook(id);
                else if (scanMode === 'quick') { scanChoose ? openPerson(id) : quickDeliver(id); }
                else openPerson(id);
                return;
              }
              // ¿Es un QR de EMPRESA (distribución de comida)? Abre esa empresa.
              const companyId = parseComidaId(text);
              if (companyId) { setScanOpen(false); if (!openCompanyFood(companyId)) setNotice('❌ No se pudo abrir la empresa desde este dispositivo.'); return; }
              setScanOpen(false);
              setNotice('❌ Ese QR no es un carnet de persona ni de empresa.');
            }}
          />
        </View>
      </Modal>
    </Screen>
  );
}
