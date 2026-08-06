const refreshUrl = '/dashboard?refresh=1';
const dialog = document.querySelector('#dashboard-settings-dialog');
const opener = document.querySelector('#open-dashboard-settings');
const cancel = document.querySelector('#cancel-dashboard-settings');
const goalButton = document.querySelector('[data-dashboard-goal]');
const goalInput = document.querySelector('#daily-new-problem-goal');
const goalError = document.querySelector('#daily-new-problem-goal-error');
const resetOpener = document.querySelector('#reset-new-problem-session');
const resetDialog = document.querySelector('#reset-new-problem-session-dialog');
const resetCancel = document.querySelector('#cancel-new-problem-session-reset');
const resetConfirm = document.querySelector('#confirm-new-problem-session-reset');
const resetError = document.querySelector('#reset-new-problem-session-error');
const token = document.querySelector('meta[name="dashboard-settings-token"]')?.content;

if (
  dialog instanceof HTMLDialogElement &&
  opener instanceof HTMLButtonElement &&
  cancel instanceof HTMLButtonElement &&
  goalButton instanceof HTMLButtonElement &&
  goalInput instanceof HTMLInputElement &&
  goalError instanceof HTMLElement &&
  resetOpener instanceof HTMLButtonElement &&
  resetDialog instanceof HTMLDialogElement &&
  resetCancel instanceof HTMLButtonElement &&
  resetConfirm instanceof HTMLButtonElement &&
  resetError instanceof HTMLElement
) {
  let persistedGoal = Number(goalInput.value);
  let savingGoal = false;

  const saveSettings = async (body) => {
    if (!token) throw new Error('Reload the dashboard and try again.');
    const response = await fetch('/dashboard/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LC-Dashboard-Token': token,
      },
      body: JSON.stringify(body),
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        typeof responseBody?.error === 'string'
          ? responseBody.error
          : 'The local bridge rejected the change.',
      );
    }
    return responseBody;
  };

  const clearGoalError = () => {
    goalError.textContent = '';
    goalInput.removeAttribute('aria-invalid');
  };

  const updateGoal = (goal) => {
    persistedGoal = goal;
    goalButton.textContent = String(goal);
    goalButton.setAttribute('aria-label', `Maximum new problems: ${goal}. Activate to edit.`);
    goalInput.value = String(goal);
  };

  const finishGoalEdit = (restoreFocus) => {
    goalInput.value = String(persistedGoal);
    clearGoalError();
    goalInput.hidden = true;
    goalButton.hidden = false;
    if (restoreFocus) goalButton.focus();
  };

  const beginGoalEdit = () => {
    if (savingGoal) return;
    clearGoalError();
    goalInput.value = String(persistedGoal);
    goalButton.hidden = true;
    goalInput.hidden = false;
    goalInput.focus();
    goalInput.select();
  };

  const persistGoal = async (restoreFocus) => {
    if (savingGoal) return;
    const value = goalInput.value.trim();
    const goal = Number(value);
    if (value === '' || !Number.isInteger(goal) || goal < 1 || goal > 100) {
      goalInput.setAttribute('aria-invalid', 'true');
      goalError.textContent = 'Enter an integer from 1–100.';
      return;
    }
    if (goal === persistedGoal) {
      finishGoalEdit(restoreFocus);
      return;
    }

    savingGoal = true;
    goalInput.disabled = true;
    clearGoalError();
    try {
      const body = await saveSettings({ dailyNewProblemGoal: goal });
      if (
        !Number.isInteger(body?.dailyNewProblemGoal) ||
        body.dailyNewProblemGoal < 1 ||
        body.dailyNewProblemGoal > 100
      ) {
        throw new Error('The local bridge returned an invalid response.');
      }
      updateGoal(body.dailyNewProblemGoal);
      finishGoalEdit(restoreFocus);
    } catch (caught) {
      goalError.textContent =
        caught instanceof Error
          ? caught.message
          : 'Could not save the goal. Check the local bridge and try again.';
    } finally {
      savingGoal = false;
      goalInput.disabled = false;
    }
  };

  goalButton.addEventListener('click', beginGoalEdit);
  goalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finishGoalEdit(true);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void persistGoal(true);
    }
  });
  goalInput.addEventListener('blur', () => {
    if (!savingGoal) void persistGoal(false);
  });

  opener.addEventListener('click', () => {
    dialog.showModal();
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener.focus());
  resetOpener.addEventListener('click', () => {
    resetError.textContent = '';
    resetDialog.showModal();
    resetCancel.focus();
  });
  resetCancel.addEventListener('click', () => resetDialog.close());
  resetDialog.addEventListener('close', () => {
    if (dialog.open) resetOpener.focus();
  });
  resetConfirm.addEventListener('click', async () => {
    resetConfirm.disabled = true;
    resetCancel.disabled = true;
    resetError.textContent = '';
    try {
      const body = await saveSettings({ resetNewProblemSession: true });
      if (
        body?.newProblemCount !== 0 ||
        !Number.isInteger(body?.dailyNewProblemGoal) ||
        typeof body?.newProblemSessionStartedAt !== 'string'
      ) {
        throw new Error('The local bridge returned an invalid response.');
      }
      const count = document.querySelector('[data-dashboard-new-problem-count]');
      if (count) count.textContent = '0';
      updateGoal(body.dailyNewProblemGoal);
      finishGoalEdit(false);
      resetDialog.close();
      dialog.close();
    } catch (caught) {
      resetError.textContent =
        caught instanceof Error
          ? caught.message
          : 'Could not reset the count. Check the local bridge and try again.';
    } finally {
      resetConfirm.disabled = false;
      resetCancel.disabled = false;
    }
  });
}

