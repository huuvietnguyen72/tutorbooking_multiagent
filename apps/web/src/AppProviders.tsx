import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import './i18n';

dayjs.locale('vi');

export default function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <ConfigProvider locale={viVN}>
      <AntApp>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
