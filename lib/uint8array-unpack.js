'use strict'

const copyBytes = require('./copy-bytes')
const { reliable_printf } = require('./printf')


const RELIABLE_LOG_LEVEL_ERROR = 1

const scratch = new DataView(new ArrayBuffer(8))

// from https://github.com/binaryjs/js-binarypack/blob/master/lib/binarypack.js


function unpack_uint8(arr, index) {
  return (arr[index] & 0xff) >>> 0
}


function unpack_uint16(arr, index) {
  let n = arr[index+1] << 8
  n = n + (arr[index] & 0xFF)

  return n >>> 0
}


function unpack_uint32(arr, index) {
  let n = arr[index+3] << 24
  n = n + (arr[index+2] << 16)
  n = n + (arr[index+1] << 8)
  n = n + (arr[index] & 0xFF)
  return n >>> 0
}


// @param Uint8Array src
module.exports = function unpack(src) {
  let index = 0

  const reset = function() {
    index = 0
  }

  // @param Uint8Array dest
  // @param int count number of bytes to copy into dest array
  const unpackArray = function(dest, count=dest.byteLength) {
    copyBytes(dest.buffer, src.buffer, 0, index, count)
    index += count
  }

  const unpackInt16 = function() {
    let result = unpackUint16()
    if (result !== undefined) {
      return (result < 0x8000 ) ? result : result - (1 << 16)
    }
  }

  const unpackFloat32 = function() {
    if(index + 4 > src.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'unpackFloat32: out of range')
      return
    }

    scratch.setInt8(0, src[index])
    scratch.setInt8(1, src[index+1])
    scratch.setInt8(2, src[index+2])
    scratch.setInt8(3, src[index+3])
    index = index + 4
    return scratch.getFloat32(0)
  }

  const unpackFloat64 = function() {
    if(index + 8 > src.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'unpackFloat64: out of range')
      return
    }

    scratch.setUint8(0, src[index])
    scratch.setUint8(1, src[index+1])
    scratch.setUint8(2, src[index+2])
    scratch.setUint8(3, src[index+3])
    scratch.setUint8(4, src[index+4])
    scratch.setUint8(5, src[index+5])
    scratch.setUint8(6, src[index+6])
    scratch.setUint8(7, src[index+7])
    index = index + 8
    return scratch.getFloat32(0)
  }

  const unpackString = function() {
    if(index + 1 > src.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'unpackString: out of range')
      return
    }

    const len = unpackUint8()

    if(index + len > src.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'unpackString: invalid length', len)
      return
    }

    let result = ''
    for (let i=0; i < len; i++) {
      result = result + String.fromCharCode(unpackUint8())
    }
    return result
  }

  const unpackUint8 = function() {
    if(index + 1 > src.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'unpackUint8: out of range')
      return
    }

    index++
    return unpack_uint8(src, index-1)
  }

  const unpackUint16 = function() {
    if(index + 2 > src.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'unpackUint16: out of range')
      return
    }
    index = index + 2
    return unpack_uint16(src, index-2)
  }

  const unpackUint32 = function() {
    if(index + 4 > src.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'unpackUint32: out of range')
      return
    }
    index = index + 4
    return unpack_uint32(src, index-4)
  }

  const getIndex = function() {
    return index
  }

  return { reset, unpackArray, unpackInt16, unpackUint8, unpackUint16,
    unpackUint32, unpackFloat32, unpackFloat64, unpackString, getIndex }
}
