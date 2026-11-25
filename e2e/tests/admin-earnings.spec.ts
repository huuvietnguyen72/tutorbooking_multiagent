// QUA-58 §2: admin reconciliation (đối soát) of tutor earnings, and its effect on the tutor's report.
// Month -1 is used for the settle flow; nothing else settles it.
import { ACCOUNTS } from '../fixtures/env';
import { finishedLessonAt, lessonStartIn, monthLabel, vnMonth, type EarningItems, type EarningsSummary } from '../fixtures/earnings';
import { vnd, pickSelectMonth } from '../fixtures/ui';
import { expect, test } from '../fixtures/test';

interface AdminRow {
  tutorId: string;
  tutorName: string;
  sessionCount: number;
  netVnd: number;
  settledNetVnd: number;
  unsettledNetVnd: number;
  settledCount: number;
  unsettledCount: number;
}
interface AdminList { month: string; monthClosed: boolean; items: AdminRow[] }
interface Settlement { settledCount: number; alreadySettledCount: number; settledNetVnd: number }

test.describe('Admin đối soát thu nhập gia sư', () => {
  test('chọn tháng, đối soát một gia sư: số "đã đối soát" tăng, gia sư khác giữ nguyên, màn gia sư khớp', async ({ pageAs, student, student2, tutor, tutor2, admin, newSlot, db }) => {
    test.setTimeout(240_000);
    const month = vnMonth(-1);
    const deps = { newSlot, db };
    await finishedLessonAt(deps, student, tutor, lessonStartIn(-1, 0));
    await finishedLessonAt(deps, student2, tutor, lessonStartIn(-1, 1));
    await finishedLessonAt(deps, student, tutor2, lessonStartIn(-1, 2));

    const before = await admin.get<AdminList>(`/admin/earnings?month=${month}`);
    expect(before.monthClosed).toBe(true);
    const row = before.items.find((r) => r.tutorName === ACCOUNTS.tutor.fullName)!;
    const other = before.items.find((r) => r.tutorName === ACCOUNTS.tutor2.fullName)!;
    expect(row.unsettledCount).toBeGreaterThanOrEqual(2);
    expect(other.unsettledCount).toBeGreaterThanOrEqual(1);

    const page = await pageAs('admin');
    await page.goto(`/admin/doi-soat?month=${month}`);
    await expect(page.getByRole('heading', { name: 'Đối soát thu nhập gia sư' })).toBeVisible();
    await expect(page.locator('#earnings-month')).toHaveValue(monthLabel(month));
    const tableRow = (name: string) => page.locator('.ant-table-tbody .ant-table-row', { hasText: name });
    await expect(tableRow(ACCOUNTS.tutor.fullName)).toContainText(String(row.sessionCount));
    await expect(tableRow(ACCOUNTS.tutor.fullName)).toContainText(vnd(row.unsettledNetVnd));

    // Confirm dialog states exactly what will be settled.
    await page.getByRole('button', { name: `Đối soát tháng ${ACCOUNTS.tutor.fullName}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Đối soát tháng ${month} cho ${ACCOUNTS.tutor.fullName}?`);
    await expect(dialog).toContainText(`${row.unsettledCount} buổi`);
    await dialog.getByRole('button', { name: 'Xác nhận đối soát' }).click();
    await expect(page.getByText(`Đã đối soát ${row.unsettledCount} buổi`).first()).toBeVisible();

    // Admin list: settled went up by exactly what was open, nothing is left open, the other tutor is untouched.
    const after = await admin.get<AdminList>(`/admin/earnings?month=${month}`);
    const rowAfter = after.items.find((r) => r.tutorId === row.tutorId)!;
    expect(rowAfter.settledNetVnd).toBe(row.settledNetVnd + row.unsettledNetVnd);
    expect(rowAfter.settledNetVnd).toBeGreaterThan(row.settledNetVnd);
    expect(rowAfter.unsettledNetVnd).toBe(0);
    expect(rowAfter.unsettledCount).toBe(0);
    expect(after.items.find((r) => r.tutorId === other.tutorId)).toMatchObject({ settledNetVnd: other.settledNetVnd, unsettledNetVnd: other.unsettledNetVnd });
    await expect(tableRow(ACCOUNTS.tutor.fullName).getByRole('button', { name: `Đối soát tháng ${ACCOUNTS.tutor.fullName}` })).toBeDisabled();
    await expect(page.getByRole('button', { name: `Đối soát tháng ${ACCOUNTS.tutor2.fullName}` })).toBeEnabled();

    // Detail drawer lists the sessions as settled.
    await page.getByRole('button', { name: `Chi tiết ${ACCOUNTS.tutor.fullName}` }).click();
    const drawer = page.locator('.ant-drawer-content');
    await expect(drawer.locator('.ant-table-tbody .ant-table-row').first()).toBeVisible();
    await expect(drawer.getByText('Chưa đối soát', { exact: true })).toHaveCount(0);
    await expect(drawer.getByText('Đã đối soát', { exact: true }).first()).toBeVisible();
    await page.keyboard.press('Escape');

    // Idempotent: a repeat settles nothing.
    const again = await admin.send<Settlement>('put', `/admin/tutors/${row.tutorId}/earnings/${month}/settlement`, {});
    expect(again.status).toBe(200);
    expect(again.body.settledCount).toBe(0);
    expect(again.body.alreadySettledCount).toBe(rowAfter.sessionCount);

    // The tutor's own report reflects it, in the API and on screen.
    const mine = await tutor.get<EarningsSummary>(`/tutor/earnings?month=${month}`);
    expect(mine.settledNetVnd).toBe(rowAfter.settledNetVnd);
    expect(mine.unsettledNetVnd).toBe(0);
    const items = await tutor.get<EarningItems>(`/tutor/earnings/items?month=${month}&pageSize=100`);
    expect(items.items.every((i) => i.settled)).toBe(true);
    const tutorPage = await pageAs('tutor');
    await tutorPage.goto('/gia-su/thu-nhap');
    await pickSelectMonth(tutorPage, 'earnings-month', `Tháng ${monthLabel(month)}`);
    const settledCard = tutorPage.locator('.ant-statistic', { has: tutorPage.locator('.ant-statistic-title', { hasText: /^Đã đối soát$/ }) });
    await expect(settledCard).toContainText(vnd(mine.settledNetVnd));
    const openCard = tutorPage.locator('.ant-statistic', { has: tutorPage.locator('.ant-statistic-title', { hasText: /^Chưa đối soát$/ }) });
    await expect(openCard).toContainText(/(^|\D)0(\D|$)/);
  });

  test('không đối soát được tháng chưa kết thúc: tháng tương lai/hiện tại bị chặn ở API và UI', async ({ pageAs, student, tutor, admin, newSlot, db }) => {
    const tutorId = (await student.get<{ items: { id: string; fullName: string }[] }>('/tutors')).items.find((x) => x.fullName === ACCOUNTS.tutor.fullName)!.id;
    for (const month of [vnMonth(1), vnMonth(0)]) {
      const res = await admin.send<{ code?: string }>('put', `/admin/tutors/${tutorId}/earnings/${month}/settlement`, {});
      expect(res.status, month).toBe(409);
    }
    expect((await admin.send('put', `/admin/tutors/${tutorId}/earnings/2026-13/settlement`, {})).status).toBe(400);
    // Only admins settle.
    expect((await tutor.send('put', `/admin/tutors/${tutorId}/earnings/${vnMonth(-1)}/settlement`, {})).status).toBe(403);
    expect((await student.send('get', '/admin/earnings')).status).toBe(403);

    // A future month in the URL falls back to the current month.
    const page = await pageAs('admin');
    await page.goto(`/admin/doi-soat?month=${vnMonth(1)}`);
    await expect(page.locator('#earnings-month')).toHaveValue(monthLabel(vnMonth(0)));

    // A lesson that already ended this month (when the month is old enough to hold one): the button is disabled with the reason.
    const startAt = new Date(Date.now() - (2 + Math.random() * 3) * 3_600_000);
    const sameMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(startAt).slice(0, 7) === vnMonth(0);
    if (sameMonth) {
      await finishedLessonAt({ newSlot, db }, student, tutor, startAt);
      await page.goto('/admin/doi-soat');
      const button = page.getByRole('button', { name: `Đối soát tháng ${ACCOUNTS.tutor.fullName}` });
      await expect(button).toBeDisabled();
      await button.locator('xpath=..').hover();
      await expect(page.getByText('Tháng chưa kết thúc nên chưa thể đối soát.')).toBeVisible();
    }
  });
});
