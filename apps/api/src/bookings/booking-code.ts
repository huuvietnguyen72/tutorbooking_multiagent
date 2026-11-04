/** Display code of a booking, e.g. `#BK-1024` (docs/architecture.md §3.2). */
export const formatBookingCode = (code: bigint | number): string => `#BK-${code}`;
