import { Button, DatePicker, Form, InputNumber, Select, Space } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSubjects } from '../api/hooks';
import type { TutorSearchParams } from '../api/types';
import { fromApiDate, toApiDate } from '../lib/time';

type Filters = Pick<TutorSearchParams, 'subjectId' | 'minPrice' | 'maxPrice' | 'minRating' | 'availableDate' | 'q'>;

interface Props {
  value: Filters;
  onApply: (next: Filters) => void;
  onClear: () => void;
}

export default function TutorFilters({ value, onApply, onClear }: Props) {
  const { t } = useTranslation();
  const { data: subjects } = useSubjects();
  const [draft, setDraft] = useState<Filters>(value);
  const priceInvalid =
    draft.minPrice !== undefined && draft.maxPrice !== undefined && draft.minPrice > draft.maxPrice;
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Form
      layout="vertical"
      onFinish={() => {
        if (!priceInvalid) onApply(draft);
      }}
    >
      <Form.Item label={t('tutors.subject')} htmlFor="filter-subject">
        <Select
          id="filter-subject"
          allowClear
          placeholder={t('tutors.subjectAll')}
          value={draft.subjectId}
          onChange={(v: number | undefined) => set({ subjectId: v })}
          options={(subjects ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
      </Form.Item>
      <Form.Item
        label={t('tutors.tuitionPerSession')}
        validateStatus={priceInvalid ? 'error' : undefined}
        help={priceInvalid ? t('tutors.priceRangeInvalid') : undefined}
      >
        <Space.Compact block>
          <InputNumber
            min={0}
            step={50000}
            style={{ width: '50%' }}
            placeholder={t('tutors.minPrice')}
            aria-label={t('tutors.minPrice')}
            value={draft.minPrice}
            onChange={(v) => set({ minPrice: v ?? undefined })}
          />
          <InputNumber
            min={0}
            step={50000}
            style={{ width: '50%' }}
            placeholder={t('tutors.maxPrice')}
            aria-label={t('tutors.maxPrice')}
            value={draft.maxPrice}
            onChange={(v) => set({ maxPrice: v ?? undefined })}
          />
        </Space.Compact>
      </Form.Item>
      <Form.Item label={t('tutors.minRating')} htmlFor="filter-rating">
        <Select
          id="filter-rating"
          allowClear
          placeholder={t('tutors.ratingAny')}
          value={draft.minRating}
          onChange={(v: number | undefined) => set({ minRating: v })}
          options={[4.5, 4, 3].map((v) => ({ value: v, label: t('tutors.ratingAtLeast', { value: v }) }))}
        />
      </Form.Item>
      <Form.Item label={t('tutors.availableDate')} htmlFor="filter-date">
        <DatePicker
          id="filter-date"
          style={{ width: '100%' }}
          format="DD/MM/YYYY"
          value={draft.availableDate ? fromApiDate(draft.availableDate) : null}
          onChange={(d) => set({ availableDate: d ? toApiDate(d) : undefined })}
        />
      </Form.Item>
      <Space>
        <Button type="primary" htmlType="submit">
          {t('tutors.apply')}
        </Button>
        <Button
          onClick={() => {
            setDraft({});
            onClear();
          }}
        >
          {t('tutors.clear')}
        </Button>
      </Space>
    </Form>
  );
}
