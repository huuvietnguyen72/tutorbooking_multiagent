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
import BookingConfirmPage from './pages/student/BookingConfirmPage';
import BookingDetailPage from './pages/student/BookingDetailPage';
import MockGatewayPage from './pages/student/MockGatewayPage';
import MyBookingsPage from './pages/student/MyBookingsPage';
import PaymentPage from './pages/student/PaymentPage';
import PaymentResultPage from './pages/student/PaymentResultPage';
import ReschedulePage from './pages/student/ReschedulePage';
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
  // S-08 is a standalone page (no app chrome), like a hosted payment gateway.
  {
    element: <RequireAuth roles={['STUDENT']} />,
    children: [{ path: '/cong-thanh-toan-gia-lap/:paymentId', element: <MockGatewayPage /> }],
  },
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
          { path: '/dat-lich/:slotId', element: <BookingConfirmPage /> },
          { path: ROUTES.myBookings, element: <MyBookingsPage /> },
          { path: '/lich-cua-toi/:bookingId', element: <BookingDetailPage /> },
          { path: '/lich-cua-toi/:bookingId/doi-lich', element: <ReschedulePage /> },
          { path: '/thanh-toan/:bookingId', element: <PaymentPage /> },
          { path: '/thanh-toan/:bookingId/ket-qua', element: <PaymentResultPage /> },
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
          { path: ROUTES.admin, element: placeholder },
          { path: '/admin/*', element: placeholder },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) => createMemoryRouter(routes, { initialEntries });
