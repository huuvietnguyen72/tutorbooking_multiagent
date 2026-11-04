import { Form, Input } from 'antd';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

interface TextFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  extra?: string;
  serverError?: string;
}

/** antd Form.Item bound to react-hook-form. Error messages are i18n keys (set by the zod schema) or server field codes. */
export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  type = 'text',
  autoComplete,
  extra,
  serverError,
}: TextFieldProps<T>) {
  const { t, i18n } = useTranslation();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const message = serverError ?? fieldState.error?.message;
        const text = message ? (i18n.exists(message) ? t(message) : message) : undefined;
        const id = `field-${name}`;
        const InputComponent = type === 'password' ? Input.Password : Input;
        return (
          <Form.Item
            label={label}
            htmlFor={id}
            validateStatus={text ? 'error' : undefined}
            help={text}
            extra={text ? undefined : extra}
          >
            <InputComponent
              {...field}
              id={id}
              type={type === 'password' ? undefined : type}
              autoComplete={autoComplete}
              aria-invalid={text ? true : undefined}
            />
          </Form.Item>
        );
      }}
    />
  );
}
