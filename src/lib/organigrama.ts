import { norm, cmpText } from './text';
import { LOGO_DATA_URI } from './logoData';

/**
 * Organigrama de la empresa (por CARGOS, no por nombres). La estructura es FIJA
 * y curada; los cargos que aparezcan en la nómina (empleados) y que NO estén
 * ubicados aquí se muestran en una caja aparte "🆕 Otros cargos (por ubicar)".
 *
 * Un solo árbol de cargos alimenta TODO:
 *  - `organigramaCard()` / `organigramaHtml()`  → el diagrama (dos columnas).
 *  - `fichasHtml()`                             → PDF general: todos los cargos con
 *                                                  sus funciones y subordinados.
 *  - `fichaCargoHtml(cargo)`                    → ficha individual de un cargo.
 */

// ── Modelo ───────────────────────────────────────────────────────────────────
export type OrgNode = {
  title: string;
  /** Ícono (emoji) para el diagrama; solo lo usan las secciones/columnas. */
  icon?: string;
  /** Funciones del cargo (para las fichas). Los agrupadores (area) no llevan. */
  funciones?: string[];
  /** `true` = es un agrupador visual (área/sección sin persona), no un cargo. */
  area?: boolean;
  /** Si un área quiere que sus cargos reporten a un jefe concreto (no al padre). */
  bossTitle?: string;
  children?: OrgNode[];
};

// Paleta corporativa (azul = admin/servicios/soporte, naranja = maquinaria).
const NAVY = '#1F3D63';
const NAVY_DK = '#16304F';
const ORANGE = '#E1701B';

export const ORG_DIRECTOR = 'DIRECTOR GENERAL';
export const ORG_GENERAL = 'COORDINADOR GENERAL';
const AREA_ADMIN = 'ADMINISTRACIÓN, SERVICIOS Y SOPORTE';
const AREA_OPER = 'OPERACIONES Y MANTENIMIENTO DE MAQUINARIA';

