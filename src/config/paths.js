import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const srcDir = dirname(fileURLToPath(import.meta.url))
const rootDir = join(srcDir, '..')

export const paths = {
  publicDir: join(rootDir, 'public'),
  publicFile: (fileName) => join(rootDir, 'public', fileName),
}
