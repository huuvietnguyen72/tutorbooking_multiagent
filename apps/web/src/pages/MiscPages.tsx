import { Alert, Button, Result, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMe, useMyProfile } from '../api/hooks';
import { ROUTES } from '../auth/routes';
import { StatusPage } from '../components/States';

export function HomePage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <Typography.Title>{t('home.heading')}</Typography.Title>
      <Typography.Paragraph>{t('home.subheading')}</Typography.Paragraph>
      <Link to={ROUTES.tutors}>
        <Button type="primary" size="large">
          {t('home.cta')}
        </Button>
      </Link>
      {!me ? (
        <Link to={ROUTES.register} style={{ marginLeft: 12 }}>
          <Button size="large">{t('home.ctaRegister')}</Button>
        </Link>
      ) : null}
    </div>
  );
}

function HomeButton() {
  const { t } = useTranslation();
  return (
    <Link to={ROUTES.home}>
      <Button type="primary">{t('errorPage.home')}</Button>
    </Link>
  );
}

export const ForbiddenPage = () => <StatusPage status="403" extra={<HomeButton />} />;
export const NotFoundPage = () => <StatusPage status="404" extra={<HomeButton />} />;
export const ServerErrorPage = () => <StatusPage status="500" extra={<HomeButton />} />;

/** Screens owned by later tasks (T7–T9) so role landing routes already resolve. */
export function PlaceholderPage() {
  const { t } = useTranslation();
  return (
    <Result
      status="info"
      title={t('placeholder.title')}
      subTitle={t('placeholder.body')}
      extra={<Link to={ROUTES.home}><Button>{t('placeholder.home')}</Button></Link>}
    />
  );
}

/** S-16: the landing screen for tutors that are not (yet) approved. */
export function TutorGatePage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const status = me?.tutorApprovalStatus ?? 'PENDING_APPROVAL';
  const profile = useMyProfile();
  const reason = status === 'REJECTED' ? profile.data?.rejectionReason : null;
  const type = status === 'APPROVED' ? 'success' : status === 'PENDING_APPROVAL' ? 'info' : status === 'REJECTED' ? 'error' : 'warning';
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <Typography.Title level={3}>{t('tutorGate.title')}</Typography.Title>
      <Alert
        type={type}
        showIcon
        message={t(`tutorGate.${status}`)}
        description={
          <>
            {reason ? <p>{t('tutorGate.reasonLabel')} “{reason}”</p> : null}
            {status === 'PENDING_APPROVAL' ? <p>{t('tutorGate.pendingHint')}</p> : null}
            {status === 'SUSPENDED' ? <p>{t('tutorGate.suspendedHint')}</p> : null}
          </>
        }
      />
      <Space style={{ marginTop: 16 }}>
        {status === 'SUSPENDED' ? (
          <Link to={ROUTES.tutorSessions}><Button type="primary">{t('tutorGate.viewSessions')}</Button></Link>
        ) : (
          <Link to={ROUTES.tutorProfile}>
            <Button type="primary">{status === 'REJECTED' ? t('tutorGate.editResubmit') : t('tutorGate.editProfile')}</Button>
          </Link>
        )}
      </Space>
    </div>
  );
}
