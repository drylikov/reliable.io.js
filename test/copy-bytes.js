'use strict'

const test      = require('tap').test
const copyBytes = require('../lib/copy-bytes')


test('basic', function(t) {
  const src = new Uint8Array([ 2, 3, 4 ])
  const dest = new Uint8Array([ 0, 0, 0, 0, 0 ])

  copyBytes(dest.buffer, src.buffer)

  t.deepEqual(dest, [ 2, 3, 4, 0, 0 ], 'target array has values from source')
  t.deepEqual(src, [ 2, 3, 4 ], 'source array is unmodified')

  t.end()
})

test('arrays are copied', function(t) {
  const src = new Uint8Array([ 2, 3, 4 ])
  const dest = new Uint8Array([ 0, 0, 0, 0, 0 ])

  copyBytes(dest.buffer, src.buffer)
  t.deepEqual(dest, [ 2, 3, 4, 0, 0 ], 'target array has values from source')
  t.deepEqual(src, [ 2, 3, 4 ], 'source array is unmodified')

  src[0] = 16
  t.deepEqual(dest, [ 2, 3, 4, 0, 0 ], 'target array is unchanged')
  t.deepEqual(src, [ 16, 3, 4 ], 'source array is modified')

  dest[0] = 43
  t.deepEqual(dest, [ 43, 3, 4, 0, 0 ], 'target array is changed')
  t.deepEqual(src, [ 16, 3, 4 ], 'source array is unmodified')

  t.end()
})

test('destination offset', function(t) {
  const src = new Uint8Array([ 2, 3, 4 ])
  const dest = new Uint8Array([ 0, 0, 0, 0, 0 ])

  const destOffset = 1
  copyBytes(dest.buffer, src.buffer, destOffset)

  t.deepEqual(dest, [ 0, 2, 3, 4, 0 ], 'target array has values from source start at index 1')
  t.deepEqual(src, [ 2, 3, 4 ], 'source array is unmodified')

  t.end()
})

test('source offset', function(t) {
  const src = new Uint8Array([ 2, 3, 4 ])
  const dest = new Uint8Array([ 0, 0, 0, 0, 1 ])

  const destOffset = 0
  const sourceOffset = 1
  copyBytes(dest.buffer, src.buffer, destOffset, sourceOffset)

  t.deepEqual(dest, [ 3, 4, 0, 0, 1 ], 'target array has values from source start at index 1')
  t.deepEqual(src, [ 2, 3, 4 ], 'source array is unmodified')

  t.end()
})

test('source length and offset', function(t) {
  const src = new Uint8Array( [ 2, 3, 4, 9, 12, 16, 18 ])
  const dest = new Uint8Array([ 0, 0, 0, 0, 0,  0,  0, 0 ])

  const destOffset = 2
  const sourceOffset = 1
  const sourceLength = 4
  copyBytes(dest.buffer, src.buffer, destOffset, sourceOffset, sourceLength)

  t.deepEqual(dest, [ 0, 0, 3, 4, 9, 12, 0, 0 ], 'target array has values from source start at index 1')
  t.deepEqual(src, [ 2, 3, 4, 9, 12, 16, 18 ], 'source array is unmodified')

  t.end()
})

test('copying too many bytes throws', function(t) {
  const src = new Uint8Array([ 1, 2, 3 ])
  const dest = new Uint8Array([ 0, 0 ])

  const destOffset = 0
  const sourceOffset = 0
  const sourceLength = 3
  try {
    copyBytes(dest.buffer, src.buffer, destOffset, sourceOffset, sourceLength)
    t.fail('copying too many bytes from source to dest should throw error')
  } catch(er) {
    t.ok(er.toString().indexOf('RangeError: Invalid typed array length') > -1, 'copying too many bytes from source to dest throws error')
  }

  t.end()
})
