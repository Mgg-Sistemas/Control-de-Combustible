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
        'Escribe tu cédula y tu contraseña.',
        'Si quieres revisar que la clave esté bien escrita, toca el ícono de ojo 👁️ dentro del campo de contraseña para mostrarla u ocultarla.',
        'Toca el botón Entrar.',
        'Si el teléfono te lo pide, la próxima vez puedes entrar con tu huella o tu cara.',
      ] },
      { t: 'note', text: '¿Olvidaste la contraseña? Toca "¿Olvidaste tu contraseña?" y sigue lo que llega a tu correo.' },
      { t: 'note', text: 'Cambiar tu contraseña (todos los usuarios): ya dentro del sistema puedes cambiar tu clave cuando quieras. Administrador: en "Más" → sección Seguridad → "🔑 Cambiar mi contraseña". Operador, Supervisor y Cocina: el botón "🔑 Contraseña" arriba, junto a "Salir". Escribe la nueva clave (mínimo 6 caracteres), repítela y guarda. La próxima vez entras con la nueva.' },
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
      { t: 'note', text: 'La hoja del QR muestra el NOMBRE de la máquina y su SERIAL (o placa) — no la empresa.' },
      { t: 'note', text: 'QR sellado con el serial: el QR queda amarrado al serial de la máquina. Si cambias el serial, el QR impreso con el serial anterior DEJA DE FUNCIONAR (al escanearlo solo sale el logo). Reimprime el QR para activarlo con el nuevo serial. Los QR impresos antes de esta versión no llevan sello y siguen funcionando hasta que los reimprimas.' },
      { t: 'note', text: 'Bloquear QR: dentro del 🔳 QR de cada máquina hay un botón "🚫 Bloquear QR". Al bloquearlo, cualquiera que escanee ese QR solo verá el logo (no puede registrar nada). Sirve para matar un QR viejo o robado sin tocar el serial. Con "✅ Desbloquear QR" vuelve a funcionar.' },
      { t: 'note', text: 'Restricción por empresa: un operador SOLO puede usar equipos de SU empresa. Si un operador escanea el QR de una máquina de otra empresa e intenta identificarse, el sistema lo bloquea con un aviso ("Este equipo es de X, solo puedes usar equipos de tu empresa") y no lo deja iniciar jornada ni registrar nada. El supervisor NO tiene esta restricción: puede escanear cualquier máquina y marcarla Operativa/No (check-in de supervisión).' },
      { t: 'p', text: '🪖 Supervisor: cada máquina tiene un botón para asignar quién la custodia (Supervisor Empresa o Militar). Al escribir el nombre aparece una lista con los ya usados para elegirlo rápido. Cambiar de supervisor deja el anterior en el historial.' },
      { t: 'note', text: 'Editar o borrar supervisores: en ese mismo botón toca "⚙️ Editar / borrar supervisores". Ahí puedes ✎ renombrar un supervisor (se corrige en TODOS sus registros) o 🗑 borrarlo por completo (las máquinas que custodiaba quedan sin supervisor).' },
      { t: 'note', text: 'Desde el Inicio (dashboard), en "Estado de las máquinas" puedes tocar Operativas, En espera o No operativa: te lleva a Equipos y te muestra esa lista de máquinas.' },
      { t: 'note', text: 'Máquinas INACTIVAS (No operativa): al marcar una máquina como No operativa (⛔), SALE del catálogo y de la lista semanal de Control de maquinaria; solo aparece en la tarjeta "🔴 Maquinaria inactiva". Sus horas ya trabajadas NO se borran (siguen en los reportes). Al volverla ✅ Operativa, regresa al catálogo y al control. Los detalles de "inactiva" y "en espera" salen agrupados por empresa, desplegables y colapsables, igual que el catálogo.' },
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
      { t: 'note', text: 'Rol ANALISTA: solo puede INGRESAR horas nuevas (día/noche, parada y extra), NO modificar las ya cargadas. Cuando un valor ya está cargado le sale un 🔒 y no lo puede cambiar; si hay que corregirlo, lo hace un administrador. Tampoco puede cambiar precios.' },
      { t: 'note', text: 'Lo cerrado SIGUE viéndose en el Control al navegar por semanas (marcado con 🔒 cerrado) y se puede seguir editando (por ejemplo, agregar días que faltaron). Ya no desaparece de la pantalla al cerrar.' },
      { t: 'note', text: 'Si editas una jornada que ya está CERRADA (🔒) desde el Control, el cambio se SINCRONIZA solo con el histórico: el reporte cerrado y el Histórico se actualizan en el acto (sin tener que reabrir el cierre). Si dejas la jornada en 0, esa fila sale del cierre.' },
      { t: 'note', text: 'El Informe por jornada (Reportes) es EN VIVO: mientras lo tienes abierto, si alguien agrega o edita una jornada (o un flete), el informe se actualiza solo con los mismos filtros —sin tener que volver a generarlo—. Lo indica un punto verde "En vivo".' },
      { t: 'note', text: 'Si necesitas corregir un cierre ya guardado: abre el 🗂️ Histórico, entra al cierre y toca "♻️ Reabrir cierre". Sus registros vuelven al control activo (semana de ese cierre) para editarlos y el cierre sale del histórico. Cuando termines de corregir, vuelve a cerrar el control (se congela el precio de nuevo).' },
      { t: 'note', text: 'Al cerrar un corte, el sistema CONGELA el precio de cada máquina de ese corte. Así, aunque en el siguiente corte suba o baje el precio de una máquina, el corte cerrado sigue mostrando su total original (en el reporte y en el Histórico). Los cortes abiertos usan el precio actual.' },
      { t: 'note', text: 'Para ver un reporte: toca 📊 Ver reporte, elige el rango de fechas y la empresa. Se abre una ventana con la vista previa del documento y dos botones: 🖨️ Imprimir y Cancelar. Toca Imprimir para mandarlo a la impresora o guardarlo como PDF.' },
      { t: 'note', text: 'El PDF de una empresa se guarda con su nombre y el rango, por ejemplo "Reporte Ferreconstrucciones del 06 al 12". Si al guardar/imprimir el encabezado azul se ve gris, activa la opción "Gráficos de fondo" (Background graphics) en el diálogo de impresión.' },
      { t: 'note', text: 'Conteo de equipos: en Reportes, la pestaña 📊 Conteo equipos. Cuenta TODAS las máquinas activas (el total es como siempre) por clasificación y por tipo. Aparte, INDICA las zonas: en el reporte TODOS los equipos quedan ubicados en solo dos grupos, "Este" y "Oeste". Los que marcan GPS toman su lado real; los que AÚN no marcan GPS se reparten 50/50 entre Este y Oeste (solo en el reporte, SIN tocar el mapa). Al tocar Este u Oeste, las tablas se recalculan con ese lado. "A disposición de" indica cuántas están a disposición de Gobernación/FANB/CVM… (cuenta todas, con o sin ubicación) y en qué sector (Este/Oeste) las ubicadas. "Por tipo y zona" muestra, para cada tipo, cuántas hay en cada zona (Este/Oeste). El botón "🗺️ Ver en mapa" abre el mapa de calles con las zonas y los puntos: OJO, el mapa solo muestra los ubicados por GPS de verdad (el reparto 50/50 es solo del reporte, no del mapa). Las tarjetas de arriba muestran el estado de la flota. Se actualiza solo al cambiar una máquina y se descarga en PDF. La "A disposición de" se asigna en el catálogo de Equipos.' },
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
      { t: 'note', text: 'El reporte respeta todo lo que estás viendo (estado + cargos marcados + búsqueda): imprime exactamente esa selección.' },
      { t: 'note', text: 'Ficha del trabajador (toca 🪪 Ficha en un empleado, o escanea su carnet): abajo hay dos botones. 📄 Ficha completa (PDF) descarga TODOS los datos por secciones (identificación, datos laborales, contacto, emergencia, banco y tallas). 🖼️ Carnet (imagen) descarga el carnet 54×86 mm. Lo mismo aplica a los Aliados (su PDF es la ficha completa; la imagen es el carnet).' },
    ],
  },
  {
    icon: '🗂️',
    title: 'Organigrama (dentro de Nómina)',
    blocks: [
      { t: 'p', text: 'Muestra la estructura de la empresa POR CARGOS (no por nombres). Está dentro de Nómina: abre 🗂️ Organigrama.' },
      { t: 'steps', items: [
        'Toca "👁️ Vista previa" para ver el organigrama con el logo de la empresa; desde ahí lo guardas o imprimes como PDF.',
        'Toca "🖼️ Descargar imagen (PNG)" para bajarlo como imagen.',
        'Se SINCRONIZA con la nómina: si en Empleados hay cargos que todavía no están ubicados en el organigrama, aparecen en una caja "🆕 Otros cargos (por ubicar)" para que no se pierdan. Dile al administrador del sistema bajo qué jefatura va cada uno y se agregan a la estructura.',
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
        'Toca un empleado: se abre para cargar su 👕 talla de camisa, 👖 talla de pantalón y 👟 talla de zapatos. Guarda.',
        'Las tallas quedan en la ficha del empleado (se ven como etiquetas en cada tarjeta).',
        'En ese mismo empleado, sección 📦 Registrar entrega: escribe cuántas 👕 camisas, 👖 pantalones y 👟 zapatos le entregas AHORA y toca "📦 Registrar entrega". La fecha y la hora se guardan solas. Puedes registrar varias entregas: se acumulan y ves el total entregado y el historial (con fecha y hora de cada una).',
        'Cada tarjeta muestra un badge 📦 Entregado con el total de prendas que ha recibido esa persona.',
        'Toca "⬇️ Listado (tallas)": genera un PDF con todos los empleados mostrados, sus tallas y una columna de FIRMA (Recibido / Entregado) para firmar al recibir el uniforme.',
        'Toca "📦 Reporte de entregas": genera un PDF por persona con CADA entrega (su fecha y hora) y el total de camisas, pantalones y zapatos entregados.',
        'Al final del listado de tallas (en pantalla y en el PDF) sale un 📊 Resumen por tallas: cuántas camisas de cada talla (M, S, L…), y lo mismo para pantalones y botas de seguridad. Sirve para saber cuántas piezas de cada talla pedir.',
      ] },
      { t: 'note', text: 'Los PDF respetan el filtro y la búsqueda: incluyen exactamente los empleados que estás viendo. Las TALLAS son el número de talla de cada prenda; las ENTREGAS son cuántas piezas se le han dado (con su fecha y hora).' },
    ],
  },
  {
    icon: '💵',
    title: 'Control de pago a personal (dentro de Nómina)',
    blocks: [
      { t: 'p', text: 'Sirve para calcular y pagar al personal por PRECIO por hora, día o semana, definido POR TRABAJADOR. Está dentro de Nómina: abre 💵 Control de pago a personal.' },
      { t: 'p', text: 'Cómo se calcula:' },
      { t: 'bullets', items: [
        'Cada trabajador tiene su Precio por hora, Precio por día y Precio por semana (los cargas/editas en el renglón de la persona y quedan guardados en su ficha para el próximo período).',
        'Cada período elige "Pago por": Por hora, Por día o Por semana. El devengado = precio del modo × cantidad (horas, días o semanas trabajadas).',
        'REGLA del "Por día": SOLO los operadores cobran por día. Un período "Pago por = Por día" precarga (y en "Personal faltante" agrega) únicamente empleados con cargo operador. Al resto se le paga en períodos Por hora o Por semana.',
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
        'Reportes: 🧾 Recibo por persona y ⬇️ Reporte del período completo, ambos en PDF.',
      ] },
      { t: 'note', text: 'Las analistas pueden cargar cantidades, bonos y deducciones, pero NO pueden cambiar los precios (hora/día/semana) del trabajador.' },
    ],
  },
  {
    icon: '🕒',
    title: 'Control de asistencia (dentro de Nómina)',
    blocks: [
      { t: 'p', text: 'Sirve para registrar la ENTRADA y la SALIDA del personal escaneando su carnet. Guarda la fecha y la hora automáticamente. Está dentro de Nómina: abre 🕒 Control de asistencia (o desde el menú Más / el panel del rol, según tus permisos).' },
      { t: 'steps', items: [
        'Toca "📷 Escanear carnet" y apunta al QR del carnet del trabajador (si el carnet no escanea, búscalo por nombre o cédula).',
        'Aparece la persona (foto, nombre, cargo) y sus marcas de hoy.',
        'Toca el botón grande: si aún no ha entrado dice "➡️ Marcar ENTRADA"; si ya entró dice "⬅️ Marcar SALIDA". La hora y la fecha se ponen solas.',
        'Cada marca queda etiquetada como ☀️ Día (6:00 a 17:59) o 🌙 Noche (resto), según la hora.',
        'Al registrar una SALIDA, el sistema PIDE CONFIRMACIÓN ("¿Seguro que quieres registrar la salida?") y te recuerda a qué hora fue su última entrada. Así, si alguien escanea dos veces seguidas por error, no se marca una salida sin querer.',
        'Se permiten VARIAS marcas al día (por ejemplo, sale a almorzar y vuelve): el sistema alterna entrada/salida y suma las horas presentes de todos los pares.',
        'Abajo tienes un CALENDARIO DEL MES con toda la asistencia (no solo la de hoy): usa ◀ ▶ para cambiar de mes; los días con marcas se resaltan y muestran un globo con el número de personas.',
        'Toca un día: se abre en ☀️ Día y 🌙 Noche (con cuántas personas hay en cada turno). Toca un turno y ves el detalle por persona: entrada → salida y horas de cada par.',
        'Cada día tiene su propio "📊 Reporte del día" (PDF), además del reporte por rango.',
      ] },
      { t: 'p', text: 'Reporte: toca 📊 Reporte, elige el rango de fechas y genera el PDF (o usa 📊 Reporte del día dentro del calendario). Sale por persona: cada jornada con su fecha, ☀️/🌙 turno, hora de entrada y salida y las horas; con subtotales de día y de noche. Una entrada sin salida sale como "abierta". Las jornadas de noche que cruzan la medianoche se emparejan bien.' },
      { t: 'note', text: 'Solo los usuarios AUTORIZADOS ven y usan esta pantalla (con el módulo "Control de asistencia"): actualmente AGATHA, DORIANNE, MOISES, DIANA y GÉNESIS (y administradores). Los demás no la ven.' },
    ],
  },
  {
    icon: '🪖',
    title: 'Supervisión (rondas de supervisores)',
    blocks: [
      { t: 'p', text: 'Sirve para saber si los supervisores SÍ están yendo a las máquinas a revisar que estén trabajando. El supervisor entra al sistema (rol Supervisor) y su pantalla principal es 🪖 Revisar (la lista de todas las máquinas para marcarlas). También tiene 🗺️ Mapa y 🚜 Catálogo.' },
      { t: 'p', text: 'Cómo marca el supervisor una máquina (dos formas, las dos valen):' },
      { t: 'steps', items: [
        'Entra con su cédula y contraseña (rol Supervisor). Cae en la pestaña 🪖 Revisar.',
        'DESDE LA LISTA: busca la máquina y tócala (o toca "📷 Escanear QR" si la tiene pegada). No hace falta el QR físico para marcarla.',
        'ESCANEANDO CON LA CÁMARA del teléfono (aunque no esté dentro del sistema): al abrir, toca "🪖 SOY SUPERVISOR — ENTRAR", inicia sesión y va DIRECTO al check-in de esa máquina (no pasa por la identificación de operador).',
        'El sistema toma su ubicación GPS y calcula qué tan cerca está de la máquina.',
        'Elige el estado: 🟢 Trabajando, 🟡 Parada o 🔴 No está, y escribe una nota si quiere.',
        'Toca "✅ Marcar como revisada". Queda la hora, el estado y la distancia.',
      ] },
      { t: 'note', text: '👷 Iniciar la jornada del operador (si no tiene teléfono): dentro del mismo check-in de la máquina, el supervisor toca "📷 Escanear carnet del operador", lee el QR del carnet, COTEJA la cédula (debe coincidir con el carnet) e ingresa el horómetro inicial, y toca "🟢 Iniciar jornada del operador". Arranca la jornada en esa máquina con las mismas reglas (1 máquina por operador al día, máximo 2 por turno) y queda la marca de que la registró el supervisor. La ubicación del supervisor queda como punto de inicio.' },
      { t: 'note', text: 'Antes el supervisor SOLO podía marcar escaneando el QR físico de cada máquina; ahora su pantalla 🪖 Revisar lista todas las máquinas y puede marcar cualquiera directo, sin depender del QR. El check-in aparece de inmediato en el módulo Supervisión (Traza por supervisor) y valida la jornada.' },
      { t: 'note', text: 'La cercanía es amplia a propósito (unos 300 m): si la máquina está trabajando y no se puede interrumpir, basta con estar "más o menos cerca". Si el supervisor está lejos, igual se guarda pero queda marcado "lejos ⚠️".' },
      { t: 'note', text: 'Vista de operador (al escanear el QR de la máquina): arriba se muestra un MAPA con tu ubicación en tiempo real (punto azul) y la máquina, con la DISTANCIA a la que estás (verde si estás en sitio) — así ves qué tan cerca la tienes. Botón "📷 Escanear carnet (operador)": al escanear el carnet, se muestran los datos del operador y se autocompleta el inicio de jornada (también puedes escribir la cédula). Al iniciar y al finalizar la jornada se guarda tu ubicación GPS.' },
      { t: 'note', text: 'Al FINALIZAR la jornada queda registrada en tres lugares: Operadores, Control de maquinaria y Supervisión (módulo "🚜 Jornadas de operadores": operador, máquina, empresa, hora de inicio/fin, horas y un enlace 📍 a la ubicación donde estaba).' },
      { t: 'note', text: 'Seguridad: el inicio de sesión es por CÉDULA + CONTRASEÑA. Solo pueden entrar personas registradas por el administrador y que tengan su CÉDULA asignada; si alguien no tiene cédula, el sistema le dice "Pídele al administrador de sistemas que agregue la CÉDULA para poder ingresar". Al escanear un QR, la vista queda AISLADA (operador o control de cocina) y NO se puede entrar al resto del sistema; su única salida es "Salir" (cierra sesión).' },
      { t: 'note', text: 'REGLA IMPORTANTE: si el supervisor NO marca una máquina que trabajó ese día, esa jornada queda "sin validar" y el operador no cobra.' },
      { t: 'p', text: 'Módulo "Supervisión" (para el jefe, en Más): muestra por día quién marcó cada máquina, a qué hora, con qué estado y qué tan cerca estaba, y sobre todo la lista de "⛔ Jornadas sin validar" (máquinas que trabajaron pero que ningún supervisor marcó). Usa las flechas ◀ ▶ para cambiar de día.' },
      { t: 'note', text: 'En "Traza por supervisor" puedes TOCAR cualquier máquina de la lista y te lleva a su ficha en el Catálogo (con todos sus datos y acciones). El › al final de cada renglón indica que es clickeable.' },
      { t: 'p', text: 'Cada supervisor trae un RESUMEN de cercanía (así sabes qué tan confiables fueron sus rondas): ✓ cuántas marcó EN SITIO (estuvo cerca, dentro de ~300 m), ⚠️ cuántas de LEJOS (marcó sin estar al lado) y • cuántas SIN GPS (no se pudo verificar). El botón "📄 Reporte de supervisión (PDF)" genera el informe del día con ese resumen por supervisor, el detalle de cada visita (hora, máquina, empresa, estado y ubicación) y las jornadas sin validar.' },
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
    title: 'Inventario (materiales, nota de entrega y cotización)',
    blocks: [
      { t: 'p', text: 'Es el control de materiales y herramientas. El inventario es GENERAL (no se separa por empresa ni por máquina al crearlo). Cada material tiene su existencia (cuánto hay) y su costo promedio (PMP), que el sistema calcula solo con las entradas.' },
      { t: 'p', text: 'Tiene varias pestañas: Existencias, Salida, Nota de traslado, Gastos, Cotización y Movimientos.' },
      { t: 'p', text: 'Salida — es el documento (nota de salida) que se hace cuando salen materiales:' },
      { t: 'steps', items: [
        'Ve a la pestaña "📤 Salida".',
        'Busca cada producto y agrégalo; indica la cantidad de cada uno.',
        'Elige la 🚜 máquina (lista desplegable y filtrable) y los 👷 empleados que reciben (lista de la nómina, filtrable, se pueden marcar varios). Escribe el destino/motivo si quiere.',
        'Toca "🧾 Generar nota de salida (PDF)": se abre la VISTA PREVIA con logo, fecha, productos y la línea de firma autorizado.',
        'Toca 🖨️ Imprimir para guardar/imprimir. RECIÉN AHÍ se descuenta del inventario.',
      ] },
      { t: 'note', text: 'IMPORTANTE: la salida se descuenta del inventario SOLO cuando confirmas (Imprimir/Guardar). Si le das Cancelar en la vista previa, NO se descuenta nada y NO se pierde lo que ya habías elegido: los productos, cantidades, máquina y empleados quedan tal cual para seguir editándolos o corregirlos.' },
      { t: 'p', text: 'Nota de traslado (entre máquinas) — traslada materiales de una máquina/empleado a otra:' },
      { t: 'steps', items: [
        'Ve a la pestaña "🔁 Nota de traslado".',
        'Agrega los materiales con stock e indica la cantidad de cada uno.',
        'Define el ORIGEN (🚜 máquina + 👷 responsable de dónde SALE) y el DESTINO (🚜 máquina + 👷 responsable a dónde VA). Escribe el motivo si quiere.',
        'Toca "🔁 Generar traslado (PDF)": se abre la vista previa con el bloque Origen → Destino y dos firmas (entrega y recibe).',
        'Al confirmar (Imprimir/Guardar) se descuenta del inventario y queda guardado el traslado, casado con la máquina y el empleado de cada lado.',
      ] },
      { t: 'note', text: 'Igual que la nota de entrega: si cancelas la vista previa NO se descuenta nada. La diferencia es que el traslado registra un ORIGEN y un DESTINO (de qué máquina/empleado sale y a cuál llega).' },
      { t: 'p', text: 'Gastos — cada material que SALE del almacén es un gasto. En la pestaña "💸 Gastos" ves el TOTAL GASTADO:' },
      { t: 'steps', items: [
        'Cuenta todo lo que sale del almacén: salidas y consumos manuales, notas de entrega y traslados. Cada gasto se valoriza al PMP (costo promedio) que tenía el material al momento de salir.',
        'Elige el período: Hoy, Esta semana, Este mes o Todo. El total se recalcula solo.',
        'Ves el desglose "Por categoría" (repuestos, herramientas, etc.). Toca una categoría para filtrar solo esos gastos; tócala de nuevo para quitar el filtro.',
        'Toca "📄 Reporte de gastos (PDF)": genera un PDF con el resumen por categoría y el detalle de cada salida (fecha, producto, cantidad, costo y gasto) con el total gastado.',
      ] },
      { t: 'note', text: 'Las entradas (compras) y los ajustes NO cuentan como gasto: el gasto es el material que efectivamente sale del almacén.' },
      { t: 'p', text: 'Cotización: en la pestaña "Cotización" armas un presupuesto para un cliente (código, referencia, descripción, cantidad y precio). El I.V.A. se coloca como MONTO (lo escribes tú, no un porcentaje). Genera un PDF con la base imponible, el IVA y el total.' },
      { t: 'note', text: 'El SKU de cada material es automático e incremental (INV-0001, INV-0002…).' },
      { t: 'p', text: 'Reporte de productos y estado — en la pestaña Existencias:' },
      { t: 'steps', items: [
        'Cada producto tiene un ESTADO físico (Nuevo / Bueno / Regular / Dañado) que eliges al crear o editar. También muestra su DISPONIBILIDAD automática: Disponible, Bajo mínimo o Agotado (según la cantidad vs el stock mínimo).',
        'Toca "📄 Reporte de productos (cantidad y estado)": genera un PDF con TODOS los productos, su cantidad, disponibilidad y estado.',
        'Al editar un producto (✏️ Editar producto) puedes cambiar la CANTIDAD (existencia): el sistema registra la diferencia como un AJUSTE DE INVENTARIO en Movimientos.',
      ] },
    ],
  },
  {
    icon: '🛠️',
    title: 'Mantenimiento de Maquinaria y roles de coordinador',
    blocks: [
      { t: 'p', text: 'Módulo para los coordinadores de mantenimiento. Tiene tres pestañas: ⏳ Averías (lo que reportan los operadores por QR, por empresa → máquina, con su detalle), 🔧 En reparación y ✓ Historial.' },
      { t: 'steps', items: [
        'Enviar a reparación: toca "🔧 Enviar una máquina a reparación" (o el botón en la tarjeta). Indica tipo (correctivo/preventivo), fecha de salida, por cuánto tiempo (días) y qué se le va a cambiar. La máquina queda NO OPERATIVA en todo el sistema.',
        'Registrar retorno: cuando vuelve, toca "✓ Registrar retorno operativo", pon qué se le cambió y la fecha. La máquina vuelve a OPERATIVA automáticamente.',
      ] },
      { t: 'note', text: 'ROLES DINÁMICOS (Usuarios → 🏷️ Roles del sistema): el administrador crea roles con un nombre y elige qué módulos ve cada uno; se ven en una lista buscable y se pueden quitar. En la tarjeta de cada usuario, "Rol especial" lo asigna (lista buscable) o lo quita. Un usuario con rol especial ve SOLO los módulos de su rol.' },
      { t: 'note', text: 'Vienen listos: Coordinador de Mantenimiento Preventivo y Correctivo (ven Mantenimiento de Maquinaria), y Coordinador de Operadores (ve Supervisión + Operadores: si los supervisores hacen sus check-ins y si los operadores trabajan).' },
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
        'Mapa · Capas: con el panel "🗂️ Capas" prendes y apagas los puntos por TIPO de equipo (igual que el Conteo: payloaders, jumbos, tractores, cisternas…), cada uno con su cantidad. Usa "Mostrar todas" / "Ocultar todas" o toca un tipo para ver sus máquinas y elegir una por una.',
        'Mapa · Zonas: el nombre de cada zona aparece al PASAR EL CURSOR por encima (en computadora) o al TOCAR la zona (en el teléfono); ya no salen todos los nombres a la vez.',
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
