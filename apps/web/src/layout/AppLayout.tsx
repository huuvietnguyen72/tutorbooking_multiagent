import { DownOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Button, Dropdown, Layout, Menu, Space, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../api/hooks';
import type { Me } from '../api/types';
import { ROUTES } from '../auth/routes';
import { ForcePasswordGate } from '../auth/guards';
import { initialOf } from '../lib/format';

interface NavItem {
  key: string;
  labelKey: string;
  /** i18n key of the tooltip explaining why the item is disabled */
  disabledHintKey?: string;
}

/** Header menu per role (design §2.5). */
function navFor(me: Me | null | undefined): NavItem[] {
  if (!me) return [{ key: ROUTES.tutors, labelKey: 'nav.findTutor' }];
  switch (me.role) {
    case 'TUTOR':
      return [
        { key: ROUTES.tutorProfile, labelKey: 'nav.tutorProfile' },
        me.tutorApprovalStatus === 'APPROVED'
          ? { key: ROUTES.tutorSlots, labelKey: 'nav.tutorSlots' }
          : { key: ROUTES.tutorSlots, labelKey: 'nav.tutorSlots', disabledHintKey: 'nav.needApproval' },
        ...(me.tutorApprovalStatus === 'APPROVED' || me.tutorApprovalStatus === 'SUSPENDED'
          ? [
              { key: ROUTES.tutorSessions, labelKey: 'nav.tutorSessions' },
              { key: ROUTES.tutorReviews, labelKey: 'nav.tutorReviews' },
            ]
          : [
              { key: ROUTES.tutorSessions, labelKey: 'nav.tutorSessions', disabledHintKey: 'nav.needApproval' },
              { key: ROUTES.tutorReviews, labelKey: 'nav.tutorReviews', disabledHintKey: 'nav.needApproval' },
            ]),
      ];
    case 'ADMIN':
      return [
        { key: ROUTES.admin, labelKey: 'nav.adminOverview' },
        { key: ROUTES.adminTutors, labelKey: 'nav.adminTutors' },
        { key: ROUTES.adminUsers, labelKey: 'nav.adminUsers' },
        { key: ROUTES.adminBookings, labelKey: 'nav.adminBookings' },
      ];
    default:
      return [
        { key: ROUTES.tutors, labelKey: 'nav.findTutor' },
        { key: ROUTES.myBookings, labelKey: 'nav.myBookings' },
      ];
  }
}

function selectedKey(items: NavItem[], pathname: string): string[] {
  const match = items
    .filter((i) => pathname === i.key || (i.key !== ROUTES.admin && pathname.startsWith(`${i.key}/`)))
    .sort((a, b) => b.key.length - a.key.length)[0];
  return match ? [match.key] : [];
}

export default function AppLayout() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = me?.mustChangePassword ? [] : navFor(me);

  const userMenu = {
    items: [
      ...(me?.mustChangePassword ? [] : [{ key: 'account', label: t('nav.account') }]),
      { key: 'logout', label: t('nav.logout') },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'account') navigate(ROUTES.account);
      if (key === 'logout') logout.mutate(undefined, { onSettled: () => navigate(ROUTES.home) });
    },
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 16, paddingInline: 16 }}>
        <Link to={ROUTES.home} style={{ color: '#fff', fontWeight: 600, fontSize: 18, whiteSpace: 'nowrap' }}>
          ◉ {t('app.brand')}
        </Link>
        <Menu
          theme="dark"
          mode="horizontal"
          aria-label={t('nav.mainMenu')}
          selectedKeys={selectedKey(items, pathname)}
          items={items.map((i) => ({
            key: i.key,
            disabled: !!i.disabledHintKey,
            label: i.disabledHintKey ? (
              <Tooltip title={t(i.disabledHintKey)}>
                <span>{t(i.labelKey)}</span>
              </Tooltip>
            ) : (
              <Link to={i.key}>{t(i.labelKey)}</Link>
            ),
          }))}
          style={{ flex: 1, minWidth: 0 }}
        />
        {me ? (
          <Dropdown menu={userMenu} trigger={['click']}>
            <Button type="text" style={{ color: '#fff' }} aria-label={me.fullName}>
              <Space>
                <Avatar size="small" icon={<UserOutlined />}>
                  {initialOf(me.fullName)}
                </Avatar>
                <span className="hide-on-mobile">{me.fullName}</span>
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
        ) : (
          <Space>
            <Link to={ROUTES.login}>
              <Button ghost>{t('nav.login')}</Button>
            </Link>
            <Link to={ROUTES.register}>
              <Button type="primary">{t('nav.register')}</Button>
            </Link>
          </Space>
        )}
      </Layout.Header>
      <Layout.Content style={{ padding: 16, maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        <ForcePasswordGate />
      </Layout.Content>
    </Layout>
  );
}
