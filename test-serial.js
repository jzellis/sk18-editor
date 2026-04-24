#!/usr/bin/env node
// Raw serial probe for SK18 - run with: node test-serial.js
const { SerialPort } = require('./node_modules/serialport')
const { crc32: zlibCrc32 } = require('zlib')

function crc32(buf) {
  return zlibCrc32(buf) >>> 0
}

function buildFrame(cmd, payload) {
  const magic = Buffer.from([0xa1, 0xa5, 0x5a, 0x5e])
  const id = Buffer.alloc(4); id.writeUInt32LE(1)
  const cmdBuf = Buffer.alloc(4); cmdBuf.writeUInt32LE(cmd)
  const sizeBuf = Buffer.alloc(4); sizeBuf.writeUInt32LE(payload.length)
  const sizeCrc = Buffer.alloc(4); sizeCrc.writeUInt32LE(crc32(sizeBuf))
  const dataCrc = Buffer.alloc(4); dataCrc.writeUInt32LE(crc32(payload))
  return Buffer.concat([magic, id, cmdBuf, sizeBuf, sizeCrc, payload, dataCrc])
}

async function writeAll(port, buf) {
  return new Promise((res, rej) => {
    const ok = port.write(buf, err => err ? rej(err) : undefined)
    if (ok) { port.drain(res) } else { port.once('drain', res) }
  })
}

async function write1MB(port) {
  // Send 1MB in 4KB chunks, respecting backpressure
  const chunk = Buffer.alloc(4096, 0x30)
  const TOTAL = 1024 * 1024
  let sent = 0
  while (sent < TOTAL) {
    const ok = port.write(chunk)
    sent += chunk.length
    if (!ok) await new Promise(res => port.once('drain', res))
    if (sent % (64 * 1024) === 0) process.stdout.write('.')
  }
  await new Promise(res => port.drain(res))
  process.stdout.write('\n')
}

async function main() {
  const port = new SerialPort({ path: '/dev/ttyACM0', baudRate: 115200, autoOpen: false })

  await new Promise((res, rej) => port.open(err => err ? rej(err) : res()))
  console.log('Port opened')

  let rxTotal = 0
  let rxBuf = Buffer.alloc(0)
  port.on('data', chunk => {
    rxTotal += chunk.length
    rxBuf = Buffer.concat([rxBuf, chunk])
    console.log(`\nRX ${chunk.length} bytes: ${chunk.toString('hex')}`)
  })
  port.on('error', err => console.error('\nError:', err.message))

  const getInfo = buildFrame(101, Buffer.from('{"method":"getInfo"}'))

  // Test 1: Send full 1MB init then getInfo
  process.stdout.write('Sending 1MB init (dots = 64KB): ')
  await write1MB(port)
  console.log('1MB sent. Sending getInfo...')
  await writeAll(port, getInfo)
  await new Promise(res => setTimeout(res, 5000))

  if (rxTotal > 0) {
    console.log(`\nDevice responded! Full RX:\n${rxBuf.toString('hex')}`)
  } else {
    console.log('Still no response after full 1MB init.')
  }

  port.close()
}

main().catch(err => { console.error(err); process.exit(1) })
