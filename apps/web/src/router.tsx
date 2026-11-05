import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router-dom';
import type { TutorApprovalStatus } from './api/types';
import { GuestOnly, RequireAuth, RequireTutorStatus } from './auth/guards';
import { ROUTES } from './auth/routes';
import AppLayout from './layout/AppLayout';
import AccountPage from './pages/AccountPage';
import ForcedChangePasswordPage from './pages/ChangePasswordPage';
import LoginPage from './pages/LoginPage';
import {
  ForbiddenPage,
  HomePage,
  NotFoundPage,
  PlaceholderPage,
  ServerErrorPage,
  TutorGatePage,
} from './pages/MiscPages';
import AdminAuditPage from './pages/admin/AdminAuditPage';
import AdminBookingDetailPage from './pages/admin/AdminBookingDetailPage';
import AdminBookingsPage from './pages/admin/AdminBookingsPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminTutorsPage from './pages/admin/AdminTutorsPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import RegisterPage from './pages/RegisterPage';
import TutorDetailPage from './pages/TutorDetailPage';
import TutorListPage from './pages/TutorListPage';
import TutorProfilePage from './pages/tutor/TutorProfilePage';
import TutorReviewsPage from './pages/tutor/TutorReviewsPage';
import TutorSessionDetailPage from './pages/tutor/TutorSessionDetailPage';
import TutorSessionsPage from './pages/tutor/TutorSessionsPage';
import TutorSlotsPage from './pages/tutor/TutorSlotsPage';

/** A suspended tutor keeps access to existing sessions/reviews (S-16). */
const SESSION_STATES: TutorApprovalStatus[] = ['APPROVED', 'SUSPENDED'];

const placeholder = <PlaceholderPage />;

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { path: ROUTES.home, element: <HomePage /> },
      { path: ROUTES.tutors, element: <TutorListPage /> },
      { path: '/gia-su/:id', element: <TutorDetailPage /> },
      { path: ROUTES.login, element: <GuestOnly><LoginPage /></GuestOnly> },
      { path: ROUTES.register, element: <GuestOnly><RegisterPage /></GuestOnly> },
      { path: ROUTES.forcePassword, element: <RequireAuth><ForcedChangePasswordPage /></RequireAuth> },
      { path: ROUTES.forbidden, element: <ForbiddenPage /> },
      { path: ROUTES.notFound, element: <NotFoundPage /> },
      { path: ROUTES.error, element: <ServerErrorPage /> },

      {
        element: <RequireAuth />,
        children: [{ path: ROUTES.account, element: <AccountPage /> }],
      },
      {
        element: <RequireAuth roles={['STUDENT']} />,
        children: [
          { path: '/dat-lich/:slotId', element: placeholder },
          { path: ROUTES.myBookings, element: placeholder },
          { path: '/lich-cua-toi/:bookingId', element: placeholder },
          { path: '/thanh-toan/:bookingId', element: placeholder },
          { path: '/thanh-toan/:bookingId/ket-qua', element: placeholder },
          { path: '/cong-thanh-toan-gia-lap/:paymentId', element: placeholder },
        ],
      },
      {
        element: <RequireAuth roles={['TUTOR']} />,
        children: [
          { path: ROUTES.tutorGate, element: <TutorGatePage /> },
          { path: ROUTES.tutorProfile, element: <TutorProfilePage /> },
          { path: ROUTES.tutorSlots, element: <RequireTutorStatus allow={['APPROVED']}><TutorSlotsPage /></RequireTutorStatus> },
          { path: ROUTES.tutorSessions, element: <RequireTutorStatus allow={SESSION_STATES}><TutorSessionsPage /></RequireTutorStatus> },
          { path: '/gia-su/buoi-day/:bookingId', element: <RequireTutorStatus allow={SESSION_STATES}><TutorSessionDetailPage /></RequireTutorStatus> },
          { path: ROUTES.tutorReviews, element: <RequireTutorStatus allow={SESSION_STATES}><TutorReviewsPage /></RequireTutorStatus> },
        ],
      },
      {
        element: <RequireAuth roles={['ADMIN']} />,
        children: [
          { path: ROUTES.admin, element: <AdminDashboardPage /> },
          { path: ROUTES.adminTutors, element: <AdminTutorsPage /> },
          { path: ROUTES.adminUsers, element: <AdminUsersPage /> },
          { path: ROUTES.adminBookings, element: <AdminBookingsPage /> },
          { path: '/admin/booking/:bookingId', element: <AdminBookingDetailPage /> },
          { path: ROUTES.adminAudit, element: <AdminAuditPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) => createMemoryRouter(routes, { initialEntries });
