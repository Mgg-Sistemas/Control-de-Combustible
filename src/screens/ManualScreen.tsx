import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { norm } from '../lib/text';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { generateInspectorGuide } from '../lib/guides/inspectorGuide';
import { generateOperadorGuide } from '../lib/guides/operadorGuide';
import { generateCoordinadorOperadoresGuide } from '../lib/guides/coordinadorOperadoresGuide';
import { generateCocinaGuide } from '../lib/guides/cocinaGuide';
import { generatePatioGuide } from '../lib/guides/patioGuide';
import { generateChoferCombustibleGuide } from '../lib/guides/choferCombustibleGuide';
import { generateCoordinadorQrGuide } from '../lib/guides/coordinadorQrGuide';
import { generateAnalistaGuide } from '../lib/guides/analistaGuide';
import { generateFabricacionGuide } from '../lib/guides/fabricacionGuide';
import { generateListeroViajesGuide } from '../lib/guides/listeroViajesGuide';
import { generateObrasPublicasGuide } from '../lib/guides/obrasPublicasGuide';

// ── Guías rápidas descargables (PDF), una por rol — ver src/lib/guides/. ──────
// Sin la de Administrador a propósito (pedido del cliente): no aporta como hoja
// de referencia de campo, el admin ya tiene acceso a todo el manual completo.
const ROLE_GUIDES: { key: string; label: string; desc: string; icon: string; run: () => Promise<boolean> }[] = [
  { key: 'inspector', label: 'Inspector', desc: 'Iniciar sesión, escanear la máquina y llevar la jornada', icon: '🪖', run: generateInspectorGuide },
  { key: 'operador', label: 'Operador', desc: 'Registrar tu jornada y el combustible desde el teléfono', icon: '👷', run: generateOperadorGuide },
  { key: 'coordoperadores', label: 'Coordinador de Operadores', desc: 'Asignar operadores a máquinas, asistencia y novedades', icon: '👷‍♂️', run: generateCoordinadorOperadoresGuide },
  { key: 'cocina', label: 'Cocina', desc: 'Verificarte y entregar comidas por carnet', icon: '🍽️', run: generateCocinaGuide },
  { key: 'patio', label: 'Coordinador de Patio', desc: 'Jornada de camiones, entrada/salida, gasoil y averías', icon: '🚚', run: generatePatioGuide },
  { key: 'chofer', label: 'Chofer de Combustible', desc: 'Surtir combustible a las máquinas', icon: '⛽', run: generateChoferCombustibleGuide },
  { key: 'coordqr', label: 'Coordinador QR', desc: 'Surtir gasoil, reportar avería y marcar máquina lista', icon: '📷', run: generateCoordinadorQrGuide },
  { key: 'analista', label: 'Analista', desc: 'Marcar asistencia del personal', icon: '📊', run: generateAnalistaGuide },
  { key: 'fabricacion', label: 'Fabricación (MRP)', desc: 'Mangueras, maestros, órdenes y kiosco de planta — módulo completo', icon: '🏭', run: generateFabricacionGuide },
  { key: 'listeroviajes', label: 'Listero (Viajes de camiones)', desc: 'Registrar cada viaje del camión con un solo toque', icon: '🚛', run: generateListeroViajesGuide },
  { key: 'obraspublicas', label: 'Obras Públicas', desc: 'Máquinas, jornada, parada/avería y m³ por edificio con reporte a WhatsApp', icon: '🏛️', run: generateObrasPublicasGuide },
];

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
        'Escribe tu USUARIO y tu contraseña. (El usuario lo crea el administrador; tiene máximo 10 caracteres. Ya no se entra con la cédula.)',
        'Si quieres revisar que la clave esté bien escrita, toca el ícono de ojo 👁️ dentro del campo de contraseña para mostrarla u ocultarla.',
        'Toca el botón Entrar.',
        'Si el teléfono te lo pide, la próxima vez puedes entrar con tu huella o tu cara.',
      ] },
      { t: 'note', text: 'Cuidado con los intentos: si te equivocas de contraseña 3 veces, el usuario se BLOQUEA por seguridad. Solo un administrador puede desbloquearlo (en "Más" → Usuarios).' },
      { t: 'note', text: 'Iniciar sesión con huella (TODOS los usuarios): actívalo con el interruptor "🔐 Iniciar sesión con huella". El administrador lo tiene en "Más" → Seguridad; los demás roles lo ven en su propio panel, en la sección Seguridad. Una vez activo, la app te pide tu huella o tu cara al abrirla.' },
      { t: 'note', text: '¿Olvidaste la contraseña? Toca "¿Olvidaste tu contraseña?" y sigue lo que llega a tu correo.' },
      { t: 'note', text: 'Cambiar tu contraseña (todos los usuarios): ya dentro del sistema puedes cambiar tu clave cuando quieras. Administrador: en "Más" → sección Seguridad → "🔑 Cambiar mi contraseña". Operador, Inspector y Cocina: el botón "🔑 Contraseña" arriba, junto a "Salir". Escribe la nueva clave (mínimo 6 caracteres), repítela y guarda. La próxima vez entras con la nueva.' },
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
      { t: 'note', text: '📍 Ubicación vinculada al SECTOR del GPS (22/08/2026): en el Catálogo y en Inspecciones, la ubicación de una máquina CON GPS es el SECTOR real donde cae — el nombre del POLÍGONO que la contiene en el mapa (ej. "📍 Este · Caraballeda"), calculado EN VIVO desde el GPS igual que el Mapa. Así nunca se contradice con el mapa ni queda pegado un edificio viejo escrito a mano. Si el punto no cae dentro de ningún polígono, toma el sector MÁS CERCANO (siempre hay uno; no hay que crear nada — un polígono nuevo solo lo dibuja un admin en el Mapa con "🗺️ Mover sectores"). DEBAJO del sector se muestra TAMBIÉN el 🏗️ EDIFICIO/lugar escrito a mano (la referencia), para tener las dos cosas: el sector real (GPS) y el edificio. Sin GPS se muestra solo el edificio. Antes el Catálogo mostraba SOLO el edificio escrito a mano como ubicación y podía quedar desactualizado (ej. decía "OPP22" cuando el GPS ya estaba en otra parte); ahora el sector sale del GPS y no se desactualiza.' },
      { t: 'note', text: '🆔 El NOMBRE no identifica a una máquina — la PLACA o el SERIAL sí (18/08/2026). El nombre se repite a propósito: hoy hay TRES máquinas llamadas exactamente RETROEXCAVADORA (identificadores 008, 053 y 073). Lo único que el sistema obliga a no repetir es la placa y el serial. Esto causó una confusión real: un inspector sacó dos reportes del mismo día, en uno una RETROEXCAVADORA salía averiada y en el otro una salía con 9.34 horas trabajadas — y parecía que el sistema se contradecía. Los dos estaban bien: eran DOS MÁQUINAS distintas. La averiada era la 053; la que trabajó, la 008.' },
      { t: 'note', text: '📛 Qué cambió: donde antes se veía solo el nombre, ahora se ve NOMBRE · PLACA (o el serial, o el identificador, en ese orden — la placa primero porque es lo que se usa para asignar). Aplica en la ficha del trabajador, la lista de máquinas del operador, el reporte de trazabilidad, la asignación de inspectores, el reporte del inspector y la bitácora de asignaciones. Y ya se puede BUSCAR por placa o serial, no solo por nombre.' },
      { t: 'note', text: '⚠️ También se corrigieron dos sitios que SUMABAN MAL (eran números equivocados, no solo confusión): la ficha del trabajador agrupaba las horas POR NOMBRE, así que las horas de las tres RETROEXCAVADORAS caían en una sola fila; y la tarjeta de litros por máquina mezclaba el combustible de equipos distintos. Ahora ambas agrupan por la máquina real. Los PDF de trazabilidad también salen con nombre de archivo distinto: antes tres equipos generaban tres archivos llamados igual y el último pisaba a los anteriores.' },
      { t: 'p', text: 'Cada máquina puede estar en uno de cuatro estados:' },
      { t: 'bullets', items: [
        '🟢 Operativa — trabajando normal.',
        '🔴 No operativa — dañada o parada.',
        '🕓 En espera — llegó pero todavía no se ha recibido en el control.',
        '⏳ Esperando instrucciones — se cargó en el sistema pero todavía no se decidió si va a Operativa o a Parada.',
      ] },
      { t: 'note', text: '⏳ Esperando instrucciones: mientras una máquina está en este estado NO le sale a los inspectores para chequeo ni le piden jornada, y NO genera horas ni consumo — queda en pausa hasta que alguien decida qué hacer con ella. Se activa/desactiva con un botón en el DETALLE de la máquina: "⏳ Esperando instrucciones" para ponerla en espera, o "✅ Ya se decidió (quitar espera)" cuando ya se sabe si va Operativa o No operativa. Aparece como una 4ta tarjeta en el Catálogo, junto a Operativas / Averiadas / Retiradas. AL AGREGAR una máquina nueva, el formulario trae el check "⏳ Dejar \'Esperando instrucciones\' (aún no decidida)" ACTIVADO por defecto: toda máquina nueva entra directo a este estado, salvo que lo destildes al crearla (si ya sabes que va operativa de una vez).' },
      { t: 'p', text: 'En cada máquina también puedes: 📍 guardar su ubicación, 📷 subirle una foto y 🔳 generar su código QR.' },
      { t: 'note', text: '📷🗑 FOTOS: QUITARLAS SIN REEMPLAZARLAS. Toca la foto de una máquina para abrir el visor: ahí están la foto de la MAQUINARIA y la del SERIAL / PLACA, cada una con sus botones. Antes solo se podía "🔄 Cambiar foto", así que para sacar una foto mala o que no correspondía había que subir otra cualquiera encima. Ahora hay también "🗑 Quitar foto" —sale solo cuando hay foto que quitar— y la máquina queda sin foto hasta que alguien suba otra. Pide confirmación, porque desde el visor es un solo toque y no hay deshacer. El archivo NO se borra del almacenamiento a propósito: la bitácora de Auditoría guarda el enlace de la foto anterior, y borrarlo dejaría ese rastro apuntando a un enlace muerto justo cuando alguien pregunte qué foto había antes. Quién la quitó y cuándo queda registrado en 🕵️ Auditoría.' },
      { t: 'note', text: '🛡️ Tapa: al crear/editar una máquina marcas con un check si "¿Tiene tapa?"; si la tiene, aparece un 2º check "¿Doble tapa?" (si no lo marcas, es sencilla). En la ficha se muestra "🛡️ Tapa: Sin tapa / Tapa sencilla / Doble tapa", y arriba del catálogo hay un filtro de tapa (Tapa sencilla · Doble tapa · Sin tapa) — también puedes escribir "doble tapa" o "sencilla" en el buscador. El filtro de tapa cuenta SOLO los equipos de la clasificación "Transporte de escombros" (son los únicos que llevan/no llevan tapa), así que su total cuadra con ese chip de clasificación.' },
      { t: 'note', text: 'La hoja del QR muestra el NOMBRE de la máquina y su SERIAL (o placa) — no la empresa.' },
      { t: 'note', text: 'QR sellado con el serial: el QR queda amarrado al serial de la máquina. Si cambias el serial, el QR impreso con el serial anterior DEJA DE FUNCIONAR (al escanearlo solo sale el logo). Reimprime el QR para activarlo con el nuevo serial. Los QR impresos antes de esta versión no llevan sello y siguen funcionando hasta que los reimprimas.' },
      { t: 'note', text: 'Bloquear QR: dentro del 🔳 QR de cada máquina hay un botón "🚫 Bloquear QR". Al bloquearlo, cualquiera que escanee ese QR solo verá el logo (no puede registrar nada). Sirve para matar un QR viejo o robado sin tocar el serial. Con "✅ Desbloquear QR" vuelve a funcionar.' },
      { t: 'note', text: 'Retirada = QR bloqueado automático: cuando una máquina se marca RETIRADA (fuera de servicio), su QR deja de funcionar solo — al escanearlo solo sale el logo, sin bloquearlo a mano. Si la reactivan (vuelve a Operativa), el QR vuelve a funcionar automáticamente. Vale también cuando el inspector la escanea desde el teléfono: solo el logo con un botón "← Volver" (no abre el check-in).' },
      { t: 'note', text: 'El inspector ya NO ve el Catálogo (19-ago-2026): se quitó la pestaña 🚜 Catálogo de la vista del teléfono del inspector. Trabaja con Revisar (sus máquinas), Mapa y Ubicaciones.' },
      { t: 'note', text: 'Restricción por empresa: un operador SOLO puede usar equipos de SU empresa. Si un operador escanea el QR de una máquina de otra empresa e intenta identificarse, el sistema lo bloquea con un aviso ("Este equipo es de X, solo puedes usar equipos de tu empresa") y no lo deja iniciar jornada ni registrar nada. El supervisor NO tiene esta restricción: puede escanear cualquier máquina y marcarla Operativa/No (check-in de supervisión).' },
      { t: 'note', text: 'Al escanear el QR de la máquina: sale una pantalla con el logo y DOS botones — 👥 Usuarios y 🚜 Operadores. "Usuarios" lleva al LOGIN (usuario y contraseña) y CUALQUIER rol cae en la VISTA DE INSPECTORES de esa máquina: ve nombre de la maquinaria, empresa y serial/placa, y los botones del inspector (marcar estado/ubicación, iniciar la jornada del operador escaneando su carnet —opcional—, reportar avería, surtir gasoil). "Operadores" abre la vista de operador que exige escanear el carnet para poder registrar. El login NORMAL (sin escanear) sigue viendo la app como siempre.' },
      { t: 'note', text: 'Máquina PARADA: en el check-in, al marcar 🟡 Parada se eligen 2 caminos — "Por avería" (material + falla, crea la solicitud en Servicio de Maquinaria) o "Parada / No trabajó" (motivo fijo + ubicación GPS, no toca Servicio). En Control de maquinaria esa máquina sale marcada como "🔴 MÁQUINA PARADA (avería)". El inspector asignado (último check-in) también sale en Control (🪖 Inspector). Al finalizar la jornada, las horas activas (horómetro final − inicial) pasan solas a Control de maquinaria en su turno (día/noche).' },
      { t: 'p', text: '🪖 Supervisor: cada máquina tiene un botón para asignar quién la custodia (Supervisor Obras Públicas o Militar). Al escribir el nombre aparece una lista con los ya usados para elegirlo rápido. Cambiar de supervisor deja el anterior en el historial.' },
      { t: 'note', text: 'Editar o borrar supervisores: en ese mismo botón toca "⚙️ Editar / borrar supervisores". Ahí puedes ✎ renombrar un supervisor (se corrige en TODOS sus registros) o 🗑 borrarlo por completo (las máquinas que custodiaba quedan sin supervisor).' },
      { t: 'note', text: 'Desde el Inicio (dashboard), en "Estado de las máquinas" puedes tocar Operativas, En espera o No operativa: te lleva a Equipos y te muestra esa lista de máquinas.' },
      { t: 'note', text: 'Total de flota disponible (20-ago-2026): arriba de las tarjetas de estado del Catálogo hay un recuadro grande "TOTAL DE FLOTA DISPONIBLE" = Operativas + Averiadas + Esperando instrucciones. Las Retiradas NO se cuentan (fuera de servicio). Debajo sigue el desglose por estado, cada tarjeta se toca para ver esa lista.' },
      { t: 'note', text: '👤 Encargado OBLIGATORIO al crear (20-ago-2026): al agregar una máquina o un vehículo NUEVO hay que decir quién es el ENCARGADO; sin eso no deja guardar ("Coloca el ENCARGADO de la máquina (obligatorio)"). Solo se exige al CREAR: al EDITAR un equipo que ya existe se puede guardar sin llenarlo, para no trancar la ficha de los equipos viejos que nunca lo tuvieron (esos se van completando a medida que alguien los edite). En los VEHÍCULOS el campo es nuevo: aparece únicamente después de correr `supabase/vehiculos_encargado.sql`; mientras tanto el formulario de vehículos sale como siempre y no lo pide.' },
      { t: 'note', text: '🏢 Empresa en la ficha de cada máquina (20-ago-2026): la tarjeta de cada equipo del Catálogo ahora dice a qué EMPRESA pertenece, debajo de la clasificación. Es solo informativo — no cambia nada de la máquina ni de los reportes. Antes había que fijarse en bajo qué empresa estaba agrupada, y al BUSCAR (o al llegar desde el QR o desde el Inicio) la tarjeta se ve suelta, fuera de su grupo, así que no había forma de saberlo. Si la máquina no tiene empresa asignada, lo dice: "Sin empresa" (eso sí hay que corregirlo en su ficha). Sale igual en las listas que se abren al tocar las tarjetas de estado (Operativas / Averiadas / Retiradas / Esperando instrucciones).' },
      { t: 'note', text: '📄 Reporte de CONTEO de equipos (desde el Catálogo): es solo conteo + detalle, SIN horas ni precios. Muestra: (1) el TOTAL GENERAL de equipos, (2) la cantidad POR EMPRESA, y (3) el DETALLE por empresa donde cada equipo sale como Equipo (tipo) · Serial · Estado. Eliges el ALCANCE (General o una empresa). El filtro por tipo es una LISTA DESPLEGABLE con buscador y CASILLAS: ábrela, escribe (ej. "volteo toronto") y tilda uno o varios tipos para ver solo esos. Botón ⬇️ Descargar PDF (conteo).' },
      { t: 'note', text: '🏢 Varias empresas a la vez (Catálogo · reporte de conteo): el alcance ya no es una sola empresa. Las pastillas de empresa son CASILLAS y se pueden marcar VARIAS (ej. GOLDEN + LICCIONE): el PDF sale con las dos, agrupadas por empresa. "General (todas)" no es una empresa más — al tocarla LIMPIA la selección y el reporte vuelve a salir completo. Arriba se ve cuántas llevas marcadas y hay un enlace "✕ Quitar la selección (volver a general)". El título se adapta: con una o dos las nombra ("Conteo de equipos — GOLDEN + LICCIONE") y de tres en adelante resume ("Conteo de equipos — 3 empresas"). Los filtros de estado y clasificación se aplican encima de lo marcado.' },
      { t: 'note', text: '☑️ Incluir el inspector asignado (Catálogo · reporte de conteo): encima del botón de descarga hay una casilla que decide si el PDF trae las columnas Inspector ☀️ Día e Inspector 🌙 Noche. Viene TILDADA (es como salía el reporte hasta ahora, así que quien no la toque baja el mismo documento de siempre). Al destildarla el PDF sale SOLO con el conteo —equipo, clasificación, serial, placa, sector, edificio y estado— y el botón cambia a "⬇️ Descargar PDF (solo conteo)". Útil cuando el reporte es para alguien que solo necesita cuántos equipos hay y dónde están.' },
      { t: 'note', text: 'Máquinas INACTIVAS (No operativa): al marcar una máquina como No operativa (⛔), SALE del catálogo y de la lista semanal de Control de maquinaria; solo aparece en la tarjeta "🔴 Maquinaria inactiva". Sus horas ya trabajadas NO se borran (siguen en los reportes). Al volverla ✅ Operativa, regresa al catálogo y al control. Los detalles de "inactiva" y "en espera" salen agrupados por empresa, desplegables y colapsables. La lista de INACTIVAS arranca COLAPSADA (se abre al tocar la empresa) y cada máquina muestra su placa y su serial.' },
      { t: 'note', text: 'Fecha de inactivación/reactivación: cada vez que una máquina pasa a No operativa o vuelve a Operativa, su tarjeta muestra "🔴 Inactivada el DD/MM/AAAA" o "🟢 Reactivada el DD/MM/AAAA". Es un dato aparte de las averías/paradas que reporta un inspector desde el teléfono — este lo mueve el administrador a mano con el botón de estado.' },
      { t: 'note', text: 'Motivo obligatorio al RETIRAR (⬛ Retirar): al sacar una máquina de servicio el sistema pide POR QUÉ. Se abre una ventana con motivos comunes (Vendida · Siniestro/accidente · Fin de contrato · Reparación mayor · Chatarra/fin de vida útil · Otro) que rellenan un campo editable; se puede elegir uno y ajustarlo, o escribir el propio. Sin motivo el botón "⬛ Retirar de servicio" queda deshabilitado. El motivo se muestra en la ficha del catálogo ("📝 Motivo: …") junto a "Inactivada el / por", y queda en Auditoría. Reactivar (✅ Operativa) NO pide motivo.' },
      { t: 'note', text: 'Última parada/avería resuelta: si una máquina tuvo una parada o avería reportada por un inspector y ya se resolvió ("🟢 Volver a OPERATIVA"), su ficha muestra "Inactivo desde [fecha/hora] hasta [fecha/hora] — Total: Xd Yh". Solo se ve cuando la máquina NO está parada/averiada en este momento.' },
      { t: 'note', text: 'Vehículos JUNTO a las máquinas en el Catálogo: los vehículos ya NO salen en una caja "🚗 Vehículos" aparte — aparecen dentro del acordeón de SU empresa, mezclados con las máquinas (el número de la empresa cuenta máquinas + vehículos). Siguen siendo aparte del negocio: NO entran a Control, Inspecciones, reportes por jornada ni pagos; son solo para combustible y autorizaciones. (Si filtras por clasificación o tapa, el catálogo muestra solo máquinas, porque esos filtros son de maquinaria.)' },
      { t: 'note', text: 'Vehículos con ficha completa + FOTO: al cargar un VEHÍCULO (🚗) el formulario se ve igual que el de maquinaria — NOMBRE del vehículo (arriba, como el "Código/Nombre" de la maquinaria; OBLIGATORIO al crear; la placa sigue siendo el identificador único), marca, modelo, clasificación, tipo, identificador, serial, empresa supervisora, grupo y ENCARGADO (también obligatorio al crear, va justo debajo de "Esperando instrucciones"). En la tarjeta, si el vehículo tiene nombre se muestra como título y la placa debajo. La FOTO se ve como en las máquinas: toca la MINIATURA de la tarjeta y se abre el visor ampliado con la foto del vehículo y la del serial/placa, cada una con "🔄 Cambiar foto" y "🗑 Quitar foto". Los vehículos SIGUEN siendo aparte de la maquinaria: NO entran a Control, Inspecciones ni pagos por jornada; son solo para combustible y autorizaciones. (Requiere haber corrido supabase/vehiculos_ficha_maquinaria.sql, supabase/vehiculos_encargado.sql y supabase/vehiculos_nombre.sql; si no, esos campos no se muestran y el formulario de vehículo sigue en su versión básica.)' },
    ],
  },
  {
    icon: '🏛️',
    title: 'Obras Públicas',
    blocks: [
      { t: 'p', text: 'Módulo AISLADO para los supervisores externos de Obras Públicas: manejan las jornadas, averías/paradas, visitas y ubicación de SUS máquinas asignadas, sin afectar el módulo de inspectores. Lo único que se comparte con el resto del sistema es la UBICACIÓN (se ve en el mapa y el catálogo).' },
      { t: 'p', text: 'Asignar máquinas a un supervisor: desde el Catálogo, botón "🏛️ Obras Públicas" — eliges el supervisor (de la lista de usuarios con ese rol) y le asignas máquinas por lote o una por una. La máquina asignada le aparece a ese supervisor en su teléfono ("🏛️ Mis máquinas").' },
      { t: 'note', text: 'En la asignación de Obras Públicas aparecen TODAS las máquinas del catálogo (operativas y averiadas), de cualquier empresa. Antes solo salían GOLDEN y LICCIONE: para darle una máquina de otra empresa había que tocar el código. Ya no — marcas la que quieras y listo.' },
      { t: 'p', text: 'Vista del supervisor (teléfono): arriba tiene una fila de tarjetas resumen (m³ removidos hoy, edificios de hoy, máquinas asignadas, trabajando, averiadas, m³ totales); al tocar "Trabajando" o "Averiadas" se filtra la lista, y al tocar "m³ removidos hoy" / "Edificios hoy" / "m³ totales" se abre el módulo de m³ por edificio. Por cada máquina puede registrar visita (GPS), iniciar/finalizar jornada, marcar avería o parada y actualizar la ubicación.' },
      { t: 'p', text: 'Registrar m³ removidos (por EDIFICIO, ya NO por máquina): con el botón "⛰️ Removidos hoy · por edificio" se abre un módulo aparte. Elige el edificio (la lista está agrupada por sub-sector: El Palmar, Los Corales…) y escribe los "m³ removidos hoy" de ese edificio. La PRIMERA vez de cada edificio se teclea además el "m³ acumulados (base)"; a partir de ahí el acumulado crece solo con los removidos de los días siguientes. Puedes editar (✎) o borrar (🗑) lo del día. Arriba se ven los totales: m³ removidos hoy y m³ acumulados.' },
      { t: 'p', text: 'Detalle por edificio (reporte diario): en cada edificio hay un "▾ Detalle" que despliega los campos del reporte diario — acarreo por vehículo (viajes), maquinaria en uso / inoperativa, cuerpos (supervivientes / fallecidos), actividades del día y un interruptor "✅ Frente entregado". En "maquinaria por requerimiento" se marca con check (multi-selección) de la lista de máquinas asignadas a ese supervisor. Es opcional y se guarda con el mismo botón Guardar (un edificio se guarda aunque no tenga m³ si le pusiste detalle).' },
      { t: 'note', text: 'ACARREO por VIAJES (nuevo): el m³ acarreado ya NO se teclea a mano — se ingresan los VIAJES por tipo de vehículo y el sistema calcula los m³ solo: 🚛 Camión Volteo Toronto = 18 m³/viaje · 🚚 Chuto con Volqueta = 25 m³/viaje. Ej.: 4 viajes con Toronto = 72 m³. Abajo se ve "🧮 M³ acarreados" calculado y el total de viajes. Así el acarreo va SIEMPRE atado a una cantidad de viajes.' },
      { t: 'note', text: 'Tarjeta "🚚 m³ acarreados totales": tanto en el teléfono como en el panel de PC hay una tarjeta que va sumando TODOS los m³ acarreados de la operación (Toronto + Volqueta). Se sincroniza con los reportes y el módulo.' },
      { t: 'note', text: 'Al marcar "✅ Frente entregado", los m³ ACARREADOS del frente deben CUADRAR con los m³ REMOVIDOS. Si no coinciden, al guardar sale un aviso con la diferencia para que ajustes los viajes o los m³ removidos antes de cerrar el frente.' },
      { t: 'p', text: 'Enviar por WhatsApp (📤): el botón "Enviar reporte por WhatsApp" arma el texto del reporte del día por edificio (agrupado por sub-sector, solo con las líneas que tienen dato, y los totales del día al final) y abre WhatsApp con el mensaje listo. Usa lo YA guardado, así que guarda primero.' },
      { t: 'p', text: 'Reporte del día (botón "📋 Reporte del día"): es SOLO LECTURA — no se ingresa nada ahí, TRAE lo que ya cargaste hoy por edificio en "⛰️ Removidos hoy". Muestra los totales del día (removidos, acumulado, acarreados, viajes, edificios, cuerpos) y el detalle por edificio (m³, maquinaria en uso/inoperativa/requerimiento, cuerpos, actividades, entregado). Abajo tiene "📤 Enviar reporte por WhatsApp".' },
      { t: 'p', text: 'Panel de Obras Públicas (Más → 🏛️ Obras Públicas): panel de admin/coordinador que AGREGA todo el módulo (todos los supervisores). Muestra KPIs (máquinas asignadas, trabajando ahora, averiadas/paradas, m³ del día, edificios de hoy), el Reporte de Actividades consolidado del día con los acumulados desde el inicio, la lista de "m³ removidos hoy por edificio" (con su acumulado, sincronizada con el teléfono), gráficos (distribución por estado 7/30), el estado de la flota en campo y la tabla de registros de acarreo. El gráfico de "Acarreo Total" es interactivo: al tocar un día muestra el detalle de ese día (máquinas con actividad, con serial · placa · empresa y horas). La tabla "Registros de acarreo" muestra cada máquina con su serial · placa · empresa. Puedes filtrar por supervisor con los chips de arriba, y tocar un KPI para filtrar la flota. El admin ajusta la base acumulada del reporte con "⚙️ Editar base".' },
      { t: 'note', text: '🗺️ Sub-sector de los edificios: cada edificio del catálogo (Más → Ubicaciones) puede llevar un sub-sector (El Palmar / Los Corales…). Eso agrupa la lista al registrar los m³ por edificio. Se edita en Ubicaciones con "✎ Editar".' },
      { t: 'note', text: 'Las horas y estados de Obras Públicas NO tocan los reportes ni los pagos del módulo de inspectores — son datos aparte (tablas op_*). Solo la ubicación se sincroniza con el mapa/catálogo.' },
    ],
  },
  {
    icon: '🚿',
    title: 'Lavado de maquinaria',
    blocks: [
      { t: 'p', text: 'Módulo AISLADO para el personal de LAVADO: registra qué máquinas se lavan y lleva la cuenta de cuántas veces al mes se lavó cada una. No toca inspecciones ni ningún otro módulo — solo usa el catálogo de máquinas.' },
      { t: 'p', text: 'Acceso: se le da al usuario el rol "Lavado de maquinaria" (o el permiso del módulo en Usuarios). El lavador escanea el QR de inicio, se loguea con su usuario y cae DIRECTO en su vista de lavado en el teléfono.' },
      { t: 'p', text: 'Vista del lavador (teléfono): un tablero por estado — 🚿 Por lavar / ✅ Lavadas — con un selector de periodo arriba (Hoy · Semana · Mes; por defecto Hoy). "Por lavar" son las máquinas activas que todavía NO se han lavado en ese periodo; al registrar el lavado pasan a "Lavadas".' },
      { t: 'p', text: 'Registrar un lavado: se puede de DOS formas — (1) buscando la máquina en la lista y tocándola, o (2) con el botón "📷 Escanear QR de máquina" (el mismo QR que ya trae cada máquina). Se abre la ventana "Registrar lavado": eliges el TIPO de lavado (Exterior / Motor / Completo, y puedes AGREGAR tipos nuevos con "+ Agregar"), escribes una observación (opcional) y adjuntas una foto (opcional). Al tocar "✅ Marcar como lavada" queda registrado con la hora y tu nombre.' },
      { t: 'p', text: 'Panel de PC (Más → 🚿 Lavado de maquinaria) — "Máquinas lavadas": muestra, por MES (con flechas ◀ ▶ para cambiar de mes), cuántas veces se lavó cada máquina, más dos totales arriba (lavados del mes · máquinas lavadas). Al tocar una máquina se abre el DETALLE con cada lavado de ese mes: fecha, tipo, quién lo hizo, observación y foto.' },
      { t: 'note', text: 'Los datos de lavado viven en tablas aparte (lm_*) y no afectan horas, pagos ni reportes de ningún otro módulo. La foto de cada lavado se guarda como evidencia.' },
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
      { t: 'note', text: '🚫 Días futuros bloqueados: solo se pueden cargar horas a días PASADOS o al DÍA EN CURSO. Los días que todavía no han transcurrido salen marcados "🚫 Día futuro — no se pueden cargar horas" con los botones y campos deshabilitados (un día que no ha pasado no puede tener horas trabajadas).' },
      { t: 'note', text: '⚠️ Marcar equipo averiado (rápido, desde el control): arriba toca ⚠️ Marcar equipo averiado, elige de la lista desplegable la 🏢 empresa y luego el 🚜 equipo (se muestra con su serial / placa; puedes buscarlo). Escribe el motivo (opcional) y confirma. El equipo queda No operativa, sale del control y pasa a "En reparación" en Servicio de Maquinaria, donde se registra su retorno operativo cuando quede lista.' },
      { t: 'note', text: '🟢 Inspector SOS LA GUAIRA — máquinas siempre trabajando: las máquinas asignadas al inspector SOS LA GUAIRA nunca se muestran como parada ni averiada; siempre cuentan como trabajando y sus horas paradas se cuentan como trabajadas (en el catálogo, el panel de Inspecciones, el teléfono y todos los reportes). Si se les reporta una avería, el ticket sí queda en Servicio de Maquinaria para el mecánico, pero no cambia su estado de trabajando.' },
      { t: 'p', text: 'Sección "🕓 En espera" (recibir máquinas): arriba salen las máquinas que aún no se han recibido. Para recibir una, elige su fecha de entrada y toca 📥 Recibir. Cada máquina puede tener su propia fecha.' },
      { t: 'p', text: 'Flete / viaje: dentro de cada máquina toca ➕ Flete / viaje para confirmar los viajes que hizo. Escribe la fecha, el nº de viajes y el precio por viaje; el sistema calcula el total. Ese monto se suma al TOTAL POR PAGAR de la empresa en la semana de esa fecha (aparece en el reporte). Puedes registrar varios y borrar los que no van con 🗑.' },
      { t: 'note', text: '📊 Total del rango (empresa): justo debajo del botón "🚚 Flete general de <empresa>" sale el TOTAL DE HORAS y el TOTAL EN $ de TODA la empresa en el rango de fechas seleccionado (suma de sus máquinas).' },
      { t: 'note', text: '📊 Total del rango por máquina: debajo del botón de flete de cada máquina (y en su resumen compacto cuando la tarjeta está cerrada) sale su TOTAL DE HORAS y su TOTAL EN $ del rango (horas × precio/hora). Si la máquina no tiene precio, dice "sin precio".' },
      { t: 'note', text: 'Flete GENERAL (sin máquina): en la cabecera de cada empresa (al abrir su grupo) toca 🚚 "Flete general de <empresa>" para cargar viajes que NO son de una máquina específica. Se registra igual (fecha, nº de viajes, precio) y se suma al TOTAL POR PAGAR de la empresa. Úsalo cuando el flete es de la empresa en general; usa el ➕ Flete / viaje de la máquina cuando es de un equipo puntual.' },
      { t: 'p', text: 'Cerrar el control: cuando termines, toca 🔒 Cerrar control. Se guarda todo en el Histórico y se congela el precio. Lo cerrado no se borra.' },
      { t: 'note', text: 'Rol ANALISTA: solo puede INGRESAR horas nuevas (día/noche, parada y extra), NO modificar las ya cargadas. Cuando un valor ya está cargado le sale un 🔒 y no lo puede cambiar; si hay que corregirlo, lo hace un administrador. Tampoco puede cambiar precios.' },
      { t: 'note', text: 'Lo cerrado SIGUE viéndose en el Control al navegar por semanas (marcado con 🔒 cerrado) y se puede seguir editando (por ejemplo, agregar días que faltaron). Ya no desaparece de la pantalla al cerrar.' },
      { t: 'note', text: 'Si editas una jornada que ya está CERRADA (🔒) desde el Control, el cambio se SINCRONIZA solo con el histórico: el reporte cerrado y el Histórico se actualizan en el acto (sin tener que reabrir el cierre). Si dejas la jornada en 0, esa fila sale del cierre.' },
      { t: 'note', text: 'El Informe por jornada (Reportes) es EN VIVO: mientras lo tienes abierto, si alguien agrega o edita una jornada (o un flete), el informe se actualiza solo con los mismos filtros —sin tener que volver a generarlo—. Lo indica un punto verde "En vivo".' },
      { t: 'note', text: 'Switch 📋 Completo / 🕒 Solo horas (Informe por jornada): antes de generar, y también en la vista previa junto a "Descargar PDF", puedes elegir el CONTENIDO del PDF. "Completo" es el reporte de siempre (con precio/hora, totales $, abonos, saldos y fletes). "Solo horas" imprime TODOS los datos (empresas, máquinas, días, horas día/noche/total, averías/paradas/espera con su motivo) PERO sin ningún precio ni monto — ideal para entregar horas sin mostrar dinero. El archivo sale marcado "- solo horas".' },
      { t: 'note', text: 'Resumen del corte ARRIBA del Informe por jornada: en la parte superior del PDF salen cuatro recuadros con el TOTAL DE HORAS por corte, el TOTAL $, el TOTAL ABONADO (lo ya pagado en el rango) y el TOTAL PENDIENTE (total $ − abonado). Así ves de un vistazo cuánto se debe. El detalle por empresa/máquina y el total general siguen igual, abajo.' },
      { t: 'note', text: '🧑‍🔧 SACAR LOS REPORTES POR ENCARGADO (21/08/2026). Tres reportes que salían solo por empresa ahora se pueden partir por RESPONSABLE de la máquina. (1) INFORME POR JORNADA: en Reportes, con la pestaña "🛠️ Jornada" elegida, sale un selector "Agrupar por · 🏢 Empresa / 🧑‍🔧 Encargado" arriba de la lista de empresas. (2) y (3) REPORTE DEL DÍA y HORAS DE HORÓMETRO: el mismo selector está dentro del modal de empresas, en Inspecciones. Por defecto siguen saliendo por empresa, igual que siempre.' },
      { t: 'note', text: '⚠️ AGRUPAR NO ES FILTRAR, y conviene tenerlo claro. FILTRAR (los checks de empresa o de encargado) deja máquinas FUERA del reporte. AGRUPAR no saca ninguna: las mismas máquinas, partidas distinto. Se combinan: puedes filtrar 2 empresas y agrupar por encargado. Y en el Informe por jornada, LA PLATA SIGUE SALIENDO POR EMPRESA — fletes, abonos, "TOTAL POR PAGAR", "SALDO POR PAGAR" y la tabla "Totales por empresa" no cambian, porque un flete se le cobra a la empresa y no a la persona que cuida la máquina. Un mismo encargado puede tener máquinas de dos empresas distintas.' },
      { t: 'note', text: '👤 CÓMO SE JUNTAN LOS NOMBRES DEL ENCARGADO. El campo se escribe a mano en el Catálogo, así que "juan perez", "Juan Pérez" y "JUAN PEREZ " son la misma persona y salen en UN solo grupo: no importan mayúsculas, tildes ni espacios de más (la Ñ sí se respeta: PEÑA y PENA son apellidos distintos). El título del grupo es la grafía MÁS USADA. Lo que NO se puede adivinar son las abreviaturas: "C. NUÑEZ" y "CARLOS NUÑEZ" salen como DOS encargados, y eso se arregla escribiéndolo igual en el Catálogo. Las máquinas sin encargado van todas juntas al final, en "SIN ENCARGADO".' },
      { t: 'note', text: '🐞 ARREGLADO 21/08/2026 junto con lo anterior: el Check de máquinas juntaba los encargados IGNORANDO las tildes de forma distinta a como lo hacían Control de Maquinaria, Inspecciones y el reporte de inspectores. O sea que "JOSÉ PÉREZ" salía como DOS personas en una pantalla y como UNA en las otras, y dos reportes del mismo día no cuadraban. Ahora los cuatro cuentan igual.' },
      { t: 'note', text: '🔴 AVERIADAS · 🟡 PARADAS · ⏳ ESPERANDO INSTRUCCIONES (Informe por jornada, desde el 19/08/2026): debajo de las máquinas que trabajaron, cada empresa trae hasta TRES renglones separados con las que NO trabajaron, en 0 horas y sin sumar a horas ni a $. Antes salían todas englobadas en un solo renglón rojo "PARADAS/AVERIADAS" y no había bloque de espera. Ahora: 🔴 AVERIADAS = tiene una avería REAL pendiente (el repuesto o la falla que reportó el mecánico); 🟡 PARADAS = está parada SIN avería (el marcador "MÁQUINA PARADA" del teléfono, por ejemplo sin operador o sin gasoil); ⏳ ESPERANDO INSTRUCCIONES = las que están en espera en el catálogo. El encabezado de la empresa muestra los tres números por separado.' },
      { t: 'note', text: '☀️ DÍA y 🌙 NOCHE de las averiadas/paradas: en esos renglones las columnas de horas se usan para decir QUÉ PASÓ EN CADA TURNO: sale 🔴 AVERÍA o 🟡 PARADA con su motivo en la columna del turno donde se marcó (día 7am–7pm, noche el resto), y "—" en el turno que quedó limpio. Así se ve de una si la máquina se averió de día y se paró de noche, o si fue en los dos turnos. Si una máquina tiene los dos renglones a la vez (parada y avería), MANDA la avería y sale una sola vez — nunca aparece en dos bloques. Las máquinas del inspector SOS LA GUAIRA siguen sin salir como averiadas ni paradas, y las que trabajaron van donde trabajaron aunque estén en espera.' },
      { t: 'note', text: 'Si necesitas corregir un cierre ya guardado: abre el 🗂️ Histórico, entra al cierre y toca "♻️ Reabrir cierre". Sus registros vuelven al control activo (semana de ese cierre) para editarlos y el cierre sale del histórico. Cuando termines de corregir, vuelve a cerrar el control (se congela el precio de nuevo).' },
      { t: 'note', text: 'Al cerrar un corte, el sistema CONGELA el precio de cada máquina de ese corte. Si ya fijaste un precio por RANGO de fechas para ese corte, el cierre lo respeta (no lo pisa); a las jornadas sin precio propio les pone el precio actual de la máquina. Así, aunque después cambie el precio, el corte cerrado sigue mostrando su total original (en el reporte y en el Histórico).' },
      { t: 'note', text: 'Para ver un reporte: toca 📊 Ver reporte, elige el rango de fechas y la empresa. Se abre una ventana con la vista previa del documento y dos botones: 🖨️ Imprimir y Cancelar. Toca Imprimir para mandarlo a la impresora o guardarlo como PDF.' },
      { t: 'note', text: 'El PDF de una empresa se guarda con su nombre y el rango, por ejemplo "Reporte Ferreconstrucciones del 06 al 12". Si al guardar/imprimir el encabezado azul se ve gris, activa la opción "Gráficos de fondo" (Background graphics) en el diálogo de impresión.' },
      { t: 'note', text: 'Reporte 🚜 Maquinaria (desde el 17/08/2026 es SOLO maquinaria, ya no incluye vehículos): vive en Reportes, con los mismos filtros de rango de fechas y empresas. Lista las máquinas que TRABAJARON en el rango de fechas, cada una con su ficha de catálogo: Máquina, Marca, Modelo, Placa, Serial y Clasificación. Cada fila tiene botón "Ver detalle" para su historial completo. Salida en PDF. Ver la sección "Reportes" más abajo.' },
      { t: 'note', text: '🔎 Buscar por tipo de equipo (en 📊 Conteo de equipos): dentro de la vista previa del reporte "Conteo de equipos" hay un buscador CON CASILLAS. Puedes acotar el alcance con los botones Todas / 🟢 Solo activas / 🔴 Solo inactivas. Escribe el tipo (por ejemplo "volqueta toronto") para filtrar la lista y TILDA uno o varios tipos; abajo aparece un NÚMERO grande con el TOTAL y un LISTADO agrupado por empresa (nombre de la máquina, serial/placa y encargado). Botón "⬇️ PDF de este conteo" para imprimir ese listado por empresa (respeta el alcance activas/inactivas).' },
      { t: 'note', text: 'Conteo de equipos: en Reportes, la pestaña 📊 Conteo equipos. Cuenta TODAS las máquinas activas (el total es como siempre) por clasificación y por tipo. Aparte, INDICA las zonas: en el reporte TODOS los equipos quedan ubicados en solo dos grupos, "Este" y "Oeste". Los que marcan GPS toman su lado real; los que AÚN no marcan GPS se reparten 50/50 entre Este y Oeste (solo en el reporte, SIN tocar el mapa). Al tocar Este u Oeste, las tablas se recalculan con ese lado. "A disposición de" indica cuántas están a disposición de Gobernación/FANB/CVM… (cuenta todas, con o sin ubicación) y en qué sector (Este/Oeste) las ubicadas. "Por tipo y zona" muestra, para cada tipo, cuántas hay en cada zona (Este/Oeste). El botón "🗺️ Ver en mapa" abre el mapa de calles con las zonas y los puntos: OJO, el mapa solo muestra los ubicados por GPS de verdad (el reparto 50/50 es solo del reporte, no del mapa). Las tarjetas de arriba muestran el estado de la flota. Se actualiza solo al cambiar una máquina y se descarga en PDF. La "A disposición de" se asigna en el catálogo de Equipos.' },
      { t: 'note', text: '📍 Ubicaciones tácticas (botón en 📊 Conteo de equipos): genera el "Reporte Diario de Operaciones y Maquinaria – Operación Rescate y Esperanza, La Guaira" en PDF. Cuenta el MISMO universo que el Catálogo (TODAS las máquinas menos las RETIRADAS). El reporte va 100% POR EMPRESA: arriba la cantidad de maquinaria por empresa y luego el listado de máquinas agrupado por EMPRESA en dos grupos: LICCIONE (sus máquinas) y GOLDEN TOUCH (las de Golden + TODAS las demás empresas), cada una con su ubicación real (referencia + sector Este/Oeste y subzona por GPS: Macuto, Caraballeda, Aeropuerto…) y estado (Operativo / Inoperativo / En espera). Las máquinas sin ubicación cargada salen como "Desplegadas por todo el territorio de La Guaira". Cierra con un conteo por clasificación. (Ya NO trae los resúmenes por zona Este/Oeste.)' },
      { t: 'note', text: '👷 Ubicaciones tácticas CON PERSONAL: al lado del botón hay un SWITCH "Solo ubicaciones / Con personal". Actívalo antes de descargar y el reporte reparte la nómina en los equipos de SOS La Guaira (NO en los de CVM / Gobernación / FANB): a cada máquina le asigna 2 OPERADORES (uno de turno DÍA y uno de turno NOCHE), en rotación por la lista de operadores; agrega una sección con TODO el personal por departamento (solo totales); y otra con los COORDINADORES e INSPECTORES repartidos por zona (ESTE / OESTE). Los cargos se toman del campo "cargo" del empleado.' },
      { t: 'note', text: '🔍 Inspección de equipos (Reportes → pestaña 🔍 Inspección equipos): reporte DIARIO. Eliges el DÍA y sale un PDF agrupado por INSPECTOR (el del último check-in de cada máquina), con Máquina · Serial/Placa · Sector · Edificio · Día · Noche · Nº Horas (las horas salen de Control de maquinaria de ese día). Las máquinas SIN inspector asignado se agrupan como "⚠️ FALTA INSPECTOR" y muestran su ENCARGADO del catálogo. NO incluye equipos de CVM / Gobernación / FANB. Se regenera cada vez, así que refleja las ubicaciones e inspectores al día.' },
      { t: 'note', text: '👥 Personal por departamento (botón en 📊 Conteo de equipos): genera el "Reporte de Personal" con TODA la nómina activa (del administrativo a los ayudantes de cocina). Arriba lleva un mensaje de agradecimiento y el TOTAL de personal; luego la cantidad por DEPARTAMENTO y por CARGO; y al final el listado por departamento con nombre, cargo y cédula. Los departamentos salen UNIFICADOS (p. ej. "administrativo"/"adminitrativo" y "operaciones de máquinas"/"…maquinarias" cuentan como uno solo) y a quien no tenga departamento se le asigna el que corresponde según su cargo (un encargado de cocina sin departamento → COCINA). Para que la nómina en la base quede igual, corre supabase/nomina_departamentos.sql.' },
    ],
  },
  {
    icon: '💰',
    title: 'Control de pagos',
    blocks: [
      { t: 'p', text: 'Aquí se ve cuánto hay que pagar por las horas trabajadas, según los precios. El corte es semanal.' },
      { t: 'note', text: 'La vista arranca VACÍA: escribe el nombre de la empresa en el buscador para ver su cuenta (no se listan todas de golpe).' },
      { t: 'note', text: 'El facturado cuadra con el Informe por jornada: Control de Pagos usa el MISMO precio del reporte (el del rango/actual, no el precio congelado "del cierre") y no cobra rondas ni fletes anteriores al inicio del período. Así el saldo = Facturado − Abonado da igual que el reporte real.' },
      { t: 'note', text: 'Cotejo automático: cada empresa muestra "📊 Reporte de jornada $X" con ✓ cuadra (verde) o ⚠️ difiere (naranja con la diferencia). El monto del reporte se recalcula solo (mismo cálculo del Informe por jornada) para verificar que Control de Pagos coincide. Si algún día sale ⚠️, es que una máquina tuvo precios distintos en la misma semana o quedó un precio "del cierre" viejo.' },
      { t: 'note', text: 'Ver por qué da ese saldo: al abrir una empresa aparece "🔍 Abonos contados" con TODOS los abonos que se le cuentan (fecha, monto, método, semana) y la cuenta explícita Facturado − Abonado = Saldo. Ahí puedes borrar un abono duplicado o mal cargado con 🗑️.' },
      { t: 'bullets', items: [
        'El Tabulador de precios es la lista maestra de precios por tipo de máquina. Se puede modificar y sincronizar.',
        'Tiene dos modos: General (aplica a todas las empresas) y por empresa. Arriba eliges "💲 General" o la empresa. Si a una empresa le pones un precio propio, ese manda; si lo dejas vacío, usa el General.',
        'Al sincronizar, cada máquina toma el precio de SU empresa (o el General si no tiene propio).',
      ] },
      { t: 'note', text: 'PRECIO POR RANGO DE FECHAS: en el Control toca el nombre de una máquina para abrir su precio. Ahí eliges el RANGO de fechas (desde/hasta; por defecto el corte que estás viendo) y ese precio queda fijo SOLO en ese rango. Cambiar el precio de un rango NO afecta los reportes de otros cortes. Ejemplo: un camión puede valer 500 del 6 al 12 y 750 del 26 al 05, y cada corte muestra su propio número.' },
      { t: 'note', text: 'Switch 🔒 "Blindar precio a estas fechas" (viene activado): CLAVA el precio en esas fechas. Si el precio SUBE en otra semana, esta NO cambia; y si lo modificas, SOLO afecta esa semana. Todos los reportes (Informe por jornada, Maquinaria/Vehículo y Control de Pagos) usan ese mismo precio blindado. Si lo apagas, solo cambias el precio por defecto de la máquina (para fechas que aún no tienen precio fijo).' },
      { t: 'note', text: 'Si NO cambias el precio, se mantiene el de la semana anterior (arrastre automático): una jornada sin precio propio hereda el último precio que pusiste en una fecha anterior de esa misma máquina. Solo tienes que tocar el precio cuando CAMBIA.' },
      { t: 'note', text: 'Para corregir un corte que salió con precio equivocado: ve a esa semana en el Control, toca la máquina, pon el precio correcto con el rango de esas fechas y Guarda. El reporte de ese corte se actualiza al instante y los demás cortes no se tocan. Funciona esté el corte abierto o cerrado.' },
      { t: 'note', text: 'Sobrepago que se abona a la siguiente: si una empresa debe 50.000 y pagas 100.000, el sistema cubre esa semana y ABONA el resto a las siguientes semanas pendientes de la misma empresa (la más vieja primero). Si aún sobra, queda como saldo a favor. Al registrar el pago te muestra un resumen de cómo se repartió.' },
      { t: 'note', text: 'Los FLETES cuentan: el total a cobrar de cada empresa/semana ahora INCLUYE los fletes/viajes registrados en el Control para esa semana (no solo las horas de máquina).' },
      { t: 'note', text: 'Método de pago del abono: al "＋ Registrar abono" eliges cómo se pagó — 💵 Efectivo ($) · ₮ USDT · 🇻🇪 Bs (al cambio). Si es en Bs, escribes el MONTO EN Bs y la TASA del día (Bs por $) y el sistema calcula el equivalente en $ (el saldo siempre se lleva en $). Cada abono muestra su método y, si fue en Bs, el monto en Bs y la tasa usada.' },
      { t: 'note', text: 'Excedente que pasa a la otra semana (cascada): si pagas MÁS de lo que debe una semana (ej. debe $10 y pagas $15), el sobrante ($5) se aplica solo a las otras semanas con deuda de la misma empresa (de la más antigua a la más nueva). Si no queda ninguna semana pendiente, el sobrante se guarda como 💚 saldo a favor (prepago). Al final te dice cómo se distribuyó el pago.' },
      { t: 'note', text: 'Revertir pagos (corregir errores): en 🗂️ Histórico puedes filtrar por empresa y usar "🗑️ Revertir TODOS los abonos de <empresa>" (te muestra cuántos y el total, y pide confirmar) para borrarlos todos de una. El saldo de cada semana vuelve a incluir esos montos. También puedes borrar un abono suelto desde el detalle de la semana.' },
      { t: 'note', text: '📄 Reportes (botón 📄 arriba): elige una o varias empresas (o todas) y un rango de fechas, y saca dos PDFs. "⬇️ Reporte detallado" trae el desglose por semana con máquinas, horas y abonos. "🧾 Estado de cuenta" es un reporte enfocado en la cuenta: por cada empresa, sus SEMANAS FACTURADAS (facturado / abonado / saldo / estado) y aparte TODOS los pagos realizados con su FECHA DE REGISTRO (monto, método, semana que cubre), más el SALDO PENDIENTE de la empresa y los totales al final.' },
    ],
  },
  {
    icon: '🧑‍💼',
    title: 'Empleados — filtrar por cargo y reporte',
    blocks: [
      { t: 'p', text: 'En Empleados puedes filtrar la lista por tipo de cargo y sacar un reporte de lo que elijas.' },
      { t: 'steps', items: [
        'En el recuadro 🏷️ Cargo, toca para desplegar los cargos (cada uno con su cantidad).',
        'Marca uno o varios cargos (ej. OPERADOR, OBRERO…). Se pueden combinar; "Todos" limpia la selección.',
        'La lista de abajo muestra solo esos cargos (se combina también con el Estado y la búsqueda).',
        'Toca "📊 Reporte": genera un PDF con el LISTADO de las personas seleccionadas (nombre, cédula, ficha, cargo, empresa, estado, teléfono) y un RESUMEN por cargo con el total.',
      ] },
      { t: 'note', text: 'El reporte respeta todo lo que estás viendo (estado + empresa + cargos marcados + búsqueda): imprime exactamente esa selección.' },
      { t: 'note', text: '🏢 FILTRAR POR EMPRESA (20/08/2026). Debajo de los chips de Estado hay una línea "Empresa: 🏢 Todas · N". Tócala y se despliega la lista de empresas con su cantidad de personas y un buscador; marca una o varias. El personal SIN contratista asignado aparece como SOS LA GUAIRA (el empleador) y va siempre de primero. La ✕ de al lado limpia la selección de un toque. Se combina con Estado, Cargo y la búsqueda, y los conteos por cargo se recalculan según la empresa elegida.' },
      { t: 'note', text: '🏢 EMPRESA FILTRO NÓMINA — lista propia, aparte de todo (21/08/2026). Ese filtro YA NO usa el catálogo general de empresas: usa una lista que SOLO existe en Nómina. En la ficha del empleado hay un campo "🏢 Empresa filtro nómina" donde puedes ESCRIBIR UN NOMBRE NUEVO y se crea al vuelo, sin salir del formulario. Esa empresa NO aparece en ningún otro lado: ni en Catálogo, ni en Maquinaria, ni en Reportes, ni en Compras, ni en Inventario, ni en Acarreo, ni en Comidas. Es REFERENCIAL: agrupa y filtra gente en Empleados y sale en la columna del reporte, y nada más. Antes, crear una empresa desde aquí la metía en todos esos selectores.' },
      { t: 'note', text: '⚠️ El empleado queda con DOS empresas y conviene saberlo. (1) "Empresa": la de siempre, del catálogo general; NO se tocó y sigue mandando en los períodos de nómina, la pantalla de Comidas, el carnet y la constancia. (2) "Empresa filtro nómina": la nueva; manda en los chips de filtro, en la tarjeta de cada empleado (renglón 🏢) y en la columna del reporte de Empleados. Al correr supabase/nomina_empresa_filtro.sql la lista nueva ARRANCA COPIADA de la que ya tenías, así que el filtro se ve igual que siempre desde el primer día; de ahí en adelante las dos viven separadas y renombrar o crear en Nómina no toca el catálogo general. A quien no se le ponga la empresa de filtro sale agrupado bajo "Sin empresa de filtro".' },
      { t: 'note', text: '📍 DÓNDE ESTÁ EL FILTRO, y por qué no lo encuentras en "Nómina". Vive en Nómina → 🪪 EMPLEADOS, NO en la pantalla de nómina/períodos. Es la línea "Empresa nómina: 🏢 Todas · N" que está debajo de los chips de Estado: TÓCALA y se despliega la lista con buscador. Los períodos de nómina siguen armándose con la empresa DE SIEMPRE (company_id) y eso es a propósito: la empresa de filtro es referencial y no debía afectar el pago.' },
      { t: 'note', text: '➕ CÓMO CREAR UNA EMPRESA DE NÓMINA: ✎ Editar cualquier empleado → campo "🏢 Empresa filtro nómina" → escribe el nombre → toca "➕ Agregar". Queda disponible en el filtro de una vez, sin recargar. Las empresas que salen con "· 0" ya existen pero todavía no tienen a nadie asignado — eso es normal recién creada.' },
      { t: 'note', text: '🐞 ARREGLADO 21/08/2026: al crear una empresa nueva el chip salía rotulado "Empresa" en vez del nombre escrito, y solo se corregía recargando la app entera. La pantalla releía los empleados pero NO la lista de empresas de nómina. Ahora relee las dos. Además la empresa se ve en la tarjeta de cada empleado (antes solo se veía abriendo el filtro o sacando el PDF, así que asignarla se sentía como que no había pasado nada) y las empresas sin gente asignada ya aparecen en el filtro con "· 0" (antes no aparecían por ningún lado y parecía que no se habían creado).' },
      { t: 'note', text: 'Estado del empleado "Otro": además de Activo / Inactivo / Suspendido, un empleado puede quedar en estado "Otro". Los que están en "Otro" NO entran al control de pago: no se precargan al crear una nómina/período y no aparecen en Pago a personal → Por persona (ni en "Todos"). Úsalo para gente que no debe pagarse por este sistema.' },
      { t: 'note', text: '🏦 LOS EXCEL DE PAGO A PERSONAL TRAEN LOS DATOS PARA TRANSFERIR (19/08/2026). Antes solo salía el Nº de cuenta; ahora sale también el TITULAR DE LA CUENTA y su C.I. DEL TITULAR, que es lo que el banco exige para procesar la transferencia. Importa porque la cuenta puede ser de OTRA persona (la de un familiar): si el nombre y la cédula no son los del dueño de la cuenta, el banco rechaza el pago. Si la ficha del empleado no declara titular, se asume que el titular es el propio trabajador y se ponen su nombre y su cédula — misma regla que ya usaba el recibo en PDF, así que los dos documentos dicen lo mismo. Para que salga un titular distinto, llénalo en Empleados → ✏️ Editar → 🏦 Datos bancarios. Aplica a los tres Excel: el del período (📥 Excel), el de personas seleccionadas y el histórico de una persona (ahí va en la línea de arriba, y solo se nombra al titular cuando NO es el propio trabajador).' },
      { t: 'note', text: '🧑‍🦰 DESINCORPORADOS: MOVER A ALGUIEN DE UN PERÍODO A OTRO (20/08/2026). Tres cosas que antes no dejaban hacerlo, ya corregidas. (1) 👤 AGREGAR PERSONA, botón nuevo junto a "＋ Personal faltante": busca por nombre, cédula o cargo en TODO el registro, incluidos los desincorporados (salen con su etiqueta roja), y agrega SOLO al que elijas. Antes la única forma de sumar gente era "＋ Personal faltante", que trae únicamente empleados ACTIVOS: a un desincorporado no había manera de meterlo, ni siquiera para moverlo de un período a otro cuando se le queda un pago pendiente al salir. Al agregarlo se le calculan sus jornadas del rango, porque pudo haber trabajado parte del período antes de irse. (2) 🗑️ QUITAR DEL PERÍODO ahora sale en CUALQUIER persona con el período en borrador; antes estaba amarrado a una marca interna que NO significa "lo agregaron a mano" sino "no tiene jornadas en el rango", así que justamente a quien SÍ trabajó no había forma de sacarlo. (3) EL FILTRO "Inactivos/Desincorporados" ya no mezcla: antes una persona sin ficha resuelta (cargada suelta, o cuyo empleado se borró del registro) aparecía A LA VEZ en "Activos" y en "Inactivos/Desincorporados", y por eso el filtro no los reconocía. Ahora sin ficha NO es desincorporado: si está cobrando cuenta como activo, y desincorporado es solo quien está inactivo o suspendido. Los de estado "Otro" no salen en ninguno de los dos, solo en "Todos".' },
      { t: 'note', text: '🔎 VER A LOS QUE NO ESTÁN EN EL PERÍODO (21-ago-2026): antes, filtrar por "Inactivos/Desincorporados" en un período donde nadie lo está daba "Sin resultados" y ahí se acababa — no había forma de llegar desde ahí a la gente que NO está en ese período, que es justo a quien se busca cuando a alguien se le quedó un pago pendiente al salir. Ahora ese mensaje trae un botón: "👤 Buscar entre inactivos y desincorporados", que abre el buscador de personas YA FILTRADO a ese estado. Dentro del buscador hay pastillas Todos / Activos / Inactivos-Desincorporados por si quieres cambiar el filtro sin salir. Los criterios son los mismos de la lista del período (desincorporado = inactivo o suspendido), así que lo que ves en un lado cuadra con el otro.' },
      { t: 'note', text: '🔒 UN PERÍODO APROBADO O PAGADO NO SE PUEDE CAMBIAR (19/08/2026). Cuando el período ya no está en BORRADOR no se pueden agregar ni quitar personas, ni editar montos: queda congelado a propósito porque es el respaldo de lo que ya se pagó. Antes los botones simplemente NO aparecían y no se decía por qué — parecía que estaban rotos. Ahora sale el aviso "🔒 Período APROBADO/PAGADO: no se puede cambiar", que te dice qué hacer: tocar ↩ Reabrir, que lo devuelve a borrador y habilita todo otra vez. OJO: "✕ Desmarcar todos" (antes se llamaba "✕ Quitar selección", por eso confundía) NO saca a nadie del período: solo limpia las casillas ✓ que sirven para exportar a Excel o PDF solo a los marcados. Para sacar de verdad a una persona: ✎ Editar en su tarjeta → 🗑️ Quitar del período, con el período en borrador.' },
      { t: 'note', text: 'Ficha del trabajador (toca 🪪 Ficha en un empleado, o escanea su carnet): abajo hay dos botones. 📄 Ficha completa (PDF) descarga TODOS los datos por secciones (identificación, datos laborales, contacto, emergencia, banco y tallas). 🖼️ Carnet (imagen) descarga el carnet 54×86 mm. Lo mismo aplica a los Aliados (su PDF es la ficha completa; la imagen es el carnet).' },
      { t: 'note', text: 'Constancias por empleado: en cada persona hay dos botones. 📄 Const. carnet es la constancia de entrega de carnet (trabajo a destajo, la firma el colaborador). 📃 Constancia de trabajo es el formato estándar "A quien pueda interesar": hace constar que la persona presta servicios en SOS La Guaira, con su cédula, cargo y fecha de ingreso; al pie lleva una firma centrada para la Jefa de Administración. Se genera en PDF listo para imprimir/guardar.' },
      { t: 'note', text: '🔎 EL BUSCADOR DE EMPLEADOS AHORA BUSCA POR TODA LA FICHA (21/08/2026). Antes solo miraba nombre, cédula, ficha, cargo y empresa; si buscabas por TELÉFONO no encontraba a nadie y parecía que el buscador solo servía para empresas. Ahora busca además por DEPARTAMENTO, GRUPO/ZONA, TELÉFONO, CORREO, TITULAR de la cuenta y N.° DE CUENTA. Y lo más útil: LAS PALABRAS VAN EN CUALQUIER ORDEN. "PEREZ JUAN" encuentra a JUAN PEREZ (antes no), y puedes CRUZAR datos: "OBRERO 0207" busca al que sea obrero Y tenga la ficha 0207. Tienen que estar TODAS las palabras que escribas: si una no aparece en la ficha, esa persona no sale. No importan mayúsculas ni tildes ("josé" encuentra a JOSE), pero la Ñ sí se respeta: "PEÑA" no encuentra a "PENA", porque son apellidos distintos.' },
      { t: 'note', text: '🗑️ QUITAR UNA EMPRESA DE FILTRO NÓMINA (21/08/2026). Si creaste una empresa por error o con el nombre mal escrito, abre el filtro "Empresa nómina" y abajo, bajo el texto "Sin nadie asignado", salen en rojo las empresas que NO tienen a ninguna persona. Tócalas y se quitan del filtro. SOLO se ofrecen las que tienen CERO personas: para sacar una que sí tiene gente, primero cámbiale la empresa a esas personas en su ficha — si no, quedarían agrupadas bajo una empresa que ya no se puede elegir. La empresa NO se borra de la base de datos, se DESACTIVA: deja de aparecer en el filtro y ya no se puede elegir en fichas nuevas, pero si algún día tuvo gente, ese historial no se pierde. Por eso la tabla ni siquiera tiene permiso de borrado.' },
      { t: 'note', text: '⚠️ AMONESTACIÓN ESCRITA (21/08/2026). En cada persona hay un tercer botón, ⚠️ Amonestación, que saca el llamado de atención formal en PDF, con el mismo membrete de las constancias. Al tocarlo se abre un cuadro donde puedes poner: TIPO DE FALTA (inasistencia injustificada, retardo reiterado, lo que sea), FECHA Y HORA DEL HECHO, QUÉ PASÓ (el relato con detalle), GRADO (primera, segunda o tercera amonestación — o "No indicar" si no llevas esa escala) y TESTIGO. PUEDES DEJARLO TODO EN BLANCO: entonces sale como PLANILLA con renglones para llenarla a mano, que es como se usa cuando hay que amonestar a alguien en el sitio y no tienes computadora cerca. OJO CON LA FECHA DEL HECHO: no es la de hoy. Si no la pones, el papel deja una raya para escribirla — el sistema NO la rellena con la fecha de hoy, porque un dato inventado en un papel disciplinario es peor que no tener papel.' },
      { t: 'note', text: '⚠️ LO QUE TRAE SIEMPRE LA AMONESTACIÓN, Y POR QUÉ. (1) Un recuadro de DESCARGOS DEL TRABAJADOR, aunque nadie lo llene: una sanción sin espacio para que la persona dé su versión es mucho más fácil de tumbar, porque el derecho a ser oído es parte del debido proceso. (2) La casilla "SE NEGÓ A FIRMAR" junto a la raya del trabajador: es el caso que más problemas da en la práctica y así queda asentado en el mismo papel, con el testigo al lado. (3) TRES FIRMAS EN BLANCO — trabajador, quien la emite y testigo. NO lleva firma escaneada aunque el sistema tenga dos guardadas: una amonestación que sale ya firmada se puede emitir sin que el jefe se entere, y pierde fuerza justo cuando más falta hace. (4) NO cita artículos de ninguna ley: los pone la empresa, el sistema no se los inventa. La amonestación SOLO SE IMPRIME, igual que las constancias — no se guarda historial: el papel firmado va al expediente físico. Se expide en dos ejemplares: uno para el expediente y otro para el trabajador.' },
      { t: 'note', text: '💵 CONSTANCIA CON O SIN EL MONTO QUINCENAL (21-ago-2026): al tocar 📃 Constancia de trabajo se abre un cuadro con una casilla, "Incluir el monto quincenal". Arranca DESMARCADA, o sea que la constancia de siempre (sin sueldo) sigue saliendo igual. Se marca cuando el trámite lo pide (banco, crédito, alquiler) y el PDF agrega un renglón: "devenga una remuneración quincenal de $X". DE DÓNDE SALE EL MONTO, en este orden: 1) el quincenal de su ficha si está cargado; 2) si no, el semanal × 2; 3) si no, el mensual ÷ 2. Antes de generar, el cuadro te muestra el monto y te dice de cuál de los tres salió — pero el PDF solo dice "remuneración quincenal", sin explicar la conversión. Si la persona NO tiene ningún sueldo cargado, la casilla queda deshabilitada y te avisa: no se inventa una cifra. Ojo: "Salario base" NO cuenta para esto, porque esa casilla no dice si es semanal, quincenal o mensual y convertirla sería adivinar.' },
    ],
  },
  {
    icon: '🗂️',
    title: 'Organigrama (dentro de Nómina)',
    blocks: [
      { t: 'p', text: 'Muestra la estructura de la empresa POR CARGOS (no por nombres), con diseño corporativo en dos columnas: azul = Administración, servicios y soporte; naranja = Operaciones y mantenimiento de maquinaria. Arriba van Director General y Coordinador General. La estructura es FIJA y cubre todos los cargos. Está dentro de Nómina: abre 🗂️ Organigrama.' },
      { t: 'steps', items: [
        'Toca "👁️ Vista previa" para ver el organigrama con el logo de la empresa; desde ahí lo guardas o imprimes como PDF.',
        'Toca "🖼️ Descargar imagen (PNG)" para bajarlo como imagen.',
      ] },
      { t: 'p', text: '📋 Manual de cargos (en el mismo panel): descarga las FUNCIONES de cada cargo, de quién depende (reporta a) y qué personal tiene a su cargo (subordinados).' },
      { t: 'steps', items: [
        'Toca "PDF general — todos los cargos" para un solo documento con todos los cargos, agrupados por área.',
        'O toca un cargo de la lista para descargar solo SU ficha (funciones + jefe + subordinados).',
      ] },
    ],
  },
  {
    icon: '👕',
    title: 'Distribución de uniformes (dentro de Nómina)',
    blocks: [
      { t: 'p', text: 'Sirve para llevar las tallas de uniforme de cada empleado e imprimir el listado para la entrega. Está dentro de Nómina: abre 👕 Distribución de uniformes.' },
      { t: 'steps', items: [
        'Verás el listado de empleados agrupado por empresa (con "Activos" o "Todos", y un buscador por nombre, cédula o cargo).',
        'Toca un empleado: se abre para cargar su 👕 talla de camisa, 👖 talla de pantalón, 👟 talla de zapatos, 🦺 talla de braga y 🧥 talla de chaqueta. Guarda.',
        'Las tallas quedan en la ficha del empleado (se ven como etiquetas en cada tarjeta).',
        'En ese mismo empleado, sección 📦 Registrar entrega: escribe cuántas 👕 camisas, 👖 pantalones, 👟 zapatos, 🦺 bragas y 🧥 chaquetas le entregas AHORA y toca "📦 Registrar entrega". La fecha y la hora se guardan solas. Puedes registrar varias entregas: se acumulan y ves el total entregado y el historial (con fecha y hora de cada una).',
        'Cada tarjeta muestra un badge 📦 Entregado con el total de prendas que ha recibido esa persona.',
        'Toca "⬇️ Listado (tallas)": genera un PDF con todos los empleados mostrados, sus tallas y una columna de FIRMA (Recibido / Entregado) para firmar al recibir el uniforme.',
        'Toca "📦 Reporte de entregas": genera un PDF por persona con CADA entrega (su fecha y hora) y el total de camisas, pantalones, zapatos, bragas y chaquetas entregados.',
        'Al final del listado de tallas (en pantalla y en el PDF) sale un 📊 Resumen por tallas: cuántas camisas de cada talla (M, S, L…), y lo mismo para pantalones, botas de seguridad, bragas y chaquetas. Sirve para saber cuántas piezas de cada talla pedir.',
      ] },
      { t: 'note', text: 'Los PDF respetan el filtro y la búsqueda: incluyen exactamente los empleados que estás viendo. Las TALLAS son el número de talla de cada prenda; las ENTREGAS son cuántas piezas se le han dado (con su fecha y hora).' },
    ],
  },
  {
    icon: '🗓️',
    title: 'Distribución de días libres (dentro de Nómina)',
    blocks: [
      { t: 'p', text: 'Reparte la SEMANA LIBRE POR PERSONA: se navega por CARGO (para ordenarse), pero el descanso es de cada persona. Abres un cargo, ves su gente (del personal activo) y a cada persona le asignas su semana libre del ciclo. Cada persona puede descansar una semana distinta. Está dentro de Nómina: abre 🗓️ Distribución de días libres.' },
      { t: 'steps', items: [
        'Los CARGOS y su GENTE salen solos del personal ACTIVO de la nómina.',
        'Puedes FILTRAR: por DEPARTAMENTO (lista desplegable buscable en 🔎 Filtrar) o por CARGO (escribe en "Buscar cargo…"). Así trabajas un departamento a la vez y no todo junto. El PDF sale solo de lo filtrado. "Limpiar ✕" quita el filtro.',
        'Elige el "Ciclo" (Desde / Hasta) arriba: define cuántas semanas hay para repartir (cada 7 días = una semana).',
        'La vista es un CALENDARIO tipo matriz. Con el conmutador 📅 Semana / 📆 Día (arriba a la derecha) eliges si el descanso se marca por SEMANA completa o por DÍAS sueltos.',
        'POR SEMANA: columnas = las semanas del ciclo. Toca la celda de una persona en una semana para marcar su semana libre (se pinta de color); toca la marcada para quitarla.',
        'POR DÍA: columnas = cada día del ciclo. Toca un día para marcarlo libre (verde) y toca el día marcado para quitarlo. Los días que ya vienen de una semana asignada salen con el color de la semana y se editan en modo Semana.',
        'Abajo de cada columna, "Libres / semana" cuenta cuántas personas descansan esa semana — así ves de un vistazo si se juntan (choque).',
        'Toca "✨ Repartir automático" (arriba) para que dentro de cada cargo la gente quede en semanas distintas de una vez (sin juntar la misma semana). Luego ajustas cualquier celda a mano.',
        'Toca el NOMBRE de una persona (columna izquierda) para ver/borrar sus días libres o agregarle una fecha suelta ("otra fecha").',
        'Toca "📄 Generar PDF" para el calendario imprimible de días libres por persona (respeta el filtro).',
      ] },
      { t: 'note', text: 'La semana libre es POR PERSONA (cada quien la suya), no por todo el cargo. Se refresca en vivo entre dispositivos. Requiere correr supabase/dias_libres_cargo.sql (agrega la columna de persona).' },
    ],
  },
  {
    icon: '💵',
    title: 'Control de pago a personal (dentro de Nómina)',
    blocks: [
      { t: 'p', text: 'Sirve para pagarle al personal. Tiene dos vistas (cambias arriba): 👤 Por persona (la principal) y 📅 Por período. Está dentro de Nómina: abre 💵 Control de pago a personal.' },
      { t: 'note', text: '👤 POR PERSONA (vista principal): es un listado de empleados. Busca a alguien y ábrelo: verás sus datos personales, sus datos bancarios y sus tarifas. Con "➕ Generar pago" registras un pago por frecuencia — Diario, Semanal, Quincenal o Mensual. Indicas el PERÍODO que cubre con un rango Desde/Hasta (ej. del 11 al 17); el "Hasta" se sugiere solo según la frecuencia y lo puedes cambiar. En DIARIO puedes cargar jornadas de ☀️ día y 🌙 noche JUNTAS en el mismo pago (cada una con su cantidad y su precio); el monto se sugiere = (días × precio día) + (noches × precio noche) y es editable. Las jornadas (días + noches) NO pueden pasar de los días que abarca el rango Desde→Hasta (si el rango es de 7 días, el máximo es 7 jornadas en total). Esas cantidades de día/noche quedan GUARDADAS y se precargan en el próximo pago de esa persona. De cada pago sacas su 📄 Recibo. Abajo tienes el HISTORIAL con el total, lo puedes 🖨️ Imprimir (histórico por persona) y cada movimiento se puede ✏️ Editar o 🗑️ Borrar.' },
      { t: 'note', text: 'Las tarifas Quincena y Mes se definen (igual que día/noche/semana) en el 🏷️ Tabulador por cargo y se sincronizan a los empleados.' },
      { t: 'p', text: '📅 POR PERÍODO (nóminas, lo de antes):' },
      { t: 'note', text: 'El personal se paga SIEMPRE por la organización (SOS LA GUAIRA), no por contratista. Al crear un período NO se elige empresa: se carga a TODO el personal activo y todo queda bajo SOS LA GUAIRA. Así siempre hay a quién ponerle su precio.' },
      { t: 'note', text: 'TABULADOR POR CARGO (🏷️ Tabulador, arriba): en vez de poner el sueldo uno por uno, defines el sueldo POR CARGO. Es una lista desplegable: toca un cargo y se abre su detalle (sueldo semana, ☀️ precio día, 🌙 precio noche, precio hora) — es editable. Con "+ Cargo" añades cargos nuevos y también aparecen los cargos de empleados que aún no tienen tabulador (toca para crearlo). Al tocar "🔄 Sincronizar" el sueldo de ese cargo se copia a TODOS los empleados que tengan ese cargo. Con "🔄 Sincronizar TODO (por lote)" (botón de arriba) se aplica el tabulador a los empleados de TODOS los cargos de una sola vez. Después, al crear el período, cada quien ya trae su sueldo.' },
      { t: 'p', text: 'Cómo se calcula:' },
      { t: 'bullets', items: [
        'Cada trabajador tiene su Precio por hora, ☀️ Precio por día, 🌙 Precio por noche y Precio por semana (los cargas/editas en el renglón de la persona y quedan guardados en su ficha para el próximo período).',
        'Cada período elige "Pago por": Por hora, Por día o Por semana. El devengado = precio del modo × cantidad. En "Por día" el pago separa las jornadas de DÍA y de NOCHE: devengado = (jornadas ☀️ día × precio día) + (jornadas 🌙 noche × precio noche). El sistema cuenta solas las jornadas de día/noche del operador según el turno de cada una.',
        'Cualquier modo (incluido "Por día") precarga a TODO el personal activo. Los operadores traen sus jornadas de día/noche solas (por el QR); al resto se le ajusta la cantidad a mano.',
        'El Período (rango de fechas) puede ser Día, Semana (dom→sáb) o Quincena (1–15 / 16–fin de mes). Las fechas se ajustan solas y también se editan a mano.',
        'Total a pagar = devengado + bonos − deducciones.',
      ] },
      { t: 'p', text: 'De dónde salen las cantidades (horas / días / semanas):' },
      { t: 'bullets', items: [
        'Operadores: se cargan SOLOS desde sus jornadas (las que registran al escanear el QR), cruzando por cédula dentro del rango del período. Las semanas = cuántas semanas distintas trabajaron.',
        'Resto del personal: se ajusta a mano. También puedes editar lo automático; si cambias la cantidad, queda marcado como ajuste manual.',
        'Con "Solo jornadas validadas por el supervisor" activado (por defecto), una jornada solo cuenta si el supervisor visitó esa máquina ese día y la marcó 🟢 Trabajando. Las que no tienen visita quedan pendientes y NO suman (avisa con ⚠️).',
      ] },
      { t: 'bullets', items: [
        'Bonos y Deducciones: por persona, agregas líneas de concepto y monto (ej. Bono producción, Adelanto, Préstamo).',
        'Abonos: cuando el período está aprobado, con 💵 Abonar registras pagos parciales o totales (efectivo, pago móvil, transferencia…). Se ve el Pagado y el Saldo pendiente.',
        'Reportes: 🧾 Recibo por persona y ⬇️ Reporte del período completo, ambos en PDF. El recibo muestra el Total y el "Saldo cancelado".',
        '💼 Filtrar por cargo: dentro del período hay una lista desplegable con casillas ("💼 Filtrar por cargo"). Tildas uno o varios cargos y la lista de personas y el ⬇️ Reporte PDF salen solo de esos, agrupados por cargo con su subtotal. Sin tildar nada = todos.',
        '➕ Incluir a todos: si hay empleados activos que no están en el período (ej. registrados después de crearlo), sale un aviso con cuántos faltan; tócalo y se agregan todos (entran con 0 jornadas, luego ajustas). El nº del 🏷️ Tabulador cuenta empleados activos (mismo universo) para que coincida con el pago.',
      ] },
      { t: 'note', text: 'Estados del período: Borrador → ✅ Aprobar → 💵 Marcar pagada (y ↩ Reabrir). En el encabezado del período se muestra "Pagada $X" (lo ya abonado); el saldo queda pequeño y solo si falta por pagar. Si Aprobar/Marcar pagada no cambia el estado, ahora SÍ te avisa el motivo (antes fallaba en silencio).' },
      { t: 'note', text: 'Las analistas pueden cargar cantidades, bonos y deducciones, pero NO pueden cambiar los precios (hora/día/semana) del trabajador.' },
    ],
  },
  {
    icon: '🕒',
    title: 'Control de asistencia (dentro de Nómina)',
    blocks: [
      { t: 'p', text: 'Sirve para registrar la ENTRADA y la SALIDA del personal escaneando su carnet. Guarda la fecha y la hora automáticamente. Se abre desde el botón grande 🕒 ASISTENCIA EMPLEADOS que aparece en la pantalla de inicio de todos los usuarios (excepto el admin, que la tiene en el menú Más → 🕒 Control de asistencia).' },
      { t: 'steps', items: [
        'Toca "📷 Escanear carnet" y apunta al QR del carnet del trabajador (si el carnet no escanea, búscalo por nombre o cédula).',
        'Aparece la persona (foto, nombre, cargo) y sus marcas de hoy.',
        'Toca el botón grande: si aún no ha entrado dice "➡️ Marcar ENTRADA"; si ya entró dice "⬅️ Marcar SALIDA". La hora y la fecha se ponen solas.',
        'HORA MANUAL (si no dio tiempo de escanear): con la persona abierta, toca "⏱️ Marcar con hora manual", elige la fecha, escribe la hora real en formato 24 h (ej. 07:30 o 19:45), elige ENTRADA o SALIDA y toca "💾 Registrar marca manual". Sirve para cargar después la jornada con su hora verdadera.',
        'Cada marca queda etiquetada como ☀️ Día (6:00 a 17:59) o 🌙 Noche (resto), según la hora.',
        'Al registrar una SALIDA, el sistema PIDE CONFIRMACIÓN ("¿Seguro que quieres registrar la salida?") y te recuerda a qué hora fue su última entrada. Si la entrada fue hace MENOS DE 2 MINUTOS, avisa "¿Doble escaneo?" (casi seguro escanearon el carnet dos veces por error) para que no se marque una salida sin querer.',
        'Se permiten VARIAS marcas al día (por ejemplo, sale a almorzar y vuelve): el sistema alterna entrada/salida y suma las horas presentes de todos los pares.',
        'Abajo tienes un CALENDARIO DEL MES con toda la asistencia (no solo la de hoy): usa ◀ ▶ para cambiar de mes; los días con marcas se resaltan y muestran un globo con el número de personas.',
        'Toca un día: se abre en ☀️ Día y 🌙 Noche (con cuántas personas hay en cada turno). Toca un turno y ves el detalle por persona: entrada → salida y horas de cada par.',
        'Cada día tiene su propio "📊 Reporte del día" (PDF), además del reporte por rango.',
      ] },
      { t: 'p', text: 'Reporte: toca 📊 Reporte, elige el rango de fechas y genera el PDF (o usa 📊 Reporte del día dentro del calendario). Sale por persona: cada jornada con su fecha, ☀️/🌙 turno, hora de entrada y salida y las horas; con subtotales de día y de noche. Una entrada sin salida sale como "abierta". Las jornadas de noche que cruzan la medianoche se emparejan bien.' },
      { t: 'note', text: 'Las marcas se SINCRONIZAN en tiempo real: si otra persona marca desde otro dispositivo, el calendario se actualiza solo. Cualquier usuario del sistema puede marcar la asistencia con el botón 🕒 ASISTENCIA EMPLEADOS (así el portero/vigilante puede registrar al personal sin darle acceso al resto del sistema).' },
    ],
  },
  {
    icon: '🪖',
    title: 'Inspecciones (rondas de inspectores)',
    blocks: [
      { t: 'p', text: 'Sirve para saber si los inspectores SÍ están yendo a las máquinas a revisar que estén trabajando. El inspector entra al sistema (rol inspector) y su pantalla principal es 🪖 Revisar (la lista de todas las máquinas para marcarlas). También tiene 🗺️ Mapa y 🚜 Catálogo.' },
      { t: 'note', text: '📄 Mi reporte de jornada (teléfono del inspector, 15/08/2026): bloque con el que el inspector se descarga el PDF del resumen de SUS máquinas — estado, horas trabajadas, horas de parada y total de la jornada (el mismo dato que ve el jefe). ANTES solo aparecía al terminar el turno, cuando ya no le quedaba ninguna máquina en curso; ahora se puede pedir CUANDO SEA: elige el día con ◀ ▶ (hacia adelante no pasa de la última jornada de ese turno) y el turno ☀️ Día / 🌙 Noche (arranca en el suyo, se puede cambiar si cubrió el otro) y toca 📄 Descargar reporte (PDF). Si lo pide a media jornada sale el aviso "⚠️ Todavía tienes máquinas en curso: el reporte sale con lo que hay hasta ahora". El día que manda es el DÍA DE NEGOCIO: el turno de noche pertenece al día en que arrancó, así que un reporte de noche pedido a la 1:00 am sigue siendo el del día anterior. Solo lee: no cambia nada en el sistema y se puede pedir las veces que haga falta.' },
      { t: 'note', text: '📅 EL DÍA YA ARRANCA EN LA JORNADA QUE ACABAS DE CERRAR (19/08/2026). El bloque abre en la ÚLTIMA JORNADA DE TU TURNO, no en la fecha del calendario. Turno noche: la noche del día en que ARRANCÓ (7:00pm) — si terminas a las 7:00am y descargas tu reporte, sale la noche que acabas de trabajar aunque el calendario ya haya cambiado de día (debajo de la fecha dice "última noche"). Turno día: hoy (antes de las 7:00am todavía es el de ayer). QUÉ PASABA ANTES: el bloque arrancaba en el día de calendario, que cambia a las 7:00am EN PUNTO, justo la hora a la que termina el turno de noche; al inspector le salía LA NOCHE QUE TODAVÍA NO EMPIEZA — 0 horas, y las máquinas con parada o avería pendiente de la noche anterior en "🟡 Parada" — mientras el mismo equipo, en el reporte que se firma con el jefe (donde la fecha se elige a mano), salía "✅ Finalizada" con sus horas. NO eran dos cálculos distintos: los dos documentos salen de la misma cuenta; era el DÍA que el teléfono pedía. Caso real: STEVEEN CAMACHO, noche del 18/08/2026, máquina de placa FF02700X070391. Además, si el día y turno elegidos no tienen NI UNA hora registrada, el PDF ahora lo avisa arriba en rojo ("Esta jornada no tiene NINGUNA hora registrada. Revisa que el DÍA y el TURNO sean los correctos"), para que un día sin jornada no parezca un turno perdido.' },
      { t: 'note', text: '📱 Teléfono vs 💻 PC: desde un TELÉFONO, al iniciar sesión TODOS los usuarios caen en el módulo de Inspectores (esta pantalla). Desde una PC cada quien ve la app normal según su rol y la sesión se mantiene iniciada. El coordinador de patio en teléfono ve su propia pantalla (jornada de camiones). SOLO el administrador ve arriba un botón 🗂️ SISTEMA que lo lleva a la app completa desde el teléfono (para volver a Inspectores, recarga la página).' },
      { t: 'note', text: '✅ CHECK MÁQUINA (SOLO ADMINISTRADOR): solo el administrador asigna las máquinas a los inspectores; los inspectores NO se asignan solos (solo ven las que el admin les puso). El admin toca ✅ CHECK MÁQUINA, 1) elige el INSPECTOR de una lista buscable, y 2) busca la máquina y toca el TURNO (☀️ Día / 🌙 Noche) para asignársela (o de nuevo para quitársela). Cada máquina tiene DOS inspectores (día y noche). Queda en la Auditoría (✅ se asignó · Día/Noche → nombre). El admin tiene además "Ver todas".' },
      { t: 'note', text: '🔤/👤 ORGANIZAR POR (21-ago-2026): debajo del buscador del CHECK hay dos pastillas, "🔤 Máquina" y "👤 Encargado". La primera es la de siempre: las máquinas en orden alfabético por su nombre. La segunda las AGRUPA POR ENCARGADO, con el nombre de cada uno de título y la cantidad al lado, para asignarle a un inspector todas las máquinas de un mismo encargado de una sola pasada en vez de irlas buscando sueltas. NO filtra ni esconde nada: salen exactamente las mismas máquinas en los dos modos, solo cambia el orden. El mismo encargado escrito de formas distintas ("bruno", "BRUNO ") cae en UN SOLO grupo, y las máquinas SIN encargado cargado quedan juntas al final bajo "SIN ENCARGADO" — esa es la lista de pendientes por corregir en el Catálogo.' },
      { t: 'note', text: '🔵 Círculo de estado en cada máquina asignada: 🟢 VERDE = jornada en curso (trabajando) · 🟡 AMARILLO = parada (avería) · 🔴 ROJO = jornada finalizada. Además cada máquina muestra su 📍 edificio y su serial/placa.' },
      { t: 'note', text: '▶️ Iniciada por / 🏁 Finalizada por: cada jornada muestra el NOMBRE Y APELLIDO de quién la inició y de quién la finalizó. Se ve sincronizado en TODAS las tarjetas del panel de Inspecciones (la lista de máquinas al abrir cualquier categoría y su detalle) y en los tres informes: por firma, por empresa y por jornada. El "finalizada por" es el supervisor que tocó 🏁 Finalizar; el cierre automático de las 7pm/7am no lleva persona (lo hace el sistema).' },
      { t: 'note', text: '📊 REPORTE DEL DÍA POR EMPRESA — todas las máquinas (15-ago-2026): el PDF lista TODAS las máquinas de cada empresa MENOS las retiradas/eliminadas, agrupadas por estado: ✅ Activas (trabajaron), 🔴 Averiadas, 🟡 Paradas, ⏳ Esperando instrucciones y ⏳ Pendientes por iniciar. Antes solo salían las que tuvieron actividad (trabajaron, avería o parada) y se omitían las de 0 actividad y las en espera.' },
      { t: 'note', text: '🔴 AVERIADAS y 🟡 PARADAS SEPARADAS en el reporte por empresa (20-ago-2026): el bloque rojo que englobaba las dos cosas se dividió en dos renglones, porque no es lo mismo una máquina dañada que una que simplemente no trabajó. 🔴 Averiadas = tiene una avería de verdad pendiente (eléctrica, mecánica, hidráulica…), en rojo. 🟡 Paradas = no trabajó pero NO está dañada (sin operador, sin material, esperando…), en ámbar. Cuando el inspector reporta una avería el sistema guarda los DOS renglones (la avería y la marca de "máquina parada"): manda la avería y la máquina sale UNA sola vez, en 🔴 Averiadas. Los bloques ✅ Activas, ⏳ Esperando instrucciones y ⏳ Pendientes por iniciar siguen igual y la suma de todos da el total de máquinas de la empresa.' },
      { t: 'note', text: '☀️ DÍA y 🌙 NOCHE por separado en el reporte por empresa (20-ago-2026): en las columnas HORARIO DÍA y HORARIO NOCHE cada turno dice qué pasó en ESE turno: "🔴 AVERÍA · motivo" o "🟡 PARADA · motivo". Si la máquina trabajó y DESPUÉS cayó, la columna muestra las horas trabajadas y la hora en que se averió o se paró (🔴 AVERÍA 2:15pm / 🟡 PARADA 2:15pm). Así se ve de un vistazo si se averió de día y se paró de noche (o al revés): cada columna lleva lo suyo, no se mezclan.' },
      { t: 'note', text: '👥 COORDINADOR DE INSPECTORES (rol): es un inspector con superpoderes. Además de SUS propias máquinas (arriba, con su ronda normal), tiene un conmutador "🚜 Máquinas / 👥 Inspectores". En 👥 Inspectores ve a CADA inspector como una lista desplegable y buscable con sus máquinas repartidas por estado (🟢 iniciadas · ⏳ pendientes por iniciar · 🟡 paradas · 🔴 averiadas). Al TOCAR una máquina se abre el mismo check-in: puede INICIAR/FINALIZAR jornada, marcar 🟡 PARADA o 🔴 AVERÍA (con foto) y 📍 actualizar ubicación EN NOMBRE de ese inspector. La jornada/estado se le marca al INSPECTOR dueño de la máquina (porque la máquina es suya), y queda la nota "registrado por [coordinador]" para saber quién lo hizo. Para crearlo: en Usuarios se le asigna el rol "coordinador de inspectores"; sus máquinas propias se le asignan con ✅ CHECK MÁQUINA como a cualquier inspector.' },
      { t: 'note', text: '🏢 EDIFICIO (ubicación): ahora es UN SOLO campo en todo el sistema, elegido de un catálogo COMPARTIDO. Al hacer el CHECK de una máquina (y al surtir combustible) aparece un desplegable: busca el edificio y, si no existe, escríbelo y toca “➕ Agregar” — queda disponible para todos al instante. Ya no hay un campo “referencia” aparte.' },
      { t: 'p', text: 'Cómo marca el inspector una máquina:' },
      { t: 'steps', items: [
        'Entra con su usuario y contraseña (desde teléfono, cualquiera cae aquí). Ve "Mis máquinas asignadas" (las que le puso el administrador).',
        'Si la lista está vacía, el ADMINISTRADOR debe asignarle máquinas con ✅ CHECK MÁQUINA. El inspector también puede escanear el QR directo con el botón 📷.',
        'DESDE LA LISTA: toca la máquina y se abre su ficha (nombre, empresa, serial/placa).',
        'ESCANEANDO EL QR con la cámara: sale una pantalla con el logo y el botón 🔓 INICIAR SESIÓN; entra con su usuario y cae DIRECTO en la ficha de esa máquina.',
        'El sistema toma su ubicación GPS y calcula qué tan cerca está de la máquina.',
      ] },
      { t: 'p', text: 'Botones de la ficha de la máquina:' },
      { t: 'steps', items: [
        '🟢 INICIAR JORNADA: campo "Ingresar horómetro" (viene precargado con el horómetro final de la jornada anterior) y un botón 📷 Foto del horómetro (toma con la cámara o carga una imagen). El horómetro y la foto NO son obligatorios: si los dejas en blanco la jornada inicia igual. Guarda la hora de inicio y marca la máquina en Inspecciones. El botón cambia a 🏁 FINALIZAR JORNADA con un contador del tiempo trabajado.',
        '🏁 FINALIZAR JORNADA: pide CONFIRMAR mostrando el total de horas, con el campo "Ingresar horómetro" y su botón 📷 Foto del horómetro (también sin obligación). Al aceptar, esas horas (fin − inicio) se suman a Control de maquinaria en el turno ☀️ día / 🌙 noche. REGLA: ese horómetro final será el inicial de la próxima jornada. La lectura y la foto se ven en Mantenimiento de Maquinaria · ⏱️ Horómetros.',
        '🟡 PARADA (marcar máquina parada): tiene 2 caminos. "🔧 Por avería" — elige el material (caucho/aceite/filtro/repuesto/otro) y describe la falla: crea la solicitud en Servicio de Maquinaria Y marca la visita en Inspecciones. "📍 Parada / No trabajó" — el texto "NO TRABAJÓ" queda FIJO; opcionalmente escribes el motivo (sin combustible, sin operador, lluvia…) que aparece al lado ("NO TRABAJÓ · <motivo>"). Guarda tu ubicación GPS y el edificio de la máquina; NO crea nada en Servicio de Maquinaria, solo se refleja en Inspecciones. En ambos casos, en Control sale 🔴 MÁQUINA PARADA.',
        '🟡 "NO TRABAJÓ" anula horas SOLO de tu propio turno: si la máquina ya tenía horas acreditadas en TU turno (la finalizaste antes o la cerró el automático) y marcas "📍 Parada / No trabajó", esas horas se ponen en 0 — así corriges desde el teléfono cuando la máquina en realidad no trabajó. El turno que se anula es el que corre en ese momento POR EL RELOJ (día 7am–7pm, noche 7pm–7am), nunca el del compañero: marcar "no trabajó" a las 8pm anula la NOCHE, jamás el día que ya cerró a las 7pm. Para corregir un turno ya cerrado se usa Control de Maquinaria. Cada anulación deja un tramo negativo en la línea de tiempo con quién fue y cuántas horas eran.',
        '🟢 VOLVER A OPERATIVA: si la máquina está PARADA o AVERIADA, en su ficha NO sale "INICIAR JORNADA" — en su lugar sale "🟢 Volver a OPERATIVA", que cierra la avería en Servicio de Maquinaria y quita el "MÁQUINA PARADA/AVERIADA" de Control. FLUJO (13-ago-2026): averiada → Volver operativa → recién ahí aparece INICIAR JORNADA. Antes se podía iniciar jornada directo sobre una averiada, pero la avería quedaba pendiente y se arrastraba: la máquina reaparecía 🔴 averiada al día siguiente. Con este flujo ya no reaparece.',
      ] },
      { t: 'note', text: '⏱️ Asignación tardía NO baja la eficiencia (19-ago-2026): una máquina asignada DESPUÉS de que cerró el turno (p. ej. se cargó a las 7:30pm con el DÍA ya cerrado a las 7pm) no cuenta como pendiente de ese turno ni le baja el % al inspector — no pudo trabajarlo. Para el turno EN CURSO (aún abierto) todo lo asignado sí cuenta normal. La misma máquina sí entra al turno siguiente (la del 7:30pm cuenta para la NOCHE). Aplica igual en el tablero, el reporte de eficiencia y los conteos.' },
      { t: 'note', text: '📍 Ubicación: dentro del check-in el inspector guarda la ubicación GPS de la máquina con "📍 Guardar/Actualizar ubicación". Esa ubicación alimenta el reporte "📄 Máquinas por sector (Este / Oeste)" del Mapa, que agrupa las máquinas ubicadas por su sector geográfico (y lista aparte las que faltan por ubicar).' },
      { t: 'note', text: '🛰️ Edificio sincronizado con el GPS + respaldo por lista (20-ago-2026): al abrir el check-in, tomar de nuevo la ubicación o "Actualizar ubicación GPS + edificio", el Edificio se sincroniza con el SECTOR donde cae el GPS (ej. "Este · Camurí Chico"), así siempre cuadra con la ubicación real y se refleja al instante en el Mapa. ¿El GPS no funciona? Se elige el edificio de la LISTA (desplegable) y se guarda igual: la ubicación queda como estaba y solo se actualiza el edificio. Además "↻ Volver a tomar ubicación" ahora fuerza una lectura NUEVA del GPS (antes repetía la de hasta 2 min y parecía no hacer nada).' },
      { t: 'note', text: '👷 Iniciar la jornada del operador (si no tiene teléfono): dentro del mismo check-in de la máquina, el inspector toca "📷 Escanear carnet del operador", lee el QR del carnet, elige el TURNO con los botones ☀️ Día / 🌙 Noche, COTEJA la cédula (debe coincidir con el carnet) e ingresa el horómetro inicial, y toca "🟢 Iniciar jornada del operador". Arranca la jornada en esa máquina con las mismas reglas (1 máquina por operador al día, máximo 2 por turno) y queda la marca de que la registró el inspector. La ubicación del inspector queda como punto de inicio.' },
      { t: 'note', text: '🔒 No se puede iniciar jornada en una máquina averiada, parada o "Esperando instrucciones": el bloqueo aplica IGUAL si el operador escanea desde su propio teléfono que si lo hace el inspector con el carnet. Si hay una avería/parada PENDIENTE, avisa que primero hay que resolverla (marcarla ✅ Operativa); si está en ⏳ Esperando instrucciones, avisa que primero hay que sacarla de ese estado (botón "✅ Ya se decidió" en su detalle del Catálogo).' },
      { t: 'note', text: '☀️/🌙 Turno de la jornada: al escanear el carnet, el sistema sugiere el turno según la hora (día 6:00–17:59, noche el resto), pero el inspector puede cambiarlo tocando el sol (Día) o la luna (Noche). El turno elegido es el que queda guardado (define si la jornada cuenta como de día o de noche para el pago).' },
      { t: 'note', text: '🟢 Iniciar desde el QR ya deja constancia (18/08/2026): antes, arrancar la jornada desde el QR del operador o el carnet del inspector guardaba nombre, cédula y horómetro, pero NO guardaba que la jornada había arrancado. Como Inspecciones se fija justamente en ese dato, la máquina seguía saliendo ⏳ pendiente con el operador ya trabajando (le pasó a 1.410 rondas desde el 1 de julio; la mayoría se tapaba sola al cerrar y bancarse las horas). Ya quedó arreglado, y los DOS caminos de inicio usan ahora la MISMA regla — antes cada uno tenía la suya.' },
      { t: 'note', text: '⏰ La regla del inicio (no cambió, solo se unificó): el turno de día arranca a las 7:00am y el de noche a las 7:00pm. Si se marca dentro del margen (hasta las 9:00am / 9:00pm) la jornada se ancla al arranque del turno aunque se marque un poco más tarde, y cuenta el turno completo. Fuera del margen conserva la hora real y se registra el retraso: no se regalan 12 h a una marca muy tardía. Y una jornada de NOCHE iniciada pasada la medianoche pertenece a la noche que arrancó AYER a las 7pm, no al día nuevo.' },
      { t: 'note', text: '⚠️ Estado pegado en "parada": una ronda que nace sin horas queda marcada parada, y al arrancar la jornada nadie la devolvía a operativa — quedaban rondas con la jornada abierta y el estado en parada a la vez. Importa porque Control de Pagos lee ese estado. Ya se corrige al iniciar. Nada de esto borra ni cambia lo ya registrado: solo se completan campos que antes quedaban vacíos.' },
      { t: 'note', text: 'El inspector marca desde "Mis máquinas asignadas" (las que se asignó con ✅ CHECK MÁQUINA) o escaneando el QR físico. El check-in aparece de inmediato en el módulo Inspecciones (Traza por inspector), valida la jornada y muestra al inspector asignado en el Catálogo y en Control de maquinaria.' },
      { t: 'note', text: '🕒 Cierre de jornada: el DÍA cierra automático a las 7:00pm y la NOCHE a la 1:00am (la máquina que quede abierta la cierra el sistema). Excepción LUMINARIA: las luminarias (torres/equipos de iluminación) trabajan toda la noche (7pm→7am), así que su jornada de NOCHE cierra a las 7:00am (12h); igual pueden cerrarse a mano antes. El único equipo que NO se cierra (trabaja 24h) es el COMPRESOR CON MARTILLO (serial 79669). Se puede FINALIZAR manualmente antes; si se hace ANTES de la hora de fin del turno (día <7pm / noche <7am) el sistema PIDE OBLIGATORIO el MOTIVO del cierre. REGLA 15-ago-2026: el motivo se pide en TODO cierre anticipado, SIN excepción — incluye las máquinas "SOS LA GUAIRA" (siempre activas) y los camiones cerrados desde Patio, Asistencia de camiones o el escaneo de QR. Antes esos cierres no pedían motivo y la lista de "🏁 Cerradas / finalizadas" salía en blanco.' },
      { t: 'note', text: 'La cercanía es amplia a propósito (unos 300 m): si la máquina está trabajando y no se puede interrumpir, basta con estar "más o menos cerca". Si el supervisor está lejos, igual se guarda pero queda marcado "lejos ⚠️".' },
      { t: 'note', text: 'Vista de operador (al escanear el QR de la máquina): arriba se muestra un MAPA con tu ubicación en tiempo real (punto azul) y la máquina, con la DISTANCIA a la que estás (verde si estás en sitio) — así ves qué tan cerca la tienes. Botón "📷 Escanear carnet (operador)": al escanear el carnet, se muestran los datos del operador y se autocompleta el inicio de jornada (también puedes escribir la cédula). Al iniciar y al finalizar la jornada se guarda tu ubicación GPS.' },
      { t: 'note', text: 'Al FINALIZAR la jornada queda registrada en tres lugares: Operadores, Control de maquinaria e Inspecciones (módulo "🚜 Jornadas de operadores": operador, máquina, empresa, hora de inicio/fin, horas y un enlace 📍 a la ubicación donde estaba).' },
      { t: 'note', text: 'Seguridad: el inicio de sesión es por CÉDULA + CONTRASEÑA. Solo pueden entrar personas registradas por el administrador y que tengan su CÉDULA asignada; si alguien no tiene cédula, el sistema le dice "Pídele al administrador de sistemas que agregue la CÉDULA para poder ingresar". Al escanear un QR, la vista queda AISLADA (operador o control de cocina) y NO se puede entrar al resto del sistema; su única salida es "Salir" (cierra sesión).' },
      { t: 'note', text: 'REGLA IMPORTANTE: si el inspector NO marca una máquina que trabajó ese día, esa jornada queda "sin validar" y el operador no cobra.' },
      { t: 'p', text: 'Módulo "Inspecciones" (para el jefe, en Más): muestra por día quién marcó cada máquina, a qué hora, con qué estado y qué tan cerca estaba, y sobre todo la lista de "⛔ Jornadas sin validar" (máquinas que trabajaron pero que ningún inspector marcó). Usa las flechas ◀ ▶ para cambiar de día.' },
      { t: 'note', text: 'El inspector ASIGNADO a cada máquina se muestra en el Catálogo y en Control de maquinaria (🪖 Inspector: nombre). PRIORIDAD: si el inspector se asignó la máquina con el botón ✅ CHECK MÁQUINA (teléfono), ese es el asignado; si no, se usa el del último check-in (visita).' },
      { t: 'note', text: '📋 Reportes (hub): dentro de Inspecciones/Supervisión hay un hub de reportes en tarjetas: Máquinas asignadas por inspector → Reporte por inspector y Entrada y salida de camiones. Los reportes de Camiones (asistencia), Jornadas de operadores y la Traza por inspector se ven en sus propios módulos. La Distribución de guardias es una sección aparte (independiente, fuera de Reportes).' },
      { t: 'note', text: '🗓️ Distribución de guardias (dentro de Inspecciones): arma la rotación de inspectores por rango de fechas. Agregas inspectores (trae su cédula del perfil; editas teléfono, sector, cargo=Coordinador/Nocturno/Inspector y grupo A/B/C), defines sus DESCANSOS por rango a mano, o tocas ⚙️ Autogenerar 14x7 para ARMAR LOS GRUPOS A MANO: se abre una ventana donde asignas cada inspector a un grupo (A = semana 1, B = semana 2, C = semana 3), con un botón "✨ Sugerir automático" que reparte los cargos para que no descansen juntos dos coordinadores ni dos nocturnos; ajustas lo que quieras y tocas "Generar rotación 14x7" (crea los descansos y reemplaza las guardias actuales). Ves el calendario inspector×día (T en turno / D en descanso, coloreado por grupo) con la fila "En descanso", te avisa si dos coordinadores coinciden en descanso, y con 📄 Generar PDF sale el documento del ciclo (calendario + conformación de grupos + cobertura).' },
      { t: 'note', text: '🔎 Búsqueda en Trazabilidad de ubicaciones (Mapa): arriba de la trazabilidad hay un buscador por máquina, placa, serial, empresa, encargado, referencia/edificio y quién registró (inspector/operador).' },
      { t: 'note', text: 'Avería de maquinaria desde el check-in: en la ventana "✅ Revisé la máquina", el inspector puede abrir "🛠️ Avería de maquinaria", elegir el material (caucho/aceite/filtro/repuesto) con su cantidad y nota, o tocar ✏️ Otro para describir a mano una falla distinta (ej. no arranca, fuga de aceite), y "Registrar avería". Es la misma función que el operador y cae en el módulo de Servicio de Maquinaria como solicitud pendiente.' },
      { t: 'note', text: 'En "Traza por inspector" puedes TOCAR cualquier máquina de la lista y te lleva a su ficha en el Catálogo (con todos sus datos y acciones). El › al final de cada renglón indica que es clickeable.' },
      { t: 'note', text: '📊 Reporte por inspector — "Recorrido del inspector" (PDF): en Inspecciones → Reportes → ✅ Máquinas asignadas por inspector, con filtro de 📅 un día y de inspectores TIPO CHECK (marcas uno o varios; vacío = todos). Reconstruye el recorrido de cada inspector en orden cronológico: hora de la revisión, máquina, marca/modelo, serial/placa, sector/ubicación, estado en que la encontró y si estaba cerca (distancia GPS). Además trae, en el mismo documento, lo de un reporte diario: HORAS DE DÍA, HORAS DE NOCHE y HORAS TRABAJADAS de cada máquina, y la columna "Inició" con el nombre de quien marcó el inicio de la jornada. Arriba sale un resumen general (inspectores, revisiones, máquinas distintas y horas) y cada inspector tiene su propio total.' },
      { t: 'note', text: '⚠️ Cómo leer las horas del Reporte por inspector: las horas son del DÍA COMPLETO de la máquina, NO de esa visita — si el inspector revisó la misma máquina 3 veces, las 3 filas muestran las mismas horas. Por eso los totales cuentan cada máquina UNA sola vez (las horas no se suman fila por fila). Si una máquina no tiene ronda registrada ese día, sus horas salen "—" (no hay dato), que no es lo mismo que trabajar 0,00 horas. Se usa la MISMA fórmula que el Reporte del día por empresa y el Control de maquinaria, así que los números coinciden entre los tres. Este reporte agrupa por quién hizo el check-in de verdad (congelado en el momento), a diferencia del Histórico de Jornadas, que atribuye por la asignación actual y cambia cuando se reasignan máquinas.' },
      { t: 'note', text: '🕰️ Histórico por inspector (apartado Histórico, debajo de Máquinas asignadas por inspector): se pide por RANGO de fechas y agrupa por inspector y, dentro, por fecha. Sirve para ver la jornada de alguien que YA NO ESTÁ en la empresa o a quien le reasignaron las máquinas: los nombres salen de los CHECK-IN, que quedan congelados en el momento, así que reasignar una máquina no cambia lo que dice este documento. A quien ya no figure entre los inspectores activos se le pone el distintivo "Ya no activo".' },
      { t: 'note', text: '⚠️ Cómo leer el Histórico por inspector: solo cuentan las horas del TURNO que cubrió — una máquina puede trabajar de día y de noche el mismo día (el 16-ago-2026 le pasó a 102 de 173), y al inspector de día NO se le suman las horas del nocturno. El turno sale de la hora del check-in (día 7am–7pm). Las columnas "Día (contexto)" y "Noche (contexto)" son el día completo de la máquina, para comprobar la diferencia; el total NO es su suma. Y nada se cuenta dos veces: la columna "Rev." dice cuántas veces la revisó, pero las horas suman una sola vez. Ojo con el límite: solo sale lo que alcanzó a revisar — si tenía 12 asignadas y marcó 8, las otras 4 no salen con su nombre.' },
      { t: 'p', text: 'Cada supervisor trae un RESUMEN de cercanía (así sabes qué tan confiables fueron sus rondas): ✓ cuántas marcó EN SITIO (estuvo cerca, dentro de ~300 m), ⚠️ cuántas de LEJOS (marcó sin estar al lado) y • cuántas SIN GPS (no se pudo verificar). El botón "📄 Reporte de supervisión (PDF)" genera el informe del día con ese resumen por supervisor, el detalle de cada visita (hora, máquina, empresa, estado y ubicación) y las jornadas sin validar.' },
      { t: 'note', text: '⚡ Eficiencia por inspector: es por HORAS TRABAJADAS, NO por cuántas máquinas tocó/marcó. En "👷 POR INSPECTOR" cada barra trae su % de eficiencia del turno: se suma el tiempo real que trabajaron sus máquinas asignadas (incluye lo que llevan corriendo AHORA MISMO, en vivo) y se divide entre las horas que ya pasaron desde que arrancó el turno. Por eso, si el turno recién empezó, el % arranca bajo y va subiendo solo — no es que "se dañó". Una máquina averiada o parada todo el turno también le baja el % a su inspector. El botón "📄 Reporte de eficiencia" (arriba de las barras) genera el PDF con la MISMA fórmula que la gráfica.' },
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
        'La cocina escanea el QR de la empresa (con la cámara del teléfono O desde el botón "Escanear carnet" dentro de su propia pantalla de Cocina): se abre la pantalla de comidas del día de esa empresa.',
        'Se verifica con su carnet/cédula (solo cargo de cocina/alimentación).',
        'Toca uno de los 3 botones grandes: Desayuno, Almuerzo o Cena (cada uno 1 sola vez por día por empresa).',
        'El sistema sugiere el total = máquinas de la empresa × 2 + 15; el cocinero escribe cuántas comidas entregó realmente y registra.',
      ] },
      { t: 'note', text: 'Cada comida (desayuno/almuerzo/cena) se puede marcar UNA sola vez por día por empresa. Queda guardado con la empresa, la cantidad, la hora y quién la registró. Ese registro ES el control de asistencia/entrega de la empresa.' },
      { t: 'note', text: 'Empresa "solo comidas": en Empresas (admin) puedes marcar una empresa como "🍽️ Solo comidas". Esa empresa aparecerá ÚNICAMENTE en la distribución de comidas y NO saldrá en ningún otro selector, lista ni reporte del sistema (p. ej. PNB Canica). Distinto de "🚫 Ocultar", que la desactiva en todo (incluida la comida).' },
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
    icon: '📦',
    title: 'Inventario (materiales, requerimiento y traslados)',
    blocks: [
      { t: 'p', text: 'Es el control de materiales y herramientas. El inventario es GENERAL (no se separa por empresa ni por máquina al crearlo). Cada material tiene su existencia (cuánto hay) y su costo promedio (PMP), que el sistema calcula solo con las entradas.' },
      { t: 'p', text: 'Tiene varias pestañas: Existencias, Salida, Nota de traslado, Gastos, Movimientos y Dotación.' },
      { t: 'note', text: 'El Requerimiento de compras se movió al módulo COMPRAS (pestaña "📝 Requerimiento"). La recepción del material sigue cargándose al inventario como siempre.' },
      { t: 'note', text: 'Movimientos (traza): además de filtrar por tipo (Entradas / Salidas / Consumo / Ajustes), tienes 🔎 búsqueda libre (por producto o motivo) y filtro por RANGO DE FECHAS (Desde / Hasta). "✕ Limpiar" quita los filtros.' },
      { t: 'note', text: '💵 Precios en la lista: cada movimiento muestra ya en el resumen (sin tener que abrirlo) el costo unitario y el total (costo × cantidad), tanto en ENTRADAS como en SALIDAS. Las CARGAS POR LOTE se marcan con 📋 y también muestran su precio (o "sin precio" si no traían costo).' },
      { t: 'note', text: 'Revertir una salida: abre una SALIDA en Movimientos y toca "↩️ Revertir al inventario". Pide confirmación, devuelve la cantidad al stock y elimina esa salida. El stock se recalcula solo (no toca el costo/PMP). Úsalo para corregir salidas hechas por error o materiales que se devolvieron.' },
      { t: 'p', text: 'Precios en $ y en Bs (tasa BCV): en Existencias, arriba, se muestra la tasa del BCV del día (Bs por US$). El sistema la baja automáticamente cada día; con 🔄 Actualizar la refrescas y los administradores pueden fijarla a mano (por si el servicio falla). Cada producto muestra su PMP y su valor en stock en $ y en Bs. Al cargar un costo puedes escribirlo en $ o en Bs (botón $↔Bs): el precio se guarda en US$ y se muestra el equivalente.' },
      { t: 'p', text: 'Salida — es el documento (nota de salida) que se hace cuando salen materiales:' },
      { t: 'steps', items: [
        'Ve a la pestaña "📤 Salida".',
        'Busca cada producto y agrégalo; indica la cantidad de cada uno.',
        'Elige la 🚜 máquina (lista desplegable y filtrable) y los 👷 empleados que reciben (lista de la nómina, filtrable, se pueden marcar varios). Escribe el destino/motivo si quiere.',
        'Elige la 🏢 EMPRESA registrada a la que se carga la salida (lista desplegable y filtrable): se guarda en el movimiento y sale en la nota. (Sigue estando el campo de empresa NO registrada, texto libre, para casos fuera del sistema.)',
        'Toca "🧾 Generar nota de salida (PDF)": se abre la VISTA PREVIA con logo, fecha, productos y la línea de firma autorizado.',
        'Toca 🖨️ Imprimir para guardar/imprimir. RECIÉN AHÍ se descuenta del inventario.',
      ] },
      { t: 'note', text: 'IMPORTANTE: la salida se descuenta del inventario SOLO cuando confirmas (Imprimir/Guardar). Si le das Cancelar en la vista previa, NO se descuenta nada y NO se pierde lo que ya habías elegido: los productos, cantidades, máquina y empleados quedan tal cual para seguir editándolos o corregirlos.' },
      { t: 'p', text: 'Nota de traslado (entre máquinas) — traslada materiales de una máquina/empleado a otra:' },
      { t: 'steps', items: [
        'Ve a la pestaña "🔁 Nota de traslado".',
        'Agrega los materiales con stock e indica la cantidad de cada uno.',
        'Define el ORIGEN (🚜 máquina + 👷 responsable de dónde SALE) y el DESTINO (🚜 máquina + 👷 responsable a dónde VA). Indica el 📍 lugar/obra a donde va y el ESTADO del material (usado / lleno / dañado). Escribe el motivo si quiere.',
        'Toca "🔁 Generar traslado (PDF)": se abre la vista previa con el bloque Origen → Destino y dos firmas (entrega y recibe).',
        'Al confirmar (Imprimir/Guardar) se descuenta del inventario y queda guardado el traslado, casado con la máquina y el empleado de cada lado.',
      ] },
      { t: 'p', text: 'Retornar al inventario: en la pestaña 🔁 Nota de traslado, toca "📋 Realizados" para ver los traslados hechos. En cada uno tocas "↩️ Retornar al inventario": indicas el estado con que vuelve (usado/dañado/lleno) y cuánto queda disponible, y esa cantidad REINGRESA al almacén (queda como entrada, sin cambiar el costo promedio).' },
      { t: 'note', text: 'Filtro de traslados: en "📋 Realizados" hay chips para filtrar y saber si RETORNA o no al inventario: Todos · 📦 Sin retornar (aún en destino) · ↩️ Retornados. Así ves rápido cuáles faltan por reingresar.' },
      { t: 'note', text: 'Igual que la nota de entrega: si cancelas la vista previa NO se descuenta nada. La diferencia es que el traslado registra un ORIGEN y un DESTINO (de qué máquina/empleado sale y a cuál llega).' },
      { t: 'p', text: 'Gastos — cada material que SALE del almacén es un gasto. En la pestaña "💸 Gastos" ves el TOTAL GASTADO:' },
      { t: 'steps', items: [
        'Cuenta todo lo que sale del almacén: salidas y consumos manuales, notas de entrega y traslados. Cada gasto se valoriza al PMP (costo promedio) que tenía el material al momento de salir.',
        'Elige el período: Hoy, Esta semana, Este mes o Todo. El total se recalcula solo.',
        'Ves el desglose "Por categoría" (repuestos, herramientas, etc.). Toca una categoría para filtrar solo esos gastos; tócala de nuevo para quitar el filtro.',
        'Toca "📄 Reporte de gastos (PDF)": genera un PDF con el resumen por categoría y el detalle de cada salida (fecha, producto, cantidad, costo y gasto) con el total gastado.',
      ] },
      { t: 'note', text: 'Las entradas (compras) y los ajustes NO cuentan como gasto: el gasto es el material que efectivamente sale del almacén.' },
      { t: 'p', text: 'Requerimiento (pedir compras al jefe): está en el módulo COMPRAS, pestaña "📝 Requerimiento". Armas una lista de productos que hacen falta — del inventario o NUEVOS — con cantidad y precio estimado (en $ o Bs):' },
      { t: 'steps', items: [
        'Toca ➕ Nuevo, escribe el título/nota, elige la EMPRESA para la que se pide (chip "Sin empresa" o una empresa) y, opcionalmente, el PROVEEDOR (chip "Sin proveedor" o uno del catálogo). Agrega productos (📦 Del inventario o ＋ Producto nuevo) con su cantidad y precio estimado. Con el botón $/Bs eliges la moneda del precio.',
        'Toca "📤 Enviar al jefe": queda guardado como Pendiente.',
        'El jefe (administrador) lo ✅ Aprueba o ❌ Rechaza.',
        'Si se compra, el administrador toca "📥 Recibir en inventario", confirma la cantidad y el PRECIO REAL de cada producto, y el sistema crea la ENTRADA (los productos nuevos se crean solos). El requerimiento queda como Recibido.',
        'Con 🧾 PDF imprimes el requerimiento para pasárselo al jefe.',
      ] },
      { t: 'note', text: 'Proveedor y cuenta por pagar: si le asignas un PROVEEDOR al requerimiento, al aprobarlo se genera automáticamente la ORDEN DE COMPRA (aprobada) y la CUENTA POR PAGAR de ese proveedor por el total de los ítems. Sin proveedor, la orden queda en BORRADOR y no se crea cuenta hasta que le asignes uno (editando el requerimiento). Los proveedores se crean en la pestaña "🏭 Proveedores" de Compras.' },
      { t: 'note', text: '🏬 Almacenista — "Autorizado bajo orden del Gerente General": el usuario con rol ALMACENISTA solo puede aprobar el pago de mangueras si marca la casilla "Autorizado bajo orden del Gerente General" (le aparece solo a ese rol, arriba de la lista, tanto en Mangueras como en Compras → 🔧 Mangueras). Sin marcarla, el sistema no deja aprobar. Al aprobar así, el PDF de autorización de la manguera lo indica con ese texto sobre la firma del Gerente General. Requiere correr supabase/mangueras_orden_gerente_general.sql.' },
      { t: 'note', text: '✅ Aprobación en lote: en Compras → "📝 Requerimiento" y en "🔧 Mangueras por aprobar", el gerente puede MARCAR (☑) varios a la vez y tocar "✅ Aprobar en lote (N)" para aprobarlos todos de un click. En requerimientos solo aprueba los PENDIENTES marcados; en mangueras solo las INSTALADAS (las no instaladas se omiten con aviso). Cada uno genera su orden/cuenta igual que al aprobar uno por uno.' },
      { t: 'note', text: '🛒 Compras directas (reemplaza a "Solicitudes de pedido"): para una compra YA HECHA que quieres cargar de una vez. En Compras → "🛒 Compras directas" toca "+ Nueva", elige la EMPRESA y el PROVEEDOR, agrega los renglones (producto · cantidad · PRECIO), adjunta la FACTURA (imagen o PDF) y toca "Registrar compra directa". Al guardarla: (1) cada renglón ENTRA al inventario con su precio (recalcula el costo promedio), (2) se genera la CUENTA POR PAGAR al proveedor, y (3) le queda su código correlativo (CD-0001, CD-0002…). En la lista, cada compra trae "📎 Ver factura" para revisar la factura cargada. A diferencia del Requerimiento (que se pide y el jefe aprueba antes de comprar), la compra directa es inmediata: no pasa por aprobación. Requiere correr una vez supabase/compras_directas.sql.' },
      { t: 'note', text: 'Solo los ADMINISTRADORES aprueban, rechazan y reciben requerimientos. Cualquiera con acceso a Compras (o Inventario) puede crearlos; para RECIBIR el material se necesita permiso de Inventario.' },
      { t: 'note', text: '🧾 Recibo de cobro / pago (22/08/2026): en Compras → 💰 Por cobrar y 💸 Por pagar, cada cuenta trae el botón "🧾 Recibo de cobro" (o "🧾 Recibo de pago"). Genera un PDF con el membrete, la contraparte, el concepto, el Nº de factura/control, el monto original, lo abonado y el saldo (con el total EN LETRAS, ej. "Son: DOSCIENTOS… CON 17/100 DÓLARES"), el historial de abonos y las líneas de firma. Sirve tanto si la cuenta está pendiente (muestra "Saldo por cobrar/pagar") como saldada ("Total cobrado/pagado"). Es solo lectura: cualquiera que vea el módulo puede generarlo, no cambia la cuenta.' },
      { t: 'note', text: 'Adjuntar un FORMATO (imagen o PDF): se puede AL CREAR el requerimiento —en el formulario "Nuevo requerimiento" hay una tarjeta "📎 Formato (opcional)" con el botón "📎 Adjuntar imagen o PDF" (sirve tanto para "Del inventario" como para "＋ Producto nuevo"); el archivo se sube y se guarda junto al requerimiento al enviarlo. También se puede DESPUÉS: en cada requerimiento ya creado toca "📎 Subir formato". Queda guardado (📎 Formato adjunto). Con "👁️ Ver formato" se abre la vista previa con botón "⬇️ Descargar / Abrir". Al APROBAR un requerimiento que trae formato, la vista previa se abre sola para revisarlo y descargarlo.' },
      { t: 'note', text: 'Imagen POR PRODUCTO (nuevo): cada producto del requerimiento puede llevar su propia imagen de referencia. En el formulario, dentro de la tarjeta de cada producto, toca "🖼️ Imagen del producto" (toma foto o elige de la galería); queda una miniatura y puedes "🖼️ Cambiar imagen" o "Quitar". Es distinto del 📎 Formato general del requerimiento: esto es una foto POR CADA producto. Al imprimir con 🧾 PDF, la tabla muestra una columna "Imagen" con la foto de cada producto junto a su descripción (si ningún producto tiene imagen, la columna no aparece). Sirve también en el PDF por lote y en el Resumen.' },
      { t: 'note', text: 'Revertir un rechazo (error de dedo): si un requerimiento quedó ❌ Rechazado por equivocación, el administrador toca "↩ Volver a pendiente": vuelve a estado Pendiente (se limpia el rechazo) y se NOTIFICA a los administradores que quedó pendiente otra vez.' },
      { t: 'note', text: 'Anular un requerimiento YA APROBADO (20/08/2026): el mismo gerente que lo aprobó puede echarlo para atrás con "⛔ Anular (rechazar)" en un requerimiento ✅ Aprobado. Queda ❌ Rechazado y, si al aprobar se generó orden de compra y cuenta por pagar, el sistema las ANULA automáticamente. No revierte stock ya recibido. Lo mismo en Compras: una solicitud ✅ Aprobada trae "⛔ Anular (rechazar)" y una orden ✅ Aprobada trae "⛔ Anular" (que también anula su cuenta por pagar pendiente).' },
      { t: 'note', text: 'Editar / eliminar un requerimiento: en cada requerimiento hay botones "✏️ Editar" (cambia título, nota y productos — no si ya fue recibido en inventario) y "🗑️ Eliminar" (borra TODO el requerimiento, con confirmación). Disponible para quien tenga escritura en Inventario.' },
      { t: 'p', text: 'Tipo de producto y filtro: al crear/editar un producto puedes ponerle un TIPO (bombona, silla, mecate…). Escríbelo o tócalo de las sugerencias. Arriba de la lista aparece "Filtrar por tipo" con un chip por cada tipo (y su cantidad): toca uno para ver solo esos productos. El tipo también sale en el reporte de productos.' },
      { t: 'p', text: 'Bombonas — carga (vacía / en uso / llena): en los productos tipo "bombona" aparecen botones para tildar su carga (🔴 vacía, 🟡 en uso, 🟢 llena) directo en la tarjeta (o en el editor). Vuelve a tocar el mismo para quitarlo. Arriba tienes "Filtrar por carga" para ver solo las llenas, en uso o vacías, y el botón "🛢️ Reporte de bombonas por carga" genera un PDF con cuántas hay en cada estado. IMPORTANTE: si una bombona sale en "Sin definir" es porque aún no le has tildado la carga (por eso los contadores 🟢🟡🔴 dan 0). Cada bombona registrada cuenta como 1 aunque su existencia esté en 0; si tiene cantidad mayor, se suma esa cantidad.' },
      { t: 'p', text: 'Eliminar un producto: entra a ✏️ Editar producto y abajo toca "🗑 Eliminar producto". Pide confirmación y borra el producto y TODO su historial de movimientos (no se puede deshacer).' },
      { t: 'note', text: 'El SKU de cada material es automático e incremental (INV-0001, INV-0002…).' },
      { t: 'p', text: 'Reporte de productos y estado — en la pestaña Existencias:' },
      { t: 'steps', items: [
        'Cada producto muestra CÓMO SE ENCUENTRA con su color: 🔵 Nuevo, 🟢 Bueno, 🟡 Regular, 🔴 Dañado (o ⚪ Sin estado si no lo has definido). Lo tildas rápido abriendo el producto (chips "¿Cómo se encuentra?") sin entrar al editor, y se sincroniza en vivo con los demás equipos.',
        'Además muestra su DISPONIBILIDAD automática: Disponible, Bajo mínimo o Agotado (según la cantidad vs el stock mínimo).',
        'Toca "📄 Reporte de productos (cantidad y estado)": genera un PDF con TODOS los productos, su cantidad, disponibilidad y estado.',
        'Al editar un producto (✏️ Editar producto) puedes cambiar la CANTIDAD (existencia): el sistema registra la diferencia como un AJUSTE DE INVENTARIO en Movimientos.',
      ] },
    ],
  },
  {
    icon: '🔍',
    title: 'Inspecciones de Maquinaria (control por equipo)',
    blocks: [
      { t: 'p', text: 'Módulo para inspeccionar cada equipo: qué herramientas/accesorios tiene y en qué estado, con su REPORTE DE INSPECCIÓN en PDF.' },
      { t: 'steps', items: [
        'Entra a "Más → 🔍 Inspecciones de Maquinaria".',
        'Busca el equipo por PLACA, SERIAL o nombre en el buscador, y tócalo.',
        'Se abre su detalle (placa, serial, empresa) y el HISTORIAL de inspecciones anteriores (toca una para reimprimir su PDF).',
        'Toca "📋 REPORTE DE INSPECCIÓN (nueva)" para hacer una inspección nueva.',
        'Pon la FECHA y HORA, agrega los ÍTEMS (descripción, cantidad, serial/especificación y su ESTADO con color 🟢 Bien / 🟠 Regular / 🔴 Falla), las observaciones y, si quieres, el inspector y el chofer/operador (para las firmas).',
        'Toca "💾 Guardar y generar REPORTE DE INSPECCIÓN": se guarda en el historial y se abre el PDF (nombre "REPORTE DE INSPECCION - <equipo>").',
      ] },
      { t: 'note', text: 'Los equipos que aparecen son los mismos del CATÁLOGO (todas las máquinas), en orden A→Z natural.' },
      { t: 'note', text: 'Editar / eliminar una inspección: en cada inspección del historial hay botones "📄 PDF" (reimprimir), "✏️ Editar" (reabre el formulario con todos sus datos para corregir y volver a generar el PDF) y "🗑️ Eliminar" (con confirmación). Disponible para quien tenga escritura en el módulo.' },
      { t: 'note', text: 'Control por equipo: al hacer una NUEVA inspección se PRECARGAN los ítems de la última inspección de ese equipo, así solo ajustas cantidades y estados sin reteclear todo.' },
      { t: 'note', text: 'Carga masiva por Excel (versión web): arriba, junto al buscador, hay dos botones. "⬇️ Plantilla Excel" descarga una plantilla con los encabezados y una hoja "Máquinas (referencia)" con los códigos/serial válidos. En la plantilla, 1 FILA = 1 ÍTEM del inventario; escribe en cada fila el CÓDIGO o SERIAL de la máquina y su ítem (descripción, cantidad, unidad, serial, estado y nivel: bien/regular/falla). Varias filas con la misma máquina se agrupan en UNA sola inspección; la fecha, hora, inspector, operador y condición general se toman de la primera fila de esa máquina.' },
      { t: 'note', text: 'Al tocar "⬆️ Carga masiva" y elegir el Excel, el sistema muestra una VISTA PREVIA por máquina con su TIPO y el inventario detectado (nº de ítems y semáforo), marcando ✓ lista o ✕ error (por ejemplo, si el código no existe o la máquina no trae ítems). Solo se cargan las que están ✓ listas; las que tienen error se omiten (corrige la plantilla y vuelve a subirla). Toca "💾 Cargar N inspección(es)" para guardarlas todas de una vez.' },
    ],
  },
  {
    icon: '📐',
    title: 'Geodesta (topografía)',
    blocks: [
      { t: 'p', text: 'Módulo de topografía: levanta terreno, genera curvas de nivel, calcula volúmenes de corte/relleno, inspecciona en campo con GPS y foto, y exporta a CAD/GIS — todo ligado a las obras/edificios del sistema. Coordenadas de trabajo: UTM SIRGAS-REGVEN 19N (EPSG:2202).' },
      { t: 'steps', items: [
        'Entra a "Más → 📐 Geodesta" y toca "＋ Nuevo levantamiento".',
        'Escribe el NOMBRE, elige la OBRA/EDIFICIO (catálogo de Ubicaciones) y la TOLERANCIA GPS en metros; toca "Crear levantamiento".',
        'Toca el levantamiento para abrir sus PUNTOS, MAPA, SUPERFICIE, VOLUMEN y SALIDAS.',
      ] },
      { t: 'note', text: '📋 Puntos: captura por GPS (rechaza tomas menos precisas que la tolerancia), entrada manual (N/E/Z o lat/lon) o importación de CSV/TXT (P,N,E,Z,desc — autodetecta encabezados). Cada punto tiene capa/código, se puede marcar como punto de control (GCP) o excluir (outlier). Exporta el CSV de vuelta.' },
      { t: 'note', text: '⛰️ Superficie: genera el modelo del terreno (TIN) y sus CURVAS DE NIVEL al intervalo que elijas (0.5/1/2/5 m). Guarda versiones para comparar en el tiempo; se dibujan sobre el mapa.' },
      { t: 'note', text: '📦 Volumen: cubicación de corte/relleno comparando dos superficies (avance entre fechas) o una superficie contra una cota de diseño. Da corte, relleno y neto en m³, con mapa de diferencias (🟥 corte, 🟦 relleno) y reporte PDF.' },
      { t: 'note', text: '🧭 Inspecciones: desde el detalle del levantamiento, inspección de terreno con GPS, checklist configurable, hallazgos, fotos, firma y estado (pendiente/observado/aprobado), con acta PDF y mapa por estado.' },
      { t: 'note', text: '📤 Salidas: perfil longitudinal entre dos puntos, y exportación a DXF (AutoCAD), KML (Google Earth), GeoJSON (QGIS/ArcGIS → Shapefile/GeoPackage) y LandXML (proyectista y guiado de maquinaria). Reporte técnico PDF consolidado.' },
      { t: 'note', text: '📵 Campo sin señal: si capturas puntos sin conexión, quedan guardados en el teléfono y se SINCRONIZAN solos al volver la señal (aparece un aviso con botón "Sincronizar"). Las nubes densas se agrupan (clusters) en el mapa.' },
      { t: 'note', text: 'Herramientas avanzadas: 🌡️ mapa de calor de PENDIENTES y 🧊 visor 3D del terreno (en Superficie); ✂️ SECCIONES transversales (en Salidas); 📐 LÍNEAS DE ROTURA para que el terreno no cruce bordes de talud/vías; 🛰️ ORTOFOTO propia (capa base por URL de tiles) en el mapa; ✏️ dibujar sobre las fotos de inspección; y 🌊 GEOIDE N para que la cota del GPS sea ortométrica (sobre el nivel del mar).' },
      { t: 'note', text: 'Acceso por permiso: módulo "Geodesta" en Lectura (solo ver), Escritura (crear/capturar) o Full control (eliminar). También existe el rol "Geodesta" para asignarlo directo a un usuario.' },
    ],
  },
  {
    icon: '🧰',
    title: 'Mantenimiento de Maquinaria (preventivo · horómetros)',
    blocks: [
      { t: 'p', text: 'El taller quedó dividido en DOS secciones, cada una con su propia pantalla en "Más": 🧰 Mantenimiento de Maquinaria es lo PROGRAMADO por horómetro (el servicio que le toca a la máquina), y 🔧 Servicio de Maquinaria es lo que se DAÑÓ (las averías y las reparaciones). Antes todo estaba junto en una sola pantalla; ahora cada cosa se trabaja en su sitio y no se mezclan.' },
      { t: 'p', text: 'Mantenimiento abre directo en la pestaña ⏱️ Horómetros y tiene TRES pestañas: ⏱️ Horómetros, 🧰 En mantenimiento (N) y ✓ Historial. Aquí NO hay pestaña de averías, ni botón de escanear, ni reporte de gasto — todo eso está en 🔧 Servicio de Maquinaria.' },
      { t: 'note', text: '⏱️ Horómetros: pestaña dedicada al control de horómetros de TODAS las máquinas. Por cada una muestra el horómetro actual, las horas acumuladas desde el último mantenimiento y lo que FALTA para el próximo (objetivo 250 h) con barra de progreso y nivel (🟡 200 h · 🟠 220 h · 🔴 250 h/vencido). Cada tarjeta trae Máquina, Serial/Placa, Empresa, Encargado, Inspector asignado (☀️ día / 🌙 noche), Ubicación (GPS) y Referencia/Edificio, y arriba un resumen (máquinas, próximas ≥200 h, vencidas ≥250 h). Se ordena de la más cercana al mantenimiento primero y el buscador filtra por TODAS las características (máquina, serial, placa, empresa, encargado, ubicación/referencia, tipo). Está vinculada con la FOTO del horómetro que coloca el inspector/operador y con los datos que ingresa (lectura inicial → final, fecha de la jornada y quién la registró): toca la miniatura para ampliar. También puedes ✓ Confirmar mantenimiento (reinicia el conteo de horas).' },
      { t: 'note', text: '🔔 Aviso de máquinas que ya les toca: arriba de todo sale un banner con las máquinas que llegaron al horómetro de mantenimiento (🟡 200 h · 🟠 220 h · 🔴 250 h/vencido). Tócalo para desplegarlas y cada una trae el botón "✓ Confirmar mantenimiento y reiniciar horómetro" (pone el contador en cero y arranca el conteo hacia las próximas 250 h). Este banner SOLO sale en Mantenimiento — en Servicio de Maquinaria no aparece.' },
      { t: 'steps', items: [
        'Enviar a mantenimiento: toca "🧰 Enviar a mantenimiento", elige la máquina (puedes buscarla por nombre o empresa) y llena la FECHA DE ENTRADA al taller, el MOTIVO (obligatorio, ej. "servicio de 250 h, cambio de aceite y filtros"), los DÍAS ESTIMADOS y qué se le va a cambiar. OJO, esto CAMBIÓ: la máquina YA NO queda No operativa sola. Se abre el expediente y queda reportada como parada en Inspecciones, pero el estado de la máquina lo cambias tú en 🛠️ Control de Maquinaria.',
        'Registrar retorno: cuando vuelve, toca "✓ Registrar retorno operativo", pon qué se le cambió y la fecha. Se cierra el expediente y se cierran sus averías pendientes. OJO, esto CAMBIÓ: la máquina YA NO vuelve a Operativa sola — la reactiva el coordinador desde el panel QR o tú desde 🛠️ Control de Maquinaria. (Funciona igual en las dos secciones.)',
      ] },
      { t: 'note', text: '🧰 En mantenimiento (N) y ✓ Historial: muestran SOLO los expedientes PREVENTIVOS, o sea las máquinas que entraron al taller por su servicio programado. Las que se dañaron no salen acá — esas se ven en 🔧 Servicio de Maquinaria.' },
      { t: 'note', text: 'Ya NO se elige el tipo: antes, al enviar una máquina al taller, había que escoger a mano si era correctivo o preventivo. Ahora lo fija la sección donde estás: lo que envías desde 🧰 Mantenimiento queda PREVENTIVO y lo que envías desde 🔧 Servicio queda CORRECTIVO. Un solo botón, sin selector que equivocar.' },
      { t: 'note', text: '🔐 Permisos: "Servicio de maquinaria (averías)" es un módulo NUEVO en Usuarios → Permisos por módulo, con su propia fila. Mientras un administrador no le ponga un nivel propio, HEREDA el permiso de "Mantenimiento de maquinaria": quien entraba antes al taller sigue entrando a las dos secciones — nadie perdió ni ganó acceso con la división. Si quieres que alguien vea solo una de las dos, dale el nivel que quieras en la fila de Servicio y quítale (o bájale) el de Mantenimiento.' },
    ],
  },
  {
    icon: '🔧',
    title: 'Servicio de Maquinaria (averías · taller · reporte)',
    blocks: [
      { t: 'p', text: 'La otra mitad del taller: lo que se DAÑÓ. Aquí caen las averías que reportan por QR (operador, inspector, coordinador de patio o coordinador QR), se envían las máquinas a reparación y se lleva el reporte de gasto. Lo programado por horómetro está en 🧰 Mantenimiento de Maquinaria.' },
      { t: 'p', text: 'Abre directo en la pestaña ⏳ Averías y tiene CINCO pestañas: ⏳ Averías (N) (lo reportado, por empresa → máquina), 🧾 Servicios (el registro de lo que se le hizo a cada máquina), 🔧 En reparación (N), ✓ Historial y 📊 Reporte.' },
      { t: 'note', text: '⚠️ LO QUE CAMBIÓ EL 18-AGO-2026, y conviene que lo sepa todo el equipo: el taller ya NO mueve el estado de las máquinas. Antes, enviar una máquina a reparación la ponía No operativa sola, y registrar el retorno la reactivaba sola. Ahora NO. El taller lleva el registro de lo que pasó; quien pone o quita una máquina de operación es 🛠️ Control de Maquinaria, o el coordinador desde su panel QR — que son los que de verdad la están viendo. Se hizo así a propósito, a pedido del cliente: para que una pila de reportes sin cerrar no arrastre el estado de la flota. El horómetro es la ÚNICA excepción: "✓ Confirmar mantenimiento" sigue reiniciando el conteo, como siempre.' },
      { t: 'note', text: '🧾 Servicios: la pestaña donde queda constancia de lo que se le HIZO a la máquina, con el mismo formato de la planilla de papel. Tiene las cinco partes: 1) DATOS GENERALES (fecha, máquina, operador/técnico), 2) TIPO DE INTERVENCIÓN (Mecánica · Electricidad · Mangueras/Hidráulica · Servicio — puedes marcar varias), 3) DESCRIPCIÓN DEL PROBLEMA, 4) ACCIONES REALIZADAS con 📷 foto de referencia, y 5) REPUESTOS UTILIZADOS en renglones (cantidad, descripción, estado). Aquí NO se llevan costos ni pagos: es un registro de trabajo, nada más.' },
      { t: 'note', text: '⚙️ Tipos de intervención administrables (20-ago-2026): los tipos ya NO están fijos en el programa. En 🧾 Servicios, quien tenga permiso de escritura ve el botón "⚙️ Tipos de intervención": desde ahí se CREAN nuevos (ej. Soldadura, Aire acondicionado), se RENOMBRAN y se les cambia el ORDEN en que salen las casillas. También se llega desde el propio formulario, con "⚙️ Administrar los tipos…" debajo de las casillas.' },
      { t: 'note', text: '🚫 "Borrar" un tipo en realidad lo DESACTIVA, y es a propósito: el tipo deja de salir en el formulario (nadie lo puede marcar en un servicio nuevo), pero los servicios YA registrados que lo usaban lo siguen mostrando con su nombre, en la lista y en el PDF. Si se borrara de verdad, esos registros viejos quedarían sin nombre. Se puede reactivar cuando se quiera. El nombre sí se puede cambiar cuando haga falta; la clave interna no, porque es la que quedó escrita dentro de cada servicio.' },
      { t: 'note', text: '⏳ Para habilitarlo hay que correr UNA SOLA VEZ el archivo supabase/servicio_tipos_intervencion.sql en Supabase (SQL Editor). Mientras nadie lo corra no se rompe nada: el formulario sigue trabajando normal con los cuatro tipos de siempre (Mecánica · Electricidad · Mangueras / Hidráulica · Servicio) y el modal de administración avisa que falta correrlo.' },
      { t: 'note', text: '🏭 Interno vs 🤝 Externo: al registrar el servicio dices quién lo hizo. INTERNO es el equipo de la empresa (pones el nombre del operador o técnico). EXTERNO es una persona o taller de afuera (pones su nombre). Los dos quedan en el mismo historial y salen igual en el PDF.' },
      { t: 'note', text: '⚠️✅ Las dos verdades juntas: al registrar un servicio puedes ENLAZARLO a una avería reportada (es opcional). Si lo haces, el renglón muestra las dos cosas a la vez: "✅ Atendida en taller" y, si todavía figura pendiente, "⏳ El sistema la sigue viendo pendiente". NO es una contradicción — son dos preguntas distintas: ¿ya la repararon? y ¿la máquina está operativa? Verlas juntas evita que alguien crea que el sistema se equivoca. Enlazar la avería deja constancia; no la cierra en el resto del sistema.' },
      { t: 'note', text: '📄 PDF de ficha técnica y reparaciones: en 🧾 Servicios filtras por máquina y por rango de fechas, y tocas "📄 Exportar PDF". Si filtraste UNA SOLA máquina, la primera página sale con su FICHA TÉCNICA (foto, tipo de equipo, marca, modelo, serial, placa, identificador, empresa y encargado) y de la segunda en adelante van todas sus reparaciones con sus repuestos, más las dos líneas para firmar (Técnico y Supervisor). Si filtraste varias máquinas, sale agrupado por máquina y sin ficha — cuarenta fichas seguidas no le sirven a nadie. Las reparaciones viejas, de antes de esta pestaña, también salen, marcadas como "Registro anterior" porque traen menos datos.' },
      { t: 'note', text: '✂️ FUERA LUBRICACIÓN Y HORÓMETRO DEL PDF (20/08/2026, pedido del cliente sobre el documento real): la ficha del reporte ya NO imprime el bloque "🛢️ Información de lubricación" ni el de "⏱️ Horómetro". En la flota salían casi siempre vacíos ("SIN DATOS DE LUBRICACIÓN — ") y empujaban media página antes de las reparaciones, que es lo que se viene a leer. La ficha quedó en: foto + Información general + las reparaciones. OJO: los datos NO se borraron — el tipo de aceite, la cantidad y el horómetro siguen en la máquina y se siguen editando en 🚜 Equipos / Control de Maquinaria; lo único que cambió es que dejaron de imprimirse en este PDF.' },
      { t: 'note', text: '🔴 Paradas viejas sin resolver: arriba sale un banner rojo con las máquinas que llevan más de 4 horas marcadas como MÁQUINA PARADA sin que nadie las resuelva. Tócalo para desplegarlas (trae máquina, empresa y el motivo) y cada una tiene el botón "✓ Ya está operativa (resolver)" para cerrarla de una vez. Este banner SOLO sale en Servicio — una parada es una máquina caída, no un mantenimiento programado.' },
      { t: 'note', text: '🔧 En reparación (N) y ✓ Historial: muestran SOLO los expedientes CORRECTIVOS, o sea las máquinas que entraron al taller porque se dañaron. Los servicios programados se ven en 🧰 Mantenimiento de Maquinaria.' },
      { t: 'note', text: 'Averías colapsables + buscables: cada empresa se muestra CERRADA (toca su encabezado para abrir/cerrar sus máquinas; el encabezado indica cuántas máquinas y cuántas averías lleva). Arriba puedes buscar por empresa o máquina; al buscar se abren todas para no ocultar resultados.' },
      { t: 'note', text: '📷 Escanear · reportar avería: botón arriba del módulo. Escanea el QR de la máquina y registra la avería directo (material o ✏️ Otro, cantidad, nota y foto), igual que el operador pero desde la vista del administrador.' },
      { t: 'note', text: '📊 Reporte (dashboard de averías): cuarta pestaña. Ranking en gráfico de barras de qué equipo genera más averías, con su total de averías y el gasto en $. Agrupa por 🚜 Equipo · 🏢 Empresa · 🏷️ Tipo de maquinaria y filtra por tipo. Arriba salen los totales. En modo Equipo, toca una máquina para ver su detalle: empresa, placa/serial, total de averías, desglose por tipo (cuántos cauchos/filtros/aceites/repuestos/otros) y cada avería con su fecha. Botón 📄 Exportar reporte (PDF).' },
      { t: 'note', text: '💰 De dónde sale el gasto: el dinero que genera cada equipo se toma del almacén — los materiales que SALIERON del inventario para ese equipo (cantidad × su costo). Por eso al dar una salida en Inventario conviene elegir el 🚜 equipo destino: así el gasto queda bien atribuido en el reporte.' },
      { t: 'note', text: '🔍 Inspección + avería: el detalle de cada equipo CRUZA con Inspección de Maquinaria: muestra su última inspección (fecha, inspector, condición general) y los puntos observados (🔴/🟠) que detectó, junto a las averías reportadas. En el ranking por equipo aparece un 🔍 N obs. cuando la última inspección tiene puntos observados.' },
      { t: 'note', text: 'Los 3 casos (con filtro y conteo): 🔧🔍 Avería + inspección (tiene averías y fue inspeccionado), 🔧 Avería sin inspección (tiene averías pero nunca se inspeccionó) e 🔍 Inspección sin avería (fue inspeccionado —a veces con puntos observados— pero aún sin averías). Cada equipo trae su etiqueta de caso y el PDF incluye una columna Caso con los totales.' },
      { t: 'steps', items: [
        'Ver el detalle de una avería: TOCA la avería (donde dice el material y la fecha) y se abre una ficha con los DATOS de la máquina (empresa, tipo, placa, serial, último horómetro) y LA FALLA (qué necesita, nota y la FOTO de referencia si la subieron).',
        'Enviar a reparación: toca "🔧 Enviar a reparación" (o el botón en la tarjeta de la avería). Llena la FECHA DE SALIDA, el MOTIVO de la avería (obligatorio, ej. "falla hidráulica, sin arranque, espera de repuesto"), los DÍAS ESTIMADOS y qué se le va a cambiar. Ya NO se pide el tipo: por estar en Servicio queda registrada como reparación CORRECTIVA. OJO, esto CAMBIÓ: la máquina YA NO queda No operativa sola — se abre el expediente y queda reportada como parada en Inspecciones, pero el estado lo cambias en 🛠️ Control de Maquinaria.',
        'Registrar retorno: cuando vuelve, toca "✓ Registrar retorno operativo", pon qué se le cambió y la fecha. Se cierra el expediente y se cierran sus averías pendientes. OJO, esto CAMBIÓ: la máquina YA NO vuelve a Operativa sola — la reactiva el coordinador desde el panel QR o tú desde 🛠️ Control de Maquinaria. (Funciona igual en las dos secciones.)',
      ] },
      { t: 'note', text: 'Foto en las averías: al reportar una avería (operador, inspector, coordinador de patio o coordinador) hay un botón "📷 Foto de referencia (opcional)". La foto se ve luego en el detalle de la avería, aquí en Servicio de Maquinaria.' },
    ],
  },
  {
    icon: '⛽',
    title: 'Surtir gasoil (por QR)',
    blocks: [
      { t: 'p', text: 'Se puede registrar el surtido de gasoil escaneando el QR de la máquina, desde: el Inspector (en su check-in), el Coordinador de Patio y los Coordinadores QR.' },
      { t: 'steps', items: [
        'Toca "⛽ Surtir gasoil" y escanea el QR de la máquina (o, en el inspector, ya estando en el check-in de esa máquina).',
        'Escribe el HORÓMETRO actual y los LITROS surtidos.',
        'Toca "Registrar surtido".',
      ] },
      { t: 'note', text: 'La pantalla te muestra el SURTIDO TOTAL (litros que se le han echado) y el CONSUMIDO estimado (las horas desde el último surtido × el rendimiento L/h de la máquina), para comparar de un vistazo.' },
    ],
  },
  {
    icon: '🚧',
    title: 'Coordinador de Patio',
    blocks: [
      { t: 'p', text: 'Rol para controlar la JORNADA y la entrada/salida de los camiones al patio, y reportar averías, todo por QR.' },
      { t: 'steps', items: [
        '🕒 Jornada de camión: escanea el QR del camión para INICIAR su jornada; al escanearlo DE NUEVO la FINALIZA (pide confirmar mostrando el total de horas). Las horas van a Control de maquinaria y la jornada aparece en Inspecciones.',
        '📷 Entrada / Salida: escanea el QR del camión y elige ENTRADA o SALIDA. Queda registrado con la hora.',
        '⛽ Surtir gasoil: escanea y registra horómetro + litros (igual que arriba).',
        '🛠️ Avería de maquinaria: escanea y reporta la falla (va a Servicio de Maquinaria).',
        '🚚 Entrada y salida de camiones: abre un CALENDARIO; cada día muestra cuántos camiones entraron (↓) y salieron (↑). Toca un día para ver el detalle. (El administrador también lo ve dentro de Inspecciones.)',
      ] },
      { t: 'note', text: 'Debajo del botón de jornada se ve la lista de 🟢 Camiones en jornada (asistencia) con el tiempo transcurrido de cada uno y un botón 🏁 Finalizar.' },
    ],
  },
  {
    icon: '🔄',
    title: 'Traslados, Autorizaciones, Mapa',
    blocks: [
      { t: 'bullets', items: [
        'Traslados: mover combustible de un tanque a otro (se descuenta de uno y se suma al otro).',
        'Autorizaciones: cuando algo necesita permiso, se pide aquí y la persona autorizada lo aprueba o rechaza.',
        'Mapa: muestra dónde está cada máquina según su última ubicación GPS. Con el panel "🗺️ Sectores (zonas)" puedes ver u ocultar las zonas de La Guaira (Sector Oeste y Este), cada una con su color y sus límites.',
        'Mapa · Tu ubicación y máquinas cercanas: el mapa muestra tu ubicación (punto azul, si le das permiso de GPS al navegador). El botón 📍 dentro del mapa te centra en ella y lista las máquinas más cercanas (≤20 km) con su distancia. Además, al TOCAR cualquier punto del mapa aparece un globo con las máquinas cercanas a ese punto.',
        'Mapa · Rutas (🧭 Mostrar / Ocultar): las rutas (recorrido de cada máquina) vienen OCULTAS por defecto. Con el botón "🧭 Mostrar rutas" arriba del mapa las prendes y las apagas cuando quieras.',
        'Mapa · Capas: con el panel "🗂️ Capas" prendes y apagas los puntos por TIPO de equipo (igual que el Conteo: payloaders, jumbos, tractores, cisternas…). Cada tipo muestra cuántas están UBICADAS del total (ej. 📍 22/25 · faltan 3), y arriba el total ubicadas/total del sistema, para saber cuántas quedan por ubicar. Usa "Mostrar todas" / "Ocultar todas" o toca un tipo para ver sus máquinas y elegir una por una.',
        'Mapa · Ver detalle por tipo: al tocar un tipo se despliega la lista. Las UBICADAS salen con su 🔖 placa/serial y su empresa. Debajo, en ROJO, aparece "⛔ Faltan por ubicar" con las que aún no tienen ubicación, también con su placa/serial y empresa, para saber exactamente cuáles buscar.',
        'Mapa · Click para ver o ubicar: toca una máquina UBICADA (su nombre / 🗺️ Ver en el mapa) y el mapa se enfoca SOLO en ella; usa "← Ver todas las ubicaciones" para volver. La casilla ✅/⬜ a la izquierda sigue sirviendo para mostrar/ocultar su pin. En "⛔ Faltan por ubicar", tócala y (si eres administrador) el mapa entra en modo ubicar — toca el punto donde está y queda ubicada al instante. Si no eres admin, avisa que solo un administrador puede ubicarlas.',
        'Mapa · Camionetas pick-up: no llevan pin fijo porque están en constante movimiento (abarcan TODAS las zonas). En el tipo "🚙 CAMIONETA PICK-UP" se listan como ASIGNADAS, cada una con su ENCARGADO (el del catálogo), placa/serial y empresa. No cuentan como "faltan por ubicar". En el Conteo de equipos también aparecen contadas y con su encargado.',
        'Mapa · Ubicar manualmente (solo administradores): en el panel "📍 Ubicar manualmente (admin)" elige una máquina (las que faltan por ubicar salen primero; cada una muestra su placa/serial y su empresa para no confundirlas) y toca el mapa en el punto donde está; queda ubicada al instante. Al elegirla, el panel muestra la placa/serial y la empresa de la máquina seleccionada. Solo los administradores pueden reubicar máquinas y eliminar ubicaciones del mapa.',
        'Mapa · Reporte "📄 Máquinas por sector (Este / Oeste)": agrupa las máquinas UBICADAS por su SECTOR geográfico (macro 🟢 Este / 🟠 Oeste y su sub-sector, según el GPS de la máquina), con su placa/serial, el EDIFICIO/REFERENCIA que puso el inspector al ubicarla, el inspector asignado y la empresa. Las que NO están en el mapa salen aparte como "⛔ SIN UBICACIÓN (faltan por ubicar)" con su placa/serial.',
        'Mapa · Buscador: la lupa de búsqueda del mapa está LIMITADA a La Guaira (solo encuentra calles, sectores y lugares de la franja costera de La Guaira; lo de otros estados no aparece).',
        'Mapa · Mover sectores (solo administradores): en el panel "🗺️ Sectores (zonas)" prende los sectores que quieras mover; luego, en "🗺️ Mover sectores (admin)" toca Activar. Cada sector muestra un marcador ✋ con su nombre en el centro: arrástralo hasta su lugar y se guarda solo (para todos). Funciona igual en pantalla completa.',
        'Mapa · Zonas: el nombre de cada zona aparece al PASAR EL CURSOR por encima (en computadora) o al TOCAR la zona (en el teléfono); ya no salen todos los nombres a la vez.',
        'Mapa · Monitoreo (solo administradores): el panel "🕵️ Monitoreo · quién ubica" (colapsable, igual que Sectores) muestra QUIÉN colocó cada ubicación, con su fecha y hora. Toca una fila para ver esa máquina en el mapa. Sirve para vigilar quién está haciendo las ubicaciones.',
      ] },
    ],
  },
  {
    icon: '📄',
    title: 'Reportes',
    blocks: [
      { t: 'p', text: 'Genera documentos PDF para imprimir o compartir, eligiendo el rango de fechas y la empresa. Al generarlos se abre una vista previa con los botones 🖨️ Imprimir y Cancelar.' },
      { t: 'bullets', items: [
        '👷 Inspectores: agrupado por inspector, sus máquinas asignadas con estado, horas de día/noche/total y las ubicaciones donde cambiaron de sitio.',
        '📊 Conteo equipos: total de equipos por clasificación/tipo y por empresa, con el reporte "📍 Despliegue de maquinaria" (antes "Ubicaciones tácticas") y el detalle por zona Este/Oeste. Incluye "📍 Despliegue por sector y edificio": agrupa por sector/localidad (Este/Oeste, ej. Caraballeda) con su ref/edificio y cuántos equipos de cada tipo hay en cada sitio (ej. "3 JUMBO"). Las máquinas sin GPS (que no salen en el mapa) van a un grupo "SIN UBICACIÓN" listando su placa/serial. Refleja la ubicación real al momento de generarlo.',
        '🚜 Maquinaria: SOLO maquinaria (ya no incluye vehículos). Lista las máquinas que TRABAJARON en el rango de fechas, cada una con su ficha de catálogo — Máquina, Marca, Modelo, Placa, Serial y Clasificación — y botón "Ver detalle" por fila. Salida en PDF.',
      ] },
      { t: 'note', text: '🧭 Trazabilidad e Historial por Equipo: se abre desde "Ver detalle" en la Trazabilidad de Maquinaria (o eligiendo la máquina a mano). Elige la máquina y un rango de fechas y toca "🔎 Consultar historial": muestra un resumen (días trabajados, horas totales, averías, paradas, tiempo inactivo), la lista de paradas/averías (inicio, fin o "vigente", y su duración) y los días trabajados con sus horas. "📄 Exportar PDF" descarga ese historial.' },
      { t: 'note', text: '🗺️ Zona real por GPS — igual al Mapa (botón en 📊 Conteo de equipos): a diferencia del conteo normal por zona (que reparte 50/50 las máquinas sin GPS para que el total cuadre), este botón genera un PDF que solo cuenta Este/Oeste con la ubicación GPS real de cada máquina (el mismo cálculo que usa la pantalla del Mapa), y lista aparte las máquinas sin GPS en vez de adivinar de qué lado están.' },
    ],
  },
  {
    icon: '👤',
    title: 'Usuarios y roles (solo administrador)',
    blocks: [
      { t: 'p', text: 'Para crear a las personas que usan el sistema y decidir qué puede ver/hacer cada una.' },
      { t: 'bullets', items: [
        'Cada usuario tiene UN rol (Administrador, Supervisor, Operador, Conductor, o uno de los roles personalizados creados en 🏷️ Roles del sistema).',
        'Si te equivocas 3 veces la contraseña, el usuario se BLOQUEA — solo un administrador lo desbloquea desde aquí.',
        'Permisos por módulo: además del rol, a un usuario le puedes dar acceso EXTRA a un módulo puntual (Lectura / Escritura / Full control) desde su ficha, sin cambiarle el rol.',
      ] },
      { t: 'note', text: '✏️ EDICIÓN MASIVA (Usuarios → ✏️ Edición masiva, 21-ago-2026): cambiarle el permiso de un módulo a MUCHAS personas de una sola vez, en vez de entrar y salir de "Editar" una por una. (1) AGRUPAR POR ROL: una pastilla por cada rol que tenga gente, con su cantidad; sin marcar nada = todos. (2) BUSCAR por cualquier dato: nombre, apellido, usuario, cédula, rol, o "bloqueado" — sin distinguir mayúsculas ni acentos. (3) MARCAR uno por uno o "☑️ Marcar los N" (suma a lo ya marcado, así se puede buscar y marcar por tandas). (4) APLICAR: eliges el módulo (lista con buscador) y el nivel (Sin acceso / Lectura / Escritura / Full control) y confirmas. ⚠️ AVISA ANTES DE GUARDAR a quién NO le va a quedar ese nivel, y por qué: los ADMIN siempre tienen full control (a un admin se le cambia el ROL, no el permiso) — y esa es la ÚNICA excepción. ⭐ EL PERMISO DE LA PERSONA LE GANA AL ROL (21-ago-2026): si le quitas el permiso a alguien, se lo quitaste, no importa qué rol tenga. Antes se tomaba el MAYOR entre el rol y el permiso, así que ponerle "Lectura" a alguien cuyo rol daba "Escritura" no le quitaba nada, y para bajar a UNA persona había que bajarle el módulo a TODO el rol (quitándoselo también a los demás con ese rol). Un permiso MAYOR que el rol se sigue aplicando igual que antes; lo nuevo es que ahora también puede bajar. 🗄️ Para que valga también en la BASE DE DATOS hay que correr supabase/permiso_le_gana_al_rol.sql y ENSEGUIDA supabase/permiso_catalogo_corregido.sql (el segundo corrige al primero, que bloqueaba de más). ⚠️ OJO: el permiso de Catálogo manda sobre el CATÁLOGO, no sobre toda la máquina. Sin escritura en Catálogo no se puede CREAR ni BORRAR una máquina, ni cambiar los datos de su FICHA (código, marca, modelo, serial, placa, empresa, clasificación, encargado, precio, fotos, QR bloqueado). Lo que SÍ se sigue pudiendo, si el permiso del módulo que toca lo permite, es OPERARLA: jornadas, cambiar el estado en Control de Maquinaria, horómetro de Mantenimiento, ubicación. La tabla de maquinaria la escriben varios módulos y cerrarla entera dejaba a la gente sin poder trabajar.' },
      { t: 'note', text: 'CATÁLOGO DE ROLES (Usuarios → 🏷️ Roles del sistema): el administrador crea, EDITA (✏️) y borra roles FIJOS. Al crear/editar eliges el TIPO: "📋 Módulos" (un rol fijo que navega por la app normal —pestañas + Más— mostrando SOLO los módulos que le marques) o "📷 Coordinador QR" (panel con escáner). No se puede borrar un rol si tiene usuarios vinculados (te avisa).' },
      { t: 'note', text: 'Roles "📋 Módulos": el usuario ve las pestañas de abajo Inicio y Más SIEMPRE; las pestañas Control, Mapa y Catálogo aparecen solo si su rol tiene ese módulo. En "Más" salen únicamente los módulos permitidos. Así, con solo darle permiso a un módulo (ej. Inspecciones de Maquinaria) ya le aparece —sin configurar nada más.' },
      { t: 'note', text: 'ROL UNIFICADO: cada usuario tiene UN solo rol. En su tarjeta se ve "Rol asignado: X". Al CREAR el usuario eliges el rol en una lista desplegable con TODOS los roles (los del sistema + los personalizados). Al EDITAR, toca "Rol asignado → Cambiar ▾" para cambiarlo. No puedes cambiar tu propio rol.' },
      { t: 'note', text: 'PERMISOS EXTRA POR USUARIO: aunque el usuario tenga un rol, en Editar usuario → "Permisos por módulo" puedes darle acceso ADICIONAL a módulos que su rol no incluye (Lectura / Escritura / Full control, o el atajo "✅ Full a todo"). Lo que marques aquí MANDA sobre lo que da su rol, para arriba y para abajo: sirve tanto para DARLE un módulo que su rol no incluye como para QUITARLE uno que su rol sí le daba, sin tocar el rol y sin afectar a los demás que tienen ese mismo rol. La única excepción son los ADMIN, que siempre tienen full control.' },
      { t: 'note', text: '🧰🔧 Fila nueva "Servicio de maquinaria (averías)": al dividirse el taller en dos secciones, en Permisos por módulo aparece esta fila aparte de "Mantenimiento de maquinaria". Mientras no le pongas un nivel propio, HEREDA el que tenga el usuario en Mantenimiento, así que nadie perdió ni ganó acceso con la división. Pon un nivel distinto solo si quieres que alguien vea una sección y la otra no.' },
      { t: 'note', text: '🎯 ROLES QUE ENTRAN DIRECTO A SU PANTALLA: si a un rol le marcas UN SOLO módulo de esta lista, el usuario NO ve pestañas ni el menú "Más" — al entrar le abre directo la pantalla de su trabajo: 🚛 Registro de viajes (camiones) → Viajes de camiones · 🕐 Asistencia → Control de asistencia · 📦 Inventario → Inventario · ⛽ Combustible → Combustible · 🏭 Kiosco de planta · 🧼 Lavado de maquinaria · 👷 Coordinación de operadores · 🏗️ Obras Públicas. Es para gente cuyo trabajo es una sola cosa repetida (el listero da un toque por cada viaje) — hacerle navegar un menú para eso no tiene sentido. OJO: solo funciona si ese es su ÚNICO módulo activo. Si le agregas otro, vuelve a la navegación normal con pestañas y "Más" — y ahí llega a lo suyo por Más → el módulo.' },
      { t: 'note', text: '🚛 EL LISTERO SOLO VE CAMIONES DISPONIBLES: al buscar el camión para registrar un viaje ya NO le aparecen los RETIRADOS (No operativos) ni los que están ⏳ EN ESPERA DE INSTRUCCIONES. Una máquina en espera está congelada —no se le inicia jornada ni se le surte—, así que mal podría estar haciendo viajes; tenerla en la lista solo se prestaba a registrar el viaje contra el camión equivocado. Los averiados y parados SÍ siguen saliendo (a veces igual hacen un viaje), pero al registrar te pide confirmación. Esto es solo la lista de ESCOGER: los paneles de la jefa (resumen, meta y alertas) siguen viendo la flota completa, y un viaje ya registrado se sigue viendo aunque el camión pase a espera después.' },
      { t: 'note', text: 'Roles tipo COORDINADOR QR (ej. preventivo, correctivo, almacén): al entrar ven un panel con botones grandes para escanear el QR de la máquina y: ⛽ Surtir gasoil, 🛠️ Registrar avería, ✅ Marcar máquina lista (esto cierra las averías pendientes de esa máquina y la vuelve Operativa). El panel también trae Cambiar contraseña, Huella y Salir.' },
    ],
  },
  {
    icon: '📜',
    title: 'Auditoría (bitácora — quién hace qué)',
    blocks: [
      { t: 'note', text: '🚜 ESTADOS DE MÁQUINA — "¿QUIÉN PUSO ESTA MÁQUINA RETIRADA?" (20/08/2026). Debajo del contador de acciones hay una casilla nueva: "🚜 Estados de máquina — quién la retiró, reactivó o puso en espera". Al marcarla la bitácora deja SOLO las acciones que cambiaron el estado de una máquina, y cada una sale con su etiqueta de color y en criollo: ⬛ RETIRADA · ✅ REACTIVADA · ⏳ EN ESPERA · 📥 RECIBIDA · 🗑️ ELIMINADA DEL CATÁLOGO · ♻️ RESTAURADA · 🔒 QR BLOQUEADO · 💥 BORRADA DE LA BASE. Antes eso estaba ahí pero enterrado: la retirada salía como "Fulano modificó Máquina · CARGADOR 01 (6 cambios)" y había que abrir el renglón y leer columna por columna para dar con el "Operativa: sí → no" escondido entre los otros cinco. Arriba sale además el conteo (⬛ Retiradas · 4, ✅ Reactivadas · 1), y todo eso sale igual en el PDF.' },
      { t: 'note', text: '🕘 SIN ADIVINAR LA FECHA. Con "Estados de máquina" marcado se habilita "🕘 Buscar en TODO el historial" aunque no escribas nada en el buscador — nadie se acuerda del día en que retiraron una máquina, que es justamente lo que se viene a preguntar. Se puede porque con ese filtro la consulta se acota a las máquinas y vehículos: la pantalla le pide MENOS a la base de datos, no más.' },
      { t: 'note', text: '📋 TODA LA INFORMACIÓN, AL TOCAR EL RENGLÓN. El detalle de una acción sobre una máquina ahora trae, además del antes/después campo por campo, la FICHA de la máquina como está ahora mismo: máquina con su placa/serial, identificador, clase y marca, empresa, encargado, zona/referencia, el estado actual, si el QR está bloqueado, el horómetro, y "Retirada por / Retirada el" y "Reactivada por / Reactivada el". Esos dos últimos los guarda la propia ficha de la máquina aparte de la bitácora: sirven aunque el retiro sea anterior a que se encendiera el seguimiento (18/08/2026).' },
      { t: 'note', text: '⚠️ "Averiada" y "parada" NO salen en este filtro, a propósito: esos dos no son un campo de la máquina, se deducen en vivo de las averías y de las jornadas. Quién marcó una avería se ve en el módulo de Mantenimiento / Averías.' },
      { t: 'note', text: '🗂️ AGRUPAR POR MÓDULO, A LA VISTA (20/08/2026). La fila "AGRUPAR POR:" quedó en la pantalla principal, debajo del contador de acciones: Sin agrupar · 🗂️ Módulo · 👤 Usuario · 📅 Día, de un solo toque. Antes había que entrar al menú 🔽 Filtros → Agrupar y casi nadie lo encontraba; es el mismo ajuste, los dos lugares quedan sincronizados. Al elegir 🗂️ Módulo sale además una fila de TOTALES POR MÓDULO arriba de la lista (⛽ Combustible · 14, 👷 Nómina y personal · 7…), para ver dónde se movió más sin abrir cada grupo. Y ahora agrupa COMPLETO: había once tablas auditadas sin módulo asignado que caían todas en "📁 Otro" — viajes de camiones, movimientos de combustible, períodos de nómina, proveedores, Obras Públicas y avisos del sistema — o sea que medio sistema se veía como "Otro". Ya están repartidas, y se agregaron al filtro los módulos 🚛 Viajes de camiones, 🏗️ Obras Públicas y 🔔 Avisos del sistema.' },
      { t: 'p', text: 'Registra quién hizo cada acción importante en el sistema (asignar una máquina, cerrar un control, editar un pago, reactivar/inactivar un equipo…), con fecha, hora y quién fue.' },
      { t: 'note', text: 'Sirve para resolver dudas tipo "¿quién cambió esto?" sin tener que preguntarle a cada persona — el registro no se puede borrar ni editar.' },
      { t: 'note', text: 'Historial COMPLETO de una máquina, inspector o usuario: escribe en el buscador el código de la máquina, el nombre de la persona o lo que necesites, y activa "🕘 Buscar en TODO el historial (ignora el rango de fechas)" debajo. Trae todo lo que le haya pasado desde siempre, sin tener que adivinar la fecha.' },
      { t: 'note', text: 'Buscar por cualquier característica: placa, serial, cédula, encargado, modelo o clasificación — no hace falta que el nombre exacto esté escrito en la bitácora.' },
      { t: 'note', text: '🚜 Retiros y "en espera" (18/08/2026): antes NO se veía quién retiraba una máquina ni quién la ponía o la sacaba de "en espera". El interruptor de "en espera" se cambia desde cinco pantallas (Equipos, Control de Maquinaria al sacar y al reingresar, el panel QR del Coordinador, y Mantenimiento al cerrar una reparación) y ninguna dejaba rastro. Lo de "retirar" sí se guardaba, pero en la ficha de la máquina dentro de Equipos —no acá— y solo la ÚLTIMA vez: se sobrescribe. Ya quedó arreglado: cada retiro, reactivación y cambio de "en espera" se registra con quién, cuándo y el antes/después.' },
      { t: 'note', text: '📖 Los cambios se leen en cristiano: donde antes decía "en_espera: false → true" ahora dice "En espera: no → sí", "Activa: sí → no", "Fecha de salida: ∅ → 18/08/2026". Y el cambio se ve en la propia LISTA, sin abrir renglón por renglón — si fueron más de dos campos se muestran los dos primeros y un "+N más". Vale igual para el PDF.' },
      { t: 'note', text: '⚠️ Dos límites: (1) NO recupera el pasado — lo que se hizo antes de encenderlo no quedó registrado y no se puede reconstruir; sirve de aquí en adelante. (2) Las JORNADAS siguen sin registrarse: ese vigilante se apagó el 09/08/2026 porque el sistema se caía (los automatismos escriben esa tabla cada 10 minutos por cada una de las ~173 máquinas, entre 15 y 20 mil renglones al día). Mientras siga apagado, ningún cambio de horas de jornada deja rastro. Pendiente de decisión.' },
      { t: 'note', text: 'Más contexto en "a qué se le hizo": ahora también reconoce por nombre (no solo por ID) los pagos de empresa, los ingresos de combustible (proveedor), los traslados por vehículo/placa y los movimientos de tanque. Las fechas dentro del detalle de "qué cambió" (antes → después) se muestran legibles y con hora, no en formato crudo. El cierre de sesión (🚪 cerró sesión) también queda registrado ahora — antes no.' },
      { t: 'note', text: '🔽 Filtros avanzados: junto al buscador hay un botón "🔽 Filtros" con 3 pestañas. FILTRAR: accesos rápidos (Hoy, Esta semana, Solo eliminaciones, Solo cambios de dinero) más selección múltiple de MÓDULO (Combustible, Maquinaria y flota, Inspecciones y jornadas, Nómina y personal, Empresas y facturación, Inventario y compras, Alimentación, Usuarios y permisos) y tipo de acción. AGRUPAR POR: Módulo / Usuario / Día, con encabezados plegables. FAVORITOS: guarda la combinación actual de filtros con un nombre para reaplicarla luego con un toque (queda guardada en este dispositivo, no se comparte entre usuarios). El PDF de auditoría ahora también indica qué filtros estaban activos cuando se generó.' },
      { t: 'note', text: 'PDF con toda la información: trae un resumen (creaciones/modificaciones/eliminaciones/eventos) y, en cada acción, el detalle completo — si fue una modificación, cada campo que cambió (antes → después).' },
    ],
  },
  {
    icon: '🏢',
    title: 'Empresas',
    blocks: [
      { t: 'p', text: 'Lista de las empresas/contratistas que usan el sistema (dueñas de máquinas, personal, etc.).' },
      { t: 'bullets', items: [
        '🚫 Ocultar: desactiva la empresa en TODO el sistema (no sale en ningún selector, lista ni reporte).',
        '🍽️ Solo comidas: la empresa aparece ÚNICAMENTE en Distribución de comida y en ningún otro lado.',
      ] },
    ],
  },
  {
    icon: '🏭',
    title: 'Fabricación (MRP)',
    blocks: [
      { t: 'p', text: 'Módulo aparte para el taller de mangueras hidráulicas y manufactura: maestros de producción, centros de trabajo, recetas (BoM), rutas, Órdenes de Fabricación (MO) y de Trabajo (WO), el kiosco de planta y sus propios reportes.' },
      { t: 'note', text: 'Cuenta por cobrar de mangueras: cada manguera pide Empresa a cobrar + Encargado + Margen % (default 30). Empresa y Encargado son LISTAS PROPIAS de mangueras (agregar una nueva NO la mete en el catálogo de Empresas ni en el resto del sistema). Al guardar genera sola una CUENTA POR COBRAR a esa empresa por costo + margen (visible en Compras → 💰 Por cobrar), y un botón "🧾 Recibo de cobro" (PDF). Desde el 23-ago-2026 TODOS los encargados generan cuenta por cobrar (antes CHELI no la generaba; ahora sí). Aparte, sigue creando la cuenta POR PAGAR al proveedor.' },
      { t: 'note', text: 'Ficha de la máquina en el Recibo de cobro: si la manguera está enlazada a una máquina de la FLOTA, el PDF trae debajo del monto a cobrar la ficha de la máquina con su FOTO — la misma de Servicio de maquinaria (tipo, marca, modelo, serial, placa, identificador, empresa y encargado). Va en la misma hoja: el recibo sigue siendo de una página. Las mangueras EXTERNAS (y las de una máquina que no se pudo cargar) salen igual que siempre, sin ficha — el recibo nunca se deja de generar por eso.' },
      { t: 'note', text: 'Aprobación desde Compras: todas las mangueras pendientes salen también en Compras → pestaña 🔧 Mangueras, para que el gerente apruebe el pago (si está instalada) sin entrar al módulo de Mangueras.' },
      { t: 'note', text: 'Eliminar una manguera NO aprobada: mientras no esté aprobada/pagada, su tarjeta muestra "🗑️ Eliminar" (tanto en Mangueras como en Compras → 🔧 Mangueras). Pide confirmación y borra también la cuenta pendiente asociada, para no dejarla huérfana. Una vez aprobada/pagada el botón desaparece: ese registro ya no se puede borrar (queda como constancia contable).' },
      { t: 'note', text: 'Editar una manguera YA aprobada: se puede corregir con ✏️ Editar incluso después de aprobada/pagada. Al guardar, su estatus pasa a "✏️ Modificada y aprobada" (sigue contando como aprobada, pero deja constancia de que se cambió). El estado de instalación queda bloqueado y la cuenta por pagar sigue saldada; solo se re-sincroniza el monto si cambió el costo. Requiere correr una vez supabase/mangueras_modificada_aprobada.sql.' },
      { t: 'note', text: 'Es un módulo grande e independiente del resto del sistema — descarga su guía propia en "Más → Manual → Guías descargables → 🏭 Fabricación (MRP)" para el paso a paso completo.' },
    ],
  },
  {
    icon: '🚛',
    title: 'Acarreo / Transporte',
    blocks: [
      { t: 'p', text: 'Módulo para trasladar maquinaria en chutos y bateas/lowboys: desde el registro de la flota y los choferes hasta la orden de acarreo, la ejecución del viaje (check-in/out con fotos y firma) y el control de costos. Se entra por Más → Acarreo / Transporte.' },
      { t: 'p', text: 'Datos maestros (lo primero que se carga):' },
      { t: 'bullets', items: [
        '🚛 Chutos: los camiones de arrastre — placa, capacidad de arrastre, kilometraje y estado. Avisa cuántos km faltan para el mantenimiento.',
        '🛻 Bateas / lowboys: los remolques — tipo, ejes, capacidad de carga (toneladas) y dimensiones útiles.',
        '👷 Choferes: nombre, teléfono, licencia con su vigencia y disponibilidad (disponible, en ruta, de reposo, suspendido). Avisa si la licencia está vencida.',
        '🚜 Equipos a trasladar: se toma la máquina del Catálogo y se le carga su peso y dimensiones (sirven para validar que no supere la carga del remolque).',
        '🏢 Clientes y proyectos: emisor y receptor. Los EXTERNOS (a los que se factura) usan tarifario; los internos solo controlan costos.',
        '📍 Ubicaciones: obras, almacenes, talleres, minas y pozos de origen/destino.',
        '📄 Documentos y vencimientos: permisos de carga pesada, pólizas, revisiones técnicas y licencias — con su fecha de vencimiento (dispara alertas).',
      ] },
      { t: 'p', text: '📋 Órdenes de acarreo: cada viaje. Eliges origen y destino, el chuto + remolque + chofer y los equipos a trasladar. Al guardar, el sistema VALIDA solo:' },
      { t: 'bullets', items: [
        'Peso: si la suma del peso de los equipos supera la capacidad del remolque (o el arrastre del chuto), avisa (muestra el total vs. la capacidad en vivo).',
        'Vencimientos: si la licencia del chofer o algún documento del chuto/remolque están vencidos.',
        'Solapamiento: si el chofer, el chuto o el remolque ya tienen otro viaje en esa misma ventana de fechas.',
      ] },
      { t: 'note', text: 'Las alertas son bloqueo SUAVE: avisan y, si de verdad hace falta, un administrador puede "forzar" el guardado. Los avisos amarillos (vencimientos/solapamiento) no bloquean.' },
      { t: 'p', text: 'Estados del viaje: Programado → En carga → En tránsito → En descarga → Completado (o Cancelado con motivo). Desde el detalle de la orden se avanza el estado y todo queda en la bitácora.' },
      { t: 'p', text: '🚚 Ejecución del viaje (desde el detalle de la orden, según el estado):' },
      { t: 'bullets', items: [
        '📦 En carga → Check-in de salida: nivel de combustible, cauchos y fajas de amarre OK, observaciones y fotos "antes"/"amarre". Al guardar, pasa a EN TRÁNSITO.',
        '🚚 En tránsito: registrar incidencias en ruta (mecánica, clima, permiso, alcabala). Botón "Llegó" → EN DESCARGA.',
        '📥 En descarga → Check-out de recepción: estado a la llegada, fotos "después" y FIRMA (nombre de quien recibe + foto). Al confirmar, la orden queda COMPLETADA.',
      ] },
      { t: 'p', text: '💵 Costos del viaje (en el detalle de la orden): registra gastos de combustible (con litros → rendimiento km/L), viáticos de comida/hospedaje (con foto del comprobante), peajes y otros. Muestra el total, los viáticos otorgados vs. comprobados y el rendimiento. 🧾 Tarifario (Acarreo → Financiero): precios por km, tonelada, hora o tarifa plana (general o por cliente/ruta); para los clientes EXTERNOS, la orden calcula sola la valorización sugerida y la puedes guardar.' },
      { t: 'p', text: '📄 Documentos PDF (en el detalle de la orden): Guía de traslado (para el chofer), Acta de recepción (con fotos y firma) y Liquidación del viaje (resumen financiero). Desde la lista de órdenes, el botón "📄 Consolidado" descarga el resumen de los acarreos según el filtro elegido. 📊 Panel (Acarreo → Operación): KPIs (acarreos, tiempo promedio de tránsito, % a tiempo, costo por km) y ALERTAS de documentos/licencias vencidos o por vencer, mantenimiento de unidades por km y viajes retrasados en ruta.' },
      { t: 'note', text: 'El acceso es por usuario: un administrador lo habilita en Usuarios (módulo "Acarreo / Transporte"). Todo se busca por sus características y las listas salen en orden natural A→Z.' },
    ],
  },
  {
    icon: '🚛',
    title: 'Registro de viajes (camiones)',
    blocks: [
      { t: 'p', text: 'Bitácora de los viajes de los camiones de volteo y chutos con volqueta. El LISTERO registra cada viaje con un toque desde el campo (funciona sin señal); la JEFA/administración ve el panel completo con el resumen, las metas, la alerta de camiones sin viaje y el reporte. Se entra por Más → 🚛 Viajes de camiones.' },
      { t: 'p', text: 'Filtros de la lista completa (panel de la jefa): por EMPRESA, por CAMIÓN, por LISTERO y por rango de fecha (Hoy / Esta semana / Este mes / Rango libre / Días específicos). "✕ Limpiar filtros" borra los tres de un toque.' },
      { t: 'note', text: '🚚 UN CAMIÓN QUE NO ESTÁ EN LA LISTA (21/08/2026). Cuando el listero busca su camión y no lo encuentra, ahora tiene DOS salidas, en este orden. (1) SÍ ESTÁ EN EL CATÁLOGO PERO NO EN SU LISTA: al escribir en el buscador, debajo de los resultados sale una sección "No están en tu lista, pero sí en el catálogo" con borde punteado azul. Tócala y ese camión se AGREGA A SU LISTA para poder registrarle viajes. Esto pasa porque la lista del listero se arma mirando si el código dice "volteo", "volqueta" o "toronto": un camión real con otro código nunca entraba, aunque estuviera cargado. Agregarlo NO cambia nada en el catálogo. (2) NO ESTÁ EN NINGÚN LADO: al final del buscador está el botón "🚚 El camión no está en la lista". Ahí escribes cómo se identifica (obligatorio) y su placa, empresa o seña (opcional), y registras el viaje. ESE CAMIÓN SE GUARDA SOLO EN ESE VIAJE: no se crea en el catálogo, no aparece en Control de Maquinaria, ni en Mantenimiento, ni en los reportes de flota, ni le llega a los inspectores.' },
      { t: 'note', text: '🚚 CÓMO LO VE QUIEN SUPERVISA. Los viajes de camiones anotados a mano salen SIEMPRE marcados: con el ícono 🚚 en vez de 🚜, una etiqueta "🚚 fuera de catálogo" al lado, y donde iría la placa dice "Anotado a mano por el listero" con la seña que escribió. En el PDF del reporte, la columna de placa dice "⚠️ FUERA DE CATÁLOGO" con esa misma seña. Es a propósito: un viaje contra un camión anotado a mano NO se puede confundir con uno de la flota a la hora de revisar o de cobrar. En el resumen por camión, cada camión anotado a mano se cuenta APARTE por su nombre — dos camiones distintos no se suman como si fueran uno. Como no tienen ficha, caen bajo "Sin empresa": no se les inventa una. Y no entran a la alerta de "camión sin viaje reciente", porque un camión prestado que se anotó una vez no está parado, simplemente ya no está.' },
      { t: 'note', text: '⬛ LAS RETIRADAS NO SE LE MUESTRAN AL LISTERO (18/08/2026, sigue vigente). Al buscar un camión para registrar, NO salen las RETIRADAS (fuera de servicio) ni las que están EN ESPERA de instrucciones — tampoco por la vía nueva de "sí está en el catálogo". Una máquina retirada o en espera no puede estar haciendo viajes, y tenerla en la lista solo se presta a registrar el viaje contra el camión equivocado. La jefa sí las sigue viendo en sus paneles (resumen, metas, alertas), que necesitan la flota completa.' },
      { t: 'note', text: '🏢 FILTRO POR EMPRESA (20/08/2026). Arriba de los filtros de camión y listero hay una fila EMPRESA con un chip por cada empresa que tenga viajes en el rango, con su cantidad al lado. La empresa NO se carga en cada viaje: sale del CAMIÓN, o sea la que tiene asignada en el catálogo de maquinaria. Los camiones sin empresa asignada se agrupan en "Sin empresa".' },
      { t: 'p', text: 'VISTA Y REPORTE — dos formas de ver y de imprimir lo mismo:' },
      { t: 'bullets', items: [
        '📋 Detallado (viaje por viaje): como siempre, una línea por cada viaje. El PDF ahora trae además la EMPRESA y la PLACA / SERIAL en cada línea.',
        '📊 Resumido (viajes por camión): NO desglosa viaje por viaje. Muestra el TOTAL GENERAL de viajes y cuántos camiones lo hicieron; por cada empresa, su total de viajes y su cantidad de camiones; y dentro de cada empresa, el desglose por camión (código, placa/serial y cuántos viajes hizo), de mayor a menor.',
      ] },
      { t: 'note', text: 'Sirve para las tres cosas que se piden a diario: UN camión (márcalo y te dice cuántos viajes hizo), VARIOS camiones (marca los que quieras y cada uno sale con su cantidad), o UNA EMPRESA COMPLETA (márcala y salen todos sus camiones, el número global de la empresa y el desglose de cada uno).' },
      { t: 'note', text: 'El modo elegido manda tanto en la pantalla como en el PDF, y el reporte imprime en su encabezado los filtros con los que se sacó (empresas, camiones, listeros) para poder auditarlo después sin adivinar. El total de cada empresa SIEMPRE cuadra con la suma de su desglose y con el total general.' },
      { t: 'note', text: '👤 AGRUPAR POR LISTERO (22/08/2026). Al elegir "📊 Resumido" aparece debajo una segunda fila, AGRUPAR POR, con dos botones: 🏢 Empresa (como venía funcionando) y 👤 Listero. Con "Listero", el mismo reporte sale partido por QUIEN REGISTRÓ: cada listero con su total de viajes y, debajo, el desglose de los camiones que él trabajó. AGRUPAR NO FILTRA: cambiar el eje no saca ni agrega ni un solo viaje, el TOTAL GENERAL es idéntico en los dos modos — es lo único que garantiza que dos reportes del mismo día cuadren entre sí, y está fijado con prueba automática. El conteo de camiones del encabezado cuenta camiones DISTINTOS: si un mismo camión lo trabajaron dos listeros, aparece en los dos grupos pero se cuenta una sola vez.' },
      { t: 'note', text: '🛡️ QUE NO SE PIERDA NINGÚN VIAJE (22/08/2026). Se corrigieron varios fallos que hacían perder o dejar de mostrar viajes. (1) EL GRAVE: si el teléfono creía tener conexión pero el envío fallaba —wifi del patio con señal pero sin internet, sesión vencida, servidor lento— el viaje SE DESCARTABA con un aviso que se iba en 3 segundos. Ahora se guarda en el teléfono igual que si no hubiera señal y se reintenta solo; lo único que no se encola es cuando el servidor avisa que ese viaje YA estaba registrado, porque encolarlo lo duplicaría. (2) Registrar un viaje MIENTRAS la cola se estaba subiendo borraba el viaje nuevo del teléfono, para siempre. (3) Los listados no paginaban: en rangos largos se cortaban en 1000 viajes y se comían los MÁS VIEJOS sin avisar. (4) Un viaje registrado en el último segundo del día no caía en ningún día. (5) Ahora el intento con señal lleva la misma llave de idempotencia que el reintento, así que un envío que sí entró y perdió la respuesta ya no puede duplicarse.' },
      { t: 'note', text: '🛡️ Y LOS MENSAJES QUE MENTÍAN. Si la consulta fallaba, la pantalla decía "Todavía no registras viajes hoy" — y el listero volvía a registrar todo, duplicando. Ahora dice que no se pudo leer, con el motivo EN CASTELLANO, y aclara que los viajes no se perdieron. Igual en el panel de la jefa: un fallo de lectura ya no se ve como "sin viajes registrados hoy" ni deja la alerta diciendo "todos los camiones al día", y si la lista no cargó bien NO SE PUEDE EXPORTAR el reporte, porque saldría incompleto y se cobra por viaje. También se corrigió el aviso "Listo, no quedan viajes apartados", que salía en verde aunque no se hubiera subido nada.' },
      { t: 'note', text: '👤 DOS COSAS QUE HAY QUE SABER ANTES DE RECLAMAR UN FALTANTE. (1) DOS CUENTAS = DOS LISTEROS: el reporte agrupa por la CUENTA de usuario, no por el nombre escrito. Si una misma persona tiene un usuario viejo y uno nuevo, sale en DOS renglones aunque se llame igual — y está bien: el sistema no puede adivinar que dos cuentas son la misma persona. (2) EL CORTE ES POR JORNADA (corregido el 22/08/2026): en este módulo el "día" va de las 7 de la mañana a las 7 de la mañana del día siguiente — turno de día (7am-7pm) más turno de noche (7pm-7am) — porque los dos juntos son UN día de trabajo, que es como se cuenta y se paga. Antes cortaba a medianoche y eso partía la noche en dos fechas: un listero que trabajó una sola noche veía 4 viajes en un día y 3 en el siguiente. ESE ERA EL RECLAMO DE "registré 7 y el sistema muestra 4". Ahora marcas un día y salen los 7. Vale para todo el módulo: Mis viajes de hoy, el Resumen de hoy de la jefa, los filtros de día y el PDF, que lo dice en su encabezado. De madrugada "hoy" sigue siendo la jornada que arrancó AYER a las 7am, que es lo correcto: a las 3am el listero está en medio de su turno, no en uno nuevo. Y corregir la hora de un viaje puede MOVERLO de jornada si cruza las 7am: el sistema avisa antes de guardar. El nombre que sale es el que tenía cuando registró el viaje, no el de hoy; si se lo corrigieron después, el reporte los junta igual (agrupa por cuenta) y rotula el grupo con la forma más usada.' },
    ],
  },
  {
    icon: '⚙️',
    title: 'Ajustes',
    blocks: [
      { t: 'p', text: 'Se llega desde Más → Ajustes. La apariencia (modo oscuro/claro) y la seguridad (contraseña, huella/Face ID) viven en la tuerca ⚙️ del encabezado, no aquí.' },
      { t: 'p', text: 'En la tuerca ⚙️, arriba a la derecha, se muestra CON QUÉ CUENTA estás dentro: tu nombre y, debajo, tu 👤 usuario de inicio de sesión. Sirve para saber de un vistazo con quién quedó abierta la sesión, sobre todo en las computadoras o teléfonos que usan varias personas.' },
      { t: 'bullets', items: [
        'Cerrar sesión.',
        '⬇️ Descargar backup (solo administradores puntuales, en computadora): descarga un archivo con TODOS los datos del sistema, por si hace falta un respaldo manual. Acceso restringido a las cuentas designadas.',
      ] },
    ],
  },
  {
    icon: '🔔',
    title: 'Notificaciones (la campana)',
    blocks: [
      { t: 'p', text: 'Arriba a la derecha, junto a la fecha y hora, aparece una campana 🔔 (solo para el administrador). Avisa de lo que va pasando en el sistema sin tener que estar revisando cada módulo.' },
      { t: 'bullets', items: [
        '📝 Inventario: cuando alguien monta un requerimiento, te llega el aviso.',
        '🛒 Compras: cuando se crea una solicitud de compra.',
        '🛠️ Control: cuando se guarda un cierre de control (con el rango de fechas y cuántas máquinas).',
        'El número rojo sobre la campana es la cantidad SIN leer. Toca la campana para ver la lista.',
        'Toca un aviso para marcarlo leído e ir directo al módulo. También hay "Marcar todo leído".',
        'Cada quien tiene sus propios "leídos": que un admin lo lea no lo marca leído para otro.',
        'Se actualiza sola en línea: no hace falta refrescar.',
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
  const [guideBusy, setGuideBusy] = useState<string | null>(null);
  const [guidesOpen, setGuidesOpen] = useState(false);

  const downloadGuide = async (g: (typeof ROLE_GUIDES)[number]) => {
    if (guideBusy) return;
    setGuideBusy(g.key);
    try { await g.run(); } finally { setGuideBusy(null); }
  };

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

      {/* Guías rápidas descargables (PDF): una por rol, con mockups de pantalla,
          para imprimir/enviar a quien trabaja desde el teléfono. */}
      <Card>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setGuidesOpen((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
        >
          <Text style={{ fontSize: 20 }}>📄</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>Guías descargables</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Un PDF corto por rol, con los pasos exactos de la aplicación</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 16 }}>{guidesOpen ? '▾' : '▸'}</Text>
        </TouchableOpacity>
        {guidesOpen ? (
          <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs }}>
            {ROLE_GUIDES.map((g) => {
              const busy = guideBusy === g.key;
              return (
                <TouchableOpacity
                  key={g.key}
                  onPress={() => downloadGuide(g)}
                  disabled={busy}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, opacity: busy ? 0.6 : 1 }}
                >
                  <Text style={{ fontSize: 20 }}>{g.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>{g.label}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>{g.desc}</Text>
                  </View>
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{busy ? 'Generando…' : '📄 Descargar'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </Card>

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
