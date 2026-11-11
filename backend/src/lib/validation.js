import { AppError } from './errors.js';

export function validateObjectIds(...parameterNames) {
  return (request, response, next) => {
    const invalid = parameterNames.find(
      (name) => !/^[a-f\d]{24}$/i.test(request.params[name] ?? ''),
    );
    if (invalid) {
      next(new AppError(400, 'VALIDATION_ERROR', `${invalid} must be a valid identifier.`));
      return;
    }
    next();
  };
}

export function validate(schema, source = 'body') {
  return (request, response, next) => {
    const parsed = schema.safeParse(request[source]);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        reason: issue.message,
      }));
      next(new AppError(400, 'VALIDATION_ERROR', 'One or more fields are invalid.', details));
      return;
    }
    request[source] = parsed.data;
    next();
  };
}

export function rejectUnknownQuery(allowed) {
  return (request, response, next) => {
    const unknown = Object.keys(request.query).filter((key) => !allowed.includes(key));
    if (unknown.length) {
      next(
        new AppError(400, 'UNKNOWN_FIELD', 'Unknown query parameter.', [
          { field: unknown[0], reason: 'is not supported' },
        ]),
      );
      return;
    }
    next();
  };
}
