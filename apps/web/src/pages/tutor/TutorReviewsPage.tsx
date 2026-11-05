import { Card, List, Rate, Space, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMyProfile, useMyReviews } from '../../api/hooks';
import { EmptyState, ErrorState } from '../../components/States';
import { formatRating } from '../../lib/format';
import { formatDate } from '../../lib/time';

const PAGE_SIZE = 10;

/** S-23: reviews the tutor received (hidden ones are already filtered by the API). */
export default function TutorReviewsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useMyReviews(page, PAGE_SIZE);
  const profile = useMyProfile();

  return (
    <Card>
      <Typography.Title level={3}>{t('tutorReviews.title')}</Typography.Title>
      {profile.data && profile.data.ratingCount > 0 ? (
        <Typography.Title level={2} style={{ marginTop: 0 }}>
          ★ {formatRating(profile.data.ratingAvg)}{' '}
          <Typography.Text type="secondary" style={{ fontSize: 16 }}>{t('tutorReviews.count', { count: profile.data.ratingCount })}</Typography.Text>
        </Typography.Title>
      ) : null}
      {query.isPending ? (
        <List loading dataSource={[]} />
      ) : query.isError ? (
        <ErrorState message={t('tutorReviews.loadError')} onRetry={() => void query.refetch()} />
      ) : query.data.total === 0 ? (
        <EmptyState title={t('tutorReviews.empty')} />
      ) : (
        <List
          dataSource={query.data.items}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data.total, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
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
      )}
    </Card>
  );
}
