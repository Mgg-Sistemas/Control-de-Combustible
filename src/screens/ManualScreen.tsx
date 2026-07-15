import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { norm } from '../lib/text';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// ── Contenido del manual (lenguaje simple, paso a paso) ───────────────────────
// Bloques que puede tener una sección: párrafo, pasos numerados, viñetas o nota.
type Block =
  | { t: 'p'; text: string }
  | { t: 'steps'; items: string[] }
  | { t: 'bullets'; items: string[] }
  | { t: 'note'; text: string };
type Sec = { icon: string; title: string; blocks: Block[] };

const SECTIONS: Sec[] = [
  {
    icon: '👋',
    title: '¿Qué es este sistema?',
    blocks: [
      { t: 'p', text: 'Es una aplicación para llevar el control de la operación: el combustible, las máquinas, las horas que trabajan, los pagos y más. Reemplaza los cuadernos y el papel.' },
      { t: 'p', text: 'Puedes usarlo de dos formas, las dos funcionan igual:' },
      { t: 'bullets', items: ['En el teléfono (aplicación).', 'En la computadora, abriendo la página web.'] },
    ],
  },
  {
    icon: '🔑',
    title: 'Cómo entrar',
    blocks: [
      { t: 'steps', items: [
        'Abre la aplicación (o la página web).',
        'Escribe tu correo y tu contraseña.',
        'Toca el botón Entrar.',
        'Si el teléfono te lo pide, la próxima vez puedes entrar con tu huella o tu cara.',
      ] },
      { t: 'note', text: '¿Olvidaste la contraseña? Toca "¿Olvidaste tu contraseña?" y sigue lo que llega a tu correo.' },
    ],
  },
  {
    icon: '🧭',
    title: 'Cómo moverte por el sistema',
    blocks: [
      { t: 'p', text: 'Abajo hay unos botones (pestañas). Cada uno te lleva a una sección. El último se llama "Más": ahí están todas las demás secciones.' },
      { t: 'bullets', items: [
        'Para abrir una sección: tócala una vez.',
        'Para volver atrás: usa la flecha ← de arriba a la izquierda.',
        'Para buscar: escribe en la barra que dice 🔎 Buscar.',
      ] },
      { t: 'note', text: 'Casi todo se abre tocando y se guarda solo o con un botón azul o verde.' },
    ],
  },
  {
    icon: '🛢️',
    title: 'Tanques (dónde se guarda el combustible)',
    blocks: [
      { t: 'p', text: 'Aquí ves cada tanque y cuánto combustible le queda. El nivel se calcula solo: no se escribe a mano.' },
      { t: 'steps', items: [
        'Para agregar un tanque: toca + Agregar.',
        'Escribe el nombre y la capacidad.',
        'Toca Guardar.',
      ] },
    ],
  },
  {
    icon: '⬇️',
    title: 'Ingresos (cuando llega combustible)',
    blocks: [
      { t: 'steps', items: [
        'Toca + Agregar.',
        'Elige la fecha, el tanque y cuántos litros llegaron.',
        'Toca Guardar. El tanque sube solo.',
      ] },
    ],
  },
  {
    icon: '⛽',
    title: 'Consumos (cuando se usa combustible)',
    blocks: [
      { t: 'steps', items: [
        'Toca + Agregar.',
        'Elige si es vehículo o maquinaria y cuál.',
        'Escribe los litros y de qué tanque salió.',
        'Toca Guardar. El tanque baja solo.',
      ] },
      { t: 'note', text: 'El sistema no deja sacar más litros de los que hay. Si te avisa, revisa el tanque.' },
    ],
  },
  {
    icon: '🚜',
    title: 'Equipos (catálogo de máquinas)',
    blocks: [
      { t: 'p', text: 'Es la lista de todas las máquinas. Cada una tiene su ficha: nombre, empresa, foto, serial y estado.' },
      { t: 'p', text: 'Cada máquina puede estar en uno de tres estados:' },
      { t: 'bullets', items: [
        '🟢 Operativa — trabajando normal.',
        '🔴 No operativa — dañada o parada.',
        '🕓 En espera — llegó pero todavía no se ha recibido en el control.',
      ] },
      { t: 'p', text: 'En cada máquina también puedes: 📍 guardar su ubicación, 📷 subirle una foto y 🔳 generar su código QR.' },
      { t: 'p', text: '🪖 Supervisor: cada máquina tiene un botón para asignar quién la custodia (Supervisor Empresa o Militar). Al escribir el nombre aparece una lista con los ya usados para elegirlo rápido. Cambiar de supervisor deja el anterior en el historial.' },
      { t: 'note', text: 'Editar o borrar supervisores: en ese mismo botón toca "⚙️ Editar / borrar supervisores". Ahí puedes ✎ renombrar un supervisor (se corrige en TODOS sus registros) o 🗑 borrarlo por completo (las máquinas que custodiaba quedan sin supervisor).' },
      { t: 'note', text: 'Desde el Inicio (dashboard), en "Estado de las máquinas" puedes tocar Operativas, En espera o No operativa: te lleva a Equipos y te muestra esa lista de máquinas.' },
    ],
  },
  {
    icon: '🛠️',
    title: 'Control de maquinaria (las horas que trabaja)',
    blocks: [
      { t: 'p', text: 'Es la parte del día a día. Aquí anotas cuántas horas trabajó cada máquina.' },
      { t: 'steps', items: [
        'Elige la semana con las flechas ◀ ▶ o el calendario.',
        'Abre la empresa y luego la máquina.',
        'Por cada día verás ☀️ Día y 🌙 Noche. Toca: — (no trabajó), Medio · 6h, o Completo · 12h.',
        'Si te lo pide, escribe el operador de ese turno.',
        'Todo se guarda solo.',
      ] },
      { t: 'p', text: 'Sección "🕓 En espera" (recibir máquinas): arriba salen las máquinas que aún no se han recibido. Para recibir una, elige su fecha de entrada y toca 📥 Recibir. Cada máquina puede tener su propia fecha.' },
      { t: 'p', text: 'Flete / viaje: dentro de cada máquina toca ➕ Flete / viaje para confirmar los viajes que hizo. Escribe la fecha, el nº de viajes y el precio por viaje; el sistema calcula el total. Ese monto se suma al TOTAL POR PAGAR de la empresa en la semana de esa fecha (aparece en el reporte). Puedes registrar varios y borrar los que no van con 🗑.' },
      { t: 'p', text: 'Cerrar el control: cuando termines, toca 🔒 Cerrar control. Se guarda todo en el Histórico y se congela el precio. Lo cerrado no se borra.' },
      { t: 'note', text: 'Lo cerrado SIGUE viéndose en el Control al navegar por semanas (marcado con 🔒 cerrado) y se puede seguir editando (por ejemplo, agregar días que faltaron). Ya no desaparece de la pantalla al cerrar.' },
      { t: 'note', text: 'Si editas una jornada que ya está CERRADA (🔒) desde el Control, el cambio se SINCRONIZA solo con el histórico: el reporte cerrado y el Histórico se actualizan en el acto (sin tener que reabrir el cierre). Si dejas la jornada en 0, esa fila sale del cierre.' },
      { t: 'note', text: 'Si necesitas corregir un cierre ya guardado: abre el 🗂️ Histórico, entra al cierre y toca "♻️ Reabrir cierre". Sus registros vuelven al control activo (semana de ese cierre) para editarlos y el cierre sale del histórico. Cuando termines de corregir, vuelve a cerrar el control (se congela el precio de nuevo).' },
      { t: 'note', text: 'Al cerrar un corte, el sistema CONGELA el precio de cada máquina de ese corte. Así, aunque en el siguiente corte suba o baje el precio de una máquina, el corte cerrado sigue mostrando su total original (en el reporte y en el Histórico). Los cortes abiertos usan el precio actual.' },
      { t: 'note', text: 'Para ver un reporte: toca 📊 Ver reporte, elige el rango de fechas y la empresa. Se abre una ventana con la vista previa del documento y dos botones: 🖨️ Imprimir y Cancelar. Toca Imprimir para mandarlo a la impresora o guardarlo como PDF.' },
      { t: 'note', text: 'El PDF de una empresa se guarda con su nombre y el rango, por ejemplo "Reporte Ferreconstrucciones del 06 al 12". Si al guardar/imprimir el encabezado azul se ve gris, activa la opción "Gráficos de fondo" (Background graphics) en el diálogo de impresión.' },
      { t: 'note', text: 'Conteo de equipos: en Reportes, la pestaña 📊 Conteo equipos muestra cuántos equipos hay por clasificación (ej. REMOCIÓN Y EXCAVACIÓN 70) y por tipo (JUMBO, RETROEXCAVADORA…). Arriba tiene tres botones: "Todos", "Con horas" y "Sin horas". "Todos" y "Con horas" muestran el conteo agrupado; "Sin horas" NO cuenta: muestra el LISTADO de las máquinas que no trabajaron (nombre, serial y clasificación). Al final, los totales de la flota: activos, inactivos y stand by, más el total con/sin horas. El PDF sale con el filtro elegido. No depende de fechas (cuenta todo el catálogo). Se puede descargar en PDF.' },
    ],
  },
  {
    icon: '💰',
    title: 'Control de pagos',
    blocks: [
      { t: 'p', text: 'Aquí se ve cuánto hay que pagar por las horas trabajadas, según los precios.' },
      { t: 'bullets', items: [
        'El Tabulador de precios es la lista maestra de precios por tipo de máquina. Se puede modificar y sincronizar.',
        'Tiene dos modos: General (aplica a todas las empresas) y por empresa. Arriba eliges "💲 General" o la empresa. Si a una empresa le pones un precio propio, ese manda; si lo dejas vacío, usa el General.',
        'Al sincronizar, cada máquina toma el precio de SU empresa (o el General si no tiene propio).',
        'Los cierres viejos no cambian; los nuevos usan el precio del tabulador.',
      ] },
    ],
  },
  {
    icon: '🪖',
    title: 'Supervisión (rondas de supervisores)',
    blocks: [
      { t: 'p', text: 'Sirve para saber si los supervisores SÍ están yendo a las máquinas a revisar que estén trabajando. Cada supervisor entra con su usuario (rol Supervisor) y ve su propia pantalla para salir a marcar máquinas.' },
      { t: 'p', text: 'Cómo marca el supervisor una máquina:' },
      { t: 'steps', items: [
        'Entra con su nombre y contraseña (rol Supervisor).',
        'Escanea el QR de la máquina: se abre la VISTA DE OPERADOR (combustible, ubicación, avería, jornada). Ahí toca "🪖 Hacer check-in de supervisión" (o toca la máquina en su lista "Mis máquinas a revisar").',
        'El sistema toma su ubicación GPS y calcula qué tan cerca está de la máquina.',
        'Elige el estado: 🟢 Trabajando, 🟡 Parada o 🔴 No está, y escribe una nota si quiere.',
        'Toca "✅ Marcar como revisada". Queda la hora, el estado y la distancia.',
      ] },
      { t: 'note', text: 'La cercanía es amplia a propósito (unos 300 m): si la máquina está trabajando y no se puede interrumpir, basta con estar "más o menos cerca". Si el supervisor está lejos, igual se guarda pero queda marcado "lejos ⚠️".' },
      { t: 'note', text: 'REGLA IMPORTANTE: si el supervisor NO marca una máquina que trabajó ese día, esa jornada queda "sin validar" y el operador no cobra.' },
      { t: 'p', text: 'Módulo "Supervisión" (para el jefe, en Más): muestra por día quién marcó cada máquina, a qué hora, con qué estado y qué tan cerca estaba, y sobre todo la lista de "⛔ Jornadas sin validar" (máquinas que trabajaron pero que ningún supervisor marcó). Usa las flechas ◀ ▶ para cambiar de día.' },
    ],
  },
  {
    icon: '🍽️',
    title: 'Distribución de comida',
    blocks: [
      { t: 'p', text: 'Sirve para llevar el control de cuántas comidas se le reparten a cada persona. Quien reparte es un usuario con rol Cocina (entra con su nombre y contraseña).' },
      { t: 'steps', items: [
        'La persona de Cocina inicia sesión (rol Cocina).',
        'Se VERIFICA escaneando su propio carnet (o por cédula). Solo pasa si su cargo en nómina es de cocina/alimentación (ayudante de cocina, alimentación, cocinero, cocina); si no, no puede registrar.',
        'Escanea el carnet de nómina de la persona (el mismo del empleado) o lo busca por cédula.',
        'Ve los datos de la persona (foto, cargo, cédula).',
        'Marca Desayuno, Almuerzo o Cena: cada botón se marca 1 sola vez por día por persona.',
        'Queda guardado con la hora. Debajo se ve lo ya marcado hoy a esa persona.',
      ] },
      { t: 'note', text: 'Debajo se ve lo que ya se le entregó a esa persona hoy y el total. Si te equivocaste, puedes borrar una entrega con 🗑.' },
      { t: 'note', text: 'Si escaneas el carnet pegado (sticker) con la cámara del teléfono: estando con sesión de Cocina abre directo el registro de esa persona; si no has entrado, toca "🍽️ ¿Eres de cocina? Inicia sesión" y al entrar cae en el registro de esa misma persona.' },
      { t: 'p', text: 'Módulo "Distribución de comida" (en Más, para el jefe): por día muestra las comidas repartidas POR EMPRESA (desayuno/almuerzo/cena) y también por persona, con sus totales. Usa las flechas ◀ ▶ para cambiar de día.' },
      { t: 'p', text: 'Comida POR EMPRESA (con QR): además de repartir por persona, se puede registrar por empresa con un QR propio de cada empresa.' },
      { t: 'steps', items: [
        'En "Distribución de comida" (jefe), toca "🖼️ QR por empresa (imágenes)" y descarga el QR de cada empresa como IMAGEN individual (logo + QR + nombre). Las empresas desactivadas no aparecen.',
        'La cocina escanea el QR de la empresa: se abre su pantalla de comidas del día.',
        'Se verifica con su carnet/cédula (solo cargo de cocina/alimentación).',
        'Toca uno de los 3 botones grandes: Desayuno, Almuerzo o Cena (cada uno 1 sola vez por día por empresa).',
        'El sistema sugiere el total = máquinas de la empresa × 2 + 15; el cocinero escribe cuántas comidas entregó realmente y registra.',
      ] },
      { t: 'note', text: 'Cada comida (desayuno/almuerzo/cena) se puede marcar UNA sola vez por día por empresa. Queda guardado con la empresa, la cantidad, la hora y quién la registró. Ese registro ES el control de asistencia/entrega de la empresa.' },
      { t: 'p', text: 'Control por empresa (asistencia/entrega): en "Distribución de comida" (jefe) toca la pestaña "📊 Control por empresa". Elige un rango de fechas (o los atajos Hoy / 7 días / 30 días) y verás:' },
      { t: 'steps', items: [
        'Totales del rango: total entregado y cuánto por desayuno, almuerzo y cena.',
        'Resumen por empresa: cuánto entregó cada empresa por tiempo de comida y en cuántos días.',
        'Al elegir UNA empresa (filtro de arriba): su historial día por día, con lo entregado en cada comida, la hora y quién lo registró.',
        'Botón "📄 Descargar reporte PDF" para imprimir/llevar el control por empresa del rango elegido.',
      ] },
    ],
  },
  {
    icon: '🔄',
    title: 'Traslados, Autorizaciones, Mantenimiento, Mapa',
    blocks: [
      { t: 'bullets', items: [
        'Traslados: mover combustible de un tanque a otro (se descuenta de uno y se suma al otro).',
        'Autorizaciones: cuando algo necesita permiso, se pide aquí y la persona autorizada lo aprueba o rechaza.',
        'Mantenimiento: se registran las máquinas que necesitan reparación.',
        'Mapa: muestra dónde está cada máquina según su última ubicación GPS. Con el panel "🗺️ Sectores (zonas)" puedes ver u ocultar las zonas de La Guaira (Sector Oeste y Este), cada una con su color y sus límites.',
        'Mapa · Capas: con el panel "🗂️ Capas" prendes y apagas los puntos por categoría (camiones y transporte, grúas, excavadoras, cargadores, compactadores…) o por máquina individual. Usa "Mostrar todas" / "Ocultar todas" o toca una categoría para ver sus máquinas y elegir una por una.',
      ] },
    ],
  },
  {
    icon: '🧩',
    title: 'Cosas que sirven en TODAS las secciones',
    blocks: [
      { t: 'bullets', items: [
        '🔎 Buscar: escribe parte del nombre, serial o empresa.',
        '🏢 Filtrar por empresa: toca el selector para ver solo esa.',
        '📅 Rango de fechas: en los reportes, elige "desde" y "hasta".',
        'Guardar: el botón verde o azul confirma. El rojo detiene o cancela.',
        'Volver: la flecha ← de arriba.',
        '🔢 Números: los campos de cédula, dinero, horas, litros y kilómetros solo aceptan números (no dejan escribir letras).',
        '🖨️ Imprimir: los reportes se abren en una ventana con vista previa y los botones Imprimir y Cancelar.',
        '🚛 Camiones E/S: incluye TODO lo de transporte (camión, chuto, volteo, toronto, volqueta y cisternas de agua o combustible). Se actualiza en línea: si agregas o cambias una máquina, la lista se refresca sola.',
        '🔄 Actualizaciones: cuando se publica una versión nueva del sistema, aparece abajo una barra azul que dice "Sistema en proceso de actualización". Toca el botón ACTUALIZAR y la página se refresca con la versión nueva. Ya no hace falta refrescar a mano.',
      ] },
    ],
  },
  {
    icon: '❓',
    title: 'Preguntas frecuentes',
    blocks: [
      { t: 'bullets', items: [
        'No veo una sección → tu usuario no tiene permiso; pídeselo al administrador.',
        'Me equivoqué en las horas → vuelve a tocar la opción correcta; se corrige solo.',
        '¿El nivel del tanque se escribe a mano? → No, se calcula solo.',
        'Cerré el control sin querer → queda guardado en el Histórico; sigue con la semana siguiente.',
        'Se ve distinto en teléfono y computadora → es normal; funciona igual en ambos.',
      ] },
    ],
  },
];

