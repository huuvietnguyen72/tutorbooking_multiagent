import { Alert, Button, Card, Divider, List, Rate, Skeleton, Space, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { errorText } from '../api/errors';
import { useMe, useTutor, useTutorReviews, useTutorSlots } from '../api/hooks';
import type { PublicSlot } from '../api/types';
import { ROUTES } from '../auth/routes';
import SlotCalendar from '../components/SlotCalendar';
import { ErrorState, StatusPage } from '../components/States';
import { RatingBadge, TutorAvatar } from '../components/TutorCard';
import { formatVnd } from '../lib/format';
import { addDaysIso, formatDate, startOfWeekIso } from '../lib/time';

const REVIEW_STEP = 5;

export default function TutorDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const slotParam = searchParams.get('slot');
  const { data: me } = useMe();
  const tutor = useTutor(id);

  const currentWeek = useMemo(() => startOfWeekIso(), []);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const slots = useTutorSlots(id, weekStart, addDaysIso(weekStart, 7));
  const [reviewCount, setReviewCount] = useState(REVIEW_STEP);
  const reviews = useTutorReviews(id, 1, reviewCount);

  // After login via "?next=/gia-su/:id?slot=:slotId" a student continues straight to the booking page.
  useEffect(() => {
    if (slotParam && me?.role === 'STUDENT' && !me.mustChangePassword) {
      navigate(ROUTES.book(slotParam), { replace: true });
    }
  }, [slotParam, me, navigate]);

  if (tutor.isPending) return <Skeleton active avatar paragraph={{ rows: 4 }} />;
  if (tutor.isError) {
    if (tutor.error instanceof ApiError && (tutor.error.status === 404 || tutor.error.code === 'NOT_FOUND')) {
      return (
        <StatusPage
          status="404"
          extra={<Link to={ROUTES.tutors}><Button type="primary">{t('tutorDetail.back')}</Button></Link>}
        />
      );
    }
    return <ErrorState message={errorText(tutor.error)} onRetry={() => void tutor.refetch()} />;
  }

  const data = tutor.data;
  const onSelect: ((slot: PublicSlot) => void) | null =
    !me || me.role === 'STUDENT'
      ? (slot) => {
          if (me) navigate(ROUTES.book(slot.id));
          else {
            const next = encodeURIComponent(`${ROUTES.tutor(id)}?slot=${slot.id}`);
            navigate(`${ROUTES.login}?next=${next}`);
          }
        }
      : null;

  return (
    <>
      <Link to={ROUTES.tutors}>‹ {t('tutorDetail.back')}</Link>
      <Card style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <TutorAvatar tutor={data} size={96} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <Typography.Title level={2} style={{ marginTop: 0 }}>
              {data.fullName}
            </Typography.Title>
            <RatingBadge avg={data.ratingAvg} count={data.ratingCount} />
            <p style={{ marginBottom: 4 }}>
              <strong>{t('tutorDetail.subjects')}:</strong> {data.subjects.map((s) => s.name).join(', ')}
            </p>
            {data.experience ? (
              <p style={{ marginBottom: 4 }}>
                <strong>{t('tutorDetail.experience')}:</strong> {data.experience}
              </p>
            ) : null}
            <p style={{ marginBottom: 4 }}>
              <strong>{t('tutorDetail.price')}:</strong> {t('tutors.perSession', { price: formatVnd(data.pricePerSessionVnd) })}
            </p>
          </div>
        </div>
        {data.bio ? (
          <>
            <Divider />
            <Typography.Title level={5}>{t('tutorDetail.bio')}</Typography.Title>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{data.bio}</Typography.Paragraph>
          </>
        ) : null}
      </Card>

      <Card style={{ marginTop: 16 }}>
        {onSelect === null ? (
          <Alert type="info" showIcon message={t('tutorDetail.slotStaffNote')} style={{ marginBottom: 16 }} />
        ) : null}
        <SlotCalendar
          weekStart={weekStart}
          canGoPrev={weekStart > currentWeek}
          onPrev={() => setWeekStart((w) => addDaysIso(w, -7))}
          onNext={() => setWeekStart((w) => addDaysIso(w, 7))}
          slots={slots.data}
          isPending={slots.isPending}
          isError={slots.isError}
          onRetry={() => void slots.refetch()}
          onSelect={onSelect}
          highlightSlotId={slotParam}
        />
      </Card>

      <Card style={{ marginTop: 16 }} title={t('tutorDetail.reviews')}>
        {reviews.isPending ? (
          <Skeleton active />
        ) : reviews.isError ? (
          <ErrorState message={t('tutorDetail.reviewsError')} onRetry={() => void reviews.refetch()} />
        ) : reviews.data.items.length === 0 ? (
          <Typography.Text type="secondary">{t('tutorDetail.reviewsEmpty')}</Typography.Text>
        ) : (
          <>
            <List
              dataSource={reviews.data.items}
              renderItem={(review) => (
                <List.Item>
                  <div>
                    <Space>
                      <Rate disabled value={review.rating} style={{ fontSize: 14 }} />
                      <Typography.Text type="secondary">
                        {review.studentName ? `${review.studentName}, ` : ''}
                        {formatDate(review.createdAt)}
                      </Typography.Text>
                    </Space>
                    {review.comment ? <div style={{ whiteSpace: 'pre-wrap' }}>{review.comment}</div> : null}
                  </div>
                </List.Item>
              )}
            />
            {reviews.data.total > reviews.data.items.length ? (
              <Button onClick={() => setReviewCount((c) => c + REVIEW_STEP)}>{t('tutorDetail.reviewsMore')}</Button>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