const reviewQueue = document.querySelector('[data-review-queue]');
const reviewSearch = document.querySelector('[data-review-search]');
const reviewFilters = Array.from(document.querySelectorAll('[data-review-filter]'));
const reviewRows = Array.from(document.querySelectorAll('[data-review-row]'));
const reviewStatus = document.querySelector('[data-review-results]');
const reviewEmpty = document.querySelector('[data-review-empty]');
const reviewMore = document.querySelector('[data-review-more]');
const dashboardDate = document.querySelector('.masthead time[datetime]');

if (
  reviewQueue instanceof HTMLElement &&
  reviewSearch instanceof HTMLInputElement &&
  reviewFilters.length > 0 &&
  reviewFilters.every((filter) => filter instanceof HTMLButtonElement) &&
  reviewRows.every((row) => row instanceof HTMLElement) &&
  reviewStatus instanceof HTMLElement &&
  reviewEmpty instanceof HTMLElement &&
  reviewMore instanceof HTMLButtonElement &&
  dashboardDate instanceof HTMLTimeElement
) {
  let activeFilter = 'all';
  let visibleLimit = 50;
  const batchSize = 50;
  const snapshotDate = dashboardDate.dateTime;

  const matchesFilter = (row) => {
    if (activeFilter === 'today') return row.dataset.reviewDate === snapshotDate;
    if (activeFilter === 'overdue') return row.dataset.reviewDate < snapshotDate;
    if (activeFilter === 'needed-help') return row.dataset.practiceState === 'Needed help';
    return true;
  };

  const updateReviewQueue = () => {
    const searchTerm = reviewSearch.value.trim().toLowerCase();
    const matchingRows = reviewRows.filter(
      (row) => row.dataset.title?.includes(searchTerm) && matchesFilter(row),
    );
    const visibleRows = matchingRows.slice(0, visibleLimit);
    const visibleSet = new Set(visibleRows);

    for (const row of reviewRows) row.hidden = !visibleSet.has(row);
    for (const filter of reviewFilters) {
      filter.setAttribute('aria-pressed', String(filter.dataset.reviewFilter === activeFilter));
    }

    reviewStatus.textContent = `Showing ${visibleRows.length} of ${matchingRows.length} matching reviews`;
    reviewEmpty.hidden = matchingRows.length !== 0;
    reviewMore.hidden = visibleRows.length >= matchingRows.length;
  };

  for (const filter of reviewFilters) {
    filter.addEventListener('click', () => {
      activeFilter = filter.dataset.reviewFilter ?? 'all';
      visibleLimit = batchSize;
      updateReviewQueue();
    });
  }

  reviewSearch.addEventListener('input', () => {
    visibleLimit = batchSize;
    updateReviewQueue();
  });
  reviewMore.addEventListener('click', () => {
    visibleLimit += batchSize;
    updateReviewQueue();
  });

  updateReviewQueue();
}

function reloadLoadingDashboard() {
  if (
    (dialog instanceof HTMLDialogElement && dialog.open) ||
    (resetDialog instanceof HTMLDialogElement && resetDialog.open) ||
    (goalInput instanceof HTMLInputElement && !goalInput.hidden)
  ) {
    window.setTimeout(reloadLoadingDashboard, 400);
    return;
  }
  window.location.replace('/dashboard');
}

if (
  window.location.pathname === '/dashboard' &&
  document.querySelector('[data-dashboard-loading]')
) {
  window.setTimeout(reloadLoadingDashboard, 400);
}

document.addEventListener('visibilitychange', () => {
  if (
    document.visibilityState === 'visible' &&
    !(dialog instanceof HTMLDialogElement && dialog.open) &&
    !(resetDialog instanceof HTMLDialogElement && resetDialog.open) &&
    !(goalInput instanceof HTMLInputElement && !goalInput.hidden)
  ) {
    window.location.replace(refreshUrl);
  }
});
