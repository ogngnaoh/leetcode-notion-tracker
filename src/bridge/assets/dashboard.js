const refreshUrl = '/dashboard?refresh=1';
const dialog = document.querySelector('#dashboard-settings-dialog');
const form = document.querySelector('#dashboard-settings-form');
const opener = document.querySelector('#open-dashboard-settings');
const cancel = document.querySelector('#cancel-dashboard-settings');
const input = document.querySelector('#daily-new-problem-goal');
const error = document.querySelector('#dashboard-settings-error');
const token = document.querySelector('meta[name="dashboard-settings-token"]')?.content;

if (
  dialog instanceof HTMLDialogElement &&
  form instanceof HTMLFormElement &&
  opener instanceof HTMLButtonElement &&
  cancel instanceof HTMLButtonElement &&
  input instanceof HTMLInputElement &&
  error instanceof HTMLElement
) {
  opener.addEventListener('click', () => {
    error.textContent = '';
    dialog.showModal();
    input.focus();
    input.select();
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener.focus());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const goal = Number(input.value);
    const controls = form.querySelectorAll('button, input');
    for (const control of controls) control.disabled = true;
    error.textContent = '';
    try {
      if (!token) throw new Error('Reload the dashboard and try again.');
      const response = await fetch('/dashboard/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LC-Dashboard-Token': token,
        },
        body: JSON.stringify({ dailyNewProblemGoal: goal }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof body?.error === 'string' ? body.error : 'The local bridge rejected the change.',
        );
      }
      if (!Number.isInteger(body?.dailyNewProblemGoal)) {
        throw new Error('The local bridge returned an invalid response.');
      }
      input.value = String(body.dailyNewProblemGoal);
      const denominator = document.querySelector('[data-dashboard-goal]');
      if (denominator) denominator.textContent = ` / ${body.dailyNewProblemGoal}`;
      dialog.close();
    } catch (caught) {
      error.textContent =
        caught instanceof Error
          ? caught.message
          : 'Could not save the goal. Check the local bridge and try again.';
    } finally {
      for (const control of controls) control.disabled = false;
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
    if (activeFilter === 'hard') return row.dataset.difficulty === 'Hard';
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
  if (dialog instanceof HTMLDialogElement && dialog.open) {
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
    !(dialog instanceof HTMLDialogElement && dialog.open)
  ) {
    window.location.replace(refreshUrl);
  }
});
