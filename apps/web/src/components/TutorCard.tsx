import { Avatar, Button, Card, Rate, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { TutorSummary } from '../api/types';
import { ROUTES } from '../auth/routes';
import { formatRating, formatVnd, initialOf } from '../lib/format';
import { formatDateTime } from '../lib/time';

export function RatingBadge({ avg, count }: { avg: number; count: number }) {
  const { t } = useTranslation();
  if (count === 0) return <Typography.Text type="secondary">{t('tutors.noRating')}</Typography.Text>;
  return (
    <Space size={4} aria-label={`${formatRating(avg)} / 5`}>
      <Rate disabled allowHalf value={avg} style={{ fontSize: 14 }} />
      <strong>{formatRating(avg)}</strong>
      <Typography.Text type="secondary">{t('tutors.ratingCount', { count })}</Typography.Text>
    </Space>
  );
}

export function TutorAvatar({ tutor, size }: { tutor: TutorSummary; size: number }) {
  const { t } = useTranslation();
  return (
    <Avatar size={size} src={tutor.avatarUrl ?? undefined} alt={t('tutors.avatarAlt', { name: tutor.fullName })}>
      {initialOf(tutor.fullName)}
    </Avatar>
  );
}

export default function TutorCard({ tutor }: { tutor: TutorSummary }) {
  const { t } = useTranslation();
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <TutorAvatar tutor={tutor} size={72} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {tutor.fullName}
          </Typography.Title>
          <RatingBadge avg={tutor.ratingAvg} count={tutor.ratingCount} />
          <div>{tutor.subjects.map((s) => s.name).join(', ')}</div>
          <div>
            <strong>{t('tutors.perSession', { price: formatVnd(tutor.pricePerSessionVnd) })}</strong>
          </div>
          <div>
            <Typography.Text type="secondary">
              {tutor.nextAvailableAt
                ? t('tutors.nextAvailable', { time: formatDateTime(tutor.nextAvailableAt) })
                : t('tutors.noAvailable')}
            </Typography.Text>
          </div>
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <Link to={ROUTES.tutor(tutor.id)}>
            <Button type="primary">{t('tutors.viewProfile')}</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
