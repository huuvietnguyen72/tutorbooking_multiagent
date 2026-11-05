import { useNavigate } from 'react-router-dom';
import { useResumeCheckout } from '../../api/hooks';
import { ROUTES } from '../../auth/routes';
import { safeNext } from '../../lib/safeNext';

/** "Pay now": asks the API for the checkout URL again and follows it, but only if it stays inside the SPA. */
export function useResumeCheckoutRedirect(bookingId: string) {
  const navigate = useNavigate();
  const resume = useResumeCheckout(bookingId);
  return {
    isPending: resume.isPending,
    run: () =>
      resume.mutate(undefined, {
        onSuccess: (res) => {
          const target = safeNext(res.checkoutUrl);
          if (target) navigate(target);
        },
        // BOOKING_NOT_PAYABLE etc.: the hold is gone, so show the real outcome.
        onError: () => navigate(ROUTES.payResult(bookingId), { replace: true }),
      }),
  };
}
