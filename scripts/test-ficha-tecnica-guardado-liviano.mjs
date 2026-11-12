// 💾 FICHA TÉCNICA: GUARDADO AUTOMÁTICO LIVIANO (07-nov-2026). El disco de Supabase se llenó
// (2 GB → 8 GB): cada guardado de la ficha reescribe la configuración compartida y deja un
// registro en la auditoría; con 0,8 s de espera y sin comparar, una ficha llenada a mano dejaba
// decenas de registros (1.299 en 24 h). Ahora espera 2,5 s y no guarda si nada cambió.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const s = fs.readFileSync(path.join(ROOT, 'src/components/FichaTecnicaModal.tsx'), 'utf8');
let ok = 0; const fallas = [];
const check = (c, m) => { if (c) ok++; else fallas.push('  ✗ ' + m); };

const prog = s.slice(s.indexOf('const programarGuardado'), s.indexOf('const cancelarGuardadoPendiente'));
check(/}, 2500\);/.test(prog) && !/}, 800\);/.test(prog), '⭐ el guardado automático espera 2,5 s sin escribir (antes 0,8 s)');
check(/guardarSiCambio\(next\)/.test(prog), 'el guardado automático pasa por «solo si cambió»');
check(/if \(huella === ultimoGuardado\.current\) return;/.test(s), '⭐ si la ficha es igual a la última mandada, NO se guarda');
const cerrar = s.slice(s.indexOf('const cerrar = '), s.indexOf('const cerrar = ') + 400);
check(/guardarSiCambio\(data\)/.test(cerrar), 'al cerrar, lo pendiente se guarda (si cambió): no se pierde lo último escrito');
check((s.match(/ultimoGuardado\.current = JSON\.stringify\(finalData\)/g) || []).length === 2, 'el botón Guardar y el PDF siempre guardan y recuerdan lo guardado');

// 📄 BANDEJA DE DOCUMENTOS PDF + GUARDADO LOCAL MIENTRAS ESCRIBES (12-nov-2026)
const sStorage = fs.readFileSync(path.join(ROOT, 'src/lib/fichaTecnicaStorage.ts'), 'utf8');
const sMaquina = fs.readFileSync(path.join(ROOT, 'src/lib/fichaTecnicaMaquina.ts'), 'utf8');
const sPhoto = fs.readFileSync(path.join(ROOT, 'src/lib/photo.ts'), 'utf8');
const sAudit = fs.readFileSync(path.join(ROOT, 'src/lib/auditModulos.ts'), 'utf8');

const fnGuardarSiCambio = s.slice(s.indexOf('const guardarSiCambio'), s.indexOf('const programarGuardado'));
check(
  /saveFichaSoloLocal\(mid, next\)/.test(fnGuardarSiCambio) &&
    !/saveFichaPersonalizada\(/.test(fnGuardarSiCambio),
  '⭐ mientras el usuario escribe, guardarSiCambio guarda SOLO en local (saveFichaSoloLocal) sin golpear tique_config en Supabase',
);
check(
  /limpiarFotosAnexoHuerfanas\(pathsAnexoConocidosRef\.current, finalData\)/.test(s),
  'al guardar en nube o exportar PDF se limpian las fotos ficha-anexo/ huérfanas del Storage',
);
check(
  /useState<'pdfs' \| 'plantilla'>\('pdfs'\)/.test(s),
  'el modal de Ficha Técnica abre por defecto en la pestaña «📄 Documentos PDF»',
);
check(
  /📄 Documentos PDF/.test(s) && /✏️ Plantilla del sistema/.test(s),
  'el modal ofrece las 2 pestañas: «📄 Documentos PDF» y «✏️ Plantilla del sistema»',
);
check(
  /const placaActual = placaDeMaquina\(machine\)/.test(s) && /🏷️ PLACA: \{placaActual\}/.test(s),
  'la cabecera del modal muestra siempre la PLACA de la maquinaria junto al nombre/código',
);
check(
  /📋 Ficha Técnica del Sistema \(Guardada\)/.test(s) &&
    /📥 Guardar como documento en la lista/.test(s) &&
    /🗑️ Eliminar ficha de plantilla/.test(s),
  'las fichas ya creadas en el sistema aparecen en la bandeja con botones para Ver PDF, Guardar en la lista, Editar o Eliminar',
);
check(
  /⚠️ ¿Seguro\? Confirmar/.test(s),
  'eliminar un documento PDF o la ficha de plantilla pide confirmación en 2 toques',
);
check(
  /export async function pickAndUploadFichaPdfFiles/.test(sPhoto) &&
    /export async function removeMachineryStoragePaths/.test(sPhoto) &&
    /fichas-tecnicas-pdf\//.test(sPhoto),
  'photo.ts expone pickAndUploadFichaPdfFiles y removeMachineryStoragePaths bajo fichas-tecnicas-pdf/',
);
check(
  /export function placaDeMaquina/.test(sMaquina) &&
    /export function etiquetaMaquinaConPlaca/.test(sMaquina) &&
    /export function extraerStoragePathsFichaAnexo/.test(sMaquina) &&
    /export function contarFotosFicha/.test(sMaquina) &&
    /export function formatearBytesFicha/.test(sMaquina),
  'fichaTecnicaMaquina.ts expone helpers puros de placa, rutas de anexo, conteo de fotos y formato de bytes',
);
check(
  /export async function listarDocumentosPdfFicha/.test(sStorage) &&
    /export async function registrarDocumentosPdfSubidos/.test(sStorage) &&
    /export async function guardarSnapshotPlantillaEnDocumentos/.test(sStorage) &&
    /export async function renombrarDocumentoPdfFicha/.test(sStorage) &&
    /export async function eliminarDocumentoPdfFicha/.test(sStorage) &&
    /anulado_at/.test(sStorage) &&
    !/\.delete\(\)/.test(sStorage),
  'fichaTecnicaStorage.ts gestiona ficha_tecnica_documentos con anulado_at (cero DELETE en SQL) y borrado físico en Storage',
);
check(
  /'ficha_tecnica_documentos'/.test(sAudit) && /ficha_tecnica_documentos:\s*'equipos'/.test(sAudit),
  'auditModulos.ts registra ficha_tecnica_documentos en el módulo equipos',
);

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-ficha-tecnica-guardado-liviano: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-ficha-tecnica-guardado-liviano: ${ok} ok, 0 fallas`);
