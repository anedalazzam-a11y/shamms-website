/* ============================================================
   SHAMMS CONSENT BANNER  ·  Version 2026-10-10
   ------------------------------------------------------------
   Warum diese Datei existiert
   ---------------------------
   Der Cookie-Hinweis lag bisher als Markup UND als Inline-Skript
   ausschliesslich in index.html. Der Meta-Pixel laeuft aber nur,
   wenn die Einwilligung auf JEDER Seite erteilt werden kann —
   sonst bleibt er auf allen Unterseiten im Consent-Mode blockiert
   (fbq('consent','revoke')) und es wird kein einziges Event
   gesendet.

   Dieses Skript erzeugt den Hinweis auf jeder Seite identisch.
   Die Gestaltung liegt vollstaendig in css/shamms-system.css
   (#cb-banner, .cb-*), es wird hier kein CSS dupliziert.

   Verhalten
   ---------
   * Kein Banner, wenn bereits entschieden wurde
     (localStorage 'shamms_consent' = granted | denied).
   * "Akzeptieren" -> shammsTrack.grantConsent()  (Pixel: grant)
   * "Ablehnen"    -> shammsTrack.revokeConsent() (Pixel: revoke)
   * Vor jeder Entscheidung bleibt der Pixel im Consent-Mode
     "revoke" — es werden keine Marketing-Cookies gesetzt.
   * Der Link zur Datenschutzerklaerung wird aus dem eigenen
     Skriptpfad abgeleitet, damit er auch auf Unterseiten stimmt.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'shamms_consent';

  /* Pfadpräfix aus dem eigenen <script src> ableiten:
     "js/shamms-consent.js"        -> ""
     "../js/shamms-consent.js"     -> "../"
     "../../js/shamms-consent.js"  -> "../../"                       */
  var PREFIX = '';
  try {
    var src = (document.currentScript && document.currentScript.src) || '';
    var m = src.match(/^(.*?)(?:js\/)?shamms-consent\.js/);
    if (m) {
      var parsed = m[1];
      var abs = parsed.match(/^https?:\/\/[^/]+(\/.*)$/);
      var path = abs ? abs[1] : parsed;
      PREFIX = path.replace(/^\/+/, '');
    }
  } catch (e) { PREFIX = ''; }

  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  function accept() {
    set('granted');
    if (window.shammsTrack && window.shammsTrack.grantConsent) { window.shammsTrack.grantConsent(); }
    hide();
  }
  function decline() {
    set('denied');
    if (window.shammsTrack && window.shammsTrack.revokeConsent) { window.shammsTrack.revokeConsent(); }
    hide();
  }
  function hide() { var b = document.getElementById('cb-banner'); if (b) { b.hidden = true; } }

  /* Öffentliche API beibehalten — index.html und etwaige Links
     ("Cookie-Einstellungen ändern") rufen diese Funktionen auf. */
  window.shammsConsent = window.shammsConsent || { get: get, set: set };
  window.shammsAcceptConsent = accept;
  window.shammsDeclineConsent = decline;

  var MARKUP =
    '<div class="cb-inner">' +
      '<div class="cb-text">' +
        '<strong id="cb-title">Cookie-Hinweis:</strong> Wir nutzen den <strong>Meta-Pixel</strong>, ' +
        'um zu messen, wie unsere Anzeigen wirken und wie Besucher unsere Seite nutzen. ' +
        'Mit „Akzeptieren“ willigen Sie in die Verarbeitung durch Meta ein. ' +
        'Ohne Einwilligung werden keine Marketing-Cookies gesetzt. Details: ' +
        '<a href="' + PREFIX + 'rechtliches/datenschutz.html">Datenschutzerklärung</a>.' +
      '</div>' +
      '<div class="cb-btns">' +
        '<button type="button" class="cb-btn cb-accept" data-consent="accept">Akzeptieren</button>' +
        '<button type="button" class="cb-btn cb-decline" data-consent="decline">Ablehnen</button>' +
      '</div>' +
    '</div>';

  function mount() {
    if (get()) { return; }                    // bereits entschieden
    if (document.getElementById('cb-banner')) { return; }  // Seite bringt ihn selbst mit
    var b = document.createElement('div');
    b.id = 'cb-banner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-labelledby', 'cb-title');
    b.hidden = true;
    b.innerHTML = MARKUP;
    var links = b.querySelectorAll('[data-consent]');
    Array.prototype.forEach.call(links, function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-consent') === 'accept') { accept(); } else { decline(); }
      });
    });
    document.body.appendChild(b);
    b.hidden = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
