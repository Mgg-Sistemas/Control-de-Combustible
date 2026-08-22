# Respaldo — Mantenimiento de Maquinaria (antes de dividirlo en dos secciones)

**Fecha:** 14 de agosto de 2026
**Motivo:** el módulo "Mantenimiento de Maquinaria" se divide en dos secciones:
**Mantenimiento** (preventivo, por horómetro) y **Servicio** (averías y reparaciones).

Este respaldo guarda el módulo **exactamente como funcionaba antes del cambio**.

---

## Qué hay aquí

Copia literal de los archivos que toca el cambio, con la misma estructura de carpetas:

| Archivo | Para qué sirve |
|---|---|
| `src/screens/MantenimientoMaquinariaScreen.tsx` | La pantalla completa con sus 5 pestañas (Averías, Reparación, Historial, Horómetros, Reporte) |
| `src/lib/permissions.ts` | Declaración del módulo `mantenimiento` y sus niveles de acceso |
| `src/lib/horometroAlertas.ts` | Cálculo de las alertas por horómetro (200 h / 220 h / 250 h) |
| `src/navigation/index.tsx` | Registro de la pantalla y su ruta |
| `src/screens/MoreScreen.tsx` | Entrada del módulo en el menú "Más" |
| `src/screens/RoleHomeScreen.tsx` | Entrada del módulo en el inicio por rol |
| `src/screens/UsersScreen.tsx` | Asignación de permisos por módulo a cada usuario |
| `src/screens/ManualScreen.tsx` | Manual dentro del sistema |

---

## Cómo restaurar

### Opción A — restaurar TODO de una vez (lo más rápido)

El respaldo también está guardado en git, en la etiqueta
`backup/mantenimiento-antes-de-dividir` (commit `669a45b6`).

```bash
git checkout backup/mantenimiento-antes-de-dividir -- src/screens/MantenimientoMaquinariaScreen.tsx src/lib/permissions.ts src/lib/horometroAlertas.ts src/navigation/index.tsx src/screens/MoreScreen.tsx src/screens/RoleHomeScreen.tsx src/screens/UsersScreen.tsx src/screens/ManualScreen.tsx
```

Eso deja los archivos como estaban. Después hay que borrar los archivos **nuevos**
que se hayan creado para la sección de Servicio (git te los muestra con `git status`).

### Opción B — restaurar un solo archivo desde esta carpeta

Copiar el archivo de aquí encima del original. Por ejemplo, para volver atrás
solo la pantalla:

```bash
cp docs/backups/mantenimiento-maquinaria-2026-08-14/src/screens/MantenimientoMaquinariaScreen.tsx src/screens/MantenimientoMaquinariaScreen.tsx
```

### Opción C — sin git, a mano

Los archivos de esta carpeta son copias exactas. Se pueden abrir, comparar y
pegar donde haga falta.

---

## Importante

- **No se tocó la base de datos.** Este cambio es solo de pantallas: las tablas
  (`material_requests`, `machine_repairs`, `machinery`, `machine_rounds`) siguen
  siendo las mismas y la app móvil sigue leyendo y escribiendo igual que siempre.
  Por eso restaurar es solo devolver archivos a su sitio, no hay nada que
  deshacer en Supabase.
- El manual en PDF del módulo tal como era está en
  `docs/manuales-pdf/manual-mantenimiento-maquinaria.pdf`.
