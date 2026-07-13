/* =========================================================
   AUTH.JS — real Firebase Authentication wiring
   Register/login create real Firebase Auth accounts and
   real sessions. No mock data, no localStorage pretend-auth.
   Requires firebase-init.js loaded first on the page.

   PATH NOTE: this assumes login.html / register.html /
   forgot-password.html / verify-email.html all live together
   in the same "/auth/" folder, one level below the site root
   (same folder as ../index.html and ../assets/...).
   If your folder layout is different, adjust the two
   window.location.href redirects below to match.
   ========================================================= */

(function () {
  'use strict';

  function showError(message) {
    const el = document.getElementById('form-error');
    if (!el) return alert(message);
    el.textContent = message;
    el.style.display = 'block';
  }

  function hideError() {
    const el = document.getElementById('form-error');
    if (el) el.style.display = 'none';
  }

  function setLoading(button, loading, loadingText, normalText) {
    if (!button) return;
    button.disabled = loading;
    button.textContent = loading ? loadingText : normalText;
  }

  function friendlyError(code) {
    switch (code) {
      case 'auth/email-already-in-use': return 'An account with that email already exists.';
      case 'auth/invalid-email': return 'That email address looks invalid.';
      case 'auth/weak-password': return 'Password must be at least 8 characters.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential': return 'Incorrect email or password.';
      case 'auth/too-many-requests': return 'Too many attempts. Please wait a moment and try again.';
      default: return 'Something went wrong. Please try again.';
    }
  }

  /* ---- Register ---- */
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();
      const submitBtn = document.getElementById('register-submit');
      setLoading(submitBtn, true, 'Creating account…', 'Create account');

      const firstName = document.getElementById('fname').value.trim();
      const lastName = document.getElementById('lname').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const referral = document.getElementById('referral')?.value.trim() || null;

      try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);

        await cred.user.updateProfile({ displayName: `${firstName} ${lastName}` });

        // Store profile + account-status fields. Balance/holdings are NOT
        // written here — they only ever come from your custody/exchange
        // backend once that integration is live, never from the client.
        await db.collection('users').doc(cred.user.uid).set({
          firstName,
          lastName,
          email,
          referral,
          kycStatus: 'not_started',
          custodyLinked: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await cred.user.sendEmailVerification();

        // FIXED: was '/auth/verify-email.html' (absolute — breaks on file://
        // and on any host where the site isn't served from the domain root).
        // register.html and verify-email.html live in the same folder, so
        // this is just the bare filename.
        window.location.href = 'verify-email.html';
      } catch (err) {
        showError(friendlyError(err.code));
        setLoading(submitBtn, false, '', 'Create account');
      }
    });
  }

  /* ---- Login ---- */
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();
      const submitBtn = document.getElementById('login-submit');
      setLoading(submitBtn, true, 'Logging in…', 'Log in');

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const remember = document.getElementById('remember')?.checked;

      try {
        await auth.setPersistence(
          remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION
        );
        await auth.signInWithEmailAndPassword(email, password);

        // FIXED: was '/dashboard/dashboard.html' (absolute). login.html is in
        // /auth/, dashboard.html is in /dashboard/, so we go up one level.
        window.location.href = '../dashboard/dashboard.html';
      } catch (err) {
        showError(friendlyError(err.code));
        setLoading(submitBtn, false, '', 'Log in');
      }
    });
  }

  /* ---- Forgot password ---- */
  const forgotForm = document.getElementById('forgot-form');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('fp-email').value.trim();
      const successEl = document.getElementById('form-success');
      const errorEl = document.getElementById('form-error');
      errorEl.style.display = 'none';

      try {
        await auth.sendPasswordResetEmail(email);
      } catch (err) {
        // Intentionally show the same success message even on user-not-found,
        // so the form can't be used to enumerate registered emails.
      }
      successEl.style.display = 'block';
      successEl.textContent = 'If an account exists for that email, a reset link is on its way.';
    });
  }

})();
