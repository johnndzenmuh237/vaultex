/* =========================================================
   WITHDRAWAL.JS — withdrawal page logic
   Mirrors deposit.js. Relies on shared `auth` global from
   firebase-init.js, loaded before this script.

   ---------------------------------------------------------
   BACKEND CONTRACT (implement these endpoints server-side):

   POST /api/create-withdrawal
     body: { currency, address, amount }
     - Validates amount <= available balance and <= remaining
       daily limit. Does NOT touch the user's balance yet.
     - Creates a record: { id, currency, address, amount,
       status: "pending", reason: null, createdAt }
     - Notifies admin (email/Slack/internal queue) that a new
       withdrawal is awaiting review.
     - returns { success: true, withdrawal: {...} }

   GET /api/get-withdrawal-status?id=...
     returns { success: true, status, reason }
     - status is one of: pending | approved | rejected

   GET /api/get-withdrawals?limit=10
     returns { success: true, withdrawals: [ {...}, ... ] }

   Admin-side (separate authenticated admin panel, not this
   file) calls something like:
     POST /api/admin/review-withdrawal
       body: { id, decision: "approve" | "reject", reason }
     - On approve: deduct amount from user's balance, mark
       status "approved", trigger the actual on-chain payout.
     - On reject: leave balance untouched, mark status
       "rejected", store the admin's reason so the user can
       read it and resubmit after fixing the issue.
   ========================================================= */

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  const currencySelect = el("wd-currency");
  const addressInput = el("wd-address");
  const amountInput = el("wd-amount");
  const submitBtn = el("wd-submit-btn");
  const formError = el("wd-form-error");
  const rejectedNote = el("wd-rejected-note");
  const rejectedReasonEl = el("wd-rejected-reason");

  const statusBadge = el("wd-status-badge");
  const statusEmpty = el("wd-status-empty");
  const statusDetail = el("wd-status-detail");
  const statusMessage = el("wd-status-message");
  const detailCurrency = el("wd-detail-currency");
  const detailAmount = el("wd-detail-amount");
  const detailAddress = el("wd-detail-address");

  const usedTodayEl = el("wd-used-today");
  const usedBarEl = el("wd-used-bar");
  const historyBody = el("wd-history-body");

  let currentUser = null;
  let pollTimer = null;

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
        document.querySelectorAll('[data-user-balance]').forEach((node) => {
          node.textContent = `$${Number(data.balance).toFixed(2)}`;
        });
      }
    } catch (e) {
      console.error("Failed to load balance", e);
    }
  }

  async function refreshHistory() {
    if (!historyBody) return;
    try {
      const res = await authedFetch("/api/get-withdrawals?limit=10");
      const data = await res.json();
      if (!data.success || !data.withdrawals.length) return;

      historyBody.innerHTML = data.withdrawals
        .map((wd) => `
          <tr>
            <td>${new Date(wd.createdAt).toLocaleString()}</td>
            <td>${wd.currency?.toUpperCase() || "--"}</td>
            <td>${Number(wd.amount)} </td>
            <td class="mono" title="${wd.address}">${truncateAddress(wd.address)}</td>
            <td>${renderStatusPill(wd.status)}</td>
            <td>${wd.reason ? escapeHtml(wd.reason) : "--"}</td>
          </tr>`)
        .join("");

      // Surface the reason for the most recent rejection so the user
      // sees it right away, not just buried in the table.
      const mostRecent = data.withdrawals[0];
      if (mostRecent && mostRecent.status === "rejected" && mostRecent.reason) {
        rejectedReasonEl.textContent = mostRecent.reason;
        rejectedNote.hidden = false;
      } else {
        rejectedNote.hidden = true;
      }

      updateDailyUsage(data.withdrawals);

      // If there's an in-flight (pending) withdrawal, resume polling it
      // so a page refresh doesn't lose the status view.
      const pending = data.withdrawals.find((w) => w.status === "pending");
      if (pending) {
        showStatus(pending);
        startPolling(pending.id);
      }
    } catch (e) {
      console.error("Failed to load withdrawal history", e);
    }
  }

  function updateDailyUsage(withdrawals) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const usedToday = withdrawals
      .filter((w) => w.status === "approved" && new Date(w.createdAt) >= todayStart)
      .reduce((sum, w) => sum + Number(w.usd_value || 0), 0);
    const dailyLimit = 100000;
    if (usedTodayEl) usedTodayEl.textContent = `$${usedToday.toLocaleString()}`;
    if (usedBarEl) usedBarEl.style.width = `${Math.min(100, (usedToday / dailyLimit) * 100)}%`;
  }

  function truncateAddress(addr) {
    if (!addr) return "--";
    return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderStatusPill(status) {
    const map = {
      pending: "pill-neutral",
      approved: "pill-success",
      rejected: "pill-danger",
    };
    const cls = map[status] || "pill-neutral";
    return `<span class="pill ${cls}">${status || "pending"}</span>`;
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      formError.hidden = true;

      const currency = currencySelect.value;
      const address = addressInput.value.trim();
      const amount = Number(amountInput.value);

      if (!address) {
        return showFormError("Enter a recipient address.");
      }
      if (!amount || amount <= 0) {
        return showFormError("Enter a valid amount.");
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";

      try {
        const res = await authedFetch("/api/create-withdrawal", {
          method: "POST",
          body: JSON.stringify({ currency, address, amount }),
        });
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.message || "Could not submit withdrawal");
        }

        rejectedNote.hidden = true;
        addressInput.value = "";
        amountInput.value = "";

        showStatus(data.withdrawal);
        startPolling(data.withdrawal.id);
        refreshHistory();
      } catch (e) {
        showFormError(e.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Review withdrawal";
      }
    });
  }

  function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  function showStatus(withdrawal) {
    statusEmpty.hidden = true;
    statusDetail.hidden = false;
    statusBadge.hidden = false;

    detailCurrency.textContent = withdrawal.currency?.toUpperCase() || "--";
    detailAmount.textContent = withdrawal.amount;
    detailAddress.textContent = truncateAddress(withdrawal.address);
    detailAddress.title = withdrawal.address;

    setStatus(withdrawal.status, withdrawal.reason);
  }

  function setStatus(status, reason) {
    const map = {
      pending: "pill-neutral",
      approved: "pill-success",
      rejected: "pill-danger",
    };
    statusBadge.className = "pill " + (map[status] || "pill-neutral");
    statusBadge.textContent = statusLabel(status);
    statusMessage.textContent = statusMessageFor(status, reason);
  }

  function statusLabel(status) {
    return {
      pending: "Pending admin review",
      approved: "Approved — payment sent",
      rejected: "Rejected",
    }[status] || "Pending admin review";
  }

  function statusMessageFor(status, reason) {
    if (status === "approved") {
      return "Your withdrawal was approved and the payment has been sent. Your balance has been updated.";
    }
    if (status === "rejected") {
      return reason
        ? `Rejected: ${reason}. Your balance is unaffected — fix the issue above and resubmit.`
        : "Rejected. Your balance is unaffected — check the note in your history and resubmit.";
    }
    return "Your request is pending admin review. Your balance won't change until it's approved.";
  }

  function startPolling(withdrawalId) {
    if (pollTimer) clearInterval(pollTimer);

    pollTimer = setInterval(async () => {
      try {
        const res = await authedFetch(`/api/get-withdrawal-status?id=${withdrawalId}`);
        const data = await res.json();
        if (!data.success) return;

        setStatus(data.status, data.reason);

        if (["approved", "rejected"].includes(data.status)) {
          clearInterval(pollTimer);
          refreshBalance();
          refreshHistory();
        }
      } catch (e) {
        console.error("Withdrawal polling error", e);
      }
    }, 5000);
  }
})();