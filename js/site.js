// Fades sections in as they scroll into view. The page works the same without it.
(() => {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const targets = document.querySelectorAll('.section-head, .app, .feature, .steps li, .sources, .notice, .cta, .stats');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of targets) { el.classList.add('reveal'); io.observe(el); }
})();
