export function notFoundHandler(request, response, next) {
  const error = new Error(`Route not found: ${request.method} ${request.path}`);
  error.status = 404;
  error.code = 'NOT_FOUND';
  next(error);
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  const candidateStatus = Number(error.status ?? error.statusCode);
  const status =
    Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599
      ? candidateStatus
      : 500;
  const isClientError = status < 500;
  const message =
    error.type === 'entity.parse.failed'
      ? 'Request body must contain valid JSON.'
      : isClientError
        ? error.message
        : 'An unexpected error occurred.';

  response.status(status).json({
    error: {
      code: isClientError ? (error.code ?? 'REQUEST_ERROR') : 'INTERNAL_SERVER_ERROR',
      message,
      ...(isClientError && error.details ? { details: error.details } : {}),
    },
  });
}
