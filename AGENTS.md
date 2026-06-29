# Control de Combustible — guía para agentes

App Expo (React Native) + TypeScript con backend Supabase. Controla combustible:
ingresos, consumos, tanques, autorizaciones, vehículos/maquinaria y traslados.

> Expo v56 — consulta los docs versionados en https://docs.expo.dev/versions/v56.0.0/ antes de escribir código de Expo.

## Comandos
- `npm run web` — ejecutar en navegador (pruebas rápidas en local)
- `npx expo start -c` — iniciar limpiando caché (tras cambiar `.env`)
- `npx tsc --noEmit` — typecheck

## Arquitectura
- Entrada: `App.tsx` → `AuthProvider` → `src/navigation` (tabs + stack "Más").
- Datos: `src/lib/supabase.ts` (cliente) y `src/hooks/useTable.ts` (lectura genérica).
- UI: `src/components/` (Card, ListScreen, banners), `src/theme/` (paleta neutra).
- Tipos del dominio: `src/types/database.ts` (alineados con `supabase/schema.sql`).

## Reglas de negocio (definidas en la BD)
- El nivel de tanque es DERIVADO de `stock_movements` (vista `tank_levels`); nunca se edita a mano.
- Ingresos suman stock; consumos y traslados lo restan/mueven (triggers en `schema.sql`).
- No se puede despachar/trasladar más litros que el stock disponible (lo valida un trigger).
- Roles: admin, supervisor, operador, conductor (RLS por rol en `schema.sql`).

## Convenciones
- Todo el texto de la UI y la documentación en **español**.
- Mantener `src/types/database.ts` sincronizado con cambios en `supabase/schema.sql`.
- GitFlow: ramificar `feature/*` desde `dev`; no commitear directo a `main`.
- No commitear `.env` (ya está en `.gitignore`).
