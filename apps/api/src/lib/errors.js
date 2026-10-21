export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)
  const isValidationError = error.name === 'ValidationError' || error.name === 'ZodError'
  const isUploadError = error.name === 'MulterError'
  const isFileTooLarge = isUploadError && error.code === 'LIMIT_FILE_SIZE'
  const status = error.status ?? (isFileTooLarge ? 413 : isValidationError || isUploadError ? 400 : 500)
  const code = error.code ?? (isFileTooLarge ? 'FILE_TOO_LARGE' : isValidationError ? 'VALIDATION_ERROR' : isUploadError ? 'INVALID_UPLOAD' : 'INTERNAL_ERROR')
  const details = error.details ?? (error.name === 'ZodError'
    ? error.issues.map(({ path, message }) => ({ field: path.join('.'), issue: message }))
    : error.name === 'ValidationError'
      ? Object.values(error.errors).map(({ path, message }) => ({ field: path, issue: message }))
      : undefined)
  if (status >= 500) console.error({ requestId: req.id, error: error.message })
  const message = isFileTooLarge ? 'Evidence files are limited to 25 MB' : status >= 500 ? 'An unexpected error occurred' : error.message
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) }, requestId: req.id })
}
