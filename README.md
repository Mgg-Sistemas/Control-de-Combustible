# Control de Combustible

ERP de una operación de minería y transporte pesado. Empezó siendo el control del combustible —de
ahí el nombre— y hoy son **35 módulos y 74 pantallas**: combustible (tanques, ingresos, consumos,
traslados), maquinaria (control, mantenimiento, servicio, inspecciones, lavado), jornadas y horas,
personal (empleados, nómina, asistencia, uniformes, comida), almacén (inventario, compras,
requerimientos, cuentas por pagar y cobrar), acarreo, fabricación, obras públicas y topografía.

Un solo código para **navegador y teléfono**. En producción: **https://soslaguaira.com**

## Stack
- **App:** Expo (React Native) + TypeScript + React Navigation
- **Backend:** Supabase (PostgreSQL + Auth + Row Level Security + Storage)
- **Diseño:** mobile-first, paleta de tonos neutros

## Requisitos
- Node.js 20+ (probado con 24) y npm
- App **Expo Go** en tu teléfono (App Store / Play Store) para probar en dispositivo

## Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar Supabase
cp .env.example .env          # (en PowerShell: copy .env.example .env)
# edita .env con tu EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY
# luego crea el esquema: ver supabase/README.md

# 3. Arrancar en local
npm run web        # abre en el navegador (http://localhost:8081)
# o
npx expo start     # muestra un QR para abrir en Expo Go (teléfono en la misma red)
```

> La app **arranca aunque no configures Supabase** (modo demo, con un aviso). Para ver datos reales, configura `.env` y ejecuta el esquema.

## Scripts
| Comando | Descripción |
|---|---|
| `npm run web` | Ejecuta la app en el navegador (ideal para probar rápido) |
| `npm run android` | Abre en emulador/dispositivo Android |
| `npm run ios` | Abre en simulador iOS (requiere macOS) |
| `npx expo start -c` | Inicia limpiando caché (útil tras cambiar `.env`) |
| `npm run test:all` | **Corre las 35 suites de pruebas** — hazlo antes de cada commit |
| `./node_modules/.bin/tsc --noEmit` | Typecheck (`npx tsc` instala el paquete equivocado) |
| `npm run build:web` | Compila la web a `dist/` sin publicarla |
| `npm run deploy` | Compila y commitea `dist/` — **solo de urgencia**, ver `docs/DEPLOY.md` |

### Pruebas
No hay framework. Cada suite es un `scripts/test-<lo-que-sea>.mjs` que transpila los `.ts` en
memoria. **Se autodescubren**: crear el archivo basta, no hay que anotarlo en `package.json`. La
suite debe salir con código `1` si algo falla. Detalle en [AGENTS.md](AGENTS.md).

### Despliegue
Automático: push a `main` → GitHub Actions compila → DigitalOcean publica. **Nadie compila en su
PC.** Ver [docs/DEPLOY.md](docs/DEPLOY.md).

### Base de datos
Los `.sql` de `supabase/` **no se aplican solos**: se corren a mano en el editor SQL de Supabase.
Qué falta correr está en **[supabase/PENDIENTES.md](supabase/PENDIENTES.md)**.

## Estructura
```
.
├── App.tsx                 # Punto de entrada (providers + navegación)
├── src/
│   ├── components/         # UI reutilizable (Card, ListScreen, banners…)
│   ├── context/            # AuthContext (sesión Supabase)
│   ├── hooks/              # useTable (lectura de datos)
│   ├── lib/                # cliente Supabase
│   ├── navigation/         # tabs + stacks
│   ├── screens/            # pantallas por módulo
│   ├── theme/              # paleta neutra y tokens de diseño
│   └── types/              # tipos del dominio
├── supabase/               # schema.sql, seed.sql y guía del backend
└── docs/                   # PLAN, ROADMAP, REQUIREMENTS, SKILLS
```

## Documentación

**Al día — empieza por aquí:**
- [AGENTS.md](AGENTS.md) — guía corta del proyecto: comandos, pruebas, arquitectura, convenciones
- [docs/MANUAL-USUARIO.md](docs/MANUAL-USUARIO.md) — el manual del usuario final (≈3.800 líneas).
  Se mantiene **en espejo** con `src/screens/ManualScreen.tsx`: al cambiar algo, se actualizan **los dos**
- [supabase/PENDIENTES.md](supabase/PENDIENTES.md) — **qué SQL falta correr**. Lista única
- [docs/DEPLOY.md](docs/DEPLOY.md) — cómo se publica la web
- [docs/HANDOFF-CLAUDE.md](docs/HANDOFF-CLAUDE.md) y
  [docs/CONTEXTO-PARA-NUEVO-CHAT.md](docs/CONTEXTO-PARA-NUEVO-CHAT.md) — traspaso entre sesiones
- [supabase/README.md](supabase/README.md) — configuración del backend

**Históricos — ⚠️ describen el proyecto tal como se planeó en junio de 2026, no como es hoy:**
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — da por «fuera de alcance» Compras y Mantenimiento,
  que llevan meses en producción
- [docs/ROADMAP.md](docs/ROADMAP.md) — pone en el futuro fases ya entregadas
- [docs/PLAN.md](docs/PLAN.md) — su árbol de carpetas y su plan de pruebas (Jest, ESLint, EAS)
  nunca se adoptaron; manda AGENTS.md
- [docs/SKILLS.md](docs/SKILLS.md) — la convención `supabase/migrations/` nunca se adoptó

## Flujo de trabajo (GitFlow)
- `main` — producción (estable)
- `dev` — integración de desarrollo
- `feature/*` — nuevas funcionalidades (se ramifican desde `dev`)
- `release/*` — preparación de versiones
- `hotfix/*` — correcciones urgentes desde `main`
