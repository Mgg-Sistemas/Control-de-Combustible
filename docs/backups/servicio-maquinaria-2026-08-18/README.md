# Respaldo · Servicio de Maquinaria — 18 de agosto de 2026

Copia de los archivos del módulo **después** de agregarle el registro de servicios
y de cortarle la frontera. Etiqueta de git: `respaldo/servicio-maquinaria-2026-08-18`.

## Qué se cambió ese día

**1. Registro de servicios (nuevo).** Pestaña 🧾 Servicios dentro de Servicio de
Maquinaria, con las cinco secciones del formulario en papel del cliente («Ficha
técnica Jumbo con martillo 0488», Golden Touch 1127 C.A.): datos generales, tipo
de intervención, descripción del problema, acciones realizadas con foto, y
repuestos en renglones. Distingue servicios **internos** (equipo de la empresa) de
**externos** (persona o taller de afuera).

**Sin dinero.** El módulo no lleva costos, pagos ni autorizaciones — decisión
explícita del cliente. Si alguien propone «ya que estamos, agreguemos el costo»,
la respuesta es no.

**2. PDF de ficha técnica + reparaciones.** Primera página la ficha de la máquina
(foto, identificación, lubricación, horómetro); de la segunda en adelante las
reparaciones con sus repuestos, y las dos líneas de firma al pie. Con una sola
máquina en el filtro sale la ficha; con varias, van agrupadas sin ella.

**3. La frontera.** Los módulos de Servicio y Mantenimiento dejaron de escribir en
`machinery.operational`. Antes, enviar al taller ponía la máquina No operativa y
registrar el retorno la reactivaba. Ya no: eso lo hace Control de Maquinaria o el
panel QR del coordinador, que son los que de verdad ven la máquina.

**4. Lubricación en la ficha de la máquina.** Tres campos nuevos en Equipos:
`oil_type`, `oil_capacity_l`, `oil_notes`. No entran en ningún cálculo — se
imprimen tal cual en la ficha técnica.

## Lo que NO se cambió, y por qué

- **`machinery.horometro_base` sigue igual.** Es la única excepción a la frontera y
  fue pedida expresa por el cliente: «lo de los horómetros que sí funcione».
  Confirmar un mantenimiento sigue reiniciando el contador de horas acumuladas de
  esa máquina. Ojo: eso lo leen también `machineHoursReport.ts` (horas acumuladas
  = `last_horometro` − `horometro_base`) y el panel de Supervisión.

- **Los cierres de `maintenance_requests` se conservaron**, aunque el plan original
  decía cortarlos. Un reporte no es el estado de la máquina: es lo que alguien
  reportó, y cerrarlo es justo lo que impide que las averías se apilen para
  siempre — que era el problema que el cliente quería resolver. Cortarlo habría
  dejado una lista de averías que solo crece.

- **El cálculo del estado «averiada» sigue igual.** Hoy no es un campo guardado: se
  deriva de las `maintenance_requests` pendientes, y de ahí comen doce lugares
  (`machineLiveStatus.ts`, `controlEstado.ts`, Control, Equipos, Supervisión,
  Inspecciones, Histórico, Reportes, los PDF del inspector…). Cambiarlo alteraría
  cómo se ve el estado de todas las máquinas en todos los reportes, justo después
  de los cuadres de nómina. Es un proyecto aparte.

- **Ningún registro existente se tocó.** El SQL es puramente aditivo: dos tablas
  nuevas y tres columnas nuevas. Ni un `update`, ni un `delete`.

## La base de datos

`supabase/servicio_maquinaria.sql`, corrido a mano el 18-ago-2026. Comprobación
del bloque 7 en esa corrida:

| campo | resultado |
|---|---|
| `tabla_ordenes`, `tabla_repuestos` | true |
| `columnas_lubricacion` | true |
| `indices` | 5 |
| `politicas` | 4 |
| `rls_ordenes`, `rls_repuestos` | true |
| `registros_ordenes`, `registros_repuestos` | 0 |

## Cómo volver atrás

**El código:**

```bash
git checkout respaldo/servicio-maquinaria-2026-08-18 -- src/screens/MantenimientoMaquinariaScreen.tsx
```

O el commit puntual de la frontera, que va solo a propósito para poder revertirlo
sin arrastrar el resto:

```bash
git revert f6db79a9   # refactor(taller): los modulos dejan de mover el estado
```

**La base:** el bloque 8 de `supabase/servicio_maquinaria.sql` deshace las tablas y
las columnas. Está comentado a propósito: **si ya se cargaron servicios, ese `drop`
los borra.** Mientras las tablas estén vacías, deshacerlo no cuesta nada.

## Pruebas

`npm run test:servicio` — 60 aserciones. La más importante le inyecta a
`guardarServicio` un cliente Supabase falso que anota cada tabla que alguien
intenta tocar, y verifica que no escribe en `machinery` ni en
`maintenance_requests`. **La frontera dejó de depender de que alguien se acuerde.**

Diseño completo: `docs/superpowers/specs/2026-08-18-servicio-maquinaria-design.md`
Plan de implementación: `docs/superpowers/plans/2026-08-18-servicio-maquinaria.md`
