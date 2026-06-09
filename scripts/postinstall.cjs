const { spawnSync } = require('node:child_process')

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
}

require('./ensure-kun-install.cjs')

const buildKun = run('npm', ['--prefix', 'kun', 'run', 'build'])
if (buildKun.status !== 0) {
  process.exit(buildKun.status || 1)
}
