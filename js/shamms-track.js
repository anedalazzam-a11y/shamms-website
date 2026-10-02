/* ============================================================
   SHAMMS TRACKING LAYER
   Version: 2026-09-21
   Loaded synchronously in <head> on the German site.

   Goals
   -----
   1. Load the Meta Pixel immediately (never lose an event) and keep the
      existing EU consent-mode behaviour: consent defaults to "revoke",
      and is only upgraded to "grant" after an explicit opt-in.
   2. Attach a market / campaign context to EVERY event, so
      reports can be segmented per market without building separate
      tracking per country.
   3. Capture fbclid and forward it to Lemon Squeezy so the later
      purchase can be attributed back to the original ad.

   IMPORTANT — what this file deliberately does NOT do
   ---------------------------------------------------
   It does not send the "Purchase" event. The purchase happens on
   Lemon Squeezy's domain, so a browser-side Purchase is impossible.
   Purchase attribution requires a Lemon Squeezy order webhook that
   forwards to the Meta Conversions API (server-side). That receiver now
   exists: see tracking/README.md and tracking/lib/ls-capi.mjs.

   This file's job in that chain is to hand the context over to Lemon
   Squeezy in the ONLY form the order webhook returns: checkout[custom][...].
   Lemon Squeezy silently drops plain query parameters, so the syntax below
   is not cosmetic — it is what makes fbc/fbp reach the server.
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.SHAMMS_SITE || {};
  var PIXEL_ID = CFG.pixelId || '';
  var CONSENT_KEY = 'shamms_consent';
  var FBCLID_KEY = 'shamms_fbclid';
  var CTX_KEY = 'shamms_ctx';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  function readCookie(name) {
    try {
      var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
      return m ? m[2] : '';
    } catch (e) { return ''; }
  }

  /* ---------- campaign / referrer context, persisted for the session ---- */

  function qs(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([^&#]+)').exec(window.location.search);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  var FBCLID = (function () {
    var v = qs('fbclid');
    if (v) { ssSet(FBCLID_KEY, v); return v; }
    return ssGet(FBCLID_KEY);
  })();

  var CAMPAIGN = (function () {
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var stored = null;
    try { stored = JSON.parse(ssGet(CTX_KEY) || 'null'); } catch (e) {}
    var out = stored || {};
    var changed = false;
    keys.forEach(function (k) {
      var v = qs(k);
      if (v) { out[k] = v; changed = true; }
    });
    if (changed || !stored) { ssSet(CTX_KEY, JSON.stringify(out)); }
    return out;
  })();

  /* ---------- context attached to every event -------------------------- */

  function context(extra) {
    var c = {
      market: CFG.market || null,
      language: CFG.language || null,
      currency: CFG.currency || 'EUR',
      content_language: CFG.contentLanguage || null,
      page_language: CFG.language || null,
      landing_path: window.location.pathname,
      referrer_host: (function () {
        try { return document.referrer ? new URL(document.referrer).hostname : null; }
        catch (e) { return null; }
      })()
    };
    if (FBCLID) { c.fbclid = FBCLID; }
    Object.keys(CAMPAIGN).forEach(function (k) { c[k] = CAMPAIGN[k]; });
    if (extra) { Object.keys(extra).forEach(function (k) { c[k] = extra[k]; }); }
    return c;
  }

  /* ---------- pixel bootstrap (consent mode, unchanged semantics) ------ */

  function consentState() { return lsGet(CONSENT_KEY) === 'granted'; }

  function loadPixel() {
    if (typeof window.fbq === 'function') { return; }
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    // Consent Mode: block before init, release only on explicit opt-in.
    window.fbq('consent', consentState() ? 'grant' : 'revoke');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView', context({ event_name: 'PageView' }));
  }

  function track(name, params, opts) {
    if (typeof window.fbq !== 'function') { return; }
    try { window.fbq('track', name, context(params || {}), opts || undefined); } catch (e) {}
  }

  function grantConsent() {
    lsSet(CONSENT_KEY, 'granted');
    loadPixel();
    if (typeof window.fbq === 'function') { window.fbq('consent', 'grant'); }
  }

  function revokeConsent() {
    lsSet(CONSENT_KEY, 'denied');
    if (typeof window.fbq === 'function') { window.fbq('consent', 'revoke'); }
  }

  /* ---------- ViewContent: fired once per product card in viewport ----- */

  function observeProducts() {
    var cards = document.querySelectorAll('[data-product]');
    if (!cards.length) { return; }
    if (!('IntersectionObserver' in window)) { return; }
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) { return; }
        var el = en.target;
        var pid = el.getAttribute('data-product');
        if (!pid || seen[pid]) { return; }
        seen[pid] = 1;
        io.unobserve(el);
        track('ViewContent', {
          content_type: 'product',
          content_ids: [pid],
          content_name: el.querySelector('h3') ? el.querySelector('h3').textContent.trim() : pid,
          value: Number(el.getAttribute('data-price-eur')) || undefined,
          currency: el.getAttribute('data-currency') || CFG.currency || 'EUR'
        }, { eventID: 'vc_' + pid + '_' + Date.now() });
      });
    }, { threshold: 0.5 });
    Array.prototype.forEach.call(cards, function (c) { io.observe(c); });
  }

  /* ---------- InitiateCheckout + fbclid forwarding -------------------- */

  /* Build the Lemon Squeezy checkout URL.

     ONLY `checkout[custom][key]=value` is echoed back by Lemon Squeezy in the
     order webhook (`meta.custom_data`). Plain parameters such as `?market=DE`
     are discarded, which is exactly why the previous version never delivered
     fbclid / market / lang to the server side.

     Kept as a pure function (no DOM, no globals) so it can be unit-tested.
     Returns the href unchanged when there is nothing to add. */
  function buildCheckoutUrl(href, ctx) {
    if (!href) { return href; }
    var c = ctx || {};
    var custom = {
      market: c.market || '',
      lang: c.lang || '',
      landing_url: c.landingUrl || '',
      fbclid: c.fbclid || '',
      fbp: c.fbp || '',
      fbc: c.fbc || '',
      utm_source: c.utm_source || '',
      utm_medium: c.utm_medium || '',
      utm_campaign: c.utm_campaign || ''
    };
    var parts = [];
    Object.keys(custom).forEach(function (k) {
      if (custom[k]) {
        parts.push('checkout[custom][' + k + ']=' + encodeURIComponent(custom[k]));
      }
    });
    if (!parts.length) { return href; }
    return href + (href.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
  }

  function bindCheckout() {
    var navigating = false;
    document.addEventListener('click', function (e) {
      if (navigating) { return; }
      var el = e.target;
      var a = (el && el.closest) ? el.closest('a[href*="lemonsqueezy.com/checkout"]') : null;
      if (!a) { return; }

      // fbc must carry the CLICK time, not the order time, so build it here
      // from the live fbclid when the pixel has not written _fbc yet.
      var fbcCookie = readCookie('_fbc');
      var url = buildCheckoutUrl(a.href, {
        market: CFG.market,
        lang: CFG.language,
        landingUrl: window.location.href,
        fbclid: FBCLID,
        fbp: readCookie('_fbp'),
        fbc: fbcCookie || (FBCLID ? 'fb.1.' + Date.now() + '.' + FBCLID : ''),
        utm_source: CAMPAIGN.utm_source,
        utm_medium: CAMPAIGN.utm_medium,
        utm_campaign: CAMPAIGN.utm_campaign
      });

      if (typeof window.fbq !== 'function') { return; }
      e.preventDefault();
      navigating = true;
      var navigated = false;
      function go() { if (navigated) { return; } navigated = true; window.location.href = url; }

      var card = a.closest('[data-product]');
      track('InitiateCheckout', {
        content_type: 'product',
        content_ids: card ? [card.getAttribute('data-product')] : undefined,
        value: card ? (Number(card.getAttribute('data-price-eur')) || undefined) : undefined,
        currency: CFG.currency || 'EUR'
      }, { eventID: 'ic_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) });

      setTimeout(go, 400); // safety net: never wait longer than 400 ms
    }, true);
  }

  /* ---------- boot ---------------------------------------------------- */

  loadPixel();

  function ready(fn) {
    if (document.readyState !== 'loading') { fn(); }
    else { document.addEventListener('DOMContentLoaded', fn); }
  }
  ready(function () {
    observeProducts();
    bindCheckout();
  });

  /* ---------- public API ---------------------------------------------- */

  window.shammsTrack = {
    version: '2026-09-21',
    track: track,
    context: context,
    grantConsent: grantConsent,
    revokeConsent: revokeConsent,
    getFbclid: function () { return FBCLID; },
    getCampaign: function () { return CAMPAIGN; },
    /* Exposed so the checkout URL can be verified without a browser. */
    buildCheckoutUrl: buildCheckoutUrl,
    /* The server-side Purchase receiver now lives outside this file:
       tracking/lib/ls-capi.mjs. It is NOT deployed yet. */
    _purchaseReceiverStub: function () { return null; }
  };

  /* ---------- Conversion-Events (Produkt-CTA + Checkout) -------------
     Nutzt die vorhandene track()-Funktion und damit die bestehende
     Consent-Logik. Aendert weder Checkout noch Zahlungsablauf. */
  function cardLabel(el) {
    var card = el.closest ? el.closest('[data-product],[data-service],[data-membership]') : null;
    var scope = card || document;
    var h = scope.querySelector('h3');
    return h ? h.textContent.replace(/\s+/g, ' ').trim() : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  function sectionOf(el) {
    var s = el.closest ? el.closest('section') : null;
    return s && s.id ? s.id : 'shop';
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var name = cardLabel(a);
    var sect = sectionOf(a);
    try {
      if (href.indexOf('lemonsqueezy.com/checkout') !== -1) {
        track('InitiateCheckout', { content_name: name, content_category: sect, content_type: 'product' });
      } else if (href.charAt(0) === '#' || href.indexOf('mailto:') === 0) {
        trackCustomSafe('ProductCTAClick', { content_name: name, content_category: sect, target: href.slice(0, 60) });
      }
    } catch (err) {}
  }, true);
  function trackCustomSafe(n, p) {
    try { if (window.fbq) { window.fbq('trackCustom', n, context(p || {})); } } catch (e) {}
  }
})();
