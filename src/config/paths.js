import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const srcDir = dirname(fileURLToPath(import.meta.url))
const rootDir = join(srcDir, '..')

export const paths = {
  chartBundle: join(rootDir, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
  publicDir: join(rootDir, 'public'),
  publicFile: (fileName) => join(rootDir, 'public', fileName),
}
