import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'accent' | 'success' | 'danger' | 'ghost' | 'danger-ghost';

const classes: Record<Variant, string> = {
  primary: 'btn-primary',
  accent: 'btn-accent',
  success: 'btn-success',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
  'danger-ghost': 'btn-danger-ghost',
};

export default function Button({
  variant = 'primary',
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn ${classes[variant]} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && (
        <span
          className="inline-block animate-spin rounded-full border-2 border-white/40 border-t-white"
          style={{ width: 14, height: 14 }}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}
