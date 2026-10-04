export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details: any;

  constructor(
    statusCode: number,
    message: string = 'Something went wrong',
    code: string = 'INTERNAL_ERROR',
    details: any = null,
    stack: string = ''
  ) {
    super(message);

    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}