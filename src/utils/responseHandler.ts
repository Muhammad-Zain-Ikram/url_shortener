import { Response } from 'express';

export interface ApiResponsePayload<T = unknown> {
  success: boolean;
  message: string;
  data: T;
}

export const sendSuccess = <T = unknown>(
  res: Response,
  message: string,
  data: T = {} as T,
  statusCode: number = 200
): void => {
  const payload: ApiResponsePayload<T> = {
    success: true,
    message,
    data,
  };

  res.status(statusCode).json(payload);
};

export const sendCreated = <T = unknown>(
  res: Response,
  message: string,
  data: T = {} as T
): void => {
  sendSuccess<T>(res, message, data, 201);
};