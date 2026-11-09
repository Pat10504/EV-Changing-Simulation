export function errorHandler(err, _req, res, _next) {
  console.error(err)
  res.status(500).json({
    message: err.message || 'เกิดข้อผิดพลาดภายในระบบ',
  })
}
