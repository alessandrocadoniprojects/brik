// brik — marketing pages: scroll reveals + integrated prompt redirect
(function () {
  // Reveal-on-scroll (staggered within a group via data-delay)
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && els.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var el = e.target;
          var d = el.getAttribute('data-delay');
          if (d) el.style.transitionDelay = d + 'ms';
          el.classList.add('in');
          io.unobserve(el);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // Integrated generator: send the prompt to the app (/?prompt=…)
  document.querySelectorAll('[data-promptbox]').forEach(function (box) {
    var ta = box.querySelector('textarea');
    var go = function () {
      var v = (ta && ta.value || '').trim();
      window.location.href = '/' + (v ? '?prompt=' + encodeURIComponent(v) : '');
    };
    var btn = box.querySelector('[data-go]');
    if (btn) btn.addEventListener('click', go);
    if (ta) ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); go(); }
    });
  });
})();
