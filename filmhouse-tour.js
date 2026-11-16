/*!
 * Film House – Guided Tour (Standalone Drop-In)
 * Interactive Walkthrough with Dynamic Theme Detection, Spotlight Cutout, Shrink Mode & Animated Welcome
 */
(function () {
  'use strict';

  /* ============ SETTINGS ============ */
  var STORAGE_KEY = 'fh_tour_done_v2';
  var AUTO_START = true;
  var START_DELAY = 1800;

  function getThemeAccent() {
    try {
      var docStyle = getComputedStyle(document.documentElement);
      var primary = docStyle.getPropertyValue('--primary-color').trim();
      if (primary && primary.length > 2) return primary;
    } catch (_) { }
    var saved = localStorage.getItem('filmhouse_theme_accent') || 'gold';
    var map = {
      gold: '#ffbc00',
      crimson: '#e50914',
      azure: '#1a9cff',
      amethyst: '#a855f7',
      blossom: '#ff8da1',
      barbie: '#ec4899',
      emerald: '#10b981'
    };
    return map[saved] || '#ffbc00';
  }

  function triggerHapticFeedback(type) {
    try {
      if (typeof window.triggerHaptic === 'function') {
        window.triggerHaptic(type);
      } else if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        if (type === 'success') {
          window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        } else {
          window.Telegram.WebApp.HapticFeedback.impactOccurred(type === 'medium' ? 'medium' : 'light');
        }
      }
    } catch (_) { }
  }

  /* ============ USER NAME RESOLVER ============ */
  function getUserName() {
    try {
      var c = window.FilmHouseTourConfig;
      if (c && typeof c.getUserName === 'function') {
        var n = c.getUserName();
        if (n) return n;
      }
    } catch (_) { }
    try {
      var u = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user;
      if (u && u.first_name) return u.first_name;
    } catch (_) { }
    try {
      if (window.state && window.state.user && (window.state.user.displayName || window.state.user.name)) {
        return window.state.user.displayName || window.state.user.name;
      }
    } catch (_) { }
    try {
      var keys = ['fh_username', 'fh_name', 'username', 'userName', 'first_name', 'filmhouse_user_name'];
      for (var i = 0; i < keys.length; i++) {
        var v = localStorage.getItem(keys[i]);
        if (v) return v;
      }
    } catch (_) { }
    return '';
  }

  function cleanName(n) {
    return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().split(/\s+/)[0].slice(0, 18);
  }

  /* ============ TOUR STEPS ============ */
  var STEPS = [
    {
      icon: '🍿',
      title: 'Welcome to Film House!',
      welcome: true,
      text: 'Your premium cinema portal for movies & series, right inside Telegram. Let\'s take a quick 30-second tour to show you how everything works.',
      tab: 'home'
    },
    {
      icon: '🔍',
      title: 'Smart Search & Filters',
      text: 'Search any movie, series, or anime in milliseconds. Use the filters to sort by genre, IMDb rating, year, or release date with live results.',
      tab: 'home',
      target: {
        selectors: ['#global-search-input', '.search-bar-wrapper', '.search-icon']
      }
    },
    {
      icon: '🎬',
      title: 'Explore & 4K Streaming',
      text: 'Swipe through hero picks with real-time physics. Tap any title to stream instantly, pick 4K/1080p quality, and enjoy 60+ language subtitles with 1-Tap Voice Sync.',
      tab: 'home',
      target: {
        selectors: ['#hero-carousel', '.hero-carousel-container', '.movie-listing-section']
      }
    },
    {
      icon: '🔖',
      title: 'Your Watchlist',
      text: 'Bookmark titles you love with one tap. Access your curated watchlist and marked favorites here from the bottom navigation bar.',
      tab: 'watchlist',
      target: {
        selectors: ['.bottom-nav-item[data-target="watchlist"]', '#screen-watchlist']
      }
    },
    {
      icon: '⚡',
      title: 'Mine Free Points',
      text: 'Tap "Start Mining", close Telegram, and live your life. Return in 8 hours to claim 80 free Loyalty Points! Repeat daily for free rewards.',
      tab: 'mining',
      target: {
        selectors: ['#btn-farm-action', '.mining-card-container']
      }
    },
    {
      icon: '🎫',
      title: 'Ad-Free Cinema Passes',
      text: 'Spend points or watch quick sponsor ads to unlock 4h, 6h, or 10h passes. The pass timer ONLY counts down while you\'re actively streaming!',
      tab: 'mining',
      target: {
        selectors: ['.mining-cinema-perks-card', '#btn-redeem-cinema-pass-mining', '#btn-watch-ad-4h']
      }
    },
    {
      icon: '💻',
      title: 'Sync Phone & PC',
      text: 'Link your Telegram ID so your loyalty points, passes, and mining timer match on your computer, tablet, and mobile device.',
      tab: 'mining',
      target: {
        selectors: ['#pc-sync-banner', '#btn-open-sync-modal']
      }
    },
    {
      icon: '🎨',
      title: 'Profile & Themes',
      text: 'Personalize your experience! Choose from 7 signature accent themes (Gold, Crimson, Azure, etc.), climb Cinephile ranks, and track loyalty perks.',
      tab: 'profile',
      target: {
        selectors: ['.profile-tabs', '#profile-loyalty-ranking-card', '.bottom-nav-item[data-target="profile"]']
      }
    },
    {
      icon: '📩',
      title: 'Request Movies & Feedback',
      text: 'Can\'t find a movie? Submit a request here. When added, you\'ll receive an instant fulfillment notification right on your screen!',
      tab: 'feedback',
      target: {
        selectors: ['#feedback-form', '.feedback-card', '.bottom-nav-item[data-target="feedback"]']
      }
    },
    {
      icon: '🎉',
      title: 'You\'re All Set!',
      text: 'Enjoy the show! You can replay this guided walkthrough anytime from Profile → Tutorial Guide 📖.',
      tab: 'home',
      last: true
    }
  ];

  /* ============ HELPERS ============ */
  var root, overlay, spot, card, idx = 0, active = false, resizeT;

  function seen() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1' || localStorage.getItem('filmhouse_tour_completed') === 'true';
    } catch (_) {
      return false;
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
      localStorage.setItem('filmhouse_tour_completed', 'true');
    } catch (_) { }
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  }

  function inTour(el) {
    return root && root.contains(el);
  }

  function locate(def) {
    if (!def || !def.selectors) return null;
    for (var i = 0; i < def.selectors.length; i++) {
      try {
        var list = document.querySelectorAll(def.selectors[i]);
        for (var j = 0; j < list.length; j++) {
          if (!inTour(list[j]) && visible(list[j])) {
            return list[j];
          }
        }
      } catch (_) { }
    }
    return null;
  }

  function openTab(name) {
    if (!name) return;
    var screen = name.toLowerCase();
    try {
      if (typeof window.navigateToScreen === 'function') {
        window.navigateToScreen(screen);
      } else {
        var navBtn = document.querySelector('.bottom-nav-item[data-target="' + screen + '"]');
        if (navBtn) navBtn.click();
      }
    } catch (_) { }
  }

  function closeOldPopups() {
    var old = document.querySelectorAll('#app-tour-overlay, .tour-overlay, #onboarding');
    old.forEach(function (n) {
      if (!inTour(n)) {
        n.style.display = 'none';
        n.classList.remove('active');
      }
    });
  }

  /* ============ UI & CSS ============ */
  function injectCSS() {
    if (document.getElementById('fh-tour-css')) return;
    var css = '' +
      '#fh-tour{position:fixed;inset:0;z-index:2147483000;font-family:"Outfit","Poppins",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-tap-highlight-color:transparent}' +
      '#fh-tour *{box-sizing:border-box}' +
      '.fh-ov{position:absolute;inset:0;background:rgba(5,6,10,.82);transition:opacity .3s}' +
      '.fh-ov.has-spot{background:transparent}' +
      '.fh-spot{position:absolute;border-radius:14px;border:2px solid var(--primary-color,#ffbc00);box-shadow:0 0 0 9999px rgba(5,6,10,.82),0 0 22px 2px var(--primary-glow,rgba(255,188,0,.5));transition:all .35s cubic-bezier(.2,.8,.2,1);pointer-events:none;opacity:0}' +
      '.fh-spot.on{opacity:1;animation:fhPulse 1.8s ease-in-out infinite}' +
      '@keyframes fhPulse{0%,100%{box-shadow:0 0 0 9999px rgba(5,6,10,.82),0 0 14px 1px var(--primary-glow,rgba(255,188,0,.35))}50%{box-shadow:0 0 0 9999px rgba(5,6,10,.82),0 0 28px 5px var(--primary-glow,rgba(255,188,0,.75))}}' +
      '.fh-card{position:absolute;width:min(92vw,350px);background:rgba(21,24,33,0.95);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#fff;border:1px solid var(--primary-color,#ffbc00);border-radius:18px;padding:20px 20px 16px;box-shadow:0 0 34px var(--primary-glow,rgba(255,188,0,.25)),0 18px 40px rgba(0,0,0,.7);transition:top .35s cubic-bezier(.2,.8,.2,1),left .35s cubic-bezier(.2,.8,.2,1),opacity .25s,transform .25s;opacity:0;transform:scale(.96)}' +
      '.fh-card.on{opacity:1;transform:scale(1)}' +
      '.fh-skip{position:absolute;top:14px;right:16px;background:none;border:0;color:#8b90a0;font-size:11.5px;font-weight:700;letter-spacing:.06em;cursor:pointer;padding:4px;transition:color .2s}' +
      '.fh-skip:hover{color:#fff}' +
      '.fh-ico{font-size:34px;line-height:1;text-align:center;margin:4px 0 10px}' +
      '.fh-title{font-size:17px;font-weight:800;text-align:center;margin:0 0 8px;font-family:inherit}' +
      '.fh-text{font-size:13px;line-height:1.55;color:#cbd5e1;text-align:center;margin:0 0 16px}' +
      '.fh-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid rgba(255,255,255,.08);padding-top:14px}' +
      '.fh-dots{display:flex;gap:5px;flex:1;flex-wrap:wrap}' +
      '.fh-dot{width:6px;height:6px;border-radius:50%;background:#3a3f4d;transition:all .25s}' +
      '.fh-dot.on{background:var(--primary-color,#ffbc00);width:18px;border-radius:4px;box-shadow:0 0 8px var(--primary-glow,rgba(255,188,0,.5))}' +
      '.fh-btns{display:flex;gap:8px}' +
      '.fh-btn{border:0;border-radius:10px;font-weight:800;font-size:13px;padding:9px 16px;cursor:pointer;font-family:inherit}' +
      '.fh-back{background:rgba(255,255,255,.08);color:#d5d8e2}' +
      '.fh-next{background:linear-gradient(135deg,var(--primary-color,#ffbc00),#ff8a00);color:#000;box-shadow:0 2px 14px var(--primary-glow,rgba(255,188,0,.45))}' +
      '.fh-btn:active{transform:scale(.96)}' +
      '.fh-btn:focus-visible,.fh-skip:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
      '.fh-min{position:absolute;top:12px;left:14px;background:none;border:0;color:#8b90a0;font-size:15px;line-height:1;cursor:pointer;padding:4px 6px;transition:color .2s}' +
      '.fh-min:hover{color:#fff}' +
      '.fh-card.min .fh-ico,.fh-card.min .fh-text,.fh-card.min .fh-dots{display:none}' +
      '.fh-card.min .fh-title{font-size:14px;margin:0 34px 10px;text-align:left}' +
      '.fh-card.min .fh-foot{border-top:0;padding-top:0;justify-content:flex-end}' +
      '.fh-card.min{padding:14px 16px}' +
      '.fh-title.typing::after{content:"";display:inline-block;width:2px;height:1em;background:var(--primary-color,#ffbc00);margin-left:3px;vertical-align:-2px;animation:fhBlink .7s steps(1) infinite}' +
      '@keyframes fhBlink{50%{opacity:0}}' +
      '.fh-title.done{animation:fhGlow 1.3s ease-out}' +
      '@keyframes fhGlow{0%{text-shadow:0 0 0 rgba(255,188,0,0)}40%{text-shadow:0 0 16px var(--primary-glow,rgba(255,188,0,.95))}100%{text-shadow:0 0 0 rgba(255,188,0,0)}}' +
      '@media (max-width:480px),(max-height:640px){' +
      '.fh-card{width:min(88vw,300px);padding:14px 14px 12px;border-radius:16px}' +
      '.fh-ico{font-size:24px;margin:2px 0 6px}' +
      '.fh-title{font-size:15px;margin:0 0 5px}' +
      '.fh-text{font-size:12px;line-height:1.45;margin:0 0 10px}' +
      '.fh-foot{padding-top:10px}' +
      '.fh-btn{font-size:12.5px;padding:8px 14px}' +
      '.fh-dot{width:5px;height:5px}.fh-dot.on{width:14px}' +
      '.fh-dots{gap:4px}' +
      '}' +
      '@media (prefers-reduced-motion:reduce){.fh-spot.on{animation:none}.fh-card,.fh-spot{transition:none}}';
    var s = document.createElement('style');
    s.id = 'fh-tour-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function build() {
    root = document.createElement('div');
    root.id = 'fh-tour';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Film House Guided Tour');
    root.innerHTML =
      '<div class="fh-ov"></div>' +
      '<div class="fh-spot"></div>' +
      '<div class="fh-card">' +
      '<button class="fh-min" type="button" aria-label="Shrink">&#9662;</button>' +
      '<button class="fh-skip" type="button">SKIP</button>' +
      '<div class="fh-ico"></div>' +
      '<h3 class="fh-title"></h3>' +
      '<p class="fh-text"></p>' +
      '<div class="fh-foot">' +
      '<div class="fh-dots"></div>' +
      '<div class="fh-btns">' +
      '<button class="fh-btn fh-back" type="button">Back</button>' +
      '<button class="fh-btn fh-next" type="button">Next</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(root);
    overlay = root.querySelector('.fh-ov');
    spot = root.querySelector('.fh-spot');
    card = root.querySelector('.fh-card');

    root.querySelector('.fh-skip').onclick = function () {
      triggerHapticFeedback('light');
      end();
    };
    root.querySelector('.fh-min').onclick = function () {
      var m = card.classList.toggle('min');
      this.innerHTML = m ? '&#9652;' : '&#9662;';
      this.setAttribute('aria-label', m ? 'Expand' : 'Shrink');
      triggerHapticFeedback('light');
      requestAnimationFrame(function () {
        place(locate(STEPS[idx].target));
      });
    };
    root.querySelector('.fh-back').onclick = function () {
      triggerHapticFeedback('light');
      go(idx - 1);
    };
    root.querySelector('.fh-next').onclick = function () {
      if (idx >= STEPS.length - 1) {
        triggerHapticFeedback('success');
        end();
      } else {
        triggerHapticFeedback('light');
        go(idx + 1);
      }
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      root.querySelector('.fh-next').click();
    } else if (e.key === 'ArrowLeft') {
      go(idx - 1);
    }
  }

  function onResize() {
    if (!active) return;
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      place(locate(STEPS[idx].target));
    }, 120);
  }

  /* ============ POSITIONING ============ */
  function place(target) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var cw = card.offsetWidth, ch = card.offsetHeight, m = 14;
    var bottomNav = document.querySelector('.bottom-nav');
    var bottomNavHeight = (bottomNav && visible(bottomNav)) ? (bottomNav.offsetHeight + 10) : 65;
    var topHeader = document.querySelector('.app-header');
    var topHeaderHeight = (topHeader && visible(topHeader)) ? (topHeader.offsetHeight + 6) : 55;
    var top, left;

    var accent = getThemeAccent();
    spot.style.borderColor = accent;

    if (target) {
      var r = target.getBoundingClientRect();
      var pad = 6;
      spot.style.top = (r.top - pad) + 'px';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      spot.classList.add('on');
      overlay.classList.add('has-spot');

      var below = r.bottom + pad + m;
      var above = r.top - pad - m - ch;
      var maxBottom = vh - bottomNavHeight - ch - m;

      if (r.top > vh * 0.52 && above >= topHeaderHeight) {
        top = above;
      } else if (below + ch <= vh - bottomNavHeight) {
        top = below;
      } else if (above >= m) {
        top = above;
      } else {
        top = Math.max(m, Math.min(below, maxBottom));
      }
      left = r.left + r.width / 2 - cw / 2;
    } else {
      spot.classList.remove('on');
      overlay.classList.remove('has-spot');
      top = (vh - bottomNavHeight - ch) / 2;
      left = (vw - cw) / 2;
    }
    left = Math.max(m, Math.min(left, vw - cw - m));
    top = Math.max(m, Math.min(top, vh - bottomNavHeight - ch - m));
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  }

  /* ============ ANIMATED WELCOME ============ */
  var typeToken = 0;
  function setTitle(s) {
    var el = card.querySelector('.fh-title');
    var my = ++typeToken;
    el.classList.remove('typing', 'done');
    if (!s.welcome) {
      el.textContent = s.title;
      return;
    }
    var name = cleanName(getUserName());
    var full = name ? 'Welcome, ' + name + '!' : s.title;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!name || reduced) {
      el.textContent = full;
      return;
    }
    var chars = Array.from(full), i = 0;
    el.textContent = '';
    el.classList.add('typing');
    (function tick() {
      if (my !== typeToken) return;
      el.textContent = chars.slice(0, ++i).join('');
      if (i < chars.length) return setTimeout(tick, 70);
      setTimeout(function () {
        if (my !== typeToken) return;
        el.classList.remove('typing');
        el.classList.add('done');
      }, 500);
    })();
  }

  /* ============ FLOW ============ */
  function render() {
    var s = STEPS[idx];
    card.classList.remove('on');
    card.querySelector('.fh-ico').textContent = s.icon;
    card.classList.remove('min');
    var mb = root.querySelector('.fh-min');
    if (mb) {
      mb.innerHTML = '&#9662;';
      mb.setAttribute('aria-label', 'Shrink');
    }
    setTitle(s);
    card.querySelector('.fh-text').textContent = s.text;
    var dots = '';
    for (var i = 0; i < STEPS.length; i++) {
      dots += '<span class="fh-dot' + (i === idx ? ' on' : '') + '"></span>';
    }
    card.querySelector('.fh-dots').innerHTML = dots;
    card.querySelector('.fh-back').style.display = idx === 0 ? 'none' : '';
    card.querySelector('.fh-next').textContent = s.last ? "Let's Watch! 🍿" : (idx === 0 ? 'Start tour' : 'Next');
    root.querySelector('.fh-skip').style.display = s.last ? 'none' : '';
  }

  function go(n) {
    if (n < 0 || n >= STEPS.length) return;
    idx = n;
    var s = STEPS[idx];
    render();
    spot.classList.remove('on');
    openTab(s.tab);

    var tries = 0;
    (function attempt() {
      var t = s.target ? locate(s.target) : null;
      if (s.target && !t && tries < 6) {
        tries++;
        return setTimeout(attempt, 150);
      }
      if (t) {
        try {
          t.scrollIntoView({
            block: 'center',
            behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto'
          });
        } catch (_) { }
      }
      var mb = root.querySelector('.fh-min');
      if (mb) mb.style.display = t ? '' : 'none';
      setTimeout(function () {
        place(t);
        card.classList.add('on');
        card.querySelector('.fh-next').focus({ preventScroll: true });
      }, t ? 120 : 0);
    })();
  }

  function start(force) {
    if (active) return;
    if (!force && seen()) return;
    injectCSS();
    closeOldPopups();
    if (!root || !document.body.contains(root)) build();
    root.style.display = '';
    active = true;
    document.body.style.overflow = 'hidden';
    triggerHapticFeedback('medium');
    go(0);
  }

  function end() {
    active = false;
    markSeen();
    if (root) root.style.display = 'none';
    document.body.style.overflow = '';
    openTab('home');
  }

  /* ============ PUBLIC API ============ */
  window.FilmHouseTour = {
    start: start,
    reset: function () {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('filmhouse_tour_completed');
      } catch (_) { }
    }
  };

  /* ============ AUTO-BOOT ============ */
  function isTourRequested() {
    try {
      var s = window.location.search || '';
      var h = window.location.hash || '';
      if (s.includes('tour=1') || s.includes('tour=true') || s.includes('startapp=tour') || h.includes('tour')) return true;
      var tgParam = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.start_param;
      if (tgParam && String(tgParam).toLowerCase() === 'tour') return true;
    } catch (_) { }
    return false;
  }

  function boot() {
    var requested = isTourRequested();
    if (!requested && (!AUTO_START || seen())) return;
    if (requested) {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('filmhouse_tour_completed');
      } catch (_) { }
    }
    var waited = 0;
    (function wait() {
      var loader = document.getElementById('initial-app-loader') || document.querySelector('.app-loader') || document.getElementById('preloader');
      var loaderGone = !loader || loader.style.display === 'none' || loader.classList.contains('fade-out');
      var ready = loaderGone && document.getElementById('screen-home');
      if (ready || waited > 10000) {
        return setTimeout(function () {
          start(true);
        }, requested ? 800 : START_DELAY);
      }
      waited += 300;
      setTimeout(wait, 300);
    })();
  }

  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
