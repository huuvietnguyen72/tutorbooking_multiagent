import type { Me, PublicReview, Subject, TutorPublic } from '../api/types';
import { addDaysIso, startOfWeekIso } from '../lib/time';

export const subjects: Subject[] = [
  { id: 1, name: 'Toán', slug: 'toan' },
  { id: 2, name: 'Vật lý', slug: 'vat-ly' },
  { id: 3, name: 'Hoá học', slug: 'hoa-hoc' },
  { id: 4, name: 'Tiếng Anh', slug: 'tieng-anh' },
  { id: 5, name: 'Ngữ văn', slug: 'ngu-van' },
];

const names = [
  'Trần Thị B', 'Nguyễn Văn An', 'Lê Hoàng Cường', 'Phạm Minh Dũng', 'Hoàng Thu Hà', 'Vũ Quang Huy',
  'Đặng Mai Lan', 'Bùi Anh Khoa', 'Ngô Thanh Mai', 'Đỗ Quốc Nam', 'Lý Hồng Nhung', 'Phan Gia Phúc',
];

export const tutors: TutorPublic[] = names.map((fullName, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  fullName,
  avatarUrl: null,
  subjects: [subjects[i % subjects.length], subjects[(i + 2) % subjects.length]],
  pricePerSessionVnd: 150_000 + (i % 6) * 50_000,
  ratingAvg: i % 5 === 4 ? 0 : 3.5 + ((i * 3) % 16) / 10,
  ratingCount: i % 5 === 4 ? 0 : 5 + i * 3,
  nextAvailableAt: i % 4 === 3 ? null : addDaysIso(startOfWeekIso(), 1 + (i % 5)),
  bio: `Xin chào, mình là ${fullName}. Mình thích giúp học sinh hiểu bài một cách dễ dàng.`,
  experience: `${2 + (i % 8)} năm kinh nghiệm`,
}));

export const reviews: PublicReview[] = Array.from({ length: 12 }, (_, i) => ({
  id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  studentName: `Học viên ${String.fromCharCode(65 + i)}.`,
  rating: 3 + (i % 3),
  comment: i % 4 === 0 ? null : 'Dạy dễ hiểu, nhiệt tình.',
  createdAt: new Date(Date.UTC(2026, 10, 1 + i, 3, 0, 0)).toISOString(),
}));

export interface MockUser extends Me {
  password: string;
}

/** Local-only demo accounts for MSW; not real credentials. */
export const users: MockUser[] = [
  { id: 'u-student', email: 'hocvien@example.test', password: 'mock-pass-1234', fullName: 'Nguyễn A', role: 'STUDENT', status: 'ACTIVE' },
  { id: 'u-tutor', email: 'giasu@example.test', password: 'mock-pass-1234', fullName: 'Trần Thị B', role: 'TUTOR', status: 'ACTIVE', tutorApprovalStatus: 'PENDING_APPROVAL' },
  { id: 'u-tutor-ok', email: 'giasu-duyet@example.test', password: 'mock-pass-1234', fullName: 'Lê Hoàng Cường', role: 'TUTOR', status: 'ACTIVE', tutorApprovalStatus: 'APPROVED' },
  { id: 'u-tutor-rej', email: 'giasu-tuchoi@example.test', password: 'mock-pass-1234', fullName: 'Phạm Minh Dũng', role: 'TUTOR', status: 'ACTIVE', tutorApprovalStatus: 'REJECTED' },
  { id: 'u-tutor-sus', email: 'giasu-tamngung@example.test', password: 'mock-pass-1234', fullName: 'Hoàng Thu Hà', role: 'TUTOR', status: 'ACTIVE', tutorApprovalStatus: 'SUSPENDED' },
  { id: 'u-admin', email: 'admin@example.test', password: 'mock-pass-1234', fullName: 'Quản trị', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: true },
  { id: 'u-locked', email: 'khoa@example.test', password: 'mock-pass-1234', fullName: 'Bị khoá', role: 'STUDENT', status: 'LOCKED' },
];
