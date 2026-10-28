/** Business-rule failure translated into a structured HTTP response by the app. */
export class ServiceError extends Error {
  /**
   * Creates a client-visible business error.
   *
   * @param status - HTTP response status.
   * @param code - Machine-readable error code, also used as the error message.
   * @param details - Client-visible string fields merged into the response body.
   */
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, string>,
  ) {
    super(code);
    this.name = 'ServiceError';
  }
}
