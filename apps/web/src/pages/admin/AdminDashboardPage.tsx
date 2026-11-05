import { Card, Col, Row, Statistic, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAdminStats } from '../../api/hooks';
import { ROUTES } from '../../auth/routes';
import { ErrorState } from '../../components/States';
import { todayKey } from '../../lib/time';

/** S-24: counters that link to the screen where the admin acts on them. */
export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const query = useAdminStats();
  const today = todayKey();

  const cards = query.data
    ? [
        { key: 'pendingTutors', value: query.data.pendingTutors, to: `${ROUTES.adminTutors}` },
        { key: 'bookingsToday', value: query.data.bookingsToday, to: `${ROUTES.adminBookings}?status=CONFIRMED&from=${today}&to=${today}` },
        { key: 'confirmedUpcoming', value: query.data.confirmedUpcoming, to: `${ROUTES.adminBookings}?status=CONFIRMED&upcoming=true` },
        { key: 'refundsFailed', value: query.data.refundsFailed, to: `${ROUTES.adminBookings}?refundFailed=true` },
      ]
    : [];

  return (
    <Card>
      <Typography.Title level={3}>{t('admin.dashboard.title')}</Typography.Title>
      {query.isError ? (
        <ErrorState message={t('admin.dashboard.loadError')} onRetry={() => void query.refetch()} />
      ) : (
        <Row gutter={[16, 16]}>
          {(query.isPending ? [] : cards).map((c) => (
            <Col key={c.key} xs={24} sm={12} lg={6}>
              <Card size="small">
                <Statistic
                  title={t(`admin.dashboard.${c.key}`)}
                  value={c.value}
                  valueStyle={c.key === 'refundsFailed' && c.value > 0 ? { color: '#cf1322' } : undefined}
                />
                <Link to={c.to}>{t('admin.dashboard.view')}</Link>
              </Card>
            </Col>
          ))}
          {query.isPending ? <Col span={24}><Card loading /></Col> : null}
        </Row>
      )}
      <Typography.Paragraph style={{ marginTop: 24 }}>
        <Link to={ROUTES.adminAudit}>{t('admin.dashboard.auditLink')}</Link>
      </Typography.Paragraph>
    </Card>
  );
}
