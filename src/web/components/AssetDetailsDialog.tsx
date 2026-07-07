import React, { useEffect } from 'react';
import type { AssetCostDetails, AssetDetailsContextImage, AssetDetailsResponse } from '../../contracts';

interface AssetDetailsDialogProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  details: AssetDetailsResponse | null;
  onClose: () => void;
}

function isAssetContextImage(value: unknown): value is AssetDetailsContextImage {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === 'asset' &&
    typeof (value as Record<string, unknown>).project === 'string' &&
    typeof (value as Record<string, unknown>).assetId === 'string'
  );
}

function formatDimension(width?: number | null, height?: number | null): string {
  return typeof width === 'number' && typeof height === 'number' ? `${width} × ${height}` : 'not recorded';
}

function formatProviderModel(provider?: string | null, model?: string | null): string {
  return [provider, model].filter(Boolean).join(' / ') || 'not recorded';
}

function formatCost(cost?: AssetCostDetails | null): string {
  if (!cost || typeof cost.amount !== 'number' || !cost.currency) return 'not recorded';
  const tinyPositive = cost.amount > 0 && cost.amount < 0.01;
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cost.currency,
    minimumFractionDigits: tinyPositive ? 3 : 2,
    maximumFractionDigits: tinyPositive ? 6 : 2
  }).format(cost.amount);
  return `${amount}${cost.estimated ? ' estimated' : ''}`;
}

function formatPricingSource(cost?: AssetCostDetails | null): string {
  return [cost?.pricingSource, cost?.pricingVersion].filter(Boolean).join(' / ') || 'not recorded';
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return 'not recorded';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AssetDetailsDialog({ open, loading, error, details, onClose }: AssetDetailsDialogProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const generation = details?.generation ?? null;
  const asset = details?.asset ?? null;
  const cost = details?.cost ?? null;
  const contextImages = generation?.contextImages ?? [];

  return (
    <div className="asset-details-backdrop" role="presentation" onClick={onClose}>
      <section
        className="asset-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="asset-details-header">
          <div>
            <h2 id="asset-details-title">Asset details</h2>
            {asset?.filename && <p>{asset.filename}</p>}
          </div>
          <button type="button" className="asset-details-close" aria-label="Close asset details" onClick={onClose}>×</button>
        </header>

        {loading && <p className="asset-details-muted">Loading asset details…</p>}
        {error && <p className="asset-details-error">{error}</p>}

        {!loading && !error && details && (
          <div className="asset-details-content">
            <dl className="asset-details-grid">
              <dt>Asset ID</dt>
              <dd>{asset?.assetId ?? 'not recorded'}</dd>
              <dt>Project</dt>
              <dd>{asset?.project ?? 'not recorded'}</dd>
              <dt>Provider / model</dt>
              <dd>{formatProviderModel(generation?.provider, generation?.model)}</dd>
              <dt>Quality</dt>
              <dd>{generation?.quality ?? 'not recorded'}</dd>
              <dt>Cost</dt>
              <dd>{formatCost(cost)}</dd>
              <dt>Dimensions</dt>
              <dd>{formatDimension(generation?.width ?? asset?.width, generation?.height ?? asset?.height)}</dd>
              <dt>Generated at</dt>
              <dd>{generation?.generatedAt ?? asset?.createdAt ?? 'not recorded'}</dd>
            </dl>

            {details.warnings?.length ? (
              <div className="asset-details-warning">{details.warnings.join(', ')}</div>
            ) : null}

            <section>
              <h3>Prompt</h3>
              <pre className="asset-details-pre">{generation?.prompt ?? 'not recorded'}</pre>
            </section>

            {generation?.jsonPrompt !== undefined && generation.jsonPrompt !== null && (
              <section>
                <h3>Structured prompt</h3>
                <pre className="asset-details-pre">{formatJson(generation.jsonPrompt)}</pre>
              </section>
            )}

            <section>
              <h3>Context images</h3>
              {contextImages.length ? (
                <div className="asset-details-context-list">
                  {contextImages.map((item, index) => {
                    if (isAssetContextImage(item)) {
                      return (
                        <figure className="asset-details-context" key={`${item.project}:${item.assetId}:${index}`}>
                          {item.resolvedUrl && <img src={item.resolvedUrl} alt={`Context asset ${item.assetId}`} />}
                          <figcaption>
                            <strong>{item.project}</strong>
                            <span>{item.assetId}</span>
                          </figcaption>
                        </figure>
                      );
                    }
                    return <pre className="asset-details-context-text" key={index}>{formatJson(item)}</pre>;
                  })}
                </div>
              ) : (
                <p className="asset-details-muted">No context images recorded.</p>
              )}
            </section>

            <details>
              <summary>Advanced</summary>
              <dl className="asset-details-grid">
                <dt>Request ID</dt>
                <dd>{generation?.requestId ?? 'not recorded'}</dd>
                <dt>Image index</dt>
                <dd>{generation?.imageIndex ?? 'not recorded'}</dd>
                <dt>Content type</dt>
                <dd>{asset?.contentType ?? 'not recorded'}</dd>
                <dt>Pricing source</dt>
                <dd>{formatPricingSource(cost)}</dd>
              </dl>
              {generation?.providerRequest && <pre className="asset-details-pre">{formatJson(generation.providerRequest)}</pre>}
            </details>
          </div>
        )}
      </section>
    </div>
  );
}
