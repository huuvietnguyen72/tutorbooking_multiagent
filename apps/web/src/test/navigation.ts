import { screen } from '@testing-library/react';
import { expect } from 'vitest';

export const FORBIDDEN_MESSAGE = 'Bạn không có quyền truy cập trang này.';

type RouterLike = { state: { location: { pathname: string } } };

/**
 * Waits for the 403 page to be committed to the DOM before asserting the URL.
 *
 * Reading `router.state.location` alone can resolve before React commits the guard's
 * redirect. A subsequent `router.navigate()` is then batched with that uncommitted
 * redirect, so React commits only the newest location and the already-mounted
 * `<Navigate to="/403">` keeps the same target, never re-runs its effect, and the
 * guard silently stops redirecting. Waiting for the rendered page guarantees the
 * commit (and unmount) happened before the test moves on.
 */
export async function expectForbidden(router: RouterLike, timeout = 5000): Promise<void> {
  expect(await screen.findByText(FORBIDDEN_MESSAGE, {}, { timeout })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/403');
}
