// Waits for Vite dev server then launches Electron
const { spawn } = require('child_process')
const net = require('net')

function waitForPort(port, retries = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const check = () => {
      const client = net.connect({ port }, () => {
        client.destroy()
        resolve()
      })
      client.on('error', () => {
        if (++attempts >= retries) return reject(new Error(`Port ${port} not ready after ${retries} attempts`))
        setTimeout(check, 500)
      })
    }
    check()
  })
}

async function main() {
  console.log('Waiting for Vite dev server on port 5173...')
  await waitForPort(5173)
  console.log('Starting Electron...')
  const proc = spawn(
    require.resolve('electron/cli.js'),
    ['.'],
    {
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: 'inherit'
    }
  )
  proc.on('close', code => process.exit(code || 0))
}

main().catch(err => { console.error(err); process.exit(1) })