// ── Render de un bloque ───────────────────────────────────────────────────────
function BlockView({ b }: { b: Block }) {
  const { colors } = useTheme();
  if (b.t === 'p') return <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: spacing.sm }}>{b.text}</Text>;
  if (b.t === 'note')
    return (
      <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: colors.primary, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
        <Text style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>💡 {b.text}</Text>
      </View>
    );
  if (b.t === 'steps')
    return (
      <View style={{ marginBottom: spacing.sm, gap: 6 }}>
        {b.items.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{i + 1}</Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21, flex: 1 }}>{s}</Text>
          </View>
        ))}
      </View>
    );
  // bullets
  return (
    <View style={{ marginBottom: spacing.sm, gap: 5 }}>
      {b.items.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
          <Text style={{ color: colors.primary, fontSize: 15, marginTop: 1 }}>•</Text>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21, flex: 1 }}>{s}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ManualScreen() {
  const { colors } = useTheme();
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  const [query, setQuery] = useState('');

  const q = norm(query.trim());
  // Filtra por texto de título o de cualquier bloque (para encontrar rápido un tema).
  const shown = useMemo(() => {
    if (!q) return SECTIONS.map((s, i) => ({ s, i }));
    return SECTIONS.map((s, i) => ({ s, i })).filter(({ s }) => {
      if (norm(s.title).includes(q)) return true;
      return s.blocks.some((b) =>
        b.t === 'p' || b.t === 'note' ? norm(b.text).includes(q) : b.items.some((x) => norm(x).includes(q))
      );
    });
  }, [q]);

  return (
    <Screen>
      <SectionTitle>Manual / Ayuda</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
        Guía paso a paso. Toca un tema para abrirlo. Si algo no aparece en tu pantalla, es porque tu usuario no tiene permiso para esa parte.
      </Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar un tema…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {shown.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: spacing.lg }}>
          No se encontró ese tema. Prueba con otra palabra.
        </Text>
      ) : (
        shown.map(({ s, i }) => {
          const isOpen = q ? true : !!open[i];
          return (
            <Card key={i}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setOpen((p) => ({ ...p, [i]: !p[i] }))}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
              >
                <Text style={{ fontSize: 22 }}>{s.icon}</Text>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{s.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 16 }}>{isOpen ? '▾' : '▸'}</Text>
              </TouchableOpacity>
              {isOpen ? (
                <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                  {s.blocks.map((b, j) => (
                    <BlockView key={j} b={b} />
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })
      )}
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
