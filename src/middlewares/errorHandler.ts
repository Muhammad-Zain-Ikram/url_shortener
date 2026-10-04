import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred.';
  let details = null;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err.name === 'ZodError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid input data.';
    details = err.issues;
  } else {
    // Log unexpected errors in production/dev
    console.error('Unhandled Error:', err);
    if (process.env.NODE_ENV === 'development') {
      message = err.message;
      details = err.stack;
    }
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
    },
  });
};
