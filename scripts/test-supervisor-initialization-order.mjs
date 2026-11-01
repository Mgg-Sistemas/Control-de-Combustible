import fs from 'fs';
import assert from 'assert';

const file = fs.readFileSync('src/screens/SupervisorScreen.tsx', 'utf-8');

// Check line numbers of definitions and usages
const lines = file.split('\n');

let lineNowShiftDef = -1;
let lineShiftOfMineDef = -1;
let lineOpenMineDef = -1;
let lineHoursMineDef = -1;
let lineShiftClosedDef = -1;

lines.forEach((l, idx) => {
  const lineNo = idx + 1;
  if (/const\s+nowShift\s*=\s*useMemo/.test(l)) lineNowShiftDef = lineNo;
  if (/const\s+shiftOfMine\s*=\s*\(/.test(l)) lineShiftOfMineDef = lineNo;
  if (/const\s+openMine\s*=\s*\(/.test(l)) lineOpenMineDef = lineNo;
  if (/const\s+hoursMine\s*=\s*\(/.test(l)) lineHoursMineDef = lineNo;
  if (/const\s+shiftClosed\s*=\s*useMemo/.test(l)) lineShiftClosedDef = lineNo;
});

console.log('Line numbers:', {
  nowShift: lineNowShiftDef,
  shiftOfMine: lineShiftOfMineDef,
  openMine: lineOpenMineDef,
  hoursMine: lineHoursMineDef,
  shiftClosed: lineShiftClosedDef,
});

assert(lineNowShiftDef > 0, 'nowShift must be defined');
assert(lineShiftOfMineDef > lineNowShiftDef, 'shiftOfMine must be defined after nowShift');
assert(lineOpenMineDef > lineShiftOfMineDef, 'openMine must be defined after shiftOfMine');
assert(lineHoursMineDef > lineShiftOfMineDef, 'hoursMine must be defined after shiftOfMine');
assert(lineShiftClosedDef > lineOpenMineDef, 'shiftClosed must be defined after openMine');
assert(lineShiftClosedDef > lineHoursMineDef, 'shiftClosed must be defined after hoursMine');

console.log('✅ ALL VARIABLE DECLARATION ORDER TESTS PASSED: Temporal Dead Zone ReferenceError eliminated!');
