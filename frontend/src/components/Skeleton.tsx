import React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '1rem',
  borderRadius = 'var(--radius-sm)',
  className = '',
  style,
  ...rest
}) => {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
        ...style,
      }}
      {...rest}
    />
  );
};

export const SkeletonText: React.FC<{
  lines?: number;
  gap?: string;
  lastLineWidth?: string;
  height?: string;
}> = ({ lines = 2, gap = '0.5rem', lastLineWidth = '70%', height = '0.875rem' }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, width: '100%' }}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          height={height}
          width={index === lines - 1 && lines > 1 ? lastLineWidth : '100%'}
        />
      ))}
    </div>
  );
};

export const SkeletonCard: React.FC<{ height?: string; padding?: string }> = ({
  height = '140px',
  padding = '1.5rem',
}) => {
  return (
    <div
      className="card skeleton-card"
      style={{
        padding,
        minHeight: height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width="40%" height="1.125rem" />
        <Skeleton width="32px" height="32px" borderRadius="var(--radius-md)" />
      </div>
      <Skeleton width="65%" height="2rem" />
      <Skeleton width="80%" height="0.875rem" />
    </div>
  );
};

export const SkeletonWalletCard: React.FC = () => {
  return (
    <div
      className="card"
      style={{
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-xl)',
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Skeleton width="42px" height="42px" borderRadius="var(--radius-md)" />
          <div>
            <Skeleton width="120px" height="0.875rem" style={{ marginBottom: '0.35rem' }} />
            <Skeleton width="180px" height="1.25rem" />
          </div>
        </div>
        <Skeleton width="80px" height="24px" borderRadius="100px" />
      </div>

      <div style={{ margin: '0.5rem 0' }}>
        <Skeleton width="90px" height="0.75rem" style={{ marginBottom: '0.5rem' }} />
        <Skeleton width="220px" height="3rem" borderRadius="var(--radius-md)" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '1rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <Skeleton width="70px" height="0.75rem" style={{ marginBottom: '0.35rem' }} />
          <Skeleton width="100px" height="1rem" />
        </div>
        <div>
          <Skeleton width="70px" height="0.75rem" style={{ marginBottom: '0.35rem' }} />
          <Skeleton width="100px" height="1rem" />
        </div>
        <div>
          <Skeleton width="70px" height="0.75rem" style={{ marginBottom: '0.35rem' }} />
          <Skeleton width="100px" height="1rem" />
        </div>
      </div>
    </div>
  );
};

export const SkeletonTableRows: React.FC<{
  rows?: number;
  cols?: number;
}> = ({ rows = 5, cols = 5 }) => {
  return (
    <>
      {Array.from({ length: rows }).map((_, rIdx) => (
        <tr key={`skel-row-${rIdx}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {Array.from({ length: cols }).map((_, cIdx) => (
            <td key={`skel-col-${cIdx}`} style={{ padding: '1rem' }}>
              <Skeleton
                width={cIdx === 0 ? '70%' : cIdx === cols - 1 ? '50%' : '85%'}
                height="1rem"
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
};

export const SkeletonCounterparties: React.FC<{ count?: number }> = ({ count = 4 }) => {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', overflowX: 'auto', padding: '0.5rem 0' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={`skel-cp-${i}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 0.85rem',
            borderRadius: '100px',
            border: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-card)',
            minWidth: '130px',
          }}
        >
          <Skeleton width="28px" height="28px" borderRadius="50%" />
          <div style={{ flex: 1 }}>
            <Skeleton width="70px" height="0.75rem" />
          </div>
        </div>
      ))}
    </div>
  );
};
