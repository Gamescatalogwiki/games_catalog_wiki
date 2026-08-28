/* gamescatalog.wiki — capa de UI.
 * Toda la logica de datos y de URL vive en core.js. Este archivo solo pinta.
 */
(function () {
  'use strict';

  var Core = window.CatalogCore;
  var ATTRS = Core.ATTRS;
  var GENRE_VISIBLE = 12;   /* cuantos generos se muestran antes de colapsar la cola */
  var PAGE = 100;           /* filas por tanda */

  var catalog = null;
  var view = null;
  var shown = PAGE;
  var genreQuery = '';
  var genreExpanded = false;

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k in node && k !== 'list') node[k] = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) node.appendChild(k); });
    return node;
  }

  function show(node, visible) { if (node) node.hidden = !visible; }

  /* ------------------------------------------------------------------ carga -- */

  function boot(raw) {
    catalog = Core.normalizeCatalog(raw);
    if (catalog.warnings.length) {
      console.warn('[gamescatalog] avisos al leer el catalogo:');
      catalog.warnings.forEach(function (w) { console.warn('  · ' + w); });
    }
    buildStatic();
    wire();
    render();
  }

  function failLoad(msg) {
    var box = $('loaderr');
    box.textContent = 'No se pudo cargar el catalogo: ' + msg;
    box.hidden = false;
  }

  if (window.CATALOG) {
    boot(window.CATALOG);
  } else if (window.fetch) {
    /* Respaldo por si el operador prefiere dejar un catalog.json plano en /data.
     * Servido por HTTP funciona; abierto con file:// el navegador lo bloquea. */
    fetch('data/catalog.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(boot)
      .catch(function (e) {
        failLoad('no aparece data/catalog.js y data/catalog.json no pudo leerse (' + e.message + ').');
      });
  } else {
    failLoad('no aparece data/catalog.js.');
  }

  /* --------------------------------------------------------------- estatico -- */

  function buildStatic() {
    var stats = [
      [catalog.games.length, 'Titles indexed'],
      [catalog.vocabulary.genre.length, 'Genres'],
      [catalog.vocabulary.mode.length, 'Modes']
    ];
    /* Si todavia no hay selecciones en el archivo, no mostramos un cero. */
    if (catalog.collections.length) {
      stats.splice(2, 0, [catalog.collections.length, 'Categories']);
    }
    var box = $('hero-stats');
    box.textContent = '';
    stats.forEach(function (s) {
      box.appendChild(el('div', { class: 'stat' }, [
        el('b', { text: String(s[0]) }),
        el('span', { text: s[1] })
      ]));
    });

    /* Tarjetas de colecciones */
    var grid = $('collection-grid');
    grid.textContent = '';
    catalog.collections.forEach(function (col) {
      /* Sin descripcion: la tarjeta es nombre, cantidad y titulos. */
      var titles = col.games.map(function (id) { return catalog.byId[id].name; });
      grid.appendChild(el('a', { class: 'cat', href: '?c=' + encodeURIComponent(col.slug) }, [
        el('div', { class: 'cat-top' }, [
          el('span', { class: 'cat-name', text: col.title }),
          el('span', { class: 'cat-n', text: String(col.games.length) })
        ]),
        el('p', { class: 'cat-eg', text: titles.slice(0, 6).join(' · ') })
      ]));
    });

    /* Chips: los generos mas numerosos, derivados del archivo */
    var chips = $('genre-chips');
    chips.textContent = '';
    catalog.vocabulary.genre.slice(0, 12).forEach(function (o) {
      var chip = el('button', { class: 'chip', type: 'button' }, [
        document.createTextNode(o.value),
        el('b', { text: String(o.count) })
      ]);
      chip.addEventListener('click', function () {
        var next = Core.emptyState();
        next.filters.genre = [o.value];
        go(next);
      });
      chips.appendChild(chip);
    });
  }

  /* ------------------------------------------------------------------- ruteo -- */

  function currentState() { return Core.parseQuery(location.search); }

  function go(state, replace) {
    var url = Core.serializeState(state) || location.pathname;
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    render();
  }

  window.addEventListener('popstate', function () { render(); });

  /* -------------------------------------------------------------------- UI --- */

  function wire() {
    $$('[data-search]').forEach(function (input) {
      input.addEventListener('input', function () {
        var val = input.value;
        $$('[data-search]').forEach(function (o) { if (o !== input) o.value = val; });
        clearTimeout(wire._t);
        wire._t = setTimeout(function () {
          go(Core.setSearch(currentState(), val), true);
        }, 120);
      });
    });

    $('genre-search').addEventListener('input', function () {
      genreQuery = Core.fold(this.value.trim());
      renderFilters();
    });

    $('genre-toggle').addEventListener('click', function () {
      genreExpanded = !genreExpanded;
      renderFilters();
    });

    $('clear').addEventListener('click', function () { go(Core.clearAll()); });

    $('more').addEventListener('click', function () {
      shown += PAGE;
      renderRows();
    });

    /* Links internos: navegacion sin recarga */
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest ? ev.target.closest('a[href]') : null;
      if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      var href = a.getAttribute('href');
      if (!href || /^https?:/.test(href)) return;

      if (href.indexOf('?c=') === 0) {
        ev.preventDefault();
        go(Core.openCollection(decodeURIComponent(href.slice(3))));
        return;
      }
      var nav = a.getAttribute('data-nav');
      if (nav) {
        ev.preventDefault();
        go(Core.clearAll());
        scrollToSection(nav);
      }
    });
  }

  /* El header es sticky: si mandamos la seccion al tope de la ventana queda tapada
   * por la barra y parece que el link no hizo nada. Descontamos su altura.
   * Ademas go() acaba de rehacer la grilla, asi que la pagina cambia de alto: hay
   * que medir en el frame siguiente o el scroll cae en el lugar equivocado. */
  function scrollToSection(nav) {
    if (nav === 'home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    var target = $(nav === 'browse' ? 'browse' : nav === 'collections' ? 'collections' : 'about');
    /* Si todavia no hay selecciones en el archivo de datos, esa seccion esta oculta:
     * mandamos a la grilla en vez de dejar el click sin efecto. */
    if (!target || target.hidden) target = $('browse');
    if (!target) return;

    var run = function () {
      var bar = document.querySelector('header');
      var alto = bar ? bar.getBoundingClientRect().height : 0;
      var top = target.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop) - alto - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else run();
  }

  function toggle(attr, value) {
    go(Core.toggleFilter(catalog, currentState(), attr, value));
  }

  function render() {
    var state = currentState();
    view = Core.resolve(catalog, state);

    /* Si el recorte de filtros es exactamente el de una categoria curada, la vista es
     * la categoria: se muestra su lista y la URL pasa a ser la suya, que es la que
     * conviene compartir. Se reemplaza la entrada del historial para no dejar dos
     * pasos que van al mismo lugar. */
    if (view.curatedMatch) {
      go(Core.openCollection(view.curatedMatch.slug), true);
      return;
    }

    shown = PAGE;

    var q = state.q;
    /* Nunca reescribimos el campo que la persona esta usando: si lo hicieramos, cada
     * espacio que escribe se le borraria y no podria tipear nombres de dos palabras. */
    $$('[data-search]').forEach(function (i) {
      if (i !== document.activeElement && i.value !== q) i.value = q;
    });

    var isCollection = view.mode === 'collection';
    var active = isCollection || Core.hasFilters(state) || !!q;

    /* El hero se oculta al buscar, pero tiene un buscador adentro: si lo escondemos con el
     * foco puesto ahi, la persona pierde el cursor a la primera letra. Pasamos el foco al
     * buscador del panel, con el mismo texto y el cursor al final, antes de ocultarlo. */
    var hero = $('hero');
    if (active && !hero.hidden && hero.contains(document.activeElement)) {
      var dest = $('q-panel');
      dest.value = q;
      dest.focus();
      try { dest.setSelectionRange(q.length, q.length); } catch (e) {}
    }
    show(hero, !active);
    show($('collections'), !active && catalog.collections.length > 0);
    show($('top-genres'), !active && catalog.vocabulary.genre.length > 0);
    show($('clear'), active);
    $('clear').textContent = isCollection ? 'Leave selection' : 'Clear filters';

    /* Encabezado de la vista */
    show($('viewhead'), active);
    if (active) {
      if (isCollection) {
        /* El nombre lo pone el exportador, ya en ingles. */
        $('view-title').textContent = view.collection.title;
        $('view-blurb').textContent = '';
        show($('view-blurb'), false);
      } else {
        $('view-title').textContent = view.requestedCollection
          ? 'Selection not found'
          : 'Filtered titles';
        $('view-blurb').textContent = view.requestedCollection
          ? 'That selection is not in this catalogue any more. Showing the full list instead.'
          : '';
        show($('view-blurb'), !!$('view-blurb').textContent);
      }
    }

    renderCount();
    renderActiveTags();
    renderFilters();
    renderRows();
  }

  function renderCount() {
    var n = view.count;
    var txt = n + (n === 1 ? ' title' : ' titles');
    if (view.mode === 'collection' && view.searchApplied && view.count !== view.collectionSize) {
      txt = n + ' of ' + view.collectionSize + ' in this selection';
    } else if (view.mode === 'free' && (Core.hasFilters(view.state) || view.searchApplied)) {
      txt = n + ' of ' + view.total + ' titles';
    }
    $('cnt').textContent = txt;
  }

  function renderActiveTags() {
    var box = $('activefilters');
    box.textContent = '';
    var state = view.state;
    var painted = paintedFilters();
    var any = false;

    ATTRS.forEach(function (attr) {
      painted[attr].forEach(function (value) {
        any = true;
        var tag = el('button', { class: 'tag', type: 'button', title: 'Remove this filter' }, [
          document.createTextNode(value),
          el('i', { text: '×' })
        ]);
        tag.addEventListener('click', function () { toggle(attr, value); });
        box.appendChild(tag);
      });
    });
    show(box, any);
    return state;
  }

  /* Dentro de una seleccion no se pinta ningun filtro: la lista es la lista, y los
   * valores que la originaron no se muestran. Fuera de ella, los del filtrado libre. */
  function paintedFilters() {
    if (view.mode === 'collection') return { genre: [], perspective: [], mode: [] };
    return view.state.filters;
  }

  function renderFilters() {
    var painted = paintedFilters();

    ATTRS.forEach(function (attr) {
      var ul = document.querySelector('[data-filter-list="' + attr + '"]');
      var selected = painted[attr];
      var options = Core.optionsFor(catalog, attr, selected);

      if (attr === 'genre') {
        if (genreQuery) {
          options = options.filter(function (o) { return Core.fold(o.value).indexOf(genreQuery) !== -1; });
        }
        /* Los seleccionados siempre visibles, aunque vivan en la cola larga. */
        var sel = options.filter(function (o) { return selected.indexOf(o.value) !== -1; });
        var rest = options.filter(function (o) { return selected.indexOf(o.value) === -1; });
        options = sel.concat(rest);
      }

      var total = options.length;
      var limited = options;
      if (attr === 'genre' && !genreExpanded && !genreQuery && total > GENRE_VISIBLE) {
        limited = options.slice(0, Math.max(GENRE_VISIBLE, painted.genre.length));
      }

      ul.textContent = '';
      ul.className = (attr === 'genre' && (genreExpanded || genreQuery)) ? 'scroll' : '';

      if (!limited.length) {
        ul.appendChild(el('li', { class: 'nores', text: 'No matching values' }));
      }

      limited.forEach(function (o) {
        var on = selected.indexOf(o.value) !== -1;
        var input = el('input', { type: 'checkbox', checked: on });
        input.addEventListener('change', function () { toggle(attr, o.value); });
        var li = el('li', { class: (on ? 'on ' : '') + (o.count === 0 ? 'zero' : '') }, [
          el('label', {}, [
            input,
            el('span', { class: 'v', text: o.value, title: o.value }),
            el('em', { text: String(o.count) })
          ])
        ]);
        ul.appendChild(li);
      });

      if (attr === 'genre') {
        var btn = $('genre-toggle');
        var hidden = total - limited.length;
        if (genreQuery) { show(btn, false); }
        else if (genreExpanded) { show(btn, true); btn.textContent = 'Show fewer genres'; }
        else if (hidden > 0) { show(btn, true); btn.textContent = 'Show ' + hidden + ' more genres'; }
        else { show(btn, false); }
      }
    });
  }

  /* Un atributo puede traer varios valores. Cada uno se pinta por separado y filtra solo. */
  function attrCell(game, attr) {
    var vals = game[attr];
    if (!vals.length) {
      return el('td', { class: 'attr' }, [el('span', { class: 'none', text: '—', title: 'No value in the data' })]);
    }
    var td = el('td', { class: 'attr', title: vals.join(', ') });
    vals.forEach(function (v, i) {
      if (i) td.appendChild(document.createTextNode(', '));
      var btn = el('button', { type: 'button', text: v, title: 'Filter by ' + v });
      btn.addEventListener('click', function () { toggle(attr, v); });
      td.appendChild(btn);
    });
    return td;
  }

  function renderRows() {
    var tbody = $('rows');
    var slice = view.games.slice(0, shown);
    tbody.textContent = '';

    slice.forEach(function (g) {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [el('span', { class: 'gt', text: g.name, title: g.name })]),
        attrCell(g, 'genre'),
        attrCell(g, 'perspective'),
        attrCell(g, 'mode')
      ]));
    });

    show($('empty'), view.games.length === 0);
    show($('more-wrap'), view.games.length > slice.length);
  }
})();
