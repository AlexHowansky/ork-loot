/** An expected failure whose message is safe and friendly to show users. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "That page") =>
  new AppError(404, `${what} couldn't be found. It may have been deleted.`);

export const forbidden = () =>
  new AppError(403, "You don't have permission to do that.");

export const unauthorized = () =>
  new AppError(401, "Please sign in to continue.");

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, message, fields);

export const conflict = (message: string) => new AppError(409, message);
