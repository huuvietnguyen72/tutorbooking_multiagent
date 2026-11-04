import { Spin } from 'antd';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useMe } from '../api/hooks';
import type { UserRole } from '../api/types';
import { defaultHome, ROUTES } from './routes';
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

/** Login / register are for guests only; a logged-in user goes to their home. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  if (isPending) return <FullSpin />;
  if (me && !me.mustChangePassword) return <Navigate to={defaultHome(me)} replace />;
  if (me?.mustChangePassword) return <Navigate to={ROUTES.forcePassword} replace />;
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
