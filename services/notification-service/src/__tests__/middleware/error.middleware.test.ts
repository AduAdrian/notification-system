import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../middleware/error.middleware';

describe('Error Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      path: '/api/test',
      method: 'GET',
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should handle generic errors with 500 status', () => {
    const error = new Error('Test error');

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: 'Test error',
        }),
      })
    );
  });

  it('should handle errors with custom status code', () => {
    const error: any = new Error('Not found');
    error.statusCode = 404;

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(404);
  });

  it('should include error code if present', () => {
    const error: any = new Error('Validation failed');
    error.code = 'VALIDATION_ERROR';
    error.statusCode = 400;

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
        }),
      })
    );
  });

  it('should use INTERNAL_ERROR code for generic errors', () => {
    const error = new Error('Something went wrong');

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
        }),
      })
    );
  });

  it('should include metadata if present in response locals', () => {
    const error = new Error('Test error');
    mockRes.locals = {
      metadata: {
        requestId: 'req-123',
        timestamp: new Date(),
      },
    };

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          requestId: 'req-123',
        }),
      })
    );
  });

  it('should handle errors without message', () => {
    const error = new Error();

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalled();
  });
});
