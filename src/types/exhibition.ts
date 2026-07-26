/**
 * Exhibition website type definitions for site building, publishing,
 * rebuild queue, cache invalidation, and usage monitoring.
 */

/** Configuration for the Eleventy-based static site builder. */
export interface SiteBuilderConfig {
  /** Output directory for generated static files. */
  outputDir: string;
  /** Directory containing Eleventy templates. */
  templateDir: string;
  /** Maximum pixel dimension for the longest side of processed images. */
  imageMaxSize: number;
  /** WebP quality percentage (0-100). */
  imageQuality: number;
  /** Maximum number of products to include in a build. */
  maxProducts: number;
  /** Maximum time allowed for a build in milliseconds. */
  buildTimeoutMs: number;
}

/** Result of a site build operation. */
export interface BuildResult {
  /** Whether the build completed successfully. */
  success: boolean;
  /** Number of HTML pages generated. */
  pagesGenerated: number;
  /** Number of images processed (resized/converted to WebP). */
  imagesProcessed: number;
  /** Size of the minified CSS output in bytes. */
  cssSize: number;
  /** Total build duration in milliseconds. */
  buildDurationMs: number;
  /** File paths that changed compared to the previous build. */
  changedPaths: string[];
  /** Errors encountered during the build (present on failure). */
  errors?: BuildError[];
}

/** An error that occurred during site building. */
export interface BuildError {
  /** Category of the build error. */
  type: 'data_fetch' | 'template_render' | 'image_process' | 'output_write';
  /** Human-readable error description. */
  message: string;
  /** ID of the product that caused the error, if applicable. */
  productId?: string;
}

/** Action to publish or unpublish a product on the exhibition site. */
export interface PublishAction {
  /** ID of the product being published/unpublished. */
  productId: string;
  /** ID of the approved mockup associated with the product. */
  mockupId: string;
  /** Whether to publish or unpublish the product. */
  action: 'publish' | 'unpublish';
  /** Cognito sub of the Admin performing the action. */
  adminId: string;
}

/** Result of a publish/unpublish action. */
export interface PublishResult {
  /** Whether the action was successful. */
  success: boolean;
  /** Whether a site rebuild was queued as a result. */
  rebuildQueued: boolean;
  /** Position in the rebuild queue, if queued. */
  queuePosition?: number;
  /** Error message if the action failed. */
  error?: string;
}

/** A request to rebuild the exhibition site. */
export interface RebuildRequest {
  /** Unique identifier for this rebuild request. */
  rebuildId: string;
  /** Admin ID (Cognito sub) that triggered the rebuild. */
  triggeredBy: string;
  /** Timestamp when the rebuild was triggered (ISO 8601). */
  triggeredAt: string;
  /** Reason for the rebuild. */
  reason: 'publish' | 'unpublish' | 'manual';
}

/** Configuration for the rebuild queue. */
export interface RebuildQueueConfig {
  /** Maximum number of pending rebuilds allowed in the queue. */
  maxQueueDepth: number;
  /** Debounce window in milliseconds — rebuilds within this window are coalesced. */
  debounceWindowMs: number;
  /** Delay before retrying a failed rebuild in milliseconds. */
  retryDelayMs: number;
  /** Maximum number of retry attempts for a failed rebuild. */
  maxRetries: number;
}

/** Current status of a rebuild request. */
export interface RebuildStatus {
  /** Unique identifier for the rebuild. */
  rebuildId: string;
  /** Current state of the rebuild. */
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  /** Timestamp when the rebuild started processing (ISO 8601). */
  startedAt?: string;
  /** Timestamp when the rebuild completed (ISO 8601). */
  completedAt?: string;
  /** Error message if the rebuild failed. */
  error?: string;
  /** Number of retry attempts made. */
  retryCount: number;
}

/** Request to invalidate CloudFront cache paths after a rebuild. */
export interface InvalidationRequest {
  /** File paths that changed during the rebuild. */
  changedPaths: string[];
  /** CloudFront distribution ID to invalidate. */
  distributionId: string;
}

/** Result of a CloudFront cache invalidation. */
export interface InvalidationResult {
  /** Whether the invalidation was successful. */
  success: boolean;
  /** CloudFront invalidation ID, if created. */
  invalidationId?: string;
  /** Strategy used: 'individual' for ≤15 paths, 'wildcard' for >15. */
  strategy: 'individual' | 'wildcard';
  /** Number of retry attempts made. */
  retriesAttempted: number;
  /** Error message if the invalidation failed. */
  error?: string;
}

/** Result of a usage check for a single AWS service. */
export interface UsageCheck {
  /** AWS service name being monitored. */
  service: string;
  /** Current usage value for the billing period. */
  currentUsage: number;
  /** Free Tier monthly limit for this service/metric. */
  freeLimit: number;
  /** Percentage of the Free Tier limit currently used. */
  percentUsed: number;
}

/** Configuration for the Free Tier usage monitoring system. */
export interface MonitorConfig {
  /** Interval between usage checks in minutes. */
  checkIntervalMinutes: number;
  /** Percentage threshold that triggers an alert email (e.g., 80). */
  alertThresholdPercent: number;
  /** Percentage threshold that disables the Quote_API (e.g., 100). */
  disableThresholdPercent: number;
  /** List of services and their Free Tier limits to monitor. */
  services: ServiceLimit[];
}

/** Definition of a Free Tier limit for a specific service metric. */
export interface ServiceLimit {
  /** AWS service name. */
  service: string;
  /** Metric being tracked (e.g., 'requests', 'storage_gb'). */
  metric: string;
  /** Monthly Free Tier limit for this metric. */
  monthlyLimit: number;
}
