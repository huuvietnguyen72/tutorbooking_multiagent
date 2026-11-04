const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const rating = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** `250.000 ₫` */
export function formatVnd(amount: number): string {
  return vnd.format(amount);
}

/** `4,8` */
export function formatRating(value: number): string {
  return rating.format(value);
}

/** Initial letter for avatar fallbacks. */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}
