// 🧪 PRUEBA: buscador de frentes en FrentesTrabajo (filtrado por nombre)
// Verifica que al buscar un frente por nombre, solo coincidan los que contienen el texto.

const frentes = [
  { id: '1', nombre: 'Frente Norte', activo: true },
  { id: '2', nombre: 'Frente Sur', activo: true },
  { id: '3', nombre: 'Centro Industrial', activo: true },
  { id: '4', nombre: 'Este', activo: false },
  { id: '5', nombre: 'RES. CORAL', activo: true },
  { id: '6', nombre: 'Residencia Coral Garden', activo: true },
];

function activosDe(todos) {
  return todos.filter((f) => f.activo);
}

function filtrarFrentes(activos, q) {
  const nq = q.trim().toLowerCase();
  if (!nq) return activos;
  return activos.filter((f) => f.nombre.toLowerCase().includes(nq));
}

let fallos = 0;

function ok(nombre, condicion) {
  if (condicion) {
    console.log(`✅ ${nombre}`);
  } else {
    console.log(`❌ ${nombre}`);
    fallos++;
  }
}

const activos = activosDe(frentes);
ok('todos los activos sin filtro', filtrarFrentes(activos, '').length === 5);
ok('buscar "frente" devuelve 2', filtrarFrentes(activos, 'frente').length === 2);
ok('buscar "norte" devuelve 1', filtrarFrentes(activos, 'norte').length === 1);
ok('buscar "coral" devuelve 2 (RES. CORAL + Residencia Coral Garden)', filtrarFrentes(activos, 'coral').length === 2);
ok('buscar "este" devuelve 0 (está desactivado)', filtrarFrentes(activos, 'este').length === 0);
ok('buscar con mayúsculas "NORTE" devuelve 1', filtrarFrentes(activos, 'NORTE').length === 1);
ok('buscar con espacios "  norte  " devuelve 1', filtrarFrentes(activos, '  norte  ').length === 1);
ok('buscar "inexistente" devuelve 0', filtrarFrentes(activos, 'inexistente').length === 0);

if (fallos > 0) {
  console.log(`\n${fallos} PRUEBA(S) FALLARON`);
  process.exit(1);
} else {
  console.log('\nTodas las pruebas pasaron');
}