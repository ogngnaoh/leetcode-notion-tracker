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
