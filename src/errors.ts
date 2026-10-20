export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 413 | 415 | 429 | 500 | 502,
    message: string,
  ) {
    super(message);
  }
}
