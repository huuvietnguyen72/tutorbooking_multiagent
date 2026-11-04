import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router-dom';
import { GuestOnly, RequireAuth } from './auth/guards';
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
import RegisterPage from './pages/RegisterPage';
import TutorDetailPage from './pages/TutorDetailPage';
import TutorListPage from './pages/TutorListPage';

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
          { path: ROUTES.tutorProfile, element: placeholder },
          { path: ROUTES.tutorSlots, element: placeholder },
          { path: ROUTES.tutorSessions, element: placeholder },
          { path: '/gia-su/buoi-day/:bookingId', element: placeholder },
          { path: ROUTES.tutorReviews, element: placeholder },
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
