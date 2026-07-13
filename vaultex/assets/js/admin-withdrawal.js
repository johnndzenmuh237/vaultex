/* =========================================================
   ADMIN-WITHDRAWAL.JS — admin withdrawal review logic
   Relies on shared `auth` / `db` globals from firebase-init.js.

   IMPORTANT: this page must be protected by an admin-only guard
   (admin-guard.js), analogous to auth-guard.js but additionally
   checking a custom claim / role, e.g.:

     auth.onAuthStateChanged(async (user) => {
       if (!user) return (window.location.href = "login.html");
       const token = await user.getIdTokenResult();
       if (!token.claims.admin) return (window.location.href = "dashboard.html");
     });

   Never gate admin access purely on a client-side check — the
   backend endpoints below must independently verify the caller's
   admin claim on every request, since client-side checks can be
   bypassed.

   ---------------------------------------------------------
   BACKEND CONTRACT (implement these endpoints server-side,
   all requiring an authenticated admin):

   GET /api/admin/get-pending-withdrawals
     returns { success: true, withdrawals: [
       { id, userId, userEmail, currency, address, amount,
         userBalance, createdAt }
     ] }

   GET /api/admin/get-reviewed-withdrawals?limit=20
     returns { success: true, withdrawals: [
       { id, userId, userEmail, currency, amount, status,
         reason, reviewedAt }
     ] }

   POST /api/admin/review-withdrawal
     body: { id, decision: "approve" | "reject", reason? }
     - "approve": server re-checks the user's current balance
       covers the amount, deducts it, marks status "approved",
       and triggers the actual on-chain payout.
     - "reject": requires a non-empty `reason`; balance is left
       untouched, status set to "rejected", reason stored so the
       user can read it and resubmit.
     returns { success: true }
   ========================================================= */

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  const pendingBody = el("pending-body");
  const reviewedBody = el("reviewed-body");
  const refreshBtn = el("refresh-btn");
  const statPending = el("stat-pending");
  const statApproved = el("stat-approved");
  const statRejected = el("stat-rejected");

  const rejectModal = el("reject-modal");
  const rejectReasonInput = el("reject-reason-input");
  const rejectModalError = el("reject-modal-error");
  const rejectCancelBtn = el("reject-cancel-btn");
  const rejectConfirmBtn = el("reject-confirm-btn");

  let currentAdmin = null;
  let pendingWithdrawal = null; // id currently targeted by the reject modal

  auth.onAuthStateChanged((user) => {
    currentAdmin = user;
    if (user) {
      loadPending();
      loadReviewed();
    }
  });

  async function authedFetch(url, options = {}) {
    if (!currentAdmin) throw new Error("Not signed in");
    const token = await currentAdmin.getIdToken();
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  }

  async function loadPending() {
    if (!pendingBody) return;
    pendingBody.innerHTML = `<tr><td colspan="7">Loading pending withdrawals…</td></tr>`;
    try {
      const res = await authedFetch("/api/admin/get-pending-withdrawals");
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to load");

      statPending.textContent = data.withdrawals.length;

      if (!data.withdrawals.length) {
        pendingBody.innerHTML = `<tr><td colspan="7">No pending withdrawals right now.</td></tr>`;
        return;
      }

      pendingBody.innerHTML = data.withdrawals
        .map((wd) => `
          <tr data-id="${wd.id}">
            <td>${new Date(wd.createdAt).toLocaleString()}</td>
            <td>${escapeHtml(wd.userEmail || wd.userId)}</td>
            <td>${wd.currency?.toUpperCase() || "--"}</td>
            <td>${Number(wd.amount)}</td>
            <td class="mono" title="${escapeHtml(wd.address)}">${truncate(wd.address)}</td>
            <td>$${Number(wd.userBalance).toFixed(2)}</td>
            <td>
              <div class="flex" style="gap:6px;">
                <button class="btn btn-primary btn-sm" data-approve="${wd.id}">Approve</button>
                <button class="btn btn-ghost btn-sm" data-reject="${wd.id}">Reject</button>
              </div>
            </td>
          </tr>`)
        .join("");

      pendingBody.querySelectorAll("[data-approve]").forEach((btn) => {
        btn.addEventListener("click", () => handleApprove(btn.dataset.approve, btn));
      });
      pendingBody.querySelectorAll("[data-reject]").forEach((btn) => {
        btn.addEventListener("click", () => openRejectModal(btn.dataset.reject));
      });
    } catch (e) {
      pendingBody.innerHTML = `<tr><td colspan="7">Couldn't load pending withdrawals: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function loadReviewed() {
    if (!reviewedBody) return;
    try {
      const res = await authedFetch("/api/admin/get-reviewed-withdrawals?limit=20");
      const data = await res.json();
      if (!data.success || !data.withdrawals.length) return;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const approvedToday = data.withdrawals.filter(
        (w) => w.status === "approved" && new Date(w.reviewedAt) >= todayStart
      ).length;
      const rejectedToday = data.withdrawals.filter(
        (w) => w.status === "rejected" && new Date(w.reviewedAt) >= todayStart
      ).length;
      statApproved.textContent = approvedToday;
      statRejected.textContent = rejectedToday;

      reviewedBody.innerHTML = data.withdrawals
        .map((wd) => `
          <tr>
            <td>${new Date(wd.reviewedAt).toLocaleString()}</td>
            <td>${escapeHtml(wd.userEmail || wd.userId)}</td>
            <td>${wd.currency?.toUpperCase() || "--"}</td>
            <td>${Number(wd.amount)}</td>
            <td>${renderDecisionPill(wd.status)}</td>
            <td>${wd.reason ? escapeHtml(wd.reason) : "--"}</td>
          </tr>`)
        .join("");
    } catch (e) {
      console.error("Failed to load reviewed withdrawals", e);
    }
  }

  async function handleApprove(id, btn) {
    if (!confirm("Approve this withdrawal? This will deduct the amount from the user's balance and trigger payout.")) {
      return;
    }
    setRowBusy(id, true);
    try {
      const res = await authedFetch("/api/admin/review-withdrawal", {
        method: "POST",
        body: JSON.stringify({ id, decision: "approve" }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Approval failed");
      loadPending();
      loadReviewed();
    } catch (e) {
      alert(`Couldn't approve: ${e.message}`);
      setRowBusy(id, false);
    }
  }

  function openRejectModal(id) {
    pendingWithdrawal = id;
    rejectReasonInput.value = "";
    rejectModalError.hidden = true;
    rejectModal.style.display = "flex";
    rejectReasonInput.focus();
  }

  function closeRejectModal() {
    rejectModal.style.display = "none";
    pendingWithdrawal = null;
  }

  rejectCancelBtn.addEventListener("click", closeRejectModal);

  rejectConfirmBtn.addEventListener("click", async () => {
    const reason = rejectReasonInput.value.trim();
    if (!reason) {
      rejectModalError.textContent = "A reason is required so the user knows what to fix.";
      rejectModalError.hidden = false;
      return;
    }

    rejectConfirmBtn.disabled = true;
    rejectConfirmBtn.textContent = "Rejecting…";

    try {
      const res = await authedFetch("/api/admin/review-withdrawal", {
        method: "POST",
        body: JSON.stringify({ id: pendingWithdrawal, decision: "reject", reason }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Rejection failed");

      closeRejectModal();
      loadPending();
      loadReviewed();
    } catch (e) {
      rejectModalError.textContent = e.message;
      rejectModalError.hidden = false;
    } finally {
      rejectConfirmBtn.disabled = false;
      rejectConfirmBtn.textContent = "Confirm rejection";
    }
  });

  function setRowBusy(id, busy) {
    const row = pendingBody.querySelector(`tr[data-id="${id}"]`);
    if (!row) return;
    row.querySelectorAll("button").forEach((b) => (b.disabled = busy));
  }

  function renderDecisionPill(status) {
    const map = { approved: "pill-success", rejected: "pill-danger" };
    return `<span class="pill ${map[status] || "pill-neutral"}">${status}</span>`;
  }

  function truncate(addr) {
    if (!addr) return "--";
    return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadPending();
      loadReviewed();
    });
  }
})();