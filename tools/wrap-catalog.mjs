#!/usr/bin/env node
/* Convierte un catalog.json plano en el data/catalog.js que consume el sitio.
 *
 *   node tools/wrap-catalog.mjs mi-catalogo.json
 *
 * Valida que sea JSON parseable y escribe data/catalog.js con el envoltorio.
 * No instala nada y no es un paso de build del sitio: el sitio se sirve tal cual
 * este en el repo. Es solo una comodidad para no envolver el archivo a mano.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2];
const output = process.argv[3] || resolve(here, '..', 'data', 'catalog.js');

if (!input) {
  console.error('uso: node tools/wrap-catalog.mjs <catalog.json> [salida.js]');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(resolve(process.cwd(), input), 'utf8'));
} catch (err) {
  console.error('JSON invalido en ' + input + ': ' + err.message);
  process.exit(1);
}

if (!Array.isArray(data.games)) {
  console.error('El archivo no tiene un array "games". No se escribe nada.');
  process.exit(1);
}

const header = '/* Generado por tools/wrap-catalog.mjs — no editar a mano.\n' +
  ' * Contenido: el catalog.json provisto por el operador, tal cual.\n' +
  ' */\n';
writeFileSync(output, header + 'window.CATALOG = ' + JSON.stringify(data, null, 2) + ';\n', 'utf8');

const cols = Array.isArray(data.collections) ? data.collections.length : 0;
console.log('ok: ' + data.games.length + ' titulos, ' + cols + ' colecciones -> ' + output);
