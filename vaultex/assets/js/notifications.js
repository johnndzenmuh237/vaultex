/* =========================================================
   NOTIFICATIONS.JS — notification bell dropdown + badge
   ========================================================= */

(function () {
  'use strict';

  const NOTIFS = [
    { title: 'Deposit confirmed', body: '0.42 BTC has been credited to your wallet.', time: '2m ago', unread: true },
    { title: 'Price alert', body: 'ETH crossed your target of $3,400.', time: '1h ago', unread: true },
    { title: 'Security', body: 'New login detected from Chrome on Windows.', time: '5h ago', unread: false },
    { title: 'Staking reward', body: 'You earned 0.0021 SOL from staking.', time: '1d ago', unread: false }
  ];

  const list = document.querySelector('[data-notif-list]');
  const badge = document.querySelector('[data-notif-badge]');
  if (list) {
    list.innerHTML = NOTIFS.map(n => `
      <div class="security-row" style="align-items:flex-start;">
        <div>
          <strong style="font-size:.88rem;">${n.title}</strong>
          <p style="margin:4px 0 0;font-size:.83rem;">${n.body}</p>
          <span style="font-size:.74rem;color:var(--muted);">${n.time}</span>
        </div>
        ${n.unread ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--mint);flex-shrink:0;margin-top:4px;"></span>' : ''}
      </div>`).join('');
  }
  if (badge) {
    const unreadCount = NOTIFS.filter(n => n.unread).length;
    badge.textContent = unreadCount;
    badge.style.display = unreadCount ? 'flex' : 'none';
  }

})();