// El árbol completo. El nodo raíz es el Director General.
const ROOT: OrgNode = {
  title: ORG_DIRECTOR,
  funciones: [
    'Dirige la empresa y define las políticas, metas y objetivos generales.',
    'Aprueba presupuestos, contrataciones, compras e inversiones de importancia.',
    'Supervisa al Coordinador General y a las jefaturas de todas las áreas.',
    'Representa legal e institucionalmente a la empresa ante terceros.',
  ],
  children: [
    {
      title: ORG_GENERAL,
      funciones: [
        'Coordina y hace seguimiento a todas las jefaturas (administración, alimentación, almacén, operaciones y mantenimiento).',
        'Traslada las directrices del Director General a cada área y controla su cumplimiento.',
        'Controla el logro de metas y consolida los resultados para reportarlos a la Dirección.',
        'Resuelve y escala los problemas que superan el alcance de las jefaturas.',
      ],
      children: [
        // ── COLUMNA IZQUIERDA: Administración, servicios y soporte ──
        {
          title: AREA_ADMIN, area: true, children: [
            {
              title: 'JEFE DE ADMINISTRACIÓN', icon: '🏢',
              funciones: [
                'Gestiona nómina, pagos, cobros y control de gastos de la empresa.',
                'Lleva la contabilidad y la relación con bancos y proveedores.',
                'Supervisa al Analista Administrativo y valida sus registros.',
                'Elabora los reportes financieros para la Coordinación General.',
              ],
              children: [
                { title: 'Analista Administrativo', funciones: [
                  'Registra facturas, pagos y movimientos administrativos.',
                  'Apoya en la elaboración de la nómina y el archivo de documentos.',
                  'Concilia cuentas y atiende trámites administrativos.',
                ] },
              ],
            },
            {
              title: 'JEFE DE ALIMENTACIÓN', icon: '🍽️',
              funciones: [
                'Planifica los menús y la alimentación del personal.',
                'Controla los insumos, las porciones y la calidad de la comida.',
                'Supervisa al Coordinador de Cocina y a su equipo.',
                'Vela por la higiene y la seguridad alimentaria del comedor.',
              ],
              children: [
                {
                  title: 'Coordinador de Cocina', funciones: [
                    'Organiza la cocina, los turnos y la distribución de tareas.',
                    'Controla el inventario de alimentos y las porciones.',
                    'Garantiza la limpieza y el orden del área de cocina.',
                  ],
                  children: [
                    { title: 'Cocinero', funciones: [
                      'Prepara los alimentos según el menú establecido.',
                      'Cuida la sazón, la higiene y los tiempos de servicio.',
                      'Informa los faltantes de insumos al coordinador.',
                    ] },
                    { title: 'Ayudante de Cocina', funciones: [
                      'Apoya al cocinero en la preparación y el montaje.',
                      'Alista los ingredientes y mantiene el orden del área.',
                    ] },
                    { title: 'Lavaplatos', funciones: [
                      'Lava y desinfecta vajilla, ollas y utensilios.',
                      'Mantiene limpia el área de lavado y apoya en tareas de cocina.',
                    ] },
                  ],
                },
              ],
            },
            {
              title: 'JEFE DE ALMACÉN', icon: '📦',
              funciones: [
                'Controla las entradas y salidas de materiales e insumos.',
                'Mantiene el inventario actualizado y resguarda los bienes.',
                'Supervisa al Almacenista y valida los despachos.',
                'Reporta faltantes y necesidades de reposición.',
              ],
              children: [
                { title: 'Almacenista', funciones: [
                  'Recibe, ubica y despacha materiales e insumos.',
                  'Registra los movimientos de inventario en el sistema.',
                  'Realiza conteos periódicos y reporta faltantes.',
                ] },
              ],
            },
            {
              title: 'SERVICIO DE ELECTRICIDAD', icon: '⚡', area: true, children: [
                {
                  title: 'Coordinador de Electricidad', funciones: [
                    'Coordina el mantenimiento eléctrico de instalaciones y equipos.',
                    'Asigna los trabajos a electricistas y ayudantes.',
                    'Garantiza el cumplimiento de las normas de seguridad eléctrica.',
                    'Reporta fallas, consumos y necesidades de materiales.',
                  ],
                  children: [
                    { title: 'Electricista / Ayudante de Electricidad', funciones: [
                      'Instala, mantiene y repara sistemas e instalaciones eléctricas.',
                      'Diagnostica fallas y ejecuta las reparaciones.',
                      'Cumple las normas de seguridad; el ayudante asiste en las labores.',
                    ] },
                  ],
                },
              ],
            },
            {
              title: 'SERVICIOS GENERALES', icon: '🧰', area: true, children: [
                { title: 'Soldador / Ayudante de Soldador', funciones: [
                  'Realiza trabajos de soldadura y estructuras metálicas.',
                  'Repara piezas y componentes de equipos.',
                  'El ayudante prepara los materiales y asiste en el trabajo.',
                ] },
                { title: 'Chofer de Camión / Motorizado VIP', funciones: [
                  'Traslada personal, materiales o encomiendas con seguridad.',
                  'Mantiene el vehículo en condiciones de uso.',
                  'El motorizado VIP realiza diligencias y traslados urgentes.',
                ] },
                { title: 'Todero / Obrero (Caletero)', funciones: [
                  'Realiza labores varias de carga, descarga y apoyo general.',
                  'Asiste a las distintas áreas según la necesidad del día.',
                ] },
                { title: 'Controlador de Tráfico', funciones: [
                  'Ordena y controla el movimiento de vehículos y equipos.',
                  'Cuida la seguridad vial en las áreas de operación.',
                  'Apoya la logística de entradas y salidas.',
                ] },
              ],
            },
          ],
        },
        // ── COLUMNA DERECHA: Operaciones y mantenimiento de maquinaria ──
        {
          title: AREA_OPER, area: true, children: [
            {
              title: 'JEFE DE OPERACIÓN DE MAQUINARIA', icon: '🚜',
              funciones: [
                'Dirige la operación de la maquinaria y los equipos.',
                'Planifica los frentes de trabajo, los turnos y los rendimientos.',
                'Supervisa a los coordinadores de operaciones, logística, inspección y mantenimiento.',
                'Controla la productividad y la seguridad de las operaciones.',
              ],
              children: [
                { title: 'Coordinador de Operaciones', funciones: [
                  'Coordina la ejecución diaria de las operaciones de maquinaria.',
                  'Asigna los operadores a cada frente de trabajo.',
                  'Hace seguimiento a las metas y reporta los avances.',
                ] },
                { title: 'Coordinador de Logística', funciones: [
                  'Coordina el suministro de combustible, repuestos y traslados de equipos.',
                  'Planifica rutas, tiempos y recursos de cada frente.',
                  'Asegura que no falten insumos en la operación.',
                ] },
                { title: 'Operadores de Máquinas / Maquinaria', funciones: [
                  'Operan la maquinaria pesada según el plan de trabajo.',
                  'Cuidan el equipo, verifican niveles y reportan fallas.',
                  'Cumplen las normas de seguridad en el frente.',
                ] },
              ],
            },
            {
              title: 'COORDINADOR DE INSPECTOR DE EQUIPO', icon: '🔍',
              funciones: [
                'Coordina las inspecciones de los equipos y la maquinaria.',
                'Consolida los reportes de estado y condición.',
                'Programa mantenimientos con base en las inspecciones.',
                'Supervisa a inspectores, jefe de patio y choferes asignados.',
              ],
              children: [
                { title: 'Inspector de Equipo', funciones: [
                  'Inspecciona el estado de los equipos y la maquinaria.',
                  'Registra condiciones, herramientas y accesorios de cada equipo.',
                  'Reporta novedades y necesidades de mantenimiento.',
                ] },
                { title: 'Jefe de Patio', funciones: [
                  'Organiza el patio y la ubicación de los equipos.',
                  'Controla las entradas y salidas de maquinaria.',
                  'Coordina a los listeros de patio.',
                ] },
                { title: 'Chofer de Cisternas', funciones: [
                  'Conduce las cisternas de agua o combustible.',
                  'Abastece los frentes de trabajo y cuida el vehículo.',
                  'Cumple las normas de seguridad en la vía.',
                ] },
                { title: 'Operador de Camión Pitman', funciones: [
                  'Opera el camión Pitman para el manejo y traslado de equipos.',
                  'Cuida el equipo y reporta las fallas.',
                ] },
              ],
            },
            {
              title: 'MANTENIMIENTO CORRECTIVO DE MAQUINARIA', icon: '🔧', area: true, bossTitle: 'JEFE DE OPERACIÓN DE MAQUINARIA', children: [
                { title: 'Mecánico', funciones: [
                  'Realiza las reparaciones correctivas de maquinaria y vehículos.',
                  'Diagnostica fallas mecánicas y sustituye piezas.',
                  'Interviene a solicitud, según las fallas reportadas.',
                ] },
                { title: 'Ayudante de Mecánico', funciones: [
                  'Asiste al mecánico y prepara herramientas y repuestos.',
                  'Apoya en las reparaciones y en el orden del taller.',
                ] },
              ],
            },
            {
              title: 'MANTENIMIENTO PREVENTIVO DE MAQUINARIA', icon: '🛢️', area: true, bossTitle: 'JEFE DE OPERACIÓN DE MAQUINARIA', children: [
                {
                  title: 'Coordinador de Mantenimiento Preventivo', funciones: [
                    'Programa y controla el mantenimiento preventivo (aceites, filtros, engrase).',
                    'Lleva el plan de mantenimiento por equipo.',
                    'Supervisa al operador del camión de servicio y a los ayudantes.',
                  ],
                  children: [
                    { title: 'Operador de Camión de Servicio', funciones: [
                      'Opera el camión de servicio para lubricación y mantenimiento en campo.',
                      'Abastece aceites y filtros a los equipos y reporta consumos.',
                    ] },
                    { title: 'Ayudante de Mantenimiento Preventivo', funciones: [
                      'Apoya las labores de mantenimiento preventivo.',
                      'Alista insumos y herramientas y asiste al operador.',
                    ] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ── Índices derivados (jefe, subordinados, área, funciones) ──────────────────
type Meta = { boss: string; area: string; color: string; funciones: string[]; area_flag: boolean };
const META = new Map<string, Meta>();
const ORDER: string[] = []; // orden de recorrido (para el PDF general y el selector)

(() => {
  const walk = (node: OrgNode, bossForChildren: string, areaName: string, color: string) => {
    for (const c of node.children ?? []) {
      const isBranch = c.title === AREA_ADMIN || c.title === AREA_OPER;
      const nextArea = isBranch ? c.title : areaName;
      const nextColor = c.title === AREA_ADMIN ? NAVY : c.title === AREA_OPER ? ORANGE : color;
      if (!c.area) {
        META.set(c.title, { boss: bossForChildren, area: nextArea, color: nextColor, funciones: c.funciones ?? [], area_flag: false });
        ORDER.push(c.title);
      }
      const childBoss = c.area ? (c.bossTitle ?? bossForChildren) : c.title;
      walk(c, childBoss, nextArea, nextColor);
    }
  };
  META.set(ROOT.title, { boss: '—', area: 'Dirección', color: NAVY_DK, funciones: ROOT.funciones ?? [], area_flag: false });
  ORDER.push(ROOT.title);
  walk(ROOT, ROOT.title, 'Dirección', NAVY_DK);
})();

/** Subordinados DIRECTOS de un cargo (inverso del mapa jefe→). */
function subordinadosDe(title: string): string[] {
  return ORDER.filter((t) => META.get(t)?.boss === title);
}

/** Todos los cargos (sin agrupadores), en orden de organigrama. */
export function listaCargos(): { title: string; area: string }[] {
  return ORDER.map((t) => ({ title: t, area: META.get(t)!.area }));
}

// ── Sincronización con la nómina ─────────────────────────────────────────────
const KEYWORDS = ['operador', 'chofer', 'almacen', 'cocin', 'lavaplato', 'electricist', 'mecanic', 'soldador', 'todero', 'motorizado', 'inspector', 'listero', 'obrero', 'analista', 'ayudante', 'coordinador', 'jefe', 'director', 'controlador', 'trafico', 'cisterna', 'pitman', 'patio'];
const SYNONYMS = [
  'administrativo', 'jefe adminitrativo', 'jefe administrativo',
  'coordinador de patio', 'coordinador general',
  'jefe de operaciones de maquinaria', 'jefe de patio',
  'coordinador de operadores', 'coordinador de mantenimiento preventivo',
  'coordinador de electricista', 'coordinador de inspectores', 'coordinador de inspector',
  'coordinador de cocina', 'jefe de cocina', 'encargado de cocina', 'jefe de alimentacion',
  'jefe de administracion', 'jefe de almacen', 'jefe de alimentacion',
];

/** Conjunto normalizado de todos los cargos/títulos ya presentes en la estructura. */
const KNOWN: Set<string> = (() => {
  const s = new Set<string>();
  ORDER.forEach((t) => s.add(norm(t)));
  SYNONYMS.forEach((t) => s.add(norm(t)));
  return s;
})();

/** ¿El cargo ya está ubicado en el organigrama? (por coincidencia exacta o palabra clave) */
export function isCargoUbicado(cargo: string): boolean {
  const n = norm(cargo);
  if (!n) return true;
  if (KNOWN.has(n)) return true;
  return KEYWORDS.some((k) => n.includes(k));
}

/** De una lista de cargos de la nómina, devuelve los que NO están ubicados (por ubicar). */
export function cargosPorUbicar(cargos: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  cargos.forEach((c) => {
    const t = String(c || '').trim();
    if (!t) return;
    const n = norm(t);
    if (seen.has(n) || isCargoUbicado(t)) return;
    seen.add(n);
    out.push(t.toUpperCase());
  });
  return out.sort(cmpText);
}

// ── Render: utilidades ───────────────────────────────────────────────────────
const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Render: DIAGRAMA (dos columnas, estilo corporativo) ──────────────────────
export const ORG_STYLES = `
  *{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Tahoma,Geneva,Verdana,sans-serif;background:#fff;color:#14212E;padding:30px 34px 36px;width:1560px}
  .head{display:flex;align-items:center;gap:16px;margin-bottom:14px}
  .head .logo{height:60px;width:auto}
  .head .date{margin-left:auto;text-align:right;color:#5B6B7B;font-size:12px}
  .title{display:flex;align-items:center;justify-content:center;gap:14px;font-size:27px;font-weight:800;letter-spacing:.6px;color:${NAVY};text-align:center;margin-bottom:20px}
  .title .g{color:#8AA0B8;font-size:24px}
  .apex{display:flex;flex-direction:column;align-items:center;margin-bottom:6px}
  .apexbox{border-radius:10px;color:#fff;text-align:center;font-weight:800;box-shadow:0 3px 8px rgba(20,33,46,.16)}
  .apexbox.dir{background:${NAVY_DK};font-size:18px;padding:12px 34px;letter-spacing:.4px}
  .apexbox.cg{background:${NAVY};font-size:15px;padding:10px 28px;letter-spacing:.3px}
  .apexrail{width:3px;height:16px;background:#B7C4D2}
  .bus{width:60%;height:3px;background:#B7C4D2;margin:2px auto 0}
  .drops{display:flex;justify-content:space-between;width:60%;margin:0 auto}
  .drops span{width:3px;height:14px;background:#B7C4D2}
  .cols{display:flex;gap:26px;align-items:flex-start;margin-top:2px}
  .col{flex:1 1 0;display:flex;flex-direction:column;gap:14px}
  .colhead{display:flex;align-items:center;gap:10px;color:#fff;border-radius:10px;padding:12px 18px;font-size:16px;font-weight:800;letter-spacing:.3px;box-shadow:0 2px 6px rgba(20,33,46,.14)}
  .colhead .ci{font-size:19px}
  .colhead.navy{background:${NAVY}}
  .colhead.orange{background:${ORANGE}}
  .sec{border:1.6px solid;border-radius:11px;background:#fff;overflow:hidden;box-shadow:0 2px 5px rgba(20,33,46,.07)}
  .sechead{display:flex;align-items:center;gap:9px;color:#fff;padding:10px 14px;font-size:13.5px;font-weight:800;letter-spacing:.2px}
  .sechead .ic{font-size:16px}
  .secbody{padding:11px 12px;display:flex;flex-direction:column;gap:8px}
  .leaf{border:1px solid #E1E7EF;border-left:4px solid;border-radius:8px;padding:8px 12px;font-size:12.5px;font-weight:600;color:#1B2B3A;background:#FAFCFE}
  .grp .glab{font-size:12.5px;font-weight:800;color:#1B2B3A;margin-bottom:6px}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{background:#F1F5FA;border:1px solid #D6E0EC;border-radius:999px;padding:4px 11px;font-size:11.5px;font-weight:700;color:#14212E}
  .otros{margin-top:18px;border:2px dashed #C9962B;border-radius:12px;background:#FFFBF2;padding:13px 15px}
  .otros .t{font-size:13px;font-weight:800;color:#9A6B12;margin-bottom:7px}
  .otros .chips .chip{background:#FFF4DA;border-color:#EAD196;color:#7A5310}
  .foot{margin-top:22px;border-top:1px solid #B7C4D2;padding-top:11px;color:#5B6B7B;font-size:11.5px;display:flex;gap:18px;flex-wrap:wrap}
  .legend{display:flex;align-items:center;gap:6px}
  .dot{width:12px;height:12px;border-radius:3px;display:inline-block}
`;

/** Recuadro/leaf de un cargo dentro de una sección; si tiene hijos, van como chips. */
function leafHtml(node: OrgNode, color: string): string {
  const kids = node.children ?? [];
  if (kids.length) {
    return `<div class="leaf grp" style="border-left-color:${color}">
      <div class="glab">${esc(node.title)}</div>
      <div class="chips">${kids.map((k) => `<span class="chip">${esc(k.title)}</span>`).join('')}</div>
    </div>`;
  }
  return `<div class="leaf" style="border-left-color:${color}">${esc(node.title)}</div>`;
}

/** Una sección (hijo directo de una columna) = tarjeta con encabezado de color. */
function seccionHtml(sec: OrgNode, color: string): string {
  const icon = sec.icon ? `<span class="ic">${sec.icon}</span>` : '';
  const cuerpo = (sec.children ?? []).map((c) => leafHtml(c, color)).join('');
  return `<div class="sec" style="border-color:${color}">
    <div class="sechead" style="background:${color}">${icon}${esc(sec.title)}</div>
    <div class="secbody">${cuerpo}</div>
  </div>`;
}

function columnaHtml(branchTitle: string, cls: string, icon: string, color: string): string {
  const branch = (ROOT.children![0].children ?? []).find((n) => n.title === branchTitle)!;
  const secs = (branch.children ?? []).map((s) => seccionHtml(s, color)).join('');
  return `<div class="col">
    <div class="colhead ${cls}"><span class="ci">${icon}</span>${esc(branchTitle)}</div>
    ${secs}
  </div>`;
}

/** Cuerpo (card) del organigrama corporativo. */
export function organigramaCard(): string {
  return `
    <div class="head">
      <img class="logo" src="${LOGO_DATA_URI}" alt="SOS La Guaira"/>
      <div class="date">SOS LA GUAIRA 2026</div>
    </div>
    <div class="title"><span class="g">⚙️</span> ESTRUCTURA ORGANIZACIONAL CORPORATIVA <span class="g">⚙️</span></div>
    <div class="apex">
      <div class="apexbox dir">${esc(ORG_DIRECTOR)}</div>
      <div class="apexrail"></div>
      <div class="apexbox cg">${esc(ORG_GENERAL)}</div>
    </div>
    <div class="apexrail" style="margin:0 auto"></div>
    <div class="bus"></div>
    <div class="drops"><span></span><span></span></div>
    <div class="cols">
      ${columnaHtml(AREA_ADMIN, 'navy', '⚙️', NAVY)}
      ${columnaHtml(AREA_OPER, 'orange', '⚙️', ORANGE)}
    </div>
    <div class="foot">
      <span class="legend"><span class="dot" style="background:${NAVY_DK}"></span> Dirección</span>
      <span class="legend"><span class="dot" style="background:${NAVY}"></span> Administración, servicios y soporte</span>
      <span class="legend"><span class="dot" style="background:${ORANGE}"></span> Operaciones y mantenimiento de maquinaria</span>
    </div>`;
}

/** Documento HTML completo del diagrama (vista previa / PDF y respaldo del PNG). */
export function organigramaHtml(): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title></title>
    <style>@page{size:landscape;margin:8mm}${ORG_STYLES}</style></head>
    <body>${organigramaCard()}</body></html>`;
}

/** Medidas físicas (mm) del lienzo para exportar la imagen PNG. */
export const ORG_SHEET_MM = { w: 413, h: 470 };

// ── Render: FICHAS (funciones + subordinados) ────────────────────────────────
const FICHAS_CSS = `
  .intro{font-size:12px;color:#4B5563;margin:2px 0 14px}
  .grp-h{margin:18px 0 8px;font-size:14px;font-weight:800;color:#fff;padding:8px 14px;border-radius:8px;letter-spacing:.3px}
  .ficha{border:1px solid #E5E7EB;border-left:5px solid;border-radius:10px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid;background:#fff}
  .ficha .fh{display:flex;align-items:center;gap:9px;margin-bottom:6px}
  .ficha .fic{font-size:18px}
  .ficha .ft{font-size:15px;font-weight:800;color:#14212E}
  .ficha .fmeta{font-size:11.5px;color:#4B5563;margin-bottom:9px}
  .ficha .fmeta b{color:#1B2B3A}
  .fbody{display:flex;gap:20px;flex-wrap:wrap}
  .fcol{flex:1 1 300px;min-width:260px}
  .flab{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#6B7280;margin-bottom:5px}
  .fcol ul{margin:0;padding-left:17px}
  .fcol li{font-size:12px;color:#1F2937;margin-bottom:3px;line-height:1.35}
  .subs{display:flex;flex-wrap:wrap;gap:6px}
  .subs .chip{background:#F1F5FA;border:1px solid #D6E0EC;border-radius:999px;padding:4px 11px;font-size:11.5px;font-weight:700;color:#14212E}
  .none{font-size:12px;color:#9CA3AF;font-style:italic}
`;

/** Bloque de ficha de un cargo (funciones + de quién depende + a quién manda). */
function fichaHtml(title: string): string {
  const m = META.get(title);
  if (!m) return '';
  const subs = subordinadosDe(title);
  const icon = ROOT.title === title ? '🏛️' : (findNode(title)?.icon || '👤');
  const fun = m.funciones.length
    ? `<ul>${m.funciones.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
    : `<div class="none">—</div>`;
  const subsHtml = subs.length
    ? `<div class="subs">${subs.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>`
    : `<div class="none">No tiene personal a su cargo.</div>`;
  return `<div class="ficha" style="border-left-color:${m.color}">
    <div class="fh"><span class="fic">${icon}</span><span class="ft">${esc(title)}</span></div>
    <div class="fmeta"><b>Reporta a:</b> ${esc(m.boss)} &nbsp;·&nbsp; <b>Área:</b> ${esc(m.area)} &nbsp;·&nbsp; <b>Personal a cargo:</b> ${subs.length}</div>
    <div class="fbody">
      <div class="fcol"><div class="flab">Funciones</div>${fun}</div>
      <div class="fcol"><div class="flab">Tiene a su cargo</div>${subsHtml}</div>
    </div>
  </div>`;
}

/** Busca un nodo por título en el árbol (para recuperar su ícono). */
function findNode(title: string): OrgNode | null {
  let found: OrgNode | null = null;
  const walk = (n: OrgNode) => {
    if (found) return;
    if (n.title === title) { found = n; return; }
    (n.children ?? []).forEach(walk);
  };
  walk(ROOT);
  return found;
}

/** PDF GENERAL: todos los cargos con sus funciones y subordinados, por área. */
export function fichasHtml(): string {
  const groups: { area: string; color: string; titles: string[] }[] = [];
  ORDER.forEach((t) => {
    const m = META.get(t)!;
    let g = groups.find((x) => x.area === m.area);
    if (!g) { g = { area: m.area, color: m.color, titles: [] }; groups.push(g); }
    g.titles.push(t);
  });
  const body = `
    <div class="intro">Descripción de cargos de <b>SOS LA GUAIRA 2026</b>: funciones de cada cargo, de quién depende y qué personal tiene a su cargo. Estructura alineada con el organigrama corporativo.</div>
    ${groups.map((g) => `
      <div class="grp-h" style="background:${g.color}">${esc(g.area)}</div>
      ${g.titles.map(fichaHtml).join('')}
    `).join('')}`;
  return pdfDoc('Manual de cargos y funciones', 'Funciones y línea de mando por cargo', body);
}

/** Ficha INDIVIDUAL de un cargo. */
export function fichaCargoHtml(title: string): string {
  const m = META.get(title);
  if (!m) return pdfDoc('Ficha de cargo', title, `<div class="intro">No se encontró el cargo “${esc(title)}” en la estructura.</div>`);
  return pdfDoc('Ficha de cargo', `${title} · ${m.area}`, fichaHtml(title));
}

// Membrete propio (para no acoplar organigrama.ts al módulo de pdf.ts).
function pdfDoc(title: string, subtitle: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title></title><style>
    @page{margin:1.6cm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Tahoma,Geneva,Verdana,sans-serif;color:#333;background:#fff}
    @media screen{body{padding:26px 32px}}
    .top{display:flex;align-items:center;gap:14px;border-bottom:4px solid ${NAVY};padding-bottom:12px;margin-bottom:14px}
    .top img{height:58px;width:auto}
    .top h1{font-size:22px;color:${NAVY};letter-spacing:.6px;text-transform:uppercase;margin:0}
    .top .sub{font-size:12px;color:#6B7280;margin-top:3px}
    .top .date{margin-left:auto;text-align:right;font-size:11px;color:#6B7280}
    .foot{margin-top:22px;padding-top:9px;border-top:1px solid #E5E7EB;text-align:center;color:#9CA3AF;font-size:10px}
    tr{page-break-inside:avoid}
    ${FICHAS_CSS}
  </style></head><body>
    <div class="top"><img src="${LOGO_DATA_URI}"/>
      <div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></div>
      <div class="date">SOS LA GUAIRA 2026</div>
    </div>
    ${body}
    <div class="foot">SOS LA GUAIRA 2026 · Documento generado por el sistema de control interno</div>
  </body></html>`;
}
