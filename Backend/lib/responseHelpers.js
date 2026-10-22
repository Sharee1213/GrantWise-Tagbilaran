function formatFieldErrors(errors = []) {
  return (Array.isArray(errors) ? errors : []).reduce((result, issue) => {
    const field = issue?.field || issue?.path?.join(".") || "form";
    if (!result[field]) {
      result[field] = issue?.message || "Invalid value.";
    }
    return result;
  }, {});
}

function createApiError(message, status, errors = []) {
  const payload = { message };
  const normalizedErrors = Array.isArray(errors) ? errors : [];
  if (normalizedErrors.length > 0) {
    payload.errors = normalizedErrors;
  }
  return { status, payload };
}

function sendValidationError(res, message, issues = []) {
  const normalizedIssues = Array.isArray(issues) ? issues : [];
  return res.status(400).json({
    message,
    errors: normalizedIssues.map((issue) => ({
      field: issue?.field || issue?.path?.join(".") || "form",
      message: issue?.message || "Invalid value.",
    })),
  });
}

module.exports = {
  formatFieldErrors,
  createApiError,
  sendValidationError,
};
