# Backend Supabase — Control de Combustible

## 1. Crear el proyecto
1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo.
2. Ve a **Project Settings → API** y copia:
   - **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
   - **anon public key** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. En la raíz del repo copia `.env.example` a `.env` y pega esos valores.

## 2. Crear el esquema
En **SQL Editor** de Supabase, pega y ejecuta:
1. [`schema.sql`](./schema.sql) — tablas, enums, vista de niveles, triggers de stock y políticas RLS. **Ya incluye al FINAL la sección "ENDURECIMIENTO CONSOLIDADO"** que fold-ea todos los parches de seguridad (RLS de nómina/tablas sensibles, `employee_public_lookup`, locks anti-sobregiro, `guard_role_change`, `can_write_module` fail-closed, auto-desbloqueo de login, máx. operadores por turno). Correr **solo este archivo** ya deja el entorno en el estado seguro de producción.
2. (Opcional) [`seed.sql`](./seed.sql) — datos de demostración.

> ✅ Desde 11-ago-2026 `schema.sql` es autocontenido en seguridad: la sección final consolidada sobreescribe cualquier política insegura declarada arriba. Los parches sueltos ([`fix_rls_anon_nomina*.sql`](./fix_rls_anon_nomina.sql), [`fix_stock_race_condition.sql`](./fix_stock_race_condition.sql), [`mejoras_seguridad_rendimiento.sql`](./mejoras_seguridad_rendimiento.sql), [`security_hardening_2026-08-11.sql`](./security_hardening_2026-08-11.sql)) se conservan como **historial y detalle comentado** de cada cambio, pero ya **no** hace falta correrlos por separado tras `schema.sql`.
>
> ⚠️ Esa sección debe permanecer SIEMPRE al final del archivo (sobreescribe por orden de ejecución). Cualquier endurecimiento futuro se agrega ahí. Los demás `.sql` del directorio (backfills, cierres, cargas one-time) **no** son esquema y no se corren en una reconstrucción.

## 3. Autenticación
- **Auth → Providers → Email**: habilitado por defecto.
- Para pruebas rápidas, **Auth → Providers → Email → "Confirm email"** puede desactivarse para no requerir confirmación.
- Al registrarse, un trigger crea automáticamente el perfil en `public.profiles` con rol `conductor`.
- Para asignar el primer **admin**, ejecuta en SQL Editor:
  ```sql
  update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'tu@correo.com');
  ```

## Modelo de datos (resumen)
| Tabla | Rol |
|---|---|
| `profiles` | Usuarios y roles (admin/supervisor/operador/conductor) |
| `tanks` | Tanques (capacidad, tipo de combustible) |
| `vehicles` / `machinery` | Activos con placa/código y rendimiento |
| `fuel_intakes` | Ingresos de combustible (suman stock) |
| `dispatches` | Consumos/despachos (restan stock) |
| `transfers` | Traslados entre tanques |
| `authorizations` | Autorizaciones de despacho |
| `stock_movements` | Ledger fuente de verdad del stock (lo llenan los triggers) |
| `tank_levels` (vista) | Nivel actual y % de cada tanque |

El nivel de cada tanque **se calcula** a partir de `stock_movements`; nunca se edita a mano.
Consulta [`../docs/PLAN.md`](../docs/PLAN.md) para el diseño completo.
