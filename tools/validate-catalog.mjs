#!/usr/bin/env node
/* Valida data/catalog.js antes de publicarlo.
 *
 *   node tools/validate-catalog.mjs
 *
 * No reemplaza a tests/: aquellos verifican la logica del sitio contra un
 * fixture. Este verifica LOS DATOS que se van a publicar. Corre en CI despues
 * del export, para que un dato roto en Airtable no llegue al sitio.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// data/catalog.js es un archivo de navegador: asigna window.CATALOG.
globalThis.window = globalThis.window || {};
new Function(readFileSync(resolve(root, 'data', 'catalog.js'), 'utf8'))();
const raw = globalThis.window.CATALOG;

const problems = [];
const fail = (m) => problems.push(m);

if (!raw || !Array.isArray(raw.games)) fail('No hay un array "games".');
else {
  if (raw.games.length === 0) fail('El catalogo esta vacio.');

  const ids = new Set();
  for (const [i, g] of raw.games.entries()) {
    const where = `games[${i}] (${g && g.name ? g.name : 'sin nombre'})`;
    if (!g || typeof g !== 'object') { fail(`${where}: no es un objeto.`); continue; }
    if (!g.id) fail(`${where}: sin id.`);
    else if (ids.has(g.id)) fail(`${where}: id duplicado ${g.id}.`);
    else ids.add(g.id);
    if (!g.name || !String(g.name).trim()) fail(`${where}: sin name.`);
    for (const k of ['genre', 'perspective', 'mode']) {
      // Vacio es valido; lo que no vale es que falte la clave o no sea string.
      if (typeof g[k] !== 'string') fail(`${where}: "${k}" deberia ser string (es ${typeof g[k]}).`);
    }
  }

  const slugs = new Set();
  for (const [i, c] of (raw.collections || []).entries()) {
    const where = `collections[${i}] (${c && c.slug ? c.slug : 'sin slug'})`;
    if (!c.slug) fail(`${where}: sin slug.`);
    else if (slugs.has(c.slug)) fail(`${where}: slug duplicado.`);
    else slugs.add(c.slug);
    if (!/^[a-z0-9-]+$/.test(c.slug || '')) fail(`${where}: el slug solo admite minusculas, numeros y guiones.`);
    if (!Array.isArray(c.games) || c.games.length === 0) fail(`${where}: sin juegos.`);
    for (const id of c.games || []) {
      if (!ids.has(id)) fail(`${where}: referencia el id ${id}, que no esta en games.`);
    }
  }
}

// Que el nucleo del sitio pueda digerirlo, con sus propias reglas.
if (problems.length === 0) {
  try {
    const Core = require(resolve(root, 'assets', 'core.js'));
    const cat = Core.normalizeCatalog(raw);
    if (!cat.games || cat.games.length === 0) fail('normalizeCatalog() devolvio un catalogo vacio.');
    else {
      console.log(`   ${cat.games.length} titulos`);
      for (const k of ['genre', 'perspective', 'mode']) {
        const v = (cat.vocabulary && cat.vocabulary[k]) || [];
        console.log(`   ${v.length} valores de ${k}`);
      }
      console.log(`   ${(cat.collections || []).length} colecciones`);
    }
  } catch (err) {
    fail(`El nucleo del sitio no pudo procesar el catalogo: ${err.message}`);
  }
}

if (problems.length) {
  console.error('\nCatalogo INVALIDO. No se publica:\n');
  for (const p of problems.slice(0, 40)) console.error('  - ' + p);
  if (problems.length > 40) console.error(`  ... y ${problems.length - 40} problemas mas.`);
  process.exit(1);
}
console.log('\nCatalogo valido.');
