
const sendSuccess = (res, { status = 200, message, data } = {}) =>
  res.status(status).json({
    success: true,
    ...(message ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  });

module.exports = { sendSuccess };
