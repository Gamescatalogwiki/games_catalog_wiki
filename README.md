# gamescatalog.wiki

Catálogo estático de videojuegos de PC: filtrado por perspectiva de cámara, género y modo de
juego, más colecciones editoriales con URL propia.

El sitio no consulta ninguna API, no tiene backend, ni cookies, ni analytics, ni una sola
referencia a un host externo. Es HTML, CSS y JavaScript propios leyendo un archivo de datos.

## Estructura

```
index.html            la única página
assets/styles.css     estilos
assets/core.js        modelo de datos + ruteo por URL (no sabe nada de la UI)
assets/app.js         la UI (no decide nada de negocio)
data/catalog.js       ← EL ÚNICO ARCHIVO QUE SE TOCA PARA ACTUALIZAR
tools/wrap-catalog.mjs   convierte tu catalog.json en data/catalog.js
tests/                verificación automática de los criterios de aceptación
```

No hay proceso de build. Lo que está en el repo es exactamente lo que se sirve.

## Actualizar el catálogo

1. Generá tu `catalog.json` como siempre.
2. Corré:

   ```
   node tools/wrap-catalog.mjs catalog.json
   ```

   Eso escribe `data/catalog.js`, que es el mismo JSON con una línea de envoltorio
   (`window.CATALOG = {...}`). El envoltorio existe para que el sitio también funcione
   abriendo `index.html` con doble clic, sin servidor.
3. Commiteá `data/catalog.js`.

No hay que tocar ninguna otra línea. Los géneros, perspectivas, modos, contadores, colecciones,
estadísticas del home y chips salen todos del archivo.

> Si preferís servir un `.json` plano, dejá `data/catalog.json` y borrá `data/catalog.js`:
> el sitio lo levanta por `fetch` como respaldo. Eso funciona por HTTP (GitHub Pages incluido)
> pero no abriendo el HTML con doble clic, porque el navegador bloquea `fetch` sobre `file://`.

## Contrato de datos

```json
{
  "version": "2026-08-19",
  "games": [
    { "id": "a1b2c3d4", "name": "Portal 2", "genre": "Platform",
      "perspective": "First Person", "mode": "Singleplayer" }
  ],
  "collections": [
    { "slug": "tactical-military", "title": "Tactical & Military Shooters",
      "blurb": "Texto corto de una o dos líneas.",
      "filters": { "perspective": ["First Person"], "genre": ["FPS", "Tactical Shooter"] },
      "games": ["a1b2c3d4", "e5f6a7b8"] }
  ]
}
```

Reglas que el sitio respeta, y conviene tener presentes al armar el feed:

- **`id` es opaco.** No se muestra ni se deriva de nada. Tiene que ser estable entre versiones,
  porque es lo que referencian las colecciones.
- **`genre`, `perspective` y `mode` pueden venir vacíos.** El título aparece igual en la grilla,
  con un guión en esa columna, y queda fuera de los filtros de ese atributo. No se lo agrupa bajo
  ninguna etiqueta inventada.
- **El vocabulario sale del archivo.** No hay listas de géneros en el código. Las opciones se
  ordenan por cantidad de títulos; el filtro de género tiene buscador y colapsa la cola larga
  después de los primeros 12 valores.
- **Las variantes no se unifican.** `Platform` y `Platformer` son dos opciones distintas. Si las
  querés fusionar, hacelo en el feed.
- **Un valor no puede contener una coma**, porque la URL separa valores por coma. Si aparece uno,
  el sitio lo avisa por consola al cargar.

## Agregar una colección

Agregá una entrada a `collections`:

```json
{
  "slug": "survival-coop",
  "title": "Survival & Co-op",
  "blurb": "Supervivencia, exploración y terror para jugar acompañado.",
  "filters": { "perspective": ["First Person"], "genre": ["Survival Horror"] },
  "games": ["c1d883", "20ff5e"]
}
```

- El `slug` es la URL: `https://gamescatalog.wiki/?c=survival-coop`. Poné algo corto y estable;
  si lo cambiás, los links viejos dejan de funcionar.
- **`games` define qué se muestra. `filters` no.** La colección muestra exactamente esos ids, en
  ese orden, aunque filtrar por esos mismos valores devuelva otro conjunto. `filters` solo sirve
  para dejar los controles pintados cuando alguien abre la colección, y para que al tocar un
  filtro se salga de la colección heredando ese recorte.
- Un id que no exista en `games` se ignora y se avisa por consola. Una colección con `filters`
  vacío es válida.
- Las colecciones aparecen solas en el home, en el orden en que estén en el archivo.

## Probar en local

Doble clic en `index.html` alcanza. Si preferís servirlo por HTTP:

```
python3 -m http.server 8000
```

y abrí `http://localhost:8000`.

## Publicar

Repositorio: `Pelucoin2000/gamecatalog-wiki`. Dominio: `gamescatalog.wiki`.

1. Subí todos los archivos del repo, incluido `CNAME` (ya está en la raíz con el dominio adentro).
2. *Settings → Pages*: source `Deploy from a branch`, rama principal, carpeta `/ (root)`.
3. En *Custom domain* escribí `gamescatalog.wiki` y guardá.
4. En GoDaddy (*Mis productos → DNS → Administrar zonas*), borrá el registro A de parking que
   viene por defecto en `@`, apagá el reenvío de dominio si está activo, y agregá:

   ```
   A       @     185.199.108.153
   A       @     185.199.109.153
   A       @     185.199.110.153
   A       @     185.199.111.153
   CNAME   www   pelucoin2000.github.io
   ```

   Opcional, para IPv6: cuatro registros AAAA en `@` con `2606:50c0:8000::153`,
   `2606:50c0:8001::153`, `2606:50c0:8002::153` y `2606:50c0:8003::153`.
5. Cuando GitHub termine de emitir el certificado, tildá **Enforce HTTPS** en *Settings → Pages*.
   Hasta que eso pase puede tirar errores de dominio; casi siempre es propagación de DNS, no
   configuración mal hecha.

`www.gamescatalog.wiki` queda redirigiendo al dominio pelado solo, sin configurar nada más.

## Tests

Opcionales, para desarrollo. El sitio no los necesita para funcionar.

```
node tests/core.test.mjs        # modelo de datos y ruteo, sin dependencias
npm install                     # solo para el siguiente (instala Playwright)
node tests/browser.test.mjs     # los 6 criterios de aceptación en Chromium
```

`tests/make-big-fixture.mjs` genera un catálogo sintético de 430 títulos y 53 géneros con cola
larga, para probar la UI con la forma real de los datos.
