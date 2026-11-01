# Centro de Operaciones — Parte diario: ajuste del diseño y plan (24/10/2026)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que el módulo sea la hoja diaria de la encargada del sitio: pega el Reporte General de WhatsApp, anota entradas por patio, salidas (agregados, acero, aluminio, plástico), el estado de sus máquinas y los bloques de la cantera, y saca un Reporte completo.

**Spec base:** `docs/superpowers/specs/2026-10-23-centro-operaciones-design.md` (principio «recibe, no envía», permisos, RLS, reglas de los papeles). Este documento lo **ajusta**: las fases 2–4 (pagos del sitio, costo de materiales, enlace con el 💰 consolidado) quedan **en pausa** por decisión del cliente (24/10/2026: «el módulo ya no sería tan enorme, se trabajaría con esa información que tenemos ahora»).

## 1. Lo que pidió (24/10/2026, audio, notas y ejemplo)

1. **Reporte General** que le llega por WhatsApp: fecha y hora de corte, viajes totales, total neto en t, viajes y t por empresa y por frente (cambian cada día). Lo copia y lo pega; el sistema lo reconoce. «No es que me va a poner residencia por residencia a transcribir.»
2. **Entrada por patio** A, B y C (7am–7pm): ella dice cuántos viajes entraron por cada patio; no tiene por qué coincidir con el total del reporte (ella es la única que sabe por qué patio entró).
3. **Salida de material (agregados):** triturado mixto, arrocillo, polvillo (y los que agregue). Cantidad en m³, t **o** kg: escribe uno y el sistema calcula los otros (**factor 1,2**: t = m³ × 1,2). Destino de una lista que ella llena (cantera, obra, planta…), con **GPS** para saber los km desde su sitio. Vehículo **nuestro** (placa; el chofer sale solo) o **externo** (solo el nombre de la compañía).
4. **Salida de acero:** se lo lleva una empresa (la que ella tiene en su lista) o nosotros; camión y m³ al salir; las **toneladas llegan después** (nota de entrega, uno o dos días) y se completan luego. Sin factor fijo.
5. **Salida de aluminio** (fecha, t o kg, a dónde va, empresa — nosotros u otra) y **de plástico** (empresa compradora, t, fecha).
6. **Maquinaria** del sitio: disponible / averiada, y poder cambiarle el estado.
7. **Bloques** (en la cantera): producción por día; **disponibles para la venta 7 días después**; inventario que solo cuente lo disponible. El gasto de polvillo no importa.
8. **Reporte completo**, y el primero de sus papeles es el Reporte General desglosado.

## 2. Decisiones (24/10/2026, aprobadas con «sigue con todo»)

