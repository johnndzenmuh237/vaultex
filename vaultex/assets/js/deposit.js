/* =========================================================
   DEPOSIT.JS — deposit page logic
   Relies on the shared `auth` / `db` globals created by
   firebase-init.js, which must load BEFORE this script.
   Load order on deposits.html should be:
     firebase-app-compat.js
     firebase-auth-compat.js
     firebase-firestore-compat.js
     firebase-init.js
     auth-guard.js   (redirects if not logged in)
     deposit.js       <- this file, loaded last
   ========================================================= */

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  const generateBtn = el("generate-btn");
  const currencySelect = el("currency-select");
  const amountInput = el("amount-input");
  const formError = el("form-error");
  const resultPanel = el("result-panel");
  const statusBadge = el("status-badge");
  const historyBody = el("history-body");

  let currentUser = null;
  let pollTimer = null;
  let countdownTimer = null;

  // auth-guard.js already redirects to login if there's no user, so by the
  // time this fires with a user, we're safe to proceed. We still guard
  // against null here in case deposit.js ever loads on a page without
  // auth-guard.js protecting it.
  auth.onAuthStateChanged((user) => {
    currentUser = user;
    if (user) {
      refreshBalance();
      refreshHistory();
    }
  });

  async function authedFetch(url, options = {}) {
    if (!currentUser) throw new Error("Not signed in");
    const token = await currentUser.getIdToken();
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  }

  async function refreshBalance() {
    try {
      const res = await authedFetch("/api/get-balance");
      const data = await res.json();
      if (data.success) {
        document.querySelectorAll('[data-user-balance]').forEach((el) => {
          el.textContent = `$${Number(data.balance).toFixed(2)}`;
        });
      }
    } catch (e) {
      console.error("Failed to load balance", e);
    }
  }

  async function refreshHistory() {
    if (!historyBody) return;
    try {
      const res = await authedFetch("/api/get-transactions?limit=10");
      const data = await res.json();
      if (!data.success || !data.transactions.length) return;

      historyBody.innerHTML = data.transactions
        .map(
          (tx) => `
          <tr>
            <td>${new Date(tx.createdAt).toLocaleString()}</td>
            <td>${tx.pay_currency?.toUpperCase() || "--"}</td>
            <td>$${Number(tx.price_amount).toFixed(2)}</td>
            <td>${renderStatusPill(tx.payment_status)}</td>
            <td class="mono">${tx.payment_id}</td>
          </tr>`
        )
        .join("");
    } catch (e) {
      console.error("Failed to load history", e);
    }
  }

  function renderStatusPill(status) {
    const map = {
      waiting: "pill-neutral",
      confirming: "pill-info",
      confirmed: "pill-info",
      finished: "pill-success",
      failed: "pill-danger",
      expired: "pill-danger",
    };
    const cls = map[status] || "pill-neutral";
    return `<span class="pill ${cls}">${status || "waiting"}</span>`;
  }

  if (generateBtn) {
    generateBtn.addEventListener("click", async () => {
      formError.hidden = true;
      const amount = Number(amountInput.value);
      const pay_currency = currencySelect.value;

      if (!amount || amount < 5) {
        formError.textContent = "Enter an amount of at least $5.00.";
        formError.hidden = false;
        return;
      }

      generateBtn.disabled = true;
      generateBtn.textContent = "Generating…";

      try {
        const res = await authedFetch("/api/create-payment", {
          method: "POST",
          body: JSON.stringify({ amount, pay_currency, price_currency: "usd" }),
        });
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.message || "Could not create payment");
        }

        showResult(data.payment);
        startPolling(data.payment.payment_id);
      } catch (e) {
        formError.textContent = e.message;
        formError.hidden = false;
      } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate deposit address";
      }
    });
  }

  function showResult(payment) {
    resultPanel.hidden = false;

    el("pay-amount").textContent = `${payment.pay_amount} ${payment.pay_currency?.toUpperCase()}`;
    el("pay-address").textContent = payment.pay_address;
    el("pay-address").title = payment.pay_address;
    el("payment-id").textContent = payment.payment_id;

    el("qrcode").innerHTML = "";
    // eslint-disable-next-line no-undef
    new QRCode(el("qrcode"), {
      text: payment.pay_address,
      width: 144,
      height: 144,
    });

    setStatus(payment.payment_status || "waiting");

    if (payment.expiration_estimate_date) {
      startCountdown(payment.expiration_estimate_date);
    }

    resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function setStatus(status) {
    const map = {
      waiting: "pill-neutral",
      confirming: "pill-info",
      confirmed: "pill-info",
      finished: "pill-success",
      failed: "pill-danger",
      expired: "pill-danger",
    };
    statusBadge.className = "pill " + (map[status] || "pill-neutral");
    statusBadge.textContent = statusLabel(status);
  }

  function statusLabel(status) {
    return {
      waiting: "Waiting for payment",
      confirming: "Confirming on-chain",
      confirmed: "Confirming on-chain",
      finished: "Confirmed — balance updated",
      failed: "Payment failed",
      expired: "Payment expired",
    }[status] || "Waiting for payment";
  }

  function startPolling(paymentId) {
    if (pollTimer) clearInterval(pollTimer);

    pollTimer = setInterval(async () => {
      try {
        const res = await authedFetch(`/api/get-payment-status?payment_id=${paymentId}`);
        const data = await res.json();
        if (!data.success) return;

        setStatus(data.payment_status);

        if (["finished", "failed", "expired"].includes(data.payment_status)) {
          clearInterval(pollTimer);
          clearInterval(countdownTimer);
          refreshBalance();
          refreshHistory();
        }
      } catch (e) {
        console.error("Polling error", e);
      }
    }, 5000);
  }

  function startCountdown(expiryIso) {
    if (countdownTimer) clearInterval(countdownTimer);
    const countdownEl = el("countdown");

    countdownTimer = setInterval(() => {
      const diff = new Date(expiryIso).getTime() - Date.now();
      if (diff <= 0) {
        countdownEl.textContent = "Expired";
        clearInterval(countdownTimer);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      countdownEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    }, 1000);
  }

  function pad(n) {
    return n.toString().padStart(2, "0");
  }

  document.querySelectorAll("[data-copy-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.copyTarget;
      const text = el(targetId).textContent;
      navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = original), 1500);
      });
    });
  });
})();