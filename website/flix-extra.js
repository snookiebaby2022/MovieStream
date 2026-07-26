/* FlixNova extras: i18n, profiles/kids, resume, subs, cast/download, requests, analytics */
(function (global) {
  'use strict';
  var F = {
    profile: null,
    profiles: [],
    progressTimer: null,
    lastStreamUrl: '',
    lang: localStorage.getItem('fn_lang') || 'en',
    adFree: localStorage.getItem('fn_adfree') === '1',
    payConfigured: false,
    payLabel: '£1.00'
  };

  var HOUSE_ADS = [
    { t: 'Go Ad-Free forever', d: 'One-time £1 — Real-Debrid streams + no FlixNova ads.', cta: 'Unlock £1', action: 'pay' },
    { t: 'Real-Debrid for members', d: 'Paying members get direct RD links. Free accounts use embeds.', cta: 'Unlock £1', action: 'pay' },
    { t: 'Request missing titles', d: 'Can’t find something? Send a request and we’ll check it.', cta: 'Request', action: 'request' }
  ];

  var I18N = {
    en: {
      home: 'Home', movies: 'Movies', tv: 'TV Shows', newhot: 'New & Hot', more: 'More',
      search: 'Search movies, shows...', signin: 'Sign In', request: 'Request',
      watchNow: 'Watch Now', moreInfo: 'More Info', trendingToday: 'Trending Today',
      continueWatching: 'Continue Watching', kidsMode: 'Kids Mode', profiles: 'Profiles',
      cast: 'Cast / Copy', download: 'Download', subtitles: 'Subtitles',
      requestTitle: 'Request a title', sendRequest: 'Send request',
      forgot: 'Forgot password?', reset: 'Reset password', language: 'Language'
    },
    es: {
      home: 'Inicio', movies: 'Películas', tv: 'Series', newhot: 'Novedades', more: 'Más',
      search: 'Buscar películas, series...', signin: 'Entrar', request: 'Pedir',
      watchNow: 'Ver ahora', moreInfo: 'Más info', trendingToday: 'Tendencias hoy',
      continueWatching: 'Seguir viendo', kidsMode: 'Modo niños', profiles: 'Perfiles',
      cast: 'Transmitir / Copiar', download: 'Descargar', subtitles: 'Subtítulos',
      requestTitle: 'Pedir un título', sendRequest: 'Enviar',
      forgot: '¿Olvidaste la contraseña?', reset: 'Restablecer', language: 'Idioma'
    },
    fr: {
      home: 'Accueil', movies: 'Films', tv: 'Séries', newhot: 'Nouveautés', more: 'Plus',
      search: 'Rechercher films, séries...', signin: 'Connexion', request: 'Demander',
      watchNow: 'Regarder', moreInfo: 'Infos', trendingToday: 'Tendances du jour',
      continueWatching: 'Reprendre', kidsMode: 'Mode enfants', profiles: 'Profils',
      cast: 'Caster / Copier', download: 'Télécharger', subtitles: 'Sous-titres',
      requestTitle: 'Demander un titre', sendRequest: 'Envoyer',
      forgot: 'Mot de passe oublié ?', reset: 'Réinitialiser', language: 'Langue'
    },
    de: {
      home: 'Start', movies: 'Filme', tv: 'Serien', newhot: 'Neu', more: 'Mehr',
      search: 'Filme, Serien suchen...', signin: 'Anmelden', request: 'Anfragen',
      watchNow: 'Abspielen', moreInfo: 'Infos', trendingToday: 'Heute im Trend',
      continueWatching: 'Weiterschauen', kidsMode: 'Kindermodus', profiles: 'Profile',
      cast: 'Cast / Kopieren', download: 'Download', subtitles: 'Untertitel',
      requestTitle: 'Titel anfragen', sendRequest: 'Senden',
      forgot: 'Passwort vergessen?', reset: 'Zurücksetzen', language: 'Sprache'
    }
  };

  function t(key) {
    return (I18N[F.lang] && I18N[F.lang][key]) || I18N.en[key] || key;
  }

  function $(id) { return document.getElementById(id); }

  function applyI18n() {
    var map = [
      ['nb-home', 'home'], ['nb-movies', 'movies'], ['nb-tv', 'tv'], ['nb-new', 'newhot']
    ];
    map.forEach(function (pair) {
      var el = $(pair[0]);
      if (el) el.textContent = t(pair[1]);
    });
    var moreBtn = document.querySelector('#navMore > .nb');
    if (moreBtn) moreBtn.textContent = t('more') + ' ▾';
    var q = $('q'); if (q) q.placeholder = t('search');
    var authBtn = $('authBtn');
    if (authBtn && !(global.S && S.user)) authBtn.textContent = t('signin');
    var reqBtn = $('reqBtn'); if (reqBtn) reqBtn.textContent = t('request');
    var langSel = $('langSel'); if (langSel) langSel.value = F.lang;
  }

  function setLang(code) {
    F.lang = I18N[code] ? code : 'en';
    localStorage.setItem('fn_lang', F.lang);
    applyI18n();
  }

  function kidsActive() {
    return !!(F.profile && F.profile.kids) || localStorage.getItem('fn_kids') === '1';
  }

  function browseKidsParam() {
    return kidsActive() ? '&kids=1' : '';
  }

  // Patch global browseQuery if present
  function installBrowseKidsHook() {
    if (typeof global.browseQuery !== 'function') return;
    var orig = global.browseQuery;
    global.browseQuery = function (type) {
      return orig(type) + browseKidsParam();
    };
  }

  function fapi(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (global.S && S.token) headers['x-user-token'] = S.token;
    return fetch('/api/features' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) { return r.json(); });
  }

  function loadProfiles() {
    if (!global.S || !S.token) return Promise.resolve();
    return fapi('/profiles').then(function (d) {
      if (!d.success) return;
      F.profiles = d.data.profiles || [];
      F.profile = F.profiles.find(function (p) { return p.id === d.data.activeProfileId; }) || F.profiles[0] || null;
      if (F.profile && F.profile.lang) setLang(F.profile.lang);
      renderProfileBtn();
      localStorage.setItem('fn_kids', F.profile && F.profile.kids ? '1' : '0');
    }).catch(function () {});
  }

  function renderProfileBtn() {
    var b = $('profBtn');
    if (!b) return;
    if (!S.token) { b.style.display = 'none'; return; }
    b.style.display = 'inline-flex';
    b.textContent = F.profile ? (F.profile.kids ? '👶 ' : '') + F.profile.name : t('profiles');
  }

  function openProfiles() {
    if (!S.token) { if (typeof openAuth === 'function') openAuth(); return; }
    loadProfiles().then(function () {
      var box = $('profOv');
      if (!box) return;
      var list = $('profList');
      list.innerHTML = (F.profiles || []).map(function (p) {
        return '<button class="prof-card' + (F.profile && F.profile.id === p.id ? ' on' : '') + '" onclick="FlixExtra.switchProfile(\'' + p.id + '\')">' +
          '<div class="prof-av">' + (p.kids ? '👶' : '👤') + '</div>' +
          '<div>' + esc(p.name) + (p.kids ? ' <small>Kids</small>' : '') + '</div></button>';
      }).join('') +
        '<button class="prof-card add" onclick="FlixExtra.addProfile()">＋ Add</button>';
      box.classList.add('on');
    });
  }

  function closeProfiles() { var b = $('profOv'); if (b) b.classList.remove('on'); }

  function switchProfile(id) {
    fapi('/profiles/active', { method: 'PUT', body: { profileId: id } }).then(function (d) {
      if (!d.success) return;
      F.profile = d.data.profile;
      localStorage.setItem('fn_kids', F.profile && F.profile.kids ? '1' : '0');
      renderProfileBtn();
      closeProfiles();
      if (typeof goHome === 'function') goHome();
    });
  }

  function addProfile() {
    var name = prompt('Profile name');
    if (!name) return;
    var kids = confirm('Kids profile? (filters mature titles)');
    fapi('/profiles', { method: 'POST', body: { name: name, kids: kids } }).then(function () { openProfiles(); });
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trackPlay(source, success) {
    if (!global.S || !S.item) return;
    fapi('/analytics/play', {
      method: 'POST',
      body: {
        tmdbId: S.item.tmdbId || S.item.id,
        mediaType: S.item.type || 'movie',
        title: S.item.title || '',
        season: S.sn || 0,
        episode: S.ep || 0,
        source: source || 'other',
        success: success !== false
      }
    }).catch(function () {});
  }

  function saveProgress(video) {
    if (!video || !S.token || !S.item) return;
    var ct = video.currentTime || 0;
    var dur = video.duration || 0;
    if (!ct || ct < 20) return;
    fapi('/progress', {
      method: 'POST',
      body: {
        tmdbId: S.item.tmdbId || S.item.id,
        mediaType: S.item.type || 'movie',
        title: S.item.title || '',
        poster: S.item.poster || '',
        backdrop: S.item.backdrop || '',
        season: S.sn || 0,
        episode: S.ep || 0,
        currentTime: ct,
        duration: dur,
        profileId: F.profile ? F.profile.id : ''
      }
    }).catch(function () {});
  }

  /**
   * Free users → embed players (provider ads).
   * Ad-Free users → Real-Debrid (no FlixNova overlay).
   */
  function withPreroll(playFn) {
    if (typeof playFn === 'function') playFn();
  }

  function bindVideoExtras(video, url, isRd) {
    if (!video) return;
    F.lastStreamUrl = url || '';
    clearInterval(F.progressTimer);
    F.progressTimer = setInterval(function () { saveProgress(video); }, 15000);
    video.addEventListener('pause', function () { saveProgress(video); });
    video.addEventListener('ended', function () { saveProgress(video); });
    trackPlay(isRd ? 'rd' : 'embed', true);
    // Mid-roll nudge once ~12 minutes in for free users (overlay only, does not stop stream long)
    if (!isAdFree() && !video._fnMid) {
      video._fnMid = true;
      var midTimer = setInterval(function () {
        if (!document.body.contains(video)) { clearInterval(midTimer); return; }
        if (video.currentTime > 12 * 60 && video.currentTime < 12 * 60 + 3) {
          clearInterval(midTimer);
          showMidrollNudge();
        }
      }, 2000);
    }

    // Resume
    if (S.token && S.item) {
      var q = '/progress/' + (S.item.type || 'movie') + '/' + (S.item.tmdbId || S.item.id) +
        '?season=' + (S.sn || 0) + '&episode=' + (S.ep || 0);
      fapi(q).then(function (d) {
        if (d.success && d.data && d.data.currentTime > 30) {
          var seek = d.data.currentTime;
          var doSeek = function () {
            try { video.currentTime = seek; } catch (e) {}
            video.removeEventListener('loadedmetadata', doSeek);
          };
          if (video.readyState >= 1) doSeek();
          else video.addEventListener('loadedmetadata', doSeek);
        }
      }).catch(function () {});
    }

    injectPlayerChrome(video, url, isRd);
    loadSubtitlesForCurrent(video);
  }

  function showMidrollNudge() {
    if (isAdFree()) return;
    var pw = $('pw');
    if (!pw || pw.querySelector('.midroll')) return;
    var bar = document.createElement('div');
    bar.className = 'midroll';
    bar.style.cssText = 'position:absolute;left:12px;right:12px;bottom:54px;z-index:25;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.82);border:1px solid rgba(245,197,24,.3);display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap';
    bar.innerHTML = '<span style="font-size:12px;color:#ddd">Remove player ads forever — one-time ' + esc(F.payLabel || '£1') + '</span>' +
      '<span><button type="button" class="pbtn gold" style="margin:0;padding:6px 12px;font-size:11px" id="midPay">Unlock</button> ' +
      '<button type="button" class="pbtn ghost" style="margin:0;padding:6px 10px;font-size:11px;background:rgba(255,255,255,.1)" id="midX">Dismiss</button></span>';
    pw.appendChild(bar);
    var pay = $('midPay'); var x = $('midX');
    if (pay) pay.onclick = function () { startCheckout(); };
    if (x) x.onclick = function () { bar.remove(); };
    setTimeout(function () { if (bar.parentNode) bar.remove(); }, 12000);
  }

  function injectPlayerChrome(video, url, isRd) {
    var tools = document.querySelector('#pw .pw-tools');
    if (!tools) return;
    if (!tools.querySelector('.fx-dl')) {
      var dl = document.createElement('button');
      dl.className = 'fx-dl';
      dl.type = 'button';
      dl.textContent = t('download');
      dl.onclick = function () {
        if (!url) return;
        var a = document.createElement('a');
        a.href = url; a.download = ''; a.target = '_blank'; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      };
      tools.appendChild(dl);
    }
    if (!tools.querySelector('.fx-cast')) {
      var c = document.createElement('button');
      c.className = 'fx-cast';
      c.type = 'button';
      c.textContent = t('cast');
      c.onclick = function () {
        if (!url) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            alert('Stream URL copied. On phones/TVs: open the video and use the cast icon in the player, or paste the URL in a cast app.');
          });
        } else {
          prompt('Copy stream URL:', url);
        }
      };
      tools.appendChild(c);
    }
    if (!tools.querySelector('.fx-subs')) {
      var s = document.createElement('button');
      s.className = 'fx-subs';
      s.type = 'button';
      s.textContent = t('subtitles');
      s.onclick = function () { openSubPicker(video); };
      tools.appendChild(s);
    }
  }

  function loadSubtitlesForCurrent(video) {
    // Prefetch list only; user picks language
    F._subVideo = video;
  }

  function openSubPicker(video) {
    if (!S.item) return;
    var imdb = S.item.imdbId;
    var ensure = imdb ? Promise.resolve(imdb) : fetch('/api/details/' + (S.item.tmdbId || S.item.id) + '/' + (S.item.type || 'movie'))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        imdb = d.data && d.data.imdbId;
        if (S.item) S.item.imdbId = imdb;
        return imdb;
      });
    ensure.then(function (id) {
      if (!id) { alert('No IMDb id for subtitles'); return; }
      var qs = '?imdbId=' + encodeURIComponent(id) + '&type=' + (S.item.type || 'movie') +
        '&season=' + (S.sn || 1) + '&episode=' + (S.ep || 1);
      return fapi('/subtitles' + qs).then(function (d) {
        var list = (d.data || []).slice(0, 20);
        if (!list.length) { alert('No subtitles found'); return; }
        var pick = prompt('Subtitle index:\n' + list.map(function (s, i) { return i + ': ' + s.label; }).join('\n') + '\n\nEnter number:');
        var idx = parseInt(pick, 10);
        if (isNaN(idx) || !list[idx]) return;
        attachSub(video || F._subVideo, list[idx].url);
      });
    }).catch(function (e) { alert(e.message || 'Subtitle error'); });
  }

  function attachSub(video, url) {
    if (!video || !url) return;
    Array.prototype.slice.call(video.querySelectorAll('track')).forEach(function (tr) { tr.remove(); });
    var track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = 'Subtitles';
    track.srclang = 'en';
    track.default = true;
    track.src = '/api/features/subtitles/proxy?url=' + encodeURIComponent(url);
    video.appendChild(track);
    try {
      if (video.textTracks && video.textTracks[0]) video.textTracks[0].mode = 'showing';
    } catch (e) {}
  }

  function openRequest() {
    var ov = $('reqOv');
    if (!ov) return;
    $('reqErr').style.display = 'none';
    $('reqOk').style.display = 'none';
    if (S.item && S.item.title) $('reqTitle').value = S.item.title;
    ov.classList.add('on');
  }

  function closeRequest() { var o = $('reqOv'); if (o) o.classList.remove('on'); }

  function sendRequest() {
    var title = $('reqTitle').value.trim();
    var mediaType = $('reqType').value;
    var note = $('reqNote').value.trim();
    if (!title) { $('reqErr').textContent = 'Title required'; $('reqErr').style.display = 'block'; return; }
    fapi('/requests', {
      method: 'POST',
      body: { title: title, mediaType: mediaType, note: note, tmdbId: S.item && (S.item.tmdbId || S.item.id) }
    }).then(function (d) {
      if (d.success) {
        $('reqOk').textContent = 'Request sent — thanks!';
        $('reqOk').style.display = 'block';
        $('reqErr').style.display = 'none';
        setTimeout(closeRequest, 1200);
      } else {
        $('reqErr').textContent = d.error || 'Failed';
        $('reqErr').style.display = 'block';
      }
    });
  }

  function forgotPassword() {
    var ident = prompt('Username or email for password reset:');
    if (!ident) return;
    fetch('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ident })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.resetUrl) {
        alert((d.message || 'Reset ready') + '\n\nOpen this link:\n' + d.resetUrl);
        if (confirm('Open reset link now?')) location.href = d.resetUrl;
      } else {
        alert(d.message || (d.error || 'Done'));
      }
    }).catch(function (e) { alert(e.message); });
  }

  function handleResetRoute() {
    var m = location.pathname.match(/^\/reset\/?$/) || (location.search.match(/[?&]token=([^&]+)/));
    var token = null;
    if (location.pathname.indexOf('/reset') === 0) {
      token = new URLSearchParams(location.search).get('token');
    } else if (location.search.indexOf('token=') >= 0 && location.pathname === '/reset') {
      token = new URLSearchParams(location.search).get('token');
    }
    // also support /reset?token=
    if (location.pathname === '/reset' || location.pathname === '/reset/') {
      token = new URLSearchParams(location.search).get('token');
      if (!token) return false;
      var pass = prompt('Enter a new password (6+ characters):');
      if (!pass) return true;
      fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, password: pass })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.success) {
          localStorage.setItem('fn_token', d.token);
          alert('Password updated. You are signed in.');
          location.href = '/';
        } else alert(d.error || 'Reset failed');
      });
      return true;
    }
    return false;
  }

  function loadContinueFromServer() {
    if (!S.token) return Promise.resolve([]);
    return fapi('/progress').then(function (d) {
      if (!d.success) return [];
      return (d.data || []).map(function (p) {
        return {
          tmdbId: p.tmdbId, id: p.tmdbId, type: p.mediaType,
          title: p.title, poster: p.poster, backdrop: p.backdrop,
          season: p.season, episode: p.episode,
          currentTime: p.currentTime, duration: p.duration,
          progressPct: p.duration ? Math.round((p.currentTime / p.duration) * 100) : 0
        };
      });
    }).catch(function () { return []; });
  }

  function enhanceContinueRow() {
    // Hook loadHome via wrapper if needed — exposed for index.html
  }

  function isAdFree() {
    return !!(F.adFree || (global.S && S.user && S.user.adFree) || localStorage.getItem('fn_adfree') === '1');
  }

  function setAdFree(on) {
    F.adFree = !!on;
    if (on) localStorage.setItem('fn_adfree', '1');
    else localStorage.removeItem('fn_adfree');
    if (global.S && S.user) S.user.adFree = !!on;
    renderAdUi();
  }

  function loadPayStatus() {
    var headers = {};
    if (global.S && S.token) headers['x-user-token'] = S.token;
    return fetch('/api/pay/status', { headers: headers }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.success) return;
      F.payConfigured = !!d.configured;
      F.payLabel = d.label || '£1.00';
      if (d.adFree) setAdFree(true);
      var btn = $('adfreeBtn');
      if (btn) {
        btn.style.display = isAdFree() ? 'none' : 'inline-flex';
        btn.textContent = 'Ad-Free ' + F.payLabel;
      }
      renderAdUi();
    }).catch(function () {});
  }

  function openPayPromo(force) {
    if (isAdFree()) return;
    var ov = $('payPromoOv');
    if (!ov) return;
    var label = F.payLabel || '£1';
    var btn = $('promoPayBtn');
    if (btn) btn.textContent = 'Unlock Ad-Free for ' + label;
    ov.classList.add('on');
    if (force) localStorage.removeItem('fn_paypromo_dismiss');
  }

  function closePayPromo(persist) {
    var ov = $('payPromoOv');
    if (ov) ov.classList.remove('on');
    if (persist !== false) localStorage.setItem('fn_paypromo_dismiss', String(Date.now()));
  }

  function maybeShowPayPromo() {
    if (isAdFree()) return;
    if (localStorage.getItem('fn_paypromo_dismiss')) {
      var ts = parseInt(localStorage.getItem('fn_paypromo_dismiss'), 10) || 0;
      // Re-show after 2 days
      if (Date.now() - ts < 2 * 24 * 60 * 60 * 1000) return;
    }
    // Don’t steal focus from watch / auth / deep links
    if (location.pathname.indexOf('/watch/') === 0) return;
    if ($('ov') && $('ov').classList.contains('on')) return;
    if ($('authOv') && $('authOv').classList.contains('on')) return;
    if ($('watchGateOv') && $('watchGateOv').classList.contains('on')) return;
    setTimeout(function () { openPayPromo(false); }, 1800);
  }

  function startCheckout() {
    if (isAdFree()) { alert('You already have Ad-Free.'); return; }
    if (!(global.S && S.token)) {
      // Must be logged in so Ad-Free sticks to the account
      if (global.S) S._pendingPay = true;
      closePayPromo(false);
      if (typeof openAuth === 'function') openAuth('register');
      var err = $('authErr');
      if (err) {
        err.textContent = 'Create an account or log in, then we’ll take you to the £1 Ad-Free checkout.';
        err.style.display = 'block';
      }
      return;
    }
    closePayPromo(false);
    fetch('/api/pay/checkout', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, { 'x-user-token': S.token }),
      body: JSON.stringify({})
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.success && d.url) { location.href = d.url; return; }
      alert(d.error || 'Checkout unavailable. Add STRIPE_SECRET_KEY on the server.');
    }).catch(function (e) { alert(e.message); });
  }

  function handlePayReturn() {
    var params = new URLSearchParams(location.search);
    var flag = params.get('adfree');
    var sid = params.get('session_id');
    if (flag === 'cancel') {
      history.replaceState(null, '', '/');
      return;
    }
    if (flag === 'success' && sid) {
      var headers = {};
      if (S.token) headers['x-user-token'] = S.token;
      fetch('/api/pay/confirm?session_id=' + encodeURIComponent(sid), { headers: headers })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            setAdFree(true);
            alert(d.message || 'Ad-Free unlocked. Thanks!');
          } else {
            alert(d.error || 'Could not confirm payment');
          }
          history.replaceState(null, '', '/');
        }).catch(function () { history.replaceState(null, '', '/'); });
    }
  }

  function houseAdHtml(i) {
    var a = HOUSE_ADS[i % HOUSE_ADS.length];
    return '<div class="house-ad" data-ad="' + i + '">' +
      '<div class="house-ad-kicker">Sponsored</div>' +
      '<div class="house-ad-t">' + esc(a.t) + '</div>' +
      '<div class="house-ad-d">' + esc(a.d) + '</div>' +
      '<button type="button" class="house-ad-cta" onclick="FlixExtra.adAction(\'' + a.action + '\')">' + esc(a.cta.replace('£1', F.payLabel)) + '</button>' +
      '<button type="button" class="house-ad-x" onclick="this.parentNode.remove()" aria-label="Dismiss">✕</button>' +
      '</div>';
  }

  function adAction(action) {
    if (action === 'pay') openPayPromo(true);
    else if (action === 'rd') {
      if (isAdFree() && typeof openRd === 'function') openRd();
      else openPayPromo(true);
    } else if (action === 'request') openRequest();
  }

  function injectRowAds() {
    // Homepage stays ad-free — ads only play inside the movie/TV player
    document.querySelectorAll('.house-ad, .house-ad-wrap').forEach(function (el) { el.remove(); });
    var strip = $('adStrip'); if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }
  }

  function renderAdUi() {
    var btn = $('adfreeBtn');
    if (btn) btn.style.display = isAdFree() ? 'none' : 'inline-flex';
    var badge = $('adfreeBadge');
    if (badge) badge.style.display = isAdFree() ? 'inline-flex' : 'none';
    if (isAdFree()) closePayPromo(false);
    injectRowAds();
    if (typeof refreshRdBtn === 'function') refreshRdBtn();
  }

  function init() {
    applyI18n();
    installBrowseKidsHook();
    if (handleResetRoute()) return;
    handlePayReturn();
    loadProfiles();
    loadPayStatus().finally(function () { maybeShowPayPromo(); });
    var langSel = $('langSel');
    if (langSel) langSel.addEventListener('change', function () { setLang(langSel.value); });
    injectRowAds();
  }

  global.FlixExtra = {
    init: init,
    t: t,
    setLang: setLang,
    F: F,
    loadProfiles: loadProfiles,
    openProfiles: openProfiles,
    closeProfiles: closeProfiles,
    switchProfile: switchProfile,
    addProfile: addProfile,
    bindVideoExtras: bindVideoExtras,
    trackPlay: trackPlay,
    openRequest: openRequest,
    closeRequest: closeRequest,
    sendRequest: sendRequest,
    forgotPassword: forgotPassword,
    loadContinueFromServer: loadContinueFromServer,
    kidsActive: kidsActive,
    openSubPicker: openSubPicker,
    startCheckout: startCheckout,
    loadPayStatus: loadPayStatus,
    isAdFree: isAdFree,
    setAdFree: setAdFree,
    adAction: adAction,
    injectRowAds: injectRowAds,
    renderAdUi: renderAdUi,
    withPreroll: withPreroll,
    openPayPromo: openPayPromo,
    closePayPromo: closePayPromo,
    maybeShowPayPromo: maybeShowPayPromo
  };
})(window);
