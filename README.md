# Control de Combustible

Aplicación móvil (iOS + Android, también web) para el control de combustible en operaciones con vehículos y maquinaria: **ingresos, consumos, tanques, autorizaciones, vehículos/maquinaria y traslados**.

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
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — requisitos funcionales y no funcionales
- [docs/ROADMAP.md](docs/ROADMAP.md) — fases, sprints e hitos
- [docs/PLAN.md](docs/PLAN.md) — arquitectura, modelo de datos y diseño
- [docs/SKILLS.md](docs/SKILLS.md) — competencias del equipo y skills de desarrollo
- [supabase/README.md](supabase/README.md) — configuración del backend

## Flujo de trabajo (GitFlow)
- `main` — producción (estable)
- `dev` — integración de desarrollo
- `feature/*` — nuevas funcionalidades (se ramifican desde `dev`)
- `release/*` — preparación de versiones
- `hotfix/*` — correcciones urgentes desde `main`
