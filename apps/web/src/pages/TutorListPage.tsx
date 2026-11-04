import { FilterOutlined } from '@ant-design/icons';
import { Button, Card, Col, Drawer, Grid, Input, Pagination, Row, Select, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { errorText } from '../api/errors';
import { useTutors } from '../api/hooks';
import type { TutorSearchParams, TutorSort } from '../api/types';
import { CardSkeletons, EmptyState, ErrorState } from '../components/States';
import TutorCard from '../components/TutorCard';
import TutorFilters from '../components/TutorFilters';

const PAGE_SIZE = 10;
const SORTS: TutorSort[] = ['rating_desc', 'price_asc', 'price_desc'];

function num(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parse(params: URLSearchParams): TutorSearchParams {
  const sort = params.get('sort');
  const date = params.get('availableDate');
  return {
    subjectId: num(params.get('subjectId')),
    minPrice: num(params.get('minPrice')),
    maxPrice: num(params.get('maxPrice')),
    minRating: num(params.get('minRating')),
    availableDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    q: params.get('q')?.slice(0, 100) || undefined,
    sort: SORTS.includes(sort as TutorSort) ? (sort as TutorSort) : 'rating_desc',
    page: Math.max(1, num(params.get('page')) ?? 1),
    pageSize: PAGE_SIZE,
  };
}

function toSearch(p: TutorSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === '' || k === 'pageSize') continue;
    if (k === 'sort' && v === 'rating_desc') continue;
    if (k === 'page' && v === 1) continue;
    out[k] = String(v);
  }
  return out;
}

export default function TutorListPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => parse(searchParams), [searchParams]);
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useTutors(params);
  const screens = Grid.useBreakpoint();
  const isDesktop = screens.md ?? true;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const update = (patch: Partial<TutorSearchParams>) =>
    setSearchParams(toSearch({ ...params, page: 1, ...patch }));
  const filterValue = {
    subjectId: params.subjectId,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    minRating: params.minRating,
    availableDate: params.availableDate,
    q: params.q,
  };
  const hasFilters = Object.values(filterValue).some((v) => v !== undefined);
  // Remount the draft state whenever the applied filters change (e.g. "clear filters" in the empty state).
  const filterKey = JSON.stringify(filterValue);
  const filters = (
    <TutorFilters
      key={filterKey}
      value={filterValue}
      onApply={(next) => {
        update(next);
        setDrawerOpen(false);
      }}
      onClear={() => {
        setSearchParams({});
        setDrawerOpen(false);
      }}
    />
  );

  let body;
  if (isPending) body = <CardSkeletons />;
  else if (isError) body = <ErrorState message={`${t('tutors.loadError')} ${errorText(error)}`} onRetry={() => void refetch()} />;
  else if (data.items.length === 0)
    body = (
      <EmptyState
        title={t('tutors.empty')}
        hint={t('tutors.emptyHint')}
        action={hasFilters ? <Button onClick={() => setSearchParams({})}>{t('tutors.clearFilters')}</Button> : undefined}
      />
    );
  else
    body = (
      <div style={{ opacity: isPlaceholderData ? 0.6 : 1 }}>
        {data.items.map((tutor) => (
          <TutorCard key={tutor.id} tutor={tutor} />
        ))}
        <Pagination
          current={data.page}
          pageSize={data.pageSize}
          total={data.total}
          showSizeChanger={false}
          hideOnSinglePage
          onChange={(page) => setSearchParams(toSearch({ ...params, page }))}
        />
      </div>
    );

  return (
    <>
      <Typography.Title level={2}>{t('tutors.title')}</Typography.Title>
      <Row gutter={24}>
        {isDesktop ? (
          <Col md={8} lg={7}>
            <Card title={t('tutors.filters')}>{filters}</Card>
          </Col>
        ) : null}
        <Col xs={24} md={16} lg={17}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <Input.Search
              allowClear
              aria-label={t('tutors.search')}
              placeholder={t('tutors.searchPlaceholder')}
              maxLength={100}
              defaultValue={params.q}
              onSearch={(q) => update({ q: q.trim() || undefined })}
              style={{ flex: 1, minWidth: 180 }}
            />
            {!isDesktop ? (
              <Button icon={<FilterOutlined />} onClick={() => setDrawerOpen(true)}>
                {t('tutors.filters')}
              </Button>
            ) : null}
            <label>
              {t('tutors.sort')}:{' '}
              <Select
                value={params.sort}
                onChange={(sort: TutorSort) => update({ sort })}
                style={{ minWidth: 170 }}
                options={[
                  { value: 'rating_desc', label: t('tutors.sortRatingDesc') },
                  { value: 'price_asc', label: t('tutors.sortPriceAsc') },
                  { value: 'price_desc', label: t('tutors.sortPriceDesc') },
                ]}
              />
            </label>
          </div>
          {data ? <p aria-live="polite">{t('tutors.count', { count: data.total })}</p> : null}
          {body}
        </Col>
      </Row>
      <Drawer title={t('tutors.filters')} open={drawerOpen && !isDesktop} onClose={() => setDrawerOpen(false)}>
        {filters}
      </Drawer>
    </>
  );
}
