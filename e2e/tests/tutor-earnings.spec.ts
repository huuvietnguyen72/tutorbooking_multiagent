// QUA-58 §1: tutor earnings report (S-29/S-30) end to end. Lessons are moved into closed months that no other spec uses
// (-2 data, -3 filter/paging, -5 empty); finished lessons of other specs sit 13+ months back.
import type { Page } from '@playwright/test';
import { ACCOUNTS } from '../fixtures/env';
import { Api } from '../fixtures/api';
import { finishedLessonAt, lessonStartIn, monthLabel, statValue, sum, vnMonth, type EarningItems, type EarningsSummary } from '../fixtures/earnings';
import { expect, test } from '../fixtures/test';
import { pickSelectMonth } from '../fixtures/ui';

const PAGE_SIZE = 10;
const rows = (page: Page) => page.locator('.ant-table-tbody .ant-table-row');

async function openMonth(page: Page, month: string): Promise<void> {
  await page.goto('/gia-su/thu-nhap');
  await expect(page.getByRole('heading', { name: 'Thu nhập', level: 3 })).toBeVisible();
  await pickSelectMonth(page, 'earnings-month', `Tháng ${monthLabel(month)}`);
  await expect(page.getByRole('region', { name: `Tổng quan thu nhập tháng ${monthLabel(month)}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Chi tiết tháng ${monthLabel(month)}` })).toBeVisible();
}

const tutorIdOf = async (api: Api): Promise<string> =>
  (await api.get<{ items: { id: string; fullName: string }[] }>('/tutors')).items.find((x) => x.fullName === ACCOUNTS.tutor.fullName)!.id;

