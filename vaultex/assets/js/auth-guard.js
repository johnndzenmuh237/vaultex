/* =========================================================
   AUTH-GUARD.JS — protects dashboard pages using real
   Firebase Auth state. Redirects to login if no session
   exists. Loads the user's profile fields for display.

   NOTE ON BALANCE / TRANSACTIONS / TRADING:
   Those are intentionally NOT wired here to fake or client-
   computed numbers. They must be read from your backend once
   Coinbase Custody + exchange routing are actually connected
   (e.g. a Cloud Function or server endpoint that talks to
   Custody/exchange APIs with real credentials, never exposed
   client-side). Until that exists, the dashboard shows a
   pending state instead of invented figures — see
   dashboard.js for the corresponding placeholder logic.
   ========================================================= */

(function () {
  'use strict';

  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = '/auth/login.html';
      return;
    }

    if (!user.emailVerified) {
      window.location.href = '/auth/verify-email.html';
      return;
    }

    document.querySelectorAll('[data-user-firstname]').forEach(el => {
      el.textContent = (user.displayName || 'there').split(' ')[0];
    });
    document.querySelectorAll('[data-user-fullname]').forEach(el => {
      el.textContent = user.displayName || user.email;
    });
    document.querySelectorAll('[data-user-email]').forEach(el => {
      el.textContent = user.email;
    });

    // Pull additional profile/account-status fields (KYC state, whether
    // custody is linked yet) so the UI can reflect real onboarding status.
    db.collection('users').doc(user.uid).get().then((doc) => {
      if (!doc.exists) return;
      const data = doc.data();
      document.querySelectorAll('[data-kyc-status]').forEach(el => {
        el.textContent = data.kycStatus || 'not_started';
      });
      document.querySelectorAll('[data-custody-linked]').forEach(el => {
        el.textContent = data.custodyLinked ? 'Linked' : 'Not linked yet';
      });
    });
  });

  document.querySelectorAll('[data-logout]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await auth.signOut();
      } finally {
        window.location.href = '/auth/login.html';
      }
    });
  });

})();
