// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', links.classList.contains('open'));
    });

    // Close menu on link click
    links.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => links.classList.remove('open'));
    });
  }

  // FAQ accordion
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const answer = item.querySelector('.faq-answer');
      const isOpen = item.classList.contains('open');

      // Close all
      document.querySelectorAll('.faq-item.open').forEach(openItem => {
        openItem.classList.remove('open');
        openItem.querySelector('.faq-answer').style.maxHeight = '0';
      });

      // Open clicked if it was closed
      if (!isOpen) {
        item.classList.add('open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
      }
    });
  });

  // Scroll fade-in
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.1 }
  );

  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

  // Active nav link
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
});

// Privacy page: analytics opt-out button
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('ht-optout-btn');
  const status = document.getElementById('ht-optout-status');
  if (!btn || !window.HT) return;
  const render = () => {
    const off = window.HT.isOptedOut();
    btn.textContent = off ? 'Turn analytics back on' : 'Turn off analytics';
    status.textContent = navigator.globalPrivacyControl === true
      ? 'Off: your browser sends Global Privacy Control.'
      : (off ? 'Analytics are off in this browser.' : 'Analytics are on.');
    btn.disabled = navigator.globalPrivacyControl === true;
  };
  btn.addEventListener('click', () => {
    if (window.HT.isOptedOut()) window.HT.optIn(); else window.HT.optOut();
    render();
  });
  render();
});
