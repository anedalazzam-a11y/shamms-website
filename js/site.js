/* ============================================================
   SHAMMS – UI-Verhalten (Menue + Prompt kopieren)
   Kein Framework, keine Abhaengigkeiten. Jede Funktion ist ein
   No-Op, wenn ihre Elemente auf der Seite fehlen – die Datei wird
   auf Landingpages UND auf allen Rechtsseiten geladen.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Mobiles Menue -------------------------------------- */
  function initNav() {
    var nav = document.querySelector('.nav');
    var toggle = document.querySelector('.nav-toggle');
    if (!nav || !toggle) return;

    var panel = document.getElementById('nav-panel');
    var labelOpen = toggle.getAttribute('data-label-open') || 'Menü öffnen';
    var labelClose = toggle.getAttribute('data-label-close') || 'Menü schließen';

    function setOpen(open) {
      nav.setAttribute('data-nav-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? labelClose : labelOpen);
    }

    setOpen(false);

    toggle.addEventListener('click', function () {
      setOpen(nav.getAttribute('data-nav-open') !== 'true');
    });

    // Nach Klick auf einen Menuepunkt schliessen (Anker bleibt nutzbar)
    if (panel) {
      panel.addEventListener('click', function (e) {
        var a = e.target.closest ? e.target.closest('a') : null;
        if (a) setOpen(false);
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.getAttribute('data-nav-open') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    document.addEventListener('click', function (e) {
      if (nav.getAttribute('data-nav-open') !== 'true') return;
      if (!nav.contains(e.target)) setOpen(false);
    });

    // Beim Wechsel auf Desktop zuruecksetzen, sonst bleibt der Zustand haengen
    var mq = window.matchMedia('(min-width: 901px)');
    var onChange = function (ev) { if (ev.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------- Prompt-Ausschnitte kopieren ------------------------ */
  function initCopy() {
    var buttons = document.querySelectorAll('.copy-btn[data-copy-target]');
    if (!buttons.length) return;

    function fallback(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var el = document.getElementById(btn.getAttribute('data-copy-target'));
        if (!el) return;
        var text = (el.innerText || el.textContent || '').trim();

        var bar = btn.parentNode;
        var status = bar && bar.querySelector ? bar.querySelector('[role="status"]') : null;
        var doneLabel = btn.getAttribute('data-copied') || 'Kopiert';

        function done(ok) {
          if (!ok) return;
          btn.classList.add('is-done');
          // Screenreader bekommen die Rueckmeldung ueber role="status".
          if (status) status.textContent = doneLabel;
          window.setTimeout(function () {
            btn.classList.remove('is-done');
            if (status) status.textContent = '';
          }, 2200);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); },
            function () { done(fallback(text)); });
        } else {
          done(fallback(text));
        }
      });
    });
  }

  /* ---------- Widerrufs-Zustimmung (§ 356 Abs. 5 / Abs. 6 BGB) --- */
  /* Der Checkout von Lemon Squeezy kann keine Zustimmung abfragen.
     Deshalb holen wir sie hier ein und geben den Kauf-Button erst
     frei, wenn sie gesetzt ist. Ohne gesetzte Zustimmung wird kein
     Kauf ausgeloest. */
  function initConsent() {
    var boxes = document.querySelectorAll('input[data-consent-gate]');
    if (!boxes.length) return;

    Array.prototype.forEach.call(boxes, function (box) {
      var id = box.id;
      var btn = id ? document.querySelector('[data-gated-by="' + id + '"]') : null;
      if (!btn) return;

      var label = box.closest ? box.closest('.consent') : null;
      var baseHref = btn.getAttribute('href') || '';
      var decl = btn.getAttribute('data-consent-declaration') || '';
      var kind = box.getAttribute('data-consent-kind') || 'digital';

      function apply() {
        var on = box.checked;
        btn.setAttribute('aria-disabled', on ? 'false' : 'true');
        if (label) {
          if (on) {
            label.classList.add('is-on');
            label.classList.remove('is-off');
          } else {
            label.classList.add('is-off');
            label.classList.remove('is-on');
          }
        }
        // Bei Services geht die Anfrage per E-Mail: die Zustimmung wird
        // in den Nachrichtentext geschrieben, damit sie dokumentiert ist.
        if (kind === 'service' && baseHref.indexOf('mailto:') === 0 && decl) {
          btn.setAttribute('href', on ? baseHref + '&body=' + encodeURIComponent(decl) : baseHref);
        }
      }

      box.addEventListener('change', apply);

      btn.addEventListener('click', function (e) {
        if (box.checked) return;
        e.preventDefault();

        // Buttons ausserhalb der Produktkarte (z. B. CTA-Baender) fuehren
        // zur zugehoerigen Karte, damit die Zustimmung dort gesetzt wird.
        var scrollTo = btn.getAttribute('data-gate-scroll');
        if (scrollTo) {
          var target = document.querySelector(scrollTo);
          if (target && target.scrollIntoView) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }

        var hint = document.querySelector('[data-consent-hint-for="' + id + '"]');
        if (hint) hint.hidden = false;
        box.focus();
      });

      apply();
    });
  }

  /* ---------- Fade-in beim Scrollen ----------------------------- */
  /* Die Klasse .reveal wird ausschliesslich per JS gesetzt. Ohne JS
     bleibt alles sichtbar (kein Inhaltsverlust). */
  function initReveal() {
    var nodes = document.querySelectorAll(
      'section, .product-card, .benefit-card, .preview-card, .step, .foot-col');
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    Array.prototype.forEach.call(nodes, function (n) { n.classList.add('reveal'); });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });

    Array.prototype.forEach.call(nodes, function (n) { io.observe(n); });
  }

  /* ---------- Zahlen hochzaehlen (nur echte Werte) --------------- */
  function initCounters() {
    var els = document.querySelectorAll('[data-count]');
    if (!els.length || !('IntersectionObserver' in window)) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function run(el) {
      var target = parseInt(el.getAttribute('data-count'), 10);
      if (isNaN(target)) return;
      if (reduce) { el.textContent = String(target); return; }
      var start = null, dur = 1100;
      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(step); else el.textContent = String(target);
      }
      requestAnimationFrame(step);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        run(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.6 });

    Array.prototype.forEach.call(els, function (el) { io.observe(el); });
  }

  /* ---------- Sticky-Header: Schatten nach dem Scrollen ---------- */
  function initStickyHeader() {
    var h = document.querySelector('header.nav');
    if (!h) return;
    function onScroll() { h.classList.toggle('is-stuck', window.scrollY > 8); }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    initNav();
    initCopy();
    initConsent();
    initReveal();
    initCounters();
    initStickyHeader();
  });
})();