test.describe('Báo cáo thu nhập gia sư', () => {
  // Each case waits out the real per-minute request window before it starts.
  test.describe.configure({ timeout: 240_000 });

  test('quyền truy cập: chưa đăng nhập 401, học viên 403, tháng tương lai 400', async ({ pageAs, student, tutor, admin }) => {
    const anonymous = await Api.anonymous();
    for (const path of ['/tutor/earnings', '/tutor/earnings/items']) {
      expect((await anonymous.send('get', path)).status, `anonymous ${path}`).toBe(401);
      expect((await student.send('get', path)).status, `student ${path}`).toBe(403);
      expect((await admin.send('get', path)).status, `admin ${path}`).toBe(403);
    }
    await anonymous.dispose();

    expect((await tutor.send('get', `/tutor/earnings?month=${vnMonth(1)}`)).status).toBe(400);
    expect((await tutor.send('get', `/tutor/earnings?month=${vnMonth(-25)}`)).status).toBe(400);
    expect((await tutor.send('get', '/tutor/earnings?month=2026-13')).status).toBe(400);

    const page = await pageAs('student');
    await page.goto('/gia-su/thu-nhap');
    await expect(page).toHaveURL(/\/403$/);
  });

  test('tháng có dữ liệu: 5 chỉ số khớp tổng các dòng chi tiết', async ({ pageAs, student, tutor, newSlot, db }) => {
    const month = vnMonth(-2);
    const lessons = [];
    for (let i = 0; i < 2; i++) lessons.push(await finishedLessonAt({ newSlot, db }, student, tutor, lessonStartIn(-2, i)));

    const summary = await tutor.get<EarningsSummary>(`/tutor/earnings?month=${month}`);
    const items = await tutor.get<EarningItems>(`/tutor/earnings/items?month=${month}&pageSize=100`);
    // API: the figures are the sum of the rows.
    expect(summary.isEmpty).toBe(false);
    expect(summary.sessionCount).toBe(items.total);
    expect(summary.grossVnd).toBe(sum(items.items.map((i) => i.priceVnd)));
    expect(summary.platformFeeVnd).toBe(sum(items.items.map((i) => i.platformFeeVnd)));
    expect(summary.netVnd).toBe(summary.grossVnd - summary.platformFeeVnd);
    expect(summary.netVnd).toBe(sum(items.items.map((i) => i.netVnd)));
    expect(summary.settledNetVnd + summary.unsettledNetVnd).toBe(summary.netVnd);
    for (const lesson of lessons) expect(items.items.map((i) => i.code)).toContain(lesson.code);

    // UI shows the same numbers.
    const page = await pageAs('tutor');
    await openMonth(page, month);
    expect(await statValue(page, 'Số buổi đã dạy')).toBe(summary.sessionCount);
    expect(await statValue(page, 'Tổng tiền thu')).toBe(summary.grossVnd);
    expect(await statValue(page, 'Phí nền tảng')).toBe(summary.platformFeeVnd);
    expect(await statValue(page, 'Thực nhận')).toBe(summary.netVnd);
    expect(await statValue(page, 'Đã đối soát')).toBe(summary.settledNetVnd);
    expect(await statValue(page, 'Chưa đối soát')).toBe(summary.unsettledNetVnd);
    await expect(page.getByText('Chưa có buổi dạy nào trong tháng này')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(Math.min(items.total, PAGE_SIZE));
    for (const lesson of lessons) await expect(page.getByRole('cell', { name: lesson.code, exact: true })).toBeVisible();
  });

  test('tháng rỗng: số liệu bằng 0, thông báo trống và bảng không có dòng', async ({ pageAs, tutor }) => {
    const month = vnMonth(-5);
    const summary = await tutor.get<EarningsSummary>(`/tutor/earnings?month=${month}`);
    expect(summary).toMatchObject({ isEmpty: true, sessionCount: 0, grossVnd: 0, platformFeeVnd: 0, netVnd: 0, settledNetVnd: 0, unsettledNetVnd: 0 });
    expect((await tutor.get<EarningItems>(`/tutor/earnings/items?month=${month}`)).total).toBe(0);

    const page = await pageAs('tutor');
    await openMonth(page, month);
    await expect(page.getByText('Chưa có buổi dạy nào trong tháng này')).toBeVisible();
    for (const title of ['Số buổi đã dạy', 'Tổng tiền thu', 'Phí nền tảng', 'Thực nhận', 'Đã đối soát', 'Chưa đối soát']) {
      expect(await statValue(page, title), title).toBe(0);
    }
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText('Không có buổi nào khớp bộ lọc')).toBeVisible();
  });

  test('lọc đã/chưa đối soát và phân trang 10 dòng/trang', async ({ pageAs, student, student2, tutor, admin, newSlot, db }) => {
    test.setTimeout(300_000);
    const month = vnMonth(-3);
    const tutorId = await tutorIdOf(student);
    // 4 lessons, settle them, then 7 more that stay open: 11 rows in one month.
    for (let i = 0; i < 4; i++) await finishedLessonAt({ newSlot, db }, i % 2 ? student2 : student, tutor, lessonStartIn(-3, i));
    const res = await admin.send<{ settledCount: number }>('put', `/admin/tutors/${tutorId}/earnings/${month}/settlement`, {});
    expect(res.status).toBe(200);
    expect(res.body.settledCount).toBeGreaterThanOrEqual(4);
    for (let i = 4; i < 11; i++) await finishedLessonAt({ newSlot, db }, i % 2 ? student2 : student, tutor, lessonStartIn(-3, i));

    const all = await tutor.get<EarningItems>(`/tutor/earnings/items?month=${month}&pageSize=100`);
    const settled = all.items.filter((i) => i.settled).length;
    const open = all.items.length - settled;
    expect(settled).toBeGreaterThanOrEqual(4);
    expect(open).toBeGreaterThanOrEqual(7);
    expect(all.total).toBeGreaterThan(PAGE_SIZE);

    const page = await pageAs('tutor');
    await openMonth(page, month);
    // Paging: full first page, remainder on the last page.
    await expect(rows(page)).toHaveCount(PAGE_SIZE);
    const lastPage = Math.ceil(all.total / PAGE_SIZE);
    await page.locator('.ant-pagination').getByTitle(String(lastPage), { exact: true }).click();
    await expect(rows(page)).toHaveCount(all.total - (lastPage - 1) * PAGE_SIZE);

    // Filters: each shows only its own rows, and the count matches the API.
    const radio = (name: string) => page.locator('label.ant-radio-button-wrapper', { hasText: new RegExp(`^${name}$`) });
    await radio('Đã đối soát').click();
    await expect(rows(page)).toHaveCount(Math.min(settled, PAGE_SIZE));
    await expect(rows(page).getByText('Chưa đối soát', { exact: true })).toHaveCount(0);
    await expect(rows(page).first().getByText('Đã đối soát', { exact: true })).toBeVisible();

    await radio('Chưa đối soát').click();
    await expect(rows(page)).toHaveCount(Math.min(open, PAGE_SIZE));
    await expect(rows(page).getByText('Đã đối soát', { exact: true })).toHaveCount(0);
    await expect(rows(page).first().getByText('Chưa đối soát', { exact: true })).toBeVisible();

    await radio('Tất cả').click();
    await expect(rows(page)).toHaveCount(PAGE_SIZE);
    // The filter never changes the month's headline figures.
    const summary = await tutor.get<EarningsSummary>(`/tutor/earnings?month=${month}`);
    expect(await statValue(page, 'Đã đối soát')).toBe(summary.settledNetVnd);
    expect(await statValue(page, 'Chưa đối soát')).toBe(summary.unsettledNetVnd);
    expect(summary.settledNetVnd).toBe(sum(all.items.filter((i) => i.settled).map((i) => i.netVnd)));
  });
});
