'use strict'

const test     = require('tap').test
const packer   = require('../lib/uint8array-pack')
const unpacker = require('../lib/uint8array-unpack')


test('array pack', function(t) {

  const dest = new Uint8Array([ 0, 2, 4, 6, 8, 10, 12 ])

  const src = new Uint8Array([ 5, 7, 9, 11, 13, 15 ])

  const p = packer(dest)

  p.packArray(src, 3)

  t.deepEqual(dest, [ 5, 7, 9, 6, 8, 10, 12 ])
  t.deepEqual(src, [ 5, 7, 9, 11, 13, 15 ], 'original array is unmodified')
  t.end()
})


test('array unpack', function(t) {

  const dest = new Uint8Array(10)

  const src = new Uint8Array([ 9, 10, 11, 12, 13 ])

  const u = unpacker(src)

  u.unpackArray(dest, 3)

  t.deepEqual(dest, [ 9, 10, 11, 0, 0, 0, 0, 0, 0, 0 ])
  t.deepEqual(src, [ 9, 10, 11, 12, 13 ], 'original array is unmodified')
  t.end()
})
