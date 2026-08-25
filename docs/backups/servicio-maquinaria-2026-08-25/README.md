# Respaldo — Servicio de Maquinaria · 25-ago-2026

Copia de los archivos del módulo **tal como estaban ANTES** de cambiarle la forma
al PDF (commit `1a8186d8`). Es el respaldo que se hace antes de reformar un
módulo, junto con la etiqueta de git `respaldo/servicio-maquinaria-2026-08-25`.

## Qué se cambió después de esta copia

El cliente mandó el formulario de papel que llena el taller —**«REPORTE DE
MANTENIMIENTO / REPARACIÓN — MAQUINARIA PESADA»**— y pidió que el PDF se le
pareciera, conservando la foto de la máquina y los tipos de intervención.

- **Cada reparación pasó de ser una tarjetita resumida a ser una HOJA completa**:
  franja azul con el título, foto de la máquina, los cuatro renglones de cabecera
  (Fecha · Operador / Técnico · Equipo · Código de Serial), las **casillas** de
  tipo de intervención, y los tres recuadros (problema · acciones · repuestos).
- **Las firmas pasaron al pie de CADA hoja**, en vez de una sola vez al final del
  documento: cada intervención se firma por separado, igual que en el papel.
- **Las casillas se imprimen todas**, marcadas y sin marcar, y se cruzan **por
  clave**, no por el nombre visible.

## Qué NO se tocó (a propósito)

- `fichaTecnicaHtml` y `FICHA_CSS` quedaron **byte a byte idénticos**, porque los
  comparte el **Recibo de cobro de mangueras** (`src/lib/reciboCobro.ts`), que es
  de otro módulo.
- Ninguna escritura a la base de datos. El taller sigue sin mover el estado de
  las máquinas.
- **No hace falta correr ningún SQL**: el cambio no agrega columnas ni tablas.
- Inspecciones, inspectores y supervisión: sin tocar.

## Archivos

| Archivo | De dónde viene |
|---|---|
| `machineServiceReport.ts` | `src/lib/` — el PDF |
| `machineService.ts` | `src/lib/` — las reglas del módulo |
| `ServicioRegistroTab.tsx` | `src/screens/` — la pestaña 🧾 Servicios |
| `test-servicio.mjs` | `scripts/` — las pruebas |

Para volver atrás: `git checkout respaldo/servicio-maquinaria-2026-08-25 -- <archivo>`.
