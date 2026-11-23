export function errorHandler(err, _req, res, _next) {
  console.error(err)
  res.status(err.status >= 400 && err.status <= 599 ? err.status : 500).json({
    message: err.message || 'เกิดข้อผิดพลาดภายในระบบ',
  })
}
