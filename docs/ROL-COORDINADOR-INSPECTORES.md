# Rol: Coordinador de inspectores

Guía del rol **coordinador de inspectores** de Control de Combustible (soslaguaira.com).

## Qué es

Un **coordinador de inspectores** es un inspector con superpoderes. Además de llevar
**sus propias máquinas** (igual que cualquier inspector), puede **operar en nombre de
cualquier otro inspector**: iniciar/finalizar jornada, marcar parada o avería y
actualizar la ubicación de las máquinas de los demás.

La regla de oro: **lo que el coordinador haga sobre la máquina de un inspector se le
marca a ese inspector** (porque la máquina está asignada a él). El sistema deja además
constancia de que quien lo registró fue el coordinador.

## Cómo se crea

1. En **Usuarios**, edita al usuario y asígnale el rol **"coordinador de inspectores"**.
2. Asígnale **sus máquinas propias** con **✅ CHECK MÁQUINA**, igual que a cualquier
   inspector (opcional: un coordinador puede no tener máquinas propias).

No hace falta asignarle "sus" inspectores: el coordinador ve y puede operar sobre
**todos** los inspectores.

## Su pantalla (teléfono)

Al entrar cae en la vista del inspector, con un **conmutador arriba**:

### 🚜 Máquinas
Su ronda de siempre: sus máquinas asignadas (y, como coordinador, el botón para ver
**todas** las máquinas y el **✅ CHECK MÁQUINA** para asignar inspectores).

### 👥 Inspectores
Lista **cada inspector** como una fila **desplegable y buscable**, con sus máquinas
repartidas por estado:

- 🟢 **Iniciadas** — jornada abierta ahora
- ⏳ **Pendientes por iniciar** — aún sin iniciar la jornada de hoy
- 🟡 **Paradas** — parada / no trabajó
- 🔴 **Averiadas** — con avería pendiente

Al **tocar una máquina** se abre el mismo check-in del inspector, con todos los botones:

- ▶️ **Iniciar jornada** (con horómetro inicial) / 🏁 **Finalizar jornada**
- 🟡 **Parada** (por avería o "no trabajó") / 🔴 **Avería** (material, nota y foto)
- 📍 **Actualizar ubicación** (GPS)

El buscador filtra por **nombre del inspector** o por **máquina** (código, placa,
serial, empresa, encargado).

## Vinculación con el inspector (importante)

- El panel de **Inspecciones**, los **reportes** y **Control de pagos** atribuyen cada
  jornada **según a qué inspector está asignada la máquina** (CHECK máquina), **no**
  según quién la registró. Por eso, cuando el coordinador inicia la jornada en la
  máquina de un inspector, **cuenta para ese inspector** automáticamente.
- Queda una **traza visible**: en la visita de Inspecciones y en la avería de
  Mantenimiento se agrega la nota **"registrado por [coordinador]"**.
- La marca de tiempo/GPS del check-in es la del coordinador (está físicamente en la
  máquina cuando la opera).

## Qué NO cambia

- El inspector normal sigue viendo **solo sus máquinas** y no ve el conmutador.
- Panel, reportes y pagos se ven exactamente igual: cada jornada bajo su inspector.

## Resumen para el admin

| Acción | Dónde |
|---|---|
| Crear coordinador | Usuarios → rol "coordinador de inspectores" |
| Darle máquinas propias | ✅ CHECK MÁQUINA (día/noche) |
| Ver quién registró qué | Nota "registrado por [coordinador]" en la visita/avería + Auditoría |