- El estado de las máquinas vive **solo en el módulo** (`cop_unidades.estado`): no toca Control ni el catálogo.
- Km: GPS del sitio y de cada destino; **km por carretera** guardado en el destino, que ella confirma (el sistema sugiere la línea recta, que siempre da menos). Cada salida **congela** los km del destino en ese momento, y también sus m³ y toneladas: al editarla sin cambiar el material, la cifra ni la unidad, se quedan aunque el factor del material haya cambiado después (revisión final A#3).
- La **Cantera** es un **segundo sitio** del mismo módulo (los bloques se cargan ahí).
- «Patio» = la clase de lista `terraza` (se muestra como «Patio»).
- La carga libre (✍️) queda como última pestaña «✍️ Carga libre» (ocultar no es eliminar). Cada renglón se corrige donde nació: el Parte diario no edita lo de Carga libre (lote 5 B4/R1) y Carga libre y 📋 Registros no editan lo del Parte diario (bloques y salidas con vehículo; revisión final A#1).
- Un patio «para todos los sitios» y uno del sitio con el mismo nombre son un solo campo: manda el del sitio (revisión final A#5).

## 3. Base de datos (corrida por MCP y verificada el 24/10/2026; NO va al git)

- `cop_sitios` + `lat`, `lng`.
- `cop_listas` + `lat`, `lng`, `km` (destinos), `factor_t_m3`, `dias_disponible` (materiales).
- `cop_unidades` + `estado` ('disponible'|'averiada', defecto disponible), `estado_nota`, `estado_at` (lo pone un trigger al cambiar), `chofer`.
- `cop_movimientos` + `chofer`, `km`, `vehiculo` ('propio'|'externo'), `cantidad` (piezas), `unidad_ingresada` ('m3'|'t'|'kg'|'u'), `disponible_desde`; `tipo` admite `produccion`; los viajes pueden faltar en producción o cuando hay `cantidad`.
- **`cop_reportes_generales`** (uno por sitio y jornada; pegarlo de nuevo lo reemplaza): `fecha`, `hora_corte`, `viajes_total`, `toneladas_total`, `empresas` y `frentes` (jsonb `[{nombre, viajes, toneladas}]`), `avisos` (jsonb), `texto_original`, sello. RLS igual que `cop_movimientos`; auditoría con `trg_audit`.

## 4. Cómo se anota cada cosa (sin tablas nuevas para lo demás)

| Lo que anota | Dónde |
|---|---|
| Reporte General | `cop_reportes_generales` (una fila por día) |
| Entrada por patio | `cop_movimientos` tipo `entrada`, `destino` = patio, `viajes` = n (una fila por patio y día; se reemplaza) |
| Salida de agregados | tipo `salida`, `material`, `m3` + `toneladas` (convertidos), `unidad_ingresada`, `destino` + `km`, `vehiculo` propio (`unidad_id`, `placa`, `chofer`) o externo (`transportista`), `viajes` (defecto 1) |
| Salida de acero | tipo `salida`, material «Acero», `m3`, `toneladas` vacía y `estado` `esperando_pesaje` hasta la nota de entrega |
| Aluminio / plástico | tipo `salida`, material, `toneladas` (de t o kg), `transportista` = empresa, `destino` |
| Maquinaria | `cop_unidades.estado` / `estado_nota` |
| Bloques | sitio Cantera: tipo `produccion`, material «Bloques», `cantidad`, `disponible_desde` = fecha + `dias_disponible` (7); venta = tipo `salida`, material «Bloques», `cantidad` |

## 5. Librerías puras ya en curso

- `src/lib/centroOperacionesReporteGeneral.ts` — `leerReporteGeneral(texto)`, `reporteCuadra(r)` (rama del lector de WhatsApp).
- `src/lib/centroOperacionesMateriales.ts` — `convertirCantidad`, `textoCantidades`, `sumarDias`, `inventarioBloques`, `kmLineaRecta`, `FACTOR_AGREGADOS` (rama feature/cop-materiales).

## 6. Tareas (después de integrar las olas L2/L3, la Tarea 8 y las dos librerías)

### PD1 — Tipos y capa de datos
- `src/types/database.ts`: columnas nuevas y `CopReporteGeneralRow`.
- `src/lib/centroOperaciones.ts`: `Movimiento` + `chofer`, `km`, `vehiculo`, `cantidad`, `unidadIngresada`, `disponibleDesde`; `TipoMov` + `'produccion'`; `Unidad` + `estado`, `estadoNota`, `estadoAt`, `chofer`; `ItemLista` + `lat`, `lng`, `km`, `factorTM3`, `diasDisponible`; `Sitio` + `lat`, `lng`. Que la producción no sume a viajes/toneladas de las salidas.
- `src/lib/centroOperacionesDb.ts`: mapeos nuevos; `cargarReportesGenerales(sitioId, desde, hasta)`, `guardarReporteGeneral(sitioId, r: ReporteGeneral, texto)` (actualiza si ya hay uno ese día), `borrarReporteGeneral(id)`; `guardarEstadoUnidad(id, estado, nota)`; `guardarPatiosDelDia(sitioId, fecha, [{patio, viajes}])` (reemplaza las filas de ese día). Toda escritura con `.select('id')`.
- Pruebas en `scripts/test-centro-operaciones-datos.mjs`.

### PD2 — 📅 Parte diario: Reporte General y patios
- `src/components/centroOperaciones/ParteDiarioTab.tsx` (primera pestaña; fecha de jornada, por defecto `caracasBusinessToday()`; bloques plegables en el orden de su hoja) y `BloqueReporteGeneral.tsx` (pegar → leer → vista de lo leído con empresas, frentes, totales, **avisos** y líneas no leídas → Guardar / Reemplazar con confirmación), `BloquePatios.tsx` (un campo por patio de su lista; suma y diferencia contra el total del reporte de ese día).
- Pruebas en `scripts/test-centro-operaciones-parte-diario.mjs`.

### PD3 — Salidas
- `BloqueSalidas.tsx`: agregados (material con su factor; cantidad + unidad m³/t/kg con conversión en vivo; destino con sus km; vehículo propio → placa + chofer automático / externo → empresa; viajes 1), acero (quién; camión; m³; toneladas pendientes → «Pendientes de pesaje» con «Completar toneladas»), aluminio y plástico (t o kg, empresa, destino).

### PD4 — Maquinaria, bloques y ajustes
- `BloqueMaquinaria.tsx` (unidades del sitio, Disponible/Averiada con nota; solo Escritura/Full cambia).
- `BloqueBloques.tsx` (producción del día, ventas, tarjeta de inventario: disponibles hoy, en curado y cuándo se liberan, avisos).
- ⚙️ Ajustes: GPS del sitio; destinos con GPS y km (botón «Sugerir km en línea recta»); materiales con factor y días hasta disponible; chofer en las unidades (Flota).

### PD5 — 📄 Reporte completo
- `src/lib/centroOperacionesPapel.ts`: `cuerpoReporteCompleto(datos, op, ed)` — 1) Reporte General desglosado (empresas y frentes, con %, como su primer papel; en un rango, la suma de los días), 2) entrada por patio vs total, 3) salidas de agregados (por material y destino: m³, t, km, propio/externo), 4) acero (m³ y t o «pendiente»), 5) aluminio y plástico, 6) maquinaria (disponible/averiada), 7) bloques (producción, disponibles al corte, en curado). Mismas reglas de la casa (lo oculto no deja rastro, opciones solo en el nombre del archivo, escapado).
- Pestaña 📄 Reportes: nuevo papel «Reporte completo» (el primero de la lista).

### PD6 — Cierre
Auditoría (2 auditores + refutador + votación), arreglos, manuales (los dos), revisión final de toda la rama, prueba en web con la encargada o el usuario (sitio de prueba y borrado con su permiso), limpieza de historia (base = merge-base con origin/dev) y publicación en dev y main.
