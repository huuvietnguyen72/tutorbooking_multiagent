import { Spin } from 'antd';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { useMe } from '../api/hooks';
import type { TutorApprovalStatus, UserRole } from '../api/types';
import { postAuthHome, ROUTES } from './routes';
import { safeNext } from '../lib/safeNext';
import { ErrorState } from '../components/States';

function FullSpin() {
  return (
    <div style={{ textAlign: 'center', padding: 64 }}>
      <Spin size="large" />
    </div>
  );
}

/** Requires a session (and optionally one of `roles`). Guests go to login with `?next=`; wrong role gets 403. */
export function RequireAuth({ roles, children }: { roles?: UserRole[]; children?: ReactNode }) {
  const { data: me, isPending, isError, refetch } = useMe();
  const location = useLocation();

  if (isPending) return <FullSpin />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`${ROUTES.login}?next=${next}`} replace />;
  }
  if (roles && !roles.includes(me.role)) return <Navigate to={ROUTES.forbidden} replace />;
  return children ?? <Outlet />;
}

/**
 * Login / register are for guests only. A signed-in user leaves via `?next=` when it is a safe
 * same-origin path (so booking resumes at the chosen slot), otherwise via their role's home.
 */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  const location = useLocation();
  const [params] = useSearchParams();
  if (isPending) return <FullSpin />;
  if (me) {
    const via = location.pathname === ROUTES.register ? 'register' : 'login';
    return <Navigate to={postAuthHome(me, safeNext(params.get('next')), via)} replace />;
  }
  return children;
}

/** Accounts flagged `mustChangePassword` may only use the change-password screen (API answers 403 otherwise). */
export function ForcePasswordGate() {
  const { data: me } = useMe();
  const location = useLocation();
  if (me?.mustChangePassword && location.pathname !== ROUTES.forcePassword) {
    return <Navigate to={ROUTES.forcePassword} replace />;
  }
  return <Outlet />;
}

/**
 * Tutor-only pages. `allow` lists the approval states that may enter; everyone else lands on the S-16 gate.
 * (Slots need APPROVED; the session list also stays open for SUSPENDED tutors to see existing bookings.)
 */
export function RequireTutorStatus({ allow, children }: { allow: TutorApprovalStatus[]; children: ReactNode }) {
  const { data: me } = useMe();
  const status = me?.tutorApprovalStatus ?? 'PENDING_APPROVAL';
  return allow.includes(status) ? children : <Navigate to={ROUTES.tutorGate} replace />;
}
